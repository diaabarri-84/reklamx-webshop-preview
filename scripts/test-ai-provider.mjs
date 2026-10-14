#!/usr/bin/env node
// Any AI provider's key — src/lib/aiProvider.ts.
//
// WHY IT EXISTS. The owner promised his client he could bring the key of
// whichever AI service he liked. The code knew Google and nothing else.
//
// The sharp edge is the detection: `sk-ant-` starts with `sk-`, so a careless
// order sends every Anthropic key to OpenAI — and the customer, who never sees
// any of this, gets "the assistant is unavailable" for a key that is perfectly
// good. So detection only picks who to ASK FIRST; the provider that verifies is
// the one that gets stored.
//
// Usage:  node scripts/test-ai-provider.mjs

import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), 'reklamx-ai-'));
const out = join(outDir, 'aiProvider.mjs');
// The provider module, and the privacy text that names the provider in use.
const entry = join(outDir, 'entry.ts');
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(ROOT, 'src', 'lib', 'aiProvider.ts'))};`,
  `export { fillAiProvider, aiTransferSection } from ${JSON.stringify(join(ROOT, 'src', 'lib', 'legal.ts'))};`,
].join('\n'));
await build({
  entryPoints: [entry],
  outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'silent',
});
const M = await import(pathToFileURL(out).href);
rmSync(outDir, { recursive: true, force: true });
const {
  detectProvider, providerForKey, keyMismatchSentence, isKeyRefusal, fillAiProvider, aiTransferSection, verifyRequest, verifyLooksGood,
  chatRequest, extractText, friendlyAiError, supportsWebGrounding, AI_MODELS, AI_PROVIDER_NAMES,
  probeRequest, probeLooksAlive, probeIsRefusal, providerErrorSentence,
} = M;

let failed = 0;
const check = (name, actual, expected) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) console.log(`  ✅ ${name}`);
  else { failed += 1; console.error(`  ❌ ${name}\n       expected ${e}\n       actual   ${a}`); }
};
const ok = (name, cond) => check(name, Boolean(cond), true);

console.log('\ndetectProvider — and the order that decides it');
check('a Google key', detectProvider('AIzaSyD-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'google');
// GOOGLE HAS TWO SHAPES. AI Studio issues `AQ.` keys now, and this function knew
// only `AIza` — so the shop's own client pasted one on 2026-09-13 and it came
// back unrecognised.
check('a Google key in the NEW shape', detectProvider('AQ.xxxxxxxxxxxxxxxxxxxxxxxxxxxx'), 'google');
check('an OpenAI project key', detectProvider('sk-proj-abc123'), 'openai');
check('a bare OpenAI key', detectProvider('sk-abc123'), 'openai');
check('a service-account key', detectProvider('sk-svcacct-abc'), 'openai');
// THE ONE THAT MATTERS: sk-ant- begins with sk-.
check('an Anthropic key is NOT read as OpenAI', detectProvider('sk-ant-api03-abc'), 'anthropic');
check('an Anthropic OAuth key likewise', detectProvider('sk-ant-oat01-abc'), 'anthropic');
check('something unrecognised is null, not a guess', detectProvider('hello-there'), null);
check('and so are empty, null and undefined',
  [detectProvider(''), detectProvider(null), detectProvider(undefined)], [null, null, null]);
check('whitespace is trimmed, not rejected', detectProvider('  sk-ant-abc  '), 'anthropic');

console.log('\nwhich ONE provider a key is sent to — round 16');
// It used to be tried against EVERY provider, the guess first: a key was sent to
// up to three companies that had not issued it — and a DeepSeek key (sk-…) to
// OpenAI first of all. He names the provider now; the key goes there and nowhere else.
check('his choice decides where an sk- key goes — OpenAI or DeepSeek, the two that issue them',
  [providerForKey('deepseek', 'sk-0123'), providerForKey('openai', 'sk-0123')], [{ kind: 'ok', provider: 'deepseek' }, { kind: 'ok', provider: 'openai' }]);
// THE LEAK A REVIEW FOUND: "Google" still ticked from the key in use, a DeepSeek
// key pasted — and the key went to Google, in a URL. A key that is recognisably
// another company's goes NOWHERE.
check('a key that is another company\'s is refused before anything is sent — whatever is ticked', [
  providerForKey('google', 'sk-0123'), providerForKey('deepseek', 'AIzaSyX'), providerForKey('openai', 'sk-ant-api03-x'), providerForKey('anthropic', 'AQ.abc'),
], [{ kind: 'mismatch', looksLike: 'openai' }, { kind: 'mismatch', looksLike: 'google' }, { kind: 'mismatch', looksLike: 'anthropic' }, { kind: 'mismatch', looksLike: 'google' }]);
check('…and says so, naming both', keyMismatchSentence('google', 'openai'), 'That looks like an OpenAI or DeepSeek key (it starts with sk-), not a Google AI key. Nothing was sent anywhere — choose the service the key is from.');
check('a key of a shape nobody knows goes to the service he chose (formats change)', providerForKey('deepseek', 'ds-2026-xyz'), { kind: 'ok', provider: 'deepseek' });
check('no choice (a dashboard tab from before this release): only an unmistakable shape decides — an sk- key could be OpenAI\'s or DeepSeek\'s',
  [providerForKey(undefined, 'sk-ant-abc'), providerForKey('', 'AIza-x'), providerForKey(null, 'sk-abc')], [{ kind: 'ok', provider: 'anthropic' }, { kind: 'ok', provider: 'google' }, { kind: 'choose' }]);
check('no recognisable shape and no choice — or a "service" that is not one: nobody is asked',
  [providerForKey(undefined, 'mystery-key'), providerForKey('mistral', 'sk-abc')], [{ kind: 'choose' }, { kind: 'choose' }]);

console.log('\nverifyRequest — the cheapest proof, per provider');
check('Google puts the key in the query string',
  verifyRequest('google', 'K').url.includes('key=K'), true);
check('OpenAI uses a bearer token',
  verifyRequest('openai', 'K').init.headers.Authorization, 'Bearer K');
check('Anthropic uses x-api-key',
  verifyRequest('anthropic', 'K').init.headers['x-api-key'], 'K');
// Without it Anthropic refuses for a reason that looks nothing like a bad key.
check('and carries the version header it requires',
  verifyRequest('anthropic', 'K').init.headers['anthropic-version'], '2023-06-01');

console.log('\nverifyLooksGood — a 200 is not enough');
check('Google with models is good', verifyLooksGood('google', 200, { models: [{}] }), true);
check('OpenAI with data is good', verifyLooksGood('openai', 200, { data: [{}] }), true);
// A key that lists no models cannot answer a question either.
check('a 200 with an EMPTY list is refused', verifyLooksGood('google', 200, { models: [] }), false);
check('a 401 is refused', verifyLooksGood('openai', 401, { error: {} }), false);
check('and so is a body that is not what it should be',
  [verifyLooksGood('google', 200, null), verifyLooksGood('openai', 200, { data: 'nope' })], [false, false]);

console.log('\nchatRequest — three shapes, one call');
const REQ = {
  system: 'You are the shop assistant.',
  messages: [{ role: 'user', content: 'What GSM for a flyer?' }],
  tier: 'fast',
};
const g = chatRequest('google', 'K', REQ);
const o = chatRequest('openai', 'K', REQ);
const a = chatRequest('anthropic', 'K', REQ);

// NOT `g.url.includes(AI_MODELS.google.fast)`. That asserted the URL contains the
// very constant the URL was built from — it passes for 'banana-9000-turbo' and it
// passed for two models Google had retired. The shape is what this can check
// honestly; whether the id EXISTS is a question only the provider can answer, and
// scripts/check-ai-models.mjs asks it.
check('Google names a model in the path, not a query parameter',
  /\/v1beta\/models\/[^/:?]+:generateContent\?key=/.test(g.url), true);
check('and the fast tier and the complex tier are not the same model',
  AI_MODELS.google.fast !== AI_MODELS.google.complex, true);
check('OpenAI posts to chat/completions', o.url, 'https://api.openai.com/v1/chat/completions');
check('Anthropic posts to messages', a.url, 'https://api.anthropic.com/v1/messages');

// THE SYSTEM PROMPT GOES SOMEWHERE DIFFERENT IN ALL THREE.
check('Google puts it in systemInstruction',
  JSON.parse(g.init.body).systemInstruction.parts[0].text, REQ.system);
check('OpenAI puts it in a system TURN',
  JSON.parse(o.init.body).messages[0], { role: 'system', content: REQ.system });
check('Anthropic puts it at the top level, not as a turn',
  JSON.parse(a.init.body).system, REQ.system);
ok('and Anthropic has no system message among the turns',
  JSON.parse(a.init.body).messages.every((m) => m.role !== 'system'));

check('an assistant turn is called "model" at Google',
  JSON.parse(chatRequest('google', 'K', { ...REQ, messages: [{ role: 'assistant', content: 'hi' }] }).init.body)
    .contents[0].role, 'model');
check('and stays "assistant" at the other two',
  [JSON.parse(chatRequest('openai', 'K', { ...REQ, messages: [{ role: 'assistant', content: 'hi' }] }).init.body).messages[1].role,
   JSON.parse(chatRequest('anthropic', 'K', { ...REQ, messages: [{ role: 'assistant', content: 'hi' }] }).init.body).messages[0].role],
  ['assistant', 'assistant']);

console.log('\nthe complex tier asks for a better model');
check('Google', chatRequest('google', 'K', { ...REQ, tier: 'complex' }).url !== g.url, true);
check('OpenAI', JSON.parse(chatRequest('openai', 'K', { ...REQ, tier: 'complex' }).init.body).model, AI_MODELS.openai.complex);
check('Anthropic', JSON.parse(chatRequest('anthropic', 'K', { ...REQ, tier: 'complex' }).init.body).model, AI_MODELS.anthropic.complex);

console.log('\nJSON, for the translator and the product analyser');
check('Google asks by mime type',
  JSON.parse(chatRequest('google', 'K', { ...REQ, json: true }).init.body).generationConfig.responseMimeType,
  'application/json');
check('OpenAI asks by response_format',
  JSON.parse(chatRequest('openai', 'K', { ...REQ, json: true }).init.body).response_format,
  { type: 'json_object' });
// Anthropic has no JSON mode; the prompt asks for JSON and the caller parses it.
ok('Anthropic sends no JSON flag, because it has none',
  JSON.parse(chatRequest('anthropic', 'K', { ...REQ, json: true }).init.body).response_format === undefined);

console.log('\nimages, for the product analyser');
const PNG = 'data:image/png;base64,AAAA';
const withImg = { ...REQ, images: [PNG] };
check('Google attaches inlineData',
  JSON.parse(chatRequest('google', 'K', withImg).init.body).contents[0].parts[1].inlineData,
  { mimeType: 'image/png', data: 'AAAA' });
check('OpenAI attaches an image_url',
  JSON.parse(chatRequest('openai', 'K', withImg).init.body).messages[1].content[1].image_url.url, PNG);
check('Anthropic attaches a base64 source',
  JSON.parse(chatRequest('anthropic', 'K', withImg).init.body).messages[0].content[0].source,
  { type: 'base64', media_type: 'image/png', data: 'AAAA' });
// A string that is not a data URL is dropped rather than sent as one.
ok('a non-image string is dropped, not forwarded',
  JSON.parse(chatRequest('openai', 'K', { ...REQ, images: ['https://x/y.png'] }).init.body).messages[1].content === 'What GSM for a flyer?');

console.log('\nextractText — three shapes again');
check('Google', extractText('google', { candidates: [{ content: { parts: [{ text: 'hello' }] } }] }), 'hello');
check('OpenAI', extractText('openai', { choices: [{ message: { content: 'hello' } }] }), 'hello');
check('Anthropic', extractText('anthropic', { content: [{ type: 'text', text: 'hello' }] }), 'hello');
check('Anthropic ignores non-text blocks',
  extractText('anthropic', { content: [{ type: 'thinking' }, { type: 'text', text: 'hi' }] }), 'hi');
check('a missing or broken body is an empty string, never a throw',
  [extractText('google', null), extractText('openai', {}), extractText('anthropic', { content: 'nope' })],
  ['', '', '']);

console.log('\nwhat the CUSTOMER is told when it fails');
for (const status of [401, 403, 429, 500, 503]) {
  const msg = friendlyAiError(status);
  // The widget prints this into the conversation. It must never leak plumbing.
  ok(`${status} says nothing about keys or settings`,
    !/key|API|environment|variable|setting|token|401|403|500/i.test(msg) && msg.length > 20);
}
ok('and it always points somewhere useful',
  [401, 429, 500].every((s) => /contact page/i.test(friendlyAiError(s))));

console.log('\nthe probe — the only thing that proves a MODEL, not just a key');
check('Google probes the model it was given, by POST',
  [probeRequest('google', 'K', 'm-1').url.includes('/models/m-1:generateContent'),
   probeRequest('google', 'K', 'm-1').init.method],
  [true, 'POST']);
// A probe carrying a grounding tool would report a healthy model as dead: grounded
// search is refused on a free project while plain generation on the same model in
// the same second succeeds.
ok('and it carries NO tools',
  !JSON.stringify(JSON.parse(probeRequest('google', 'K', 'm-1').init.body)).includes('tool'));
check('OpenAI and Anthropic probe by model in the body',
  [JSON.parse(probeRequest('openai', 'K', 'm-2').init.body).model,
   JSON.parse(probeRequest('anthropic', 'K', 'm-3').init.body).model],
  ['m-2', 'm-3']);

// THE ONE THAT MATTERS. A thinking model spends its whole budget thinking and
// returns EMPTY text with finishReason MAX_TOKENS — that model is alive, and a
// probe judged on reply length would condemn it.
ok('an empty reply with a candidate is ALIVE, not dead',
  probeLooksAlive('google', 200, { candidates: [{ content: { parts: [] }, finishReason: 'MAX_TOKENS' }] }));
ok('a 200 with no candidate at all is not alive',
  !probeLooksAlive('google', 200, { candidates: [] }));
ok('and a 404 is never alive', !probeLooksAlive('google', 404, { error: {} }));

check('a retired model is a refusal', probeIsRefusal(404), true);
// Refusing a key on a 429 would red-light a good key at random: 7 of 23 probe
// calls on 2026-09-13 were transient 503s and every one succeeded later.
check('but busy and broken are NOT', [probeIsRefusal(429), probeIsRefusal(503)], [false, false]);
check('the provider gets to say why, trimmed',
  providerErrorSentence({ error: { message: 'no longer available to new users' } }),
  'no longer available to new users');
check('and a body with nothing to say is an empty string, never a throw',
  [providerErrorSentence(null), providerErrorSentence({}), providerErrorSentence({ error: { message: 7 } })],
  ['', '', '']);

console.log('\nDeepSeek — the fourth, round 16 (api-docs.deepseek.com, 2026-10-05)');
const dv = verifyRequest('deepseek', 'DK');
check('the key is proven by listing ITS models, at its own address, Bearer',
  [dv.url, dv.init.headers.Authorization], ['https://api.deepseek.com/models', 'Bearer DK']);
check('a listing with models is good; a 401 is not', [verifyLooksGood('deepseek', 200, { object: 'list', data: [{ id: 'deepseek-flash' }] }), verifyLooksGood('deepseek', 401, {})], [true, false]);
const dp = probeRequest('deepseek', 'DK', AI_MODELS.deepseek.fast);
const dpBody = JSON.parse(dp.init.body);
check('the probe asks deepseek-flash, tiny, with its default THINKING switched off',
  [dp.url, dpBody.model, dpBody.max_tokens, dpBody.thinking], ['https://api.deepseek.com/chat/completions', 'deepseek-flash', 16, { type: 'disabled' }]);
check('alive is a choice coming back, whatever its length', [probeLooksAlive('deepseek', 200, { choices: [{ message: { content: '' } }] }), probeLooksAlive('deepseek', 200, { choices: [] })], [true, false]);
const dc = JSON.parse(chatRequest('deepseek', 'DK', REQ).init.body);
check('a chat: OpenAI\'s shape, the system prompt as the first turn, thinking off, never OpenAI\'s address',
  [chatRequest('deepseek', 'DK', REQ).url, dc.messages[0].role, dc.thinking, dc.response_format],
  ['https://api.deepseek.com/chat/completions', 'system', { type: 'disabled' }, undefined]);
const dj = JSON.parse(chatRequest('deepseek', 'DK', { ...REQ, json: true }).init.body);
check('JSON: json_object, and the word "json" put in the prompt — DeepSeek refuses JSON mode without it',
  [dj.response_format, /json/.test(dj.messages[0].content)], [{ type: 'json_object' }, true]);
check('…but not added twice when the prompt already says it',
  JSON.parse(chatRequest('deepseek', 'DK', { ...REQ, system: 'Reply in json only.', json: true }).init.body).messages[0].content, 'Reply in json only.');
const di = JSON.parse(chatRequest('deepseek', 'DK', { ...REQ, images: [PNG] }).init.body);
check('a photo for the product analysis rides as an image_url data URL on the last user turn (deepseek-flash reads images)',
  di.messages[di.messages.length - 1].content[1].image_url.url, PNG);
check('its reply is read like OpenAI\'s', extractText('deepseek', { choices: [{ message: { content: ' hej ' } }] }), 'hej');
check('both tiers ask one model — the one that reads images', [AI_MODELS.deepseek.fast, AI_MODELS.deepseek.complex], ['deepseek-flash', 'deepseek-flash']);
check('an "sk-" key is still GUESSED as OpenAI — the owner now names the provider; the guess is only a fallback', detectProvider('sk-0123456789abcdef'), 'openai');

console.log('\nDeepSeek\'s own refusals, and pictures only');
check('402 (no balance) and 422 (invalid parameters) are refusals — stored over a 402, the chat lit up and failed every question',
  [probeIsRefusal(402), probeIsRefusal(422), probeIsRefusal(429), probeIsRefusal(503)], [true, true, false, false]);
check('a refused KEY (401/402/403) is told apart from a refused model (400/404/422) — the deploy gate must not blame the model ids',
  [isKeyRefusal(401), isKeyRefusal(402), isKeyRefusal(403), isKeyRefusal(404), isKeyRefusal(422)], [true, true, true, false, false]);
const mixed = JSON.parse(chatRequest('deepseek', 'DK', {
  ...REQ,
  messages: [{ role: 'user', content: 'look' }, { role: 'assistant', content: 'ok' }],
  images: [PNG, 'data:application/pdf;base64,AAAA', 'https://x/y.png?base64,AAAA'],
}).init.body);
check('only data:image pictures travel, and on the customer\'s own last turn — never on an assistant turn',
  [mixed.messages[1].content.length, mixed.messages[1].content[1].image_url.url, mixed.messages[2].content], [2, PNG, 'ok']);

console.log('\nthe privacy policy names the service in use');
const line = '{AI_PROVIDER} — the AI assistant, which receives the messages you type into the chat.';
check('Google in use: "Google"; none: "Our AI provider"', [fillAiProvider(line, { provider: 'google' }, 'en').slice(0, 9), fillAiProvider(line, null, 'en').slice(0, 15)], ['Google — ', 'Our AI provider']);
const scc = 'Where data is transferred outside the EU/EEA it is covered by the European Commission\'s standard contractual clauses.{AI_TRANSFER}';
check('DeepSeek, agreement NOT confirmed: China named, and the missing agreement shown as a [gap] — never claimed',
  /China\. \[The agreement that covers this transfer is not yet confirmed\]$/.test(fillAiProvider(scc, { provider: 'deepseek' }, 'en')), true);
check('DeepSeek, agreement confirmed by him: the agreement named', /under our data processing agreement with DeepSeek/.test(fillAiProvider(scc, { provider: 'deepseek', transferConfirmed: true }, 'en')), true);
check('…in Swedish, Danish and Norwegian too', ['sv', 'da', 'no'].map((l) => /Kina/.test(fillAiProvider('{AI_TRANSFER}', { provider: 'deepseek' }, l)) && /\[/.test(fillAiProvider('{AI_TRANSFER}', { provider: 'deepseek' }, l))), [true, true, true]);
check('nothing appended for the others', fillAiProvider(scc, { provider: 'openai' }, 'en').endsWith('clauses.'), true);
check('his own text without the tokens gets the DeepSeek section; with Google nothing is added',
  [aiTransferSection({ provider: 'deepseek' }, 'sv')?.heading, aiTransferSection({ provider: 'google' }, 'sv')], ['AI-assistenten', null]);

console.log('\nthe honest limit');
check('only Google can search the web',
  [supportsWebGrounding('google'), supportsWebGrounding('openai'), supportsWebGrounding('anthropic'), supportsWebGrounding('deepseek')],
  [true, false, false, false]);
check('and every provider has a name a person can read',
  Object.keys(AI_PROVIDER_NAMES).length, 4);

console.log(`\n${failed === 0 ? 'Any of the four keys works, and none of them leaks.' : `${failed} failing.`}`);
process.exit(failed === 0 ? 0 : 1);
