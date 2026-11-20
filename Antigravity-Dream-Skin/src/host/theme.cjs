// Serialized into the host by its existing local CDP endpoint. No app files are modified.
async function installTheme(config) {
  const key = "__agyDreamSkinV2";
  const THEME_REV = 20;
  if (window[key]) {
    if (window[key].owner && window[key].owner !== config.owner) {
      const dead = typeof window[key].lastSeen === "number" && Date.now() - window[key].lastSeen > 15000;
      const upgrading = typeof window[key].rev === "number" && window[key].rev < THEME_REV;
      if (!dead && !upgrading) throw new Error("皮肤由另一个运行实例管理");
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

  function hexToRgb(hex, fallback) {
    const c = cleanHex(hex) || fallback;
    return [
      parseInt(c.slice(1, 3), 16),
      parseInt(c.slice(3, 5), 16),
      parseInt(c.slice(5, 7), 16),
    ];
  }

  function mixRgb(a, b, weightA) {
    const w = Math.max(0, Math.min(1, weightA));
    return [
      Math.round(a[0] * w + b[0] * (1 - w)),
      Math.round(a[1] * w + b[1] * (1 - w)),
      Math.round(a[2] * w + b[2] * (1 - w)),
    ];
  }

  function rgbToHex([r, g, b]) {
    return (
      "#" +
      [r, g, b]
        .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
        .join("")
    );
  }

  function syncTitleBarOverlay(cfg, isDark) {
    const setOverlay = window.electronNative?.setTitleBarOverlay;
    if (typeof setOverlay !== "function") return;
    try {
      const g = cfg?.glass || {};
      const starNeko = g.themeStyle !== "official";
      const sbFill = clampInt(g.regions?.sidebar?.fill, 78, 0, 100) / 100;
      const tintRgb = hexToRgb(g.tint, isDark ? "#ffffff" : "#f8fafc");
      const baseRgb = hexToRgb(
        starNeko ? (isDark ? "#151221" : "#f3edfc") : isDark ? "#121319" : "#ffffff",
        "#151221"
      );
      const backdropRgb = hexToRgb(
        starNeko ? (isDark ? "#262235" : "#ede4f7") : isDark ? "#161822" : "#edeff6",
        "#262235"
      );
      const surfaceRgb = mixRgb(tintRgb, baseRgb, isDark ? (starNeko ? 0.1 : 0.11) : 0.24);
      const finalRgb = mixRgb(surfaceRgb, backdropRgb, Math.max(0.5, sbFill));
      const mainFg = cleanHex(cfg?.font?.colors?.main) || (isDark ? "#f3edfc" : "#1e1b2e");
      setOverlay({
        color: rgbToHex(finalRgb),
        symbolColor: mainFg,
      });
    } catch {}
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
    const smoothVideo = cfg.mediaKind === "video" && cfg.videoSmoothMode !== false;
    // During active video wallpapers, omit extra saturate() pass and cap full-pane blur to keep 60fps smooth
    const makeFilter = (px, maxSmooth = 0) => {
      if (px <= 0) return "none";
      if (smoothVideo) {
        const capped = maxSmooth > 0 ? Math.min(px, maxSmooth) : px;
        return `blur(${capped}px)`;
      }
      return `blur(${px}px) saturate(165%)`;
    };

    const rawChatWidth = localChatWidth !== null ? localChatWidth : cfg.chatWidth;
    const chatWidth = clampInt(rawChatWidth, 0, 0, 100);
    const chatWidthRules =
      chatWidth >= 45
        ? `\n  --agy-chat-width: clamp(480px, ${chatWidth}%, calc(100% - var(--overview-panel-reserve, 0px) - var(--conversation-nav-reserve, 0px) - 36px));\n  --max-conversation-width: var(--agy-chat-width) !important;`
        : "";

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
  --lg-filter-sidebar: ${smoothVideo ? "none" : makeFilter(sbBlur, 10)};
  --lg-filter-content: ${makeFilter(ctBlur, 10)};
  --lg-filter-overlay: ${ovBlur > 0 ? makeFilter(Math.max(ovBlur, 16), 20) : "none"};
  --lg-filter-control: ${makeFilter(clBlur, 12)};
  --lg-filter-header: ${makeFilter(hdBlur, 10)};
  --lg-filter-bar: ${makeFilter(brBlur, 10)};
  /* 接管 Antigravity 官方玻璃与区域令牌，避免与官方系统两套打架 */
  --glass: color-mix(in srgb, var(--lg-pop-surface) var(--agy-glass-content-fill), transparent) !important;
  --glass-border: var(--lg-rim-line) !important;
  --glass-highlight: var(--lg-rim-inset-top) !important;
  --glass-shadow: var(--lg-shadow-pop) !important;
  --sidebar: color-mix(in srgb, var(--lg-surface) var(--agy-glass-sidebar-fill), transparent) !important;
  --shell-canvas: var(--sidebar) !important;
  --sidebar-secondary: var(--lg-sel-top) !important;
  --sidebar-accent: var(--lg-sel-top) !important;
  --sidebar-border: var(--lg-rim-line) !important;
  --secondary: var(--lg-control-bg) !important;
  --muted: var(--lg-control-bg) !important;
  --popover: color-mix(in srgb, var(--lg-pop-surface) max(var(--agy-glass-overlay-fill), 82%), var(--lg-overlay-wash)) !important;
  --border: var(--lg-rim-line) !important;
  --card: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill), transparent) !important;
  --shell: color-mix(in srgb, var(--lg-surface) var(--agy-glass-header-fill), transparent) !important;${chatWidthRules}
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
 html.agy-dream-active-v2 body[data-has-browser-hole="true"],
 html.agy-dream-active-v2 body[data-has-drawer-browser-hole="true"] {
   background: transparent !important;
   background-color: transparent !important;
 }
 html.agy-dream-active-v2 :is([data-browser-hole]:not([data-browser-hole="false"]), [data-wcv-proxy="true"]) {
   background: transparent !important;
   background-color: transparent !important;
   background-image: none !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
 }
 html.agy-dream-active-v2 [data-agy-dream-root] { position: relative; z-index: 1; }
 html.agy-dream-active-v2 [data-agy-dream-clear] { background-color: transparent !important; background-image: none !important; }
 html.agy-dream-active-v2 [data-agy-dream-protect] { background-color: var(--agy-dream-old-bg) !important; backdrop-filter: none !important; }
 /* 代码块（powershell 等 <pre>）：收敛圆角并消除外层 0px 直角与内层圆角卡片叠加 */
 html.agy-dream-active-v2 pre[data-agy-dream-protect]:has(> [class*="rounded-"]) {
   background-color: transparent !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
 }
 html.agy-dream-active-v2 pre[data-agy-dream-protect] > [class*="rounded-"] {
   background-color: var(--agy-dream-old-bg, rgba(14, 15, 22, 0.88)) !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
   overflow: hidden !important;
 }
 html.agy-dream-active-v2 pre[data-agy-dream-protect]:not(:has(> [class*="rounded-"])) {
   border-radius: var(--agy-radius-inner, 11px) !important;
   overflow-x: auto !important;
   overflow-y: hidden !important;
 }
 html.agy-dream-active-v2 :not(pre) > code[data-agy-dream-protect] {
   border-radius: var(--agy-radius-badge, 6px) !important;
 }
 html.agy-dream-active-v2 [data-agy-dream-fade],
 html.agy-dream-active-v2 [data-agy-dream-root] :is(.pointer-events-none, [data-agy-dream-fade]):is([style*="linear-gradient"], [style*="var(--background)"], [style*="var(--sidebar)"], [class*="bg-linear"], [class*="bg-gradient"]) {
   background: transparent !important;
   background-image: none !important;
   box-shadow: none !important;
 }
 html.agy-dream-active-v2 .md-sticky-message-bleed::before,
 html.agy-dream-active-v2 .md-sticky-message-bleed::after {
   background: transparent !important;
   background-image: none !important;
   box-shadow: none !important;
 }
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]) :is(.agy-row-actions, .agy-row-actions::before, .agy-status-overflow, .sticky) {
   background: transparent !important;
   background-image: none !important;
 }
 html.agy-dream-active-v2 :is(.agy-sheet, .bg-sidebar, aside, [role=navigation]) :is(.bg-background, [class*="from-background"], [class*="to-background"], [class*="via-background"], [class*="from-sidebar"], [class*="to-sidebar"], [class*="via-sidebar"]):not(.monaco-editor, .monaco-editor *, .xterm, .xterm *, pre, pre *, code, code *, [role=dialog], [role=dialog] *, [role=menu], [role=menu] *, [data-mention-menu], [data-mention-menu] *, [data-popover-popup], [data-popover-popup] *) {
   background-color: transparent !important;
   background-image: none !important;
 }
 /* 细窄滚动条：统一收敛宿主叠加滚动条与原生 WebKit 滚动条，避免粗重胶囊遮挡正文 */
 html.agy-dream-active-v2 [data-overlay-scrollbar-track],
 html.agy-dream-active-v2 [data-testid="overlay-scrollbar"] {
   width: 6px !important;
   padding: 0 !important;
   margin: 0 !important;
   background: transparent !important;
   background-image: none !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
   border: 0 !important;
 }
 html.agy-dream-active-v2 [data-overlay-scrollbar-track][data-orientation="horizontal"],
 html.agy-dream-active-v2 [data-testid="overlay-scrollbar"][data-orientation="horizontal"] {
   width: auto !important;
   height: 6px !important;
 }
 html.agy-dream-active-v2 [data-testid="overlay-scrollbar-thumb"] {
   width: 3px !important;
   max-width: 3px !important;
   min-width: 0 !important;
   padding: 0 !important;
   margin: 0 !important;
   border: 0 !important;
   border-radius: 9999px !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   box-shadow: none !important;
   background-color: color-mix(in srgb, var(--foreground) 24%, transparent) !important;
 }
 html.agy-dream-active-v2 [data-overlay-scrollbar-track][data-orientation="horizontal"] [data-testid="overlay-scrollbar-thumb"] {
   width: auto !important;
   max-width: none !important;
   height: 3px !important;
   max-height: 3px !important;
 }
 html.agy-dream-active-v2 [data-overlay-scrollbar-track]:is([data-expanded="true"], [data-hovered="true"], :hover) [data-testid="overlay-scrollbar-thumb"] {
   width: 4px !important;
   max-width: 4px !important;
   background-color: color-mix(in srgb, var(--foreground) 46%, transparent) !important;
 }
 html.agy-dream-active-v2 [data-overlay-scrollbar-track][data-orientation="horizontal"]:is([data-expanded="true"], [data-hovered="true"], :hover) [data-testid="overlay-scrollbar-thumb"] {
   width: auto !important;
   max-width: none !important;
   height: 4px !important;
   max-height: 4px !important;
 }
 html.agy-dream-active-v2 ::-webkit-scrollbar {
   width: 4px !important;
   height: 4px !important;
 }
 html.agy-dream-active-v2 ::-webkit-scrollbar-track,
 html.agy-dream-active-v2 ::-webkit-scrollbar-corner {
   background: transparent !important;
 }
 html.agy-dream-active-v2 ::-webkit-scrollbar-thumb {
   background: color-mix(in srgb, var(--foreground) 24%, transparent) !important;
   border-radius: 9999px !important;
   border: 0 !important;
 }
 html.agy-dream-active-v2 ::-webkit-scrollbar-thumb:hover {
   background: color-mix(in srgb, var(--foreground) 44%, transparent) !important;
 }
 /* 会话流与输入框宽度适配 + 概览面板避让 + 全高边缘渐隐拖动导轨 */
 html.agy-dream-active-v2 [data-testid="conversation-view"] {
   padding-right: var(--agy-overview-dodge, 0px) !important;
 }
 html.agy-dream-active-v2 [data-testid="conversation-view"] :is([data-testid="user-message"], [data-testid="agent-response"]) {
   contain: layout style !important;
 }
 html.agy-dream-active-v2[data-agy-smooth-video="1"] [data-testid="overview-panel-host-gutter"],
 html.agy-dream-active-v2.agy-dream-animating-split :is([data-testid="overview-panel-host-gutter"], [data-agy-dream-chrome], .surface-composer-card) {
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
 }
 html.agy-dream-active-v2[data-agy-smooth-video="1"] [data-testid="overview-panel-host-gutter"] {
   background-color: color-mix(in srgb, var(--lg-surface) max(var(--agy-glass-content-fill, 60%), 78%), transparent) !important;
 }
 html.agy-dream-active-v2[data-agy-chat-width="custom"] [data-testid="conversation-view"] [style*="--max-conversation-width"] {
   max-width: var(--agy-chat-width) !important;
 }
 /* 锁定 Markdown 表格、数学公式、代码块、图片与卡片严格约束在会话栏宽度内，彻底禁止 100cqw 横向超限溢出 */
 html.agy-dream-active-v2 .md-table-bleed .md-table-host,
 html.agy-dream-active-v2 .md-table-bleed .md-table-host[data-width-mode],
 html.agy-dream-active-v2 .md-table-bleed .md-table-host[data-width-mode="column"],
 html.agy-dream-active-v2 .md-table-bleed .md-table-host[data-width-mode="full"] {
   width: 100% !important;
   min-width: 0 !important;
   max-width: 100% !important;
   margin-inline: 0 !important;
   margin-inline-start: 0 !important;
   margin-inline-end: 0 !important;
   transform: none !important;
   box-sizing: border-box !important;
 }
 html.agy-dream-active-v2 .md-table-frame,
 html.agy-dream-active-v2 .md-table-scroll {
   max-width: 100% !important;
   overflow-x: auto !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
   box-sizing: border-box !important;
 }
 html.agy-dream-active-v2 .md-table-scroll::-webkit-scrollbar {
   height: 4px !important;
 }
 html.agy-dream-active-v2 [data-testid="conversation-view"] :is(.md-math-display, .katex-display, pre, .markdown-alert, blockquote, [class*="terminal-card"], .agy-card, .artifact-card) {
   max-width: 100% !important;
   min-width: 0 !important;
   box-sizing: border-box !important;
 }
 html.agy-dream-active-v2 [data-testid="conversation-view"] :is(.md-math-display, .katex-display) {
   overflow-x: auto !important;
   overflow-y: hidden !important;
 }
 html.agy-dream-active-v2 [data-testid="conversation-view"] :is([data-markdown-root], .prose, .markdown-body) :is(img, video, canvas, svg.mermaid) {
   max-width: 100% !important;
 }
 html.agy-dream-active-v2 .agy-dream-width-handle {
   position: absolute;
   top: 8px;
   bottom: 8px;
   width: 12px;
   z-index: 35;
   cursor: ew-resize;
   display: flex;
   align-items: center;
   justify-content: center;
   touch-action: none;
   user-select: none;
 }
 html.agy-dream-active-v2 .agy-dream-width-handle[data-side="left"] { left: -6px; }
 html.agy-dream-active-v2 .agy-dream-width-handle[data-side="right"] { right: -6px; }
 html.agy-dream-active-v2 .agy-dream-width-handle[data-mode="rail"] {
   top: 12px;
   bottom: 12px;
   left: auto;
   right: auto;
   width: 14px;
   z-index: 25;
 }
 html.agy-dream-active-v2 .agy-dream-width-handle::after {
   content: "";
   width: 2px;
   height: 44px;
   border-radius: 9999px;
   background: linear-gradient(
     180deg,
     transparent 0%,
     color-mix(in srgb, var(--primary, #a88ee5) 42%, rgba(255, 255, 255, 0.45)) 22%,
     color-mix(in srgb, var(--primary, #a88ee5) 85%, rgba(255, 255, 255, 0.92)) 50%,
     color-mix(in srgb, var(--primary, #a88ee5) 42%, rgba(255, 255, 255, 0.45)) 78%,
     transparent 100%
   );
   box-shadow: 0 0 10px color-mix(in srgb, var(--primary, #a88ee5) 45%, transparent);
   opacity: 0;
   transition: opacity 150ms ease, width 120ms ease;
   pointer-events: none;
 }
 html.agy-dream-active-v2 .agy-dream-width-handle[data-mode="rail"]::after {
   position: absolute;
   left: 50%;
   top: var(--agy-rail-y, 50%);
   width: 2.5px;
   height: 150px;
   transform: translate(-50%, -50%);
 }
 html.agy-dream-active-v2 .agy-dream-width-handle:is(:hover, [data-dragging="1"])::after {
   opacity: 1;
 }
 html.agy-dream-active-v2 .agy-dream-width-handle[data-mode="rail"][data-dragging="1"]::after {
   width: 3px;
 }
 #agy-dream-width-badge {
   position: fixed;
   z-index: 99999;
   padding: 4px 10px;
   border-radius: 9999px;
   font-size: 11px;
   font-weight: 600;
   color: #fff;
   background: rgba(18, 16, 28, 0.88);
   border: 1px solid rgba(255, 255, 255, 0.22);
   pointer-events: none;
   transform: translate(-50%, -120%);
   white-space: nowrap;
 }
 html.agy-dream-active-v2 [data-agy-dream-welcome] { padding-top: 0 !important; justify-content: flex-end !important; padding-bottom: 28px !important; }
 html.agy-dream-active-v2 .agy-inset-shell { background-color: transparent !important; }
 html.agy-dream-active-v2 .agy-inset-shell :is([class*="bg-[var(--shell-canvas)]"], [style*="var(--shell-canvas)"]) {
   background-color: transparent !important;
   background-image: none !important;
 }
 /* 左侧/顶部/右侧/底部统一利用外扩同色凹角阴影无缝填补 .agy-sheet 四角圆角过渡，消除直角黑块与重影线 */
 html.agy-dream-active-v2 [data-testid="sidebar-split"] > [data-split-sash="true"] {
   background-color: var(--sidebar) !important;
 }
 html.agy-dream-active-v2 [data-split-root="true"] > [data-split-fill-edge="left"]:has(> .agy-sheet) {
   overflow: hidden !important;
   padding: 0 8px 8px 0 !important;
   box-sizing: border-box !important;
   contain: layout paint !important;
   transition: width 500ms var(--ease-expo-out), height 500ms var(--ease-expo-out), padding-left 500ms var(--ease-expo-out) !important;
 }
 html.agy-dream-active-v2 [data-split-root="true"]:has(> .flex:first-child[style*="width: 0"]) > [data-split-fill-edge="left"]:has(> .agy-sheet),
 html.agy-dream-active-v2 [data-split-root="true"] > [data-split-fill-edge="left"]:has(> .agy-sheet[data-sidebar-closed]) {
   padding-left: 8px !important;
 }
 html.agy-dream-active-v2 .agy-sheet {
   border-radius: var(--agy-radius-outer, 20px) !important;
   overflow: hidden !important;
   box-shadow:
     0 0 0 22px var(--sidebar),
     inset 0 0 0 1px var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 .agy-sheet[data-sheet-inset] :is([data-main-content-body], [data-side-panel-body]),
 html.agy-dream-active-v2 .agy-sheet[data-sheet-inset="true"] [data-main-content-body="true"] {
   margin: 0 !important;
   border-radius: 0 !important;
   background-color: transparent !important;
   background-image: none !important;
   box-shadow: none !important;
   clip-path: none !important;
 }
 html.agy-dream-active-v2 body[data-has-browser-hole="true"] :is(.browser-hole-opaque, [data-pane-id], [data-tiling-pane], .browser-hole-ancestor > div):not(.monaco-editor, .monaco-editor *, .xterm, .xterm *, pre, pre *, code, code *, [role=dialog], [role=dialog] *, [role=menu], [role=menu] *, [data-mention-menu], [data-mention-menu] *, [data-popover-popup], [data-popover-popup] *, .agy-card, .surface-composer, .surface-composer-card) {
   background-color: transparent !important;
   background-image: none !important;
 }
 html.agy-dream-active-v2 .agy-sheet[data-sheet-inset="true"] [data-main-content-header] {
   padding-right: 14px !important;
 }
 html.agy-dream-active-v2 [data-main-content-body="true"]::before,
 html.agy-dream-active-v2 [data-main-content-body="true"]::after,
 html.agy-dream-active-v2 [data-side-panel-body]::before,
 html.agy-dream-active-v2 [data-side-panel-body]::after,
 html.agy-dream-active-v2 [data-testid="aux-pane-split"] .flex-grow.overflow-hidden:has([data-testid="sidecar-iframe"])::after {
   display: none !important;
   box-shadow: none !important;
 }

 /* 侧边栏区域：仅最外层挂载一层烟熏液态玻璃，彻底消除嵌套 .bg-sidebar 二次叠层与滚动模糊掉帧（排除顶栏下拉浮层菜单） */
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]):not([data-testid="title-menu-bar"]):not(:is(.bg-sidebar, aside, [role=navigation]) *) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-sidebar-fill, 78%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   border-color: var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 :is(.bg-sidebar, aside, [role=navigation]) :is(.bg-sidebar:not([data-browser-occluder="true"]):not(.surface-opaque), [data-sidebar-section-drop-id], [data-testid="pinned-section-header"], .group\/section-header) {
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

 /* 顶栏与侧边栏保持同一视觉基底色，置顶层级避免菜单被主面板遮盖，并移除右侧三键黑框 */
 html.agy-dream-active-v2 :has(> [data-testid="title-menu-bar"]) {
   position: relative !important;
   z-index: 60 !important;
 }
 html.agy-dream-active-v2 [data-testid="title-menu-bar"] {
   position: relative !important;
   z-index: 60 !important;
   background-color: var(--sidebar) !important;
   background-image: none !important;
   -webkit-backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-sidebar, blur(18px) saturate(165%)) !important;
   border-color: var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 [data-agy-theme-style="star-neko"] [data-testid="title-menu-bar"] {
   background-image: radial-gradient(ellipse at 0 0, #a88ee51a, transparent 42%) !important;
 }
 html.agy-dream-active-v2 :is(header, [role=tablist], .titlebar):not([data-testid="title-menu-bar"]) {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-header-fill, 84%), transparent) !important;
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

 /* 页面阅读面与卡片区域：同心圆角 + 清透渐变 + 高光内框（聊天流内气泡免除逐气泡 GPU 实时模糊重采样，彻底解决切会话与滚动卡顿） */
 html.agy-dream-active-v2 [data-testid="conversation-view"],
 html.agy-dream-active-v2 [data-testid="conversation-view"] > div {
   background-color: transparent !important;
 }
 html.agy-dream-active-v2 [data-agy-dream-reading] { background: transparent !important; border: 0; box-shadow: none; }
 html.agy-dream-active-v2 .md-sticky-message-bleed { box-shadow: none !important; background-color: transparent !important; background-image: none !important; }
 html.agy-dream-active-v2 :is([data-agy-dream-reading], .md-sticky-message-bleed)::after,
 html.agy-dream-active-v2 :is([data-agy-dream-reading], .md-sticky-message-bleed)::before { background: none !important; box-shadow: none !important; }

 html.agy-dream-active-v2 [data-agy-dream-chrome] {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill, 60%), transparent) !important;
   -webkit-backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-content, blur(22px) saturate(165%)) !important;
   border-radius: var(--agy-radius-card, 16px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), inset 0 0 0 1px var(--lg-rim-line);
 }
 html.agy-dream-active-v2 :is(.agy-card, .artifact-card, .agy-user-bubble, .agy-takeover-card),
 html.agy-dream-active-v2 [data-agy-output-mode="glass"] [data-agy-dream-segment] {
   background-color: color-mix(in srgb, var(--lg-surface) var(--agy-glass-content-fill, 60%), transparent) !important;
   background-image: linear-gradient(175deg, rgba(255, 255, 255, .045) 0%, transparent 72%) !important;
   -webkit-backdrop-filter: none !important;
   backdrop-filter: none !important;
   border-radius: var(--agy-radius-card, 16px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), inset 0 0 0 1px var(--lg-rim-line);
   padding: 12px 16px;
 }

 /* 展开的运行命令卡片（terminal-card）：统一上下半区半透明深色玻璃样式，绝不改父级折叠容器 max-height/overflow 避免滚动锚点循环抽搐 */
 html.agy-dream-active-v2 div[style*="mask-image"]:has([class*="terminal-card"]) {
   -webkit-mask-image: none !important;
   mask-image: none !important;
 }
 html.agy-dream-active-v2 [class*="terminal-card"] {
   background-color: color-mix(in srgb, var(--lg-pop-surface) 78%, rgba(12, 12, 20, 0.72)) !important;
   background-image: linear-gradient(180deg, rgba(255, 255, 255, 0.04) 0%, transparent 100%) !important;
   border: 1px solid var(--lg-rim-line) !important;
   border-radius: var(--agy-radius-inner, 11px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), 0 6px 18px rgba(0, 0, 0, 0.22) !important;
   overflow: hidden !important;
 }
 html.agy-dream-active-v2 [class*="terminal-card"] > div:first-child {
   background-color: rgba(255, 255, 255, 0.035) !important;
   border-bottom: 1px solid var(--lg-rim-line) !important;
 }
 html.agy-dream-active-v2 [class*="terminal-card"] pre,
 html.agy-dream-active-v2 [class*="terminal-card"] pre[data-agy-dream-protect],
 html.agy-dream-active-v2 [class*="terminal-card"] code,
 html.agy-dream-active-v2 [class*="terminal-card"] code[data-agy-dream-protect] {
   background-color: transparent !important;
   background-image: none !important;
   border: 0 !important;
   border-radius: 0 !important;
   box-shadow: none !important;
 }
 html.agy-dream-active-v2 [class*="terminal-card"] [style*="--background"] {
   background: transparent !important;
   background-image: none !important;
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

 /* 浮层、顶栏下拉菜单、对话框 + 斜杠清单 [data-mention-menu] 液态磨砂玻璃 + 圆角重设计 */
 html.agy-dream-active-v2 :is(
   [data-mention-menu][role="listbox"],
   [data-browser-occluder="true"],
   [data-testid="title-menu-bar"] .surface-opaque,
   .typeahead-popover.mentions-menu,
   .agy-overlay,
   [data-popover-popup],
   [data-radix-popper-content-wrapper],
   .quick-input-widget,
   .agy-fastpick,
   [role=menu],
   [role=dialog]
 ) {
   z-index: 9999 !important;
   background-color: color-mix(in srgb, var(--lg-pop-surface) max(var(--agy-glass-overlay-fill, 68%), 82%), var(--lg-overlay-wash)) !important;
   background-image:
     radial-gradient(420px 110px at 14% -12px, color-mix(in srgb, var(--lg-tint, #ffffff) 22%, rgba(255, 255, 255, .12)) 0%, transparent 62%),
     linear-gradient(175deg, rgba(255, 255, 255, .055) 0%, transparent 72%) !important;
   -webkit-backdrop-filter: var(--lg-filter-overlay, blur(22px) saturate(165%)) !important;
   backdrop-filter: var(--lg-filter-overlay, blur(22px) saturate(165%)) !important;
   border: 1px solid var(--lg-rim-line) !important;
   border-radius: var(--agy-radius-card, 16px) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 -1px 0 var(--lg-rim-shade), var(--lg-shadow-pop) !important;
   color: var(--foreground) !important;
 }
 html.agy-dream-active-v2 [data-browser-occluder="true"] :is(button, [role="menuitem"], .cursor-pointer) {
   border-radius: var(--agy-radius-badge, 6px) !important;
 }
 /* 设置弹窗内部：消除右侧主面板 .bg-background 纯黑遮挡，透出弹窗本体的液态磨砂玻璃与内部半透明卡片层次 */
 html.agy-dream-active-v2 :is([role=dialog], .agy-dialog, .settings-modal-container) .bg-background:not([role=dialog]):not(.agy-dialog) {
   background-color: transparent !important;
   background-image: none !important;
 }
 html.agy-dream-active-v2 :is([role=dialog], .agy-dialog, .settings-modal-container) .agy-card {
   background-color: color-mix(in srgb, var(--lg-surface) 48%, rgba(255, 255, 255, 0.04)) !important;
   box-shadow: inset 0 1px 0 var(--lg-rim-inset-top), inset 0 0 0 1px var(--lg-rim-line) !important;
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
  mark(root, "data-agy-chat-width");
  mark(root, "data-agy-dream-root");
  mark(root, "data-agy-dream-clear");

  let localChatWidth = null;
  let pendingChatWidth = null;
  let configChatWidth = clampInt(config.chatWidth, 0, 0, 100);
  let lastGeoKey = "";

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

  let active = true;
  let mediaEl = null;
  let currentKind = "";
  let currentSrc = "";
  let videoRecoverTimer = 0;
  let videoWatchdog = null;
  let lastVideoTime = -1;
  let stalledBeats = 0;
  let dragCleanup = null;

  function playVideoSafely(v) {
    if (!v || !active || currentKind !== "video" || config.videoPaused || document.hidden) return;
    try {
      const p = v.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    } catch {}
  }

  function onVisibilityChange() {
    if (!mediaEl || currentKind !== "video") return;
    if (document.hidden) {
      try {
        mediaEl.pause();
      } catch {}
    } else {
      playVideoSafely(mediaEl);
    }
  }
  if (typeof document.addEventListener === "function") {
    document.addEventListener("visibilitychange", onVisibilityChange);
  }

  function releaseMedia() {
    clearTimeout(videoRecoverTimer);
    videoRecoverTimer = 0;
    if (videoWatchdog) {
      clearInterval(videoWatchdog);
      videoWatchdog = null;
    }
    lastVideoTime = -1;
    stalledBeats = 0;
    lastGeoKey = "";
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
        if (cfg.videoPaused || document.hidden) mediaEl.pause();
        else playVideoSafely(mediaEl);
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
      willChange: "transform",
      backfaceVisibility: "hidden",
      contain: "layout style paint",
    });
    if (kind === "video") {
      mediaEl.autoplay = !document.hidden && !cfg.videoPaused;
      mediaEl.loop = true;
      mediaEl.playsInline = true;
      mediaEl.preload = "auto";
      mediaEl.disablePictureInPicture = true;
      mediaEl.disableRemotePlayback = true;
      mediaEl.muted = cfg.videoMuted !== false;
      mediaEl.defaultMuted = cfg.videoMuted !== false;
      mediaEl.playbackRate = Math.max(0.25, Math.min(2, cfg.videoPlaybackRate ?? 1));
      mediaEl.addEventListener("loadedmetadata", () => geometry());
      mediaEl.addEventListener("ended", () => {
        if (!active || cfg.videoPaused || document.hidden) return;
        try {
          mediaEl.currentTime = 0;
        } catch {}
        playVideoSafely(mediaEl);
      });
      const scheduleRecover = () => {
        clearTimeout(videoRecoverTimer);
        videoRecoverTimer = setTimeout(() => playVideoSafely(mediaEl), 700);
      };
      let errorRetries = 0;
      let zeroReadyBeats = 0;
      mediaEl.addEventListener("stalled", scheduleRecover);
      mediaEl.addEventListener("waiting", scheduleRecover);
      mediaEl.addEventListener("playing", () => {
        errorRetries = 0;
        zeroReadyBeats = 0;
      });
      mediaEl.addEventListener("error", () => {
        if (!active || currentKind !== "video" || !mediaEl || errorRetries >= 4) return;
        errorRetries++;
        clearTimeout(videoRecoverTimer);
        videoRecoverTimer = setTimeout(() => {
          if (!active || currentKind !== "video" || !mediaEl) return;
          try {
            mediaEl.src = src;
            mediaEl.load();
          } catch {}
          playVideoSafely(mediaEl);
        }, Math.min(4000, errorRetries * 1000));
      });
      videoWatchdog = setInterval(() => {
        if (!active || currentKind !== "video" || !mediaEl || document.hidden || config.videoPaused) return;
        if (mediaEl.readyState === 0) {
          zeroReadyBeats++;
          if (zeroReadyBeats >= 2 && errorRetries < 4) {
            zeroReadyBeats = 0;
            errorRetries++;
            try {
              mediaEl.src = src;
              mediaEl.load();
            } catch {}
            playVideoSafely(mediaEl);
          }
          return;
        }
        zeroReadyBeats = 0;
        if (mediaEl.readyState < 2) return;
        if (mediaEl.paused) {
          playVideoSafely(mediaEl);
          return;
        }
        const cur = mediaEl.currentTime;
        if (cur === lastVideoTime) {
          stalledBeats++;
          if (stalledBeats >= 2) {
            stalledBeats = 0;
            try {
              const dur = Number.isFinite(mediaEl.duration) && mediaEl.duration > 0.2 ? mediaEl.duration : 0;
              mediaEl.currentTime = dur ? (cur + 0.03) % dur : cur + 0.03;
            } catch {}
            playVideoSafely(mediaEl);
          }
        } else {
          lastVideoTime = cur;
          stalledBeats = 0;
        }
      }, 3000);
      videoWatchdog?.unref?.();
    } else {
      mediaEl.alt = "";
      mediaEl.addEventListener("load", () => geometry());
    }
    mediaEl.src = src;
    layer.prepend(mediaEl);
    if (kind === "video" && !cfg.videoPaused && !document.hidden) playVideoSafely(mediaEl);
  }

  let timer;
  let observer;
  let bodyObserver;
  let holeSyncTimer = null;
  let lastHoleClip = "";
  let splitAnimTimer = 0;
  let isAnimatingSplit = false;
  let resize;
  let geometryTarget = null;
  let rafId = 0;
  let lastScanAt = 0;

  function beginSplitAnimation() {
    if (!active) return;
    if (!isAnimatingSplit) {
      isAnimatingSplit = true;
      // Freeze conversation column to fixed pixel width during 500ms sidebar slide so text never reflows 30x/sec
      const convView = root.querySelector?.('[data-testid="conversation-view"]');
      const col = convView?.querySelector?.(".mx-auto.w-full") || convView?.querySelector?.(".surface-composer");
      if (col && root.getAttribute("data-agy-chat-width") === "custom") {
        const w = Math.round(col.getBoundingClientRect().width);
        if (w >= 480) {
          document.documentElement.style.setProperty("--agy-chat-width", w + "px");
          document.documentElement.style.setProperty("--max-conversation-width", w + "px", "important");
        }
      }
      document.documentElement.classList.add("agy-dream-animating-split");
    }
    clearTimeout(splitAnimTimer);
    splitAnimTimer = setTimeout(endSplitAnimation, 540);
  }

  function endSplitAnimation() {
    clearTimeout(splitAnimTimer);
    splitAnimTimer = 0;
    if (!isAnimatingSplit) return;
    isAnimatingSplit = false;
    document.documentElement.classList.remove("agy-dream-animating-split");
    document.documentElement.style.removeProperty("--agy-chat-width");
    document.documentElement.style.removeProperty("--max-conversation-width");
    if (active) {
      syncChatRails();
      schedule();
    }
  }

  function onSplitTransitionStart(ev) {
    if (ev.propertyName !== "width") return;
    const t = ev.target;
    if (!t || !t.closest?.('[data-testid="sidebar-split"], [data-testid="aux-pane-split"]')) return;
    beginSplitAnimation();
  }

  function onSplitTransitionEnd(ev) {
    if (ev.propertyName !== "width" || !isAnimatingSplit) return;
    const t = ev.target;
    if (!t || !t.closest?.('[data-testid="sidebar-split"], [data-testid="aux-pane-split"]')) return;
    endSplitAnimation();
  }

  if (typeof document.addEventListener === "function") {
    document.addEventListener("transitionstart", onSplitTransitionStart, true);
    document.addEventListener("transitionend", onSplitTransitionEnd, true);
  }

  function syncBrowserHoles() {
    if (!active) return;
    const hasHole =
      document.body.getAttribute?.("data-has-browser-hole") === "true" ||
      document.body.getAttribute?.("data-has-drawer-browser-hole") === "true";
    if (!hasHole) {
      if (holeSyncTimer) {
        clearInterval(holeSyncTimer);
        holeSyncTimer = null;
      }
      if (lastHoleClip) {
        lastHoleClip = "";
        layer.style.clipPath = "";
        layer.style.webkitClipPath = "";
      }
      return;
    }
    if (!holeSyncTimer) {
      holeSyncTimer = setInterval(syncBrowserHoles, 120);
      holeSyncTimer?.unref?.();
    }
    const vw = Math.max(innerWidth || 0, root.getBoundingClientRect?.().width || 0);
    const vh = Math.max(innerHeight || 0, root.getBoundingClientRect?.().height || 0);
    const seenRects = new Set();
    const holes = [];
    const candidates = document.querySelectorAll?.(
      '[data-browser-hole]:not([data-browser-hole="false"]), [data-wcv-proxy="true"], [data-testid="wcv-browser-proxy"]'
    ) || [];
    for (const el of candidates) {
      const r = el.getBoundingClientRect?.();
      if (!r || r.width < 40 || r.height < 40) continue;
      const L = Math.max(0, Math.round(r.left));
      const T = Math.max(0, Math.round(r.top));
      const R = Math.min(vw, Math.round(r.right));
      const B = Math.min(vh, Math.round(r.bottom));
      if (R - L < 40 || B - T < 40) continue;
      const rk = `${L},${T},${R},${B}`;
      if (seenRects.has(rk)) continue;
      seenRects.add(rk);
      holes.push([L, T, R, B]);
    }
    if (!holes.length) {
      if (lastHoleClip) {
        lastHoleClip = "";
        layer.style.clipPath = "";
        layer.style.webkitClipPath = "";
      }
      return;
    }
    const segs = ["0px 0px", "100% 0px", "100% 100%", "0px 100%", "0px 0px"];
    for (const [L, T, R, B] of holes) {
      segs.push(`${L}px ${T}px`, `${L}px ${B}px`, `${R}px ${B}px`, `${R}px ${T}px`, `${L}px ${T}px`, "0px 0px");
    }
    const nextClip = `polygon(evenodd, ${segs.join(", ")})`;
    if (nextClip !== lastHoleClip) {
      lastHoleClip = nextClip;
      layer.style.clipPath = nextClip;
      layer.style.webkitClipPath = nextClip;
    }
  }

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
    const natW = mediaEl ? (currentKind === "video" ? mediaEl.videoWidth : mediaEl.naturalWidth) : 0;
    const natH = mediaEl ? (currentKind === "video" ? mediaEl.videoHeight : mediaEl.naturalHeight) : 0;
    const geoKey = [width, height, natW, natH, config.fit, config.zoom, config.positionX, config.positionY].join("|");
    if (geoKey !== lastGeoKey) {
      lastGeoKey = geoKey;
      Object.assign(layer.style, {
        inset: "auto",
        left: "0px",
        top: "0px",
        width: width + "px",
        height: height + "px",
        borderRadius: "0px",
      });
      if (mediaEl) {
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
            left: Math.round(((width - w) * (config.positionX ?? 50)) / 100) + "px",
            top: Math.round(((height - h) * (config.positionY ?? 50)) / 100) + "px",
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
    }
    if (resize && geometryTarget !== root) {
      if (geometryTarget) resize.unobserve(geometryTarget);
      resize.observe(root);
      geometryTarget = root;
    }
    syncChatRails();
    syncBrowserHoles();
    return { region: root, scope: pane || root, width, height };
  }

  function measureOverviewDodge(convView, vr) {
    const ov = root.querySelector?.('[data-testid="overview-panel-host-gutter"]');
    if (!ov) return 0;
    const ovr = ov.getBoundingClientRect();
    if (ovr.width <= 40 || ovr.height <= 40 || ovr.left <= vr.left + 320) return 0;
    return Math.max(0, Math.round(vr.right - ovr.left + 12));
  }

  function syncChatRails() {
    const convView = root.querySelector?.('[data-testid="conversation-view"]');
    if (!convView) return;
    const vr = convView.getBoundingClientRect();
    const dodge = vr.width > 0 ? measureOverviewDodge(convView, vr) : 0;
    const nextDodge = dodge + "px";
    if (convView.style?.getPropertyValue?.("--agy-overview-dodge") !== nextDodge) {
      convView.style?.setProperty?.("--agy-overview-dodge", nextDodge);
    }
    const col = convView.querySelector?.(".mx-auto.w-full") || convView.querySelector?.(".surface-composer");
    if (!col) return;
    const cr = col.getBoundingClientRect();
    if (vr.width <= 0 || cr.width <= 0) return;
    const relLeft = Math.max(10, Math.round(cr.left - vr.left));
    const relRight = Math.min(Math.round(vr.width - dodge - 14), Math.round(cr.right - vr.left));
    const leftRail = convView.querySelector?.('.agy-dream-width-handle[data-side="left"]');
    const rightRail = convView.querySelector?.('.agy-dream-width-handle[data-side="right"]');
    const nextL = Math.max(0, relLeft - 14) + "px";
    const nextR = relRight + "px";
    if (leftRail && leftRail.style.left !== nextL) leftRail.style.left = nextL;
    if (rightRail && rightRail.style.left !== nextR) rightRail.style.left = nextR;
  }

  function applyCommittedChatWidth(pct) {
    localChatWidth = pct;
    pendingChatWidth = pct;
    configChatWidth = pct;
    root.setAttribute("data-agy-chat-width", pct >= 45 ? "custom" : "default");
    document.documentElement.style.removeProperty("--agy-chat-width");
    document.documentElement.style.removeProperty("--max-conversation-width");
    tokenStyle.textContent = buildTokenCss(config, dark);
    syncChatRails();
  }

  function createEdgeHandle(side, mode, getMetrics) {
    const handle = document.createElement("div");
    handle.className = "agy-dream-width-handle";
    handle.setAttribute("data-side", side);
    handle.setAttribute("data-mode", mode);
    handle.title = "左右拖动调整会话框宽度（双击还原官方默认）";
    handle.addEventListener("dblclick", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      applyCommittedChatWidth(0);
    });
    if (mode === "rail") {
      handle.addEventListener("pointermove", (ev) => {
        if (handle.getAttribute("data-dragging") === "1") return;
        const hr = handle.getBoundingClientRect();
        handle.style.setProperty("--agy-rail-y", Math.round(ev.clientY - hr.top) + "px");
      });
    }
    handle.addEventListener("pointerdown", (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      dragCleanup?.();
      const isLeft = side === "left";
      const { paneInnerW, startW } = getMetrics();
      const minW = Math.min(480, paneInnerW);
      const startX = ev.clientX;
      let latestPct = clampInt(Math.round((startW / paneInnerW) * 100), 75, 45, 100);
      let moveRaf = 0;
      let moveClientX = ev.clientX;
      let moveClientY = ev.clientY;
      handle.setAttribute("data-dragging", "1");

      const badge = document.createElement("div");
      badge.id = "agy-dream-width-badge";
      document.body.append(badge);

      const syncDragFrame = () => {
        moveRaf = 0;
        const dx = moveClientX - startX;
        const targetPx = Math.round(Math.max(minW, Math.min(paneInnerW, startW + (isLeft ? -2 : 2) * dx)));
        latestPct = clampInt(Math.round((targetPx / paneInnerW) * 100), 75, 45, 100);
        root.setAttribute("data-agy-chat-width", "custom");
        document.documentElement.style.setProperty("--agy-chat-width", targetPx + "px");
        document.documentElement.style.setProperty("--max-conversation-width", targetPx + "px", "important");
        if (mode === "rail") {
          const hr = handle.getBoundingClientRect();
          handle.style.setProperty("--agy-rail-y", Math.round(moveClientY - hr.top) + "px");
          syncChatRails();
        }
        badge.style.left = moveClientX + "px";
        badge.style.top = Math.max(36, moveClientY) + "px";
        badge.textContent = `宽度 ${latestPct}% (${targetPx}px)`;
      };

      const onMove = (mv) => {
        moveClientX = mv.clientX;
        moveClientY = mv.clientY;
        if (!moveRaf && typeof requestAnimationFrame === "function") {
          moveRaf = requestAnimationFrame(syncDragFrame);
        }
      };

      const finishDrag = () => {
        if (moveRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(moveRaf);
        syncDragFrame();
        handle.removeAttribute("data-dragging");
        badge.remove();
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", finishDrag, true);
        window.removeEventListener("pointercancel", finishDrag, true);
        dragCleanup = null;
        applyCommittedChatWidth(latestPct);
      };

      dragCleanup = () => {
        if (moveRaf && typeof cancelAnimationFrame === "function") cancelAnimationFrame(moveRaf);
        handle.removeAttribute("data-dragging");
        badge.remove();
        window.removeEventListener("pointermove", onMove, true);
        window.removeEventListener("pointerup", finishDrag, true);
        window.removeEventListener("pointercancel", finishDrag, true);
      };

      window.addEventListener("pointermove", onMove, true);
      window.addEventListener("pointerup", finishDrag, true);
      window.addEventListener("pointercancel", finishDrag, true);
      syncDragFrame();
    });
    return handle;
  }

  function attachResizeHandles() {
    const convView = root.querySelector?.('[data-testid="conversation-view"]');
    if (convView) {
      for (const old of root.querySelectorAll('.surface-composer > .agy-dream-width-handle')) old.remove();
      if (!convView.querySelector('.agy-dream-width-handle[data-mode="rail"]')) {
        const getMetrics = () => {
          const col = convView.querySelector(".mx-auto.w-full") || convView.querySelector(".surface-composer");
          const vr = convView.getBoundingClientRect();
          const dodge = vr.width > 0 ? measureOverviewDodge(convView, vr) : 0;
          const paneInnerW = Math.max(480, convView.clientWidth - dodge - 36);
          const startW = col ? col.getBoundingClientRect().width : Math.min(768, paneInnerW);
          return { paneInnerW, startW };
        };
        convView.append(createEdgeHandle("left", "rail", getMetrics));
        convView.append(createEdgeHandle("right", "rail", getMetrics));
      }
      syncChatRails();
      return;
    }
    for (const composer of root.querySelectorAll(".surface-composer")) {
      if (composer.querySelector(".agy-dream-width-handle")) continue;
      const getMetrics = () => {
        const maxWrap = composer.closest?.('[style*="--max-conversation-width"]') || composer.parentElement;
        const paneWrap = maxWrap?.parentElement;
        const paneInnerW = Math.max(480, (paneWrap ? paneWrap.clientWidth : innerWidth) - 32);
        const startW = (maxWrap || composer).getBoundingClientRect().width || Math.min(768, paneInnerW);
        return { paneInnerW, startW };
      };
      composer.append(createEdgeHandle("left", "composer", getMetrics));
      composer.append(createEdgeHandle("right", "composer", getMetrics));
    }
  }

  function scan() {
    if (!active || isAnimatingSplit) return;
    lastScanAt = Date.now();
    for (let i = saved.length - 1; i >= 0; i--) {
      if (!saved[i][0].isConnected) {
        restore(saved[i]);
        seen.delete(saved[i][0]);
        saved.splice(i, 1);
      }
    }
    const area = geometry();
    attachResizeHandles();
    const pendingMarks = [];
    const pendingVars = [];
    const queueMark = (el, attr) => pendingMarks.push([el, attr]);
    const queueVar = (el, k, v) => pendingVars.push([el, k, v]);

    for (const fade of root.querySelectorAll(".absolute.bottom-0.pointer-events-none, [class*='pointer-events-none'][style*='linear-gradient']")) {
      if (checked.has(fade)) continue;
      checked.add(fade);
      const rect = fade.getBoundingClientRect();
      if (
        rect.height <= 96 &&
        rect.width > 100 &&
        getComputedStyle(fade).backgroundImage.includes("linear-gradient")
      ) {
        queueMark(fade, "data-agy-dream-fade");
      }
    }
    for (let parent = area.scope; parent && root.contains(parent); parent = parent.parentElement) {
      if (!nativeBackgrounds.has(parent)) nativeBackgrounds.set(parent, getComputedStyle(parent).backgroundColor);
      queueMark(parent, "data-agy-dream-clear");
      if (parent === root) break;
    }
    const wantSegments = config.outputMode === "glass";
    for (const article of area.scope.querySelectorAll(".scroll-mt-4,[role=article],.prose,.markdown-body")) {
      const plate = article.closest(".scroll-mt-4") || article;
      if (!seen.has(plate)) {
        queueMark(plate, "data-agy-dream-reading");
        seen.add(plate);
      }
      if (wantSegments) {
        for (const segment of article.querySelectorAll("p,h1,h2,h3,h4,h5,h6,ul,ol,blockquote,table")) {
          if (!segment.parentElement.closest("ul,ol,blockquote,table,pre,.monaco-editor,.cm-editor,.xterm,form")) {
            queueMark(segment, "data-agy-dream-segment");
          }
        }
      }
    }
    const convView = root.querySelector?.('[data-testid="conversation-view"]');
    for (const el of area.scope.querySelectorAll(
      "div,main,section,aside,nav,header,form,textarea,pre,code,[contenteditable=true]"
    )) {
      if (
        seen.has(el) ||
        checked.has(el) ||
        el === layer ||
        el === style ||
        el === tokenStyle ||
        el.closest("#agy-dream-wallpaper-v2,[data-mention-menu],.typeahead-popover,.agy-overlay,[role=listbox],[role=menu],[role=dialog],[role=scrollbar],[data-overlay-scrollbar-track],[data-overlay-scrollbar-thumb],[data-testid*='scrollbar'],[data-split-sash],[data-testid=sidecar-iframe-slot],[data-testid=sidecar-iframe],.agy-dream-width-handle,[class*='terminal-card'],[data-browser-hole]:not([data-browser-hole='false']),[data-wcv-proxy='true']")
      ) {
        continue;
      }
      // Inside conversation-view, skip expensive layout reads on plain layout divs to keep chat switching 60fps
      if (convView && el !== convView && convView.contains(el) && !el.matches(protect)) {
        checked.add(el);
        continue;
      }
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      checked.add(el);
      const css = getComputedStyle(el);
      const bg = css.backgroundColor;
      nativeBackgrounds.set(el, bg);
      if (el.matches(protect) && !el.closest(".surface-composer,.surface-composer-card")) {
        queueMark(el, "data-agy-dream-protect");
        queueVar(el, "--agy-dream-old-bg", surfaceBackground(el));
        seen.add(el);
        continue;
      }
      if (el.closest(protect) && !el.closest(".surface-composer,.surface-composer-card")) continue;
      if (
        bg !== "rgba(0, 0, 0, 0)" &&
        bg !== "transparent" &&
        !el.hasAttribute("data-main-content-body") &&
        !el.hasAttribute("data-side-panel-body") &&
        !el.querySelector?.("[data-testid=sidecar-iframe]") &&
        (el.matches("aside,nav,header,[role=navigation]") ||
          (rect.width >= 140 && rect.width < innerWidth * 0.35 && rect.height > innerHeight * 0.55) ||
          (rect.top < 90 && rect.width > innerWidth * 0.65 && rect.height < 110))
      ) {
        queueMark(el, "data-agy-dream-chrome");
        seen.add(el);
        continue;
      }
      if (el.matches("div,main,section") && rect.width > innerWidth * 0.42 && rect.height > innerHeight * 0.36) {
        queueMark(el, "data-agy-dream-clear");
        seen.add(el);
      }
    }
    for (let i = 0; i < pendingMarks.length; i++) mark(pendingMarks[i][0], pendingMarks[i][1]);
    for (let i = 0; i < pendingVars.length; i++) variable(pendingVars[i][0], pendingVars[i][1], pendingVars[i][2]);
  }

  function schedule() {
    if (isAnimatingSplit) return;
    clearTimeout(timer);
    const delay = Date.now() - lastScanAt < 180 ? 180 : 32;
    timer = setTimeout(() => {
      if (typeof requestAnimationFrame === "function") {
        if (!rafId) {
          rafId = requestAnimationFrame(() => {
            rafId = 0;
            scan();
          });
        }
      } else {
        scan();
      }
    }, delay);
  }

  function update(next) {
    const incomingChat = clampInt(next.chatWidth, 0, 0, 100);
    if (incomingChat !== configChatWidth) {
      localChatWidth = null;
      configChatWidth = incomingChat;
    }
    config = next;
    lastGeoKey = "";
    const isStarNeko = config.glass?.themeStyle !== "official";
    const effChat = localChatWidth !== null ? localChatWidth : configChatWidth;
    root.setAttribute("data-agy-output-mode", config.outputMode === "glass" ? "glass" : "transparent");
    root.setAttribute("data-agy-theme-style", isStarNeko ? "star-neko" : "official");
    root.setAttribute("data-agy-chat-width", effChat >= 45 ? "custom" : "default");
    document.documentElement.setAttribute(
      "data-agy-smooth-video",
      config.mediaKind === "video" && config.videoSmoothMode !== false ? "1" : "0"
    );
    const baseBgColor = isStarNeko ? (dark ? "#211e2d" : "#f3edfc") : dark ? "#070709" : "#f4f5f8";
    document.body.style.setProperty("--agy-dream-base-bg", baseBgColor);
    layer.style.opacity = "1";
    layer.style.backgroundColor =
      config.fit === "adaptive"
        ? isStarNeko
          ? dark
            ? "#242033"
            : "#ede4f7"
          : dark
            ? "#0c0d12"
            : "#edeff6"
        : baseBgColor;

    const veilPct = Number(config.glass?.veil || 0);
    const scrimAlpha = veilPct > 0 ? Math.min(0.95, veilPct / 100) : Math.max(0, Math.min(0.6, config.scrim ?? 0.12));
    scrimEl.style.backgroundColor = (dark ? "rgba(10,11,16," : "rgba(244,245,250,") + scrimAlpha + ")";

    tokenStyle.textContent = buildTokenCss(config, dark);
    syncTitleBarOverlay(config, dark);

    const nextSrc = config.mediaUrl || config.image || "";
    const nextKind = config.mediaKind === "video" ? "video" : "image";
    if (nextSrc) ensureMedia(nextKind, nextSrc, config);
    if (mediaEl) mediaEl.style.opacity = String(config.opacity ?? 0.55);
    scan();
  }

  function destroy() {
    active = false;
    clearTimeout(timer);
    clearTimeout(splitAnimTimer);
    splitAnimTimer = 0;
    isAnimatingSplit = false;
    document.documentElement.classList.remove("agy-dream-animating-split");
    document.documentElement.removeAttribute("data-agy-smooth-video");
    if (holeSyncTimer) {
      clearInterval(holeSyncTimer);
      holeSyncTimer = null;
    }
    if (rafId && typeof cancelAnimationFrame === "function") {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    dragCleanup?.();
    dragCleanup = null;
    if (typeof document.removeEventListener === "function") {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      document.removeEventListener("transitionstart", onSplitTransitionStart, true);
      document.removeEventListener("transitionend", onSplitTransitionEnd, true);
    }
    observer?.disconnect();
    bodyObserver?.disconnect();
    resize?.disconnect();
    for (const h of root.querySelectorAll(".agy-dream-width-handle")) h.remove();
    document.getElementById?.("agy-dream-width-badge")?.remove();
    document.documentElement.style.removeProperty("--agy-chat-width");
    document.documentElement.style.removeProperty("--max-conversation-width");
    try {
      window.electronNative?.setTitleBarOverlay?.({
        color: dark ? "#000000" : "#ffffff",
        symbolColor: dark ? "#ffffff" : "#000000",
      });
    } catch {}
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
  bodyObserver = new MutationObserver(() => syncBrowserHoles());
  bodyObserver.observe(document.body, {
    attributes: true,
    attributeFilter: ["data-has-browser-hole", "data-has-drawer-browser-hole"],
  });
  resize = new ResizeObserver(schedule);
  resize.observe(root);

  const status = () => ({
    applied: active && root.isConnected && layer.isConnected && style.isConnected,
    mediaKind: currentKind,
    protected: root.querySelectorAll("[data-agy-dream-protect]").length,
    surfaces: root.querySelectorAll("[data-agy-dream-clear]").length,
    trackedChanges: saved.length,
    chatWidth: localChatWidth !== null ? localChatWidth : configChatWidth,
  });
  const entry = {
    update,
    destroy,
    status,
    touch: () => {
      entry.lastSeen = Date.now();
      return true;
    },
    consumeChatWidth: () => {
      const w = pendingChatWidth;
      pendingChatWidth = null;
      return w;
    },
    lastSeen: Date.now(),
    rev: THEME_REV,
    owner: config.owner,
  };
  window[key] = entry;
  return status();
}

module.exports = { installTheme };
