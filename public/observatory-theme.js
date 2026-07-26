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
})();
