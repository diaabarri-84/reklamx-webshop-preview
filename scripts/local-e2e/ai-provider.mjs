// Round 16, item 8 — "the AI on DeepSeek": the owner chooses the service, pastes
// its key, and the key goes to that service only.
//
//   the owner: four services to choose from; DeepSeek says, before he saves,
//   that it processes data in China; the save carries his choice (intercepted
//   in the browser — no key ever leaves this machine in this test).
//   the server: a key with no recognisable service, or a "service" that is not
//   one, is refused before anybody is asked.
//   a customer: the privacy policy names the company that answers the chat —
//   "our AI provider" with none, DeepSeek and China when it is DeepSeek, in his
//   language.
import { launch, loginAdmin, BASE, SHOTS, db, check, summary } from './lib.mjs';

const { browser, page, errors } = await launch();
const poll = async (read, ok, tries = 60) => {
  let v;
  for (let i = 0; i < tries; i++) {
    v = await read();
    if (ok(v)) return v;
    await new Promise((r) => setTimeout(r, 250));
  }
  return v;
};

// ---- the owner ----
await loginAdmin(page);
await page.goto(`${BASE}/admin`, { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Got it' }).click({ timeout: 4000 }).catch(() => {});
// Keys left in the emulator by an earlier run would be "saved" rows here: start clean.
const secrets = db.collection('secrets').doc('integrations');
const secretsBefore = (await secrets.get()).data() ?? {};
// "Use this one" below rewrites the privacy policy's AI record too: kept to put back.
const legalAtStart = (await db.collection('settings').doc('legalPages').get()).data() ?? null;
const { FieldValue } = (await import('node:module')).createRequire(import.meta.url)('firebase-admin/firestore');
await secrets.set({ ai: FieldValue.delete(), gemini: FieldValue.delete() }, { merge: true });
await page.getByRole('button', { name: 'Payments & API keys' }).first().click();
const card = page.locator('[data-rx-ai-keys]');
await card.waitFor({ timeout: 20000 });
const choices = await card.locator('[data-rx-ai-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-rx-ai-row')));
check('four services, a row each — every one with its own key', JSON.stringify(choices) === JSON.stringify(['google', 'openai', 'anthropic', 'deepseek']), JSON.stringify(choices));
check('no DeepSeek warning while nothing is pasted for DeepSeek', (await card.locator('[data-rx-deepseek-warning]').count()) === 0);
const deepseek = card.locator('[data-rx-ai-row="deepseek"]');
await deepseek.locator('[data-rx-ai-input="deepseek"]').fill('sk-');
const warning = await card.locator('[data-rx-deepseek-warning]').innerText().catch(() => '');
check('a DeepSeek key being pasted: told BEFORE saving that it processes data in China, outside the EU/EEA, and what goes there',
  /China/.test(warning) && /outside the EU\/EEA/.test(warning) && /chat/.test(warning), warning.slice(0, 120));
await page.waitForTimeout(500); // the choices' colour transition, before judging a picture
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/105-ai-provider.png` });

// A Google key pasted into DeepSeek's row — the leak a review found: it was SENT,
// to the chosen service. Now it is stopped as he pastes it.
await deepseek.locator('[data-rx-ai-input="deepseek"]').fill('AIzaSyNOT-A-REAL-KEY-0000');
const problem = await deepseek.locator('[data-rx-key-problem]').innerText().catch(() => '');
check('a Google key in DeepSeek\'s row: said at once, and its "Verify & save" is off — nothing can be sent',
  /looks like a Google AI key, not a DeepSeek key/.test(problem) && (await deepseek.locator('[data-rx-ai-save="deepseek"]').isDisabled()), problem);

let posted = null;
await page.route('**/api/admin/integrations', async (route) => {
  if (route.request().method() !== 'POST') return route.continue();
  posted = route.request().postDataJSON();
  // Answered here: this test sends no key to DeepSeek or anyone else.
  await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: 'DeepSeek did not accept that key.' }) });
});
await deepseek.locator('[data-rx-ai-input="deepseek"]').fill('sk-test-not-a-real-key-0000');
check('an sk- key in DeepSeek\'s row: nothing to object to', (await deepseek.locator('[data-rx-key-problem]').count()) === 0);
await card.locator('[data-rx-deepseek-confirm]').check();
await deepseek.locator('[data-rx-ai-save="deepseek"]').click();
await page.getByText('DeepSeek did not accept that key.').waitFor({ timeout: 10000 }).catch(() => {});
check('the save names the service he chose — the server asks that one only — and carries his agreement tick',
  posted?.name === 'gemini' && posted?.provider === 'deepseek' && posted?.value === 'sk-test-not-a-real-key-0000' && posted?.transferConfirmed === true,
  JSON.stringify({ ...posted, value: posted?.value ? '…' : null }));
check('a refused key keeps his paste in the box', (await deepseek.locator('[data-rx-ai-input="deepseek"]').inputValue()) === 'sk-test-not-a-real-key-0000');
await page.unroute('**/api/admin/integrations');

// ---- several saved keys, one in use (client, 2026-10-07) ----
// Two keys as the server stores them once their services accepted them (no real
// key is sent anywhere in this test): Google in use, OpenAI kept beside it.
const slot = (key, provider) => ({ key, last4: key.slice(-4), updatedAt: '2026-10-07T08:00:00.000Z', updatedBy: 'admin@emulator.test', provider, verifiedModel: `${provider}-model`, verifiedWarning: null, transferConfirmed: false });
await secrets.set({ ai: { active: 'google', keys: { google: slot('AIzaFAKE-google-1111', 'google'), openai: slot('sk-FAKE-openai-2222', 'openai') } }, gemini: slot('AIzaFAKE-google-1111', 'google') }, { merge: true });
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: 'Payments & API keys' }).first().click();
await card.locator('[data-rx-ai-row="openai"] [data-rx-ai-state="saved"]').waitFor({ timeout: 20000 });
check('both keys shown: Google in use, OpenAI saved beside it (…2222)',
  (await card.locator('[data-rx-ai-row="google"] [data-rx-ai-state="in-use"]').count()) === 1 && /2222/.test(await card.locator('[data-rx-ai-row="openai"] [data-rx-ai-state]').innerText()));
const healthBefore = await (await fetch(`${BASE}/api/health`)).json();
await card.locator('[data-rx-ai-use="openai"]').click();
await card.locator('[data-rx-ai-row="openai"] [data-rx-ai-state="in-use"]').waitFor({ timeout: 15000 });
const after = (await secrets.get()).data() ?? {};
const healthAfter = await (await fetch(`${BASE}/api/health`)).json();
check('"Use this one": OpenAI is in use now — the shop\'s chat answers on it (health) — and the Google key is KEPT',
  healthBefore.chatProvider === 'google' && healthAfter.chatProvider === 'openai' && after.ai?.active === 'openai' && after.ai?.keys?.google?.key === 'AIzaFAKE-google-1111' && after.gemini?.key === 'sk-FAKE-openai-2222',
  JSON.stringify({ before: healthBefore.chatProvider, after: healthAfter.chatProvider, active: after.ai?.active, google: after.ai?.keys?.google?.last4, mirror: after.gemini?.last4 }));
check('…the privacy policy follows the service in use', (await db.collection('settings').doc('legalPages').get()).data()?.aiProcessor?.provider === 'openai');
await card.locator('[data-rx-ai-use="google"]').click();
await card.locator('[data-rx-ai-row="google"] [data-rx-ai-state="in-use"]').waitFor({ timeout: 15000 });
check('…and back to Google with one press, nothing pasted again', (await (await fetch(`${BASE}/api/health`)).json()).chatProvider === 'google');
await card.scrollIntoViewIfNeeded();
await page.screenshot({ path: `${SHOTS}/106-ai-keys.png` });

/** The card, read afresh (the page asks the server, which reads the secrets again). */
const reopen = async (waitFor) => {
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Payments & API keys' }).first().click();
  await card.locator(waitFor).waitFor({ timeout: 20000 });
};
const fresh = async (data) => {
  await secrets.set({ ai: FieldValue.delete(), gemini: FieldValue.delete() }, { merge: true });
  await secrets.set(data, { merge: true });
};

// ---- DeepSeek's agreement, for the key ALREADY saved (a review: the box always
// started unticked, and a tick with no new key pasted was never sent) ----
const dsSlot = { ...slot('sk-FAKE-deepseek-5555', 'deepseek'), transferConfirmed: true };
await fresh({ ai: { active: 'deepseek', keys: { deepseek: dsSlot } }, gemini: dsSlot });
await db.collection('settings').doc('legalPages').set({ aiProcessor: { provider: 'deepseek', transferConfirmed: true, updatedAt: '2026-10-07T08:00:00.000Z' } }, { merge: true });
await reopen('[data-rx-ai-row="deepseek"] [data-rx-ai-state="in-use"]');
const confirmBox = card.locator('[data-rx-deepseek-confirm]');
check('DeepSeek in use with the agreement confirmed: the box shows it TICKED (it always started unticked)', await confirmBox.isChecked());
await confirmBox.uncheck();
const unticked = await poll(async () => (await secrets.get()).data()?.ai?.keys?.deepseek?.transferConfirmed, (v) => v === false);
const legalOff = (await db.collection('settings').doc('legalPages').get()).data()?.aiProcessor;
check('unticked with no key pasted: recorded at once on the saved key — and the privacy policy follows (DeepSeek is in use)',
  unticked === false && legalOff?.transferConfirmed === false && legalOff?.provider === 'deepseek', JSON.stringify({ unticked, legalOff }));
await confirmBox.check();
const reticked = await poll(async () => (await secrets.get()).data()?.ai?.keys?.deepseek?.transferConfirmed, (v) => v === true);
check('…ticked again: recorded again, and the key itself untouched', reticked === true && (await secrets.get()).data()?.ai?.keys?.deepseek?.key === 'sk-FAKE-deepseek-5555');

// ---- the live shop's own key: saved in 2026-09, before keys had a service named ----
const legacy = { key: 'AIzaFAKE-legacy-3333', last4: '3333', updatedAt: '2026-09-13T10:00:00.000Z', updatedBy: 'owner@reklamx.test' };
await fresh({ ai: { keys: { openai: slot('sk-FAKE-openai-2222', 'openai') } }, gemini: legacy });
await reopen('[data-rx-ai-row="google"] [data-rx-ai-state="in-use"]');
check('a key saved with no service named: shown as Google\'s (its shape), IN USE — not "no AI service in use"',
  /3333/.test(await card.locator('[data-rx-ai-row="google"] [data-rx-ai-state]').innerText()) && /Google/.test(await card.locator('[data-rx-ai-in-use]').innerText()));
await card.locator('[data-rx-ai-use="openai"]').click();
await card.locator('[data-rx-ai-row="openai"] [data-rx-ai-state="in-use"]').waitFor({ timeout: 15000 });
const afterLegacy = (await secrets.get()).data() ?? {};
check('…switching away from it KEEPS it, as Google\'s key', afterLegacy.ai?.active === 'openai' && afterLegacy.ai?.keys?.google?.key === legacy.key && afterLegacy.gemini?.key === 'sk-FAKE-openai-2222',
  JSON.stringify({ active: afterLegacy.ai?.active, google: afterLegacy.ai?.keys?.google?.last4, mirror: afterLegacy.gemini?.last4 }));
await card.locator('[data-rx-ai-use="google"]').click();
await card.locator('[data-rx-ai-row="google"] [data-rx-ai-state="in-use"]').waitFor({ timeout: 15000 });
check('…and back to it with one press', (await secrets.get()).data()?.gemini?.key === legacy.key);

// ---- after a rollback: an OLDER server wrote a newer key into `gemini` alone ----
await fresh({
  ai: { active: 'openai', keys: { openai: slot('sk-FAKE-openai-2222', 'openai'), google: slot('AIzaFAKE-google-1111', 'google') } },
  gemini: slot('AIzaFAKE-rollback-4444', 'google'),
});
await reopen('[data-rx-ai-row="google"] [data-rx-ai-state="in-use"]');
check('a key an older server saved after a rollback: it is the newest — in use, as its service\'s key (…4444)',
  /4444/.test(await card.locator('[data-rx-ai-row="google"] [data-rx-ai-state]').innerText()) && (await (await fetch(`${BASE}/api/health`)).json()).chatProvider === 'google');
await card.locator('[data-rx-ai-use="openai"]').click();
await card.locator('[data-rx-ai-row="openai"] [data-rx-ai-state="in-use"]').waitFor({ timeout: 15000 });
check('…and switching away keeps IT, not the key it replaced', (await secrets.get()).data()?.ai?.keys?.google?.key === 'AIzaFAKE-rollback-4444');

// Back as it was (the emulator is shared by every suite).
// Deleted first: a merge would keep the keys this test added beside the old ones.
await secrets.set({ ai: FieldValue.delete(), gemini: FieldValue.delete() }, { merge: true });
await secrets.set({ ai: secretsBefore.ai ?? FieldValue.delete(), gemini: secretsBefore.gemini ?? FieldValue.delete() }, { merge: true });
if (legalAtStart) await db.collection('settings').doc('legalPages').set(legalAtStart);
else await db.collection('settings').doc('legalPages').delete().catch(() => {});

// ---- the server: nobody is asked about a key it cannot place ----
const signIn = await (await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'admin@emulator.test', password: 'emulator-admin-1', returnSecureToken: true }),
})).json();
const post = (body) => fetch(`${BASE}/api/admin/integrations`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${signIn.idToken}` }, body: JSON.stringify(body),
}).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
const unknown = await post({ name: 'gemini', value: 'hello-there' });
const notAService = await post({ name: 'gemini', value: 'sk-abc', provider: 'mistral' });
const crossed = await post({ name: 'gemini', value: 'AIzaSyNOT-A-REAL-KEY', provider: 'deepseek' });
check('a Google key posted as DeepSeek (a page that skips the check): the SERVER refuses it before sending it anywhere',
  crossed.status === 400 && /looks like a Google AI key/.test(crossed.body?.error ?? ''), `${crossed.status} ${crossed.body?.error}`);
check('a key of no recognisable shape, with no service chosen (an old dashboard tab): refused, nobody asked',
  unknown.status === 400 && /Choose which AI service/.test(unknown.body?.error ?? ''), `${unknown.status} ${unknown.body?.error}`);
check('a "service" that is not one: refused, nobody asked', notAService.status === 400 && /Choose which AI service/.test(notAService.body?.error ?? ''), `${notAService.status} ${notAService.body?.error}`);
// The keys were put back straight into the database above: the server reads them again.
await fetch(`${BASE}/api/admin/integrations`, { headers: { Authorization: `Bearer ${signIn.idToken}` } });
const health = await (await fetch(`${BASE}/api/health`)).json();
check('the health check names the company in use — none here — and never a key', 'chatProvider' in health && health.chatProvider === null && !JSON.stringify(health).includes('sk-'), JSON.stringify(health));

// ---- a customer: the privacy policy ----
const shop = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const cp = await shop.newPage();
cp.on('pageerror', (e) => errors.push(String(e?.message ?? e)));
const assistantLine = async () => {
  await cp.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });
  await cp.waitForTimeout(800);
  return cp.locator('p', { hasText: /the AI assistant|AI-assistenten/ }).first().innerText().catch(() => '');
};
const legalRef = db.collection('settings').doc('legalPages');
const legalBefore = (await legalRef.get()).data() ?? null;
const restoreLegal = async () => { if (legalBefore) await legalRef.set(legalBefore); else await legalRef.delete().catch(() => {}); };
process.on('uncaughtException', async (err) => { console.error(err); await restoreLegal().catch(() => {}); process.exit(1); });

await cp.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
const none = await assistantLine();
check('no AI in use: "Our AI provider" — not a company that is not used', /^Our AI provider — the AI assistant/.test(none), none);

// A key from the host, no record from the dashboard: /api/health names it.
await cp.route('**/api/health', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ status: 'ok', chat: true, chatProvider: 'deepseek' }) }));
await cp.reload({ waitUntil: 'domcontentloaded' });
const ds = await assistantLine();
const gap = cp.locator('span', { hasText: 'The agreement that covers this transfer is not yet confirmed' });
check('DeepSeek in use, no agreement confirmed: DeepSeek and China named — and the missing agreement shown as an open gap, not claimed',
  /^DeepSeek \(China\) — the AI assistant/.test(ds) && (await cp.getByText('processes what you type into the chat in China.').count()) >= 1 && (await gap.count()) === 1,
  `${ds} / gap ${await gap.count()}`);
check('…and no "{AI_…}" token is ever shown', (await cp.getByText(/\{AI_/).count()) === 0);

// ---- the chat widget, with DeepSeek answering ----
await cp.getByRole('button', { name: 'Open the ReklamX assistant' }).click({ timeout: 10000 });
await cp.getByRole('button', { name: 'Advisor' }).waitFor({ timeout: 10000 }).catch(() => {});
check('the chat, on DeepSeek: tells the customer where what he types goes — and offers no Maps (Google\'s alone) and no Pro (one model)',
  (await cp.locator('[data-rx-chat-processor]').count()) === 1 &&
  (await cp.getByRole('button', { name: 'Maps' }).count()) === 0 && (await cp.getByRole('button', { name: 'Pro pre-press' }).count()) === 0,
  await cp.locator('[data-rx-chat-processor]').innerText().catch(() => 'no notice'));
await cp.unroute('**/api/health');

// The record the server writes when he saves a key — here, with his agreement confirmed.
await legalRef.set({ aiProcessor: { provider: 'deepseek', transferConfirmed: true, updatedAt: '2026-12-01T10:00:00.000Z' } }, { merge: true });
await cp.goto(`${BASE}/privacy`, { waitUntil: 'domcontentloaded' });
await assistantLine();
check('agreement confirmed by him: the policy names the agreement, shows no gap — and its date moves with the change',
  (await cp.getByText('under our data processing agreement with DeepSeek').count()) === 1 && (await gap.count()) === 0 &&
  (await cp.getByText('2026-12-01').count()) >= 1, `date shown: ${await cp.getByText(/20\d\d-\d\d-\d\d/).first().innerText().catch(() => '?')}`);
// His own privacy text, written before the tokens existed.
await legalRef.set({ overrides: { privacy: { en: 'Our own policy.\n\n## Who we are\nA print shop in Stockholm.' } } }, { merge: true });
await cp.reload({ waitUntil: 'domcontentloaded' });
await cp.getByRole('heading', { level: 1 }).waitFor({ timeout: 15000 });
await cp.getByRole('heading', { name: 'The AI assistant' }).waitFor({ timeout: 8000 }).catch(() => {});
check('his own text without the tokens: the DeepSeek section is added to it, so it still says where the chat goes',
  (await cp.getByText('A print shop in Stockholm.').count()) === 1 && (await cp.getByRole('heading', { name: 'The AI assistant' }).count()) === 1);
await legalRef.set({ overrides: {} }, { merge: true });
await legalRef.set({ aiProcessor: { provider: 'deepseek', transferConfirmed: false, updatedAt: '2026-10-05T10:00:00.000Z' } }, { merge: true });
await cp.evaluate(() => localStorage.setItem('reklamx_language', 'sv'));
await cp.reload({ waitUntil: 'domcontentloaded' });
const sv = await assistantLine();
check('…in Swedish too: DeepSeek (Kina), and the open gap in Swedish',
  /^DeepSeek \(Kina\) — AI-assistenten/.test(sv) && (await cp.getByText('behandlar det du skriver i chatten i Kina').count()) >= 1 &&
  (await cp.locator('span', { hasText: 'Avtalet som täcker denna överföring är ännu inte bekräftat' }).count()) === 1, sv);
await restoreLegal();

// The browser logs the 400 this test staged for the fake key; that one is ours.
const real = errors.filter((e) => !/status of 400 \(Bad Request\)/.test(e));
check('no page errors', real.length === 0, real.slice(0, 3).join(' | '));
await browser.close();
process.exit(summary() ? 1 : 0);
