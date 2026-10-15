# Moving ReklamX off Firebase

Goal: the shop at `shop.reklamx.se` runs entirely on the client's own cPanel —
MySQL for data, our own logins, files on disk — and behaves exactly as it does today.
Nothing here touches the live shop.

Files:
- [schema.sql](schema.sql) — the tables
- [tableMap.mjs](tableMap.mjs) — which collection goes to which table, and how each row is built. The shop and the import both use it.

## The rule every table follows (version 2, after review)

**Each Firestore document is stored whole, as text, in a `data` column, under its original ID.**
The server reads only `data`, so it gets back exactly the object Firestore gave it.
Extra columns are only *index copies* of the few fields the shop searches by (for example `orders.created_at` and `products.slug`). They are filled automatically and never read as the truth.

The first draft split documents into typed columns. The review found it would have failed or changed the shop in these ways, all fixed in version 2:

| Problem in draft 1 | What would have happened | Fix |
|---|---|---|
| Prices stored as `DECIMAL(12,2)` | Unit prices like 0.085 kr rounded to 0.09, so prices change | Whole document kept verbatim; copies are only for searching |
| Case- and accent-insensitive text | Category IDs `Skyltar`/`skyltar` or `kläder`/`klader` collide, and the import fails | Exact (binary) comparison everywhere, like Firestore |
| `UNIQUE` on slug, coupon code, email | Duplicates that already exist stop the import | Uniqueness checked in code, as today |
| Foreign keys | Orphans already exist (cost rows of deleted products, ledgers of deleted users, credit notes of deleted orders) and the import fails | No foreign keys on copied data. Credit notes must be kept for bookkeeping anyway. |
| `ENUM` and `NOT NULL` columns | One odd value such as role `"Admin"`, or a missing field, stops the import | Plain text columns that allow empty |
| `DATETIME` time columns | Bad or mixed date strings fail to convert. Today's queries compare dates **as strings**, so converting would change results. | Times kept as strings |
| MySQL `JSON` column type | Re-encodes numbers and rejects some characters | `LONGTEXT`: stored byte for byte |
| Accounts tied to profiles | Firebase allows a login with no profile, and a profile with no login | Separate `auth_accounts` table |
| Files saved under their original names | Firebase names can be 1024 characters with any symbols, which Linux file names can't hold | Files saved under generated names; the original path is kept in the table |
| Unknown collections | Anything not in the map would be lost | Kept in `legacy_documents` and listed in the report |

## Proven by test

There is an automated round-trip test against **MySQL 8.4 and MariaDB 10.6**, both in strict mode: **42/42 checks pass on each**. It checks that:

- every collection's document comes back **identical**, including prices like 0.085, 0.1+0.2, 1/3 and 1e21; Swedish, Arabic and emoji text; broken emoji halves; empty and dotted keys; deep option trees; and a 1 MiB document (Firestore's maximum);
- IDs that differ only by case or accent stay separate, and a lookup finds only the exact one;
- duplicates, orphans and unexpected values are accepted, as Firestore accepted them;
- search behaves like Firestore:
  - `shipmentOpen == true` doesn't match the string `"true"`;
  - the production-stage query skips missing and non-text values;
  - sort order equals Firestore's byte order;
- values that JSON would silently change are **refused and reported**, never stored differently: NaN, Infinity, unconverted Firestore Timestamps and Date objects.

The test is in the session scratchpad for now. It moves into `scripts/` when `mysql2` is added to the project.

## How the data layer must behave (step 3 contract)

These keep queries identical to Firestore:

- **`orderBy(field)` skips rows where the field is missing**, as Firestore does. MySQL wouldn't skip them by default.
- **Results with no `orderBy` are sorted by ID**, matching Firestore's default.
- **Feed paging sorts by the date, then the ID.**
- **Inside transactions, reads use `SELECT … FOR UPDATE`**, and a deadlock retries the transaction, as Firestore retries.
- **Merge writes:** an omitted key keeps its value; `null` stores null; delete-field removes the key. Dot paths such as `sideEffects.emailsSent` update nested keys.

## The export → import (step 5)

One re-runnable script, run against the test site as often as needed:

1. **Firestore:** walk every collection and **every subcollection**, then:
   - Mapped collections go into their tables.
   - Anything else goes to `legacy_documents`.
   - Firestore Timestamps become ISO strings, the format the code already uses, and each one is listed.
   - Documents that can't be stored exactly are listed, not guessed.
2. **Auth:**
   - Every non-anonymous account goes into `auth_accounts` with its email, verified flag, **disabled** flag, Google ID and password hash.
   - Anonymous accounts are skipped. Their uploads keep their owner ID.
3. **Storage:**
   - Download every object with its content type and custom metadata into the `files` table.
   - Then rewrite every `firebasestorage.googleapis.com` link inside the copied documents, matched by object path (download tokens differ, the path doesn't).
   - Missing files are listed.
4. **Report:** counts per collection, Firestore versus MySQL; every warning; every unmapped item. **The switch happens only when the report is clean.**

Changes that alter data are kept out of the copy and run afterwards as separate steps that can be undone: moving base64 images to files, and converting category names to IDs.

## Logins

- **If the project owner provides Firebase's password hash settings** (Firebase console → Authentication → ⋮ → *Password hash parameters*): customers keep their current password, which is checked once and re-saved in our format.
- **If not:** *gradual migration*. The password is checked once against Firebase at login, then saved. This only works while the Firebase project still exists.
- **Google sign-in** needs a new OAuth client in a Google project the client owns.
- Guests get a guest session instead of Firebase anonymous sign-in.

## Fixed along the way

- **No gaps in order and credit-note numbers.** The number and the record are saved in one transaction.
- **Two simultaneous refunds can no longer both issue a credit note.** The order row is locked.
- **Deleting a product removes its cost row**, done in code.
- **Staff can change only stage, dates, priority and assignee on orders.** This is an allow-list, replacing the old deny-list.
- **API keys in `secrets` are stored encrypted.**

## Open questions

1. Is the cPanel database **MySQL or MariaDB**, which version, and what is the **disk quota**? (Both engines are tested. `max_allowed_packet` must be at least 16 MB, which is MariaDB's default.)
2. Can we get the **password hash parameters**?
3. OK to **convert category names to IDs** as a separate step after the copy?

## Next steps

1. ✅ Schema and mapping ([src/lib/db/tableMap.ts](../src/lib/db/tableMap.ts)), tested on MySQL and MariaDB.
2. ✅ Data layer ([src/lib/db/docStore.ts](../src/lib/db/docStore.ts)) implementing the contract above. `npm run test:db` checks the Firestore behaviours, including 30 concurrent order numbers with no gaps, and passes on MySQL 8.4 and MariaDB 10.6. **Known difference:** a filter whose value is a different type from the indexed field (for example, a number against a text column) matches nothing. No query in the shop does that.
3. ✅ Logins and sessions ([src/lib/db/localAuth.ts](../src/lib/db/localAuth.ts)) and the file service ([src/lib/db/fileStore.ts](../src/lib/db/fileStore.ts)). Firebase password hashes are checked once and replaced; guest sessions replace anonymous sign-in; private files keep their download token, so old links keep working.
4. ✅ The switch: `DATA_BACKEND=mysql` ([src/lib/firebaseAdmin.ts](../src/lib/firebaseAdmin.ts)). The server gets the DocStore, the shop's own logins and the disk file store from the same three getters it always called; the browser's `firebase/*` imports are pointed at small stand-ins ([src/lib/local/](../src/lib/local/)) that call `/api/auth`, `/api/data` and `/api/files` ([src/lib/db/localRoutes.ts](../src/lib/db/localRoutes.ts)), where firestore.rules and storage.rules are enforced ([src/lib/db/accessRules.ts](../src/lib/db/accessRules.ts)). `npm run check:local-backend` typechecks the screens against the stand-ins. Unset, nothing changes.
   Checked end to end on MariaDB 10.6 (2026-10-14): storefront, admin sign-in and dashboard, customer sign-up under the rules (no self-promotion to admin), guest artwork upload with token-only access, password reset by e-mail (single use), and a pay-on-delivery order — number from the counter in one transaction, both e-mails, visible to the customer and first in the admin feed, staff may set priority but not the price. The production build carries no Firebase SDK.
   Not on this backend yet: Google sign-in (needs a Google OAuth client the shop owns).
5. ✅ Export/import script ([scripts/migrate/firestore-to-mysql.ts](../scripts/migrate/firestore-to-mysql.ts)): Storage, then every collection and subcollection, then Auth with password hashes; old Firebase file URLs rewritten; a report per collection. Dry-run on the local test data: clean. **The real data still needs the service-account key** (and the password hash parameters, for customers to keep their passwords).
6. Next: cPanel — a MySQL database and user, the schema, the data, the built app (`DATA_BACKEND=mysql npm run build`) as a Node.js app with `DATA_BACKEND`, `MYSQL_URL`, `DB_SECRETS_KEY`, `PUBLIC_URL`, `FILES_DIR` and the SMTP settings.

Local: `node scripts/local-mysql.mjs start` (MariaDB on 127.0.0.1:3307), copy the test data with `FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 MYSQL_URL=mysql://root@127.0.0.1:3307/reklamx npx tsx scripts/migrate/firestore-to-mysql.ts --reset`, then run the server with `DATA_BACKEND=mysql MYSQL_URL=…`.
