#!/bin/bash
# Double-click to put the host back exactly as it was before the speed fix.
cd "$(dirname "$0")" || exit 1
echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — الرجوع عن تسريع الموقع"
echo "════════════════════════════════════════════"
echo ""
echo "هيرجّع الكرون لكل ٥ دقايق، ويشيل قواعد أباتشي اللي اتزادت."
echo ""
read -r -p "اضغط Enter عشان نرجّع، أو Ctrl+C للإلغاء..."
echo ""
bash scripts/hosting-fix.sh --revert
echo ""
read -r -p "اضغط Enter للخروج..."
