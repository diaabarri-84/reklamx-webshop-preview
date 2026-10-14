#!/bin/bash
# Build the shop here, and pack exactly what the server needs — nothing else.
#
# WHY NOT BUILD ON THE SERVER: the build pulls Vite, Rollup, Tailwind's oxide
# and Playwright, wants a couple of gigabytes of RAM, and installs binaries
# compiled for whatever machine runs it. The OUTPUT is plain JavaScript that
# runs anywhere. So the heavy half happens on this machine and the server only
# installs the packages the running server actually requires.
#
# NO SECRETS GO IN THE ARCHIVE. .env and service-account.json are uploaded
# separately, by hand, and chmod 600 — see deploy/README-DEPLOY.md.
set -e
cd "$(dirname "$0")/.."
ROOT="$PWD"
STAMP=$(date +%Y%m%d-%H%M)
OUT="$ROOT/release"
NAME="reklamx-$STAMP"

echo "▸ building…"
npm run build

echo "▸ packing…"
rm -rf "$OUT/$NAME"
mkdir -p "$OUT/$NAME"
cp -R dist "$OUT/$NAME/dist"
# Not the server's source map: it is the complete original TypeScript of
# server.ts, nothing needs it to run, and a file on the server's disk is a file
# a mis-spelled path can reach (SRV-01). cpanel-deploy.sh leaves it out too.
rm -f "$OUT/$NAME/dist/server.cjs.map"
# NOT the repo's package.json: that one installs the whole front end on the
# server for nothing. This writes a manifest built from dist/server.cjs.
node scripts/release-manifest.mjs "$OUT/$NAME"
# The server falls back to this file for the Firebase project and web key when
# the FIREBASE_* variables are not set. It holds no private key — it is the
# same config the browser downloads.
cp firebase-applet-config.json "$OUT/$NAME/"
mkdir -p "$OUT/$NAME/deploy"
cp deploy/ecosystem.config.cjs deploy/htaccess-proxy.txt deploy/env.production.example "$OUT/$NAME/deploy/"
mkdir -p "$OUT/$NAME/logs"

# A parachute: if anything secret ever wanders in, the release stops here.
if find "$OUT/$NAME" -name '.env' -o -name 'service-account.json' | grep -q .; then
  echo "✗ a secret ended up in the release — refusing to pack it."; exit 1
fi

cd "$OUT"
tar -czf "$NAME.tar.gz" "$NAME"
rm -rf "$NAME"
echo
echo "✓ release/$NAME.tar.gz  ($(du -h "$NAME.tar.gz" | cut -f1))"
echo
echo "next, on the server:"
echo "  scp release/$NAME.tar.gz shopreklam@37.27.63.113:~/"
echo "  ssh shopreklam@37.27.63.113"
echo "  tar -xzf $NAME.tar.gz && rm $NAME.tar.gz"
echo "  ln -sfn ~/$NAME ~/reklamx    # the live symlink — flip it to roll back"
echo "  cd ~/reklamx && npm install --omit=dev"
echo "  (upload .env and service-account.json, chmod 600)"
echo "  pm2 start deploy/ecosystem.config.cjs && pm2 save"
