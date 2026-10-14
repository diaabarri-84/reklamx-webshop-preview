#!/bin/bash
# Start a LOCAL, SECRET-FREE copy of the shop against the Firebase emulators,
# seeded from a backup, for the browser suites in this folder.
#
#   scripts/local-e2e/start.sh .backups/firestore-2026-09-12
#   scripts/local-e2e/run-all.sh
#   scripts/local-e2e/stop.sh
#
# Why a COPY: the repo folder holds .env (the live Mollie key, SMTP) and
# service-account.json (a master key to the real database). The copy is made
# with `git archive`, which carries neither; it gets a DUMMY service account and
# the demo project id `demo-reklamx`, for which Firebase itself refuses every
# call that is not to a local emulator. Nothing this starts can read or write
# the client's data, send an e-mail or take a payment. See README.md.
set -euo pipefail

REPO="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="${LOCAL_E2E_DIR:-${TMPDIR:-/tmp}/reklamx-local-e2e}"
BACKUP="${1:?usage: start.sh <backup dir with products.json, categories.json, settings.json>}"
BACKUP="$(cd "$BACKUP" && pwd)"
PORT=3100

# The Firestore emulator needs Java 11+; Homebrew's is not on PATH by default.
if ! java -version >/dev/null 2>&1; then
  for j in /opt/homebrew/opt/openjdk /usr/local/opt/openjdk; do
    [ -x "$j/bin/java" ] && export JAVA_HOME="$j" && export PATH="$j/bin:$PATH" && break
  done
fi
java -version >/dev/null 2>&1 || { echo "✗ no Java runtime — install one (brew install openjdk)"; exit 1; }

mkdir -p "$WORK/app"
(cd "$REPO" && git archive HEAD) | tar -x -C "$WORK/app"
ln -sfn "$REPO/node_modules" "$WORK/app/node_modules"

cat > "$WORK/app/firebase-applet-config.json" <<'JSON'
{
  "projectId": "demo-reklamx",
  "appId": "1:000000000000:web:0000000000000000000000",
  "apiKey": "demo-api-key",
  "authDomain": "demo-reklamx.firebaseapp.com",
  "firestoreDatabaseId": "(default)",
  "storageBucket": "demo-reklamx.appspot.com",
  "messagingSenderId": "000000000000"
}
JSON
cat > "$WORK/app/firebase.json" <<'JSON'
{
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "storage": { "rules": "storage.rules" },
  "emulators": {
    "firestore": { "host": "127.0.0.1", "port": 8085 },
    "auth": { "host": "127.0.0.1", "port": 9099 },
    "storage": { "host": "127.0.0.1", "port": 9199 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
JSON
if [ ! -f "$WORK/app/service-account.json" ]; then
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$WORK/dummy-key.pem" 2>/dev/null
  node -e '
    const fs = require("fs");
    fs.writeFileSync(process.argv[2], JSON.stringify({
      type: "service_account", project_id: "demo-reklamx", private_key_id: "dummy",
      private_key: fs.readFileSync(process.argv[1], "utf8"),
      client_email: "emulator@demo-reklamx.iam.gserviceaccount.com", client_id: "0",
      token_uri: "http://127.0.0.1:9/token",
    }, null, 2));
  ' "$WORK/dummy-key.pem" "$WORK/app/service-account.json"
fi

# The parachutes: nothing real may be in the copy.
[ ! -e "$WORK/app/.env" ] || { echo "✗ a .env is in the test copy — refusing"; exit 3; }
grep -q '"project_id": "demo-reklamx"' "$WORK/app/service-account.json" || { echo "✗ service-account.json is not the dummy — refusing"; exit 3; }

# Background processes are started DETACHED — `nohup … < /dev/null &` plus
# disown, never `( … & )`: that form left a copy of this script holding the
# caller's pipe open, so `start.sh | tail` never returned.
if ! curl -s -m 3 -o /dev/null http://127.0.0.1:8085; then
  echo "▸ starting the Firebase emulators (first run downloads them)…"
  nohup bash -c 'cd "$1" && exec npx -y firebase-tools@15 emulators:start --only firestore,auth,storage --project demo-reklamx' \
    _ "$WORK/app" > "$WORK/emulators.log" 2>&1 < /dev/null &
  disown || true
  for _ in $(seq 1 300); do grep -q "All emulators ready" "$WORK/emulators.log" 2>/dev/null && break; sleep 1; done
  grep -q "All emulators ready" "$WORK/emulators.log" || { echo "✗ emulators did not start — see $WORK/emulators.log"; exit 1; }
fi

echo "▸ resetting and seeding the emulator from $BACKUP"
curl -s -m 10 -X DELETE "http://127.0.0.1:8085/emulator/v1/projects/demo-reklamx/databases/(default)/documents" >/dev/null
(cd "$WORK/app" && FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 GCLOUD_PROJECT=demo-reklamx \
  node "$REPO/scripts/local-e2e/seed.cjs" "$BACKUP")

# A mail server that KEEPS what it is sent (smtp-sink.mjs): the e-mails an order
# sends are read back from $MAIL_LOG by the suites. Nothing leaves this machine.
T="${TMPDIR:-/tmp}"; T="${T%/}"
MAIL_LOG="${MAIL_LOG:-$T/reklamx-local-e2e-mail.jsonl}"
lsof -ti tcp:2525 | xargs kill 2>/dev/null || true
: > "$MAIL_LOG"
nohup env SINK_LOG="$MAIL_LOG" node "$REPO/scripts/local-e2e/smtp-sink.mjs" > "$WORK/smtp-sink.log" 2>&1 < /dev/null &
disown || true

lsof -ti tcp:$PORT | xargs kill 2>/dev/null || true
echo "▸ starting the shop on http://127.0.0.1:$PORT"
nohup env PORT=$PORT FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099 \
  FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199 GCLOUD_PROJECT=demo-reklamx VITE_FIREBASE_EMULATOR=1 \
  SMTP_HOST=127.0.0.1 SMTP_PORT=2525 SMTP_USER=info@reklamx.test SMTP_PASSWORD=sink \
  SHOP_ORDER_INBOX=order@reklamx.test SHOP_CONTACT_INBOX=info@reklamx.test \
  bash -c 'cd "$1" && exec ./node_modules/.bin/tsx server.ts' _ "$WORK/app" > "$WORK/app-server.log" 2>&1 < /dev/null &
disown || true
healthy() { [ "$(curl -s -m 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:$PORT/api/health")" = "200" ]; }
for _ in $(seq 1 90); do healthy && break; sleep 1; done
healthy || { echo "✗ the shop did not start — see $WORK/app-server.log"; exit 1; }
echo "✓ ready — admin@emulator.test / emulator-admin-1 (emulator only), staff@emulator.test / emulator-staff-1"
