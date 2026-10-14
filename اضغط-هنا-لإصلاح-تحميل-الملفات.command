#!/bin/bash
# Double-click in Finder. Plan task 0.1.
#
# This file exists because the assistant's sandbox refuses writes to Google Cloud,
# the same reason the other .command files beside it exist. Everything here was
# measured against the live project first — nothing in it is a guess.
#
# WHAT IS ACTUALLY BROKEN
# The client reported on 2026-08-24 that Download opens the file instead of saving
# it. It was fixed that day by giving the bucket a CORS policy listing the domains
# of the time. The domain later moved to shop.reklamx.se and the list was never
# extended, so the same bug is live again. Measured on 2026-09-12 against a real
# artwork file:
#     Origin shop.reklamx.se  → no Access-Control-Allow-Origin   (the live host)
#     Origin reklamx.se       → allowed
# The browser's fetch() then throws, downloadHelper.ts falls back to a plain link,
# and a cross-origin link ignores "download" — so the file opens in a tab.
#
# WHAT IS NOT BROKEN
# Uploading. The bucket holds 25 files, the newest from today, and the Firebase
# SDK does not use this policy to upload. PUT/POST are added for the media library
# that is coming, not to repair anything.
#
# The storage-rules step is included only so the rules have a tested way to be
# released. What is live and what is in the repo are identical apart from
# comments — the script checks that itself and says so.
#
# Both steps save what they replace into .backups/ before touching anything.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — إصلاح تحميل ملفات الزبائن"
echo "════════════════════════════════════════════"
echo ""
echo "المجلد: $(pwd)"
echo ""

if [ ! -f service-account.json ]; then
  echo "❌ ملف service-account.json مش موجود — مينفعش نكمل."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi

echo "المشكلة الحقيقية:"
echo "  زرار تحميل ملف الزبون بيفتح الملف في تاب بدل ما ينزّله."
echo "  دي نفس الشكوى اللي العميل قالها في ٢٤ أغسطس واتظبطت وقتها،"
echo "  ورجعت تاني لما الدومين اتغيّر لـ shop.reklamx.se ومحدش ضافه"
echo "  في قائمة الدومينات المسموح لها."
echo ""
echo "  اتأكدنا بطلب حقيقي النهاردة:"
echo "    shop.reklamx.se  ← مرفوض"
echo "    reklamx.se       ← مسموح"
echo ""
echo "اللي هيتعمل — خطوتين، وكل واحدة بتحفظ القديم قبل ما تغيّر:"
echo ""
echo "  ١. إضافة shop.reklamx.se لقائمة CORS  ← ده اللي بيصلّح المشكلة"
echo "  ٢. نشر قواعد التخزين — تعليقات بس، مفيش أي تغيير في السلوك"
echo ""
echo "  ورفع الصور شغّال أصلاً ومش هيتلمس — فيه ٢٥ ملف مرفوع،"
echo "  واحد منهم اترفع النهاردة."
echo ""
echo "  والرجوع: ⏪-تراجع-عن-إصلاح-التحميل.command"
echo ""
read -r -p "اضغط Enter عشان نبدأ، أو Ctrl+C للإلغاء..."
echo ""

echo "──────── ١ من ٢ — CORS ────────"
node scripts/fix-storage-cors.mjs --apply
CORS=$?
echo ""

echo "──────── ٢ من ٢ — قواعد التخزين ────────"
node scripts/deploy-storage-rules.mjs --apply
RULES=$?
echo ""

if [ $CORS -eq 0 ] && [ $RULES -eq 0 ]; then
  echo "✅ خلص. قول للمبرمج عشان يتأكد بنفسه."
else
  echo "⚠️ فيه خطوة ما نجحتش — ابعت اللي فوق ده للمبرمج."
fi
echo ""
read -r -p "اضغط Enter للخروج..."
