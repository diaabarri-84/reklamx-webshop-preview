import type { TranslationKey } from './translations';

/**
 * Zendr's shipment states, in words a customer understands.
 *
 * The API answers APPROVED / SHIPPED / IN_TRANSIT / DELIVERED / REJECTED /
 * CANCELLED. "APPROVED" in particular is not self-explanatory — it means the
 * shipment has been booked and is waiting to be collected.
 */
const KEYS: Record<string, TranslationKey> = {
  APPROVED: 'shipStatusApproved',
  SHIPPED: 'shipStatusShipped',
  IN_TRANSIT: 'shipStatusInTransit',
  DELIVERED: 'shipStatusDelivered',
  REJECTED: 'shipStatusRejected',
  CANCELLED: 'shipStatusCancelled',
};

export function shipmentStatusKey(status?: string | null): TranslationKey | null {
  return status ? KEYS[status] ?? null : null;
}

/** Delivered is the happy end; refused and cancelled are not. */
export function shipmentTone(status?: string | null): 'good' | 'bad' | 'neutral' {
  if (status === 'DELIVERED') return 'good';
  if (status === 'REJECTED' || status === 'CANCELLED') return 'bad';
  return 'neutral';
}
