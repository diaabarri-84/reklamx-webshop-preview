#!/bin/bash
# Double-click this in Finder to apply the two host-side fixes for the 502s.
#
# It exists because writes to the cPanel host from the assistant are refused by
# the sandbox, and because typing a path with Arabic characters into Terminal by
# hand goes wrong. Same idea as the other .command files beside it.
#
# It runs scripts/hosting-fix.sh, which:
#   1. moves the keep-warm ping from every 5 minutes to every 2, so Passenger
#      cannot reap the app in the gap — the reap timer is 300s and the old ping
#      was also 300s, which made it a coin toss;
#   2. refuses WordPress-scanner paths in Apache, so they stop waking Node.
# Both are reversible: run the revert file beside this one.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — تسريع الموقع وتقليل الوقفات"
echo "════════════════════════════════════════════"
echo ""
echo "المجلد: $(pwd)"
echo ""

if [ ! -f .env.deploy ]; then
  echo "❌ ملف .env.deploy مش موجود — مينفعش نكمل."
  echo "   لازم يكون فيه CPANEL_PASS."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi

if [ ! -f scripts/hosting-fix.sh ]; then
  echo "❌ ملف scripts/hosting-fix.sh مش موجود."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi

echo "هيتعمل حاجتين على الاستضافة:"
echo ""
echo "  ١. الكرون اللي بيدفّي الموقع: من كل ٥ دقايق → كل دقيقتين"
echo "     (الاستضافة بتقفل التطبيق بعد ٥ دقايق سكوت — نفس الرقم بالظبط،"
echo "      عشان كده الموقع بيقف أحيانًا)"
echo ""
echo "  ٢. طلبات السكانرات هتترفض من أباتشي قبل ما التطبيق يصحى ليها"
echo "     (٥٨٥٩ طلب وهمي في ٦ أيام، كلهم كانوا بيصحّوا التطبيق)"
echo ""
echo "  ولو مش عاجبك: ⏪-تراجع-عن-تسريع-الموقع.command"
echo ""
read -r -p "اضغط Enter عشان نبدأ، أو Ctrl+C للإلغاء..."
echo ""

bash scripts/hosting-fix.sh
STATUS=$?

echo ""
if [ $STATUS -eq 0 ]; then
  echo "✅ خلص. جرّب الموقع دلوقتي."
else
  echo "⚠️ فيه مشكلة — ابعت اللي فوق ده للمبرمج."
fi
echo ""
read -r -p "اضغط Enter للخروج..."
