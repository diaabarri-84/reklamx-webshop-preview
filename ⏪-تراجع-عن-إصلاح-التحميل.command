#!/bin/bash
# UNDO. Puts the bucket CORS and the storage rules back as they were.
#
# The name starts with ⏪ on purpose. It used to start with "اضغط-هنا-ل" like the
# file that APPLIES the fix, so the two sat next to each other in Finder — and on
# 2026-09-12 the owner opened this one by mistake. In this folder: "اضغط-هنا"
# does something, "⏪" undoes it.
#
# If the fix was never applied there is nothing saved to go back to, and this says
# so and stops rather than asking questions it has no reason to ask.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ⏪ الرجوع عن إصلاح التحميل"
echo "════════════════════════════════════════════"
echo ""

echo "──────── CORS ────────"
node scripts/fix-storage-cors.mjs --revert --apply
CORS=$?
echo ""

if [ $CORS -eq 2 ]; then
  echo "════════════════════════════════════════════"
  echo "  مفيش حاجة اتغيرت أصلاً، فمفيش حاجة ترجع."
  echo ""
  echo "  الإصلاح لسه ما اتطبقش. لو ده اللي كنت عايزه،"
  echo "  الملف التاني اسمه:"
  echo ""
  echo "      اضغط-هنا-لإصلاح-تحميل-الملفات.command"
  echo "════════════════════════════════════════════"
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 0
fi

if [ $CORS -ne 0 ]; then
  echo "⚠️ الرجوع عن CORS ما نجحش — ابعت اللي فوق ده للمبرمج."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi

echo "──────── قواعد التخزين ────────"
echo "لو عايز ترجّعها، الصق رقم النسخة القديمة (اللي طُبع وقت النشر)."
echo "أو سيبها فاضية واضغط Enter عشان نعديها — القواعد المنشورة"
echo "والموجودة عندنا فرقهم تعليقات بس، فتعديها مش هيضر."
echo ""
read -r -p "رقم النسخة: " RULESET
RULESET="$(echo "$RULESET" | tr -d '[:space:]')"
if [ -n "$RULESET" ]; then
  node scripts/deploy-storage-rules.mjs --rollback "$RULESET" --apply
else
  echo "  اتعدّت."
fi

echo ""
read -r -p "اضغط Enter للخروج..."
