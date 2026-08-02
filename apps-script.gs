/**
 * =====================================================================
 *  Google Apps Script — مصدر صور معرض الزواج
 * =====================================================================
 *  الوظيفة: يقرأ صور مجلد Google Drive ويعيدها كقائمة JSON/JSONP
 *  يستهلكها الموقع (gallery.js) لعرضها.
 *
 *  خطوات النشر:
 *  ------------------------------------------------------------------
 *  1) افتح https://script.google.com واضغط: مشروع جديد (New project)
 *  2) احذف الكود الموجود والصق هذا الملف بالكامل.
 *  3) ضع مُعرّف مجلد الدرايف في FOLDER_ID بالأسفل:
 *       - افتح مجلد الصور في Google Drive
 *       - انظر إلى الرابط:
 *         https://drive.google.com/drive/folders/XXXXXXXXXXXXXXXXX
 *         الجزء XXXX... هو FOLDER_ID
 *  4) تأكد أن المجلد (والصور بداخله) عام:
 *       زر مشاركة ← "أي شخص لديه الرابط" ← مُشاهِد (Viewer)
 *  5) اضغط: Deploy ← New deployment ← Type: Web app
 *       - Execute as:  Me (أنت)
 *       - Who has access:  Anyone   ← مهم
 *  6) انسخ رابط الـ Web App (ينتهي بـ /exec)
 *       والصقه في ملف config.js داخل WEB_APP_URL.
 *
 *  ملاحظة: عند إضافة/حذف صور من المجلد لاحقاً تظهر التغييرات تلقائياً
 *  (خلال دقائق بسبب التخزين المؤقت). لتفريغ الكاش فوراً: أعد النشر أو
 *  افتح الرابط مضيفاً ?nocache=1
 * =====================================================================
 */

// ⬇️ ضع مُعرّف مجلد الدرايف هنا
var FOLDER_ID = "PUT_YOUR_FOLDER_ID_HERE";

// مدة التخزين المؤقت بالثواني (لتسريع التحميل وتقليل الضغط)
var CACHE_SECONDS = 300;

function doGet(e) {
  var params = (e && e.parameter) || {};
  var callback = params.callback;

  var payload;
  try {
    payload = { ok: true, count: 0, images: listImages(params.nocache === "1") };
    payload.count = payload.images.length;
  } catch (err) {
    payload = { ok: false, error: String(err && err.message ? err.message : err) };
  }

  var json = JSON.stringify(payload);

  // JSONP إن طُلب callback (يتفادى قيود CORS)، وإلا JSON عادي
  if (callback) {
    return ContentService
      .createTextOutput(sanitizeCb(callback) + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService
    .createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}

/** يقرأ صور المجلد (مع تخزين مؤقت) ويعيد مصفوفة {id, name, mime, size} */
function listImages(skipCache) {
  var cache = CacheService.getScriptCache();
  var key = "gallery_" + FOLDER_ID;

  if (!skipCache) {
    var hit = cache.get(key);
    if (hit) return JSON.parse(hit);
  }

  if (!FOLDER_ID || FOLDER_ID === "PUT_YOUR_FOLDER_ID_HERE") {
    throw new Error("لم يُضبط FOLDER_ID في سكربت Apps Script.");
  }

  var folder = DriveApp.getFolderById(FOLDER_ID);
  var it = folder.getFiles();
  var out = [];

  while (it.hasNext()) {
    var f = it.next();
    var mime = f.getMimeType();
    if (mime && mime.indexOf("image/") === 0) {
      out.push({
        id: f.getId(),
        name: f.getName(),
        mime: mime,
        size: f.getSize(),
        // للترتيب حسب أحدث إضافة إن رغبت
        created: f.getDateCreated().getTime()
      });
    }
  }

  // ترتيب حسب الاسم تصاعدياً (أرقام الصور بالترتيب) — عدّله لو تبي حسب التاريخ
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), "ar", { numeric: true });
  });

  // لا نُرسل حجم/تاريخ للواجهة (غير مطلوب) — نبقيها خفيفة
  var light = out.map(function (o) { return { id: o.id, name: o.name, mime: o.mime }; });

  try { cache.put(key, JSON.stringify(light), CACHE_SECONDS); } catch (e) {}
  return light;
}

/** يمنع أي محارف غريبة في اسم دالة الـ callback */
function sanitizeCb(cb) {
  return String(cb).replace(/[^a-zA-Z0-9_$.]/g, "").slice(0, 64) || "callback";
}

/** اختباري: شغّله من المحرر لرؤية عدد الصور في السجل (Logs) */
function _test() {
  var imgs = listImages(true);
  Logger.log("عدد الصور: " + imgs.length);
  if (imgs.length) Logger.log(imgs[0]);
}
