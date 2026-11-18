// Serialized into the host by its existing local CDP endpoint. No app files are modified.
async function installTheme(config) {
  const key = "__agyDreamSkinV2";
  const THEME_REV = 7;
  if (window[key]) {
    if (window[key].owner && window[key].owner !== config.owner) {
      const dead = typeof window[key].lastSeen === "number" && Date.now() - window[key].lastSeen > 15000;
      if (!dead) throw new Error("皮肤由另一个运行实例管理");
    }
    if (window[key].owner === config.owner && window[key].rev === THEME_REV && window[key].status().applied) {
      window[key].touch?.();
      window[key].update(config);
      return window[key].status();
    }
    window[key].destroy();
  }
  const root = document.querySelector("#root") || document.querySelector("#app");
  if (!root) return { applied: false, reason: "unsupported-root" };
  const mediaSrc = config.mediaUrl || config.image || "";
  const mediaKind = config.mediaKind === "video" ? "video" : "image";
  if (!mediaSrc) return { applied: false, reason: "missing-media" };
  if (!root.isConnected) return { applied: false, reason: "detached-root" };

  function cleanHex(v) {
    if (typeof v !== "string") return "";
    const m = /^#([0-9a-f]{6})$/i.exec(v.trim());
    return m ? "#" + m[1].toLowerCase() : "";
  }

  function contrastOnAccent(hex) {
    const clean = cleanHex(hex);
    if (!clean) return "#ffffff";
    const r = parseInt(clean.slice(1, 3), 16) / 255;
    const g = parseInt(clean.slice(3, 5), 16) / 255;
    const b = parseInt(clean.slice(5, 7), 16) / 255;
    const ch = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    const lum = 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    return (1.05) / (lum + 0.05) >= (lum + 0.05) / 0.05 ? "#ffffff" : "#0a0a0c";
  }

  function clampInt(v, def, min, max) {
    const n = Number(v);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function fontRules(colors) {
    if (!colors || typeof colors !== "object") return [];
    const out = [];
    const main = cleanHex(colors.main);
    const secondary = cleanHex(colors.secondary);
    const muted = cleanHex(colors.muted);
    const faint = cleanHex(colors.faint);
    if (main) {
      out.push(`--foreground: ${main} !important;`);
      out.push(`--vscode-foreground: ${main} !important;`);
      out.push(`--syntax-default-fg: ${main} !important;`);
    }
    if (secondary) {
      out.push(`--secondary-foreground: ${secondary} !important;`);
    }
    if (muted) {
      out.push(`--muted-foreground: ${muted} !important;`);
      out.push(`--vscode-descriptionForeground: ${muted} !important;`);
    }
    if (faint) {
      out.push(`--placeholder: ${faint} !important;`);
      out.push(`--vscode-disabledForeground: ${faint} !important;`);
    }
    return out;
  }

  function buildTokenCss(cfg, dark) {
    const g = cfg.glass || {};
    const r = g.regions || {};
    const sb = r.sidebar || {};
    const ct = r.content || {};
    const ov = r.overlay || {};
    const cl = r.control || {};
    const hd = r.header || {};
    const br = r.bar || {};

    const starNeko = g.themeStyle !== "official";
    const radius = clampInt(g.radius, 16, 8, 24);
    const tint = cleanHex(g.tint);
    const sbFill = clampInt(sb.fill, 78, 0, 100);
    const sbBlur = clampInt(sb.blur, 18, 0, 40);
    const ctFill = clampInt(ct.fill, 60, 0, 100);
    const ctBlur = clampInt(ct.blur, 22, 0, 40);
    const ovFill = clampInt(ov.fill, 68, 0, 100);
    const ovBlur = clampInt(ov.blur, 24, 0, 40);
    const clFill = clampInt(cl.fill, 72, 0, 100);
    const clBlur = clampInt(cl.blur, 14, 0, 40);
    const hdFill = clampInt(hd.fill, 84, 0, 100);
    const hdBlur = clampInt(hd.blur, 14, 0, 40);
    const brFill = clampInt(br.fill, 80, 0, 100);
    const brBlur = clampInt(br.blur, 14, 0, 40);

    const glassTintVar = tint ? tint : dark ? "#ffffff" : "#f8fafc";
    const baseHex = starNeko ? (dark ? "#151221" : "#f3edfc") : dark ? "#121319" : "#ffffff";
    const popBaseHex = starNeko ? (dark ? "#120f1c" : "#faf7ff") : dark ? "#0f1016" : "#ffffff";
    const surfaceMix = dark
      ? `color-mix(in srgb, ${glassTintVar} ${starNeko ? "10%" : "11%"}, ${baseHex})`
      : `color-mix(in srgb, ${glassTintVar} 24%, ${baseHex})`;
    const popMix = dark
      ? `color-mix(in srgb, ${glassTintVar} ${starNeko ? "11%" : "13%"}, ${popBaseHex})`
      : `color-mix(in srgb, ${glassTintVar} 26%, ${popBaseHex})`;
    const makeFilter = (px) => (px > 0 ? `blur(${px}px) saturate(165%)` : "none");

    const f = cfg.font || {};
    const accent = cleanHex(f.accent);
    const baseFontLines = fontRules(f.colors);
    if (accent) {
      baseFontLines.push(`--primary: ${accent} !important;`);
      baseFontLines.push(`--primary-foreground: ${contrastOnAccent(accent)} !important;`);
      baseFontLines.push(`--accent: ${accent} !important;`);
      baseFontLines.push(`--link: ${accent} !important;`);
      baseFontLines.push(`--vscode-focusBorder: ${accent} !important;`);
      baseFontLines.push(`--vscode-textLink-foreground: ${accent} !important;`);
      baseFontLines.push(`--vscode-button-background: ${accent} !important;`);
      baseFontLines.push(`--home-glow: color-mix(in srgb, ${accent} 14%, transparent) !important;`);
    }

    const rimTop = starNeko
      ? dark
        ? `color-mix(in srgb, ${glassTintVar} 24%, rgba(210, 188, 255, .24))`
        : "rgba(255, 255, 255, .74)"
      : dark
        ? `color-mix(in srgb, ${glassTintVar} 28%, rgba(255, 255, 255, .20))`
        : "rgba(255, 255, 255, .68)";
    const rimLine = starNeko
      ? dark
        ? `color-mix(in srgb, ${glassTintVar} 14%, rgba(174, 142, 218, .28))`
        : "rgba(169, 139, 214, .26)"
      : dark
        ? `color-mix(in srgb, ${glassTintVar} 18%, rgba(255, 255, 255, .16))`
        : "rgba(15, 23, 42, .12)";
    const rimShade = dark ? "rgba(0, 0, 0, .28)" : "rgba(15, 23, 42, .07)";
    const selTop = starNeko
      ? dark
        ? `color-mix(in srgb, ${glassTintVar} 14%, rgba(164, 136, 235, .28))`
        : `color-mix(in srgb, ${glassTintVar} 18%, rgba(235, 224, 252, .86))`
      : dark
        ? `color-mix(in srgb, ${glassTintVar} 16%, rgba(255, 255, 255, .17))`
        : `color-mix(in srgb, ${glassTintVar} 18%, rgba(255, 255, 255, .86))`;
    const selBot = starNeko
      ? dark
        ? `color-mix(in srgb, ${glassTintVar} 10%, rgba(118, 92, 180, .14))`
        : `color-mix(in srgb, ${glassTintVar} 12%, rgba(226, 212, 248, .66))`
      : dark
        ? `color-mix(in srgb, ${glassTintVar} 10%, rgba(255, 255, 255, .08))`
        : `color-mix(in srgb, ${glassTintVar} 12%, rgba(255, 255, 255, .62))`;
    const selRim = starNeko
      ? dark
        ? "rgba(218, 196, 255, .34)"
        : "rgba(255, 255, 255, .88)"
      : dark
        ? `color-mix(in srgb, ${glassTintVar} 26%, rgba(255, 255, 255, .24))`
        : "rgba(255, 255, 255, .84)";
    const overlayWash = starNeko
      ? dark
        ? "rgba(25, 20, 38, 0.42)"
        : "rgba(249, 244, 255, 0.56)"
      : dark
        ? "rgba(16, 18, 26, 0.34)"
        : "rgba(255, 255, 255, 0.48)";
    const controlWash = dark ? "rgba(255, 255, 255, 0.055)" : "rgba(255, 255, 255, 0.44)";
    const shadowPop = dark
      ? "0 20px 52px rgba(0, 0, 0, .44), 0 4px 14px rgba(0, 0, 0, .24)"
      : "0 18px 44px rgba(15, 23, 42, .14), 0 4px 12px rgba(15, 23, 42, .07)";

    let css = `html.agy-dream-active-v2:root {
  --lg-tint: ${glassTintVar};
  --lg-surface: ${surfaceMix};
  --lg-pop-surface: ${popMix};
  --lg-rim-inset-top: ${rimTop};
  --lg-rim-line: ${rimLine};
  --lg-rim-shade: ${rimShade};
  --lg-sel-top: ${selTop};
  --lg-sel-bot: ${selBot};
  --lg-sel-rim: ${selRim};
  --lg-overlay-wash: ${overlayWash};
  --lg-control-bg: ${controlWash};
  --lg-shadow-pop: ${shadowPop};
  --agy-glass-radius: ${radius}px;
  --agy-radius-outer: calc(var(--agy-glass-radius) + 4px);
  --agy-radius-card: var(--agy-glass-radius);
  --agy-radius-inner: max(8px, calc(var(--agy-glass-radius) - 5px));
  --agy-radius-badge: max(6px, calc(var(--agy-glass-radius) - 10px));
  --agy-glass-sidebar-fill: ${sbFill}%;
  --agy-glass-sidebar-blur: ${sbBlur}px;
  --agy-glass-content-fill: ${ctFill}%;
  --agy-glass-content-blur: ${ctBlur}px;
  --agy-glass-overlay-fill: ${ovFill}%;
  --agy-glass-overlay-blur: ${ovBlur}px;
  --agy-glass-control-fill: ${clFill}%;
  --agy-glass-control-blur: ${clBlur}px;
  --agy-glass-header-fill: ${hdFill}%;
  --agy-glass-header-blur: ${hdBlur}px;
  --agy-glass-bar-fill: ${brFill}%;
  --agy-glass-bar-blur: ${brBlur}px;
  --lg-filter-sidebar: ${makeFilter(sbBlur)};
  --lg-filter-content: ${makeFilter(ctBlur)};
  --lg-filter-overlay: ${ovBlur > 0 ? makeFilter(Math.max(ovBlur, 12)) : "none"};
  --lg-filter-control: ${makeFilter(clBlur)};
  --lg-filter-header: ${makeFilter(hdBlur)};
  --lg-filter-bar: ${makeFilter(brBlur)};
  /* 接管 Antigravity 官方玻璃与区域令牌，避免与官方系统两套打架 */
  --glass: color-mix(in srgb, var(--lg-pop-surface) var(--agy-glass-content-fill), transparent) !important;
  --glass-border: var(--lg-rim-line) !important;
  --glass-highlight: var(--lg-rim-inset-top) !important;
  --glass-shadow: var(--lg-shadow-pop) !important;
  --sidebar: color-mix(in srgb, var(--lg-surface) var(--agy-glass-sidebar-fill), transparent) !important;
  --sidebar-secondary: var(--lg-sel-top) !important;
  --sidebar-accent: var(--lg-sel-top) !important;
  --sidebar-border: var(--lg-rim-line) !important;
  --secondary: var(--lg-control-bg) !important;
  --border: var(--lg-rim-line) !important;
  --card: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill), transparent) !important;
  --shell: color-mix(in srgb, var(--lg-surface) var(--agy-glass-header-fill), transparent) !important;
  ${baseFontLines.join("\n  ")}
}`;

    if (f.darkSeparate) {
      const darkLines = fontRules(f.colorsDark);
      if (darkLines.length) {
        css += `\nhtml.agy-dream-active-v2:has(body.dark):root,
html.agy-dream-active-v2:has(body.dark-theme):root {
  ${darkLines.join("\n  ")}
}`;
      }
    }
    return css;
  }

  const saved = [];
  const seen = new WeakSet();
  const checked = new WeakSet();
  const protect =
    ".monaco-editor,.cm-editor,.xterm,.integrated-terminal,textarea,pre,code,[contenteditable=true],[role=article],.prose,.markdown-body";

  const layer = document.createElement("div");
  layer.id = "agy-dream-wallpaper-v2";
  layer.setAttribute("aria-hidden", "true");
  Object.assign(layer.style, {
    position: "fixed",
    inset: "0",
    zIndex: "0",
    pointerEvents: "none",
    overflow: "hidden",
    backgroundColor: "#f8f6ff",
    transform: "translateZ(0)",
    contain: "strict",
  });

  const scrimEl = document.createElement("div");
  scrimEl.id = "agy-dream-scrim-v2";
  Object.assign(scrimEl.style, {
    position: "absolute",
    inset: "0",
    pointerEvents: "none",
    zIndex: "1",
    backgroundColor: "rgba(20,15,35,0.12)",
  });
  layer.append(scrimEl);

  const tokenStyle = document.createElement("style");
  tokenStyle.id = "agy-dream-tokens-v2";

  const style = document.createElement("style");
  style.id = "agy-dream-style-v2";
  style.textContent = `
 html.agy-dream-active-v2 body { background: var(--agy-dream-base-bg) !important; }
 html.agy-dream-active-v2 [data-agy-dream-root] { position: relative; z-index: 1; }
 html.agy-dream-active-v2 [data-agy-dream-clear] { background-color: transparent !important; background-image: none !important; }
 html.agy-dream-active-v2 [data-agy-dream-protect] { background-color: var(--agy-dream-old-bg) !important; backdrop-filter: none !important; }
 html.agy-dream-active-v2 [data-agy-dream-fade] { background: none !important; box-shadow: none !important; }
 html.agy-dream-active-v2 [data-agy-dream-welcome] { padding-top: 0 !important; justify-content: flex-end !important; padding-bottom: 28px !important; }
 html.agy-dream-active-v2 .agy-inset-shell { background-color: transparent !important; }
 html.agy-dream-active-v2 .agy-sheet {
   border-radius: var(--agy-radius-outer, 20px) !important;
   overflow: hidden !important;
   box-shadow: inset 0 0 0 1px var(--lg-rim-line) !important;
 }

 /* 侧边栏区域：仅最外层挂载一层烟熏液态玻璃，彻底消除嵌套 .bg-sidebar 二次叠层与滚动模糊掉帧 */
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]):not([data-testid="title-menu-bar"]):not(:is(.bg-sidebar, aside, [role=navigation]) *) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-sidebar-fill, 78%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   border-color: var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]) :is(.bg-sidebar, [data-sidebar-section-drop-id], [data-testid="pinned-section-header"], .group\/section-header) {
   background-color: transparent !important;
   background-image: none !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 [data-agy-theme-style="star-neko"] :is(.bg-sidebar, aside, [role=navigation]):not([data-testid="title-menu-bar"]):not(:is(.bg-sidebar, aside, [role=navigation]) *) {
   background-image:
     radial-gradient(ellipse at 0 0, #a88ee522, transparent 65%),
     repeating-linear-gradient(135deg, transparent 0 38px, #b994ee09 38px 39px) !important;
 }
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]) :is([data-testid="conversation-row-sidebar"], [data-testid="project-header"], [data-testid="new-conversation-button"], [data-testid="ssh-machine-switcher"], [aria-selected=true], [aria-current=true], [data-state=active], [data-selected="true"], [class~="bg-sidebar-muted"], [class~="bg-sidebar-secondary"], .agy-sidebar-row, [data-testid="conversation-row-history"]) {
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]) :is([aria-selected=true], [aria-current=true], [data-state=active], [data-selected="true"], [class~="bg-sidebar-muted"], [class~="bg-sidebar-secondary"]) {
   background: linear-gradient(180deg, var(--lg-sel-top), var(--lg-sel-bot)) !important;
   box-shadow: inset 0 1px 0 var(--lg-sel-rim), 0 2px 8px rgba(0, 0, 0, .14) !important;
 }
 html.agy-dream-active-v2 [data-agy-theme-style="star-neko"] :is(.bg-sidebar, aside, [role=navigation]) :is([aria-selected=true], [aria-current=true], [data-state=active], [data-selected="true"], [class~="bg-sidebar-muted"], [class~="bg-sidebar-secondary"]) {
   background-color: rgba(68, 55, 84, 0.42) !important;
   background-image:
     radial-gradient(circle at 92% 22%, #f0c5ff55 0 2px, transparent 3px),
     repeating-linear-gradient(125deg, transparent 0 18px, #b9a2f519 18px 19px),
     linear-gradient(110deg, #9e8ce526, #e5b5f416) !important;
   box-shadow: inset 3px 0 #bda2f2, inset 0 0 0 1px #bda2f238 !important;
 }

 /* 顶栏与右侧 AUX 插件面板：深邃玻璃融合原生窗口控制按钮，统一外层四隅同心圆角 */
 html.agy-dream-active-v2 :is([data-testid="title-menu-bar"], header, [role=tablist], .titlebar) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-header-fill, 84%), rgba(8, 9, 14, 0.52)) !important;
   background-image: linear-gradient(90deg, transparent 62%, rgba(0, 0, 0, 0.46) 100%) !important;
   -webkit-backdrop-filter: var(--lg-filter-header, blur(14px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-header, blur(14px) saturate(165%)) !important;
   border-color: var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 [data-testid="aux-pane-split"] [class*="bg-[var(--shell-canvas)]"] {
   background-color: transparent !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 [data-testid="aux-pane-split"] .flex-grow.overflow-hidden:has([data-testid="sidecar-iframe"]) {
   border-radius: var(--agy-radius-card, 16px) !important;
   overflow: hidden !important;
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill, 60%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), inset 0 0 0 1px var(--lg-rim-line), var(--lg-shadow-pop) !important;
 }
 html.agy-dream-active-v2 [data-testid="sidecar-iframe-slot"] {
   background: transparent !important;
   background-image: none !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
   border: 0 !important;
   padding: 4px !important;
   border-radius: var(--agy-radius-card, 16px) !important;
 }
 html.agy-dream-active-v2 [data-agy-theme-style="star-neko"] :is([role=tab][aria-selected=true], [role=tab][data-state=active]) {
   background: linear-gradient(180deg, rgba(164, 136, 235, .28), rgba(118, 92, 180, .14)) !important;
   box-shadow: inset 0 -2px #b99bea !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 iframe,
 html.agy-dream-active-v2 [data-testid="sidecar-iframe"] {
   background: transparent !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }

 /* 页内独立工具条：仅作用于非输入框内页内状态条，避免输入框内底栏与输入区断层 */
 html.agy-dream-active-v2 [role=status]:not(.surface-composer *) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-bar-fill, 80%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-bar, blur(14px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-bar, blur(14px) saturate(165%)) !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }

 /* 页面阅读面与卡片区域：同心圆角 + 清透渐变 + 高光内框 */
 html.agy-dream-active-v2 [data-agy-dream-reading] { background: transparent !important; border: 0; box-shadow: none; }
 html.agy-dream-active-v2 .md-sticky-message-bleed { box-shadow: none !important; background-color: transparent !important; background-image: none !important; }
 html.agy-dream-active-v2 .agy-sheet :has(>.md-sticky-message-bleed) { position: relative !important; top: auto !important; }
 html.agy-dream-active-v2 :is([data-agy-dream-reading], .md-sticky-message-bleed)::after,
 html.agy-dream-active-v2 :is([data-agy-dream-reading], .md-sticky-message-bleed)::before { background: none !important; box-shadow: none !important; }

 html.agy-dream-active-v2 :is(.agy-card, .artifact-card, .agy-user-bubble, .agy-takeover-card, [data-agy-dream-chrome]),
 html.agy-dream-active-v2 [data-agy-output-mode="glass"] [data-agy-dream-segment] {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill, 60%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   border-radius: var(--agy-radius-card, 16px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), inset 0 0 0 1px var(--lg-rim-line);
   padding: 12px 16px;
 }

 /* 输入框控件区：外框保持 overflow: visible 避免裁切 [data-mention-menu]，仅内卡片裁切同心圆角 */
 html.agy-dream-active-v2 .agy-sheet .surface-composer {
   border-radius: var(--agy-radius-outer, 20px) !important;
   overflow: visible !important;
   background-color: transparent !important;
   box-shadow: inset 0 0 0 1px var(--lg-rim-line), var(--lg-shadow-pop) !important;
 }
 html.agy-dream-active-v2 .agy-sheet .surface-composer > .surface-composer-card {
   border-radius: calc(var(--agy-radius-outer, 20px) - 1px) !important;
   overflow: hidden !important;
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-control-fill, 72%), var(--lg-control-bg)) !important;
   -webkit-backdrop-filter: var(--lg-filter-control, blur(14px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-control, blur(14px) saturate(165%)) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top) !important;
 }
 html.agy-dream-active-v2 .agy-sheet .surface-composer :is([data-lexical-editor="true"], [contenteditable="true"], .agy-composer-footer, [data-testid="input-box-bottom-toolbar"]) {
   background-color: transparent !important;
   background-image: none !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 .agy-sheet .surface-composer img {
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 :is(button.surface-opaque, .agy-scroll-bottom) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-control-fill, 72%), var(--lg-control-bg)) !important;
   border-color: var(--lg-rim-line) !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }

 /* 浮层、菜单与对话框 + 斜杠清单 [data-mention-menu] 液态玻璃 + 圆角重设计 */
 html.agy-dream-active-v2 :is(
   [data-mention-menu][role="listbox"],
   .typeahead-popover.mentions-menu,
   .agy-overlay,
   [data-popover-popup],
   .quick-input-widget,
   .agy-fastpick,
   [role=menu],
   [role=dialog]
 ) {
   background-color: color-mix(in srgb, var(--lg-pop-surface) var(--agy-glass-overlay-fill, 68%), var(--lg-overlay-wash)) !important;
   background-image:
     radial-gradient(420px 110px at 14% -12px, color-mix(in srgb, var(--lg-tint, #ffffff) 22%, rgba(255, 255, 255, .12)) 0%, transparent 62%),
     linear-gradient(175deg, rgba(255, 255, 255, .055) 0%, transparent 72%) !important;
   -webkit-backdrop-filter: var(--lg-filter-overlay, blur(24px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-overlay, blur(24px) saturate(165%)) !important;
   border: 1px solid var(--lg-rim-line) !important;
   border-radius: var(--agy-radius-card, 16px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), var(--lg-shadow-pop) !important;
   color: var(--foreground) !important;
 }

 /* 斜杠清单内部列表项层次与同心圆角高对比可读性 */
 html.agy-dream-active-v2 [data-mention-menu] [role="option"] {
   padding: 2px 6px !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [role="option"] > div {
   border-radius: var(--agy-radius-inner, 11px) !important;
   padding: 6px 10px !important;
   transition: background-color 120ms ease, box-shadow 120ms ease !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [role="option"][aria-selected="true"] > div,
 html.agy-dream-active-v2 [data-mention-menu] [role="option"] > div:hover,
 html.agy-dream-active-v2 [data-mention-menu] .bg-secondary {
   background: linear-gradient(180deg, var(--lg-sel-top), var(--lg-sel-bot)) !important;
   box-shadow: inset 3px 0 0 var(--primary), inset 0 1px 0 var(--lg-sel-rim), 0 2px 8px rgba(0, 0, 0, .14) !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [data-testid="menu-option-label"] {
   color: var(--foreground) !important;
   font-weight: 560 !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [data-testid="menu-option-description"] {
   color: var(--secondary-foreground, var(--muted-foreground)) !important;
   opacity: 0.88 !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [data-testid="menu-option-trailing-label"] {
   color: var(--muted-foreground) !important;
   background: var(--lg-control-bg) !important;
   border: 1px solid var(--lg-rim-line) !important;
   border-radius: var(--agy-radius-badge, 6px) !important;
   padding: 1px 6px !important;
   opacity: 0.9 !important;
 }
 html.agy-dream-active-v2 [data-mention-menu] [data-testid="mention-menu-footer"],
 html.agy-dream-active-v2 [data-mention-menu] [data-testid="mention-menu-searching-row"] {
   border-top-color: var(--lg-rim-line) !important;
   color: var(--muted-foreground) !important;
 }
 `;

  function mark(el, attribute) {
    if (!el.hasAttribute(attribute)) {
      saved.push([el, attribute, null]);
      el.setAttribute(attribute, "");
    }
  }
  function variable(el, keyName, value) {
    saved.push([el, "style:" + keyName, el.style.getPropertyValue(keyName), el.style.getPropertyPriority(keyName)]);
    el.style.setProperty(keyName, value);
  }
  function restore([el, attr, value, priority]) {
    if (attr.startsWith("style:")) {
      const k = attr.slice(6);
      value ? el.style.setProperty(k, value, priority) : el.style.removeProperty(k);
    } else value === null ? el.removeAttribute(attr) : el.setAttribute(attr, value);
  }

  mark(root, "data-agy-output-mode");
  mark(root, "data-agy-theme-style");
  mark(root, "data-agy-dream-root");
  mark(root, "data-agy-dream-clear");

  const nativeBackgrounds = new WeakMap([[root, getComputedStyle(root).backgroundColor]]);
  function surfaceBackground(el) {
    for (let node = el; node; node = node.parentElement) {
      const bg = nativeBackgrounds.get(node) || getComputedStyle(node).backgroundColor;
      if (bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)") return bg;
    }
    return "#fff";
  }

  const bodyColor = surfaceBackground(root);
  const rgb = bodyColor.match(/[\d.]+/g)?.slice(0, 3).map(Number) || [255, 255, 255];
  const dark =
    (typeof document.body.classList?.contains === "function" && document.body.classList.contains("dark")) ||
    rgb.reduce((a, b) => a + b, 0) < 360;
  variable(document.body, "--agy-dream-base-bg", dark ? "#070709" : "#f4f5f8");

  let mediaEl = null;
  let currentKind = "";
  let currentSrc = "";
  function releaseMedia() {
    if (!mediaEl) return;
    if (currentKind === "video") {
      try {
        mediaEl.pause();
        mediaEl.removeAttribute("src");
        mediaEl.load();
      } catch {}
    }
    mediaEl.remove();
    mediaEl = null;
    currentKind = "";
    currentSrc = "";
  }

  function ensureMedia(kind, src, cfg) {
    if (mediaEl && currentKind === kind && currentSrc === src) {
      if (kind === "video") {
        mediaEl.muted = cfg.videoMuted !== false;
        mediaEl.defaultMuted = cfg.videoMuted !== false;
        mediaEl.playbackRate = Math.max(0.25, Math.min(2, cfg.videoPlaybackRate ?? 1));
        if (cfg.videoPaused) mediaEl.pause();
        else mediaEl.play().catch(() => {});
      }
      return;
    }
    releaseMedia();
    currentKind = kind;
    currentSrc = src;
    mediaEl = document.createElement(kind === "video" ? "video" : "img");
    mediaEl.id = "agy-dream-media-v2";
    Object.assign(mediaEl.style, {
      position: "absolute",
      maxWidth: "none",
      pointerEvents: "none",
      userSelect: "none",
      zIndex: "0",
      transform: "translateZ(0)",
    });
    if (kind === "video") {
      mediaEl.autoplay = true;
      mediaEl.loop = true;
      mediaEl.playsInline = true;
      mediaEl.muted = cfg.videoMuted !== false;
      mediaEl.defaultMuted = cfg.videoMuted !== false;
      mediaEl.playbackRate = Math.max(0.25, Math.min(2, cfg.videoPlaybackRate ?? 1));
      mediaEl.addEventListener("loadedmetadata", () => geometry());
    } else {
      mediaEl.alt = "";
      mediaEl.addEventListener("load", () => geometry());
    }
    mediaEl.src = src;
    layer.prepend(mediaEl);
    if (kind === "video" && !cfg.videoPaused) mediaEl.play().catch(() => {});
  }

  let active = true;
  let timer;
  let observer;
  let resize;
  let geometryTarget = null;

  function geometry() {
    const pane = [...document.querySelectorAll(".agy-sheet")].sort(
      (a, b) =>
        b.getBoundingClientRect().width * b.getBoundingClientRect().height -
        a.getBoundingClientRect().width * a.getBoundingClientRect().height
    )[0];
    const welcome = pane && [...pane.querySelectorAll("div")].find((e) => e.classList.contains("pt-[30vh]"));
    if (welcome) mark(welcome, "data-agy-dream-welcome");
    const rootRect = root.getBoundingClientRect();
    const width = Math.max(innerWidth || 0, rootRect.width || 0);
    const height = Math.max(innerHeight || 0, rootRect.height || 0);
    Object.assign(layer.style, {
      inset: "auto",
      left: "0px",
      top: "0px",
      width: width + "px",
      height: height + "px",
      borderRadius: "0px",
    });
    if (resize && geometryTarget !== root) {
      if (geometryTarget) resize.unobserve(geometryTarget);
      resize.observe(root);
      geometryTarget = root;
    }
    if (mediaEl) {
      const natW = currentKind === "video" ? mediaEl.videoWidth : mediaEl.naturalWidth;
      const natH = currentKind === "video" ? mediaEl.videoHeight : mediaEl.naturalHeight;
      if (natW > 0 && natH > 0) {
        const factor =
          (config.fit === "contain"
            ? Math.min(width / natW, height / natH)
            : Math.max(width / natW, height / natH)) * (config.zoom ?? 1);
        const w = Math.round(natW * factor);
        const h = Math.round(natH * factor);
        Object.assign(mediaEl.style, {
          width: w + "px",
          height: h + "px",
          left: Math.round((width - w) * (config.positionX ?? 50) / 100) + "px",
          top: Math.round((height - h) * (config.positionY ?? 50) / 100) + "px",
          objectFit: "fill",
        });
      } else {
        Object.assign(mediaEl.style, {
          left: "0px",
          top: "0px",
          width: "100%",
          height: "100%",
          objectFit: config.fit === "contain" ? "contain" : "cover",
          objectPosition: (config.positionX ?? 50) + "% " + (config.positionY ?? 50) + "%",
        });
      }
    }
    return { region: root, scope: pane || root, width, height };
  }

  function scan() {
    if (!active) return;
    for (let i = saved.length - 1; i >= 0; i--) {
      if (!saved[i][0].isConnected) {
        restore(saved[i]);
        seen.delete(saved[i][0]);
        saved.splice(i, 1);
      }
    }
    const area = geometry();
    for (const fade of area.scope.querySelectorAll(".absolute.bottom-0.pointer-events-none")) {
      const rect = fade.getBoundingClientRect();
      if (
        rect.height <= 80 &&
        rect.width > area.width * 0.3 &&
        getComputedStyle(fade).backgroundImage.includes("linear-gradient")
      ) {
        mark(fade, "data-agy-dream-fade");
      }
    }
    for (let parent = area.scope; parent && root.contains(parent); parent = parent.parentElement) {
      if (!nativeBackgrounds.has(parent)) nativeBackgrounds.set(parent, getComputedStyle(parent).backgroundColor);
      mark(parent, "data-agy-dream-clear");
      if (parent === root) break;
    }
    for (const article of area.scope.querySelectorAll(".scroll-mt-4,[role=article],.prose,.markdown-body")) {
      const plate = article.closest(".scroll-mt-4") || article;
      mark(plate, "data-agy-dream-reading");
      seen.add(plate);
      for (const segment of article.querySelectorAll("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table")) {
        if (!segment.parentElement.closest("ul,ol,blockquote,table,pre,.monaco-editor,.cm-editor,.xterm,form")) {
          mark(segment, "data-agy-dream-segment");
        }
      }
    }
    for (const el of root.querySelectorAll(
      "div,main,section,aside,nav,header,form,textarea,pre,code,[contenteditable=true]"
    )) {
      if (!area.scope.contains(el)) continue;
      if (
        seen.has(el) ||
        checked.has(el) ||
        el === layer ||
        el === style ||
        el === tokenStyle ||
        el.closest("#agy-dream-wallpaper-v2,[data-mention-menu],.typeahead-popover,.agy-overlay,[role=listbox],[role=menu],[role=dialog],[data-testid=sidecar-iframe-slot],[data-testid=sidecar-iframe]")
      ) {
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      checked.add(el);
      const css = getComputedStyle(el);
      const bg = css.backgroundColor;
      nativeBackgrounds.set(el, bg);
      if (el.matches(protect) && !el.closest(".surface-composer,.surface-composer-card")) {
        mark(el, "data-agy-dream-protect");
        variable(el, "--agy-dream-old-bg", surfaceBackground(el));
        seen.add(el);
        continue;
      }
      if (el.closest(protect) && !el.closest(".surface-composer,.surface-composer-card")) continue;
      if (
        bg !== "rgba(0, 0, 0, 0)" &&
        bg !== "transparent" &&
        !el.querySelector?.("[data-testid=sidecar-iframe]") &&
        (el.matches("aside,nav,header,[role=navigation]") ||
          (rect.width < innerWidth * 0.35 && rect.height > innerHeight * 0.55) ||
          (rect.top < 90 && rect.width > innerWidth * 0.65 && rect.height < 110))
      ) {
        mark(el, "data-agy-dream-chrome");
        seen.add(el);
        continue;
      }
      if (el.matches("div,main,section") && rect.width > innerWidth * 0.42 && rect.height > innerHeight * 0.36) {
        mark(el, "data-agy-dream-clear");
        seen.add(el);
      }
    }
  }

  function schedule() {
    clearTimeout(timer);
    timer = setTimeout(scan, 240);
  }

  function update(next) {
    config = next;
    const isStarNeko = config.glass?.themeStyle !== "official";
    root.setAttribute("data-agy-output-mode", config.outputMode === "glass" ? "glass" : "transparent");
    root.setAttribute("data-agy-theme-style", isStarNeko ? "star-neko" : "official");
    document.body.style.setProperty("--agy-dream-base-bg", isStarNeko ? (dark ? "#211e2d" : "#f3edfc") : dark ? "#070709" : "#f4f5f8");
    layer.style.opacity = String(config.opacity ?? 0.55);
    layer.style.backgroundColor =
      config.fit === "adaptive"
        ? isStarNeko
          ? dark
            ? "#242033"
            : "#ede4f7"
          : dark
            ? "#0c0d12"
            : "#edeff6"
        : "transparent";

    const veilPct = Number(config.glass?.veil || 0);
    const scrimAlpha = veilPct > 0 ? Math.min(0.95, veilPct / 100) : Math.max(0, Math.min(0.6, config.scrim ?? 0.12));
    scrimEl.style.backgroundColor = (dark ? "rgba(10,11,16," : "rgba(244,245,250,") + scrimAlpha + ")";

    tokenStyle.textContent = buildTokenCss(config, dark);

    const nextSrc = config.mediaUrl || config.image || "";
    const nextKind = config.mediaKind === "video" ? "video" : "image";
    if (nextSrc) ensureMedia(nextKind, nextSrc, config);
    scan();
  }

  function destroy() {
    active = false;
    clearTimeout(timer);
    observer?.disconnect();
    resize?.disconnect();
    releaseMedia();
    layer.remove();
    style.remove();
    tokenStyle.remove();
    document.documentElement.classList.remove("agy-dream-active-v2");
    for (const entry of saved.reverse()) restore(entry);
    saved.length = 0;
    delete window[key];
    return { removed: true };
  }

  document.head.append(style, tokenStyle);
  document.body.prepend(layer);
  document.documentElement.classList.add("agy-dream-active-v2");
  update(config);
  observer = new MutationObserver(schedule);
  observer.observe(root, { childList: true, subtree: true });
  resize = new ResizeObserver(schedule);
  resize.observe(root);

  const status = () => ({
    applied: active && root.isConnected && layer.isConnected && style.isConnected,
    mediaKind: currentKind,
    protected: root.querySelectorAll("[data-agy-dream-protect]").length,
    surfaces: root.querySelectorAll("[data-agy-dream-clear]").length,
    trackedChanges: saved.length,
  });
  const entry = {
    update,
    destroy,
    status,
    touch: () => {
      entry.lastSeen = Date.now();
      return true;
    },
    lastSeen: Date.now(),
    rev: THEME_REV,
    owner: config.owner,
  };
  window[key] = entry;
  return status();
}

module.exports = { installTheme };
