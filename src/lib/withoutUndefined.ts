/**
 * A value with every `undefined` taken out, at any depth — for a Firestore write.
 *
 * Firestore refuses an explicit undefined anywhere in a document ("Unsupported
 * field value"), and the option editors use undefined to mean "automatic" (an
 * outline or a display choice he set back), as clearing a size limit on a nested
 * question already did. The saves stripped only the top level, so one cleared
 * setting deep in a property made the whole screen unsaveable.
 *
 * Only plain objects and arrays are walked: Firestore's own values (a server
 * timestamp, a Timestamp) are passed through untouched.
 */
export function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.filter((v) => v !== undefined).map((v) => withoutUndefined(v)) as unknown as T;
  }
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) out[key] = withoutUndefined(v);
    }
    return out as T;
  }
  return value;
}
