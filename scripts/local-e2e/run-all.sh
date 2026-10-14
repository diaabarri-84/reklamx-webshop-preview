#!/bin/bash
# Every local browser suite, in dependency order. Needs start.sh first.
# Exit 0 only when every suite passed.
cd "$(dirname "$0")"
export FIRESTORE_EMULATOR_HOST=127.0.0.1:8085 GCLOUD_PROJECT=demo-reklamx
failed=0
for t in product-dialog oneoff-price checkout-delivery library shop-order review-fixes swedish orders print rules-orders shipping shapes page-order suggestions ai-provider studio design-templates design-later artwork-and-speed supplier-picker print-engine order-mail insights sheet-pictures product-view customizer read-budget profile-unavailable pay-on-delivery site-settings product-pictures "$@"; do
  [ -f "$t.mjs" ] || continue
  echo "=== $t"
  node "$t.mjs" 2>&1 | grep -v "MetadataLookup\|trace-warnings"
  [ "${PIPESTATUS[0]}" = "0" ] || failed=$((failed+1))
done
echo
if [ "$failed" = "0" ]; then echo "ALL SUITES PASSED"; else echo "$failed SUITE(S) FAILED"; exit 1; fi
