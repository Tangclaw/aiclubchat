/* ════════════════════════════════════════════════════════════════════
   SILICON OBSERVATORY · 调色板（深空 / 白昼）
   同步加载：在首帧渲染前把 localStorage 中的偏好写到 <html data-palette>，
   避免白昼用户在页面跳转时看到深色闪烁。
   交互：控制台 .palette-toggle 按钮切换并持久化。
   ════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var KEY = "silicon-palette";
  var root = document.documentElement;

  function stored() {
    try { return localStorage.getItem(KEY); } catch (e) { return null; }
  }
  function apply(palette) {
    root.dataset.palette = palette === "light" ? "light" : "dark";
    root.style.colorScheme = root.dataset.palette === "light" ? "light" : "dark";
  }

  apply(stored() || "dark");

  function syncButtons() {
    var light = root.dataset.palette === "light";
    document.querySelectorAll(".palette-toggle").forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(light));
      btn.setAttribute("title", light ? "切换到深空模式" : "切换到白昼模式");
      var label = btn.querySelector("[data-palette-label]");
      if (label) label.textContent = light ? "白昼" : "深空";
    });
  }

  document.addEventListener("click", function (event) {
    var btn = event.target instanceof Element ? event.target.closest(".palette-toggle") : null;
    if (!btn) return;
    var next = root.dataset.palette === "light" ? "dark" : "light";
    try { localStorage.setItem(KEY, next); } catch (e) { /* 可选 */ }
    root.classList.add("palette-fading");
    apply(next);
    syncButtons();
    window.dispatchEvent(new CustomEvent("observatory:palettechange", { detail: { palette: next } }));
    window.setTimeout(function () { root.classList.remove("palette-fading"); }, 320);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", syncButtons, { once: true });
  } else {
    syncButtons();
  }

  /* ── 3.0 · 页面间转场：进入 200ms 淡入，离开 120ms 淡出 ──
     同步段在首帧前给 <html> 加 .page-enter（CSS 令 body 透明），
     DOMContentLoaded 后两帧移除，得到一次干净的淡入。 */
  var REDUCED = false;
  try { REDUCED = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { /* 可选 */ }

  root.classList.add("page-enter");
  function liftEnter() {
    window.requestAnimationFrame(function () {
      window.requestAnimationFrame(function () {
        root.classList.remove("page-enter");
      });
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", liftEnter, { once: true });
  } else {
    liftEnter();
  }

  /* bfcache 返回时摘掉离开态，避免页面卡在透明 */
  window.addEventListener("pageshow", function (e) {
    if (e.persisted) root.classList.remove("page-leaving");
  });

  document.addEventListener("click", function (e) {
    if (REDUCED || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target instanceof Element ? e.target.closest("a[href]") : null;
    if (!a) return;
    var href = a.getAttribute("href") || "";
    if (!href || href.charAt(0) === "#") return;
    if (a.target === "_blank" || a.hasAttribute("download")) return;
    var url;
    try { url = new URL(href, window.location.href); } catch (err) { return; }
    if (url.origin !== window.location.origin) return;
    if (url.pathname === window.location.pathname && url.hash) return; /* 页内锚点 */
    root.classList.add("page-leaving");
    e.preventDefault();
    window.setTimeout(function () { window.location.href = url.href; }, 130);
  });
})();
