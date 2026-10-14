// The two names the basket is known by — and nothing else.
//
// Split out of cart.ts so that code which only needs to LISTEN for a basket
// change does not have to import the module that builds cart lines. That module
// reaches Product types and the option-field component, which reach the PDF
// worker; a listener that pulled all of that in could not be bundled on its own,
// and on the shop it would have dragged the PDF machinery into the entry chunk.
//
// cart.ts re-exports both, so every existing import keeps working.

export const CART_STORAGE_KEY = 'reklamx_cart';

/** Fired on this tab whenever the basket changes; `storage` covers other tabs. */
export const CART_CHANGED_EVENT = 'reklamx:cart';
