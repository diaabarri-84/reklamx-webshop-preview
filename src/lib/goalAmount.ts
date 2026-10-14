/**
 * His goal as typed: "50000", "50 000", "50 000 kr", "100,000" or "1.000.000" — the
 * box used to read "100,000" as 100 kronor, and "1.000.000" as nothing at all, which
 * DELETED the goal. A tail of one or two digits (",50") is öre and is dropped; every
 * other point or comma groups thousands. Empty = no goal (0). null = not an amount.
 */
export function parseGoalAmount(raw: string): number | null {
  const s = raw.replace(/[\s\u00a0\u202f']/g, '').replace(/(kr|sek|:-)$/i, '');
  if (s === '') return 0;
  if (!/^\d[\d.,]*$/.test(s)) return null;
  const decimal = s.match(/^(.*?)[.,](\d{1,2})$/);
  const whole = (decimal ? decimal[1] : s).replace(/[.,]/g, '');
  return /^\d+$/.test(whole) ? Number(whole) : null;
}
