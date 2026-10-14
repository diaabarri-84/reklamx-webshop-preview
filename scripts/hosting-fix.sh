#!/usr/bin/env bash
# Apply the two host-side mitigations for the shop.reklamx.se 502s, and be able
# to take them back off in one command.
#
# WHY THIS EXISTS. The shop runs under Phusion Passenger on a shared cPanel node.
# Passenger reaps the Node process after ~5 minutes of no traffic, and a fresh
# spawn on this host costs 11.5-29 seconds (the identical bundle boots in 1.8s on
# a laptop). When the spawn overruns nginx's patience the customer gets a 502.
# Separately, the account's own nginx log shows 25 of 28 502s inside ONE 2.6-hour
# window on 2026-09-03 that coincides with a WordPress-scanner flood — 5,859 404s
# in six days, every one of them woken up and handled by Node.
#
# So there are two changes here, one per mechanism:
#   1. the keep-warm cron moves from */5 to */2, and starts logging
#   2. scanner paths are refused by Apache before Passenger is ever invoked
#
# NEITHER IS A CURE. They make the 502s rare; only a host that never reaps the
# process, on a pool not shared with strangers, makes them stop. The support
# ticket in HOSTING-502.md is the durable half of the work.
#
#   bash scripts/hosting-fix.sh            # apply, verify, auto-roll-back on failure
#   bash scripts/hosting-fix.sh --revert   # put both back exactly as they were
#   bash scripts/hosting-fix.sh --status   # read-only: show what is live now
#
# Needs the cPanel password in .env.deploy as CPANEL_PASS, same as the deploy script.
set -euo pipefail

CP_HOST="${CPANEL_HOST:-node102.hostx365.com}"
CP_PORT="${CPANEL_PORT:-2083}"
CP_USER="${CPANEL_USER:-shopreklam}"
DOCROOT="/home/${CP_USER}/public_html"
SITE="${SITE_URL:-https://shop.reklamx.se}"

# The keep-warm row's stable id, read off the live crontab on 2026-09-07. The
# OTHER row (*/15, auto-stages) must never be touched: it is what advances
# customer orders, and it fails silently if it goes missing.
KEEPWARM_LINEKEY="${KEEPWARM_LINEKEY:-1847005687}"
OLD_CMD='curl -s https://shop.reklamx.se/api/health > /dev/null 2>&1'
# In a crontab an unescaped % is a newline: it would truncate the command at the
# first one and hand the rest to curl as stdin. cPanel wants them written \%.
# -m 100, not -m 30: the ping's whole job is to absorb a cold start, and a 30s
# cap would abort during the very 29s spawn it exists to pay for. 100s still
# finishes inside the 120s interval, so runs cannot stack up.
NEW_CMD="curl -sS -m 100 -o /dev/null -w \"\\%{http_code} \\%{time_total}\\n\" ${SITE}/api/health >> /home/${CP_USER}/keepwarm.log 2>&1"

MARK_BEGIN='# BEGIN reklamx scanner block (scripts/hosting-fix.sh)'
MARK_END='# END reklamx scanner block (scripts/hosting-fix.sh)'

cd "$(dirname "$0")/.."
[ -f .env.deploy ] && . ./.env.deploy
: "${CPANEL_PASS:?set CPANEL_PASS in .env.deploy}"

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT
JAR="$WORK/jar"
BACKUP_DIR="deploy/htaccess-backups"; mkdir -p "$BACKUP_DIR"

# The block is written to a file rather than a shell variable so the regex
# backslashes reach Apache exactly as typed.
cat > "$WORK/block" <<'HTA'

# BEGIN reklamx scanner block (scripts/hosting-fix.sh)
# Refuse the WordPress/exploit scanner paths in Apache, so Passenger is never
# woken for them. The shop is a React SPA served by Node; none of these can
# collide with a real route. Deliberately placed AFTER the CloudLinux blocks —
# inside them, cPanel's Node.js Selector rewrites the file and the rules vanish.
<IfModule mod_rewrite.c>
  RewriteEngine On
  RewriteRule ^(wp-login\.php|xmlrpc\.php|wp-admin|wp-includes|wp-content|wp-json) - [F,L]
  RewriteRule ^(rest/api|\.env|\.git|vendor/phpunit) - [F,L]
</IfModule>
# END reklamx scanner block (scripts/hosting-fix.sh)
HTA

TOK="$(curl -sk -c "$JAR" --max-time 30 \
  "https://${CP_HOST}:${CP_PORT}/login/?login_only=1" \
  --data-urlencode "user=${CP_USER}" --data-urlencode "pass=${CPANEL_PASS}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("security_token",""))')"
[ -n "$TOK" ] || { echo "login failed"; exit 1; }

read_htaccess() {
  curl -sk -b "$JAR" --max-time 60 -G "https://${CP_HOST}:${CP_PORT}${TOK}/execute/Fileman/get_file_content" \
    --data-urlencode "dir=${DOCROOT}" --data-urlencode "file=.htaccess" \
    | python3 -c 'import sys,json
d=json.load(sys.stdin)
if d.get("status")!=1: sys.exit(1)
sys.stdout.write((d.get("data") or {}).get("content",""))'
}

write_htaccess() {  # $1 = file holding the new content
  curl -sk -b "$JAR" --max-time 60 -X POST \
    "https://${CP_HOST}:${CP_PORT}${TOK}/execute/Fileman/save_file_content" \
    --data-urlencode "dir=${DOCROOT}" --data-urlencode "file=.htaccess" \
    --data-urlencode "content@$1" \
    | python3 -c 'import sys,json
d=json.load(sys.stdin)
print("  htaccess:", "ok" if d.get("status")==1 else d.get("errors"))
sys.exit(0 if d.get("status")==1 else 1)'
}

set_cron() {  # $1 = minute spec, $2 = command
  curl -sk -b "$JAR" --max-time 40 -G "https://${CP_HOST}:${CP_PORT}${TOK}/json-api/cpanel" \
    --data-urlencode "cpanel_jsonapi_apiversion=2" \
    --data-urlencode "cpanel_jsonapi_module=Cron" \
    --data-urlencode "cpanel_jsonapi_func=edit_line" \
    --data-urlencode "linekey=${KEEPWARM_LINEKEY}" \
    --data-urlencode "minute=$1" --data-urlencode "hour=*" \
    --data-urlencode "day=*" --data-urlencode "month=*" --data-urlencode "weekday=*" \
    --data-urlencode "command=$2" \
    | python3 -c 'import sys,json
d=json.load(sys.stdin).get("cpanelresult",{})
e=d.get("event") or {}
print("  cron:", "ok" if e.get("result")==1 else json.dumps(d)[:300])'
}

show_cron() {
  curl -sk -b "$JAR" --max-time 40 -G "https://${CP_HOST}:${CP_PORT}${TOK}/json-api/cpanel" \
    --data-urlencode "cpanel_jsonapi_apiversion=2" \
    --data-urlencode "cpanel_jsonapi_module=Cron" \
    --data-urlencode "cpanel_jsonapi_func=listcron" \
    | python3 -c '
import sys,json
for r in (json.load(sys.stdin).get("cpanelresult",{}).get("data") or []):
    if "command" not in r: continue
    print("    %-6s %s" % (r.get("minute"), r.get("command")[:110]))'
}

# A 500 here means Apache refused something we added and the WHOLE shop is down,
# so this runs after every .htaccess write and a failure rolls back unprompted.
site_code() { curl -s -o /dev/null -w '%{http_code}' -m 60 "$SITE/" || true; }

case "${1:-}" in
  --status)
    echo "▸ cron:"; show_cron
    if read_htaccess | grep -qF "$MARK_BEGIN"; then S=present; else S=absent; fi
    echo "▸ .htaccess scanner block: $S"
    echo "▸ site: HTTP $(site_code)"
    exit 0;;
  --revert)
    echo "▸ cron back to */5"; set_cron '*/5' "$OLD_CMD"
    read_htaccess > "$WORK/cur"
    python3 - "$WORK/cur" "$WORK/new" "$MARK_BEGIN" "$MARK_END" <<'PY'
import sys
src, dst, b, e = sys.argv[1:5]
t = open(src).read()
if b in t and e in t:
    t = t[:t.index(b)] + t[t.index(e) + len(e):]
    t = t.rstrip("\n") + "\n"
open(dst, "w").write(t)
PY
    write_htaccess "$WORK/new"
    echo "▸ site: HTTP $(site_code)"
    exit 0;;
esac

echo "▸ before"; show_cron

echo "▸ 1/2 keep-warm cron -> */2, with a log"
set_cron '*/2' "$NEW_CMD"

echo "▸ 2/2 scanner block in .htaccess"
read_htaccess > "$WORK/cur"
STAMP="$(date +%Y%m%d-%H%M%S)"
cp "$WORK/cur" "$BACKUP_DIR/htaccess-$STAMP.bak"
echo "  backup: $BACKUP_DIR/htaccess-$STAMP.bak ($(wc -c < "$WORK/cur" | tr -d ' ') bytes)"

if grep -qF "$MARK_BEGIN" "$WORK/cur"; then
  echo "  already present, leaving it alone"
else
  cat "$WORK/cur" "$WORK/block" > "$WORK/new"
  write_htaccess "$WORK/new"
  CODE="$(site_code)"
  if [ "$CODE" != "200" ]; then
    echo "  !! site returned HTTP $CODE — rolling the .htaccess back now"
    write_htaccess "$WORK/cur"
    echo "  restored; site: HTTP $(site_code)"
    echo "  (the cron change is harmless and was left in place)"
    exit 1
  fi
  echo "  site still HTTP 200 after the change"
fi

echo "▸ verify"
echo "    /              -> HTTP $(site_code)                (want 200)"
echo "    /wp-login.php  -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 30 "$SITE/wp-login.php" || true)   (want 403)"
echo "    /products      -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 60 "$SITE/products" || true)   (want 200)"
echo "    /api/health    -> HTTP $(curl -s -o /dev/null -w '%{http_code}' -m 30 "$SITE/api/health" || true)   (want 200)"
echo
echo "▸ after"; show_cron
echo
echo "In ~10 minutes, check the telemetry this account has never had before:"
echo "    bash scripts/hosting-fix.sh --status"
echo "    then read /home/${CP_USER}/keepwarm.log in cPanel File Manager."
echo "Every line should read '200 0.3'. A '000', a 29s time, or a gap wider than"
echo "two minutes means the ping is not landing and */2 was never going to help —"
echo "say so before anyone reports this as fixed."
