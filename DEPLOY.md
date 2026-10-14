# نشر ReklamX على استضافة حقيقية

> افتح الملف ده يوم ما تشتري الدومين. امشي بالترتيب من فوق لتحت.
> كل خطوة مكتوب جنبها **ليه** — عشان لو حاجة وقعت تعرف تدوّر فين.
>
> **قاعدة واحدة قبل أي حاجة:** الأمر اللي بيقولك كل حاجة تمام ولا لأ هو:
> ```bash
> node scripts/preflight.mjs --online
> ```
> شغّله على السيرفر بعد كل خطوة. لو طلع **0 blocking** يبقى تمام.

---

## 0. المتطلبات — اقرأها قبل ما تدفع فلوس لأي استضافة

| المطلوب | ليه |
|---|---|
| **VPS بيشغّل Node.js 20 أو أحدث** | الموقع مش HTML عادي — فيه سيرفر Express بيحسب الأسعار ويتعامل مع الدفع. **الاستضافة المشتركة (shared/PHP) مش هتشتغل خالص.** |
| **منفذ 465 الصادر مفتوح** (SMTP) | من غيره مفيش إيميل تأكيد للعميل ولا تنبيه ليك بأوردر جديد — والأوردر بينجح عادي، فمش هتلاحظ. اسأل الاستضافة قبل الشراء. |
| **شهادة HTTPS** | Mollie مش بيكلّم webhook على http عادي. أغلب الاستضافات بتديها مجاناً (Let's Encrypt). |
| **ذاكرة ١ جيجا على الأقل** | البناء (`npm run build`) بياخد شوية ذاكرة. |

> **ملحوظة عن Hostinger:** خطة **VPS** تمام. خطة **Web Hosting** المشتركة **لأ** — مفيهاش Node.

---

## 1. حاجات على Firebase — اعملها **قبل** ما تحوّل الدومين

### 1.1 🔴 ارفع المشروع لخطة Blaze — أهم خطوة في الملف ده

👉 https://console.firebase.google.com/project/gen-lang-client-0018052971/usage/details → **Modify plan**

**ليه:** الخطة المجانية سقفها **٥٠٫٠٠٠ قراءة في اليوم**. صفحة واحدة في المتجر بتستهلك ٦٠–٨٠ قراءة، يعني السقف بيخلص عند **٦٠٠–٨٠٠ زيارة**. ده حصل فعلاً: **المتجر فضل مطفي ٧ ساعات** والمنتجات كلها اختفت.

نفس الـ٥٠٫٠٠٠ قراءة بتفضل **مجانية** على Blaze — إنت بتدفع بس فوق كده، وبقروش. حط سقف تنبيه (Budget alert) بـ ١٠ دولار وارتاح.

### 1.2 ضيف الدومين لقائمة النطاقات المسموحة

👉 https://console.firebase.google.com/project/gen-lang-client-0018052971/authentication/settings → **Authorized domains** → Add

ضيف **الاتنين**: `reklamx.se` و `www.reklamx.se`

**ليه:** من غيرهم أي تسجيل دخول (بما فيه دخولك إنت للوحة التحكم) هيرفض بـ `auth/unauthorized-domain`.

### 1.3 اتأكد إن Anonymous مفعّل

👉 https://console.firebase.google.com/project/gen-lang-client-0018052971/authentication/providers

لازم يكون مفعّل: **Email/Password**، **Google**، و**Anonymous**.

**ليه:** الزبون اللي مش مسجّل بيرفع تصميمه من خلال جلسة مجهولة عشان يبقى للملف صاحب في التخزين. لو الخيار مقفول، الرفع بيرجع لطريقة قديمة سقفها ٠.٦ ميجا وبيرفض أي PDF عادي.

### 1.4 راجع قواعد التخزين (Storage)

👉 https://console.firebase.google.com/project/gen-lang-client-0018052971/storage → تبويب **Rules**

قارنها بملف `storage.rules` اللي في المشروع. لو مختلفين، الصق اللي في الملف واضغط **Publish**.

**ليه:** قواعد Firestore اتنشرت (٢٠٢٦-٠٨-٢٠)، لكن قواعد التخزين مالهاش سكربت نشر هنا — لازم من الكونسول.

### 1.5 افتح CORS للتخزين على الدومين الجديد

مش محتاج تثبّت أي حاجة — افتح Cloud Shell من المتصفح:
👉 https://shell.cloud.google.com/?project=gen-lang-client-0018052971

```bash
cat > cors.json <<'EOF'
[{"origin":["https://reklamx.se","https://www.reklamx.se"],
  "method":["GET","HEAD"],
  "responseHeader":["Content-Type","Content-Length"],
  "maxAgeSeconds":3600}]
EOF
gcloud storage buckets update gs://gen-lang-client-0018052971.firebasestorage.app --cors-file=cors.json
```

**ليه:** معاينة الـPDF عند الدفع بتقرا الملف من التخزين مباشرة. من غير CORS المعاينة بتفشل على الدومين الجديد.

---

## 2. رفع الكود على السيرفر

```bash
# على السيرفر
git clone <أو ارفع المجلد بـ SFTP>
cd reklamx
npm ci
npm run build
```

### ⛔ ثلاث حاجات **متترفعش** مع الكود

| الملف | ليه |
|---|---|
| `.env` | فيه **مفتاح Mollie التجريبي** و `HOST=127.0.0.1`. لو سافر معاك: الموقع ياخد فلوس وهمية، أو ما يفتحش من برّه خالص. **اكتب متغيرات الإنتاج من الأول على السيرفر.** |
| `node_modules/` | اتبنى على الماك. شغّل `npm ci` على السيرفر. |
| `dist/` | اتبنى محلياً. شغّل `npm run build` على السيرفر. |

> لو بترفع بـ Finder → **متعملش zip للمجلد كله**، لأن `.env` هيتلم معاه.

---

## 3. متغيرات البيئة على السيرفر

حطهم في لوحة الاستضافة أو في `systemd` / `pm2` — **مش في ملف `.env` منسوخ من الماك**.

| المتغير | القيمة | لو ناقص؟ |
|---|---|---|
| `NODE_ENV` | `production` | 🔴 السيرفر بيشغّل نسخة التطوير: بطيء، وكود المشروع كله يبقى مقروء لأي حد |
| `PUBLIC_URL` | `https://reklamx.se` (بدون `/` في الآخر) | 🔴 **كل عملية دفع بتفشل** برسالة «الدفع غير مهيأ». و Mollie مالوش webhook أصلاً |
| `MOLLIE_API_KEY` | `live_…` | 🔴 من غيره مفيش دفع. وبمفتاح `test_` الزباين بياخدوا طباعة **مجاناً** والأوردر يظهر «مدفوع» |
| `FIREBASE_SERVICE_ACCOUNT` | محتوى `service-account.json` كله في **سطر واحد** | 🔴 مفيش أوردر يتسجّل، والـwebhook بيرمي الدفعة ويرد "تمام" فـ Mollie ما بيعيدش المحاولة |
| `SMTP_HOST` | `smtp.gmail.com` | 🟠 مفيش إيميلات خالص |
| `SMTP_PORT` | `465` | |
| `SMTP_USER` | إيميل الإرسال | |
| `SMTP_PASSWORD` | App Password (مش باسورد الحساب) | |
| `SMTP_FROM` | `info@reklamx.se` | 🟠 غيره الإيميل بيروح Spam |
| `SHOP_ORDER_INBOX` | **إيميل مختلف** عن `SMTP_USER` | 🟠 لو نفس الإيميل، Gmail بيحطه في "Sent" ومش هتشوف تنبيه ولا أوردر |
| `TRUST_PROXY` | `1` لو فيه nginx قدامه | 🟠 من غيره كل الزباين محسوبين IP واحد وبيتقفل عليهم checkout |
| `HOST` | **سيبه فاضي** (أو `127.0.0.1` لو nginx على نفس الجهاز) | 🔴 `127.0.0.1` من غير nginx = الموقع مش هيفتح من برّه خالص |
| `PORT` | اللي الاستضافة بتديه | |
| `GEMINI_API_KEY` | اختياري | شات المساعد بيقول للزبون إنه غير متاح (رسالة مهذبة) |

**تحويل ملف الخدمة لسطر واحد** (شغّله على الماك وانسخ الناتج):
```bash
node -e "console.log(JSON.stringify(require('./service-account.json')))"
```

---

## 4. تشغيل الموقع

**الأمر:** `NODE_ENV=production node dist/server.cjs`
**مجلد التشغيل:** لازم يكون **جذر المشروع** — السيرفر بيقرا `firebase-applet-config.json` من مكان التشغيل.

### مع pm2 (الأسهل على VPS)

```bash
npm i -g pm2
cd /home/USER/reklamx
pm2 start dist/server.cjs --name reklamx --cwd /home/USER/reklamx
pm2 save && pm2 startup
```

### nginx قدامه

```nginx
server {
    server_name reklamx.se www.reklamx.se;

    # Mollie بيبعت webhook بحجم صغير، بس رفع التصميم بيعدي من هنا
    client_max_body_size 60M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 120s;
    }
}
```

مع nginx: خلي `TRUST_PROXY=1` و `HOST=127.0.0.1`.

---

## 5. الدومين والـDNS

| السجل | القيمة | الغرض |
|---|---|---|
| `A` — `@` | IP السيرفر | الموقع |
| `A` أو `CNAME` — `www` | نفس السيرفر | خلي **واحد منهم** هو الأساسي و**حوّل التاني ليه 301** |
| `TXT` — `@` | `v=spf1 include:_spf.google.com ~all` | الإيميل ما يروحش Spam |
| `TXT` — `google._domainkey` | من Google Workspace | DKIM |
| `TXT` — `_dmarc` | `v=DMARC1; p=none; rua=mailto:you@reklamx.se` | DMARC |

> **مهم جداً:** `PUBLIC_URL` لازم يكون **نفس** العنوان اللي الزباين بيتصفحوه بالظبط. لو الناس بتدخل على `www` و `PUBLIC_URL` مكتوب من غير `www`، الزبون بعد الدفع بيرجع على عنوان تاني — **والسلة ما بتتفضّاش** لأن المتصفح بيخزنها لكل عنوان لوحده.

---

## 6. قبل ما تفتح للزباين — ٥ اختبارات

```bash
# 1) كل حاجة مظبوطة؟
node scripts/preflight.mjs --online          # لازم: 0 blocking

# 2) الموقع رد؟
curl -sI https://reklamx.se | head -3        # HTTP 200
curl -s https://reklamx.se/api/health        # {"status":"ok"}

# 3) نسخة الإنتاج شغالة (مش وضع التطوير)؟
curl -s https://reklamx.se | grep -o '/assets/index-[^"]*'   # لازم يطلع اسم ملف
curl -sI https://reklamx.se | grep -i strict-transport       # لازم يظهر

# 4) 🔴 Mollie يقدر يوصل للـwebhook؟ — من جهاز برّه الشبكة
curl -i -X POST https://reklamx.se/api/webhooks/mollie -d 'id=tr_test'
#    لازم HTTP 200 و 'ok'. لو طلع 301 أو 403 أو صفحة حماية → الدفع مش هيتأكد أبداً

# 5) الفحص الشامل على الموقع الحقيقي
node scripts/e2e/full-regression.mjs <admin-email> <password> https://reklamx.se
```

ثم **أوردر حقيقي بمبلغ صغير** بمفتاح `live_`:
ادفع → لازم ترجع لصفحة الطلب → يجيلك إيميل → الأوردر يظهر في لوحة الستاف بـ **PAID** → والمبلغ يبان في Mollie.

---

## 7. أول أسبوع بعد الافتتاح

**كل صباح:** افتح Mollie → Payments → فلتر **Paid**، وقارنها بلوحة الستاف.
أي دفعة مدفوعة والأوردر مش «paid» معناها الـwebhook مش واصل.

**الإنقاذ:** افتح رابط الطلب نفسه `https://reklamx.se/order/<رقم>?t=<token>` — الصفحة بتسأل Mollie تاني وتصلّح الحالة.

---

## 8. لو حصلت مصيبة

| المشكلة | الحل |
|---|---|
| قواعد الأمان كسرت حاجة | `node scripts/deploy-rules.mjs --rollback projects/gen-lang-client-0018052971/rulesets/55fdd95f-9cd2-4472-a0b9-2174138e4e5e --apply` |
| الموقع واقع بعد نشر | `pm2 restart reklamx` وبعدين `pm2 logs reklamx --lines 100` |
| غيّرت مفتاح Mollie ومحصلش حاجة | **لازم تعيد تشغيل السيرفر** — المفتاح محفوظ في الذاكرة. اتأكد من سطر `Mollie ready — LIVE mode.` في اللوج |
| القواعد الشغالة مش اللي عندي | `node scripts/rules-status.mjs` بيقولك، و `node scripts/deploy-rules.mjs --apply` بينشر |

---

## 9. حاجات مش تقنية لازم تخلص قبل الافتتاح

- [ ] **البيانات القانونية على الفاتورة** — الاسم الرسمي للشركة، رقم السجل، الرقم الضريبي، العنوان. دلوقتي **فاضية عن قصد**، والفاتورة بتسيب مكانها فاضي. من `/admin` → UI Customizer.
- [ ] **بيانات الاستلام ومواعيد العمل** — `/admin` → UI Customizer → Pickup & Delivery Times.
- [ ] **أخفي المنتجات التجريبية** — `Diaa Test`، `Diaa test2`، `Diaa-Test 5` كلهم ظاهرين للزباين دلوقتي. من محرر المنتج → مفتاح **Visible in the shop**.
- [ ] **صور المنتجات الحقيقية** بدل الصور المؤقتة.
- [ ] **راجع الأسعار** — الأسعار الحالية محوّلة تقديرياً من منافسين، مش أسعارك.
- [ ] **مفتاح Mollie الحقيقي** بعد ما التوثيق يخلص.
- [ ] **بريد على الدومين** (`info@` و `order@`) بدل الجيميل.

---

## ملخص الأوامر

```bash
npm ci                                   # تثبيت
npm run build                            # بناء
npm run verify                           # فحص الكود والترجمات
node scripts/preflight.mjs --online      # جاهز للإطلاق؟
npm run smoke <email> <pass>             # فحص سريع
node scripts/e2e/full-regression.mjs <email> <pass> [url]   # الفحص الشامل
node scripts/rules-status.mjs            # القواعد الشغالة = اللي عندي؟
node scripts/deploy-rules.mjs --apply    # انشر القواعد
NODE_ENV=production node dist/server.cjs # شغّل
```
