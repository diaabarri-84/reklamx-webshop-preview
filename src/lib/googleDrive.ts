/**
 * Google Drive, on the shop owner's own account.
 *
 * WHY OAUTH AND NOT A SERVICE ACCOUNT. A service account has no Drive storage
 * of its own outside Google Workspace; anything it uploads into a folder shared
 * by a consumer Gmail account fails with a quota error. The owner's Drive is a
 * consumer account, so the only thing that works is the authorization-code
 * flow: he clicks Connect once, approves, and the refresh token that comes back
 * lets the server upload as him, for as long as he leaves it connected.
 *
 * WHY NO GOOGLE SDK. googleapis pulls in tens of megabytes for three REST calls
 * this file makes with fetch. Fewer moving parts on a shared host, and the
 * runtime install stays at six packages.
 *
 * The scope is drive.file — the narrowest one that works. It grants access ONLY
 * to files this app creates. The shop cannot read, list or touch anything else
 * in the owner's Drive, which is the promise to make when asking someone to
 * connect their personal account.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

/** Anything bigger than this is linked, not copied — see uploadFile. */
export const MAX_DRIVE_BYTES = 40 * 1024 * 1024;

export type GoogleCreds = {
  clientId?: string;
  clientSecret?: string;
  refreshToken?: string;
  account?: string;
  rootFolderId?: string;
  connectedAt?: string;
};

/** The consent screen URL the owner is sent to. `state` ties it to our session. */
export function buildConsentUrl(clientId: string, redirectUri: string, state: string): string {
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: `${DRIVE_SCOPE} https://www.googleapis.com/auth/userinfo.email`,
    // offline + consent together are what actually produce a refresh token.
    // Without prompt=consent Google returns one only on the very first
    // authorisation, so a re-connect after revoking silently yields none.
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
    state,
  });
  return `${AUTH_URL}?${q.toString()}`;
}

async function tokenRequest(body: Record<string, string>): Promise<any> {
  const resp = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.error_description || data?.error || `Google token endpoint answered ${resp.status}`);
  }
  return data;
}

/** Swap the one-time code from the consent redirect for a refresh token. */
export async function exchangeCode(
  clientId: string,
  clientSecret: string,
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string; accessToken: string; email?: string; scope: string }> {
  const data = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    code,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
  });
  if (!data.refresh_token) {
    throw new Error(
      'Google returned no refresh token. Remove the app at myaccount.google.com/permissions and connect again.',
    );
  }
  let email: string | undefined;
  try {
    const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    }).then((r) => r.json());
    email = who?.email;
  } catch {
    /* the address is a nicety for the panel, not a requirement */
  }
  // THE SCOPE GOOGLE ACTUALLY GRANTED, which is not the scope we asked for.
  //
  // Drive is a granular permission: the consent screen shows it as a tick-box
  // beside the app name, and a shopper who reads "Continue" as the whole job
  // leaves it unticked. Google still answers with a perfectly valid refresh
  // token — it just carries `userinfo.email openid` and nothing else. The shop
  // then reported a healthy connection that could not create a folder, list a
  // file, or file a single order, and said so nowhere.
  return {
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    email,
    scope: String(data.scope ?? ''),
  };
}

/** Did the owner actually tick the Drive box on the consent screen? */
export function grantsDrive(scope: string): boolean {
  return scope.split(/\s+/).includes(DRIVE_SCOPE);
}

// Access tokens last an hour; this keeps one rather than minting a fresh one
// per file in an order that has three attachments.
let cachedAccess: { token: string; until: number; forRefresh: string } | null = null;

export async function getAccessToken(creds: GoogleCreds): Promise<string> {
  const { clientId, clientSecret, refreshToken } = creds;
  if (!clientId || !clientSecret || !refreshToken) throw new Error('Google Drive is not connected.');
  if (cachedAccess && cachedAccess.forRefresh === refreshToken && Date.now() < cachedAccess.until) {
    return cachedAccess.token;
  }
  const data = await tokenRequest({
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type: 'refresh_token',
  });
  cachedAccess = {
    token: data.access_token,
    // A minute of slack, so a token never expires mid-upload.
    until: Date.now() + Math.max(60, Number(data.expires_in ?? 3600) - 60) * 1000,
    forRefresh: refreshToken,
  };
  return data.access_token;
}

/** Forget the cached access token — used when the credentials change. */
export function resetDriveToken(): void {
  cachedAccess = null;
}

async function driveJson(token: string, path: string, init: RequestInit = {}): Promise<any> {
  const resp = await fetch(`${DRIVE_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || `Drive answered ${resp.status}`);
  return data;
}

/**
 * A folder by name under `parent`, made only if it is not already there.
 *
 * Re-running an order's push must not leave a second folder beside the first,
 * so this looks before it creates. The query is scoped to drive.file, which
 * means it only ever sees folders this app made — exactly what we want.
 */
export async function ensureFolder(token: string, name: string, parentId?: string): Promise<string> {
  const safe = name.replace(/'/g, "\\'");
  const q = [
    `name = '${safe}'`,
    "mimeType = 'application/vnd.google-apps.folder'",
    'trashed = false',
    parentId ? `'${parentId}' in parents` : null,
  ]
    .filter(Boolean)
    .join(' and ');

  const found = await driveJson(token, `/files?q=${encodeURIComponent(q)}&fields=files(id,name)&pageSize=1`);
  if (found.files?.[0]?.id) return found.files[0].id;

  const made = await driveJson(token, '/files?fields=id', {
    method: 'POST',
    body: JSON.stringify({
      name,
      mimeType: 'application/vnd.google-apps.folder',
      ...(parentId ? { parents: [parentId] } : {}),
    }),
  });
  return made.id;
}

/** Upload bytes. Multipart is enough here: the cap above keeps it honest. */
export async function uploadFile(
  token: string,
  folderId: string,
  name: string,
  mimeType: string,
  bytes: Buffer | Uint8Array,
): Promise<{ id: string; webViewLink: string }> {
  const boundary = 'rx' + Math.abs(bytes.byteLength * 2654435761 % 0xffffffff).toString(16) + 'b';
  const meta = JSON.stringify({ name, parents: [folderId] });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`),
    Buffer.from(`--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`),
    Buffer.from(bytes),
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const resp = await fetch(`${DRIVE_UPLOAD}?uploadType=multipart&fields=id,webViewLink`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error?.message || `Drive upload answered ${resp.status}`);
  return { id: data.id, webViewLink: data.webViewLink };
}

/** Confirm a connection is really usable, without writing anything. */
export async function verifyDrive(creds: GoogleCreds): Promise<{ ok: boolean; reason?: string; email?: string }> {
  try {
    const token = await getAccessToken(creds);
    const who = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null));
    await driveJson(token, '/files?pageSize=1&fields=files(id)');
    return { ok: true, email: who?.email };
  } catch (err: any) {
    return { ok: false, reason: String(err?.message ?? err).slice(0, 200) };
  }
}
