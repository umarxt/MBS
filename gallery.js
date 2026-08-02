/* =====================================================================
 *  منطق معرض الصور
 *  - يجلب قائمة الصور من Google Apps Script عبر JSONP (بدون مشاكل CORS)
 *  - يعرضها في شبكة Masonry أنيقة (توزيع «أقصر عمود» مثل بينتريست)
 *  - يحجز أبعاد كل صورة مسبقاً فلا يحدث أي «قفز» في التخطيط
 *  - كاش في المتصفح: التحديث/الرجوع للصفحة يظهر فوراً وبثبات
 *  - Lightbox + زر تحميل يحفظ الصورة في معرض الجوال (iOS و Android)
 * ===================================================================== */
(function () {
  "use strict";

  var CFG = window.GALLERY_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  /* روابط صور Google Drive (الملف يجب أن يكون عاماً: أي شخص لديه الرابط) */
  function displayUrl(id, w) { return "https://lh3.googleusercontent.com/d/" + id + "=w" + (w || 1600); }
  function originalUrl(id) { return "https://drive.usercontent.google.com/download?id=" + id + "&export=download&confirm=t"; }
  /* مصادر مرتّبة بأعلى جودة للتحميل — نجرّبها بالترتيب (lh3 عادةً يسمح CORS) */
  function hqSources(id) {
    return [
      "https://lh3.googleusercontent.com/d/" + id + "=s0",      // الأصلية بكامل الأبعاد عبر lh3
      "https://lh3.googleusercontent.com/d/" + id + "=w2400",   // كبيرة جداً كخيار ثانٍ
      originalUrl(id)                                           // تنزيل مباشر من الدرايف
    ];
  }

  var IMAGES = [];
  var current = 0;
  var lastCols = 0;
  var CACHE_KEY = "mbs_gallery_v1";

  /* ---------------------- تطبيق نصوص الإعدادات ---------------------- */
  function applyConfig() {
    if (CFG.pageTitle) document.title = CFG.pageTitle;
    if (CFG.eyebrow) $("eyebrow").textContent = CFG.eyebrow;
    if (CFG.eventDate) $("eventDate").textContent = CFG.eventDate;
    if (CFG.subtitle) $("subtitle").textContent = CFG.subtitle;
    if (CFG.coupleNames) {
      // نستبدل الاسم مع الحفاظ على رمز "&" الذهبي إن وُجد
      var parts = CFG.coupleNames.split(/\s*&\s*/);
      if (parts.length === 2) {
        $("names").innerHTML = escapeHtml(parts[0]) + ' <span class="amp">&amp;</span> ' + escapeHtml(parts[1]);
      } else {
        $("names").textContent = CFG.coupleNames;
      }
      $("footNames").textContent = CFG.coupleNames;
    }
    fitName();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitName);
    window.addEventListener("resize", debounce(fitName, 120), { passive: true });
  }

  /* يبقي اسم العنوان في صف واحد ويضبط حجمه ليملأ العرض المتاح دون تجاوز الشاشة */
  function fitName() {
    var el = $("names");
    if (!el) return;
    var parent = el.parentElement;
    el.style.whiteSpace = "nowrap";
    el.style.fontSize = "";              // ارجع لحجم CSS الأساسي ثم قِس
    var maxW = parseFloat(getComputedStyle(parent).maxWidth) || Infinity;
    var viewport = document.documentElement.clientWidth - 48;   // 24px هامش لكل جهة
    var avail = Math.min(maxW, viewport);
    var w = el.scrollWidth;
    if (!avail || !w) return;
    var cur = parseFloat(getComputedStyle(el).fontSize);
    var size = cur * (avail / w) * 0.98;
    size = Math.max(15, Math.min(104, size));
    el.style.fontSize = size + "px";
  }

  function debounce(fn, ms) {
    var t; return function () { clearTimeout(t); t = setTimeout(fn, ms); };
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  /* ---------------------- شريط علوي عند التمرير ---------------------- */
  function initTopbar() {
    var bar = $("topbar");
    var onScroll = function () { bar.classList.toggle("scrolled", window.scrollY > 60); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }

  /* ---------------------- عدد الأعمدة حسب عرض الشاشة ---------------------- */
  function colCount() {
    var w = document.documentElement.clientWidth;
    if (w <= 640) return 2;    // الجوال: عمودان (توزيع مثل بينتريست، لا صفّ واحد)
    if (w <= 1000) return 3;   // اللوحي
    return 4;                  // الحاسوب
  }

  /* ---------------------- هيكل التحميل (skeletons) بشكل أعمدة ---------------------- */
  function showSkeletons() {
    var grid = $("grid");
    if (!grid) return;
    var cols = colCount();
    var ratios = [1.3, 0.75, 1.5, 1.0, 1.25, 0.8, 1.45, 1.1, 1.35, 0.9, 1.5, 1.15];
    grid.className = "grid";
    grid.innerHTML = "";
    var colEls = [], h = [], c;
    for (c = 0; c < cols; c++) {
      var d = document.createElement("div"); d.className = "col";
      grid.appendChild(d); colEls.push(d); h.push(0);
    }
    for (var i = 0; i < cols * 3; i++) {
      var r = ratios[i % ratios.length];
      var min = 0; for (c = 1; c < cols; c++) if (h[c] < h[min]) min = c;
      h[min] += r;
      var sk = document.createElement("div");
      sk.className = "card is-loading in";
      sk.style.aspectRatio = "1 / " + r;
      colEls[min].appendChild(sk);
    }
  }

  /* ---------------------- حالات (إعداد/خطأ/فارغ) ---------------------- */
  function showState(kind, title, msg) {
    $("grid").innerHTML = "";
    $("count").textContent = "";
    var icons = {
      setup: '<path d="M12 3v18M3 12h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      error: '<path d="M12 9v4m0 4h.01M10.3 3.9 2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
      empty: '<path d="M4 5h16v14H4zM4 15l4-4 3 3 4-5 5 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
    };
    $("state-slot").innerHTML =
      '<div class="state">' +
        '<div class="ic"><svg viewBox="0 0 24 24">' + (icons[kind] || icons.error) + '</svg></div>' +
        '<h3>' + title + '</h3>' +
        '<p>' + msg + '</p>' +
      '</div>';
  }

  /* ---------------------- كاش المتصفح (localStorage) ---------------------- */
  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.url !== (CFG.WEB_APP_URL || "").trim() || !Array.isArray(o.images) || !o.images.length) return null;
      return o.images;
    } catch (e) { return null; }
  }
  function writeCache(imgs) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({
        v: 1, url: (CFG.WEB_APP_URL || "").trim(), ts: Date.now(),
        images: imgs.map(function (im) { return { id: im.id, name: im.name, mime: im.mime, r: im.r }; })
      }));
    } catch (e) {}
  }
  function signature(list) { return (list || []).map(function (im) { return im.id; }).join(","); }

  /* ---------------------- جلب الصور عبر JSONP ---------------------- */
  function fetchImages(background) {
    var url = (CFG.WEB_APP_URL || "").trim();
    if (!url) {
      if (!background) showState("setup", "خطوة أخيرة قبل الانطلاق",
        'لم يُضبط رابط مصدر الصور بعد. افتح ملف <code>config.js</code> وضع رابط الـ Web App في <code>WEB_APP_URL</code> بعد نشر Google Apps Script (التفاصيل في README).');
      return;
    }

    if (!background) showSkeletons();

    var cbName = "__gallery_cb_" + Date.now();
    var done = false;
    var script = document.createElement("script");

    var timer = setTimeout(function () {
      if (done) return;
      cleanup();
      if (background) return;   // لا نُخرّب المعرض المعروض من الكاش
      showState("error", "تعذّر تحميل الصور",
        "انتهت مهلة الاتصال. تأكد من صحة رابط الـ Web App وأنه منشور بصلاحية «أي شخص».");
    }, 20000);

    function cleanup() {
      done = true;
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      if (script.parentNode) script.parentNode.removeChild(script);
    }

    window[cbName] = function (data) {
      cleanup();
      if (!data || data.ok === false) {
        if (background) return;
        showState("error", "تعذّر تحميل الصور", (data && data.error) || "استجابة غير متوقعة من الخادم.");
        return;
      }
      var incoming = (data.images || []).filter(function (im) { return im && im.id; });
      if (!incoming.length) {
        if (background) return;
        showState("empty", "المعرض فارغ حالياً", "لا توجد صور في المجلد بعد. أضف الصور إلى مجلد Google Drive وستظهر هنا تلقائياً.");
        return;
      }

      // إن كنا نعرض من الكاش والقائمة لم تتغيّر → لا نُعيد البناء (ثبات تام)
      if (background && signature(incoming) === signature(IMAGES)) return;

      IMAGES = incoming;
      $("state-slot").innerHTML = "";
      ensureRatios(IMAGES, function () {
        buildMasonry();
        writeCache(IMAGES);
      });
    };

    script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "callback=" + cbName + "&t=" + Date.now();
    script.onerror = function () {
      if (done) return;
      cleanup();
      if (background) return;
      showState("error", "تعذّر الوصول للمصدر",
        "لم نتمكن من الاتصال برابط الـ Web App. تأكد من صحة الرابط وصلاحيات النشر.");
    };
    document.head.appendChild(script);
  }

  /* ---------------------- ضمان معرفة أبعاد كل صورة (نسبة الطول/العرض) ----------------------
   * أولوية: أبعاد من الخادم (w,h) ← ثم كاش (r) ← ثم قياس مصغّرة صغيرة جداً.
   * حجز الأبعاد مسبقاً هو ما يمنع «قفز» الصور ويسمح بتوزيع Masonry مثالي. */
  function ensureRatios(list, cb) {
    var pending = 0, finished = false;
    var timer = setTimeout(function () {
      if (finished) return;
      finished = true;
      list.forEach(function (im) { if (!validRatio(im.r)) im.r = 1.25; });
      cb();
    }, 6000);

    function finish() {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      cb();
    }

    list.forEach(function (im) {
      if (validRatio(im.r)) return;
      if (im.w && im.h) { im.r = im.h / im.w; return; }
      pending++;
      var probe = new Image();
      probe.referrerPolicy = "no-referrer";
      var settle = function (ratio) {
        if (finished) return;
        im.r = validRatio(ratio) ? ratio : 1.25;
        if (--pending === 0) finish();
      };
      probe.onload = function () { settle(probe.naturalHeight / probe.naturalWidth); };
      probe.onerror = function () { settle(1.25); };
      probe.src = displayUrl(im.id, 120);   // مصغّرة صغيرة جداً — تكفي لمعرفة النسبة فقط
    });

    if (pending === 0) finish();
  }
  function validRatio(r) { return typeof r === "number" && isFinite(r) && r > 0.05 && r < 20; }

  /* ---------------------- بناء شبكة Masonry (توزيع «أقصر عمود») ---------------------- */
  function buildMasonry() {
    var grid = $("grid");
    if (!grid) return;
    lastCols = colCount();
    var cols = lastCols;

    grid.className = "grid";
    grid.innerHTML = "";
    var colEls = [], h = [], c;
    for (c = 0; c < cols; c++) {
      var d = document.createElement("div"); d.className = "col";
      grid.appendChild(d); colEls.push(d); h.push(0);
    }

    IMAGES.forEach(function (im, i) {
      var r = validRatio(im.r) ? im.r : 1.25;
      // ضع الصورة في العمود الأقصر حالياً → توزيع متوازن أنيق (الطولية تتوزّع بين العرضية)
      var min = 0; for (c = 1; c < cols; c++) if (h[c] < h[min]) min = c;
      h[min] += r;
      colEls[min].appendChild(makeCard(im, i, r));
    });

    // ظهور أنيق متدرّج (على الإطارات المحجوزة → بلا أي قفز)
    var cards = grid.querySelectorAll(".card");
    requestAnimationFrame(function () {
      cards.forEach(function (card, idx) {
        var delay = Math.min(idx * 22, 480);
        card.style.transitionDelay = delay + "ms";
        card.classList.add("in");
        // نُزيل التأخير بعد الظهور حتى لا يؤثر على انتقالات المرور (hover)
        setTimeout(function () { card.style.transitionDelay = ""; }, delay + 800);
      });
    });

    updateCounts();
  }

  function makeCard(im, i, r) {
    var card = document.createElement("div");
    card.className = "card is-loading";
    card.style.aspectRatio = "1 / " + r;   // حجز الأبعاد (العرض/الطول) قبل تحميل الصورة
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", "عرض الصورة " + (i + 1));

    var img = document.createElement("img");
    img.loading = "lazy"; img.decoding = "async"; img.referrerPolicy = "no-referrer";
    img.alt = im.name || ("صورة " + (i + 1));
    img.src = displayUrl(im.id, 800);
    img.addEventListener("load", function () { card.classList.remove("is-loading"); img.classList.add("show"); });
    img.addEventListener("error", function () {
      if (!img.dataset.fbk) { img.dataset.fbk = "1"; img.src = "https://drive.google.com/thumbnail?id=" + im.id + "&sz=w800"; }
      else { card.classList.remove("is-loading"); img.classList.add("show"); }
    });
    card.appendChild(img);

    var veil = document.createElement("div");
    veil.className = "veil";
    // زر تحميل خاص على كل صورة (بدون فتح العارض)
    var dl = document.createElement("button");
    dl.className = "veil-btn dl"; dl.type = "button";
    dl.setAttribute("aria-label", "تحميل الصورة");
    dl.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>';
    dl.addEventListener("click", function (e) { e.stopPropagation(); saveImage(i, dl); });
    var peek = document.createElement("span");
    peek.className = "peek";
    peek.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/></svg>';
    veil.appendChild(dl);
    veil.appendChild(peek);
    card.appendChild(veil);

    var open = function () { openLightbox(i); };
    card.addEventListener("click", open);
    card.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
    return card;
  }

  function updateCounts() {
    var n = IMAGES.length;
    $("count").innerHTML = "<b>" + n + "</b> " + (n === 1 ? "صورة" : n === 2 ? "صورتان" : n <= 10 ? "صور" : "صورة");
    $("topCount").textContent = n + " صورة";
  }

  /* ---------------------- Lightbox ---------------------- */
  var lb = $("lb"), lbImg = $("lbImg"), lbSpin = $("lbSpin");

  function openLightbox(i) {
    current = i;
    lb.classList.add("open");
    document.body.style.overflow = "hidden";
    loadSlide();
  }

  function closeLightbox() {
    lb.classList.remove("open");
    document.body.style.overflow = "";
    lbImg.removeAttribute("src");
  }

  function loadSlide() {
    var im = IMAGES[current];
    if (!im) return;
    lbImg.classList.remove("ready");
    lbSpin.style.display = "block";

    var loader = new Image();
    loader.referrerPolicy = "no-referrer";
    loader.onload = function () {
      lbImg.src = loader.src;
      lbImg.alt = im.name || "";
      lbImg.classList.add("ready");
      lbSpin.style.display = "none";
      preload(current + 1); preload(current - 1);
    };
    loader.onerror = function () {
      lbImg.src = "https://drive.google.com/thumbnail?id=" + im.id + "&sz=w2000";
      lbImg.classList.add("ready");
      lbSpin.style.display = "none";
    };
    loader.src = displayUrl(im.id, 2000);

    var n = IMAGES.length;
    $("lbCaption").innerHTML = "<b>" + (current + 1) + "</b> / " + n +
      (im.name ? " · " + escapeHtml(stripExt(im.name)) : "");
  }

  function preload(i) {
    if (i < 0 || i >= IMAGES.length) return;
    var pre = new Image(); pre.referrerPolicy = "no-referrer"; pre.src = displayUrl(IMAGES[i].id, 2000);
  }

  function stripExt(name) { return String(name).replace(/\.[a-z0-9]+$/i, ""); }

  function next() { current = (current + 1) % IMAGES.length; loadSlide(); }
  function prev() { current = (current - 1 + IMAGES.length) % IMAGES.length; loadSlide(); }

  /* ---------------------- تحميل بأعلى جودة + حفظ في معرض الجوال ----------------------
   * الاستراتيجية:
   *  1) نجلب الصورة كـ Blob بأعلى جودة (نجرّب عدة مصادر).
   *  2) على الجوال: نستخدم Web Share API → على iOS يظهر «حفظ الصورة» (يذهب للصور)،
   *     وعلى Android «حفظ في المعرض/تنزيل». هذه أضمن طريقة للحفظ في معرض الجوال.
   *  3) على الحاسوب أو إن تعذّر المشاركة: تنزيل مباشر عبر Blob.
   *  4) إن فشل الجلب (CORS/شبكة): نفتح الرابط المباشر (على iOS: اضغط مطوّلاً ثم «حفظ الصورة»). */
  function isIOS() {
    return /iP(hone|ad|od)/i.test(navigator.userAgent) ||
      (/Mac/i.test(navigator.platform || navigator.userAgent) && navigator.maxTouchPoints > 1);
  }
  function isMobile() {
    try { return (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) || /Android|iP(hone|ad|od)/i.test(navigator.userAgent); }
    catch (e) { return /Android|iP(hone|ad|od)/i.test(navigator.userAgent); }
  }
  function canShareFile(file) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [file] })); }
    catch (e) { return false; }
  }

  function downloadName(im, index) {
    var base = im && im.name ? String(im.name) : ("photo-" + (index + 1));
    if (!/\.[a-z0-9]{2,5}$/i.test(base)) base += ".jpg";
    return base.replace(/[\/\\:*?"<>|]/g, "_");
  }

  function triggerAnchor(href, name, blob) {
    var a = document.createElement("a");
    a.href = href;
    a.download = name;
    a.rel = "noopener";
    if (!blob) a.target = "_blank";   // للرابط الخارجي فقط (blob يُنزّل مباشرة)
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  function fetchBlob(im) {
    var srcs = hqSources(im.id);
    var i = 0;
    function tryNext() {
      if (i >= srcs.length) return Promise.resolve(null);
      var src = srcs[i++];
      return fetch(src, { mode: "cors", credentials: "omit" })
        .then(function (res) {
          if (!res || !res.ok) return tryNext();
          return res.blob().then(function (b) {
            if (b && b.size > 1000) return b;
            return tryNext();
          });
        })
        .catch(function () { return tryNext(); });
    }
    return tryNext();
  }

  function finishBtn(btn) { if (btn) setTimeout(function () { btn.classList.remove("busy"); }, 800); }

  function saveImage(index, btn) {
    var im = IMAGES[index];
    if (!im) return;
    if (btn) btn.classList.add("busy");
    var name = downloadName(im, index);
    showToast("جارٍ تجهيز الصورة بأعلى جودة…");

    fetchBlob(im).then(function (blob) {
      if (blob) {
        var file = null;
        try { file = new File([blob], name, { type: blob.type || "image/jpeg" }); } catch (e) { file = null; }

        // على الجوال: مشاركة الملف → حفظ في معرض الصور
        if (file && isMobile() && canShareFile(file)) {
          navigator.share({ files: [file], title: name })
            .then(function () { showToast("افتح «حفظ الصورة» لحفظها في معرض جهازك"); finishBtn(btn); })
            .catch(function (err) {
              if (err && err.name === "AbortError") { hideToast(); finishBtn(btn); return; }
              // تعذّرت المشاركة → بديل حسب النظام
              if (isIOS()) {
                var u1 = URL.createObjectURL(blob);
                triggerAnchor(u1, name, true);
                setTimeout(function () { URL.revokeObjectURL(u1); }, 15000);
                showToast("لحفظها في الصور: اضغط مطوّلاً على الصورة ثم «حفظ الصورة»");
              } else {
                var u2 = URL.createObjectURL(blob);
                triggerAnchor(u2, name, true);
                setTimeout(function () { URL.revokeObjectURL(u2); }, 15000);
                showToast("تم حفظ الصورة في جهازك");
              }
              finishBtn(btn);
            });
          return;
        }

        // الحاسوب أو جوال لا يدعم مشاركة الملفات: تنزيل مباشر عبر Blob
        var u = URL.createObjectURL(blob);
        triggerAnchor(u, name, true);
        setTimeout(function () { URL.revokeObjectURL(u); }, 15000);
        showToast("تم حفظ الصورة في جهازك");
        finishBtn(btn);
        return;
      }

      // فشل الجلب (CORS/شبكة): بديل نهائي عبر الرابط المباشر
      triggerAnchor(originalUrl(im.id), name, false);
      showToast(isIOS()
        ? "لحفظها في الصور: اضغط مطوّلاً على الصورة ثم «حفظ الصورة»"
        : "بدأ تنزيل الصورة بأعلى جودة");
      finishBtn(btn);
    });
  }

  /* ---------------------- توست ---------------------- */
  var toastTimer;
  function showToast(msg) {
    var t = $("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 3200);
  }
  function hideToast() {
    var t = $("toast");
    t.classList.remove("show");
    clearTimeout(toastTimer);
  }

  /* ---------------------- ربط الأحداث ---------------------- */
  function bindEvents() {
    $("lbClose").addEventListener("click", closeLightbox);
    $("lbNext").addEventListener("click", next);
    $("lbPrev").addEventListener("click", prev);
    $("lbDownload").addEventListener("click", function () { saveImage(current, $("lbDownload")); });

    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-stage")) closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") next();   // RTL: يسار = التالي
      else if (e.key === "ArrowRight") prev();
      else if (e.key === "d" || e.key === "D") saveImage(current, $("lbDownload"));
    });

    // السحب على الجوال
    var sx = 0;
    lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 55) { dx < 0 ? prev() : next(); } // RTL
    }, { passive: true });

    // إعادة التوزيع عند تغيّر عدد الأعمدة فقط (تغيّر العرض داخل نفس الفئة يتكفّل به aspect-ratio)
    window.addEventListener("resize", debounce(function () {
      if (!IMAGES.length) return;
      if (colCount() !== lastCols) buildMasonry();
    }, 160), { passive: true });
  }

  /* ---------------------- إقلاع ---------------------- */
  applyConfig();
  initTopbar();
  bindEvents();

  // اعرض من الكاش فوراً (تحديث/رجوع سريع وثابت) ثم راجع الخادم في الخلفية
  var cached = readCache();
  if (cached && cached.length) {
    IMAGES = cached;
    $("state-slot").innerHTML = "";
    buildMasonry();
    fetchImages(true);   // مراجعة صامتة في الخلفية
  } else {
    fetchImages(false);
  }
})();
