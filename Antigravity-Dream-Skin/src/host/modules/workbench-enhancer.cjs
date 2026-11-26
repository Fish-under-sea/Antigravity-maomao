"use strict";

/**
 * Antigravity Dream Skin — Pure MIT Workbench Efficiency Enhancer Suite
 *
 * Self-contained CDP-injectable function (`installWorkbenchEnhancer.toString()`).
 * Mounts `window.__agyMaomaoWorkbench = { rev, owner, touch, status, update, destroy }`.
 *
 * All 6 sub-features are independently hot-toggleable via `config.workbench`
 * with zero leftover DOM nodes, listeners, timers, or side effects on disable/destroy:
 *   1. codeFold        - Sticky glass toggle pill for completed >=48-line <pre> blocks + scroll compensation
 *   2. contextMenu     - Radial Pie Ring 6-slice menu (/swarm, /btw, /compact, /plan, /grill-me, /learn) + file pill actions
 *   3. inlineDiff      - Inline Git Diff preview chip with hover prefetch & in-memory cache
 *   4. fullTextSearch  - Native search dialog enhancement with all/text/code scope filter
 *   5. compactLayout   - Tighter prose line-height & paragraph spacing while preserving user font size
 *   6. thoughtTranslate - Dual-mode ("off"|"machine"|"openai") thought translation client (concurrency 3)
 */

const WORKBENCH_KEY = "__agyMaomaoWorkbench";
const WORKBENCH_REV = 6;

function installWorkbenchEnhancer(config) {
  const KEY = "__agyMaomaoWorkbench";
  const REV = 6;
  const STYLE_ID = "agy-maomao-workbench-style";
  const CODE_FOLD_THRESHOLD = 48;
  const DIFF_CACHE_TTL_MS = 30000;
  const DIFF_CACHE_MAX = 40;
  const TRANSLATE_MAX_CONCURRENCY = 3;

  const cfg0 = config && typeof config === "object" ? config : {};

  // Reuse or replace existing instance idempotently
  const existing = window[KEY];
  if (existing) {
    const incomingOwner = cfg0.owner || "";
    if (existing.owner && incomingOwner && existing.owner !== incomingOwner) {
      const stale = typeof existing.lastSeen === "number" && Date.now() - existing.lastSeen > 15000;
      const upgrading = typeof existing.rev === "number" && existing.rev < REV;
      if (!stale && !upgrading) {
        return existing.status ? existing.status() : { applied: false, reason: "owned-by-other" };
      }
    }
    if ((!incomingOwner || existing.owner === incomingOwner) && existing.rev === REV && typeof existing.update === "function") {
      existing.update(cfg0);
      return existing.status();
    }
    try { existing.destroy(); } catch {}
  }

  if (typeof document === "undefined" || !document || !document.documentElement) {
    return { applied: false, reason: "no-document" };
  }

  function sanitizeBaseUrl(url) {
    if (typeof url !== "string") return "";
    const trimmed = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(trimmed)) return "";
    return trimmed;
  }

  function normalizeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const wb = src.workbench && typeof src.workbench === "object" ? src.workbench : src;
    const tt = wb.thoughtTranslate;
    const thoughtTranslate = tt === "machine" || tt === "openai" ? tt : "off";
    const tv = wb.thoughtView;
    const thoughtView = tv === "bilingual" ? "bilingual" : "immersive";
    return {
      owner: typeof src.owner === "string" ? src.owner : "",
      themeStyle: src.themeStyle === "official" || wb.themeStyle === "official" ? "official" : (src.themeStyle === "star-neko" || wb.themeStyle === "star-neko" ? "star-neko" : ""),
      sidecarBaseUrl: sanitizeBaseUrl(src.sidecarBaseUrl || wb.sidecarBaseUrl || ""),
      sidecarToken: typeof (src.sidecarToken ?? wb.sidecarToken) === "string" ? (src.sidecarToken ?? wb.sidecarToken) : "",
      workbench: {
        codeFold: wb.codeFold !== false,
        contextMenu: wb.contextMenu !== false,
        inlineDiff: wb.inlineDiff !== false,
        fullTextSearch: wb.fullTextSearch !== false,
        compactLayout: wb.compactLayout === true,
        thoughtTranslate,
        thoughtView,
        thoughtEndpoint: typeof wb.thoughtEndpoint === "string" ? wb.thoughtEndpoint.trim() : "",
        thoughtModel: typeof wb.thoughtModel === "string" ? wb.thoughtModel.trim() : "",
        thoughtApiKey: typeof wb.thoughtApiKey === "string" ? wb.thoughtApiKey : "",
      },
    };
  }

  let state = normalizeConfig(cfg0);
  let destroyed = false;
  let toastEl = null;
  let toastTimer = null;

  // Shared style sheet
  const styleEl = document.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.setAttribute("data-agy-maomao-ui", "workbench");
  styleEl.textContent = `
/* 4-surface adaptive design tokens: dark | light | glass-dark | glass-light */
html[data-agy-maomao-wb-surface="dark"] {
  --mm-wb-panel-bg: rgba(20, 17, 32, 0.96);
  --mm-wb-panel-sub-bg: rgba(30, 25, 48, 0.96);
  --mm-wb-panel-border: rgba(196, 170, 255, 0.24);
  --mm-wb-panel-divider: rgba(196, 170, 255, 0.14);
  --mm-wb-panel-fg: #f4efff;
  --mm-wb-panel-muted: #c8bce8;
  --mm-wb-panel-hover: rgba(164, 134, 240, 0.24);
  --mm-wb-panel-row-bg: rgba(255, 255, 255, 0.04);
  --mm-wb-panel-blur: none;
  --mm-wb-panel-shadow: 0 16px 38px rgba(0, 0, 0, 0.48);
  --mm-wb-btn-bg: rgba(34, 27, 56, 0.92);
  --mm-wb-btn-hover: rgba(138, 108, 224, 0.42);
  --mm-wb-btn-border: rgba(206, 182, 255, 0.30);
  --mm-wb-btn-fg: #f3edfc;
  --mm-wb-fold-mask: rgba(16, 13, 28, 0.90);
  --mm-wb-diff-add-bg: rgba(34, 197, 94, 0.16);
  --mm-wb-diff-add-fg: #bbf7d0;
  --mm-wb-diff-del-bg: rgba(244, 63, 94, 0.16);
  --mm-wb-diff-del-fg: #fecdd3;
  --mm-wb-diff-hunk-bg: rgba(168, 139, 250, 0.16);
  --mm-wb-diff-hunk-fg: #ddd6fe;
  --mm-wb-mark-bg: rgba(216, 180, 254, 0.34);
  --mm-wb-mark-fg: #ffffff;
  --mm-wb-scroll-thumb: rgba(196, 181, 253, 0.16);
  --mm-wb-scroll-thumb-hover: rgba(196, 181, 253, 0.42);
}
html[data-agy-maomao-wb-surface="light"] {
  --mm-wb-panel-bg: rgba(252, 250, 255, 0.97);
  --mm-wb-panel-sub-bg: rgba(243, 239, 252, 0.97);
  --mm-wb-panel-border: rgba(104, 82, 168, 0.20);
  --mm-wb-panel-divider: rgba(104, 82, 168, 0.13);
  --mm-wb-panel-fg: #1f1b33;
  --mm-wb-panel-muted: #5b4e82;
  --mm-wb-panel-hover: rgba(130, 98, 218, 0.14);
  --mm-wb-panel-row-bg: rgba(92, 70, 156, 0.05);
  --mm-wb-panel-blur: none;
  --mm-wb-panel-shadow: 0 12px 30px rgba(31, 27, 51, 0.13);
  --mm-wb-btn-bg: rgba(245, 241, 255, 0.96);
  --mm-wb-btn-hover: rgba(138, 108, 224, 0.18);
  --mm-wb-btn-border: rgba(124, 96, 198, 0.28);
  --mm-wb-btn-fg: #2c2150;
  --mm-wb-fold-mask: rgba(248, 245, 255, 0.92);
  --mm-wb-diff-add-bg: rgba(22, 163, 74, 0.13);
  --mm-wb-diff-add-fg: #14532d;
  --mm-wb-diff-del-bg: rgba(225, 29, 72, 0.11);
  --mm-wb-diff-del-fg: #881337;
  --mm-wb-diff-hunk-bg: rgba(124, 58, 237, 0.11);
  --mm-wb-diff-hunk-fg: #5b21b6;
  --mm-wb-mark-bg: rgba(146, 110, 236, 0.24);
  --mm-wb-mark-fg: #1f1b33;
  --mm-wb-scroll-thumb: rgba(92, 74, 148, 0.16);
  --mm-wb-scroll-thumb-hover: rgba(92, 74, 148, 0.40);
}
html[data-agy-maomao-wb-surface="glass-dark"] {
  --mm-wb-panel-bg: rgba(22, 17, 40, 0.72);
  --mm-wb-panel-sub-bg: rgba(34, 26, 58, 0.62);
  --mm-wb-panel-border: rgba(220, 196, 255, 0.30);
  --mm-wb-panel-divider: rgba(220, 196, 255, 0.16);
  --mm-wb-panel-fg: #f7f2ff;
  --mm-wb-panel-muted: #d9c8ff;
  --mm-wb-panel-hover: rgba(176, 146, 245, 0.26);
  --mm-wb-panel-row-bg: rgba(255, 255, 255, 0.055);
  --mm-wb-panel-blur: blur(18px) saturate(155%);
  --mm-wb-panel-shadow: 0 18px 42px rgba(6, 4, 18, 0.44), inset 0 1px 0 rgba(235, 218, 255, 0.18);
  --mm-wb-btn-bg: rgba(28, 22, 50, 0.74);
  --mm-wb-btn-hover: rgba(146, 114, 232, 0.42);
  --mm-wb-btn-border: rgba(216, 192, 255, 0.36);
  --mm-wb-btn-fg: #f5efff;
  --mm-wb-fold-mask: rgba(16, 13, 28, 0.84);
  --mm-wb-diff-add-bg: rgba(34, 197, 94, 0.18);
  --mm-wb-diff-add-fg: #bbf7d0;
  --mm-wb-diff-del-bg: rgba(244, 63, 94, 0.18);
  --mm-wb-diff-del-fg: #fecdd3;
  --mm-wb-diff-hunk-bg: rgba(168, 139, 250, 0.18);
  --mm-wb-diff-hunk-fg: #ddd6fe;
  --mm-wb-mark-bg: rgba(216, 180, 254, 0.36);
  --mm-wb-mark-fg: #ffffff;
  --mm-wb-scroll-thumb: rgba(216, 196, 255, 0.16);
  --mm-wb-scroll-thumb-hover: rgba(216, 196, 255, 0.42);
}
html[data-agy-maomao-wb-surface="glass-light"] {
  --mm-wb-panel-bg: rgba(252, 248, 255, 0.74);
  --mm-wb-panel-sub-bg: rgba(244, 238, 255, 0.68);
  --mm-wb-panel-border: rgba(132, 104, 206, 0.28);
  --mm-wb-panel-divider: rgba(132, 104, 206, 0.16);
  --mm-wb-panel-fg: #1f1b33;
  --mm-wb-panel-muted: #4e3d7a;
  --mm-wb-panel-hover: rgba(146, 114, 232, 0.18);
  --mm-wb-panel-row-bg: rgba(124, 96, 204, 0.06);
  --mm-wb-panel-blur: blur(18px) saturate(155%);
  --mm-wb-panel-shadow: 0 16px 36px rgba(48, 34, 92, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.76);
  --mm-wb-btn-bg: rgba(250, 246, 255, 0.78);
  --mm-wb-btn-hover: rgba(146, 114, 232, 0.24);
  --mm-wb-btn-border: rgba(132, 104, 206, 0.32);
  --mm-wb-btn-fg: #261d45;
  --mm-wb-fold-mask: rgba(248, 244, 255, 0.86);
  --mm-wb-diff-add-bg: rgba(22, 163, 74, 0.15);
  --mm-wb-diff-add-fg: #14532d;
  --mm-wb-diff-del-bg: rgba(225, 29, 72, 0.13);
  --mm-wb-diff-del-fg: #881337;
  --mm-wb-diff-hunk-bg: rgba(124, 58, 237, 0.13);
  --mm-wb-diff-hunk-fg: #5b21b6;
  --mm-wb-mark-bg: rgba(146, 110, 236, 0.26);
  --mm-wb-mark-fg: #1f1b33;
  --mm-wb-scroll-thumb: rgba(86, 66, 142, 0.18);
  --mm-wb-scroll-thumb-hover: rgba(86, 66, 142, 0.44);
}

/* Compact layout: tighten spacing & line-height without altering user font-size */
html[data-agy-maomao-compact="1"] [data-testid="agent-response"],
html[data-agy-maomao-compact="1"] [data-testid="agent-response"] :is([data-markdown-root], p, li, blockquote),
html[data-agy-maomao-compact="1"] [data-testid="user-input-step"] {
  line-height: 1.42 !important;
}
html[data-agy-maomao-compact="1"] [data-testid="agent-response"] [data-markdown-root] :is(p, ul, ol, blockquote) {
  margin-block: 4px !important;
}
html[data-agy-maomao-compact="1"] [data-testid="agent-response"] [data-markdown-root] > :not(style) + :not(style) {
  margin-block-start: 7px !important;
}
html[data-agy-maomao-compact="1"] [data-testid="agent-response"] [data-markdown-root] li {
  margin-block: 2px !important;
}

/* Code fold sticky pill & folded mask */
pre[data-agy-maomao-foldable="1"] {
  position: relative;
}
pre[data-agy-maomao-folded="1"] {
  max-height: 220px !important;
  overflow: hidden !important;
}
pre[data-agy-maomao-folded="1"]::after {
  content: "";
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 44px;
  pointer-events: none;
  background: linear-gradient(to bottom, transparent, var(--mm-wb-fold-mask, rgba(16, 13, 28, 0.88)));
}
.agy-mm-code-fold-bar {
  position: sticky;
  top: 6px;
  z-index: 4;
  display: flex;
  justify-content: flex-end;
  pointer-events: none;
  margin-bottom: -26px;
  padding: 2px 6px 0 0;
}
.agy-mm-code-fold-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 24px;
  padding: 0 10px;
  border-radius: 9999px;
  border: 1px solid var(--mm-wb-btn-border, rgba(206, 182, 255, 0.34));
  background: var(--mm-wb-btn-bg, rgba(24, 19, 42, 0.78));
  color: var(--mm-wb-btn-fg, #f3edfc);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.16);
  transition: background 140ms ease, transform 140ms ease;
}
.agy-mm-code-fold-btn:hover {
  background: var(--mm-wb-btn-hover, rgba(138, 108, 224, 0.42));
}

/* File Context menu (4-surface adaptive) */
.agy-mm-ctx-menu {
  position: fixed;
  z-index: 99995;
  min-width: 210px;
  max-width: 300px;
  padding: 6px;
  border-radius: 13px;
  border: 1px solid var(--mm-wb-panel-border, rgba(206, 182, 255, 0.30));
  background: var(--mm-wb-panel-bg, rgba(20, 16, 34, 0.92));
  color: var(--mm-wb-panel-fg, #f4efff);
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  box-shadow: var(--mm-wb-panel-shadow, 0 18px 44px rgba(0, 0, 0, 0.45));
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
}
.agy-mm-ctx-title {
  padding: 4px 8px 5px;
  font-size: 10.5px;
  color: var(--mm-wb-panel-muted, rgba(226, 214, 255, 0.68));
  border-bottom: 1px solid var(--mm-wb-panel-divider, rgba(206, 182, 255, 0.14));
  margin-bottom: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.agy-mm-ctx-btn {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 7px 9px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.agy-mm-ctx-btn:hover {
  background: var(--mm-wb-panel-hover, rgba(176, 146, 245, 0.24));
}
.agy-mm-ctx-tag {
  font-size: 10.5px;
  color: var(--mm-wb-panel-muted, rgba(214, 196, 255, 0.72));
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}

/* Radial Pie Ring menu — strictly circular, zero outer square card/backdrop */
@keyframes agy-mm-radial-in {
  from { opacity: 0; transform: scale(0.84); }
  to { opacity: 1; transform: scale(1); }
}
#agy-maomao-context-menu[data-agy-maomao-radial="1"],
.agy-mm-radial-menu[data-agy-maomao-radial="1"] {
  --mm-slice-bg: rgba(22, 18, 38, 0.95);
  --mm-slice-stroke: rgba(204, 176, 255, 0.34);
  --mm-slice-hover-bg: rgba(138, 98, 232, 0.72);
  --mm-slice-hover-stroke: rgba(238, 218, 255, 0.92);
  --mm-slice-glow: rgba(178, 138, 255, 0.45);
  --mm-hub-bg: rgba(15, 12, 28, 0.97);
  --mm-hub-hover-bg: rgba(128, 92, 214, 0.52);
  --mm-hub-stroke: rgba(214, 188, 255, 0.48);
  --mm-fg: #f7f2ff;
  --mm-muted: #d6c2ff;
  --mm-icon: #e8daff;
  --mm-ring-bg: transparent;
  --mm-ring-border: transparent;
  --mm-ring-inset: transparent;
  position: fixed !important;
  z-index: 99995 !important;
  width: 256px !important;
  height: 256px !important;
  padding: 0 !important;
  margin: 0 !important;
  background: transparent !important;
  background-color: transparent !important;
  background-image: none !important;
  border: 0 !important;
  border-radius: 50% !important;
  box-shadow: none !important;
  outline: none !important;
  -webkit-backdrop-filter: none !important;
  backdrop-filter: none !important;
  overflow: visible !important;
  pointer-events: none;
  user-select: none;
  animation: agy-mm-radial-in 160ms cubic-bezier(0.16, 1, 0.3, 1) both;
  filter: drop-shadow(0 16px 34px rgba(8, 5, 22, 0.46));
}
/* Pure Light surface */
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-surface="light"] {
  --mm-slice-bg: rgba(252, 250, 255, 0.95);
  --mm-slice-stroke: rgba(128, 102, 196, 0.28);
  --mm-slice-hover-bg: rgba(148, 114, 236, 0.24);
  --mm-slice-hover-stroke: rgba(112, 78, 206, 0.80);
  --mm-slice-glow: rgba(132, 96, 224, 0.24);
  --mm-hub-bg: rgba(255, 255, 255, 0.98);
  --mm-hub-hover-bg: rgba(148, 114, 236, 0.20);
  --mm-hub-stroke: rgba(126, 98, 198, 0.42);
  --mm-fg: #1f1b33;
  --mm-muted: #5a42a6;
  --mm-icon: #4e359a;
  filter: drop-shadow(0 14px 28px rgba(42, 32, 82, 0.16));
}
/* Glass Dark surface — circular frosted ring backdrop */
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-surface="glass-dark"] {
  --mm-slice-bg: rgba(26, 20, 48, 0.56);
  --mm-slice-stroke: rgba(222, 198, 255, 0.36);
  --mm-slice-hover-bg: rgba(148, 110, 238, 0.58);
  --mm-slice-hover-stroke: rgba(244, 230, 255, 0.94);
  --mm-slice-glow: rgba(188, 150, 255, 0.48);
  --mm-hub-bg: rgba(20, 15, 38, 0.72);
  --mm-hub-hover-bg: rgba(136, 98, 224, 0.52);
  --mm-hub-stroke: rgba(226, 204, 255, 0.50);
  --mm-fg: #faf6ff;
  --mm-muted: #dfd0ff;
  --mm-icon: #eee4ff;
  --mm-ring-bg: rgba(22, 17, 42, 0.34);
  --mm-ring-border: rgba(226, 204, 255, 0.30);
  --mm-ring-inset: rgba(255, 255, 255, 0.18);
  filter: drop-shadow(0 18px 38px rgba(6, 4, 20, 0.44));
}
/* Glass Light surface — circular frosted porcelain ring backdrop */
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-surface="glass-light"] {
  --mm-slice-bg: rgba(252, 250, 255, 0.66);
  --mm-slice-stroke: rgba(132, 104, 206, 0.30);
  --mm-slice-hover-bg: rgba(154, 122, 238, 0.32);
  --mm-slice-hover-stroke: rgba(114, 80, 210, 0.82);
  --mm-slice-glow: rgba(140, 106, 226, 0.26);
  --mm-hub-bg: rgba(255, 253, 255, 0.78);
  --mm-hub-hover-bg: rgba(154, 122, 238, 0.24);
  --mm-hub-stroke: rgba(134, 104, 206, 0.44);
  --mm-fg: #1f1b33;
  --mm-muted: #4e3796;
  --mm-icon: #432e8a;
  --mm-ring-bg: rgba(252, 249, 255, 0.42);
  --mm-ring-border: rgba(138, 110, 212, 0.28);
  --mm-ring-inset: rgba(255, 255, 255, 0.76);
  filter: drop-shadow(0 16px 32px rgba(48, 34, 92, 0.15));
}
/* Official palette tint refinements */
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-theme-style="official"][data-surface="dark"],
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-theme-style="official"][data-surface="glass-dark"] {
  --mm-slice-stroke: rgba(255, 255, 255, 0.20);
  --mm-slice-hover-bg: rgba(99, 102, 241, 0.46);
  --mm-slice-hover-stroke: rgba(165, 180, 252, 0.82);
  --mm-slice-glow: rgba(99, 102, 241, 0.38);
  --mm-hub-stroke: rgba(255, 255, 255, 0.28);
  --mm-fg: #f8fafc;
  --mm-muted: #cbd5e1;
  --mm-icon: #e2e8f0;
}
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-theme-style="official"][data-surface="light"],
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-theme-style="official"][data-surface="glass-light"] {
  --mm-slice-stroke: rgba(15, 23, 42, 0.16);
  --mm-slice-hover-bg: rgba(99, 102, 241, 0.18);
  --mm-slice-hover-stroke: rgba(79, 70, 229, 0.62);
  --mm-slice-glow: rgba(79, 70, 229, 0.22);
  --mm-hub-stroke: rgba(15, 23, 42, 0.22);
  --mm-fg: #0f172a;
  --mm-muted: #475569;
  --mm-icon: #334155;
}
/* Inner strictly-circular frosted ring surface (visible only in glass-dark / glass-light) */
.agy-mm-radial-glass-ring {
  display: none;
  position: absolute;
  left: 14px;
  top: 14px;
  width: 228px;
  height: 228px;
  border-radius: 50%;
  pointer-events: none;
  background: var(--mm-ring-bg);
  border: 1px solid var(--mm-ring-border);
  box-shadow: inset 0 1px 0 var(--mm-ring-inset);
  -webkit-backdrop-filter: blur(18px) saturate(155%);
  backdrop-filter: blur(18px) saturate(155%);
  box-sizing: border-box;
}
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-surface="glass-dark"] .agy-mm-radial-glass-ring,
#agy-maomao-context-menu[data-agy-maomao-radial="1"][data-surface="glass-light"] .agy-mm-radial-glass-ring {
  display: block;
}
.agy-mm-radial-svg {
  position: relative;
  z-index: 1;
  width: 256px;
  height: 256px;
  overflow: visible;
  display: block;
  background: transparent !important;
}
.agy-mm-pie-slice {
  pointer-events: auto;
  cursor: pointer;
  transform: translate(0px, 0px) scale(1);
  transition: transform 150ms cubic-bezier(0.22, 1, 0.36, 1), filter 150ms ease;
}
.agy-mm-pie-slice:hover,
.agy-mm-pie-slice[data-active="1"] {
  transform: translate(var(--mm-tx, 0px), var(--mm-ty, 0px)) scale(1.03);
  filter: drop-shadow(0 0 10px var(--mm-slice-glow));
}
.agy-mm-pie-path {
  fill: var(--mm-slice-bg);
  stroke: var(--mm-slice-stroke);
  stroke-width: 1.25;
  transition: fill 140ms ease, stroke 140ms ease;
}
.agy-mm-pie-slice:hover .agy-mm-pie-path,
.agy-mm-pie-slice[data-active="1"] .agy-mm-pie-path {
  fill: var(--mm-slice-hover-bg);
  stroke: var(--mm-slice-hover-stroke);
  stroke-width: 1.6;
}
.agy-mm-pie-icon {
  fill: none;
  stroke: var(--mm-icon);
  stroke-width: 1.65;
  stroke-linecap: round;
  stroke-linejoin: round;
  pointer-events: none;
}
.agy-mm-pie-label {
  fill: var(--mm-fg);
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
.agy-mm-pie-cmd {
  fill: var(--mm-muted);
  font-size: 9.2px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
.agy-mm-pie-hub {
  pointer-events: auto;
  cursor: pointer;
}
.agy-mm-pie-hub-circle {
  fill: var(--mm-hub-bg);
  stroke: var(--mm-hub-stroke);
  stroke-width: 1.4;
  transition: fill 140ms ease, stroke 140ms ease;
}
.agy-mm-pie-hub:hover .agy-mm-pie-hub-circle {
  fill: var(--mm-hub-hover-bg);
  stroke: var(--mm-slice-hover-stroke);
}
.agy-mm-pie-hub-title {
  fill: var(--mm-fg);
  font-size: 11px;
  font-weight: 600;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
.agy-mm-pie-hub-sub {
  fill: var(--mm-muted);
  font-size: 9px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-anchor: middle;
  dominant-baseline: central;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  #agy-maomao-context-menu[data-agy-maomao-radial="1"] { animation: none; }
  .agy-mm-pie-slice, .agy-mm-pie-path, .agy-mm-pie-hub-circle { transition: none; }
}

/* Inline Git Diff (4-surface adaptive) */
.agy-mm-diff-btn {
  display: inline-flex;
  align-items: center;
  height: 20px;
  margin-left: 6px;
  padding: 0 7px;
  border-radius: 9999px;
  border: 1px solid var(--mm-wb-btn-border, rgba(206, 182, 255, 0.34));
  background: var(--mm-wb-btn-bg, rgba(34, 27, 56, 0.72));
  color: var(--mm-wb-btn-fg, #eadcff);
  font-size: 10.5px;
  font-weight: 600;
  cursor: pointer;
  vertical-align: middle;
}
.agy-mm-diff-btn:hover {
  background: var(--mm-wb-btn-hover, rgba(138, 108, 224, 0.36));
}
.agy-mm-diff-panel {
  margin: 6px 0 8px;
  border-radius: 11px;
  border: 1px solid var(--mm-wb-panel-border, rgba(206, 182, 255, 0.24));
  background: var(--mm-wb-panel-bg, rgba(15, 13, 25, 0.90));
  color: var(--mm-wb-panel-fg, #ede6fa);
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  box-shadow: var(--mm-wb-panel-shadow, none);
  overflow: hidden;
  font-size: 11.5px;
}
.agy-mm-diff-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--mm-wb-panel-divider, rgba(206, 182, 255, 0.14));
  background: var(--mm-wb-panel-sub-bg, rgba(34, 28, 54, 0.65));
}
.agy-mm-diff-body {
  max-height: 260px;
  overflow: auto;
  padding: 6px 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.45;
  white-space: pre;
}
.agy-mm-diff-line {
  padding: 0 10px;
}
.agy-mm-diff-add {
  background: var(--mm-wb-diff-add-bg, rgba(34, 197, 94, 0.16));
  color: var(--mm-wb-diff-add-fg, #bbf7d0);
}
.agy-mm-diff-del {
  background: var(--mm-wb-diff-del-bg, rgba(244, 63, 94, 0.16));
  color: var(--mm-wb-diff-del-fg, #fecdd3);
}
.agy-mm-diff-hunk {
  background: var(--mm-wb-diff-hunk-bg, rgba(168, 139, 250, 0.16));
  color: var(--mm-wb-diff-hunk-fg, #ddd6fe);
}

/* Full-text Search Enhancement (4-surface adaptive) */
.agy-mm-search-panel {
  margin-top: 8px;
  padding: 8px 10px;
  border-top: 1px solid var(--mm-wb-panel-divider, rgba(206, 182, 255, 0.20));
  background: var(--mm-wb-panel-bg, rgba(18, 15, 32, 0.72));
  color: var(--mm-wb-panel-fg, #f4efff);
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  font-size: 12px;
}
.agy-mm-search-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}
.agy-mm-search-tabs {
  display: inline-flex;
  gap: 4px;
}
.agy-mm-search-tab {
  height: 22px;
  padding: 0 8px;
  border-radius: 9999px;
  border: 1px solid var(--mm-wb-panel-border, rgba(206, 182, 255, 0.22));
  background: transparent;
  color: var(--mm-wb-panel-muted, rgba(235, 224, 255, 0.8));
  font-size: 11px;
  cursor: pointer;
}
.agy-mm-search-tab[data-active="1"] {
  background: var(--mm-wb-panel-hover, rgba(168, 142, 229, 0.34));
  border-color: var(--mm-wb-btn-border, rgba(206, 182, 255, 0.54));
  color: var(--mm-wb-panel-fg, #ffffff);
}
.agy-mm-search-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 220px;
  overflow-y: auto;
}
.agy-mm-search-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: var(--mm-wb-panel-row-bg, rgba(255, 255, 255, 0.04));
  cursor: pointer;
}
.agy-mm-search-row:hover {
  background: var(--mm-wb-panel-hover, rgba(168, 142, 229, 0.18));
}
.agy-mm-search-mark {
  background: var(--mm-wb-mark-bg, rgba(216, 180, 254, 0.34));
  color: var(--mm-wb-mark-fg, #ffffff);
  border-radius: 3px;
  padding: 0 2px;
}

/* Thought Process Translator (4-surface adaptive) */
[data-agy-maomao-thought-hidden="1"] {
  display: none !important;
}
.agy-mm-thought-box {
  margin-top: 6px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid var(--mm-wb-panel-border, rgba(196, 168, 255, 0.26));
  background: var(--mm-wb-panel-bg, rgba(26, 20, 44, 0.64));
  color: var(--mm-wb-panel-fg, #f3ecff);
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  font-size: 12.5px;
  line-height: 1.5;
}
.agy-mm-thought-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--mm-wb-panel-muted, rgba(220, 204, 255, 0.8));
}
.agy-mm-thought-actions {
  display: inline-flex;
  gap: 6px;
}
.agy-mm-thought-btn {
  height: 20px;
  padding: 0 7px;
  border-radius: 6px;
  border: 1px solid var(--mm-wb-btn-border, rgba(206, 182, 255, 0.26));
  background: var(--mm-wb-btn-bg, rgba(255, 255, 255, 0.06));
  color: var(--mm-wb-btn-fg, inherit);
  font-size: 10.5px;
  cursor: pointer;
}
.agy-mm-thought-body {
  white-space: pre-wrap;
  word-break: break-word;
}

/* Floating low-presence thin scrollbars (4-surface adaptive, zero white tracks, zero arrows) */
.agy-mm-search-list,
.agy-mm-diff-body {
  scrollbar-width: thin;
  scrollbar-color: var(--mm-wb-scroll-thumb, rgba(196, 181, 253, 0.14)) transparent;
}
.agy-mm-search-list:hover,
.agy-mm-diff-body:hover {
  scrollbar-color: var(--mm-wb-scroll-thumb-hover, rgba(196, 181, 253, 0.38)) transparent;
}
:is(.agy-mm-search-list, .agy-mm-diff-body)::-webkit-scrollbar {
  width: 5px;
  height: 5px;
  background: transparent;
}
:is(.agy-mm-search-list, .agy-mm-diff-body)::-webkit-scrollbar-button {
  display: none !important;
  width: 0;
  height: 0;
}
:is(.agy-mm-search-list, .agy-mm-diff-body)::-webkit-scrollbar-track,
:is(.agy-mm-search-list, .agy-mm-diff-body)::-webkit-scrollbar-corner {
  background: transparent !important;
  border: 0;
}
:is(.agy-mm-search-list, .agy-mm-diff-body)::-webkit-scrollbar-thumb {
  border-radius: 9999px;
  background: var(--mm-wb-scroll-thumb, rgba(196, 181, 253, 0.14));
  border: 0;
}
:is(.agy-mm-search-list, .agy-mm-diff-body):hover::-webkit-scrollbar-thumb {
  background: var(--mm-wb-scroll-thumb-hover, rgba(196, 181, 253, 0.38));
}

/* Subtle toast (4-surface adaptive) */
.agy-mm-toast {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 99998;
  padding: 7px 12px;
  border-radius: 10px;
  border: 1px solid var(--mm-wb-panel-border, rgba(206, 182, 255, 0.34));
  background: var(--mm-wb-panel-bg, rgba(22, 18, 38, 0.92));
  color: var(--mm-wb-panel-fg, #f6f0ff);
  -webkit-backdrop-filter: var(--mm-wb-panel-blur, none);
  backdrop-filter: var(--mm-wb-panel-blur, none);
  font-size: 12px;
  box-shadow: var(--mm-wb-panel-shadow, 0 10px 28px rgba(0, 0, 0, 0.35));
  pointer-events: none;
}
`;
  if (document.head && typeof document.head.appendChild === "function") {
    document.head.appendChild(styleEl);
  } else if (document.head && typeof document.head.append === "function") {
    document.head.append(styleEl);
  }

  function showToast(msg) {
    if (destroyed || !document.body) return;
    if (!toastEl || toastEl.isConnected === false) {
      toastEl = document.createElement("div");
      toastEl.className = "agy-mm-toast";
      toastEl.setAttribute("data-agy-maomao-ui", "workbench");
      if (typeof document.body.appendChild === "function") {
        document.body.appendChild(toastEl);
      } else if (typeof document.body.append === "function") {
        document.body.append(toastEl);
      }
    }
    toastEl.textContent = String(msg || "");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastTimer = null;
      if (toastEl) {
        try { toastEl.remove(); } catch {}
        toastEl = null;
      }
    }, 1800);
  }

  function apiUrl(pathname, queryObj) {
    if (!state.sidecarBaseUrl) return "";
    const qs = [];
    if (state.sidecarToken) {
      qs.push("token=" + encodeURIComponent(state.sidecarToken));
    }
    if (queryObj && typeof queryObj === "object") {
      for (const k of Object.keys(queryObj)) {
        if (queryObj[k] !== undefined && queryObj[k] !== null && queryObj[k] !== "") {
          qs.push(encodeURIComponent(k) + "=" + encodeURIComponent(String(queryObj[k])));
        }
      }
    }
    return state.sidecarBaseUrl + pathname + (qs.length ? "?" + qs.join("&") : "");
  }

  function apiHeaders(isJson) {
    const h = {};
    if (isJson) h["Content-Type"] = "application/json";
    if (state.sidecarToken) h["X-Maomao-Token"] = state.sidecarToken;
    return h;
  }

  async function copyToClipboard(text) {
    const val = String(text || "");
    if (!val) return false;
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(val);
        return true;
      }
    } catch {}
    return false;
  }

  const SIDE_PANEL_SEL = '[data-side-panel-focus-scope="true"], [data-testid="side-question-panel"]';

  function isInSidePanel(el) {
    return Boolean(el && typeof el.closest === "function" && el.closest(SIDE_PANEL_SEL));
  }

  function findComposerInput() {
    if (typeof document.querySelectorAll !== "function") return null;
    const selectors = [
      '[data-testid="agent-input-box"] [contenteditable="true"]',
      '[data-testid="agent-input-box"] textarea',
      '[data-lexical-editor="true"]',
      '.surface-composer [contenteditable="true"]',
      '[role="textbox"][contenteditable="true"]',
      "textarea",
    ];
    for (let i = 0; i < selectors.length; i++) {
      const list = document.querySelectorAll(selectors[i]);
      for (let j = 0; j < list.length; j++) {
        const el = list[j];
        if (el && el.isConnected !== false && !isInSidePanel(el)) return el;
      }
    }
    return null;
  }

  function dispatchComposerInputEvent(el, text) {
    if (!el || typeof el.dispatchEvent !== "function") return;
    let ev = null;
    try {
      if (typeof InputEvent === "function") {
        ev = new InputEvent("input", { bubbles: true, inputType: "insertText", data: text });
      }
    } catch {}
    if (!ev) {
      try {
        if (typeof Event === "function") {
          ev = new Event("input", { bubbles: true });
        }
      } catch {}
    }
    if (ev) {
      try { el.dispatchEvent(ev); } catch {}
    }
  }

  function insertIntoElement(input, text) {
    if (!input || !text) return false;
    try {
      if (typeof input.focus === "function") input.focus();
      if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
        const cur = typeof input.value === "string" ? input.value : "";
        const nextVal = cur ? cur + (cur.endsWith(" ") ? "" : " ") + text : text;
        let usedSetter = false;
        try {
          const proto = input.tagName === "INPUT"
            ? (typeof HTMLInputElement !== "undefined" ? HTMLInputElement.prototype : null)
            : (typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement.prototype : null);
          const desc = proto ? Object.getOwnPropertyDescriptor(proto, "value") : null;
          if (desc && typeof desc.set === "function") {
            desc.set.call(input, nextVal);
            usedSetter = true;
          }
        } catch {}
        if (!usedSetter) input.value = nextVal;
        dispatchComposerInputEvent(input, text);
        return true;
      }
      // Lexical / contenteditable: move caret to end before execCommand("insertText")
      try {
        const sel = typeof window.getSelection === "function" ? window.getSelection() : null;
        if (sel && typeof sel.removeAllRanges === "function" && typeof document.createRange === "function") {
          const range = document.createRange();
          range.selectNodeContents(input);
          range.collapse(false);
          sel.removeAllRanges();
          sel.addRange(range);
        }
      } catch {}
      if (typeof document.execCommand === "function") {
        try {
          if (document.execCommand("insertText", false, text) === true) return true;
        } catch {}
      }
      const cur = typeof input.textContent === "string" ? input.textContent : "";
      input.textContent = cur ? cur + (cur.endsWith(" ") ? "" : " ") + text : text;
      dispatchComposerInputEvent(input, text);
      return true;
    } catch {
      return false;
    }
  }

  function insertIntoComposer(text) {
    const input = findComposerInput();
    if (!input) return false;
    return insertIntoElement(input, text);
  }

  function triggerBtwAction(selectedText) {
    const cleanSel = String(selectedText || "").replace(/\r\n?/g, "\n").trim().slice(0, 1200);
    // 1. Prefer native selection /btw button when text is selected
    if (cleanSel && typeof document.querySelector === "function") {
      const selBtn = document.querySelector('[data-testid="selection-btw-button"]');
      if (selBtn && typeof selBtn.click === "function") {
        try {
          selBtn.click();
          showToast("已打开侧边提问 /btw");
          return { ok: true, mode: "native-selection-btw" };
        } catch {}
      }
    }
    // 2. If side-question panel is already open, focus & fill its editor directly
    if (typeof document.querySelector === "function") {
      const sideInput = document.querySelector(
        '[data-testid="side-question-panel"] [contenteditable="true"], [data-testid="side-question-panel"] textarea, [data-side-panel-focus-scope="true"] [contenteditable="true"]'
      );
      if (sideInput && sideInput.isConnected !== false) {
        if (cleanSel) insertIntoElement(sideInput, cleanSel + " ");
        else if (typeof sideInput.focus === "function") sideInput.focus();
        showToast("已聚焦侧边提问面板");
        return { ok: true, mode: "native-side-panel" };
      }
      // 3. Or trigger native open side-question button if available
      const openBtn = document.querySelector(
        '[data-testid="new-side-question-button"], [data-testid="open-side-question"], [data-testid="side-question-trigger"]'
      );
      if (openBtn && typeof openBtn.click === "function") {
        try {
          openBtn.click();
          if (cleanSel) {
            setTimeout(function () {
              if (destroyed) return;
              const nextSide = document.querySelector(
                '[data-testid="side-question-panel"] [contenteditable="true"], [data-side-panel-focus-scope="true"] [contenteditable="true"]'
              );
              if (nextSide) insertIntoElement(nextSide, cleanSel + " ");
            }, 60);
          }
          showToast("已打开侧边提问面板");
          return { ok: true, mode: "native-open-button" };
        } catch {}
      }
    }
    // 4. Fallback: insert `/btw ` into the main composer
    const filled = insertIntoComposer(cleanSel ? "/btw " + cleanSel + " " : "/btw ");
    showToast(filled ? "已填入 /btw 侧边提问" : "未找到输入框");
    return { ok: filled, mode: "composer-fallback" };
  }

  function isHostStreaming() {
    if (typeof document.querySelector !== "function") return false;
    try {
      return Boolean(document.querySelector('[data-testid*="stop"], [data-testid*="cancel-generation"]'));
    } catch {
      return false;
    }
  }

  function findScrollContainer(el) {
    let cur = el && el.parentElement;
    while (cur && cur !== document.body && cur !== document.documentElement) {
      try {
        if (typeof getComputedStyle === "function") {
          const ov = getComputedStyle(cur).overflowY;
          if ((ov === "auto" || ov === "scroll") && cur.scrollHeight > cur.clientHeight) {
            return cur;
          }
        }
      } catch {}
      if (typeof cur.scrollTop === "number" && cur.scrollHeight > cur.clientHeight) {
        return cur;
      }
      cur = cur.parentElement;
    }
    return document.scrollingElement || document.documentElement || document.body;
  }

  function extractLocalFilePath(el) {
    if (!el || el.nodeType !== 1) return "";
    const attrs = ["data-file-path", "data-path", "data-uri", "href", "title"];
    for (let i = 0; i < attrs.length; i++) {
      const raw = typeof el.getAttribute === "function" ? el.getAttribute(attrs[i]) : null;
      if (!raw) continue;
      if (raw.startsWith("file:///")) {
        let p = raw.slice(8);
        try { p = decodeURIComponent(p); } catch {}
        if (/^[a-zA-Z]:\//.test(p)) return p.replace(/\//g, "\\");
        return "/" + p;
      }
      if (raw.startsWith("file://")) {
        let p = raw.slice(7);
        try { p = decodeURIComponent(p); } catch {}
        return p;
      }
      if (/^[a-zA-Z]:[\\/]/.test(raw) || /^\/(?:Users|home|var|tmp|opt|etc|mnt|srv)\//.test(raw)) {
        return raw.trim();
      }
    }
    const txt = String(el.textContent || "").trim();
    if (txt.length >= 4 && txt.length <= 260) {
      if (/^[a-zA-Z]:[\\/][^\r\n]+$/.test(txt) || /^\/(?:Users|home|var|tmp|opt|etc|mnt|srv)\/[^\r\n]+$/.test(txt)) {
        return txt;
      }
    }
    return "";
  }

  // =========================================================================
  // 1. Long Code Block Fold + Sticky Pill (`codeFold`)
  // =========================================================================
  const codeFoldTracked = new Set();

  function countCodeLines(pre) {
    const code = typeof pre.querySelector === "function" ? pre.querySelector("code") : null;
    const raw = String((code || pre).textContent || "");
    if (!raw) return 0;
    const normalized = raw.replace(/\r\n/g, "\n").replace(/\n+$/, "");
    if (!normalized) return 0;
    return normalized.split("\n").length;
  }

  function isInActiveStreamingTail(el) {
    if (!isHostStreaming()) return false;
    try {
      const responses = document.querySelectorAll('[data-testid="agent-response"]');
      if (!responses || !responses.length) return false;
      const lastResp = responses[responses.length - 1];
      return typeof lastResp.contains === "function" && lastResp.contains(el);
    } catch {
      return false;
    }
  }

  function scanCodeFold() {
    if (!state.workbench.codeFold || destroyed) return;
    if (typeof document.querySelectorAll !== "function") return;
    const pres = document.querySelectorAll("pre");
    for (let i = 0; i < pres.length; i++) {
      const pre = pres[i];
      if (!pre || pre.isConnected === false) continue;
      if (pre.getAttribute && pre.getAttribute("data-agy-maomao-ui")) continue;
      if (typeof pre.closest === "function" && pre.closest(".monaco-editor, .agy-mm-diff-panel, [data-agy-maomao-ui]")) {
        continue;
      }
      if (pre.getAttribute && pre.getAttribute("data-agy-maomao-foldable") === "1") {
        continue;
      }
      if (isInActiveStreamingTail(pre)) continue;

      const lines = countCodeLines(pre);
      if (lines < CODE_FOLD_THRESHOLD) continue;

      pre.setAttribute("data-agy-maomao-foldable", "1");
      pre.setAttribute("data-agy-maomao-lines", String(lines));

      const bar = document.createElement("div");
      bar.className = "agy-mm-code-fold-bar";
      bar.setAttribute("data-agy-maomao-ui", "workbench");
      bar.setAttribute("data-agy-maomao-code-fold-bar", "1");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agy-mm-code-fold-btn";
      btn.setAttribute("data-agy-maomao-code-fold-btn", "1");
      btn.setAttribute("aria-expanded", "true");
      btn.textContent = "折叠 (" + lines + " 行)";

      btn.addEventListener("click", function (ev) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        const isFolded = pre.getAttribute("data-agy-maomao-folded") === "1";
        const scroller = findScrollContainer(pre);
        const beforeRect = typeof pre.getBoundingClientRect === "function" ? pre.getBoundingClientRect() : null;
        const beforeHeight = beforeRect ? beforeRect.height : 0;
        const beforeTop = beforeRect ? beforeRect.top : 0;

        if (isFolded) {
          pre.removeAttribute("data-agy-maomao-folded");
          btn.setAttribute("aria-expanded", "true");
          btn.textContent = "折叠 (" + lines + " 行)";
        } else {
          pre.setAttribute("data-agy-maomao-folded", "1");
          btn.setAttribute("aria-expanded", "false");
          btn.textContent = "展开 (" + lines + " 行)";
          // Compensate scroll offset if user was scrolled past the top of this code block
          if (scroller && typeof scroller.scrollTop === "number" && beforeRect) {
            const afterRect = typeof pre.getBoundingClientRect === "function" ? pre.getBoundingClientRect() : null;
            const afterHeight = afterRect ? afterRect.height : Math.min(220, beforeHeight);
            if (beforeTop < 0) {
              const delta = Math.max(0, beforeHeight - afterHeight);
              const compensation = Math.min(delta, Math.abs(beforeTop) + 24);
              scroller.scrollTop = Math.max(0, scroller.scrollTop - compensation);
            }
          }
        }
      });

      if (typeof bar.appendChild === "function") bar.appendChild(btn);
      else if (typeof bar.append === "function") bar.append(btn);

      if (typeof pre.prepend === "function") {
        pre.prepend(bar);
      } else if (typeof pre.insertBefore === "function") {
        pre.insertBefore(bar, pre.firstChild || null);
      } else if (typeof pre.appendChild === "function") {
        pre.appendChild(bar);
      }
      codeFoldTracked.add({ pre, bar });
    }
  }

  function cleanupCodeFold() {
    for (const item of codeFoldTracked) {
      try { item.bar.remove(); } catch {}
      try {
        item.pre.removeAttribute("data-agy-maomao-foldable");
        item.pre.removeAttribute("data-agy-maomao-folded");
        item.pre.removeAttribute("data-agy-maomao-lines");
      } catch {}
    }
    codeFoldTracked.clear();
  }

  // =========================================================================
  // Legacy outline node cleanup (outlineRail feature permanently removed in REV 6)
  // =========================================================================
  function purgeLegacyOutlineNodes() {
    if (typeof document.querySelectorAll !== "function") return;
    try {
      const legacy = document.querySelectorAll("#agy-maomao-outline-rail, #agy-maomao-outline-pop");
      for (let i = 0; i < legacy.length; i++) {
        try { legacy[i].remove(); } catch {}
      }
      const pulsed = document.querySelectorAll("[data-agy-maomao-turn-pulse]");
      for (let i = 0; i < pulsed.length; i++) {
        try { pulsed[i].removeAttribute("data-agy-maomao-turn-pulse"); } catch {}
      }
    } catch {}
  }

  // =========================================================================
  // 2. Context Menu: Radial Pie Ring (6 slices) + File Pill Menu (`contextMenu`)
  // =========================================================================
  const SVG_NS = "http://www.w3.org/2000/svg";
  const RADIAL_SIZE = 256;
  const RADIAL_HALF = 128;
  const RADIAL_PAD = 12;
  const RADIAL_INNER_R = 44;
  const RADIAL_OUTER_R = 114;
  const RADIAL_DISMISS_R = 158;
  const RADIAL_EXCLUDED_SEL = [
    '[data-testid="agent-input-box"]',
    '[contenteditable="true"]',
    '[contenteditable=""]',
    "input",
    "textarea",
    "select",
    '[role="textbox"]',
    ".monaco-editor",
    ".cm-editor",
    ".xterm",
    ".integrated-terminal",
    "pre",
    "code",
    "a[href]",
    "button",
    '[role="button"]',
    "aside",
    '[role="navigation"]',
    '[data-testid="conversation-row-sidebar"]',
    '[data-testid="side-question-panel"]',
    '[data-side-panel-focus-scope="true"]',
    '[role="dialog"]',
    '[role="menu"]',
    "[data-popover-popup]",
    "img",
    "video",
    "audio",
    "canvas",
    "iframe",
    "[data-agy-maomao-ui]",
  ].join(",");

  let ctxMenuEl = null;
  let ctxMenuCenter = null;
  let ctxLeaveTimer = null;
  let ctxMenuHandler = null;
  let ctxDismissDown = null;
  let ctxDismissKey = null;
  let ctxDismissScroll = null;
  let ctxDismissBlur = null;
  let ctxPointerMove = null;

  function createSvgEl(tag) {
    if (typeof document.createElementNS === "function") {
      return document.createElementNS(SVG_NS, tag);
    }
    return document.createElement(tag);
  }

  function detectHostDark() {
    try {
      const html = document.documentElement;
      const body = document.body;
      const htmlTheme = (html && typeof html.getAttribute === "function" && html.getAttribute("data-theme")) || "";
      const bodyTheme = (body && typeof body.getAttribute === "function" && body.getAttribute("data-theme")) || "";
      const cls = String((html && html.className) || "") + " " + String((body && body.className) || "");
      if (htmlTheme === "light" || bodyTheme === "light" || /\blight\b|\blight-theme\b/i.test(cls)) {
        return false;
      }
      if (htmlTheme === "dark" || bodyTheme === "dark" || /\bdark\b|\bdark-theme\b/i.test(cls)) {
        return true;
      }
      if (typeof window.matchMedia === "function") {
        if (window.matchMedia("(prefers-color-scheme: light)").matches) return false;
        if (window.matchMedia("(prefers-color-scheme: dark)").matches) return true;
      }
    } catch {}
    return true;
  }

  function detectIsGlass() {
    try {
      const html = document.documentElement;
      if (html && html.classList && typeof html.classList.contains === "function" && html.classList.contains("agy-dream-active-v2")) {
        return true;
      }
      if (html && typeof html.className === "string" && /\bagy-dream-active-v2\b/.test(html.className)) {
        return true;
      }
      if (typeof document.getElementById === "function" && document.getElementById("agy-dream-wallpaper-v2")) {
        return true;
      }
      if (typeof document.querySelector === "function" && document.querySelector("#agy-dream-wallpaper-v2")) {
        return true;
      }
    } catch {}
    return false;
  }

  function detectRadialTheme() {
    let style = state.themeStyle;
    if (!style && typeof document.querySelector === "function") {
      try {
        const el = document.querySelector("[data-agy-theme-style]");
        const attr = el && typeof el.getAttribute === "function" ? el.getAttribute("data-agy-theme-style") : "";
        if (attr === "official" || attr === "star-neko") style = attr;
      } catch {}
    }
    if (style !== "official") style = "star-neko";

    const isDark = detectHostDark();
    const isGlass = detectIsGlass();
    const surface = isGlass ? (isDark ? "glass-dark" : "glass-light") : (isDark ? "dark" : "light");
    return { themeStyle: style, themeMode: isDark ? "dark" : "light", isDark, isGlass, surface };
  }

  let currentSurface = "dark";
  let themeObserver = null;
  let colorSchemeMql = null;
  let colorSchemeHandler = null;

  function syncSurfaceTheme() {
    if (destroyed || !document.documentElement) return detectRadialTheme();
    const theme = detectRadialTheme();
    currentSurface = theme.surface;
    try {
      if (document.documentElement.getAttribute("data-agy-maomao-wb-surface") !== theme.surface) {
        document.documentElement.setAttribute("data-agy-maomao-wb-surface", theme.surface);
      }
    } catch {}
    if (ctxMenuEl && ctxMenuEl.isConnected !== false) {
      try {
        ctxMenuEl.setAttribute("data-surface", theme.surface);
        ctxMenuEl.setAttribute("data-theme-style", theme.themeStyle);
        ctxMenuEl.setAttribute("data-theme-mode", theme.themeMode);
      } catch {}
    }
    return theme;
  }

  function startSurfaceObserver() {
    if (destroyed) return;
    if (!themeObserver && typeof MutationObserver === "function" && document.documentElement) {
      themeObserver = new MutationObserver(function () {
        if (!destroyed) syncSurfaceTheme();
      });
      try {
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
        if (document.body) {
          themeObserver.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
          });
        }
      } catch {
        themeObserver = null;
      }
    }
    if (!colorSchemeMql && typeof window.matchMedia === "function") {
      try {
        colorSchemeMql = window.matchMedia("(prefers-color-scheme: dark)");
        if (colorSchemeMql && typeof colorSchemeMql.addEventListener === "function") {
          colorSchemeHandler = function () {
            if (!destroyed) syncSurfaceTheme();
          };
          colorSchemeMql.addEventListener("change", colorSchemeHandler);
        }
      } catch {
        colorSchemeMql = null;
      }
    }
  }

  function stopSurfaceObserver() {
    if (themeObserver) {
      try { themeObserver.disconnect(); } catch {}
      themeObserver = null;
    }
    if (colorSchemeMql && colorSchemeHandler && typeof colorSchemeMql.removeEventListener === "function") {
      try { colorSchemeMql.removeEventListener("change", colorSchemeHandler); } catch {}
    }
    colorSchemeMql = null;
    colorSchemeHandler = null;
  }

  function buildAnnularSectorPath(startDeg, endDeg, rInner, rOuter, gapDeg) {
    const a0 = ((startDeg + gapDeg) * Math.PI) / 180;
    const a1 = ((endDeg - gapDeg) * Math.PI) / 180;
    const x0o = (rOuter * Math.cos(a0)).toFixed(2);
    const y0o = (rOuter * Math.sin(a0)).toFixed(2);
    const x1o = (rOuter * Math.cos(a1)).toFixed(2);
    const y1o = (rOuter * Math.sin(a1)).toFixed(2);
    const x1i = (rInner * Math.cos(a1)).toFixed(2);
    const y1i = (rInner * Math.sin(a1)).toFixed(2);
    const x0i = (rInner * Math.cos(a0)).toFixed(2);
    const y0i = (rInner * Math.sin(a0)).toFixed(2);
    const largeArc = endDeg - startDeg - gapDeg * 2 > 180 ? 1 : 0;
    return (
      "M " + x0o + " " + y0o +
      " A " + rOuter + " " + rOuter + " 0 " + largeArc + " 1 " + x1o + " " + y1o +
      " L " + x1i + " " + y1i +
      " A " + rInner + " " + rInner + " 0 " + largeArc + " 0 " + x0i + " " + y0i +
      " Z"
    );
  }

  function closeContextMenu() {
    if (ctxLeaveTimer) {
      clearTimeout(ctxLeaveTimer);
      ctxLeaveTimer = null;
    }
    ctxMenuCenter = null;
    if (ctxMenuEl) {
      try { ctxMenuEl.remove(); } catch {}
      ctxMenuEl = null;
    }
  }

  async function triggerFileReveal(filePath) {
    const url = apiUrl("/api/maomao/file-action");
    if (!url || typeof fetch !== "function") {
      showToast("未连接本地服务，无法定位文件");
      return;
    }
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify({ action: "reveal", path: filePath }),
      });
      if (res && res.ok) {
        showToast("已在资源管理器中定位");
      } else {
        showToast("定位文件失败");
      }
    } catch {
      showToast("定位文件请求失败");
    }
  }

  function openFileContextMenu(x, y, title, items) {
    closeContextMenu();
    if (!document.body || destroyed) return;
    const theme = syncSurfaceTheme();
    const menu = document.createElement("div");
    menu.id = "agy-maomao-context-menu";
    menu.className = "agy-mm-ctx-menu";
    menu.setAttribute("role", "menu");
    menu.setAttribute("data-agy-maomao-ui", "workbench");
    menu.setAttribute("data-agy-maomao-menu-kind", "file");
    menu.setAttribute("data-surface", theme.surface);
    menu.setAttribute("data-theme-style", theme.themeStyle);
    menu.setAttribute("data-theme-mode", theme.themeMode);

    if (title) {
      const tEl = document.createElement("div");
      tEl.className = "agy-mm-ctx-title";
      tEl.textContent = title;
      menu.appendChild(tEl);
    }

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agy-mm-ctx-btn";
      btn.setAttribute("role", "menuitem");
      if (it.id) btn.setAttribute("data-agy-maomao-ctx-action", it.id);

      const lbl = document.createElement("span");
      lbl.textContent = it.label;
      btn.appendChild(lbl);

      if (it.tag) {
        const tag = document.createElement("span");
        tag.className = "agy-mm-ctx-tag";
        tag.textContent = it.tag;
        btn.appendChild(tag);
      }

      btn.addEventListener("click", function (ev) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        closeContextMenu();
        try { it.onClick(); } catch {}
      });
      menu.appendChild(btn);
    }

    const vw = typeof window.innerWidth === "number" ? window.innerWidth : 1280;
    const vh = typeof window.innerHeight === "number" ? window.innerHeight : 720;
    const left = Math.max(8, Math.min(vw - 240, Number(x) || 24));
    const top = Math.max(8, Math.min(vh - 220, Number(y) || 24));
    menu.style.left = Math.round(left) + "px";
    menu.style.top = Math.round(top) + "px";

    document.body.appendChild(menu);
    ctxMenuEl = menu;
  }

  function openRadialPieMenu(x, y, selectedText) {
    closeContextMenu();
    if (!document.body || destroyed) return;

    const cleanSel = String(selectedText || "").replace(/\r\n?/g, "\n").trim().slice(0, 1200);
    const theme = syncSurfaceTheme();
    const vw = typeof window.innerWidth === "number" ? window.innerWidth : 1280;
    const vh = typeof window.innerHeight === "number" ? window.innerHeight : 720;
    const rawX = Number.isFinite(Number(x)) ? Number(x) : vw / 2;
    const rawY = Number.isFinite(Number(y)) ? Number(y) : vh / 2;

    // Clamp radial menu center so the full 256x256 ring never clips outside viewport
    const minX = RADIAL_HALF + RADIAL_PAD;
    const maxX = Math.max(minX, vw - RADIAL_HALF - RADIAL_PAD);
    const minY = RADIAL_HALF + RADIAL_PAD;
    const maxY = Math.max(minY, vh - RADIAL_HALF - RADIAL_PAD);
    const cx = Math.round(Math.max(minX, Math.min(maxX, rawX)));
    const cy = Math.round(Math.max(minY, Math.min(maxY, rawY)));
    const left = cx - RADIAL_HALF;
    const top = cy - RADIAL_HALF;

    const slices = [
      {
        id: "slash-swarm",
        label: "Swarm 蜂群",
        cmd: "/swarm",
        // Hexagonal hive icon (16x16 coordinate space)
        iconPath: "M8 2.2L12.8 5v6L8 13.8 3.2 11V5zM8 6.2v3.6M6.2 8h3.6",
        onClick: function () {
          const filled = insertIntoComposer(cleanSel ? "/swarm " + cleanSel + " " : "/swarm ");
          showToast(filled ? "已填入 /swarm 蜂群协作" : "未找到输入框");
        },
      },
      {
        id: "slash-btw",
        label: "侧边提问",
        cmd: "/btw",
        // Dual side-chat bubble icon
        iconPath: "M2.5 3.5h11v7.5H6.5L3.5 13.5V11h-1zM9.5 3.5v7.5",
        onClick: function () {
          triggerBtwAction(cleanSel);
        },
      },
      {
        id: "slash-compact",
        label: "压缩上下文",
        cmd: "/compact",
        // Inward compress arrows icon
        iconPath: "M3 8h10M8 2v4M6 4.2L8 6.2l2-2M8 14v-4M6 11.8L8 9.8l2 2",
        onClick: function () {
          const filled = insertIntoComposer("/compact");
          showToast(filled ? "已填入 /compact 压缩上下文" : "未找到输入框");
        },
      },
      {
        id: "slash-plan",
        label: "规划模式",
        cmd: "/plan",
        // Structured checklist icon
        iconPath: "M3 4.5h1.5M6.5 4.5h6.5M3 8h1.5M6.5 8h6.5M3 11.5h1.5M6.5 11.5h5",
        onClick: function () {
          const filled = insertIntoComposer(cleanSel ? "/plan " + cleanSel + " " : "/plan ");
          showToast(filled ? "已填入 /plan 规划模式" : "未找到输入框");
        },
      },
      {
        id: "slash-grill-me",
        label: "深度访谈",
        cmd: "/grill-me",
        // Overlapping dialogue bubbles icon
        iconPath: "M2.5 3.5h7.5v5.5H5.5l-2 2v-2h-1zM9.5 6.5h4v5.5h-1v1.8l-1.8-1.8H7.2v-1",
        onClick: function () {
          const filled = insertIntoComposer(cleanSel ? "/grill-me " + cleanSel + " " : "/grill-me ");
          showToast(filled ? "已填入 /grill-me 深度访谈" : "未找到输入框");
        },
      },
      {
        id: "slash-learn",
        label: "经验沉淀",
        cmd: "/learn",
        // Four-point sparkle icon
        iconPath: "M8 2l1.6 4.4L14 8l-4.4 1.6L8 14l-1.6-4.4L2 8l4.4-1.6z",
        onClick: function () {
          const filled = insertIntoComposer(cleanSel ? "/learn " + cleanSel + " " : "/learn ");
          showToast(filled ? "已填入 /learn 经验沉淀" : "未找到输入框");
        },
      },
    ];

    const host = document.createElement("div");
    host.id = "agy-maomao-context-menu";
    host.className = "agy-mm-radial-menu";
    host.setAttribute("role", "menu");
    host.setAttribute("aria-label", "喵言分块圆环快捷轮盘");
    host.setAttribute("data-agy-maomao-ui", "workbench");
    host.setAttribute("data-agy-maomao-radial", "1");
    host.setAttribute("data-agy-maomao-menu-kind", "radial");
    host.setAttribute("data-surface", theme.surface);
    host.setAttribute("data-theme-style", theme.themeStyle);
    host.setAttribute("data-theme-mode", theme.themeMode);
    host.setAttribute("data-clamped-x", String(cx));
    host.setAttribute("data-clamped-y", String(cy));
    host.style.left = left + "px";
    host.style.top = top + "px";
    // Inline defense-in-depth so no global [role="menu"] rule can ever paint a square box
    if (typeof host.style.setProperty === "function") {
      host.style.setProperty("background", "transparent", "important");
      host.style.setProperty("background-image", "none", "important");
      host.style.setProperty("border", "0", "important");
      host.style.setProperty("box-shadow", "none", "important");
      host.style.setProperty("backdrop-filter", "none", "important");
      host.style.setProperty("-webkit-backdrop-filter", "none", "important");
      host.style.setProperty("border-radius", "50%", "important");
      host.style.setProperty("padding", "0", "important");
    } else {
      host.style.background = "transparent";
      host.style.backgroundImage = "none";
      host.style.border = "0";
      host.style.boxShadow = "none";
      host.style.backdropFilter = "none";
      host.style.webkitBackdropFilter = "none";
      host.style.borderRadius = "50%";
      host.style.padding = "0";
    }

    const glassRing = document.createElement("div");
    glassRing.className = "agy-mm-radial-glass-ring";
    glassRing.setAttribute("aria-hidden", "true");
    host.appendChild(glassRing);

    const svg = createSvgEl("svg");
    svg.setAttribute("class", "agy-mm-radial-svg");
    svg.setAttribute("viewBox", "-128 -128 256 256");
    svg.setAttribute("width", String(RADIAL_SIZE));
    svg.setAttribute("height", String(RADIAL_SIZE));

    // Central hub (copy selection when text is selected, otherwise close ring)
    const defaultHubTitle = cleanSel ? "复制选区" : "收起";
    const defaultHubSub = cleanSel ? cleanSel.length + " 字" : "Shift 原生";

    const hubGroup = createSvgEl("g");
    hubGroup.setAttribute("class", "agy-mm-pie-hub");
    hubGroup.setAttribute("role", "menuitem");
    hubGroup.setAttribute("data-agy-maomao-ctx-action", cleanSel ? "copy-selection" : "close-radial");

    const hubCircle = createSvgEl("circle");
    hubCircle.setAttribute("class", "agy-mm-pie-hub-circle");
    hubCircle.setAttribute("cx", "0");
    hubCircle.setAttribute("cy", "0");
    hubCircle.setAttribute("r", "38");
    hubGroup.appendChild(hubCircle);

    const hubTitle = createSvgEl("text");
    hubTitle.setAttribute("class", "agy-mm-pie-hub-title");
    hubTitle.setAttribute("x", "0");
    hubTitle.setAttribute("y", "-5");
    hubTitle.textContent = defaultHubTitle;
    hubGroup.appendChild(hubTitle);

    const hubSub = createSvgEl("text");
    hubSub.setAttribute("class", "agy-mm-pie-hub-sub");
    hubSub.setAttribute("x", "0");
    hubSub.setAttribute("y", "11");
    hubSub.textContent = defaultHubSub;
    hubGroup.appendChild(hubSub);

    hubGroup.addEventListener("click", function (ev) {
      if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
      if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
      closeContextMenu();
      if (cleanSel) {
        copyToClipboard(cleanSel);
        showToast("已复制选中文本");
      }
    });

    // Build 6 symmetric 60-deg pie slices centered at 12, 2, 4, 6, 8, 10 o'clock
    const stepDeg = 360 / slices.length;
    const rMid = (RADIAL_INNER_R + RADIAL_OUTER_R) / 2;

    for (let i = 0; i < slices.length; i++) {
      const slice = slices[i];
      const startDeg = -120 + i * stepDeg;
      const endDeg = startDeg + stepDeg;
      const midRad = (((startDeg + endDeg) / 2) * Math.PI) / 180;
      const mx = rMid * Math.cos(midRad);
      const my = rMid * Math.sin(midRad);
      const popX = (4.5 * Math.cos(midRad)).toFixed(2) + "px";
      const popY = (4.5 * Math.sin(midRad)).toFixed(2) + "px";

      const g = createSvgEl("g");
      g.setAttribute("class", "agy-mm-pie-slice");
      g.setAttribute("role", "menuitem");
      g.setAttribute("data-agy-maomao-ctx-action", slice.id);
      g.setAttribute("data-slice-index", String(i));
      g.setAttribute("data-cmd", slice.cmd);
      if (g.style && typeof g.style.setProperty === "function") {
        g.style.setProperty("--mm-tx", popX);
        g.style.setProperty("--mm-ty", popY);
      } else if (g.style) {
        g.style["--mm-tx"] = popX;
        g.style["--mm-ty"] = popY;
      }

      const path = createSvgEl("path");
      path.setAttribute("class", "agy-mm-pie-path");
      path.setAttribute("d", buildAnnularSectorPath(startDeg, endDeg, RADIAL_INNER_R, RADIAL_OUTER_R, 1.8));
      g.appendChild(path);

      // Slice icon positioned above label
      const iconWrap = createSvgEl("g");
      iconWrap.setAttribute(
        "transform",
        "translate(" + (mx - 7.5).toFixed(1) + "," + (my - 19.5).toFixed(1) + ") scale(0.94)"
      );
      const iconPath = createSvgEl("path");
      iconPath.setAttribute("class", "agy-mm-pie-icon");
      iconPath.setAttribute("d", slice.iconPath);
      iconWrap.appendChild(iconPath);
      g.appendChild(iconWrap);

      const lbl = createSvgEl("text");
      lbl.setAttribute("class", "agy-mm-pie-label");
      lbl.setAttribute("x", mx.toFixed(1));
      lbl.setAttribute("y", (my + 4.5).toFixed(1));
      lbl.textContent = slice.label;
      g.appendChild(lbl);

      const cmd = createSvgEl("text");
      cmd.setAttribute("class", "agy-mm-pie-cmd");
      cmd.setAttribute("x", mx.toFixed(1));
      cmd.setAttribute("y", (my + 17.5).toFixed(1));
      cmd.textContent = slice.cmd;
      g.appendChild(cmd);

      g.addEventListener("pointerenter", function () {
        if (ctxLeaveTimer) { clearTimeout(ctxLeaveTimer); ctxLeaveTimer = null; }
        g.setAttribute("data-active", "1");
        hubTitle.textContent = slice.cmd;
        hubSub.textContent = slice.label;
      });
      g.addEventListener("pointerleave", function () {
        g.removeAttribute("data-active");
        hubTitle.textContent = defaultHubTitle;
        hubSub.textContent = defaultHubSub;
      });
      g.addEventListener("click", function (ev) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        closeContextMenu();
        try { slice.onClick(); } catch {}
      });

      svg.appendChild(g);
    }

    svg.appendChild(hubGroup);
    host.appendChild(svg);
    document.body.appendChild(host);
    ctxMenuEl = host;
    ctxMenuCenter = { cx, cy };
  }

  function ensureContextMenu() {
    if (!state.workbench.contextMenu || destroyed) return;
    if (ctxMenuHandler || typeof document.addEventListener !== "function") return;

    ctxMenuHandler = function (ev) {
      if (!state.workbench.contextMenu || destroyed || !ev) return;
      // Hold Shift + Right-click to bypass and show native browser/host context menu
      if (ev.shiftKey) return;
      const target = ev.target;
      if (!target || target.nodeType !== 1) return;

      // Case A: File pill / local path target -> retain file action menu
      const filePill =
        typeof target.closest === "function"
          ? target.closest('[data-uri^="file://"], a[href^="file://"], [data-file-path], [data-testid*="file-chip"], [data-testid*="file-pill"], [data-testid*="changed-file"]')
          : null;
      const inOwnUi = typeof target.closest === "function" && Boolean(target.closest("[data-agy-maomao-ui]"));
      if (inOwnUi) return;

      const detectedPath = extractLocalFilePath(filePill || target);
      if (detectedPath) {
        if (typeof ev.preventDefault === "function") ev.preventDefault();
        if (typeof ev.stopPropagation === "function") ev.stopPropagation();
        openFileContextMenu(ev.clientX, ev.clientY, detectedPath, [
          {
            id: "copy-path",
            label: "复制绝对路径",
            tag: "Copy",
            onClick: function () {
              copyToClipboard(detectedPath);
              showToast("已复制绝对路径");
            },
          },
          {
            id: "reveal-file",
            label: "在资源管理器中定位",
            tag: "Explorer",
            onClick: function () {
              triggerFileReveal(detectedPath);
            },
          },
          {
            id: "mention-file",
            label: "填入 @引用",
            tag: "@file",
            onClick: function () {
              insertIntoComposer("@" + detectedPath + " ");
            },
          },
        ]);
        return;
      }

      // Case B: Host safe exclusion zones (editors, code blocks, links, buttons, dialogs, sidebars, media)
      if (typeof target.closest === "function" && target.closest(RADIAL_EXCLUDED_SEL)) {
        return;
      }

      // Case C: Conversation area / message blank area -> Radial Pie Ring 6-slice menu
      const inConversation =
        typeof target.closest === "function" &&
        Boolean(target.closest('[data-testid="conversation-view"], [data-testid="agent-response"], [data-testid="user-input-step"], [data-testid="user-message"]'));
      if (!inConversation) return;

      if (typeof ev.preventDefault === "function") ev.preventDefault();
      if (typeof ev.stopPropagation === "function") ev.stopPropagation();

      let selectedText = "";
      try {
        if (typeof window.getSelection === "function") {
          selectedText = String(window.getSelection() || "").trim().slice(0, 1200);
        }
      } catch {}

      openRadialPieMenu(ev.clientX, ev.clientY, selectedText);
    };

    ctxDismissDown = function (ev) {
      if (!ctxMenuEl) return;
      if (ev && ev.target && typeof ctxMenuEl.contains === "function" && ctxMenuEl.contains(ev.target)) return;
      closeContextMenu();
    };
    ctxDismissKey = function (ev) {
      if (ev && ev.key === "Escape") closeContextMenu();
    };
    ctxDismissScroll = function () {
      if (ctxMenuEl) closeContextMenu();
    };
    ctxDismissBlur = function () {
      if (ctxMenuEl) closeContextMenu();
    };
    ctxPointerMove = function (ev) {
      if (!ctxMenuEl || !ctxMenuCenter || !ev) return;
      if (ctxMenuEl.getAttribute("data-agy-maomao-menu-kind") !== "radial") return;
      const dx = (Number(ev.clientX) || 0) - ctxMenuCenter.cx;
      const dy = (Number(ev.clientY) || 0) - ctxMenuCenter.cy;
      const dist = Math.hypot(dx, dy);
      if (dist > RADIAL_DISMISS_R) {
        if (!ctxLeaveTimer) {
          ctxLeaveTimer = setTimeout(function () {
            ctxLeaveTimer = null;
            closeContextMenu();
          }, 260);
        }
      } else if (ctxLeaveTimer) {
        clearTimeout(ctxLeaveTimer);
        ctxLeaveTimer = null;
      }
    };

    document.addEventListener("contextmenu", ctxMenuHandler, true);
    document.addEventListener("pointerdown", ctxDismissDown, true);
    document.addEventListener("keydown", ctxDismissKey, true);
    document.addEventListener("scroll", ctxDismissScroll, true);
    document.addEventListener("pointermove", ctxPointerMove, true);
    if (typeof window.addEventListener === "function") {
      window.addEventListener("blur", ctxDismissBlur);
    }
  }

  function cleanupContextMenu() {
    closeContextMenu();
    if (typeof document.removeEventListener === "function") {
      if (ctxMenuHandler) { document.removeEventListener("contextmenu", ctxMenuHandler, true); ctxMenuHandler = null; }
      if (ctxDismissDown) { document.removeEventListener("pointerdown", ctxDismissDown, true); ctxDismissDown = null; }
      if (ctxDismissKey) { document.removeEventListener("keydown", ctxDismissKey, true); ctxDismissKey = null; }
      if (ctxDismissScroll) { document.removeEventListener("scroll", ctxDismissScroll, true); ctxDismissScroll = null; }
      if (ctxPointerMove) { document.removeEventListener("pointermove", ctxPointerMove, true); ctxPointerMove = null; }
    }
    if (typeof window.removeEventListener === "function" && ctxDismissBlur) {
      window.removeEventListener("blur", ctxDismissBlur);
      ctxDismissBlur = null;
    }
  }

  // =========================================================================
  // 4. Inline Git Diff Preview (`inlineDiff`)
  // =========================================================================
  const diffCache = new Map();
  const diffInflight = new Map();
  const diffTracked = new Set();

  function getCachedDiff(filePath) {
    const rec = diffCache.get(filePath);
    if (!rec) return null;
    if (Date.now() - rec.at > DIFF_CACHE_TTL_MS) {
      diffCache.delete(filePath);
      return null;
    }
    return rec.data;
  }

  function setCachedDiff(filePath, data) {
    if (diffCache.size >= DIFF_CACHE_MAX) {
      const oldestKey = diffCache.keys().next().value;
      if (oldestKey !== undefined) diffCache.delete(oldestKey);
    }
    diffCache.set(filePath, { at: Date.now(), data });
  }

  async function fetchGitDiff(filePath, force) {
    if (!force) {
      const cached = getCachedDiff(filePath);
      if (cached) return cached;
    }
    if (!force && diffInflight.has(filePath)) {
      return diffInflight.get(filePath);
    }
    const url = apiUrl("/api/maomao/git-diff", { path: filePath });
    if (!url || typeof fetch !== "function") {
      return { ok: false, error: "未连接本地服务" };
    }
    const p = (async function () {
      try {
        const res = await fetch(url, { method: "GET", headers: apiHeaders(false) });
        const json = await res.json();
        const data = json && typeof json === "object" ? json : { ok: false, error: "返回格式异常" };
        if (res && res.ok) setCachedDiff(filePath, data);
        return data;
      } catch (err) {
        return { ok: false, error: err && err.message ? err.message : "加载 Diff 失败" };
      } finally {
        diffInflight.delete(filePath);
      }
    })();
    diffInflight.set(filePath, p);
    return p;
  }

  function renderDiffPanel(filePath, data, onClose) {
    const panel = document.createElement("div");
    panel.className = "agy-mm-diff-panel";
    panel.setAttribute("data-agy-maomao-ui", "workbench");
    panel.setAttribute("data-agy-maomao-diff-panel", "1");

    const head = document.createElement("div");
    head.className = "agy-mm-diff-head";

    const left = document.createElement("span");
    const adds = Number(data && data.additions) || 0;
    const dels = Number(data && data.deletions) || 0;
    left.textContent = filePath + (adds || dels ? "  (+" + adds + " / -" + dels + ")" : "");
    head.appendChild(left);

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "agy-mm-thought-btn";
    closeBtn.textContent = "收起";
    closeBtn.addEventListener("click", function () {
      try { panel.remove(); } catch {}
      if (typeof onClose === "function") onClose();
    });
    head.appendChild(closeBtn);
    panel.appendChild(head);

    const body = document.createElement("div");
    body.className = "agy-mm-diff-body";

    const rawDiff = typeof (data && data.diff) === "string" ? data.diff : "";
    if (!rawDiff) {
      const empty = document.createElement("div");
      empty.className = "agy-mm-diff-line";
      empty.textContent = (data && (data.error || data.message)) || "暂无未提交的 Git 变更";
      body.appendChild(empty);
    } else {
      const lines = rawDiff.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const row = document.createElement("div");
        row.className = "agy-mm-diff-line";
        if (line.startsWith("+") && !line.startsWith("+++")) {
          row.className += " agy-mm-diff-add";
        } else if (line.startsWith("-") && !line.startsWith("---")) {
          row.className += " agy-mm-diff-del";
        } else if (line.startsWith("@@")) {
          row.className += " agy-mm-diff-hunk";
        }
        row.textContent = line;
        body.appendChild(row);
      }
    }

    panel.appendChild(body);
    return panel;
  }

  function scanInlineDiff() {
    if (!state.workbench.inlineDiff || destroyed) return;
    if (typeof document.querySelectorAll !== "function") return;
    const chips = document.querySelectorAll(
      '[data-testid*="changed-file"], [data-testid*="file-change"], [data-testid*="modified-file"], [data-file-path], [data-testid="agent-response"] a[href^="file://"], [data-testid="agent-response"] [data-uri^="file://"]'
    );
    for (let i = 0; i < chips.length; i++) {
      const chip = chips[i];
      if (!chip || chip.isConnected === false) continue;
      if (typeof chip.closest === "function" && chip.closest("[data-agy-maomao-ui]")) continue;
      if (chip.getAttribute && chip.getAttribute("data-agy-maomao-diff-bound") === "1") continue;
      const filePath = extractLocalFilePath(chip);
      if (!filePath) continue;

      chip.setAttribute("data-agy-maomao-diff-bound", "1");

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "agy-mm-diff-btn";
      btn.setAttribute("data-agy-maomao-ui", "workbench");
      btn.setAttribute("data-agy-maomao-diff-btn", "1");
      btn.textContent = "Diff";

      let hoverTimer = null;
      let panel = null;
      const itemRef = { chip, btn, panel: null };

      btn.addEventListener("pointerenter", function () {
        if (hoverTimer || getCachedDiff(filePath)) return;
        hoverTimer = setTimeout(function () {
          hoverTimer = null;
          fetchGitDiff(filePath, false);
        }, 180);
      });
      btn.addEventListener("pointerleave", function () {
        if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
      });

      btn.addEventListener("click", async function (ev) {
        if (ev && typeof ev.preventDefault === "function") ev.preventDefault();
        if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
        if (panel && panel.isConnected !== false) {
          try { panel.remove(); } catch {}
          panel = null;
          itemRef.panel = null;
          btn.textContent = "Diff";
          return;
        }
        btn.textContent = "加载中…";
        const data = await fetchGitDiff(filePath, false);
        if (destroyed || !state.workbench.inlineDiff) return;
        btn.textContent = "Diff ▾";
        panel = renderDiffPanel(filePath, data, function () {
          panel = null;
          itemRef.panel = null;
          btn.textContent = "Diff";
        });
        if (btn.parentElement && typeof btn.parentElement.insertBefore === "function") {
          btn.parentElement.insertBefore(panel, btn.nextSibling || null);
        } else if (chip.parentElement && typeof chip.parentElement.appendChild === "function") {
          chip.parentElement.appendChild(panel);
        }
        itemRef.panel = panel;
      });

      if (chip.parentElement && typeof chip.parentElement.insertBefore === "function") {
        chip.parentElement.insertBefore(btn, chip.nextSibling || null);
      } else if (typeof chip.appendChild === "function") {
        chip.appendChild(btn);
      }

      diffTracked.add(itemRef);
    }
  }

  function cleanupInlineDiff() {
    for (const item of diffTracked) {
      try { item.btn.remove(); } catch {}
      if (item.panel) { try { item.panel.remove(); } catch {} }
      try { item.chip.removeAttribute("data-agy-maomao-diff-bound"); } catch {}
    }
    diffTracked.clear();
    diffCache.clear();
    diffInflight.clear();
  }

  // =========================================================================
  // 5. Native Search Full-Text Enhancement (`fullTextSearch`)
  // =========================================================================
  let searchBoundInput = null;
  let searchPanelEl = null;
  let searchListEl = null;
  let searchTabBtns = [];
  let searchScope = "all";
  let searchDebounceTimer = null;
  let searchAbortCtrl = null;
  let searchInputListener = null;

  function findNativeSearchInput() {
    if (typeof document.querySelector !== "function") return null;
    return (
      document.querySelector('input[placeholder="Search for conversations..."]') ||
      document.querySelector('input[placeholder="Search conversations..."]') ||
      document.querySelector('input[placeholder="搜索会话…"]') ||
      document.querySelector('input[placeholder="搜索会话"]') ||
      document.querySelector('input[data-agy-original-placeholder="Search for conversations..."]') ||
      document.querySelector('[data-testid="fast-pick-viewport"] input') ||
      document.querySelector('[role="dialog"] input[type="search"]')
    );
  }

  function renderHighlightedSnippet(container, text, query) {
    const raw = String(text || "");
    const q = String(query || "").trim();
    if (!q) {
      container.textContent = raw;
      return;
    }
    const lower = raw.toLowerCase();
    const needle = q.toLowerCase();
    const idx = lower.indexOf(needle);
    if (idx < 0) {
      container.textContent = raw;
      return;
    }
    if (idx > 0) container.appendChild(document.createTextNode(raw.slice(0, idx)));
    const mark = document.createElement("mark");
    mark.className = "agy-mm-search-mark";
    mark.textContent = raw.slice(idx, idx + needle.length);
    container.appendChild(mark);
    if (idx + needle.length < raw.length) {
      container.appendChild(document.createTextNode(raw.slice(idx + needle.length)));
    }
  }

  async function executeFullTextSearch(query) {
    if (!searchListEl || destroyed || !state.workbench.fullTextSearch) return;
    const q = String(query || "").trim();
    while (searchListEl.firstChild) searchListEl.removeChild(searchListEl.firstChild);

    if (!q || (q.length < 2 && /^[\x00-\x7f]+$/.test(q))) {
      const hint = document.createElement("div");
      hint.textContent = "输入关键词检索历史会话正文、代码块与命令…";
      searchListEl.appendChild(hint);
      return;
    }

    if (searchAbortCtrl) {
      try { searchAbortCtrl.abort(); } catch {}
      searchAbortCtrl = null;
    }

    const url = apiUrl("/api/maomao/search", { q: q, scope: searchScope });
    if (!url || typeof fetch !== "function") {
      const errEl = document.createElement("div");
      errEl.textContent = "全文检索需要本地服务在线";
      searchListEl.appendChild(errEl);
      return;
    }

    const loadingEl = document.createElement("div");
    loadingEl.textContent = "正在检索历史对话…";
    searchListEl.appendChild(loadingEl);

    const ctrl = typeof AbortController === "function" ? new AbortController() : null;
    searchAbortCtrl = ctrl;

    try {
      const res = await fetch(url, {
        method: "GET",
        headers: apiHeaders(false),
        signal: ctrl ? ctrl.signal : undefined,
      });
      const json = await res.json();
      if (destroyed || !searchListEl) return;
      while (searchListEl.firstChild) searchListEl.removeChild(searchListEl.firstChild);

      const results = Array.isArray(json && json.results) ? json.results : Array.isArray(json) ? json : [];
      if (!results.length) {
        const none = document.createElement("div");
        none.textContent = "未找到匹配的历史记录";
        searchListEl.appendChild(none);
        return;
      }

      for (let i = 0; i < Math.min(results.length, 20); i++) {
        const hit = results[i] || {};
        const row = document.createElement("div");
        row.className = "agy-mm-search-row";
        row.setAttribute("data-agy-maomao-search-hit", String(i));

        const content = document.createElement("div");
        content.style.flex = "1";
        content.style.minWidth = "0";

        const meta = document.createElement("div");
        meta.style.fontWeight = "600";
        meta.style.marginBottom = "2px";
        const title = hit.title || hit.fallbackTitle || hit.conversationId || "历史会话";
        const turnNum = hit.turnNumber ? " #" + hit.turnNumber : "";
        const kindMap = { code: "代码", command: "命令", output: "输出", prompt: "提问", response: "回复" };
        const kindTag = kindMap[hit.kind] || "文本";
        meta.textContent = title + turnNum + " · " + kindTag;

        const snip = document.createElement("div");
        renderHighlightedSnippet(snip, hit.snippet || hit.text || "", q);

        content.appendChild(meta);
        content.appendChild(snip);
        row.appendChild(content);

        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "agy-mm-thought-btn";
        copyBtn.textContent = "复制";
        copyBtn.addEventListener("click", function (ev) {
          if (ev && typeof ev.stopPropagation === "function") ev.stopPropagation();
          copyToClipboard(hit.copyText || hit.snippet || hit.text || "");
          showToast("已复制匹配内容");
        });
        row.appendChild(copyBtn);

        row.addEventListener("click", function () {
          const cid = hit.conversationId;
          if (cid && typeof document.querySelector === "function") {
            const link = document.querySelector('a[href*="' + cid.replace(/"/g, "") + '"]');
            if (link && typeof link.click === "function") {
              link.click();
              return;
            }
          }
          copyToClipboard(hit.copyText || hit.snippet || cid || "");
          showToast("已复制会话匹配片段");
        });

        searchListEl.appendChild(row);
      }
    } catch (err) {
      if (err && err.name === "AbortError") return;
      if (!searchListEl) return;
      while (searchListEl.firstChild) searchListEl.removeChild(searchListEl.firstChild);
      const fail = document.createElement("div");
      fail.textContent = "检索失败，请稍后重试";
      searchListEl.appendChild(fail);
    }
  }

  function unmountSearchEnhancer() {
    if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
    if (searchAbortCtrl) { try { searchAbortCtrl.abort(); } catch {} searchAbortCtrl = null; }
    if (searchBoundInput && searchInputListener && typeof searchBoundInput.removeEventListener === "function") {
      searchBoundInput.removeEventListener("input", searchInputListener);
    }
    searchBoundInput = null;
    searchInputListener = null;
    if (searchPanelEl) {
      try { searchPanelEl.remove(); } catch {}
      searchPanelEl = null;
    }
    searchListEl = null;
    searchTabBtns = [];
  }

  function scanFullTextSearch() {
    if (!state.workbench.fullTextSearch || destroyed) return;
    const input = findNativeSearchInput();
    if (!input) {
      if (searchBoundInput) unmountSearchEnhancer();
      return;
    }
    if (input === searchBoundInput && searchPanelEl && searchPanelEl.isConnected !== false) {
      return;
    }
    unmountSearchEnhancer();

    // Find dialog card container
    const hostCard =
      (typeof input.closest === "function" && (input.closest('[role="dialog"]') || input.closest('[data-testid="fast-pick-viewport"]'))) ||
      input.parentElement;
    if (!hostCard) return;

    const panel = document.createElement("div");
    panel.className = "agy-mm-search-panel";
    panel.setAttribute("data-agy-maomao-ui", "workbench");
    panel.setAttribute("data-agy-maomao-search-panel", "1");

    const head = document.createElement("div");
    head.className = "agy-mm-search-head";

    const label = document.createElement("span");
    label.textContent = "历史全文检索";
    head.appendChild(label);

    const tabs = document.createElement("div");
    tabs.className = "agy-mm-search-tabs";
    const scopes = [
      { id: "all", text: "全部" },
      { id: "text", text: "正文" },
      { id: "code", text: "代码与命令" },
    ];
    searchTabBtns = [];
    for (let i = 0; i < scopes.length; i++) {
      const sc = scopes[i];
      const tb = document.createElement("button");
      tb.type = "button";
      tb.className = "agy-mm-search-tab";
      tb.setAttribute("data-scope", sc.id);
      tb.setAttribute("data-active", searchScope === sc.id ? "1" : "0");
      tb.textContent = sc.text;
      tb.addEventListener("click", function () {
        searchScope = sc.id;
        for (let j = 0; j < searchTabBtns.length; j++) {
          searchTabBtns[j].setAttribute(
            "data-active",
            searchTabBtns[j].getAttribute("data-scope") === searchScope ? "1" : "0"
          );
        }
        executeFullTextSearch(input.value || "");
      });
      tabs.appendChild(tb);
      searchTabBtns.push(tb);
    }
    head.appendChild(tabs);

    const list = document.createElement("div");
    list.className = "agy-mm-search-list";
    panel.appendChild(head);
    panel.appendChild(list);

    if (typeof hostCard.appendChild === "function") hostCard.appendChild(panel);
    else if (typeof hostCard.append === "function") hostCard.append(panel);

    searchBoundInput = input;
    searchPanelEl = panel;
    searchListEl = list;

    searchInputListener = function () {
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        searchDebounceTimer = null;
        executeFullTextSearch(input.value || "");
      }, 220);
    };
    if (typeof input.addEventListener === "function") {
      input.addEventListener("input", searchInputListener);
    }
    if (input.value && String(input.value).trim()) {
      executeFullTextSearch(input.value);
    }
  }

  // =========================================================================
  // 6. Compact Layout (`compactLayout`)
  // =========================================================================
  function syncCompactLayout() {
    if (destroyed) return;
    if (state.workbench.compactLayout) {
      document.documentElement.setAttribute("data-agy-maomao-compact", "1");
    } else {
      document.documentElement.removeAttribute("data-agy-maomao-compact");
    }
  }

  // =========================================================================
  // 7. Dual-Mode Thought Process Translation (`thoughtTranslate`)
  // =========================================================================
  const thoughtStates = new Map(); // el -> { sourceText, translatedText, box, settleTimer, abortCtrl, status, showOriginal }
  const translateQueue = [];
  let translateInflightCount = 0;

  function applyThoughtView(el, rec) {
    if (!rec || !rec.box) return;
    const isImmersive = state.workbench.thoughtView === "immersive";
    if (rec.status === "done" && isImmersive && !rec.showOriginal) {
      el.setAttribute("data-agy-maomao-thought-hidden", "1");
    } else {
      el.removeAttribute("data-agy-maomao-thought-hidden");
    }
  }

  function renderThoughtBox(el, rec) {
    if (!rec.box || rec.box.isConnected === false) {
      const box = document.createElement("div");
      box.className = "agy-mm-thought-box";
      box.setAttribute("data-agy-maomao-ui", "workbench");
      box.setAttribute("data-agy-maomao-thought-box", "1");
      if (el.parentElement && typeof el.parentElement.insertBefore === "function") {
        el.parentElement.insertBefore(box, el.nextSibling || null);
      } else if (typeof el.appendChild === "function") {
        el.appendChild(box);
      }
      rec.box = box;
    }

    const box = rec.box;
    while (box.firstChild) box.removeChild(box.firstChild);

    const head = document.createElement("div");
    head.className = "agy-mm-thought-head";

    const label = document.createElement("span");
    const modeLabel = state.workbench.thoughtTranslate === "openai" ? "OpenAI 译文" : "思考译文";
    label.textContent =
      rec.status === "loading"
        ? modeLabel + " · 翻译中…"
        : rec.status === "error"
          ? modeLabel + " · 降级显示原文"
          : modeLabel + (state.workbench.thoughtView === "bilingual" ? " · 双语" : " · 沉浸");
    head.appendChild(label);

    const actions = document.createElement("div");
    actions.className = "agy-mm-thought-actions";

    if (rec.status === "done" && state.workbench.thoughtView === "immersive") {
      const toggleBtn = document.createElement("button");
      toggleBtn.type = "button";
      toggleBtn.className = "agy-mm-thought-btn";
      toggleBtn.textContent = rec.showOriginal ? "隐藏原文" : "显示原文";
      toggleBtn.addEventListener("click", function () {
        rec.showOriginal = !rec.showOriginal;
        applyThoughtView(el, rec);
        renderThoughtBox(el, rec);
      });
      actions.appendChild(toggleBtn);
    }

    const retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "agy-mm-thought-btn";
    retryBtn.setAttribute("data-agy-maomao-retranslate", "1");
    retryBtn.textContent = rec.status === "error" ? "重试" : "重译";
    retryBtn.addEventListener("click", function () {
      enqueueThoughtTranslation(el, true);
    });
    actions.appendChild(retryBtn);

    head.appendChild(actions);
    box.appendChild(head);

    const body = document.createElement("div");
    body.className = "agy-mm-thought-body";
    if (rec.status === "done") {
      body.textContent = rec.translatedText;
    } else if (rec.status === "error") {
      body.textContent = rec.errorMessage || "翻译服务暂不可用，已保留原始思考内容。";
    } else {
      body.textContent = "正在转译思考过程…";
    }
    box.appendChild(body);
    applyThoughtView(el, rec);
  }

  function pumpTranslateQueue() {
    while (translateInflightCount < TRANSLATE_MAX_CONCURRENCY && translateQueue.length > 0) {
      if (destroyed || state.workbench.thoughtTranslate === "off") {
        translateQueue.length = 0;
        return;
      }
      const el = translateQueue.shift();
      const rec = thoughtStates.get(el);
      if (!rec || el.isConnected === false) continue;

      const url = apiUrl("/api/maomao/translate");
      if (!url || typeof fetch !== "function") {
        rec.status = "error";
        rec.errorMessage = "未连接本地翻译服务，已保留原文";
        renderThoughtBox(el, rec);
        continue;
      }

      translateInflightCount += 1;
      rec.status = "loading";
      renderThoughtBox(el, rec);

      const ctrl = typeof AbortController === "function" ? new AbortController() : null;
      rec.abortCtrl = ctrl;

      const payload = {
        text: rec.sourceText,
        mode: state.workbench.thoughtTranslate,
        view: state.workbench.thoughtView,
        endpoint: state.workbench.thoughtEndpoint || "",
        model: state.workbench.thoughtModel || "",
      };
      if (state.workbench.thoughtApiKey) {
        payload.apiKey = state.workbench.thoughtApiKey;
      }

      fetch(url, {
        method: "POST",
        headers: apiHeaders(true),
        body: JSON.stringify(payload),
        signal: ctrl ? ctrl.signal : undefined,
      })
        .then(function (res) {
          if (!res || !res.ok) throw new Error("HTTP " + (res ? res.status : "error"));
          return res.json();
        })
        .then(function (json) {
          if (destroyed || state.workbench.thoughtTranslate === "off") return;
          const out =
            (json && (json.translatedText || json.translation || json.text)) || "";
          if (!out) throw new Error((json && json.error) || "译文为空");
          rec.status = "done";
          rec.translatedText = String(out);
          rec.errorMessage = "";
          renderThoughtBox(el, rec);
        })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          if (destroyed || state.workbench.thoughtTranslate === "off") return;
          rec.status = "error";
          rec.errorMessage = (err && err.message) || "翻译失败，已保留原文";
          renderThoughtBox(el, rec);
        })
        .finally(function () {
          rec.abortCtrl = null;
          translateInflightCount = Math.max(0, translateInflightCount - 1);
          pumpTranslateQueue();
        });
    }
  }

  function enqueueThoughtTranslation(el, force) {
    if (destroyed || state.workbench.thoughtTranslate === "off") return;
    const text = String(el.textContent || "").trim();
    if (text.length < 24 || !/[A-Za-z]{3,}/.test(text)) return;

    let rec = thoughtStates.get(el);
    if (!rec) {
      rec = {
        sourceText: text,
        translatedText: "",
        errorMessage: "",
        box: null,
        settleTimer: null,
        abortCtrl: null,
        status: "idle",
        showOriginal: false,
      };
      thoughtStates.set(el, rec);
    } else if (!force && rec.sourceText === text && (rec.status === "done" || rec.status === "loading")) {
      applyThoughtView(el, rec);
      return;
    }

    rec.sourceText = text;
    if (rec.settleTimer) {
      clearTimeout(rec.settleTimer);
      rec.settleTimer = null;
    }

    const submit = function () {
      rec.settleTimer = null;
      if (destroyed || state.workbench.thoughtTranslate === "off") return;
      if (!translateQueue.includes(el)) {
        translateQueue.push(el);
      }
      pumpTranslateQueue();
    };

    if (force) {
      submit();
    } else {
      rec.settleTimer = setTimeout(submit, 450);
    }
  }

  function scanThoughtTranslate() {
    // Zero-overhead fast path when off
    if (state.workbench.thoughtTranslate === "off" || destroyed) return;
    if (typeof document.querySelectorAll !== "function") return;
    const blocks = document.querySelectorAll(
      '[data-testid*="thought-content"], [data-testid*="thinking-content"], [data-testid*="reasoning-content"], [data-thought-body="true"], .agy-thought-body'
    );
    for (let i = 0; i < blocks.length; i++) {
      const el = blocks[i];
      if (!el || el.isConnected === false) continue;
      if (typeof el.closest === "function" && el.closest("[data-agy-maomao-ui]")) continue;
      enqueueThoughtTranslation(el, false);
    }
  }

  function cleanupThoughtTranslate() {
    translateQueue.length = 0;
    for (const [el, rec] of thoughtStates.entries()) {
      if (rec.settleTimer) clearTimeout(rec.settleTimer);
      if (rec.abortCtrl) { try { rec.abortCtrl.abort(); } catch {} }
      if (rec.box) { try { rec.box.remove(); } catch {} }
      try { el.removeAttribute("data-agy-maomao-thought-hidden"); } catch {}
    }
    thoughtStates.clear();
  }

  // =========================================================================
  // Unified throttled MutationObserver & hot-toggle reconciliation
  // (fast-skips editable/composer mutations + 220ms typing grace window)
  // =========================================================================
  const EDIT_MUTATION_SKIP_SEL =
    '[data-lexical-editor="true"],[data-testid="agent-input-box"],.surface-composer,[contenteditable="true"],[contenteditable=""],textarea,input,.monaco-editor,.cm-editor,.xterm,[data-agy-maomao-ui],#agy-maomao-pet-root';
  const WB_TYPING_GRACE_MS = 220;
  let observer = null;
  let scanTimer = null;
  let wbTypingUntil = 0;
  let wbTypingKeyHandler = null;
  let wbTypingInputHandler = null;
  let wbScanCount = 0;
  let wbSkippedMutations = 0;

  function isWbEditableElement(el) {
    if (!el || el.nodeType !== 1) return false;
    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") return true;
    if (el.isContentEditable === true) return true;
    if (typeof el.getAttribute === "function") {
      const ce = el.getAttribute("contenteditable");
      if (ce === "" || ce === "true" || ce === "plaintext-only") return true;
      if (el.getAttribute("data-lexical-editor") === "true") return true;
    }
    return false;
  }

  function isSkippedWorkbenchMutationNode(node) {
    if (!node) return true;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el.nodeType !== 1) return true;
    // O(1) fast path for active focused editor
    const activeEl = document.activeElement;
    if (activeEl && isWbEditableElement(activeEl)) {
      if (el === activeEl || (typeof activeEl.contains === "function" && activeEl.contains(el))) {
        return true;
      }
    }
    if (isWbEditableElement(el)) return true;
    try {
      if (typeof el.closest === "function" && el.closest(EDIT_MUTATION_SKIP_SEL)) {
        return true;
      }
    } catch {}
    return false;
  }

  function markWbTyping(ev) {
    if (destroyed || !ev) return;
    const t = ev.target;
    const el = t && (t.nodeType === 1 ? t : t.parentElement);
    if (!el) return;
    if (
      isWbEditableElement(el) ||
      (typeof el.closest === "function" &&
        Boolean(el.closest('[data-lexical-editor="true"],[contenteditable="true"],[contenteditable=""],textarea,input,.monaco-editor,.cm-editor')))
    ) {
      wbTypingUntil = Date.now() + WB_TYPING_GRACE_MS;
    }
  }

  function runScans(ignoreTypingGrace) {
    scanTimer = null;
    if (destroyed) return;
    if (!ignoreTypingGrace) {
      const now = Date.now();
      if (now < wbTypingUntil) {
        scanTimer = setTimeout(function () { runScans(false); }, Math.max(24, wbTypingUntil - now + 16));
        return;
      }
    }
    wbScanCount += 1;
    if (state.workbench.codeFold) scanCodeFold();
    if (state.workbench.inlineDiff) scanInlineDiff();
    if (state.workbench.fullTextSearch) scanFullTextSearch();
    if (state.workbench.thoughtTranslate !== "off") scanThoughtTranslate();
  }

  function scheduleScan() {
    if (scanTimer !== null || destroyed) return;
    const now = Date.now();
    const delay = now < wbTypingUntil ? Math.max(90, wbTypingUntil - now + 16) : 90;
    scanTimer = setTimeout(function () { runScans(false); }, delay);
  }

  function anyDomFeatureEnabled() {
    const w = state.workbench;
    return Boolean(
      w.codeFold ||
      w.inlineDiff ||
      w.fullTextSearch ||
      w.thoughtTranslate !== "off"
    );
  }

  function detachWbTypingListeners() {
    if (typeof document.removeEventListener === "function") {
      if (wbTypingKeyHandler) {
        document.removeEventListener("keydown", wbTypingKeyHandler, true);
        wbTypingKeyHandler = null;
      }
      if (wbTypingInputHandler) {
        document.removeEventListener("input", wbTypingInputHandler, true);
        wbTypingInputHandler = null;
      }
    }
  }

  function reconcileObserver() {
    if (destroyed) return;
    const needObs = anyDomFeatureEnabled();
    if (needObs && !observer && typeof MutationObserver === "function") {
      const target = document.body || document.documentElement;
      if (target) {
        if (!wbTypingKeyHandler && typeof document.addEventListener === "function") {
          wbTypingKeyHandler = markWbTyping;
          wbTypingInputHandler = markWbTyping;
          document.addEventListener("keydown", wbTypingKeyHandler, { capture: true, passive: true });
          document.addEventListener("input", wbTypingInputHandler, { capture: true, passive: true });
        }
        observer = new MutationObserver(function (records) {
          if (destroyed) return;
          for (let i = 0; i < records.length; i++) {
            const t = records[i].target;
            if (isSkippedWorkbenchMutationNode(t)) {
              wbSkippedMutations += 1;
              continue;
            }
            scheduleScan();
            return;
          }
        });
        try {
          observer.observe(target, { childList: true, subtree: true });
        } catch {
          observer = null;
        }
      }
    } else if (!needObs && observer) {
      try { observer.disconnect(); } catch {}
      observer = null;
      detachWbTypingListeners();
      if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
    }
  }

  function reconcileAll() {
    if (destroyed) return;
    purgeLegacyOutlineNodes();
    syncSurfaceTheme();
    startSurfaceObserver();
    const w = state.workbench;

    if (!w.codeFold) cleanupCodeFold();
    else scanCodeFold();

    if (!w.contextMenu) cleanupContextMenu();
    else ensureContextMenu();

    if (!w.inlineDiff) cleanupInlineDiff();
    else scanInlineDiff();

    if (!w.fullTextSearch) unmountSearchEnhancer();
    else scanFullTextSearch();

    syncCompactLayout();

    if (w.thoughtTranslate === "off") {
      cleanupThoughtTranslate();
    } else {
      for (const [el, rec] of thoughtStates.entries()) {
        applyThoughtView(el, rec);
        if (rec.box) renderThoughtBox(el, rec);
      }
      scanThoughtTranslate();
    }

    reconcileObserver();
  }

  const handle = {
    rev: REV,
    owner: state.owner,
    lastSeen: Date.now(),
    touch: function () {
      handle.lastSeen = Date.now();
    },
    status: function () {
      return {
        applied: !destroyed,
        rev: REV,
        owner: handle.owner,
        surface: currentSurface,
        workbench: {
          codeFold: state.workbench.codeFold,
          contextMenu: state.workbench.contextMenu,
          inlineDiff: state.workbench.inlineDiff,
          fullTextSearch: state.workbench.fullTextSearch,
          compactLayout: state.workbench.compactLayout,
          thoughtTranslate: state.workbench.thoughtTranslate,
          thoughtView: state.workbench.thoughtView,
        },
        counts: {
          codeFoldBlocks: codeFoldTracked.size,
          diffChips: diffTracked.size,
          thoughtBlocks: thoughtStates.size,
          scans: wbScanCount,
          skippedMutations: wbSkippedMutations,
        },
      };
    },
    update: function (nextCfg) {
      if (destroyed) return handle.status();
      const prevMode = state.workbench.thoughtTranslate;
      const next = normalizeConfig(nextCfg);
      if (next.owner) handle.owner = next.owner;
      state = next;
      handle.lastSeen = Date.now();
      if (prevMode !== state.workbench.thoughtTranslate && prevMode !== "off" && state.workbench.thoughtTranslate !== "off") {
        // Switching between machine <-> openai: reset cached translations to re-translate cleanly
        cleanupThoughtTranslate();
      }
      reconcileAll();
      return handle.status();
    },
    scanNow: function () {
      if (!destroyed) runScans(true);
      return handle.status();
    },
    destroy: function () {
      if (destroyed) return { removed: true };
      destroyed = true;
      if (scanTimer !== null) { clearTimeout(scanTimer); scanTimer = null; }
      if (toastTimer !== null) { clearTimeout(toastTimer); toastTimer = null; }
      if (toastEl) { try { toastEl.remove(); } catch {} toastEl = null; }
      if (observer) { try { observer.disconnect(); } catch {} observer = null; }
      stopSurfaceObserver();
      detachWbTypingListeners();
      cleanupCodeFold();
      purgeLegacyOutlineNodes();
      cleanupContextMenu();
      cleanupInlineDiff();
      unmountSearchEnhancer();
      cleanupThoughtTranslate();
      try { document.documentElement.removeAttribute("data-agy-maomao-compact"); } catch {}
      try { document.documentElement.removeAttribute("data-agy-maomao-wb-surface"); } catch {}
      try { styleEl.remove(); } catch {}
      if (window[KEY] === handle) {
        delete window[KEY];
      }
      return { removed: true };
    },
  };

  window[KEY] = handle;
  reconcileAll();
  return handle.status();
}

module.exports = {
  installWorkbenchEnhancer,
  WORKBENCH_KEY,
  WORKBENCH_REV,
};
