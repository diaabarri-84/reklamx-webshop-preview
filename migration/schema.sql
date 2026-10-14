-- ReklamX — MySQL / MariaDB schema replacing Firestore, Firebase Auth and the
-- Firebase Storage index. Version 2 (reviewed for import safety) — see PLAN.md.
--
-- Targets MySQL 8.0+ and MariaDB 10.6+.
--
-- ═══ THE RULE EVERY TABLE FOLLOWS ═══════════════════════════════════════════
--   id    the Firestore document id, byte-for-byte.
--   data  the WHOLE document, as JSON text, exactly as exported. It is the only
--         source of truth: the server reads `data` and nothing else.
--   other columns are INDEX COPIES of individual fields, filled by one function
--         (migration/tableMap.mjs) on every write and on import, used only to
--         find rows. A copy is NULL when the field is missing or has another
--         type — the same documents a Firestore `where` would skip.
--
-- Why it is built this way — each line is a way the import could have failed
-- or the shop could have behaved differently:
--   * LONGTEXT, not JSON, for `data`: stored verbatim. MySQL's JSON type
--     re-encodes numbers and rejects some escapes; MariaDB's JSON is LONGTEXT
--     anyway. We never query inside it.
--   * utf8mb4_bin everywhere: Firestore ids and `==` are exact. A case- or
--     accent-insensitive collation would make 'Skyltar'/'skyltar' or
--     'kläder'/'klader' collide on import, and sort strings differently.
--   * No ENUMs, no NOT NULL on copies, no UNIQUE on data fields: Firestore
--     enforced none of them, so live data may break any of them. Uniqueness
--     stays in the app code, exactly as today.
--   * No foreign keys on migrated data: Firestore has orphans (cost rows of
--     deleted products, ledgers of deleted users, credit notes of deleted
--     orders — which must be KEPT for the accounts). FKs only on the new
--     login tables, which the import fills itself.
--   * Times stay ISO strings: today's queries compare them as strings, so
--     string copies give exactly the same results.

SET NAMES utf8mb4;

-- ───────────────────────────── Accounts & logins ─────────────────────────────

-- One row per Firebase Auth account (anonymous accounts are not imported).
-- Separate from `users` (the profile documents): Firebase allows an account
-- with no profile and a profile with no account, and so must we.
CREATE TABLE auth_accounts (
  id                  VARCHAR(255) NOT NULL,        -- the Firebase uid
  login_email         VARCHAR(320) NULL,            -- lower-cased; unique like Firebase's
  email_verified      TINYINT(1) NOT NULL DEFAULT 0,
  disabled            TINYINT(1) NOT NULL DEFAULT 0, -- Firebase "disabled" — must still block login
  password_hash       VARCHAR(255) NULL,            -- ours (scrypt), written at first login / reset
  firebase_hash       VARCHAR(255) NULL,            -- imported Firebase hash, until replaced
  firebase_salt       VARCHAR(255) NULL,
  google_sub          VARCHAR(255) NULL,            -- Google account id ("Sign in with Google")
  created_at          VARCHAR(64) NULL,
  last_login_at       VARCHAR(64) NULL,
  data                LONGTEXT NOT NULL,            -- displayName, photoURL, providerData, customClaims as exported
  PRIMARY KEY (id),
  UNIQUE KEY uq_acc_email (login_email),
  UNIQUE KEY uq_acc_google (google_sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE sessions (
  token_hash    CHAR(64) NOT NULL,                  -- sha256 of the cookie value
  account_id    VARCHAR(255) NULL,                  -- NULL = guest session
  guest_id      VARCHAR(64) NULL,                   -- owner of a guest's uploads (replaces anonymous sign-in)
  created_at    DATETIME(3) NOT NULL,
  expires_at    DATETIME(3) NOT NULL,
  last_seen_at  DATETIME(3) NULL,
  user_agent    VARCHAR(255) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_sessions_account (account_id),
  KEY ix_sessions_expiry (expires_at),
  CONSTRAINT fk_sessions_account FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE auth_tokens (
  token_hash  CHAR(64) NOT NULL,
  account_id  VARCHAR(255) NOT NULL,
  purpose     VARCHAR(32) NOT NULL,                 -- password_reset | verify_email
  expires_at  DATETIME(3) NOT NULL,
  used_at     DATETIME(3) NULL,
  PRIMARY KEY (token_hash),
  KEY ix_tokens_account (account_id, purpose),
  CONSTRAINT fk_tokens_account FOREIGN KEY (account_id) REFERENCES auth_accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ─────────────────────── Firestore collections (1 row = 1 document) ──────────

CREATE TABLE users (                                -- users/{uid}
  id              VARCHAR(255) NOT NULL,
  data            LONGTEXT NOT NULL,
  role            VARCHAR(64) NULL,                 -- where role == 'admin'
  loyalty_points  DOUBLE NULL,                      -- where loyaltyPoints > 0
  PRIMARY KEY (id),
  KEY ix_users_role (role),
  KEY ix_users_points (loyalty_points)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE points_ledger (                        -- users/{uid}/pointsLedger/{id}
  user_id   VARCHAR(255) NOT NULL,
  id        VARCHAR(255) NOT NULL,
  data      LONGTEXT NOT NULL,
  date      VARCHAR(64) NULL,                       -- orderBy date
  order_id  VARCHAR(255) NULL,                      -- where orderId == .. and type == ..
  type      VARCHAR(64) NULL,
  PRIMARY KEY (user_id, id),
  KEY ix_ledger_date (user_id, date),
  KEY ix_ledger_order (user_id, order_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE customer_terms (                       -- customerTerms/{uid}
  id               VARCHAR(255) NOT NULL,
  data             LONGTEXT NOT NULL,
  pay_on_delivery  TINYINT(1) NULL,                 -- where payOnDelivery == true
  PRIMARY KEY (id),
  KEY ix_terms_pod (pay_on_delivery)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE categories (                           -- categories/{id}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE products (                             -- products/{id}
  id           VARCHAR(255) NOT NULL,
  data         LONGTEXT NOT NULL,
  slug         VARCHAR(255) NULL,                   -- where slug == ..  (NOT unique: duplicates may exist)
  category_id  VARCHAR(255) NULL,                   -- where categoryId == ..  (an id OR a name, as today)
  PRIMARY KEY (id),
  KEY ix_products_slug (slug),
  KEY ix_products_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE product_costs (                        -- productCosts/{productId}
  id        VARCHAR(255) NOT NULL,
  data      LONGTEXT NOT NULL,
  supplier  VARCHAR(255) NULL,                      -- where supplier == ..
  PRIMARY KEY (id),
  KEY ix_costs_supplier (supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE suppliers (                            -- suppliers/{slug}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE supplier_index (                       -- supplierIndex/{supplier}__{key}
  id        VARCHAR(255) NOT NULL,
  data      LONGTEXT NOT NULL,
  supplier  VARCHAR(255) NULL,                      -- where supplier == .. ; count()
  PRIMARY KEY (id),
  KEY ix_supidx_supplier (supplier)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE design_templates (                     -- designTemplates/{id}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE designs (                              -- designs/{id}
  id       VARCHAR(255) NOT NULL,
  data     LONGTEXT NOT NULL,
  user_id  VARCHAR(255) NULL,                       -- where userId == ..
  PRIMARY KEY (id),
  KEY ix_designs_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE settings (                             -- settings/{siteConfig|printSettings|legalPages|optionLibrary}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE orders (                               -- orders/{orderNumber}
  id                   VARCHAR(255) NOT NULL,
  data                 LONGTEXT NOT NULL,
  user_id              VARCHAR(255) NULL,           -- where userId == .. orderBy createdAt
  customer_account_id  VARCHAR(255) NULL,           -- where customerAccountId == ..
  created_at           VARCHAR(64) NULL,            -- orderBy createdAt; reports date range
  next_stage_at        VARCHAR(64) NULL,            -- auto-stage sweep: nextStageAt <= now
  shipment_open        TINYINT(1) NULL,             -- tracking sweep: shipmentOpen == true
  checkout_attempt_id  VARCHAR(255) NULL,           -- pay-on-delivery guard
  payment_mode         VARCHAR(64) NULL,            -- test-order cleanup script
  PRIMARY KEY (id),
  KEY ix_orders_user (user_id, created_at),
  KEY ix_orders_account (customer_account_id, created_at),
  KEY ix_orders_created (created_at, id),          -- feed paging: createdAt desc, then id
  KEY ix_orders_next_stage (next_stage_at),
  KEY ix_orders_shipment (shipment_open),
  KEY ix_orders_attempt (checkout_attempt_id),
  KEY ix_orders_mode (payment_mode)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE order_costs (                          -- orderCosts/{orderId}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE credit_notes (                         -- creditNotes/{K2026nnnnn}
  id                   VARCHAR(255) NOT NULL,
  data                 LONGTEXT NOT NULL,
  order_id             VARCHAR(255) NULL,
  user_id              VARCHAR(255) NULL,
  customer_account_id  VARCHAR(255) NULL,
  PRIMARY KEY (id),
  KEY ix_cn_order (order_id),
  KEY ix_cn_user (user_id),
  KEY ix_cn_account (customer_account_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE counters (                             -- counters/{orders-YYYY|credit-notes-YYYY}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE checkout_attempts (                    -- checkoutAttempts/{uid}_{attempt}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE abandoned_carts (                      -- abandonedCarts/{uid}
  id          VARCHAR(255) NOT NULL,
  data        LONGTEXT NOT NULL,
  updated_at  VARCHAR(64) NULL,                     -- where updatedAt < cutoff
  PRIMARY KEY (id),
  KEY ix_carts_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE coupons (                              -- coupons/{couponDocId(code)}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  code  VARCHAR(255) NULL,                          -- where code == ..  (NOT unique — the code checks limit 2)
  PRIMARY KEY (id),
  KEY ix_coupons_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE coupon_stats (                         -- couponStats/{id}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE coupon_audit (                         -- couponAudit/{autoId}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  at    VARCHAR(64) NULL,                           -- orderBy at desc
  PRIMARY KEY (id),
  KEY ix_caudit_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE coupon_redemptions (                   -- couponRedemptions/{order-<id> | CODE__uid}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE contact_inquiries (                    -- contact_inquiries/{autoId}
  id    VARCHAR(255) NOT NULL,
  data  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- secrets/integrations. The document is encrypted (AES-256-GCM, key in the
-- server environment), so a database dump alone does not reveal payment keys.
CREATE TABLE secrets (
  id          VARCHAR(255) NOT NULL,
  ciphertext  LONGTEXT NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Anything the import finds that is not mapped above — an unknown collection,
-- an unknown subcollection, the unused `templates` collection — lands here
-- verbatim instead of being lost. The import report lists every row.
CREATE TABLE legacy_documents (
  path_hash  CHAR(64) NOT NULL,                     -- sha256 of the full document path
  path       TEXT NOT NULL,                         -- e.g. templates/abc or orders/123/notes/x
  data       LONGTEXT NOT NULL,
  PRIMARY KEY (path_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- ─────────────────────────────── Stored files ────────────────────────────────
-- Replaces Firebase Storage. Files are saved on disk under a generated name
-- (`disk_name`), never the original one: Firebase object names can be up to
-- 1024 bytes with any characters, which a Linux file name cannot hold.
CREATE TABLE files (
  id                 BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  disk_name          VARCHAR(128) NOT NULL,         -- e.g. ab/cd/<random>.pdf, under the files root
  path               VARCHAR(1024) NOT NULL,        -- the logical path (same scheme as Firebase's)
  path_hash          CHAR(64) NOT NULL,             -- sha256(path) — unique; long paths cannot be indexed directly
  visibility         VARCHAR(16) NOT NULL,          -- public | private
  owner_id           VARCHAR(255) NULL,             -- account uid or guest id (no FK: guests, deleted users)
  content_type       VARCHAR(255) NULL,
  size_bytes         BIGINT UNSIGNED NOT NULL,
  created_at         VARCHAR(64) NULL,
  metadata           LONGTEXT NULL,                 -- Firebase custom metadata, verbatim (e.g. rehostedFrom)
  legacy_path_hash   CHAR(64) NULL,                 -- sha256 of the Firebase object path, to rewrite old URLs
  PRIMARY KEY (id),
  UNIQUE KEY uq_files_disk (disk_name),
  UNIQUE KEY uq_files_path (path_hash),
  UNIQUE KEY uq_files_legacy (legacy_path_hash),
  KEY ix_files_owner (owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
