/**
 * The server's 409 `option_unavailable` — a basket still holding an option the
 * owner has since hidden (round 16, item 4) — as the shopper should read it:
 * "“Stjärna” finns inte längre för Formklistermärken", in his language, with the
 * option and the product named as the shop names them to him.
 *
 * The server sends the English words AND the owner's translations; this picks.
 * Shared by the checkout and the basket drawer, which both have to say it.
 */
import { localized } from './localizedText';
import type { Language } from './translations';

export function optionUnavailableMessage(data: unknown, language: Language, template: string): string | null {
  const body = data as { code?: unknown; detail?: Record<string, unknown> } | null;
  if (body?.code !== 'option_unavailable') return null;
  const d = body.detail ?? {};
  const option = localized(String(d.optionLabel ?? ''), (d.optionLabelI18n ?? null) as never, language);
  const product = localized(String(d.productName ?? ''), (d.productNameI18n ?? null) as never, language);
  return template.replace('{0}', option).replace('{1}', product);
}
