#!/bin/bash
# Double-click this in the morning. It finishes everything that could not be done
# while the project's free daily Firestore read quota was exhausted — on
# 2026-09-12 and again on 2026-09-13 — and it checks its own work.
#
# ⚠️ READ THIS FIRST. On 2026-09-13 the quota error said, verbatim:
#   "This database cannot exceed free quota limits even when a billing instrument
#    is enabled."
# If that is still what it says after the project is moved to Blaze, then upgrading
# alone will NOT lift the cap on this database and the data has to be moved to one
# created outside the free tier. Do not promise the client that Blaze fixes it
# until a read after the upgrade proves it.
#
# WHAT IT DOES
#   1. Checks the quota is actually back. If it is not, it stops and says so
#      rather than half-running and leaving the catalogue inconsistent.
#   2. Shows what the supplier-name backfill WOULD change, and waits for Enter.
#      The 110 products imported before that field existed have no supplier on
#      them, so the new column and filter in the dashboard would be empty for
#      every product he actually has. It writes two keys, with merge, and never
#      touches a product built by hand.
#   3. Re-runs the acceptance suites against the live shop.
#
# Nothing here is irreversible: the backfill adds two display fields and changes
# no price, no visibility and no category.

cd "$(dirname "$0")" || exit 1

echo ""
echo "════════════════════════════════════════════"
echo "  ReklamX — إكمال الناقص من امبارح"
echo "════════════════════════════════════════════"
echo ""

echo "──────── ١ — هل حصة Firestore رجعت؟ ────────"
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
const sa=JSON.parse(readFileSync('service-account.json','utf8'));
const cfg=JSON.parse(readFileSync('firebase-applet-config.json','utf8'));
initializeApp({credential:cert(sa),projectId:sa.project_id});
try {
  const s=await getFirestore(cfg.firestoreDatabaseId).collection('categories').select('name').get();
  console.log('  ✅ رجعت — قرأ '+s.size+' تصنيف');
  process.exit(0);
} catch(e) {
  console.log('  🔴 لسه مقفولة.');
  process.exit(1);
}
" 2>/dev/null
if [ $? -ne 0 ]; then
  echo ""
  echo "  الحصة بتترجع منتصف الليل بتوقيت المحيط الهادي (حوالي ٩ الصبح عندنا)."
  echo "  المتجر شغّال عادي — بيخدم من نسخة على القرص. جرّب تاني بعد شوية."
  echo ""
  read -r -p "اضغط Enter للخروج..."
  exit 1
fi
echo ""

echo "──────── ٢ — اسم المورد على المنتجات القديمة ────────"
node scripts/backfill-supplier-name.mjs
echo ""
read -r -p "اضغط Enter عشان نكتبها فعلاً، أو Ctrl+C للإلغاء..."
node scripts/backfill-supplier-name.mjs --apply
echo ""

echo "──────── ٣ — كوبون TEST100: لسه موجود؟ ────────"
# 4.2 — كان كوبون ١٠٠٪ شغّال في متجر بياخد فلوس حقيقي. اللستة بتتطبع كاملة
# علشان نشوف بعينينا، والإيقاف مش بيحصل من غير --apply.
node scripts/shop-data-tool.mjs coupons
echo ""
echo "  لو TEST100 لسه ظاهر فوق وحالته فعّالة، شغّل السطر ده:"
echo "     node scripts/shop-data-tool.mjs coupon-off TEST100 --apply"
echo ""

echo "──────── ٤ — فهرسة كتالوجات الموردين ────────"
# الفهرس ده هو اللي شاشة الاختيار بتقرأ منه. من غيره الشاشة فاضية.
node scripts/index-supplier.mjs promediaplus --apply
echo ""
# midocean محتاج المفتاح يتحفظ من الداشبورد الأول (شاشة الموردين).
# ٢٦ ميجا، فياخد وقت.
node scripts/probe-midocean.mjs || echo "  (لو قال إن المفتاح مش محفوظ — دخله من الداشبورد الأول)"
echo ""

echo "──────── ٥ — التأكد على الموقع الحي ────────"
node scripts/e2e/download-cors-verify.mjs
echo ""
node scripts/e2e/media-library-storage-verify.mjs
echo ""

echo "──────── ٦ — الشاشات الجديدة في متصفح حقيقي ────────"
echo "  الحاجات دي محتاجة عين بشرية، مش سكربت. افتح الداشبورد وشوف:"
echo "    • الكوبونات: الحالة بتقول إيه لكوبون منتهي ولكوبون مستهلك"
echo "    • عمود الاستخدام (٢/٤) والنص اللي تحت زرار الحد لكل عميل"
echo "    • توليد دفعة أكواد → نسخ + تنزيل CSV"
echo "    • تاريخ التغييرات، وجدول أداء كل كود"
echo "    • النقاط: إجمالي الالتزام، الإعدادات، وكشف حساب عميل"
echo "    • شاشة الموردين: التبديل بين EasyGifts / Pro Media Plus / midocean"
echo ""

echo "════════════════════════════════════════════"
echo "  خلص. ابعت اللي فوق ده للمبرمج عشان يراجعه."
echo "════════════════════════════════════════════"
echo ""
read -r -p "اضغط Enter للخروج..."
