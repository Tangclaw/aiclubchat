/* ==========================================================================
   AIClub × CodeBuddy 风格交互层
   - 滚动显现（IntersectionObserver + MutationObserver，适配动态信息流）
   - 页头滚动态阴影
   - 主按钮点击涟漪
   - 主题切换全局缓动
   全程尊重 prefers-reduced-motion；无 JS 时页面行为与原版一致。
   ========================================================================== */
(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 页头滚动态 ---------- */
  function initHeaderState() {
    var header = document.querySelector(".site-header");
    if (!header) return;
    var ticking = false;
    function update() {
      ticking = false;
      header.classList.toggle("cb-scrolled", window.scrollY > 10);
    }
    window.addEventListener("scroll", function () {
      if (!ticking) {
        ticking = true;
        window.requestAnimationFrame(update);
      }
    }, { passive: true });
    update();
  }

  /* ---------- 主题切换缓动 ---------- */
  function initThemeFade() {
    if (reduceMotion.matches) return;
    var timer = 0;
    new MutationObserver(function (mutations) {
      for (var i = 0; i < mutations.length; i += 1) {
        if (mutations[i].attributeName === "data-theme") {
          document.documentElement.classList.add("cb-theme-fade");
          window.clearTimeout(timer);
          timer = window.setTimeout(function () {
            document.documentElement.classList.remove("cb-theme-fade");
          }, 360);
          break;
        }
      }
    }).observe(document.documentElement, { attributes: true });
  }

  /* ---------- 点击涟漪 ---------- */
  function initRipple() {
    if (reduceMotion.matches) return;
    document.addEventListener("pointerdown", function (event) {
      var target = event.target;
      if (!(target instanceof Element)) return;
      var button = target.closest(".primary-button, .feed-top-button");
      if (!button || button.disabled) return;
      var rect = button.getBoundingClientRect();
      if (rect.width < 20) return;
      button.classList.add("cb-ripple-host");
      var size = Math.max(rect.width, rect.height);
      var ripple = document.createElement("span");
      ripple.className = "cb-ripple";
      ripple.style.width = ripple.style.height = size + "px";
      ripple.style.left = (event.clientX - rect.left - size / 2) + "px";
      ripple.style.top = (event.clientY - rect.top - size / 2) + "px";
      ripple.addEventListener("animationend", function () { ripple.remove(); });
      button.appendChild(ripple);
    }, { passive: true });
  }

  /* ---------- 滚动显现 ---------- */
  var REVEAL_SELECTOR = [
    ".rail-section",
    ".continuation-card",
    ".empty-state",
    ".return-visit-boundary",
    ".compute-flow-section",
    ".hot-debates",
    ".hot-topics",
    ".active-agents",
    ".signal-lens"
  ].join(",");

  /* 已有独立入场动画的元素不重复施加 */
  var SKIP_CLASS = /is-entering|provider-row-enter|hall-seat-enter/;

  function initReveal() {
    if (reduceMotion.matches) return;
    document.documentElement.classList.add("cb-anim");

    var observer = new IntersectionObserver(function (entries) {
      var batch = 0;
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        observer.unobserve(el);
        el.style.setProperty("--cb-delay", Math.min(batch * 55, 330) + "ms");
        batch += 1;
        el.classList.add("cb-in");
        el.addEventListener("animationend", function cleanup() {
          el.removeEventListener("animationend", cleanup);
          el.classList.remove("cb-reveal", "cb-in");
          el.style.removeProperty("--cb-delay");
        });
      });
    }, { threshold: 0.06, rootMargin: "0px 0px -6% 0px" });

    function tag(scope) {
      var nodes = scope.matches && scope.matches(REVEAL_SELECTOR)
        ? [scope]
        : Array.prototype.slice.call((scope.querySelectorAll
            ? scope.querySelectorAll(REVEAL_SELECTOR)
            : []));
      nodes.forEach(function (el) {
        if (el.classList.contains("cb-reveal")) return;
        if (SKIP_CLASS.test(el.className)) return;
        el.classList.add("cb-reveal");
        observer.observe(el);
      });
    }

    if (document.body) tag(document.body);

    /* 信息流是动态渲染的，监听新增节点 */
    var scheduled = false;
    var pending = [];
    new MutationObserver(function (mutations) {
      mutations.forEach(function (m) {
        m.addedNodes.forEach(function (node) {
          if (node.nodeType === 1) pending.push(node);
        });
      });
      if (scheduled || !pending.length) return;
      scheduled = true;
      window.requestAnimationFrame(function () {
        scheduled = false;
        var list = pending.splice(0, pending.length);
        list.forEach(tag);
      });
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function init() {
    initHeaderState();
    initThemeFade();
    initRipple();
    initReveal();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
