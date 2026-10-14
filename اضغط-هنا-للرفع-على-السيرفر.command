#!/bin/bash
# Double-click to publish the current build to shop.reklamx.se.
#
# This exists because the assistant's sandbox refuses to run the deploy, the same
# reason the other اضغط-هنا files beside it exist.
#
# ABOUT THE SEEDED CACHE
#   The FIRST deploy of 1.1 shipped one (SEED_CACHE=1) because Firestore was
#   refusing every read and a restart would have left the new server with nothing
#   to serve. The host now HAS that copy on disk, and a deploy replaces `dist`
#   only — so it survives, and shipping ours again would replace it with an older
#   one. Seeding is therefore off unless SEED_CACHE=1 is set deliberately.
#
# It is reversible: scripts/cpanel-deploy.sh keeps the previous bundle on the
# host, and the `live` git branch is moved only if the deploy reports success.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — رفع التعديلات على السيرفر"
echo "════════════════════════════════════════════"
echo ""
echo "المجلد: $(pwd)"
echo ""

echo "اللي هيترفع (آخر التعديلات):"
git --no-pager log --oneline live..main 2>/dev/null | sed 's/^/  • /'
echo ""

if [ "${SEED_CACHE:-0}" = "1" ]; then
  if [ ! -f .cache/catalogue.json ] || [ ! -f .cache/categories.json ]; then
    echo "❌ طلبت نسخة طوارئ بس هي مش مبنية. شغّل الأول:"
    echo "   node scripts/seed-shop-cache.mjs .backups/firestore-2026-09-12"
    echo ""
    read -r -p "اضغط Enter للخروج..."
    exit 1
  fi
  echo "ومعاها نسخة طوارئ من القرص (طُلبت بـSEED_CACHE=1)."
else
  echo "النسخة الاحتياطية اللي على السيرفر هتفضل زي ما هي — دي أحدث من أي حاجة هنا."
fi
echo ""
read -r -p "اضغط Enter عشان نرفع، أو Ctrl+C للإلغاء..."
echo ""

bash scripts/cpanel-deploy.sh
RC=$?

echo ""
if [ $RC -eq 0 ]; then
  # `live` is the branch that records what is actually on the host. It moves only
  # when the deploy said it worked, so the branch never claims more than the host.
  git branch -f live main >/dev/null 2>&1 && echo "✅ تم الرفع، وفرع live اتحدّث."
  echo ""
  echo "قول للمبرمج عشان يتأكد بنفسه."
elif [ $RC -eq 2 ]; then
  # 2026-09-13: الرفع نجح والتأكيد هو اللي ما ردّش، والرسالة القديمة قالت
  # "اللي على السيرفر لسه القديم" وده كان **غلط**. أول حاجة بيفكر فيها اللي
  # قلقان ساعتها هي إنه يرجّع النسخة القديمة — يعني rm -rf و restart تاني على
  # استضافة أصلاً بتترنح. فالحالة دي بقى ليها ردّ مختلف.
  echo "⚠️ الرفع اتبعت ووصل، بس التأكيد ما ردّش (كود $RC)."
  echo ""
  echo "   ⚠️ ده **مش** معناه إن الرفع فشل. شوف فوق:"
  echo "      لو مكتوب upload: ok و extracted — يبقى الكود الجديد وصل فعلاً."
  echo ""
  echo "   فرع live ما اتحركش لوحده. متعملش rollback — ابعت للمبرمج الأول."
  echo "   وهو هيتأكد بنفسه ويحرّك الفرع لو الرفع تمام."
else
  echo "⚠️ الرفع ما نجحش (كود $RC) — ابعت اللي فوق ده للمبرمج."
  echo "   فرع live ما اتغيّرش، يعني اللي على السيرفر لسه القديم."
fi
echo ""
read -r -p "اضغط Enter للخروج..."
