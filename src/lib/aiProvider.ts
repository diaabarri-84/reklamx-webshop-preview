// Any AI provider's key, pasted by the owner, working immediately.
//
// WHAT WAS PROMISED. The shop owner told his client he could bring the key of
// whichever AI service he liked and it would connect itself. The code knew
// Google and nothing else, so an OpenAI key would have been refused at the door.
//
// NO NEW PACKAGES, and this is not a preference. `npm run build` bundles the
// server with --packages=external and scripts/cpanel-deploy.sh ships only dist/;
// the host has no SSH and no way to run npm install, so a require() of a package
// that is not installed throws MODULE_NOT_FOUND in production. `@google/genai`
// is already a dependency; `openai` and `@anthropic-ai/sdk` are not and cannot
// become one. Every other provider is therefore called with plain fetch — the
// same reason the supplier XML parser is hand-written.
//
// THE OWNER NAMES THE SERVICE; THE KEY GOES THERE AND NOWHERE ELSE (round 16).
// A key used to be tried against every provider in turn, so it travelled to
// companies that had not issued it. Now he chooses the service, and a key whose
// shape is recognisably ANOTHER company's — Google's `AIza`/`AQ.`, Anthropic's
// `sk-ant-`, or an `sk-` key (OpenAI's AND DeepSeek's) with Google or
// Anthropic chosen — is refused before anything is sent (providerForKey). The
// service that accepted it is stored; from then on nothing is guessed.
//
// Pure. Every network call goes through an injected `fetch`, so the whole file is
// testable without one — see scripts/test-ai-provider.mjs.

export type AiProvider = 'google' | 'openai' | 'anthropic' | 'deepseek';

/** Every provider, in the order the dashboard offers them. */
export const AI_PROVIDERS: readonly AiProvider[] = ['google', 'openai', 'anthropic', 'deepseek'];

export function isAiProvider(v: unknown): v is AiProvider {
  return typeof v === 'string' && (AI_PROVIDERS as readonly string[]).includes(v);
}

export interface AiMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiRequest {
  system: string;
  messages: AiMessage[];
  /** 'fast' for ordinary questions, 'complex' when the answer needs more thought. */
  tier?: 'fast' | 'complex';
  /** Ask for a JSON object back. The translator and the product analyser need it. */
  json?: boolean;
  /** data: URLs. Dropped for a provider that cannot read them rather than failing. */
  images?: string[];
  maxTokens?: number;
}

/**
 * The models each provider is asked for.
 *
 * Named rather than discovered because a listing call before every question
 * doubles the latency the customer waits through. The name is changed here, in
 * ONE place — server.ts must not carry a second copy, and
 * scripts/check-ai-models.mjs fails the build if it starts to.
 *
 * ⚠️ A RETIRED MODEL IS NOT AN ERROR YOU WILL SEE. Google retires a model for
 * NEW projects first: on 2026-09-13 a freshly made key listed `gemini-2.5-flash`
 * among its 55 models and answered 404 when asked to generate with it —
 * "no longer available to new users". So the listing call that verifies a key
 * says nothing about whether these ids work, and the shop went on asking for a
 * model that had been gone for months. That is what check-ai-models.mjs probes
 * and what verifyAiKey now proves before it stores a key.
 *
 * These two were chosen by measuring them against this shop's own three jobs —
 * a Swedish chat answer, a sv/da/no JSON translation, and a product photo:
 *   fast    gemini-3.1-flash-lite  spends ZERO thinking tokens, so it cannot
 *           starve its own reply and hand a customer an empty bubble; answered
 *           every probe, returned strict-parsable JSON, read the image.
 *   complex gemini-3.5-flash       the better answer for the assistant's deeper
 *           mode — but see the warning below before relying on it.
 *
 * ⚠️ THE COMPLEX MODEL IS CAPPED AT 20 REQUESTS PER DAY on a free Google project.
 * Not per minute — per DAY, and Google says so itself:
 *     quotaId "GenerateRequestsPerDayPerProjectPerModel-FreeTier", quotaValue 20,
 *     model gemini-3.5-flash
 * Twenty customer questions and the deeper mode is gone until midnight Pacific.
 * So the tier is a PREFERENCE, not a requirement: a 429 on the complex model
 * falls back to the fast one and says so in the log, because an answer from the
 * smaller model is worth more to a shopper than a refusal from the larger one.
 * Billing on the project removes the cap; nothing in the code can.
 * Deliberately NOT chosen: `gemini-flash-latest` (an alias that has already moved
 * once — it served 3.8-flash under us), and any Pro id (`gemini-2.5-pro` 404s and
 * `gemini-pro-latest` answers 429 on a free-tier project).
 */
export const AI_MODELS: Record<AiProvider, { fast: string; complex: string }> = {
  google: { fast: 'gemini-3.1-flash-lite', complex: 'gemini-3.5-flash' },
  openai: { fast: 'gpt-4o-mini', complex: 'gpt-4o' },
  // The 3.5 ids this shop asked for are retired (Claude 3.5 Sonnet on
  // 2025-10-22); a pasted Anthropic key would have been refused by the probe.
  anthropic: { fast: 'claude-haiku-4-5-20251001', complex: 'claude-sonnet-5-5' },
  // ONE MODEL FOR BOTH TIERS. deepseek-flash (DeepSeek-V4.1-Flash, read off
  // api-docs.deepseek.com on 2026-10-05) reads images; deepseek-v4-pro does not,
  // and the product analysis sends photos. The old deepseek-chat /
  // deepseek-reasoner ids are no longer documented — check-ai-models.mjs probes
  // this one before every deploy.
  deepseek: { fast: 'deepseek-flash', complex: 'deepseek-flash' },
};

/**
 * The model that draws the designer's AI pictures (designer v2's AI Studio), per
 * provider; only Google's is wired. ⚠️ Google's image models need BILLING on the
 * owner's project — on a free one every call is refused — and they are not probed
 * by scripts/check-ai-models.mjs (a probe would spend money). The owner switches the
 * feature on in the dashboard once billing is on; a refusal turns it back off for
 * the customer ("not switched on"), never into a broken panel.
 */
export const AI_IMAGE_MODELS: Partial<Record<AiProvider, string>> = {
  google: 'imagen-4.0-fast-generate-001',
};

/** What each one is called where a person reads it. */
export const AI_PROVIDER_NAMES: Record<AiProvider, string> = {
  google: 'Google AI',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  deepseek: 'DeepSeek',
};

/** DeepSeek speaks OpenAI's protocol at its own address. */
const DEEPSEEK_BASE = 'https://api.deepseek.com';

/**
 * ONLY GOOGLE CAN SEARCH THE WEB.
 *
 * The chat asks for Google Search and Maps grounding so it can answer "where is
 * your nearest branch". There is no equivalent on the others through a bare HTTP
 * call, so the assistant still answers every printing question and simply cannot
 * look anything up. That is a real difference and the key panel says so out loud
 * — a capability discovered missing later is worse than one declared up front.
 */
export function supportsWebGrounding(provider: AiProvider): boolean {
  return provider === 'google';
}

/**
 * Which provider a key most likely belongs to — a guess, used only to choose
 * which one to ask first.
 *
 * ORDER MATTERS. `sk-ant-` begins with `sk-`, so Anthropic must be tested before
 * OpenAI or every Claude key is sent to the wrong company.
 */
export function detectProvider(rawKey: string): AiProvider | null {
  const key = String(rawKey ?? '').trim();
  if (!key) return null;
  if (key.startsWith('sk-ant-')) return 'anthropic';
  // Google issues two shapes. `AIza` is the old one; `AQ.` is what AI Studio
  // hands out now — the shop's own client pasted one on 2026-09-13 and this
  // function did not know it.
  if (key.startsWith('AIza') || key.startsWith('AQ.')) return 'google';
  if (key.startsWith('sk-')) return 'openai';
  return null;
}

/** Where a key may be sent — see providerForKey. (A string tag: this project compiles without strictNullChecks, which boolean tags need to narrow.) */
export type KeyChoice =
  | { kind: 'ok'; provider: AiProvider }
  /** No service chosen, and the key's shape does not settle it. */
  | { kind: 'choose' }
  /** The key is recognisably another company's: `looksLike` ('openai' = an sk- key, OpenAI's or DeepSeek's). */
  | { kind: 'mismatch'; looksLike: AiProvider };

/**
 * THE ONE PROVIDER a key is sent to — round 16.
 *
 * It used to be tried against every provider, the guess first, so a key went to
 * up to three companies that had not issued it. He names the service now — and
 * the choice alone is not enough: with "Google" still ticked from the key in
 * use, a pasted DeepSeek key would have gone to Google in a URL. A key whose
 * shape is another company's is refused here, before any request:
 *  - `AIza…`/`AQ.…` is Google's, `sk-ant-…` Anthropic's — only for that service;
 *  - `sk-…` is OpenAI's or DeepSeek's — only for one of those two;
 *  - a shape nobody knows goes to the service he chose (formats change).
 * Without a choice (a dashboard tab from before it existed) only an unmistakable
 * shape decides — an `sk-` key could be either of two companies, so it is asked
 * for a choice.
 */
export function providerForKey(chosen: unknown, rawKey: string): KeyChoice {
  const shape = detectProvider(rawKey);
  if (chosen === undefined || chosen === null || chosen === '') {
    return shape === 'google' || shape === 'anthropic' ? { kind: 'ok', provider: shape } : { kind: 'choose' };
  }
  if (!isAiProvider(chosen)) return { kind: 'choose' };
  if (shape === 'google' || shape === 'anthropic') {
    return shape === chosen ? { kind: 'ok', provider: chosen } : { kind: 'mismatch', looksLike: shape };
  }
  if (shape === 'openai') {
    return chosen === 'openai' || chosen === 'deepseek' ? { kind: 'ok', provider: chosen } : { kind: 'mismatch', looksLike: 'openai' };
  }
  return { kind: 'ok', provider: chosen };
}

/** What the dashboard says when a key is another company's — in English, like the rest of it. */
export function keyMismatchSentence(chosen: AiProvider, looksLike: AiProvider): string {
  const what = looksLike === 'openai' ? 'an OpenAI or DeepSeek key (it starts with sk-)' : `a ${AI_PROVIDER_NAMES[looksLike]} key`;
  return `That looks like ${what}, not a ${AI_PROVIDER_NAMES[chosen]} key. Nothing was sent anywhere — choose the service the key is from.`;
}

/** The cheapest call that proves a key: list the models. */
export function verifyRequest(provider: AiProvider, key: string): { url: string; init: RequestInit } {
  if (provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`,
      init: { method: 'GET' },
    };
  }
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/models',
      init: { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
    };
  }
  if (provider === 'deepseek') {
    return {
      url: `${DEEPSEEK_BASE}/models`,
      init: { method: 'GET', headers: { Authorization: `Bearer ${key}` } },
    };
  }
  return {
    url: 'https://api.anthropic.com/v1/models',
    init: {
      method: 'GET',
      headers: {
        'x-api-key': key,
        // Required by Anthropic on every call. Without it the request is refused
        // for a reason that looks nothing like "your key is wrong".
        'anthropic-version': '2023-06-01',
      },
    },
  };
}

/**
 * Did the listing prove the KEY? A 200 with no models is a key that cannot answer.
 *
 * ⚠️ It does NOT prove the MODEL. Google lists models it will then refuse to run
 * for a new project, so this answering 200 while the assistant is dead is a real
 * measured state, not a hypothetical — see the warning on AI_MODELS. Pair it with
 * probeRequest().
 */
export function verifyLooksGood(provider: AiProvider, status: number, body: any): boolean {
  if (status !== 200) return false;
  const list = provider === 'google' ? body?.models : body?.data;
  return Array.isArray(list) && list.length > 0;
}

/**
 * The smallest call that proves a MODEL will actually run for this key.
 *
 * NO TOOLS, deliberately. Grounded search is refused on a free Google project
 * while plain generation on the same model in the same second succeeds, so a
 * probe carrying tools would report a perfectly healthy model as dead.
 */
export function probeRequest(provider: AiProvider, key: string, model: string): { url: string; init: RequestInit } {
  if (provider === 'google') {
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'ping' }] }],
          generationConfig: { maxOutputTokens: 512 },
        }),
      },
    };
  }
  if (provider === 'openai') {
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }),
      },
    };
  }
  if (provider === 'deepseek') {
    return {
      url: `${DEEPSEEK_BASE}/chat/completions`,
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        // Thinking is ON by default there; this proves the model answers, nothing more.
        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16, thinking: { type: 'disabled' } }),
      },
    };
  }
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 16 }),
    },
  };
}

/**
 * Did the model answer?
 *
 * ⚠️ JUDGED ON THE SHAPE, NOT ON THE TEXT. A thinking model given a small budget
 * spends it all thinking and returns an empty string with finishReason
 * MAX_TOKENS — that model is ALIVE, and a probe that measured reply length would
 * condemn it. What proves life is that the provider produced a candidate at all.
 */
export function probeLooksAlive(provider: AiProvider, status: number, body: any): boolean {
  if (status !== 200) return false;
  if (provider === 'google') return Boolean(body?.candidates?.[0]);
  if (provider === 'openai' || provider === 'deepseek') return Boolean(body?.choices?.[0]);
  return Array.isArray(body?.content);
}

/**
 * Is this a definite NO, as opposed to "ask again later"?
 *
 * The difference decides whether a key is refused or stored with a warning. A
 * 429 or a 503 must never refuse a key: 7 of 23 probe calls to Google on
 * 2026-09-13 came back 503 "experiencing high demand" and every one of them
 * succeeded on a later try. Red-lighting a good key at random is its own defect.
 */
export function probeIsRefusal(status: number): boolean {
  // 402 and 422 are DeepSeek's (api-docs.deepseek.com/quick_start/error_codes):
  // "Insufficient Balance" and "Invalid Parameters". Neither improves by waiting
  // — a key stored over a 402 lit the chat up on every page and failed every
  // customer's question.
  return status === 400 || status === 401 || status === 402 || status === 403 || status === 404 || status === 422;
}

/** A refusal that is about the KEY or its account, not about a model or a request. */
export function isKeyRefusal(status: number): boolean {
  return status === 401 || status === 402 || status === 403;
}

/** What the provider said, trimmed to something an ADMIN can act on. Never shown to a customer. */
export function providerErrorSentence(body: any): string {
  const msg = body?.error?.message ?? body?.error?.[0]?.message ?? '';
  return typeof msg === 'string' ? msg.slice(0, 300) : '';
}

/**
 * Build one chat request for whichever provider this is.
 *
 * The three shapes differ in every part: where the system prompt goes, what a
 * turn is called, how an image is attached, and how JSON is asked for.
 */
export function chatRequest(
  provider: AiProvider,
  key: string,
  req: AiRequest,
): { url: string; init: RequestInit } {
  const model = AI_MODELS[provider][req.tier === 'complex' ? 'complex' : 'fast'];
  const maxTokens = Math.min(8192, Math.max(256, req.maxTokens ?? 2048));
  // PICTURES ONLY, as data URLs — not any string that happens to contain
  // "base64," (a PDF, an https address). The Google and Anthropic shapes
  // re-checked; the OpenAI/DeepSeek one passed whatever came.
  const images = (req.images ?? []).filter((i) => typeof i === 'string' && /^data:image\/[a-zA-Z0-9.+-]+;base64,/.test(i));
  // …and they ride with the customer's own LAST turn: DeepSeek refuses an image
  // on any other role.
  const lastUser = req.messages.map((m) => m.role).lastIndexOf('user');

  if (provider === 'google') {
    const parts: any[] = [];
    for (const img of images) {
      const m = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
      if (m) parts.push({ inlineData: { mimeType: m[1], data: m[2] } });
    }
    const contents = req.messages.map((msg, i) => ({
      role: msg.role === 'assistant' ? 'model' : 'user',
      // Pictures ride with the LAST user turn, which is the one they belong to.
      parts: i === req.messages.length - 1 && parts.length
        ? [{ text: msg.content || '' }, ...parts]
        : [{ text: msg.content || '' }],
    }));
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`,
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: req.system }] },
          generationConfig: {
            maxOutputTokens: maxTokens,
            ...(req.json ? { responseMimeType: 'application/json' } : {}),
          },
        }),
      },
    };
  }

  // OpenAI's shape — and DeepSeek's, which speaks the same protocol at its own
  // address (images as image_url data URLs, on the last user turn).
  if (provider === 'openai' || provider === 'deepseek') {
    // DeepSeek's JSON mode refuses a prompt that never says "json".
    const system = provider === 'deepseek' && req.json && !/json/.test(req.system) ? `${req.system}\nAnswer in json.` : req.system;
    const messages: any[] = [
      { role: 'system', content: system },
      ...req.messages.map((msg, i) => {
        if (i === lastUser && images.length) {
          return {
            role: msg.role,
            content: [
              { type: 'text', text: msg.content || '' },
              ...images.map((url) => ({ type: 'image_url', image_url: { url } })),
            ],
          };
        }
        return { role: msg.role, content: msg.content || '' };
      }),
    ];
    return {
      url: provider === 'deepseek' ? `${DEEPSEEK_BASE}/chat/completions` : 'https://api.openai.com/v1/chat/completions',
      init: {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          ...(req.json ? { response_format: { type: 'json_object' } } : {}),
          // Thinking is ON by default at DeepSeek: a customer would wait for the
          // thoughts, and they would eat the answer's token budget.
          ...(provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
        }),
      },
    };
  }

  // Anthropic: the system prompt is its own top-level field, not a turn.
  const messages = req.messages.map((msg, i) => {
    if (i === lastUser && images.length) {
      const blocks: any[] = [];
      for (const img of images) {
        const m = img.match(/^data:(image\/[a-zA-Z+]+);base64,(.+)$/);
        if (m) blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      }
      return { role: msg.role, content: [...blocks, { type: 'text', text: msg.content || '' }] };
    }
    return { role: msg.role, content: msg.content || '' };
  });
  return {
    url: 'https://api.anthropic.com/v1/messages',
    init: {
      method: 'POST',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        system: req.system,
        messages,
        max_tokens: maxTokens,
      }),
    },
  };
}

/** Pull the reply text out of whichever shape came back. */
export function extractText(provider: AiProvider, body: any): string {
  try {
    if (provider === 'google') {
      const parts = body?.candidates?.[0]?.content?.parts;
      if (Array.isArray(parts)) return parts.map((p: any) => String(p?.text ?? '')).join('').trim();
      return '';
    }
    if (provider === 'openai' || provider === 'deepseek') {
      return String(body?.choices?.[0]?.message?.content ?? '').trim();
    }
    const blocks = body?.content;
    if (Array.isArray(blocks)) {
      return blocks.filter((b: any) => b?.type === 'text').map((b: any) => String(b?.text ?? '')).join('').trim();
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * What a CUSTOMER may be told when the model will not answer.
 *
 * The chat widget prints this straight into the conversation, so it must never
 * name a provider's internals, a key, an environment variable or a settings
 * screen the customer has never heard of. The detail goes to the server log,
 * where the owner can find it.
 */
export function friendlyAiError(status: number): string {
  if (status === 401 || status === 403) {
    return 'The assistant is unavailable right now. Please use the contact page and we will answer you directly.';
  }
  if (status === 429) {
    return 'The assistant is busy at the moment. Please try again in a minute, or use the contact page.';
  }
  return 'The assistant could not answer just now. Please use the contact page and we will answer you directly.';
}
