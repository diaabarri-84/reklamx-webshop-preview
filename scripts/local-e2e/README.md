# Local browser tests — the shop against the Firebase emulators

Every dashboard screen can be clicked through end to end here **without a single
read or write reaching the real Firebase project**, without an account in it,
and without a payment, an e-mail or a carrier booking.

```
scripts/local-e2e/start.sh .backups/firestore-YYYY-MM-DD   # copy, emulators, seed, shop on :3100
scripts/local-e2e/run-all.sh                               # every suite, by exit code
scripts/local-e2e/stop.sh
```

### On Windows, with a test catalogue (no backup needed)

```
node scripts/local-e2e/make-test-data.mjs     # writes test-data/: 14 products, 6 categories
node scripts/local-e2e/start-windows.mjs      # same copy, parachutes, seed and port 3100 as start.sh
node scripts/local-e2e/stop-windows.mjs
```

`start-windows.mjs` takes a backup folder as its argument too; without one it
seeds `test-data/`. It fetches a portable Java runtime into
`%LOCALAPPDATA%\reklamx-local\` once, if none is installed. The emulators run
in their own console window, and closing it stops them.

The test catalogue holds the six products `scripts/data/products-new-*.json`
defines, plus a beach flag, business cards, stickers, posters, a roll-up, an
area-priced PVC banner, flyers and roll labels. All are built from the option
catalogue, so the designer opens on every one of them except the roll labels,
which are upload-only on purpose.

## Why it cannot touch the live shop

- `start.sh` runs a **copy** made with `git archive`, so the repo's `.env` (payment,
  SMTP) and `service-account.json` (the database master key) are not in it. It
  refuses to start if either appears.
- The copy uses the demo project id **`demo-reklamx`** and a generated **dummy**
  service account. Firebase answers a `demo-` project only from local emulators.
- The browser is pointed at the emulators by `VITE_FIREBASE_EMULATOR=1`
  (src/firebase.ts), the server by `FIRESTORE_EMULATOR_HOST` & co. A production
  build never has these.
- `seed.cjs` and `lib.mjs` refuse to run unless Firestore is a local emulator.
- The two test accounts exist only in the emulator.

## What it needs

- Java 11+ for the Firestore emulator (`brew install openjdk`; start.sh finds
  Homebrew's even when it is not on PATH).
- A Firestore backup (`node scripts/backup-firestore.mjs` writes one to
  `.backups/`): `products.json`, `categories.json`, `settings.json`. Only those
  three are seeded — no orders, customers or secrets.
- Playwright's Chromium (already a dev dependency).

## The suites

| file | what a person does there |
|---|---|
| product-dialog | switches properties on, drags them, the quantity table, an option and a photo; saves; the shop shows his order |
| oneoff-price | a designer fee on 50 pieces is added once; the page and the server agree |
| checkout-delivery | a separate delivery address in Denmark; the order, the staff card and the packing slip say Denmark |
| library | drags a library property, edits a price in place, pushes ONE property to ONE product |
| shop-order | arranges categories and one category page; the shop and "Show more" follow; a finger drag on a phone |
| review-fixes | the review's findings, clicked: add-option ids, the safe default, bulk hide, reset/remove, nested drag, sub-category order |
| swedish | the one-off wording a Swedish customer reads |
| orders | the overview tiles and latest orders, the Orders tab (search, filters, the four sorts, one order's page), the production queue as staff |
| shipping | the owner edits prices and countries (a new country, one switched off, express for Sweden only, a dragged order, a typo refused); each country's checkout follows; the server refuses what the page never offers and a price changed behind the customer's back (409) |
| shapes | the owner shows "Shape" as picture cards and hides Star; a customer sees fifteen drawn shapes, Round clips the preview to a circle with its cut line, every outline stays inside the frame; the job sheet says "Cut: Round (circle)"; a basket that still has Star is refused by name |
| page-order | the owner drags the size calculator to the top, the delivery time above the quantity table and moves the artwork box with its arrow; the shop follows; the artwork box switched off and on comes back where he left it; a product never arranged keeps the old layout |
| suggestions | the owner picks three suggested products for one product (Enter in the search picks, never saves), drags one to the top; the shop shows his three then the next product in the category; "only my picks" and "off" from UI Customizer; a product with no picks gets its category neighbours; a hidden pick disappears; a clicked suggestion opens with its own breadcrumb |
| ai-provider | the owner chooses the AI service (DeepSeek warns about China before saving) and the save carries his choice — intercepted, no key leaves the machine; the server refuses a key it cannot place before asking anyone; the privacy policy names the company in use (none / DeepSeek, in English and Swedish) |
| rules-orders | no browser: signs in as the emulator's staff and admin and writes to orders — what the database rule lets through (priority, dates, stage — even on an order that predates netTotal) and what it refuses (money, payment mode, owner; anyone without "manage orders") |
| print | the invoice, receipt, job sheet and packing slip of a 1-, 5-, 15- and 30-line order, printed to real A4 PDFs: one page each, or — only where one page is measured impossible — normal-size type |
| designer | a customer designs a round sticker online (a layout, his words, the four fonts), checks the print file and orders it; a change of size takes the design off; A0 and an own shape are refused up front; the A3 file is sharp and under 16 MP; the same journey on a phone |
| design-templates | the owner makes a template in the dashboard (a name, a size, a cut, where it is offered) and locks its headline and logo, leaving one line's words to the customer; a customer in a sub-category is offered it first, cannot move what is locked, and orders it — the basket, the order and the job sheet name it; not offered at other proportions (an admin is told why), in another category, or while hidden; the basic layouts switched off; a copy, a drag, and deleting that keeps shared files |
| artwork-and-speed | a PDF/X with crop marks (an 85 × 55 card on a 105 × 75 page) is accepted by its TrimBox, previewed without its marks and placed by its TrimBox on the job sheet; reprint and studio-design lines are not "waiting for his file" (send-later still is); a paid Next day is dated on the product page, counted at checkout and promised on the order — the slowest line deciding |
| supplier-picker | "Browse a supplier": by category by default, then his choice (name in Swedish order, price, stock — remembered); a search of words in any order, without å/ä/ö, plurals, a number without its hyphen, a category word; what narrows the list is said and removable; products without a price counted, shown on request, never tickable (synthetic rows, emulator only) |

They run in that order: later suites build on what the first one configured. The
orders and print suites delete the orders they seed when they finish, so either
can be run again on its own.
Screenshots land in `$TMPDIR/reklamx-local-e2e-shots` (or `$SHOTS`).
