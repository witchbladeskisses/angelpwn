"use strict";
(function () {
  if (window.__PROTECT_JS__) return;
  window.__PROTECT_JS__ = true;

  const isMac = /Mac/i.test(navigator.platform || navigator.userAgent || "");
  const ready = (fn) => (document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn) : fn());
  const injectStyle = (css) => {
    const s = document.createElement("style");
    s.setAttribute("data-protectjs", "");
    s.textContent = css;
    (document.head || document.documentElement).appendChild(s);
    return s;
  };

  injectStyle(`
    html, body, main {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
    }
    .allow-select, .allow-select * {
      -webkit-user-select: text !important;
      -moz-user-select: text !important;
      -ms-user-select: text !important;
      user-select: text !important;
    }

    .copy-toast {
      position: fixed; bottom: 24px; right: 24px;
      background: rgba(0,0,0,0.82); color: #fff;
      padding: 8px 12px; border-radius: 6px;
      font: 500 13px system-ui, -apple-system, "Segoe UI", Roboto, Arial;
      box-shadow: 0 6px 18px rgba(0,0,0,0.35);
      opacity: 0; transform: translateY(8px);
      transition: opacity .2s ease, transform .2s ease;
      pointer-events: none; z-index: 10000;
    }
    .copy-toast.show { opacity: 1; transform: translateY(0); }

    .devtools-shield {
      position: fixed; inset: 0; display: none;
      align-items: center; justify-content: center; text-align: center;
      background: rgba(0,0,0,0.9); color: #fff; padding: 24px;
      z-index: 100000; backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
    }
    .devtools-shield.show { display: flex; }
    .devtools-shield .box {
      max-width: 560px;
      background: rgba(255,255,255,0.06);
      border: 1px solid rgba(255,255,255,0.18);
      border-radius: 12px; padding: 18px 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
    }
  `);

  let toastEl, toastTimer;
  let __kicked = false;
  const kickOut = () => {
    if (__kicked) return;
    __kicked = true;
    try { window.stop(); } catch (e) {}
    try { location.replace('about:blank'); } catch (e) {}
    try { location.href = 'about:blank'; } catch (e) {}
  };
  const showToast = (msg) => {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.className = "copy-toast";
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 1600);
  };

  const copyText = async (text) => {
    const value = (text || "").trim();
    if (!value) return;
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
    } else {
      const ta = document.createElement("textarea");
      ta.value = value;
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } finally { ta.remove(); }
    }
  };

  const allowSel = (el) => !!(el && (el.closest(".allow-select") || el.closest("input, textarea, [contenteditable=\"true\"]")));

  document.addEventListener("selectstart", (e) => { if (!allowSel(e.target)) e.preventDefault(); }, { capture: true });
  document.addEventListener("dragstart",  (e) => { if (!allowSel(e.target)) e.preventDefault(); }, { capture: true });
  document.addEventListener("copy",       (e) => { if (!allowSel(e.target)) { e.preventDefault(); showToast("Copying is disabled."); } }, { capture: true });
  document.addEventListener("cut",        (e) => { if (!allowSel(e.target)) { e.preventDefault(); showToast("Cutting is disabled."); } }, { capture: true });

  const getCopyText = (el) => {
    if (!el) return "";
    if (el.hasAttribute("data-copy")) return el.getAttribute("data-copy") || "";
    if (el.hasAttribute("data-copy-target")) {
      try {
        const sel = el.getAttribute("data-copy-target");
        const n = sel ? document.querySelector(sel) : null;
        if (!n) return "";
        return ("value" in n ? n.value : n.textContent) || "";
      } catch { return ""; }
    }
    if (el.hasAttribute("data-text")) return el.getAttribute("data-text") || "";
    return "";
  };

  document.addEventListener("contextmenu", async (e) => {
    const el = e.target && (e.target.closest("[data-copy]") || e.target.closest("[data-copy-target]") || e.target.closest("[data-text]"));
    if (el) {
      e.preventDefault();
      try {
        const txt = getCopyText(el);
        if (txt && txt.trim()) { await copyText(txt); showToast("Copied to clipboard."); }
        else { showToast("Nothing to copy."); }
      } catch { showToast("Failed to copy."); }
    } else {
      e.preventDefault();
      showToast("Context menu is disabled.");
    }
  }, { capture: true });

  document.addEventListener("keydown", (e) => {
    const ctrl = isMac ? e.metaKey : e.ctrlKey;
    const k = (e.key || "").toLowerCase();
    const stop = (why) => { e.preventDefault(); e.stopPropagation(); showToast(why || "Action blocked."); };
    if (e.key === "F12" || e.keyCode === 123) return stop("Action blocked.");
    if (ctrl && e.shiftKey && ["i", "j", "c"].includes(k)) return stop("Action blocked.");
    if (ctrl && ["u", "s", "p", "a", "c", "x"].includes(k)) return stop("Action blocked.");
    if (k === "printscreen") return stop("Action blocked.");
  }, { capture: true });

  ready(() => {
    const shield = document.createElement("div");
    shield.className = "devtools-shield";
    shield.innerHTML = '<div class="box">Developer tools detected. Access is blocked.</div>';
    document.body.appendChild(shield);

    const check = () => {
      const t = 160;
      const open = (window.outerWidth - window.innerWidth > t) || (window.outerHeight - window.innerHeight > t);
      if (open) {
        shield.classList.add("show");
        kickOut();
      } else {
        shield.classList.remove("show");
      }
    };
    check();
    window.addEventListener("resize", check, { passive: true });
    setInterval(check, 700);
  });
})();

