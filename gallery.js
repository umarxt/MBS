/* =====================================================================
 *  منطق معرض الصور
 *  - يجلب قائمة الصور من Google Apps Script عبر JSONP (بدون مشاكل CORS)
 *  - يعرضها في شبكة أنيقة + Lightbox مع تحميل بأعلى جودة
 * ===================================================================== */
(function () {
  "use strict";

  var CFG = window.GALLERY_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };

  /* روابط صور Google Drive (الملف يجب أن يكون عاماً: أي شخص لديه الرابط) */
  function displayUrl(id, w) { return "https://lh3.googleusercontent.com/d/" + id + "=w" + (w || 1600); }
  function originalUrl(id) { return "https://drive.usercontent.google.com/download?id=" + id + "&export=download&confirm=t"; }

  var IMAGES = [];
  var current = 0;

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

  /* ---------------------- هيكل التحميل (skeletons) ---------------------- */
  function showSkeletons() {
    var grid = $("grid");
    var heights = [260, 340, 220, 400, 300, 250, 360, 280, 320, 240, 380, 300];
    var html = "";
    for (var i = 0; i < heights.length; i++) {
      html += '<div class="sk skeleton" style="height:' + heights[i] + 'px"></div>';
    }
    grid.innerHTML = html;
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

  /* ---------------------- جلب الصور عبر JSONP ---------------------- */
  function fetchImages() {
    var url = (CFG.WEB_APP_URL || "").trim();
    if (!url) {
      showState("setup", "خطوة أخيرة قبل الانطلاق",
        'لم يُضبط رابط مصدر الصور بعد. افتح ملف <code>config.js</code> وضع رابط الـ Web App في <code>WEB_APP_URL</code> بعد نشر Google Apps Script (التفاصيل في README).');
      return;
    }

    showSkeletons();

    var cbName = "__gallery_cb_" + Date.now();
    var done = false;
    var script = document.createElement("script");

    var timer = setTimeout(function () {
      if (done) return;
      cleanup();
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
        showState("error", "تعذّر تحميل الصور", (data && data.error) || "استجابة غير متوقعة من الخادم.");
        return;
      }
      IMAGES = (data.images || []).filter(function (im) { return im && im.id; });
      if (!IMAGES.length) {
        showState("empty", "المعرض فارغ حالياً", "لا توجد صور في المجلد بعد. أضف الصور إلى مجلد Google Drive وستظهر هنا تلقائياً.");
        return;
      }
      renderGrid();
    };

    script.src = url + (url.indexOf("?") === -1 ? "?" : "&") + "callback=" + cbName + "&t=" + Date.now();
    script.onerror = function () {
      if (done) return;
      cleanup();
      showState("error", "تعذّر الوصول للمصدر",
        "لم نتمكن من الاتصال برابط الـ Web App. تأكد من صحة الرابط وصلاحيات النشر.");
    };
    document.head.appendChild(script);
  }

  /* ---------------------- رسم الشبكة ---------------------- */
  function renderGrid() {
    $("state-slot").innerHTML = "";
    var grid = $("grid");
    grid.innerHTML = "";

    var frag = document.createDocumentFragment();
    IMAGES.forEach(function (im, i) {
      var card = document.createElement("div");
      card.className = "card";
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
      card.setAttribute("aria-label", "عرض الصورة " + (i + 1));
      card.innerHTML =
        '<img loading="lazy" decoding="async" src="' + displayUrl(im.id, 800) + '" alt="' + escapeHtml(im.name || ("صورة " + (i + 1))) + '" />' +
        '<div class="veil"><span class="peek">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
          '<path d="M15 3h6v6M14 10l7-7M9 21H3v-6M10 14l-7 7"/></svg>' +
        '</span></div>';

      var open = function () { openLightbox(i); };
      card.addEventListener("click", open);
      card.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
      });

      var img = card.querySelector("img");
      img.addEventListener("load", function () { card.classList.add("in"); });
      img.addEventListener("error", function () {
        // fallback لصيغة رابط بديلة إن فشل lh3
        if (!img.dataset.fbk) { img.dataset.fbk = "1"; img.src = "https://drive.google.com/thumbnail?id=" + im.id + "&sz=w800"; }
        else { card.classList.add("in"); }
      });

      frag.appendChild(card);
    });
    grid.appendChild(frag);

    var n = IMAGES.length;
    $("count").innerHTML = "<b>" + n + "</b> " + (n === 1 ? "صورة" : n === 2 ? "صورتان" : n <= 10 ? "صور" : "صورة");
    $("topCount").textContent = n + " صورة";

    // كشف تدريجي للبطاقات التي حُمّلت من الكاش فوراً
    setTimeout(function () {
      grid.querySelectorAll(".card").forEach(function (c) {
        var im = c.querySelector("img");
        if (im && im.complete) c.classList.add("in");
      });
    }, 100);
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
    var pre = new Image(); pre.src = displayUrl(IMAGES[i].id, 2000);
  }

  function stripExt(name) { return String(name).replace(/\.[a-z0-9]+$/i, ""); }

  function next() { current = (current + 1) % IMAGES.length; loadSlide(); }
  function prev() { current = (current - 1 + IMAGES.length) % IMAGES.length; loadSlide(); }

  /* ---------------------- تحميل بأعلى جودة ---------------------- */
  function downloadCurrent() {
    var im = IMAGES[current];
    if (!im) return;
    var btn = $("lbDownload");
    btn.classList.add("busy");

    var a = document.createElement("a");
    a.href = originalUrl(im.id);
    a.download = im.name || ("photo-" + (current + 1) + ".jpg");
    a.target = "_blank";
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    showToast("جارٍ تحميل الصورة بأعلى جودة");
    setTimeout(function () { btn.classList.remove("busy"); }, 1200);
  }

  /* ---------------------- توست ---------------------- */
  var toastTimer;
  function showToast(msg) {
    var t = $("toast");
    t.innerHTML = "✓ &nbsp;" + msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2600);
  }

  /* ---------------------- ربط الأحداث ---------------------- */
  function bindEvents() {
    $("lbClose").addEventListener("click", closeLightbox);
    $("lbNext").addEventListener("click", next);
    $("lbPrev").addEventListener("click", prev);
    $("lbDownload").addEventListener("click", downloadCurrent);

    lb.addEventListener("click", function (e) {
      if (e.target === lb || e.target.classList.contains("lb-stage")) closeLightbox();
    });

    document.addEventListener("keydown", function (e) {
      if (!lb.classList.contains("open")) return;
      if (e.key === "Escape") closeLightbox();
      else if (e.key === "ArrowLeft") next();   // RTL: يسار = التالي
      else if (e.key === "ArrowRight") prev();
      else if (e.key === "d" || e.key === "D") downloadCurrent();
    });

    // السحب على الجوال
    var sx = 0;
    lb.addEventListener("touchstart", function (e) { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener("touchend", function (e) {
      var dx = e.changedTouches[0].clientX - sx;
      if (Math.abs(dx) > 55) { dx < 0 ? prev() : next(); } // RTL
    }, { passive: true });
  }

  /* ---------------------- إقلاع ---------------------- */
  applyConfig();
  initTopbar();
  bindEvents();
  fetchImages();
})();
