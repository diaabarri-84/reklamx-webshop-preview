#!/usr/bin/env node
// Do the models this shop asks for still exist? — the gate that was missing.
//
// WHY IT EXISTS.
// On 2026-09-13 the shop's client generated a fresh Google AI Studio key and the
// whole assistant was dead on arrival: `gemini-2.5-flash` and `gemini-2.5-pro`,
// the two ids the code had asked for since it shipped, answer
//
//     404  "This model … is no longer available to new users."
//
// Google retires a model for NEW projects first, so the shop went on working for
// whoever already had a key while being permanently broken for anybody who made
// one. Nothing in this repo would have caught it:
//   · `npm run verify` was green with both dead ids;
//   · scripts/test-ai-provider.mjs asserted the URL contains AI_MODELS.google.fast
//     against a URL BUILT from AI_MODELS.google.fast — a tautology that passes for
//     'banana-9000-turbo' just as happily;
//   · listing the models does NOT help: that key's listing returned 55 models
//     INCLUDING the three that refuse to generate.
// Only asking a model to generate something proves a model.
//
// TWO PROBE TRAPS, both measured that day:
//   · NO TOOLS. Grounded search is refused (429) on a free project while plain
//     generation on the same model in the same second returns 200 — a probe
//     carrying tools would report a healthy model as dead.
//   · NOT ON REPLY LENGTH. A thinking model on a small budget spends the whole
//     budget thinking and returns empty text with finishReason MAX_TOKENS. That
//     model is alive. What proves life is that a candidate came back at all.
//
// THREE EXIT CODES, because "I could not look" is not "it passed":
//   0  every id was probed and answered
//   1  an id is dead, or server.ts has grown its own copy of a model name
//   2  could not look (no key, no network, busy twice)
//
//   node scripts/check-ai-models.mjs ; echo $?

import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

// ---------------------------------------------------------------------------
// STEP A — offline, always runs.
// ---------------------------------------------------------------------------
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-models-'));
const out = join(outDir, 'aiProvider.mjs');
await build({
  entryPoints: [join(ROOT, 'src', 'lib', 'aiProvider.ts')],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const M = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });
const { AI_MODELS, probeRequest, probeLooksAlive, probeIsRefusal, providerErrorSentence } = M;

let hard = 0;

// ONE FILE NAMES THE MODELS. /api/chat used to name its own pair inline, which is
// how the customer-facing widget stayed broken after the shared constant was
// fixed. A note ABOUT a model id is allowed; a working copy of one is not.
//
// ⚠️ COMMENTS ARE STRIPPED BY A COMPILER, NOT BY A REGULAR EXPRESSION. The first
// version of this used /\/\*[\s\S]*?\*\//g, and a `/*` inside a STRING or a regex
// literal in server.ts opens a comment as far as that pattern is concerned — so
// it blanked two large windows of the file and a model id written inside either
// of them sailed through. A check with holes in it is the thing this project
// keeps getting caught by. esbuild parses TypeScript properly and drops the
// comments on the way out; it is already a dependency and `npm run build` uses it.
const serverSrc = readFileSync(join(ROOT, 'server.ts'), 'utf8');
const { transform } = await import('esbuild');
const withoutComments = (await transform(serverSrc, { loader: 'ts', format: 'esm' })).code;
const strays = [...withoutComments.matchAll(/['"`](gemini-[\w.-]+|gpt-[\w.-]+|claude-[\w.-]+|deepseek-[\w.-]+)['"`]/g)].map((m) => m[1]);
if (strays.length) {
  hard = 1;
  console.error(`  ❌ server.ts names ${strays.length} model id(s) itself: ${[...new Set(strays)].join(', ')}`);
  console.error('     Model ids belong in src/lib/aiProvider.ts and nowhere else.');
} else {
  console.log('  ✅ server.ts names no model of its own');
}

// ---------------------------------------------------------------------------
// STEP B — the live probe: the model ids of the service the STORED key is from
// (Google, OpenAI, Anthropic or DeepSeek), probed with that key at that service.
// ---------------------------------------------------------------------------
// THE KEY LIVES WHERE THE SERVER KEEPS IT, not in the deploy machine's shell.
// Without this the gate could only ever run by hand: the dashboard key is in
// Firestore at secrets/integrations, which is exactly where the server reads it,
// and this machine has the service account that can read it too.
let key = (process.env.GEMINI_API_KEY ?? '').trim();
// WHICH SERVICE the key is from — as stored when it was proven, never guessed
// when it can be read: a DeepSeek key starts `sk-` like OpenAI's, and probing it
// as OpenAI would call OpenAI's models dead and block every deploy.
let storedProvider = (process.env.AI_PROVIDER ?? '').trim();
if (!key) {
  try {
    const [{ initializeApp, cert }, { getFirestore }] = await Promise.all([
      import('firebase-admin/app'), import('firebase-admin/firestore'),
    ]);
    const sa = JSON.parse(readFileSync(join(ROOT, 'service-account.json'), 'utf8'));
    const cfg = JSON.parse(readFileSync(join(ROOT, 'firebase-applet-config.json'), 'utf8'));
    const db = getFirestore(
      initializeApp({ credential: cert(sa) }, 'check-ai-models'),
      process.env.FIREBASE_DATABASE_ID || cfg.firestoreDatabaseId || '(default)',
    );
    const snap = await db.collection('secrets').doc('integrations').get();
    key = String(snap.exists ? (snap.data()?.gemini?.key ?? '') : '').trim();
    storedProvider = String(snap.exists ? (snap.data()?.gemini?.provider ?? '') : '').trim();
    if (key) console.log('  ·  using the key the dashboard has stored');
  } catch (err) {
    // A read that fails says nothing about the models — that is exit 2, below.
    console.error(`  ·  could not read the stored key: ${String(err?.message ?? err).slice(0, 120)}`);
  }
}
if (!key) {
  console.error('  ⏭  no AI key anywhere — the model ids were NOT checked against the provider.');
  // THE SAME RULE AS THE OTHER "COULD NOT LOOK" EXIT, and leaving it out of this
  // one blocked a real deploy: Firestore's own read quota was exhausted, the key
  // could not be fetched, and this line exited 2 straight past the flag that
  // exists to stop exactly that. A gate that cannot see must never be the thing
  // that stops a shop being deployed — only a gate that has SEEN something wrong.
  if (hard !== 1 && process.argv.includes('--warn-if-unchecked')) {
    console.error('  (--warn-if-unchecked: not failing the build on "could not look")\n');
    process.exit(0);
  }
  process.exit(hard === 1 ? 1 : 2);
}

const provider = M.isAiProvider(storedProvider) ? storedProvider : (M.detectProvider(key) ?? 'google');
console.log(`  ·  provider: ${provider}${M.isAiProvider(storedProvider) ? ' (as stored)' : ' (guessed from the key — none stored)'}`);
const ids = [...new Set([AI_MODELS[provider].fast, AI_MODELS[provider].complex])];

let couldNotLook = 0;
let probeNo = 0;
for (const model of ids) {
  let verdict = null;
  // A CHECK MUST NOT TRIP THE LIMIT IT IS MEASURING. Probing both ids back to
  // back put two requests into the same rolling minute on a free-tier key and the
  // second came back 429 — so the gate reported "could not tell" about a model
  // that was perfectly alive, which is crying wolf. A few seconds between them
  // costs nothing and removes the self-inflicted failure.
  if (probeNo++ > 0) await new Promise((r) => setTimeout(r, 6000));
  // Two attempts: a transient 503 "experiencing high demand" is common and is not
  // a dead model. Seven of twenty-three probe calls hit it on the day this was
  // written, and every one of them succeeded later.
  for (let attempt = 1; attempt <= 2 && !verdict; attempt += 1) {
    let status = 0;
    let body = null;
    try {
      const { url, init } = probeRequest(provider, key, model);
      const resp = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
      status = resp.status;
      body = await resp.json().catch(() => null);
    } catch (err) {
      if (attempt === 2) verdict = { kind: 'unreachable', detail: String(err?.message ?? err) };
      else await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    if (probeLooksAlive(provider, status, body)) verdict = { kind: 'alive', status };
    // A refused KEY (revoked, no balance: 401/402/403) says nothing about the
    // model ids — the assistant is down until a working key is pasted, and no
    // change to this repo fixes that, so it must not block a deploy.
    else if (M.isKeyRefusal(status)) verdict = { kind: 'key', status, detail: providerErrorSentence(body) };
    else if (probeIsRefusal(status)) verdict = { kind: 'dead', status, detail: providerErrorSentence(body) };
    else if (attempt === 2) verdict = { kind: 'busy', status, detail: providerErrorSentence(body) };
    // A 429 is a ROLLING MINUTE, not a moment: waiting two seconds for it is the
    // same as not waiting. A 503 clears far faster.
    else await new Promise((r) => setTimeout(r, status === 429 ? 30000 : 2000));
  }

  if (verdict.kind === 'alive') {
    console.log(`  ✅ ${model} answered (${verdict.status})`);
  } else if (verdict.kind === 'dead') {
    hard = 1;
    console.error(`  ❌ ${model} is REFUSED (${verdict.status}) — ${verdict.detail || 'no detail given'}`);
    console.error('     Change it in src/lib/aiProvider.ts. The provider names its replacement above.');
  } else if (verdict.kind === 'key') {
    couldNotLook += 1;
    console.error(`  ⏭  ${model} — the STORED KEY was refused (${verdict.status}) ${verdict.detail || ''}`);
    console.error('     The assistant is down until a working key (or a topped-up account) is saved under Payments & API keys. The model ids were not checked.');
  } else {
    couldNotLook += 1;
    console.error(`  ⏭  ${model} — could not tell (${verdict.status ?? 'no response'}) ${verdict.detail || ''}`);
  }
}

if (hard === 1) {
  // The two failures are different and the message must not conflate them: one
  // means the assistant is down, the other means a second copy of a model name
  // has appeared and WILL go stale. Saying the wrong one sends the reader to the
  // wrong file.
  console.error(
    strays.length
      ? '\n  A model id is written in server.ts. One file names the models, and it is src/lib/aiProvider.ts.\n'
      : '\n  A model this shop asks for will not run. The assistant, the translator and the analyser are all down.\n',
  );
  process.exit(1);
}
if (couldNotLook) {
  console.error(`\n  ${couldNotLook} model(s) could not be checked. This says NOTHING about whether they work.\n`);
  // --warn-if-unchecked is for `npm run verify`, which the DEPLOY runs: a model
  // that is provably dead must stop a deploy, but Google being briefly
  // unreachable must not — that would make the shop undeployable during an
  // outage, which is exactly when a deploy may be needed. The distinction is the
  // whole reason this script has three exit codes and not two.
  if (process.argv.includes('--warn-if-unchecked')) {
    console.error('  (--warn-if-unchecked: not failing the build on "could not look")\n');
    process.exit(0);
  }
  process.exit(2);
}
console.log('\n  Every model this shop asks for answered.\n');
process.exit(0);
