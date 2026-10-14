#!/bin/bash
# Double-click this file in Finder to write the new products into Firestore.
#
# It exists because the assistant's sandbox blocks Firestore writes, and typing a
# path with Arabic characters into Terminal by hand is error-prone. Same idea as
# finish-deploy.sh, which is how this project deployed to Railway.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — إضافة المنتجات الجديدة"
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

echo "الخطوة 1 من 2 — معاينة (مش هيتكتب أي حاجة):"
echo "────────────────────────────────────────────"
node scripts/apply-product-presentation.mjs --dry-run
DRY_STATUS=$?
echo ""

if [ $DRY_STATUS -ne 0 ]; then
  echo "❌ المعاينة فشلت — مفيش حاجة اتكتبت. ابعت الرسالة اللي فوق للمساعد."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi

echo "════════════════════════════════════════════"
echo "  ده اللي هيحصل فعلاً لو كمّلت."
echo "  كل مستند بيتلمس بياخد نسخة احتياطية في .backups/"
echo "════════════════════════════════════════════"
echo ""
read -r -p "تكمّل وتكتب البيانات؟ اكتب  yes  وبعدين Enter: " ANSWER
echo ""

if [ "$ANSWER" != "yes" ]; then
  echo "تمام — مفيش حاجة اتغيّرت."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 0
fi

echo "الخطوة 2 من 2 — الكتابة:"
echo "────────────────────────────────────────────"
node scripts/apply-product-presentation.mjs
RUN_STATUS=$?
echo ""

if [ $RUN_STATUS -eq 0 ]; then
  echo "✅ خلص. افتح http://localhost:3000/products وشوف المنتجات."
else
  echo "❌ حصل خطأ — ابعت الرسالة اللي فوق للمساعد. النسخ الاحتياطية في .backups/"
fi

echo ""
read -r -p "اضغط Enter لقفل الشباك..."
