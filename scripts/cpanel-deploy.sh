#!/usr/bin/env bash
# Deploy the built front-end + server bundle to the client's cPanel host.
#
# SSH to this host authenticates and then silently executes nothing, so the
# whole deploy goes over the cPanel HTTPS API on :2083:
#   login -> security token -> Fileman upload -> a one-minute cron that
#   extracts and restarts Passenger -> remove the cron -> verify the hash.
#
# Needs the cPanel password. Put it in .env.deploy (gitignored) as
#   CPANEL_PASS='...'
# or export CPANEL_PASS before running. Everything else is fixed for this host.
#
#   bash scripts/cpanel-deploy.sh            # verify + build + deploy
#   bash scripts/cpanel-deploy.sh --no-build # deploy the dist/ already on disk
set -euo pipefail

CP_HOST="${CPANEL_HOST:-node102.hostx365.com}"
CP_PORT="${CPANEL_PORT:-2083}"
CP_USER="${CPANEL_USER:-shopreklam}"
REMOTE_HOME="/home/${CP_USER}"
APP_DIR="${REMOTE_HOME}/reklamx"          # Passenger app-root (Setup Node.js App)
SITE="${SITE_URL:-https://shop.reklamx.se}"

cd "$(dirname "$0")/.."
[ -f .env.deploy ] && . ./.env.deploy
: "${CPANEL_PASS:?set CPANEL_PASS in .env.deploy or the environment}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/jar"; TARBALL="$WORK/dist-update.tar.gz"

api() { curl -sk -b "$JAR" --max-time "${2:-60}" "https://${CP_HOST}:${CP_PORT}${TOK}$1"; }

if [ "${1:-}" != "--no-build" ]; then
  echo "▸ verify + build"
  npm run verify
fi
[ -d dist ] || { echo "no dist/ — run without --no-build"; exit 1; }
LOCAL_HASH="$(basename "$(ls dist/assets/index-*.js | head -1)")"
# The sourcemap does not travel. dist/server.cjs.map is 330 KB of this project's
# original TypeScript, it sat in the directory express.static serves, and it was
# downloadable from the live shop until 2026-09-01. server.ts now 404s that route
# as well, but the file has no business being on a public host at all: two locks,
# and the second one holds even if someone later changes the first.
# It stays in the local dist/ for reading a stack trace here.
# SEED_CACHE=1 also ships .cache/, the server's last-known-good copy of the
# catalogue and the categories.
#
# Normally the host's own .cache is FRESHER than anything here — the server
# rewrites it after every successful Firestore read — so shipping ours would
# replace good data with older data. It is opt-in for exactly one situation, the
# one on 2026-09-12: Firestore was refusing every read, the live server was still
# serving products from its five-minute memory cache, and a deploy would have
# restarted the process, thrown that copy away and found nothing on disk to fall
# back to. Turning "half the visitors see no categories" into "nobody sees
# anything" is a bad way to ship an improvement.
#
# Build it first with:  node scripts/seed-shop-cache.mjs .backups/<dir>
# The server overwrites both files the moment a real read succeeds.
if [ "${SEED_CACHE:-0}" = "1" ]; then
  if [ ! -f .cache/catalogue.json ] || [ ! -f .cache/categories.json ]; then
    echo "✗ SEED_CACHE=1 but .cache/ is not built — run scripts/seed-shop-cache.mjs first" >&2
    exit 1
  fi
  tar -czf "$TARBALL" --exclude='server.cjs.map' dist .cache
  echo "▸ bundle $LOCAL_HASH + seeded .cache ($(du -h "$TARBALL" | cut -f1))"
else
  tar -czf "$TARBALL" --exclude='server.cjs.map' dist
  echo "▸ bundle $LOCAL_HASH ($(du -h "$TARBALL" | cut -f1))"
fi

echo "▸ login"
TOK="$(curl -sk -c "$JAR" --max-time 30 \
  "https://${CP_HOST}:${CP_PORT}/login/?login_only=1" \
  --data-urlencode "user=${CP_USER}" --data-urlencode "pass=${CPANEL_PASS}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("security_token",""))')"
[ -n "$TOK" ] || { echo "login failed"; exit 1; }

echo "▸ upload"
curl -sk -b "$JAR" --max-time 300 \
  "https://${CP_HOST}:${CP_PORT}${TOK}/execute/Fileman/upload_files" \
  -F "dir=${REMOTE_HOME}" -F "file-1=@${TARBALL}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print("  ok" if d.get("status")==1 else d.get("errors"));sys.exit(0 if d.get("status")==1 else 1)'

echo "▸ arm the extract cron (self-guarded: runs once, the mv removes its own trigger)"
CP_HOST="$CP_HOST" CP_PORT="$CP_PORT" TOK="$TOK" JAR="$JAR" \
REMOTE_HOME="$REMOTE_HOME" APP_DIR="$APP_DIR" python3 - <<'PY'
import json, os, subprocess, urllib.parse
H, A = os.environ['REMOTE_HOME'], os.environ['APP_DIR']
def cpapi2(func, **kw):
    q = urllib.parse.urlencode({'cpanel_jsonapi_apiversion': '2',
                                'cpanel_jsonapi_module': 'Cron',
                                'cpanel_jsonapi_func': func, **kw})
    url = f"https://{os.environ['CP_HOST']}:{os.environ['CP_PORT']}{os.environ['TOK']}/json-api/cpanel?{q}"
    r = subprocess.run(['curl', '-sk', '-b', os.environ['JAR'], '--max-time', '40', url],
                       capture_output=True, text=True)
    return json.loads(r.stdout).get('cpanelresult', {})
cmd = (f"[ -f {H}/dist-update.tar.gz ] && mv {H}/dist-update.tar.gz {H}/du.tar.gz && "
       f"cd {A} && rm -rf dist && tar -xzf {H}/du.tar.gz && mkdir -p tmp && "
       f"touch tmp/restart.txt && rm -f {H}/du.tar.gz")
out = cpapi2('add_line', command=cmd, minute='*', hour='*', day='*', month='*', weekday='*')
print('  ok' if out.get('event', {}).get('result') == 1 else out.get('error'))
PY

echo "▸ waiting for the cron to fire (up to 3 min)"
# THIS LOOP USED TO ANNOUNCE SUCCESS WITHOUT CHECKING ANYTHING.
#
# REMOTE_HOME was never exported, so the inner python3 -c died with
# KeyError: 'REMOTE_HOME' on every pass, printed a traceback to the terminal, and
# left LEFT holding whatever the outer parse made of the resulting empty request —
# which came out "0". "0" is exactly the value that means "the tarball is gone,
# the extract worked", so the loop broke out and printed "extracted" roughly
# fifty seconds in, having verified nothing at all. A deploy where the cron never
# fired would have reported the same thing; only the hash check at the very end
# would have caught it, after the cron had already been disarmed.
#
# The path is interpolated by the shell now, and a request that fails to parse
# yields "?" rather than "0", so an unreadable answer keeps the loop waiting
# instead of ending it.
REMOTE_HOME_ENC="$(python3 -c "import urllib.parse;print(urllib.parse.quote('${REMOTE_HOME}'))")"
EXTRACTED=0
for i in $(seq 1 18); do
  sleep 10
  LEFT="$(api "/execute/Fileman/list_files?dir=${REMOTE_HOME_ENC}" 30 \
    | python3 -c 'import sys,json
try:
    d=json.load(sys.stdin)
    print(sum(1 for f in (d.get("data") or []) if "dist-update" in f.get("file","") or "du.tar.gz" in f.get("file","")) if d.get("status")==1 else "?")
except Exception:
    print("?")')"
  [ "$LEFT" = "0" ] && { echo "  extracted"; EXTRACTED=1; break; }
done
[ "$EXTRACTED" = "1" ] || echo "  ⚠ the tarball is still on the host after 3 min — the extract cron may not have run"

echo "▸ disarm the cron"
CP_HOST="$CP_HOST" CP_PORT="$CP_PORT" TOK="$TOK" JAR="$JAR" python3 - <<'PY'
import json, os, subprocess, urllib.parse
def cpapi2(func, **kw):
    q = urllib.parse.urlencode({'cpanel_jsonapi_apiversion': '2',
                                'cpanel_jsonapi_module': 'Cron',
                                'cpanel_jsonapi_func': func, **kw})
    url = f"https://{os.environ['CP_HOST']}:{os.environ['CP_PORT']}{os.environ['TOK']}/json-api/cpanel?{q}"
    r = subprocess.run(['curl', '-sk', '-b', os.environ['JAR'], '--max-time', '40', url],
                       capture_output=True, text=True)
    return json.loads(r.stdout).get('cpanelresult', {})
# DISARMING NEVER ONCE WORKED. Two independent bugs, both proved against the
# live host on 2026-09-01, and each one alone was enough to hide the other.
#
#   1. THE PARAMETER IS `linekey`, NOT `line`. Given `line=`, cPanel finds no
#      key, answers "Cron job not found in the crontab." and removes nothing.
#
#   2. SUCCESS IS data[0].status, NOT event.result. `event.result` is 1 whenever
#      the API call itself executed — including when the removal failed. The old
#      check read that field, so the script printed "removed" every time and was
#      wrong every time.
#
#   3. And the loop listed once, then deleted every match from that one snapshot.
#      cPanel re-indexes the crontab after each delete, so every linekey after
#      the first was stale anyway.
#
# The result: one extract cron survived every deploy and a new one was added on
# the next. A live check found SEVEN — five `dist-update.tar.gz` extractors plus
# a leftover payload.tar unpacker and a diag.cjs runner — each running
# `rm -rf dist && tar -xzf` EVERY MINUTE, two of them writing their output into
# public_html where anyone could read it.
#
# They are self-guarded, so they idle while no tarball is on the host. But the
# moment a deploy uploads one, all five race for it, an arbitrary one wins the
# mv, and the app directory is emptied and refilled by whichever that was.
STALE = ('dist-update.tar.gz',)

def removal_succeeded(res):
    """event.result only says the call ran. data[0].status says it worked."""
    return ((res.get('data') or [{}])[0]).get('status') == 1

removed = 0
for _ in range(25):
    rows = cpapi2('listcron').get('data', []) or []
    target = next((r for r in rows
                   if any(s in (r.get('command') or '') for s in STALE)
                   and r.get('linekey') is not None), None)
    if not target:
        break
    if removal_succeeded(cpapi2('remove_line', linekey=target['linekey'])):
        removed += 1
    else:
        print('  FAILED — remove it by hand in cPanel → Cron Jobs')
        break
else:
    print('  gave up after 25 removals — check cPanel → Cron Jobs by hand')
print(f'  removed {removed}')
left = [r for r in (cpapi2('listcron').get('data', []) or [])
        if any(s in (r.get('command') or '') for s in STALE)]
if left:
    print(f'  ⚠ {len(left)} extract cron(s) STILL armed — remove them in cPanel → Cron Jobs')
PY

echo "▸ verify"
# IT REPORTED A FAILED DEPLOY THAT HAD ACTUALLY SUCCEEDED — 2026-09-13.
#
# The old line was one pipeline:
#   LIVE="$(curl -s --max-time 30 "$SITE/" | grep -oE '...' | head -1 | xargs basename)"
# This host answers in 20-30 s on a good request and times out on roughly one in
# five. When curl came back empty, `grep` found nothing and exited 1 — and with
# `set -euo pipefail` at the top of this file, THE WHOLE SCRIPT DIED THERE, before
# the two echo lines below could print anything at all. The operator saw "▸ verify"
# and then "the deploy failed, the host still has the old code".
#
# It did not. The upload, the extract and the restart had all succeeded; three
# independent checks afterwards proved the new bundle and the new server were
# live. A false failure here is worse than no check: the next step a worried
# person takes is a rollback, which means another `rm -rf dist` and another
# restart on a host that is already struggling.
#
# So: retry, never let a timeout look like a wrong hash, and say which of the
# three things happened.
LIVE=""
for attempt in 1 2 3 4 5 6; do
  sleep 10
  # `|| true` on every stage: an empty answer must reach the comparison below as
  # an empty string, not as a dead script.
  PAGE="$(curl -s --max-time 45 "$SITE/?cb=$(date +%s)" || true)"
  LIVE="$(printf '%s' "$PAGE" | grep -oE 'assets/index-[A-Za-z0-9_-]+\.js' | head -1 | sed 's|.*/||' || true)"
  [ -n "$LIVE" ] && break
  echo "  (محاولة $attempt: السيرفر ما ردش — بيعيد)"
done

echo "  local $LOCAL_HASH"
echo "  live  ${LIVE:-<لا رد>}"

if [ -z "$LIVE" ]; then
  # NOT a failed deploy. An unanswered check.
  echo "⚠ the host did not answer in 6 tries — this says NOTHING about the deploy."
  echo "  The upload and the extract above either succeeded or they did not; look at THEM."
  echo "  To check by hand once it is breathing:"
  echo "    curl -s $SITE/ | grep -o 'index-[A-Za-z0-9_-]*\.js'"
  echo "  Expected: $LOCAL_HASH"
  exit 2
fi

if [ "$LIVE" = "$LOCAL_HASH" ]; then
  echo "✓ deployed"
else
  echo "✗ hashes differ — give Passenger a minute, then re-check"
  exit 1
fi
curl -s --max-time 45 "$SITE/api/health" || true; echo
