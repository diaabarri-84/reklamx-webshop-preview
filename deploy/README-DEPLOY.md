# نقل المتجر إلى استضافة cPanel — دليل التنفيذ

السيرفر: `37.27.63.113` (Hetzner فنلندا) · الحساب: `shopreklam` · الدومين: `shop.reklamx.se`
المتاح عليه: Node **22.23.1** · npm 10.9.8 · **PM2** · SSH · cPanel Jupiter

> ## ✅ التحويل خلص — 2026-08-31
>
> المتجر شغّال على `https://shop.reklamx.se` وبس — استضافة العميل نفسه (cPanel).
> الباقي في الملف ده بقى **سجل** لخطوات التركيب، مش تعليمات جارية.
>
> **النشر بعد أي تعديل بأمر واحد:**
>
> ```bash
> bash scripts/cpanel-deploy.sh          # verify + build + رفع + إعادة تشغيل + مقارنة الهاش
> bash scripts/cpanel-deploy.sh --no-build   # يرفع الـ dist الموجود من غير بناء
> ```
>
> بياخد باسورد الـ cPanel من `.env.deploy` (مش في git). **ما تستخدمش SSH** مع
> السيرفر ده — بيقبل الدخول وبعدين ما ينفّذش حاجة من غير أي رسالة خطأ.


---

## ⛔ ممنوع نهائياً

**متغيّرش الـ Nameservers لـ `ns3/ns4.hostx365.com`.**
الـ DNS بتاع `reklamx.se` على Cloudflare، والإيميلات (`order@` و `info@`) ماشية
من خلال سجل في نفس الزون. تحويل الـ nameservers بيوقّف الموقع الرئيسي والإيميل
في نفس اللحظة. اللي محتاجينه **سجل A واحد بس**.

---

## 1) قبل التحويل — تجهيزات مالهاش رجعة سهلة

| الخطوة | المكان | التفاصيل |
|---|---|---|
| سجل A | Cloudflare | `shop` → `37.27.63.113`، **DNS only** (سحابة رمادية). ملاحظة: `shop.reklamx.se` حالياً بيشاور على `144.91.125.1` وعليه موقع شغّال — لازم نتأكد إنه ينفع يتشال |
| نطاق مصرّح به | Firebase Console → Authentication → Settings → Authorized domains | ضيف `shop.reklamx.se` — من غيرها الدخول بجوجل هيرفض |
| CORS للتخزين | Firebase Storage bucket | ضيف `https://shop.reklamx.se` للأصول المسموحة، وإلا تحميل ملفات الطباعة هيفتح تاب فاضي بدل ما ينزّل |
| Mollie | مفيش | الـ webhook والرجوع بيتبنوا من `PUBLIC_URL` تلقائياً |

## 2) بناء الحزمة (على جهازك، مش على السيرفر)

```bash
npm run verify          # لازم يعدّي أخضر قبل أي رفع
bash scripts/make-release.sh
```

بيطلع `release/reklamx-<تاريخ>.tar.gz` — فيه `dist/` و `package.json` و
`package-lock.json` وملف الكونفيج و`deploy/`. **مفيش فيه أي أسرار.**

## 3) الرفع والتركيب

```bash
scp release/reklamx-<تاريخ>.tar.gz shopreklam@37.27.63.113:~/
ssh shopreklam@37.27.63.113          # البورت: اسأل الاستضافة، غالباً 22

tar -xzf reklamx-<تاريخ>.tar.gz && rm reklamx-<تاريخ>.tar.gz
ln -sfn ~/reklamx-<تاريخ> ~/reklamx  # الرابط الحي — بنقلبه للرجوع لأي نسخة
cd ~/reklamx
npm ci --omit=dev                    # حزم التشغيل بس، من غير أدوات البناء
```

## 4) الأسرار (يدوي، ومش في الأرشيف أبداً)

```bash
# من جهازك
scp .env               shopreklam@37.27.63.113:~/reklamx/.env
scp service-account.json shopreklam@37.27.63.113:~/reklamx/service-account.json
# على السيرفر
chmod 600 ~/reklamx/.env ~/reklamx/service-account.json
```

عدّل في `.env` على السيرفر: `PUBLIC_URL=https://shop.reklamx.se` و
`NODE_ENV=production` و `CRON_SECRET=<الناتج من openssl>`. **ومتحطّش `PORT`
ولا `HOST`** — Passenger هو اللي بيحددهم. القالب الكامل في
`deploy/env.production.example`.

## 5) التشغيل — عن طريق Passenger (الطريقة المؤكدة من الاستضافة)

الاستضافة أكدت إن **Setup Node.js App** شغّال، وده معناه Phusion Passenger:
هو اللي بيشغّل التطبيق ويوصّل الدومين بيه، من غير PM2 ومن غير فتح بورتات.

**cPanel → Software → Setup Node.js App → Create Application**

| الحقل | القيمة |
|---|---|
| Node.js version | **22** |
| Application mode | Production |
| Application root | `reklamx` |
| Application URL | `shop.reklamx.se` |
| Application startup file | `dist/server.cjs` |

بعد ما تتعمل، من نفس الشاشة:
1. **Run NPM Install** (أو من الترمينال: فعّل البيئة اللي cPanel بيديها في أول
   الصفحة، وبعدها `npm install --omit=dev`)
2. أضف المتغيّرات في **Environment variables** — أو الأسهل: سيب ملف `.env`
   في `~/reklamx` وهو بيتقرا لوحده.
3. **Restart**

> **مهم:** مع Passenger **متحطّش `PORT` ولا `HOST` بإيدك**. Passenger بيمرّر
> مسار سوكِت في `PORT`، والسيرفر بقى فاهمه ويسمع عليه (اتصلح في هذا الإصدار —
> قبل كده كان بيتجاهله ويفتح 3000 والموقع يرد 503 من غير سبب واضح في اللوج).

**فحص سريع بعد التشغيل:**
```bash
curl -s https://shop.reklamx.se/api/health     # {"status":"ok",…}
tail -20 ~/reklamx/logs/*.log 2>/dev/null
```

## 6) مراحل الطلبات — كرون بدل المؤقّت الداخلي

Passenger بينيّم التطبيق لما محدش يدخل الموقع، والمؤقّت الداخلي بينام معاه.
فبدل ما نعتمد عليه، بنستخدم نقطة الكرون الجاهزة في السيرفر — وده كمان بيفضّل
التطبيق صاحي.

```bash
# ولّد سراً مرة واحدة وحطه في .env
openssl rand -hex 32          # → CRON_SECRET=…
```

**cPanel → Advanced → Cron Jobs**، كل ربع ساعة:
```
*/15 * * * * curl -s -H "Authorization: Bearer <CRON_SECRET>" https://shop.reklamx.se/api/cron/auto-stages > /dev/null
```

وكمان (اختياري بس مفيد) كرون كل 5 دقائق على `/api/health` عشان أول زبون في
الصبح ما يستناش التطبيق وهو بيقوم.

### البديل: PM2 (لو رجعنا لسيرفر VPS في المستقبل)
`deploy/ecosystem.config.cjs` جاهز لده — بيشغّل التطبيق على `127.0.0.1:3060`
ومحتاج proxy من الويب سيرفر، وساعتها الكرون مش لازم لأن المؤقّت الداخلي بيشتغل.

## 7) الشهادة

cPanel → SSL/TLS Status → Run AutoSSL على `shop.reklamx.se`
(لازم يكون سجل الـ A متظبط وDNS only، وإلا التحقق هيفشل).

## 8) الفحص قبل ما نعلن التحويل

- [ ] `https://shop.reklamx.se/api/health` بيرجع ok
- [ ] الصفحة الرئيسية والمتجر بيفتحوا والصور ظاهرة
- [ ] `/products/premium-business-cards` بالاسم شغّال
- [ ] الدخول بجوجل شغّال (يعني النطاق اتصرّح في Firebase)
- [ ] **طلب حقيقي بمبلغ صغير من أوله لآخره** — الدفع يتأكد، والطلب يتحوّل
      "مدفوع"، وإيميل الطلب يوصل. ده أهم اختبار في الليلة كلها
- [ ] رفع ملف طباعة بعد الدفع شغّال (يعني CORS متظبط)
- [ ] لوحة الأدمن وشاشة الإنتاج شغّالين
- [ ] بعد ربع ساعة: مراحل الطلبات بتتحرك لوحدها (`pm2 logs` بيقول sweep)

## 9) الرجوع لو حصل أي حاجة

الرجوع فوري ومن غير أي بناء:
```bash
ln -sfn ~/reklamx-<النسخة-القديمة> ~/reklamx && pm2 restart reklamx-shop
```
النسخة القديمة بتفضل على القرص كشبكة أمان — منمسحهاش غير بعد أسبوع نظيف.

## 10) بعد الاستقرار

- غيّر باسورد cPanel (اتبعت في واتساب)
- دوّر مفتاح Zendr
- فعّل نسخة احتياطية يومية من لوحة الاستضافة
