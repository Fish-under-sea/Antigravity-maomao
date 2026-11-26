"use strict";

/**
 * Self-contained Antigravity native bottom-right update notification toast.
 * Mounts inside AGY's native `.toast-viewport` (with `.agy-toast` visual language),
 * adapts to all 4 surface states (dark / light / glass-dark / glass-light),
 * automatically dodges the bottom-right embedded cat pet, and invokes
 * `POST /api/maomao/update/apply` directly from the host window.
 *
 * 100% MIT clean-room implementation, zero external dependencies, CDP fn.toString()-safe.
 */

const UPDATE_TOAST_KEY = "__agyMaomaoUpdateToast";
const UPDATE_TOAST_REV = 2;

function installUpdateToast(config) {
  const GLOBAL_KEY = "__agyMaomaoUpdateToast";
  const DISMISSED_KEY = "__agyMaomaoUpdateToastDismissedVer";
  const STYLE_ID = "agy-maomao-update-toast-style";
  const NODE_ID = "agy-maomao-update-toast";
  const REV = 2;

  const doc = typeof document !== "undefined" ? document : null;
  const win = typeof window !== "undefined" ? window : null;
  if (!doc || !win) return { shown: false, reason: "no_dom" };

  const cfg = config && typeof config === "object" ? config : {};
  const latestVersion = String(cfg.latestVersion || "").trim().replace(/^v/i, "");
  const currentVersion = String(cfg.currentVersion || "").trim().replace(/^v/i, "");
  if (!latestVersion) return { shown: false, reason: "missing_version" };

  const forceShow = Boolean(cfg.forceShow);
  if (!forceShow && win[DISMISSED_KEY] === latestVersion) {
    return { shown: false, deduplicated: true, version: latestVersion };
  }

  // Prefer sanctioned host-native toast callback if exposed
  if (typeof win.__agyNativeToast === "function") {
    try {
      const nativeRes = win.__agyNativeToast({
        id: "maomao-update-" + latestVersion,
        title: "喵言喵语发现新版本 v" + latestVersion,
        description: String(cfg.releaseNotes || "").trim().slice(0, 140),
        version: latestVersion,
      });
      if (nativeRes !== false) {
        return { shown: true, target: "native-api", version: latestVersion, rev: REV };
      }
    } catch {}
  }

  if (win[GLOBAL_KEY] && typeof win[GLOBAL_KEY].destroy === "function") {
    try { win[GLOBAL_KEY].destroy(); } catch {}
  }

  function detectHostDark() {
    try {
      const d = doc.documentElement;
      const b = doc.body;
      if (
        d?.classList?.contains("dark") ||
        d?.classList?.contains("dark-theme") ||
        b?.classList?.contains("dark") ||
        b?.classList?.contains("dark-theme") ||
        d?.getAttribute?.("data-theme") === "dark" ||
        b?.getAttribute?.("data-theme") === "dark"
      ) {
        return true;
      }
      if (
        d?.classList?.contains("light") ||
        b?.classList?.contains("light") ||
        d?.getAttribute?.("data-theme") === "light" ||
        b?.getAttribute?.("data-theme") === "light"
      ) {
        return false;
      }
      if (win.matchMedia) return win.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {}
    return true;
  }

  function detectSurfaceMode() {
    const isGlass = Boolean(
      doc.documentElement?.classList?.contains("agy-dream-active-v2") ||
      doc.getElementById("agy-dream-wallpaper-v2")
    );
    const isDark = detectHostDark();
    if (isGlass) return isDark ? "glass-dark" : "glass-light";
    return isDark ? "dark" : "light";
  }

  function formatSummary(raw) {
    const text = String(raw || "")
      .replace(/\r/g, "")
      .replace(/^#+\s*/gm, "")
      .replace(/[*_`]/g, "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 2)
      .join(" · ");
    if (!text) return "点击「立即更新」将自动安全备份、替换并重载插件，保留全部本地配置。";
    return text.length > 130 ? text.slice(0, 129) + "…" : text;
  }

  function measurePetDodgePx() {
    try {
      const petHost = doc.getElementById("agy-maomao-pet-root");
      if (!petHost) return 0;
      const sr = petHost.shadowRoot;
      const stage = sr ? (sr.querySelector(".pet-stage") || sr.querySelector(".pet-wrap")) : petHost;
      if (!stage || typeof stage.getBoundingClientRect !== "function") return 0;
      const r = stage.getBoundingClientRect();
      const vw = Number(win.innerWidth) || 1280;
      const vh = Number(win.innerHeight) || 720;
      if (!r || r.width <= 4 || r.height <= 4) return 0;
      const inRightZone = r.right > vw - 400;
      const inBottomZone = r.bottom > vh - 220;
      if (!inRightZone || !inBottomZone) return 0;
      let topEdge = r.top;
      if (sr && typeof sr.querySelector === "function") {
        const bubble = sr.querySelector('.pet-bubble[data-open="true"]');
        if (bubble && typeof bubble.getBoundingClientRect === "function") {
          const br = bubble.getBoundingClientRect();
          if (br && br.height > 4 && br.width > 4) {
            topEdge = Math.min(topEdge, br.top);
          }
        }
      }
      const needed = Math.round(vh - topEdge + 12);
      const maxDodge = Math.max(0, Math.min(480, vh - 160));
      return Math.max(0, Math.min(maxDodge, needed));
    } catch {
      return 0;
    }
  }

  function buildStyles() {
    return [
      `#${NODE_ID} {`,
      `  --mm-ut-bg: #1a1b26;`,
      `  --mm-ut-border: rgba(255, 255, 255, 0.14);`,
      `  --mm-ut-fg: #f4f5fa;`,
      `  --mm-ut-sub: #b4b7c9;`,
      `  --mm-ut-accent: #8b5cf6;`,
      `  --mm-ut-accent-2: #ec78b8;`,
      `  --mm-ut-ghost-bg: rgba(255, 255, 255, 0.08);`,
      `  --mm-ut-ghost-border: rgba(255, 255, 255, 0.16);`,
      `  --mm-ut-shadow: 0 14px 36px rgba(0, 0, 0, 0.42), 0 2px 10px rgba(0, 0, 0, 0.24);`,
      `  --mm-ut-blur: none;`,
      `  box-sizing: border-box;`,
      `  pointer-events: auto;`,
      `  font-family: "Segoe UI", "Microsoft YaHei UI", system-ui, -apple-system, sans-serif;`,
      `  color: var(--mm-ut-fg);`,
      `  background: var(--mm-ut-bg);`,
      `  border: 1px solid var(--mm-ut-border);`,
      `  border-radius: var(--nux-radius-lg, 14px);`,
      `  box-shadow: var(--mm-ut-shadow);`,
      `  -webkit-backdrop-filter: var(--mm-ut-blur);`,
      `  backdrop-filter: var(--mm-ut-blur);`,
      `  padding: 12px 14px;`,
      `  width: 100%;`,
      `  max-width: 368px;`,
      `  opacity: 0;`,
      `  transform: translateY(14px) scale(0.98);`,
      `  transition: opacity 220ms ease, transform 240ms cubic-bezier(0.22, 1, 0.36, 1), bottom 200ms ease;`,
      `}`,
      `#${NODE_ID}[data-visible="1"] { opacity: 1; transform: translateY(0) scale(1); }`,
      `#${NODE_ID}[data-mount="viewport"] { position: absolute; right: 0; bottom: var(--agy-mm-upd-offset, 0px); z-index: 2; }`,
      `#${NODE_ID}[data-mount="body"] { position: fixed; right: 12px; bottom: calc(12px + var(--agy-mm-upd-offset, 0px)); z-index: 2147483200; width: min(368px, calc(100vw - 24px)); }`,
      `#${NODE_ID}[data-surface="glass-dark"] { --mm-ut-bg: rgba(24, 20, 42, 0.78); --mm-ut-border: rgba(216, 198, 255, 0.24); --mm-ut-blur: blur(16px) saturate(150%); }`,
      `#${NODE_ID}[data-surface="light"] { --mm-ut-bg: #ffffff; --mm-ut-border: rgba(24, 24, 38, 0.14); --mm-ut-fg: #181826; --mm-ut-sub: #52566e; --mm-ut-accent: #6d5ce8; --mm-ut-ghost-bg: rgba(24, 24, 38, 0.06); --mm-ut-ghost-border: rgba(24, 24, 38, 0.14); --mm-ut-shadow: 0 12px 30px rgba(24, 24, 38, 0.14), 0 2px 8px rgba(24, 24, 38, 0.08); }`,
      `#${NODE_ID}[data-surface="glass-light"] { --mm-ut-bg: rgba(252, 250, 255, 0.82); --mm-ut-border: rgba(109, 92, 232, 0.22); --mm-ut-fg: #181826; --mm-ut-sub: #4b4f68; --mm-ut-accent: #6d5ce8; --mm-ut-ghost-bg: rgba(24, 24, 38, 0.06); --mm-ut-ghost-border: rgba(24, 24, 38, 0.14); --mm-ut-shadow: 0 14px 32px rgba(42, 32, 82, 0.14); --mm-ut-blur: blur(16px) saturate(150%); }`,
      `#${NODE_ID} .mm-ut-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }`,
      `#${NODE_ID} .mm-ut-title-wrap { display: flex; align-items: center; gap: 7px; min-width: 0; }`,
      `#${NODE_ID} .mm-ut-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: linear-gradient(135deg, var(--mm-ut-accent), var(--mm-ut-accent-2)); box-shadow: 0 0 10px var(--mm-ut-accent); }`,
      `#${NODE_ID} .mm-ut-title { font-size: 13px; font-weight: 700; line-height: 1.35; color: var(--mm-ut-fg); }`,
      `#${NODE_ID} .mm-ut-ver { font-size: 11px; color: var(--mm-ut-sub); margin-top: 1px; font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }`,
      `#${NODE_ID} .mm-ut-close { border: 0; background: transparent; color: var(--mm-ut-sub); width: 22px; height: 22px; border-radius: 999px; cursor: pointer; font-size: 14px; line-height: 1; display: grid; place-items: center; flex: none; }`,
      `#${NODE_ID} .mm-ut-close:hover { background: var(--mm-ut-ghost-bg); color: var(--mm-ut-fg); }`,
      `#${NODE_ID} .mm-ut-desc { margin-top: 6px; font-size: 11.8px; line-height: 1.48; color: var(--mm-ut-sub); word-break: break-word; }`,
      `#${NODE_ID} .mm-ut-actions { margin-top: 10px; display: flex; align-items: center; justify-content: flex-end; gap: 7px; }`,
      `#${NODE_ID} .mm-ut-btn { height: 27px; padding: 0 12px; border-radius: 999px; font-family: inherit; font-size: 11.8px; font-weight: 600; cursor: pointer; transition: filter 120ms ease, opacity 120ms ease; }`,
      `#${NODE_ID} .mm-ut-btn:disabled { opacity: 0.55; cursor: not-allowed; }`,
      `#${NODE_ID} .mm-ut-btn-ghost { border: 1px solid var(--mm-ut-ghost-border); background: var(--mm-ut-ghost-bg); color: var(--mm-ut-fg); }`,
      `#${NODE_ID} .mm-ut-btn-primary { border: 0; background: linear-gradient(135deg, var(--mm-ut-accent), var(--mm-ut-accent-2)); color: #ffffff; }`,
      `#${NODE_ID} .mm-ut-btn:hover:not(:disabled) { filter: brightness(1.1); }`,
    ].join("\n");
  }

  let styleEl = doc.getElementById(STYLE_ID);
  if (!styleEl) {
    styleEl = doc.createElement("style");
    styleEl.id = STYLE_ID;
    (doc.head || doc.documentElement).appendChild(styleEl);
  }
  styleEl.textContent = buildStyles();

  const existing = doc.getElementById(NODE_ID);
  if (existing) existing.remove();

  const viewport = doc.querySelector(".toast-viewport");
  const mountMode = viewport ? "viewport" : "body";
  const parent = viewport || doc.body || doc.documentElement;

  const toast = doc.createElement("div");
  toast.id = NODE_ID;
  toast.className = "agy-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  toast.setAttribute("data-agy-maomao-update-toast", "1");
  toast.setAttribute("data-mount", mountMode);
  toast.setAttribute("data-surface", detectSurfaceMode());

  const dodgePx = measurePetDodgePx();
  toast.style.setProperty("--agy-mm-upd-offset", dodgePx + "px");

  const head = doc.createElement("div");
  head.className = "mm-ut-head";

  const titleWrap = doc.createElement("div");
  titleWrap.className = "mm-ut-title-wrap";
  const dot = doc.createElement("span");
  dot.className = "mm-ut-dot";
  const titleCol = doc.createElement("div");
  const titleEl = doc.createElement("div");
  titleEl.className = "mm-ut-title";
  titleEl.textContent = "喵言喵语发现新版本 v" + latestVersion;
  const verEl = doc.createElement("div");
  verEl.className = "mm-ut-ver";
  verEl.textContent = currentVersion ? "v" + currentVersion + " → v" + latestVersion : "v" + latestVersion;
  titleCol.append(titleEl, verEl);
  titleWrap.append(dot, titleCol);

  const closeBtn = doc.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "mm-ut-close";
  closeBtn.setAttribute("aria-label", "关闭更新提示");
  closeBtn.textContent = "×";
  head.append(titleWrap, closeBtn);

  const descEl = doc.createElement("div");
  descEl.className = "mm-ut-desc";
  descEl.textContent = formatSummary(cfg.releaseNotes);

  const actions = doc.createElement("div");
  actions.className = "mm-ut-actions";

  const laterBtn = doc.createElement("button");
  laterBtn.type = "button";
  laterBtn.className = "mm-ut-btn mm-ut-btn-ghost";
  laterBtn.setAttribute("data-action", "later");
  laterBtn.textContent = "稍后";

  const updateBtn = doc.createElement("button");
  updateBtn.type = "button";
  updateBtn.className = "mm-ut-btn mm-ut-btn-primary";
  updateBtn.setAttribute("data-action", "update");
  updateBtn.textContent = "立即更新";

  actions.append(laterBtn, updateBtn);
  toast.append(head, descEl, actions);
  parent.appendChild(toast);

  let destroyed = false;
  let closeTimer = null;
  let settleTimer = null;
  let themeObs = null;
  let petBubbleObs = null;

  const syncSurfaceAndPos = () => {
    if (destroyed) return;
    toast.setAttribute("data-surface", detectSurfaceMode());
    toast.style.setProperty("--agy-mm-upd-offset", measurePetDodgePx() + "px");
  };

  const onPetBubbleMutate = () => {
    syncSurfaceAndPos();
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      syncSurfaceAndPos();
    }, 240);
  };

  if (typeof MutationObserver === "function") {
    try {
      themeObs = new MutationObserver(syncSurfaceAndPos);
      themeObs.observe(doc.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      if (doc.body) {
        themeObs.observe(doc.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
    } catch {}
    try {
      const petHost = doc.getElementById("agy-maomao-pet-root");
      const sr = petHost && petHost.shadowRoot;
      const petBubble = sr && typeof sr.querySelector === "function" ? sr.querySelector(".pet-bubble") : null;
      const petStage = sr && typeof sr.querySelector === "function" ? sr.querySelector(".pet-stage") : null;
      if (petBubble || petStage) {
        petBubbleObs = new MutationObserver(onPetBubbleMutate);
        if (petBubble) {
          petBubbleObs.observe(petBubble, { attributes: true, attributeFilter: ["data-open"], subtree: false });
        }
        if (petStage) {
          petBubbleObs.observe(petStage, { attributes: true, attributeFilter: ["data-align", "data-vpos"], subtree: false });
        }
      }
    } catch {}
  }

  const onResize = () => syncSurfaceAndPos();
  win.addEventListener?.("resize", onResize, { passive: true });

  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    if (closeTimer) clearTimeout(closeTimer);
    if (settleTimer) clearTimeout(settleTimer);
    try { themeObs?.disconnect(); } catch {}
    try { petBubbleObs?.disconnect(); } catch {}
    try { win.removeEventListener?.("resize", onResize); } catch {}
    try { toast.remove(); } catch {}
    try {
      const st = doc.getElementById(STYLE_ID);
      if (st) st.remove();
    } catch {}
    if (win[GLOBAL_KEY] && win[GLOBAL_KEY].owner === cfg.owner) {
      delete win[GLOBAL_KEY];
    }
  };

  const dismiss = () => {
    win[DISMISSED_KEY] = latestVersion;
    toast.setAttribute("data-visible", "0");
    closeTimer = setTimeout(destroy, 220);
  };

  closeBtn.addEventListener("click", dismiss);
  laterBtn.addEventListener("click", dismiss);

  updateBtn.addEventListener("click", async () => {
    const base = String(cfg.sidecarBaseUrl || "").replace(/\/+$/, "");
    const token = String(cfg.sidecarToken || "");
    if (!base) {
      descEl.textContent = "更新服务地址未就绪，请在右侧「喵言喵语 → 增强」页手动点击更新。";
      return;
    }
    updateBtn.disabled = true;
    laterBtn.disabled = true;
    updateBtn.textContent = "正在更新…";
    descEl.textContent = "正在下载并校验更新包，完成后插件将自动平滑重载…";
    try {
      const url = base + "/api/maomao/update/apply?token=" + encodeURIComponent(token);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Maomao-Token": token,
        },
        body: JSON.stringify({ downloadUrl: cfg.downloadUrl || "" }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || "更新请求失败 (" + res.status + ")");
      }
      win[DISMISSED_KEY] = latestVersion;
      updateBtn.textContent = "已安装，重载中…";
      descEl.textContent = "已成功升级至 v" + (data.toVersion || latestVersion) + "，正在自动重载插件…";
      closeTimer = setTimeout(destroy, 2600);
    } catch (err) {
      updateBtn.disabled = false;
      laterBtn.disabled = false;
      updateBtn.textContent = "重试更新";
      descEl.textContent = "更新失败：" + (err && err.message ? err.message : String(err));
    }
  });

  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (!destroyed) toast.setAttribute("data-visible", "1");
    });
  } else {
    toast.setAttribute("data-visible", "1");
  }

  win[GLOBAL_KEY] = {
    rev: REV,
    owner: cfg.owner || "",
    version: latestVersion,
    target: mountMode === "viewport" ? "toast-viewport" : "body-fallback",
    status: () => ({
      visible: !destroyed,
      version: latestVersion,
      surface: toast.getAttribute("data-surface"),
      mount: mountMode,
      dodgePx: measurePetDodgePx(),
    }),
    dismiss,
    destroy,
  };

  return {
    shown: true,
    target: mountMode === "viewport" ? "toast-viewport" : "body-fallback",
    version: latestVersion,
    surface: toast.getAttribute("data-surface"),
    dodgePx,
    rev: REV,
  };
}

module.exports = {
  installUpdateToast,
  UPDATE_TOAST_KEY,
  UPDATE_TOAST_REV,
};
