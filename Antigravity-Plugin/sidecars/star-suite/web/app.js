(() => {
  const $ = (id) => document.getElementById(id);
  try {
    if (!window.parent || window.parent === window) {
      document.documentElement.dataset.ssStandalone = "1";
    }
  } catch {}

  const GLASS_PRESETS = {
    off: { sidebar: [100, 0], content: [100, 0], overlay: [100, 0], control: [100, 0], header: [100, 0], bar: [100, 0] },
    light: { sidebar: [88, 10], content: [82, 12], overlay: [84, 16], control: [86, 10], header: [92, 8], bar: [90, 8] },
    balanced: { sidebar: [78, 18], content: [60, 22], overlay: [68, 24], control: [72, 14], header: [84, 14], bar: [80, 14] },
    clear: { sidebar: [0, 14], content: [0, 16], overlay: [24, 22], control: [0, 12], header: [0, 10], bar: [0, 12] },
  };

  const GLASS_REGIONS = [
    ["sidebar", "侧边栏与标题栏"],
    ["content", "页面"],
    ["overlay", "浮层与对话框"],
    ["control", "控件"],
    ["header", "顶栏"],
    ["bar", "页内工具条"],
  ];

  const GLASS_COLORS = [
    ["#38bdf8", "冰川青"],
    ["#6366f1", "靛蓝紫"],
    ["#10b981", "薄荷绿"],
    ["#f43f5e", "蔷薇粉"],
    ["#f59e0b", "琥珀橙"],
  ];

  const ACCENT_PRESETS = [
    ["", "官方默认", "#7c6cf6"],
    ["#2563eb", "晴空蓝"],
    ["#0d9488", "松石青"],
    ["#16a34a", "翡翠绿"],
    ["#ea580c", "暖日橙"],
    ["#db2777", "樱花粉"],
    ["#52525b", "石墨灰"],
  ];

  const FONT_ROLES = [
    ["main", "正文"],
    ["secondary", "次要文字"],
    ["muted", "弱化说明"],
    ["faint", "极小说明"],
  ];

  const el = {
    errorBanner: $("errorBanner"),
    toastBanner: $("toastBanner"),
    cdpWarnBanner: $("cdpWarnBanner"),
    btnRelaunchHost: $("btnRelaunchHost"),
    btnRelaunchHostEnh: $("btnRelaunchHostEnh"),
    hostDot: $("hostDot"),
    hostStatusLabel: $("hostStatusLabel"),
    hostStatusDetail: $("hostStatusDetail"),
    petDot: $("petDot"),
    petStatusLabel: $("petStatusLabel"),
    pluginVersionPill: $("pluginVersionPill"),
    pluginVersionText: $("pluginVersionText"),
    updateBadgeDot: $("updateBadgeDot"),
    activeModulesSummary: $("activeModulesSummary"),
    btnExportConfig: $("btnExportConfig"),
    btnImportConfig: $("btnImportConfig"),
    inputImportConfig: $("inputImportConfig"),
    chkSkinEnabled: $("chkSkinEnabled"),
    btnRefresh: $("btnRefresh"),
    tabs: Array.from(document.querySelectorAll("[data-tab]")),
    panels: Array.from(document.querySelectorAll("[data-panel]")),

    // Tab 1: 壁纸
    activeMediaName: $("activeMediaName"),
    activeMediaBadge: $("activeMediaBadge"),
    btnPickMedia: $("btnPickMedia"),
    btnSelectPreset: $("btnSelectPreset"),
    pathForm: $("pathForm"),
    inputMediaPath: $("inputMediaPath"),
    recentWrap: $("recentWrap"),
    recentList: $("recentList"),
    videoControls: $("videoControls"),
    chkVideoMuted: $("chkVideoMuted"),
    chkVideoSmoothMode: $("chkVideoSmoothMode"),
    btnVideoPause: $("btnVideoPause"),
    selPlaybackRate: $("selPlaybackRate"),
    previewStage: $("previewStage"),
    previewImg: $("previewImg"),
    previewVideo: $("previewVideo"),
    previewScrim: $("previewScrim"),
    outputModeBtns: Array.from(document.querySelectorAll("[data-output-mode]")),
    fitBtns: Array.from(document.querySelectorAll("[data-fit]")),
    rngOpacity: $("rngOpacity"),
    valOpacity: $("valOpacity"),
    rngZoom: $("rngZoom"),
    valZoom: $("valZoom"),
    rngScrim: $("rngScrim"),
    valScrim: $("valScrim"),
    btnResetCamera: $("btnResetCamera"),

    // Tab 2: 玻璃与字体
    themeStyleBtns: Array.from(document.querySelectorAll("[data-theme-style]")),
    glassPresetBtns: Array.from(document.querySelectorAll("[data-glass-preset]")),
    glassColorPick: $("glassColorPick"),
    glassRegionList: $("glassRegionList"),
    rngGlassVeil: $("rngGlassVeil"),
    valGlassVeil: $("valGlassVeil"),
    rngGlassRadius: $("rngGlassRadius"),
    valGlassRadius: $("valGlassRadius"),
    chatWidthBtns: Array.from(document.querySelectorAll("[data-chat-width]")),
    rngChatWidth: $("rngChatWidth"),
    valChatWidth: $("valChatWidth"),
    fontAccentPick: $("fontAccentPick"),
    fontDarkBtns: Array.from(document.querySelectorAll("[data-dark-sep]")),
    fontRoleList: $("fontRoleList"),

    // Tab 3: 遥测
    usageSummarySub: $("usageSummarySub"),
    usageRangeBtns: Array.from(document.querySelectorAll("[data-usage-range]")),
    kpiTotalTokens: $("kpiTotalTokens"),
    kpiCacheHit: $("kpiCacheHit"),
    kpiRequests: $("kpiRequests"),
    kpiCacheSize: $("kpiCacheSize"),
    btnRefreshUsage: $("btnRefreshUsage"),

    // Tab 4: 猫宠
    embeddedPetBadge: $("embeddedPetBadge"),
    btnPokePet: $("btnPokePet"),
    rngPetScale: $("rngPetScale"),
    valPetScale: $("valPetScale"),
    rngPetOpacity: $("rngPetOpacity"),
    valPetOpacity: $("valPetOpacity"),
    selPetSoundPack: $("selPetSoundPack"),
    rngPetVolume: $("rngPetVolume"),
    valPetVolume: $("valPetVolume"),

    // Tab 5: 增强与系统维护
    thoughtConfigWrap: $("thoughtConfigWrap"),
    thoughtOpenaiFields: $("thoughtOpenaiFields"),
    inputThoughtEndpoint: $("inputThoughtEndpoint"),
    inputThoughtModel: $("inputThoughtModel"),
    inputThoughtApiKey: $("inputThoughtApiKey"),
    btnSaveThoughtCfg: $("btnSaveThoughtCfg"),
    debugPortStatus: $("debugPortStatus"),
    btnEnsureDebugPort: $("btnEnsureDebugPort"),
    archiveSummary: $("archiveSummary"),
    btnScanArchive: $("btnScanArchive"),
    btnRunArchive: $("btnRunArchive"),
    archiveBatchList: $("archiveBatchList"),
    selGomemlimit: $("selGomemlimit"),
    gomemlimitStatus: $("gomemlimitStatus"),
    btnApplyGomemlimit: $("btnApplyGomemlimit"),
    legacyWidgetBox: $("legacyWidgetBox"),
    btnStopLegacyWidget: $("btnStopLegacyWidget"),
    agyVersionLabel: $("agyVersionLabel"),
    i18nOverrideLabel: $("i18nOverrideLabel"),
    btnReloadI18n: $("btnReloadI18n"),
    btnSyncReloadI18n: $("btnSyncReloadI18n"),
    pluginUpdateCard: $("pluginUpdateCard"),
    updateCurVer: $("updateCurVer"),
    updateStatusText: $("updateStatusText"),
    btnCheckUpdate: $("btnCheckUpdate"),
    btnApplyUpdate: $("btnApplyUpdate"),
    updateNotesBox: $("updateNotesBox"),
    updateNotesText: $("updateNotesText"),
    updateReleaseLink: $("updateReleaseLink"),

    // 通用特性开关按钮与分段选项
    featureToggles: Array.from(document.querySelectorAll("button.toggle-btn[data-fkey]")),
    featureOptionBtns: Array.from(document.querySelectorAll("[data-fopt]")),
  };

  let latestState = null;
  let dragging = null;
  let loadedVideoSrc = "";
  let loadedImgSrc = "";
  let fontPicker = null;
  let debounceTimer = null;
  let toastTimer = null;
  let isInteracting = false;
  let currentTab = "wallpaper";
  let currentUsageRange = "today";
  let scannedArchivableIds = [];

  function setError(message) {
    if (!message) {
      el.errorBanner.textContent = "";
      el.errorBanner.classList.add("hidden");
      return;
    }
    el.errorBanner.textContent = message;
    el.errorBanner.classList.remove("hidden");
  }

  function showToast(message) {
    if (!el.toastBanner) return;
    clearTimeout(toastTimer);
    el.toastBanner.textContent = message;
    el.toastBanner.classList.remove("hidden");
    toastTimer = setTimeout(() => {
      el.toastBanner.classList.add("hidden");
    }, 3200);
  }

  function formatCompactNumber(num) {
    const n = Number(num || 0);
    if (!Number.isFinite(n)) return "0";
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(Math.round(n));
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return "0 B";
    if (n >= 1024 * 1024 * 1024) return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
    if (n >= 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }

  async function apiFetch(routePath, init = {}) {
    if (window.sidecar && typeof window.sidecar.fetch === "function") {
      return window.sidecar.fetch(routePath, init);
    }
    return fetch("." + routePath, init);
  }

  async function requestJson(routePath, method = "GET", body = null) {
    const init = { method, headers: {} };
    if (body !== null) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const response = await apiFetch(routePath, init);
    const text = await response.text();
    let parsed = {};
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = { error: text };
      }
    }
    if (!response.ok) {
      throw new Error(parsed.error || `请求失败 (${response.status})`);
    }
    return parsed;
  }

  function setSwitchState(btn, checked) {
    if (!btn) return;
    btn.setAttribute("aria-checked", checked ? "true" : "false");
  }

  function isSwitchChecked(btn) {
    return btn?.getAttribute("aria-checked") === "true";
  }

  function getFeaturePath(features, dotted) {
    const [section, key] = dotted.split(".");
    return features?.[section]?.[key];
  }

  function buildFeaturePatch(dotted, value) {
    const [section, key] = dotted.split(".");
    return { features: { [section]: { [key]: value } } };
  }

  function scheduleSave(patch) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      saveSettings(patch);
    }, 180);
  }

  async function saveSettings(patch) {
    try {
      setError("");
      const next = await requestJson("/api/settings", "POST", patch);
      renderState(next);
    } catch (error) {
      setError(error.message);
    }
  }

  function switchTab(target) {
    closeFontPicker();
    currentTab = target;
    for (const t of el.tabs) {
      const active = t.dataset.tab === target;
      t.classList.toggle("active", active);
      t.setAttribute("aria-selected", String(active));
    }
    for (const p of el.panels) {
      p.classList.toggle("hidden", p.dataset.panel !== target);
    }
    if (target === "telemetry") {
      loadUsageCard().catch(() => {});
    } else if (target === "enhance") {
      loadSystemMaint().catch(() => {});
    }
  }

  // ── 四表面态精准检测（dark / light / glass-dark / glass-light）与主题同步 ──
  function parseColorLuminance(raw) {
    if (typeof raw !== "string") return null;
    const str = raw.trim().toLowerCase();
    if (!str || str === "transparent" || str === "none") return null;
    let r = 0, g = 0, b = 0, a = 1;
    const hex6 = /^#([0-9a-f]{6})$/.exec(str);
    const hex3 = /^#([0-9a-f]{3})$/.exec(str);
    const rgb = /^rgba?\(\s*([\d.]+)\s*[,\s]\s*([\d.]+)\s*[,\s]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(str);
    if (hex6) {
      const n = parseInt(hex6[1], 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else if (hex3) {
      r = parseInt(hex3[1][0] + hex3[1][0], 16);
      g = parseInt(hex3[1][1] + hex3[1][1], 16);
      b = parseInt(hex3[1][2] + hex3[1][2], 16);
    } else if (rgb) {
      r = Number(rgb[1]); g = Number(rgb[2]); b = Number(rgb[3]);
      if (rgb[4] !== undefined) {
        a = rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : Number(rgb[4]);
      }
    } else {
      return null;
    }
    if (!Number.isFinite(a) || a < 0.2) return null;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }

  function detectPanelDark(state) {
    if (typeof state?.hostDark === "boolean") return state.hostDark;
    const docEl = document.documentElement;
    const attrTheme = (docEl.dataset.theme || docEl.getAttribute("data-theme") || "").toLowerCase();
    if (attrTheme === "dark") return true;
    if (attrTheme === "light") return false;
    if (docEl.classList.contains("dark") || document.body?.classList?.contains("dark")) return true;
    if (docEl.classList.contains("light") || document.body?.classList?.contains("light")) return false;
    try {
      const cs = getComputedStyle(docEl);
      const bgLum = parseColorLuminance(cs.getPropertyValue("--background"));
      if (bgLum !== null) return bgLum <= 0.52;
      const fgLum = parseColorLuminance(cs.getPropertyValue("--foreground"));
      if (fgLum !== null) return fgLum >= 0.48;
    } catch {}
    try {
      if (window.matchMedia) return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {}
    return true;
  }

  function resolveSurfaceMode(state) {
    const isDark = detectPanelDark(state);
    const isGlass = Boolean(state?.settings?.enabled);
    if (isGlass) return { isDark, isGlass, surface: isDark ? "glass-dark" : "glass-light" };
    return { isDark, isGlass, surface: isDark ? "dark" : "light" };
  }

  function syncPanelOwnTheme(s, state = latestState) {
    const rs = document.documentElement.style;
    const g = s.glass || {};
    const regions = g.regions || {};
    const themeStyle = g.themeStyle === "official" ? "official" : "star-neko";
    const { isDark, surface } = resolveSurfaceMode(state || { settings: s });
    document.documentElement.dataset.ssThemeStyle = themeStyle;
    document.documentElement.dataset.ssSurface = surface;
    document.documentElement.dataset.ssPolarity = isDark ? "dark" : "light";
    rs.colorScheme = isDark ? "dark" : "light";

    const rawRadius = Number(g.radius);
    const radius = Number.isFinite(rawRadius) ? Math.min(24, Math.max(8, Math.round(rawRadius))) : 16;
    rs.setProperty("--ss-radius", radius + "px");
    rs.setProperty("--ss-glass-tint", g.tint || (isDark ? "#ffffff" : "#f8fafc"));
    if (regions.content) {
      rs.setProperty("--ss-glass-content-fill", Math.max(18, regions.content.fill) + "%");
      rs.setProperty("--ss-glass-content-blur", regions.content.blur + "px");
    }
    if (regions.overlay) {
      rs.setProperty("--ss-glass-overlay-fill", Math.max(24, regions.overlay.fill) + "%");
      rs.setProperty("--ss-glass-overlay-blur", Math.max(10, regions.overlay.blur) + "px");
    }

    const f = s.font || {};
    const activePalette = isDark && f.darkSeparate ? { ...(f.colors || {}), ...(f.colorsDark || {}) } : (f.colors || {});
    if (f.accent) rs.setProperty("--ss-accent", f.accent);
    else rs.removeProperty("--ss-accent");
    if (activePalette.main) rs.setProperty("--ss-fg", activePalette.main);
    else rs.removeProperty("--ss-fg");
    if (activePalette.secondary) rs.setProperty("--ss-fg-2", activePalette.secondary);
    else rs.removeProperty("--ss-fg-2");
    if (activePalette.muted) rs.setProperty("--ss-muted", activePalette.muted);
    else rs.removeProperty("--ss-muted");
    if (activePalette.faint) rs.setProperty("--ss-faint", activePalette.faint);
    else rs.removeProperty("--ss-faint");
  }

  // ── HSV 颜色计算与可拖拽取色器 ──
  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }

  function rgbToHsv(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let h = 0;
    if (d) {
      if (mx === r) h = ((g - b) / d) % 6;
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return [h, mx ? d / mx : 0, mx];
  }

  function hsvToRgb(h, s, v) {
    const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }

  function closeFontPicker() {
    if (!fontPicker) return;
    if (fontPicker.onDoc) document.removeEventListener("pointerdown", fontPicker.onDoc, true);
    fontPicker.el.remove();
    fontPicker = null;
    isInteracting = false;
  }

  function openFontPicker(anchor, initialHex, onApply) {
    closeFontPicker();
    isInteracting = true;
    let [h, s, v] = rgbToHsv(...hexToRgb(initialHex || "#ffffff"));

    const picker = document.createElement("div");
    picker.className = "fc-picker";
    picker.innerHTML =
      '<div class="fc-picker-bar"><span>选择颜色</span><button type="button" class="fc-picker-close" aria-label="关闭">✕</button></div>' +
      '<div class="fc-sv"><div class="fc-sv-white"></div><div class="fc-sv-black"></div><span class="fc-sv-thumb"></span></div>' +
      '<div class="fc-hue"><span class="fc-hue-thumb"></span></div>' +
      '<div class="fc-picker-foot"><button type="button" class="fc-clear">清除</button><input class="fc-hex-input" spellcheck="false" maxlength="7"></div>';
    document.body.appendChild(picker);

    const rect = anchor.getBoundingClientRect();
    picker.style.left = Math.max(8, Math.min(window.innerWidth - 236, rect.left - 110)) + "px";
    picker.style.top = Math.max(8, Math.min(window.innerHeight - 280, rect.bottom + 8)) + "px";

    const sv = picker.querySelector(".fc-sv");
    const svThumb = picker.querySelector(".fc-sv-thumb");
    const hue = picker.querySelector(".fc-hue");
    const hueThumb = picker.querySelector(".fc-hue-thumb");
    const hexIn = picker.querySelector(".fc-hex-input");

    const paint = (emit = true) => {
      sv.style.background = `hsl(${h}, 100%, 50%)`;
      svThumb.style.left = s * 100 + "%";
      svThumb.style.top = (1 - v) * 100 + "%";
      hueThumb.style.left = (h / 360) * 100 + "%";
      const out = rgbHex(...hsvToRgb(h, s, v));
      if (document.activeElement !== hexIn) hexIn.value = out;
      if (emit) onApply(out);
    };

    const bindDrag = (node, calcFn) => {
      node.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        node.setPointerCapture(ev.pointerId);
        calcFn(ev);
        const mv = (e2) => calcFn(e2);
        const up = () => {
          node.removeEventListener("pointermove", mv);
          node.removeEventListener("pointerup", up);
        };
        node.addEventListener("pointermove", mv);
        node.addEventListener("pointerup", up);
      });
    };

    bindDrag(sv, (ev) => {
      const r = sv.getBoundingClientRect();
      s = Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      v = 1 - Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
      paint(true);
    });

    bindDrag(hue, (ev) => {
      const r = hue.getBoundingClientRect();
      h = 360 * Math.min(1, Math.max(0, (ev.clientX - r.left) / r.width));
      paint(true);
    });

    hexIn.addEventListener("input", () => {
      if (!/^#[0-9a-f]{6}$/i.test(hexIn.value)) return;
      [h, s, v] = rgbToHsv(...hexToRgb(hexIn.value));
      paint(true);
    });

    picker.querySelector(".fc-clear").addEventListener("click", () => {
      onApply("");
      closeFontPicker();
    });
    picker.querySelector(".fc-picker-close").addEventListener("click", closeFontPicker);

    const onDoc = (ev) => {
      if (!picker.contains(ev.target) && !anchor.contains(ev.target)) closeFontPicker();
    };
    document.addEventListener("pointerdown", onDoc, true);
    paint(false);
    fontPicker = { el: picker, onDoc };
  }

  // ── 预览与各区域渲染 ──
  function updatePreviewMedia(state) {
    const s = state.settings;
    const media = state.activeMedia || {};
    const isVideo = media.mediaKind === "video" && !media.wallpaperError && media.mediaUrl;
    const fitMode = s.fit === "adaptive" ? "cover" : s.fit;
    const opacity = s.enabled ? s.opacity / 100 : 0.35;
    const objectPos = `${s.positionX}% ${s.positionY}%`;
    const transform = `scale(${s.zoom})`;

    if (isVideo) {
      el.previewImg.classList.add("hidden");
      el.previewVideo.classList.remove("hidden");
      // 预览窗仅定格首帧，避免与宿主并发解码两路 4K 视频流
      el.previewVideo.autoplay = false;
      el.previewVideo.loop = false;
      el.previewVideo.muted = true;
      if (loadedVideoSrc !== media.mediaUrl) {
        loadedVideoSrc = media.mediaUrl;
        const pausePreview = () => {
          if (loadedVideoSrc !== media.mediaUrl) return;
          el.previewVideo.pause();
        };
        el.previewVideo.onloadeddata = () => {
          const dur = el.previewVideo.duration;
          if (Number.isFinite(dur) && dur > 0.25 && el.previewVideo.currentTime < 0.05) {
            el.previewVideo.onseeked = () => {
              el.previewVideo.onseeked = null;
              pausePreview();
            };
            try {
              el.previewVideo.currentTime = 0.1;
              return;
            } catch {}
          }
          pausePreview();
        };
        el.previewVideo.src = media.mediaUrl;
      } else {
        el.previewVideo.pause();
      }
      el.previewVideo.style.objectFit = fitMode;
      el.previewVideo.style.objectPosition = objectPos;
      el.previewVideo.style.opacity = String(opacity);
      el.previewVideo.style.transform = transform;
    } else {
      el.previewVideo.classList.add("hidden");
      if (loadedVideoSrc) {
        el.previewVideo.pause();
        el.previewVideo.removeAttribute("src");
        el.previewVideo.load();
        loadedVideoSrc = "";
      }
      el.previewImg.classList.remove("hidden");
      const targetSrc = media.mediaUrl || "./preset-wallpaper.png";
      if (loadedImgSrc !== targetSrc) {
        loadedImgSrc = targetSrc;
        el.previewImg.src = targetSrc;
      }
      el.previewImg.style.objectFit = fitMode;
      el.previewImg.style.objectPosition = objectPos;
      el.previewImg.style.opacity = String(opacity);
      el.previewImg.style.transform = transform;
    }

    const veilPct = Number(s.glass?.veil || 0);
    const scrimAlpha = veilPct > 0 ? Math.min(0.95, veilPct / 100) : Math.max(0, Math.min(0.6, (s.scrim ?? 12) / 100));
    el.previewScrim.style.background = `linear-gradient(180deg, rgba(16, 17, 24, ${scrimAlpha * 0.45}), rgba(10, 12, 18, ${scrimAlpha * 0.8}))`;
  }

  function renderRecentChips(state) {
    const items = state.recentItems || [];
    if (!items.length) {
      el.recentWrap.classList.add("hidden");
      el.recentList.replaceChildren();
      return;
    }
    el.recentWrap.classList.remove("hidden");
    el.recentList.replaceChildren();
    const activePath = state.settings.mediaType === "preset" ? "" : state.settings.customMediaPath;

    for (const item of items) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-chip";
      if (activePath && item.path === activePath) btn.classList.add("active");
      if (!item.exists) btn.classList.add("missing");
      btn.title = item.path;
      btn.textContent = `${item.kind === "video" ? "🎬" : "🖼"} ${item.name}`;
      btn.addEventListener("click", async () => {
        try {
          setError("");
          const next = await requestJson("/api/select-media", "POST", { path: item.path });
          renderState(next);
        } catch (error) {
          setError(error.message);
        }
      });
      el.recentList.appendChild(btn);
    }
  }

  function activeGlassPreset(regions) {
    for (const [id, shape] of Object.entries(GLASS_PRESETS)) {
      const match = Object.entries(shape).every(
        ([k, [f, b]]) => regions[k]?.fill === f && regions[k]?.blur === b
      );
      if (match) return id;
    }
    return "custom";
  }

  function renderGlassControls(s) {
    const g = s.glass || { themeStyle: "star-neko", tint: "#ffffff", veil: 0, radius: 16, regions: {} };
    const themeStyle = g.themeStyle === "official" ? "official" : "star-neko";
    for (const btn of el.themeStyleBtns) {
      btn.classList.toggle("active", btn.dataset.themeStyle === themeStyle);
    }
    const regions = g.regions || {};
    const curPreset = activeGlassPreset(regions);
    for (const btn of el.glassPresetBtns) {
      btn.classList.toggle("active", btn.dataset.glassPreset === curPreset);
    }

    const curTint = (g.tint || "").toLowerCase();
    el.glassColorPick.replaceChildren();
    for (const [hex, title] of GLASS_COLORS) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "ss-swatch-dot" + (curTint === hex ? " on" : "");
      dot.title = title;
      dot.style.setProperty("--sw", hex);
      dot.addEventListener("click", () => saveSettings({ glass: { tint: hex } }));
      el.glassColorPick.appendChild(dot);
    }
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "ss-fc-swatch" + (curTint ? "" : " empty");
    sw.style.setProperty("--fc", curTint || "transparent");
    sw.title = "自定义玻璃颜色";
    const hexCode = document.createElement("code");
    hexCode.className = "ss-fc-hex";
    hexCode.textContent = curTint || "跟随主题";
    const resetBtn = document.createElement("button");
    resetBtn.type = "button";
    resetBtn.className = "ss-btn-link" + (curTint ? "" : " hidden");
    resetBtn.textContent = "重置";
    resetBtn.addEventListener("click", () => {
      closeFontPicker();
      saveSettings({ glass: { tint: "" } });
    });
    sw.addEventListener("click", () => {
      openFontPicker(sw, curTint || "#ffffff", (out) => {
        sw.style.setProperty("--fc", out || "transparent");
        sw.classList.toggle("empty", !out);
        hexCode.textContent = out || "跟随主题";
        resetBtn.classList.toggle("hidden", !out);
        document.documentElement.style.setProperty("--ss-glass-tint", out || "#ffffff");
        scheduleSave({ glass: { tint: out } });
      });
    });
    el.glassColorPick.append(sw, hexCode, resetBtn);

    if (!isInteracting) {
      el.glassRegionList.replaceChildren();
      for (const [key, label] of GLASS_REGIONS) {
        const part = regions[key] || { fill: 70, blur: 16 };
        const row = document.createElement("div");
        row.className = "ss-row";
        const who = document.createElement("div");
        who.className = "ss-who";
        const nameEl = document.createElement("div");
        nameEl.className = "ss-name";
        nameEl.textContent = label;
        who.appendChild(nameEl);

        const sliders = document.createElement("div");
        sliders.className = "ss-dual-sliders";
        const mine = { fill: Number(part.fill), blur: Number(part.blur) };
        for (const [metric, mLabel, max, unit] of [
          ["fill", "不透明度", 100, "%"],
          ["blur", "模糊", 40, "px"],
        ]) {
          const wrap = document.createElement("label");
          wrap.className = "ss-mini-slider";
          const span = document.createElement("span");
          span.textContent = mLabel;
          const rng = document.createElement("input");
          rng.type = "range";
          rng.min = "0";
          rng.max = String(max);
          rng.step = "1";
          rng.value = String(mine[metric]);
          const out = document.createElement("output");
          out.textContent = mine[metric] + unit;
          rng.addEventListener("pointerdown", () => { isInteracting = true; });
          rng.addEventListener("input", () => {
            mine[metric] = Number(rng.value);
            out.textContent = rng.value + unit;
          });
          rng.addEventListener("change", () => {
            isInteracting = false;
            saveSettings({ glass: { regions: { [key]: { ...mine } } } });
          });
          wrap.append(span, rng, out);
          sliders.appendChild(wrap);
        }
        row.append(who, sliders);
        el.glassRegionList.appendChild(row);
      }
    }

    const veilVal = Number(g.veil || 0);
    el.rngGlassVeil.value = String(veilVal);
    el.valGlassVeil.textContent = veilVal > 0 ? veilVal + "%" : "自动";

    const rawRadius = Number(g.radius);
    const radiusVal = Number.isFinite(rawRadius) ? Math.min(24, Math.max(8, Math.round(rawRadius))) : 16;
    el.rngGlassRadius.value = String(radiusVal);
    el.valGlassRadius.textContent = radiusVal + "px";
  }

  function buildFontRoleRow(roleKey, label, currentHex, fieldKey) {
    const row = document.createElement("div");
    row.className = "ss-row";
    const who = document.createElement("div");
    who.className = "ss-who";
    const title = document.createElement("div");
    title.className = "ss-name";
    title.textContent = label;
    who.appendChild(title);

    const actions = document.createElement("div");
    actions.className = "ss-color-actions";
    const sw = document.createElement("button");
    sw.type = "button";
    sw.className = "ss-fc-swatch" + (currentHex ? "" : " empty");
    sw.style.setProperty("--fc", currentHex || "transparent");
    const hexText = document.createElement("code");
    hexText.className = "ss-fc-hex";
    hexText.textContent = currentHex || "跟随主题";
    const reset = document.createElement("button");
    reset.type = "button";
    reset.className = "ss-btn-link" + (currentHex ? "" : " hidden");
    reset.textContent = "重置";

    sw.addEventListener("click", () => {
      openFontPicker(sw, currentHex || "#ffffff", (out) => {
        sw.style.setProperty("--fc", out || "transparent");
        sw.classList.toggle("empty", !out);
        hexText.textContent = out || "跟随主题";
        reset.classList.toggle("hidden", !out);
        scheduleSave({ font: { [fieldKey]: { [roleKey]: out } } });
      });
    });

    reset.addEventListener("click", () => {
      closeFontPicker();
      saveSettings({ font: { [fieldKey]: { [roleKey]: "" } } });
    });

    actions.append(sw, hexText, reset);
    row.append(who, actions);
    return row;
  }

  function renderFontControls(s) {
    const f = s.font || { accent: "", darkSeparate: false, colors: {}, colorsDark: {} };
    const curAccent = (f.accent || "").toLowerCase();

    el.fontAccentPick.replaceChildren();
    for (const [val, label, dotHex] of ACCENT_PRESETS) {
      const dot = document.createElement("button");
      dot.type = "button";
      dot.className = "ss-swatch-dot" + (curAccent === val ? " on" : "");
      dot.title = label;
      dot.style.setProperty("--sw", dotHex || val);
      dot.addEventListener("click", () => saveSettings({ font: { accent: val } }));
      el.fontAccentPick.appendChild(dot);
    }
    const customDot = document.createElement("button");
    customDot.type = "button";
    customDot.className = "ss-fc-swatch" + (curAccent ? "" : " empty");
    customDot.style.setProperty("--fc", curAccent || "transparent");
    customDot.title = "自定义强调色";
    customDot.addEventListener("click", () => {
      openFontPicker(customDot, curAccent || "#7c6cf6", (out) => {
        customDot.style.setProperty("--fc", out || "transparent");
        customDot.classList.toggle("empty", !out);
        scheduleSave({ font: { accent: out } });
      });
    });
    el.fontAccentPick.appendChild(customDot);

    for (const btn of el.fontDarkBtns) {
      btn.classList.toggle("active", (btn.dataset.darkSep === "true") === Boolean(f.darkSeparate));
    }

    if (!isInteracting) {
      el.fontRoleList.replaceChildren();
      for (const [role, label] of FONT_ROLES) {
        el.fontRoleList.appendChild(buildFontRoleRow(role, label, f.colors?.[role] || "", "colors"));
      }
      if (f.darkSeparate) {
        const split = document.createElement("div");
        split.className = "ss-split-head";
        split.textContent = "深色主题独立色值";
        el.fontRoleList.appendChild(split);
        for (const [role, label] of FONT_ROLES) {
          el.fontRoleList.appendChild(buildFontRoleRow(role, label, f.colorsDark?.[role] || "", "colorsDark"));
        }
      }
    }
  }

  function renderFeatureControls(state) {
    const s = state.settings || {};
    const f = s.features || {};
    const pet = f.embeddedPet || {};
    const wb = f.workbench || {};
    const i18n = f.i18n || {};
    const tel = f.telemetry || {};

    // Header running module pills
    const pills = [
      ["壁纸", Boolean(s.enabled)],
      ["遥测", Boolean(tel.enabled && tel.barMode !== "off")],
      ["猫宠", Boolean(pet.enabled)],
      ["汉化", i18n.mode !== "off"],
      ["工作台", Boolean(wb.codeFold || wb.contextMenu || wb.inlineDiff || wb.fullTextSearch)],
    ];
    el.activeModulesSummary.replaceChildren();
    for (const [label, active] of pills) {
      const span = document.createElement("span");
      span.className = "ss-mod-pill" + (active ? " on" : "");
      span.textContent = label;
      el.activeModulesSummary.appendChild(span);
    }

    // Pet status indicator
    if (pet.enabled) {
      el.petDot.className = "ss-dot ok";
      el.petStatusLabel.textContent = "猫宠内置";
      el.embeddedPetBadge.textContent = "已内置运行";
      el.embeddedPetBadge.className = "ss-tag ss-tag-ok";
    } else {
      el.petDot.className = "ss-dot";
      el.petStatusLabel.textContent = "猫宠已关";
      el.embeddedPetBadge.textContent = "已关闭";
      el.embeddedPetBadge.className = "ss-tag";
    }

    // Feature toggle switch buttons
    for (const btn of el.featureToggles) {
      setSwitchState(btn, Boolean(getFeaturePath(f, btn.dataset.fkey)));
    }

    // Option pills / segmented controls
    for (const btn of el.featureOptionBtns) {
      const cur = getFeaturePath(f, btn.dataset.fopt);
      btn.classList.toggle("active", String(cur ?? "") === String(btn.dataset.val));
    }

    // Embedded pet sliders & select
    const scale = Number(pet.scale ?? 100);
    const opacity = Number(pet.opacity ?? 100);
    const volume = Number(pet.volume ?? 60);
    if (!isInteracting) {
      el.rngPetScale.value = String(scale);
      el.rngPetOpacity.value = String(opacity);
      el.rngPetVolume.value = String(volume);
    }
    el.valPetScale.textContent = Math.round(scale) + "%";
    el.valPetOpacity.textContent = Math.round(opacity) + "%";
    el.valPetVolume.textContent = Math.round(volume) + "%";
    if (pet.soundPack && el.selPetSoundPack.value !== pet.soundPack) {
      el.selPetSoundPack.value = pet.soundPack;
    }

    // Thought translate sub-fields
    const ttMode = wb.thoughtTranslate || "off";
    el.thoughtConfigWrap.classList.toggle("hidden", ttMode === "off");
    el.thoughtOpenaiFields.classList.toggle("hidden", ttMode !== "openai");
    if (document.activeElement !== el.inputThoughtEndpoint) {
      el.inputThoughtEndpoint.value = wb.thoughtEndpoint || "";
    }
    if (document.activeElement !== el.inputThoughtModel) {
      el.inputThoughtModel.value = wb.thoughtModel || "";
    }
    if (document.activeElement !== el.inputThoughtApiKey) {
      el.inputThoughtApiKey.value = wb.thoughtApiKey || "";
    }

    // Legacy standalone StarWidget process detection
    const legacyRunning = Boolean(state.widget?.running);
    el.legacyWidgetBox.classList.toggle("hidden", !legacyRunning);

    // AGY version linkage & i18n reload info
    const verStr = state.pluginVersion ? `v${String(state.pluginVersion).replace(/^v/i, "")}` : "v0.4.0";
    if (el.pluginVersionText) el.pluginVersionText.textContent = verStr;
    if (el.updateCurVer) el.updateCurVer.textContent = verStr;

    const agyVer = state.agyVersion || (state.status?.connected ? "已连接（未上报版本串）" : "等待连接 Antigravity");
    const reloadTime = state.lastI18nReloadAt ? ` · 上次重载 ${new Date(state.lastI18nReloadAt).toLocaleTimeString()}` : "";
    if (el.agyVersionLabel) {
      el.agyVersionLabel.textContent = `AGY 版本：${agyVer}${reloadTime}`;
    }
    if (el.i18nOverrideLabel) {
      const ovCount = Number(state.i18nOverrideCount || 0);
      const upText = state.lastAgyUpgradeReloadAt
        ? ` · 已响应 AGY 升级自动重载 (${new Date(state.lastAgyUpgradeReloadAt).toLocaleTimeString()})`
        : " · AGY 升级自动重载汉化";
      el.i18nOverrideLabel.textContent = `本地覆盖词条：${ovCount} 条${upText}`;
    }

    renderUpdateStatus(state.updateStatus);
  }

  function isSafeHttpUrl(raw) {
    try {
      const u = new URL(String(raw || "").trim());
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }

  function appendInlineMarkdown(parent, text) {
    const src = String(text || "");
    const tokenRe = /`([^`\n]+)`|\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\n]+)\*|~~([^~\n]+)~~|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?"'\]])/g;
    let last = 0;
    let m;
    while ((m = tokenRe.exec(src)) !== null) {
      if (m.index > last) {
        parent.appendChild(document.createTextNode(src.slice(last, m.index)));
      }
      if (m[1] !== undefined) {
        const code = document.createElement("code");
        code.className = "ss-md-code";
        code.textContent = m[1];
        parent.appendChild(code);
      } else if (m[2] !== undefined && m[3] !== undefined) {
        if (isSafeHttpUrl(m[3])) {
          const a = document.createElement("a");
          a.className = "ss-md-link";
          a.href = m[3].trim();
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          appendInlineMarkdown(a, m[2]);
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(m[2]));
        }
      } else if (m[4] !== undefined || m[5] !== undefined) {
        const strong = document.createElement("strong");
        appendInlineMarkdown(strong, m[4] !== undefined ? m[4] : m[5]);
        parent.appendChild(strong);
      } else if (m[6] !== undefined) {
        const em = document.createElement("em");
        appendInlineMarkdown(em, m[6]);
        parent.appendChild(em);
      } else if (m[7] !== undefined) {
        const del = document.createElement("del");
        appendInlineMarkdown(del, m[7]);
        parent.appendChild(del);
      } else if (m[8] !== undefined) {
        if (isSafeHttpUrl(m[8])) {
          const a = document.createElement("a");
          a.className = "ss-md-link";
          a.href = m[8];
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          a.textContent = m[8];
          parent.appendChild(a);
        } else {
          parent.appendChild(document.createTextNode(m[8]));
        }
      }
      last = tokenRe.lastIndex;
    }
    if (last < src.length) {
      parent.appendChild(document.createTextNode(src.slice(last)));
    }
  }

  function renderMarkdownNotes(container, markdown) {
    if (!container) return;
    const normalized = String(markdown || "").replace(/\r\n?/g, "\n").trim();
    if (container.dataset && container.dataset.mdSrc === normalized) return;
    if (container.dataset) container.dataset.mdSrc = normalized;
    container.textContent = "";
    if (!normalized) return;

    const frag = document.createDocumentFragment();
    const lines = normalized.split("\n");
    let i = 0;

    while (i < lines.length) {
      const line = lines[i];
      if (!line.trim()) {
        i += 1;
        continue;
      }

      // Fenced code block
      const fenceMatch = line.match(/^\s*```([\w-]*)\s*$/);
      if (fenceMatch) {
        const codeLines = [];
        i += 1;
        while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
          codeLines.push(lines[i]);
          i += 1;
        }
        if (i < lines.length) i += 1;
        const pre = document.createElement("pre");
        pre.className = "ss-md-pre";
        const code = document.createElement("code");
        code.textContent = codeLines.join("\n");
        pre.appendChild(code);
        frag.appendChild(pre);
        continue;
      }

      // Horizontal rule
      if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
        const hr = document.createElement("hr");
        hr.className = "ss-md-hr";
        frag.appendChild(hr);
        i += 1;
        continue;
      }

      // Heading (#..####)
      const headMatch = line.match(/^\s*(#{1,4})\s+(.+?)\s*#*$/);
      if (headMatch) {
        const lvl = Math.min(4, headMatch[1].length);
        const h = document.createElement(`h${lvl}`);
        h.className = `ss-md-h ss-md-h${lvl}`;
        appendInlineMarkdown(h, headMatch[2]);
        frag.appendChild(h);
        i += 1;
        continue;
      }

      // Blockquote
      if (/^\s*>\s?/.test(line)) {
        const quoteLines = [];
        while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
          quoteLines.push(lines[i].replace(/^\s*>\s?/, ""));
          i += 1;
        }
        const bq = document.createElement("blockquote");
        bq.className = "ss-md-quote";
        quoteLines.forEach((ql, idx) => {
          if (idx > 0) bq.appendChild(document.createElement("br"));
          appendInlineMarkdown(bq, ql);
        });
        frag.appendChild(bq);
        continue;
      }

      // List (unordered or ordered, supporting 1-level indented sublists)
      const listStart = line.match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.+)$/);
      if (listStart) {
        const baseIndent = listStart[1].length;
        const rootOrdered = Boolean(listStart[3]);
        const listEl = document.createElement(rootOrdered ? "ol" : "ul");
        listEl.className = "ss-md-list";
        let lastLi = null;
        let lastSubList = null;
        let lastSubOrdered = null;

        while (i < lines.length) {
          const itemMatch = lines[i].match(/^(\s*)(?:([-*+])|(\d+)\.)\s+(.+)$/);
          if (!itemMatch) break;
          const indent = itemMatch[1].length;
          const ordered = Boolean(itemMatch[3]);
          const body = itemMatch[4];

          if (indent >= baseIndent + 2 && lastLi) {
            if (!lastSubList || lastSubOrdered !== ordered) {
              lastSubList = document.createElement(ordered ? "ol" : "ul");
              lastSubList.className = "ss-md-sublist";
              lastLi.appendChild(lastSubList);
              lastSubOrdered = ordered;
            }
            const subLi = document.createElement("li");
            appendInlineMarkdown(subLi, body);
            lastSubList.appendChild(subLi);
          } else {
            if (ordered !== rootOrdered && indent <= baseIndent) break;
            const li = document.createElement("li");
            appendInlineMarkdown(li, body);
            listEl.appendChild(li);
            lastLi = li;
            lastSubList = null;
            lastSubOrdered = null;
          }
          i += 1;
        }
        frag.appendChild(listEl);
        continue;
      }

      // Paragraph
      const paraLines = [];
      while (
        i < lines.length &&
        lines[i].trim() &&
        !/^\s*(?:```|#{1,4}\s+|>\s?|(?:---+|\*\*\*+|___+)\s*$|[-*+]\s+|\d+\.\s+)/.test(lines[i])
      ) {
        paraLines.push(lines[i].trim());
        i += 1;
      }
      if (paraLines.length) {
        const p = document.createElement("p");
        p.className = "ss-md-p";
        paraLines.forEach((pl, idx) => {
          if (idx > 0) p.appendChild(document.createElement("br"));
          appendInlineMarkdown(p, pl);
        });
        frag.appendChild(p);
      } else {
        i += 1;
      }
    }

    container.appendChild(frag);
  }

  function renderUpdateStatus(up) {
    if (!up || !el.updateStatusText) return;
    const hasUpdate = Boolean(up.hasUpdate && up.downloadUrl);
    el.updateBadgeDot?.classList.toggle("hidden", !hasUpdate);
    el.btnApplyUpdate?.classList.toggle("hidden", !hasUpdate);
    if (el.btnApplyUpdate) {
      el.btnApplyUpdate.disabled = Boolean(up.updating);
      el.btnApplyUpdate.textContent = up.updating ? "更新安装中…" : `一键更新至 v${String(up.latestVersion || "").replace(/^v/i, "")}`;
    }
    if (el.btnCheckUpdate) {
      el.btnCheckUpdate.disabled = Boolean(up.checking || up.updating);
    }
    if (up.error) {
      el.updateStatusText.textContent = `检查/更新提示：${up.error}`;
    } else if (up.appliedVersion) {
      el.updateStatusText.textContent = `已安装 v${String(up.appliedVersion).replace(/^v/i, "")}，正在平滑重载侧边栏…`;
    } else if (hasUpdate) {
      const sizeStr = up.assetSize ? ` (${formatBytes(up.assetSize)})` : "";
      el.updateStatusText.textContent = `发现新版本 v${String(up.latestVersion).replace(/^v/i, "")}${sizeStr}，点击右侧一键更新并重载`;
    } else if (up.checkedAt) {
      el.updateStatusText.textContent = `已是最新版本（检测于 ${new Date(up.checkedAt).toLocaleTimeString()}）`;
    }

    const notes = typeof up.releaseNotes === "string" ? up.releaseNotes.trim() : "";
    const relUrl = typeof up.releaseUrl === "string" && /^https:\/\/github\.com\//i.test(up.releaseUrl) ? up.releaseUrl : "";
    if (el.updateNotesBox) {
      el.updateNotesBox.classList.toggle("hidden", !notes && !relUrl);
    }
    if (el.updateNotesText) {
      renderMarkdownNotes(
        el.updateNotesText,
        notes || (relUrl ? "点击下方链接查看本版本详细更新日志。" : "")
      );
    }
    if (el.updateReleaseLink) {
      if (relUrl) {
        el.updateReleaseLink.href = relUrl;
        el.updateReleaseLink.classList.remove("hidden");
      } else {
        el.updateReleaseLink.classList.add("hidden");
      }
    }
  }

  function renderState(state) {
    latestState = state;
    const s = state.settings;
    const media = state.activeMedia || {};
    const host = state.status || {};

    syncPanelOwnTheme(s, state);
    setError(state.wallpaperError || "");

    setSwitchState(el.chkSkinEnabled, Boolean(s.enabled));
    if (host.applied) {
      el.hostDot.className = "ss-dot ok";
      el.hostStatusLabel.textContent = "皮肤已生效";
    } else if (host.connected) {
      el.hostDot.className = "ss-dot warn";
      el.hostStatusLabel.textContent = "已连接宿主";
    } else {
      el.hostDot.className = "ss-dot";
      el.hostStatusLabel.textContent = "未连接";
    }
    el.hostStatusDetail.textContent = host.message || "等待检测 Antigravity";
    if (el.cdpWarnBanner) {
      el.cdpWarnBanner.classList.toggle("hidden", Boolean(host.connected));
    }

    for (const btn of el.outputModeBtns) {
      btn.classList.toggle("active", btn.dataset.outputMode === s.outputMode);
    }
    for (const btn of el.fitBtns) {
      btn.classList.toggle("active", btn.dataset.fit === s.fit);
    }

    el.activeMediaBadge.textContent =
      s.mediaType === "video" ? "MP4 / 视频" : s.mediaType === "image" ? "自定义图片" : "内置预设";
    el.activeMediaName.textContent = media.mediaName || state.wallpaper || "Gemini 角色立绘预设";
    el.btnSelectPreset.classList.toggle("hidden", s.mediaType === "preset");
    if (document.activeElement !== el.inputMediaPath) {
      el.inputMediaPath.value = s.mediaType === "preset" ? "" : s.customMediaPath || "";
    }

    const showVideo = s.mediaType === "video" || media.mediaKind === "video";
    el.videoControls.classList.toggle("hidden", !showVideo);
    setSwitchState(el.chkVideoMuted, s.videoMuted !== false);
    setSwitchState(el.chkVideoSmoothMode, s.videoSmoothMode !== false);
    el.btnVideoPause.textContent = s.videoPaused ? "继续" : "暂停";
    el.selPlaybackRate.value = String(s.videoPlaybackRate ?? 1);

    const chatWidth = Math.round(Number(s.chatWidth || 0));
    for (const btn of el.chatWidthBtns) {
      const target = Number(btn.dataset.chatWidth);
      btn.classList.toggle("active", chatWidth < 45 ? target === 0 : chatWidth === target);
    }
    if (!isInteracting) {
      el.rngChatWidth.value = String(chatWidth >= 45 ? chatWidth : 60);
      el.rngOpacity.value = String(s.opacity);
      el.rngScrim.value = String(s.scrim);
      el.rngZoom.value = String(s.zoom);
    }
    el.valChatWidth.textContent = chatWidth >= 45 ? chatWidth + "%" : "官方";
    el.valOpacity.textContent = Math.round(s.opacity) + "%";
    el.valScrim.textContent = Math.round(s.scrim) + "%";
    el.valZoom.textContent = Number(s.zoom).toFixed(2) + "x";

    renderRecentChips(state);
    updatePreviewMedia(state);
    renderGlassControls(s);
    renderFontControls(s);
    renderFeatureControls(state);
  }

  // ── 遥测轻量用量卡加载 ──
  async function loadUsageCard() {
    try {
      const data = await requestJson(`/api/maomao/usage?range=${encodeURIComponent(currentUsageRange)}`, "GET");
      el.kpiTotalTokens.textContent = formatCompactNumber(data.totalTokens || 0);
      el.kpiCacheHit.textContent =
        typeof data.cacheHitPercent === "number" ? `${Math.round(data.cacheHitPercent)}%` : "—";
      const reqCount = Number(data.totalRequests || 0);
      const anomalyCount = Array.isArray(data.cacheAnomalies) ? data.cacheAnomalies.length : 0;
      el.kpiRequests.textContent = anomalyCount > 0 ? `${reqCount} / ${anomalyCount}⚠` : String(reqCount);
      el.kpiCacheSize.textContent = formatBytes(data.cacheStats?.totalBytes || data.cacheSizeBytes || 0);

      const costText = typeof data.costUsd === "number" && data.costUsd > 0 ? `参考估值 $${data.costUsd.toFixed(2)}` : "本机只读遥测";
      el.usageSummarySub.textContent = `${costText} · ${data.cacheStats?.fileCount || 0} 个轨迹文件`;
    } catch {
      el.usageSummarySub.textContent = "遥测服务暂未就绪，等待会话数据…";
    }
  }

  // ── 系统维护状态加载 ──
  async function loadSystemMaint() {
    try {
      const [sys, batches] = await Promise.all([
        requestJson("/api/maomao/system/status", "GET"),
        requestJson("/api/maomao/archive/batches", "GET"),
      ]);
      if (sys?.debugPort) {
        const dp = sys.debugPort;
        const sc = dp.shortcuts || {};
        el.debugPortStatus.textContent = dp.ready
          ? `调试端口已就绪 (:${dp.port}) · 快捷方式 ${sc.configured || 0}/${sc.total || 0}`
          : sc.total
            ? `调试端口未连接 · 快捷方式 ${sc.configured || 0}/${sc.total || 0} 已含调试参数`
            : "暂未检测到活动调试端口，点击修复快捷方式或调试重启";
      }
      if (sys?.gomemlimit) {
        const curVal = sys.gomemlimit.value || "";
        el.selGomemlimit.value = curVal;
        el.gomemlimitStatus.textContent = curVal
          ? `当前已设置 GOMEMLIMIT=${curVal}（重启 Antigravity 生效）`
          : "当前未限制（使用 Go 默认策略）";
      }
      renderArchiveBatches(batches?.batches || []);
    } catch {}
  }

  function renderArchiveBatches(batches) {
    el.archiveBatchList.replaceChildren();
    if (!Array.isArray(batches) || !batches.length) {
      el.archiveBatchList.classList.add("hidden");
      return;
    }
    el.archiveBatchList.classList.remove("hidden");
    for (const b of batches.slice(0, 6)) {
      const item = document.createElement("div");
      item.className = "ss-batch-item";
      const info = document.createElement("span");
      const count = b.itemCount ?? b.count ?? 0;
      const statusText = b.restorable === false ? "（已还原）" : "";
      info.textContent = `${b.batchId} · ${count} 个会话 (${formatBytes(b.totalBytes || 0)})${statusText}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ss-btn ss-btn-sm";
      btn.textContent = b.restorable === false ? "已还原" : "还原";
      btn.disabled = b.restorable === false;
      btn.addEventListener("click", async () => {
        try {
          setError("");
          const res = await requestJson("/api/maomao/archive/restore", "POST", { batchId: b.batchId });
          if (res.ok === false) {
            setError(res.message || res.error || "还原失败");
          } else {
            showToast(res.message || `已无损还原批次 ${b.batchId}`);
            loadSystemMaint();
          }
        } catch (err) {
          setError(err.message);
        }
      });
      item.append(info, btn);
      el.archiveBatchList.appendChild(item);
    }
  }

  async function fetchState() {
    try {
      const next = await requestJson("/api/state", "GET");
      renderState(next);
    } catch (error) {
      setError(error.message);
    }
  }

  // ── 通用事件绑定 ──
  for (const tab of el.tabs) {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  }

  el.btnRefresh.addEventListener("click", async () => {
    try {
      setError("");
      renderState(await requestJson("/api/refresh", "POST", {}));
      if (currentTab === "telemetry") loadUsageCard();
      if (currentTab === "enhance") loadSystemMaint();
    } catch (error) {
      setError(error.message);
    }
  });

  // 导出/导入脱敏 JSON 配置
  el.btnExportConfig.addEventListener("click", async () => {
    try {
      setError("");
      const data = await requestJson("/api/maomao/config/export", "GET");
      const blob = new Blob([JSON.stringify(data, null, 2) + "\n"], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "miaoyan-settings.json";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast("已导出脱敏 JSON 配置（API Key 已清除）");
    } catch (error) {
      setError(error.message);
    }
  });

  el.btnImportConfig.addEventListener("click", () => el.inputImportConfig.click());
  el.inputImportConfig.addEventListener("change", async () => {
    const file = el.inputImportConfig.files?.[0];
    el.inputImportConfig.value = "";
    if (!file) return;
    try {
      setError("");
      const raw = await file.text();
      const parsed = JSON.parse(raw);
      const payload = parsed?.settings && typeof parsed.settings === "object" ? parsed.settings : parsed;
      const next = await requestJson("/api/settings", "POST", payload);
      renderState(next);
      showToast("配置导入成功并已生效");
    } catch (error) {
      setError("导入配置失败：" + error.message);
    }
  });

  const bindRelaunch = (btn) => {
    if (!btn) return;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = "正在重启…";
      try {
        setError("");
        const res = await requestJson("/api/relaunch-host", "POST", {});
        if (res && res.ok === false) {
          setError(res.error || "重启失败");
          btn.disabled = false;
          btn.textContent = oldText;
        }
      } catch (error) {
        setError(error.message);
        btn.disabled = false;
        btn.textContent = oldText;
      }
    });
  };
  bindRelaunch(el.btnRelaunchHost);
  bindRelaunch(el.btnRelaunchHostEnh);

  el.chkSkinEnabled.addEventListener("click", () => {
    const next = !isSwitchChecked(el.chkSkinEnabled);
    setSwitchState(el.chkSkinEnabled, next);
    saveSettings({ enabled: next });
  });

  for (const btn of el.outputModeBtns) {
    btn.addEventListener("click", () => saveSettings({ outputMode: btn.dataset.outputMode }));
  }
  for (const btn of el.fitBtns) {
    btn.addEventListener("click", () => saveSettings({ fit: btn.dataset.fit }));
  }

  el.btnPickMedia.addEventListener("click", async () => {
    el.btnPickMedia.disabled = true;
    try {
      setError("");
      const res = await requestJson("/api/pick-media", "POST", {});
      if (res.state) renderState(res.state);
    } catch (error) {
      setError(error.message);
    } finally {
      el.btnPickMedia.disabled = false;
    }
  });

  el.btnSelectPreset.addEventListener("click", async () => {
    try {
      setError("");
      renderState(await requestJson("/api/select-media", "POST", { mediaType: "preset" }));
    } catch (error) {
      setError(error.message);
    }
  });

  el.pathForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const target = el.inputMediaPath.value.trim();
    if (!target) return;
    try {
      setError("");
      renderState(await requestJson("/api/select-media", "POST", { path: target }));
    } catch (error) {
      setError(error.message);
    }
  });

  el.chkVideoMuted.addEventListener("click", () => {
    const next = !isSwitchChecked(el.chkVideoMuted);
    setSwitchState(el.chkVideoMuted, next);
    saveSettings({ videoMuted: next });
  });
  el.chkVideoSmoothMode.addEventListener("click", () => {
    const next = !isSwitchChecked(el.chkVideoSmoothMode);
    setSwitchState(el.chkVideoSmoothMode, next);
    saveSettings({ videoSmoothMode: next });
  });
  el.btnVideoPause.addEventListener("click", () => saveSettings({ videoPaused: !latestState?.settings?.videoPaused }));
  el.selPlaybackRate.addEventListener("change", () => saveSettings({ videoPlaybackRate: Number(el.selPlaybackRate.value) }));
  el.btnResetCamera.addEventListener("click", () => saveSettings({ positionX: 50, positionY: 50, zoom: 1 }));

  for (const btn of el.chatWidthBtns) {
    btn.addEventListener("click", () => saveSettings({ chatWidth: Number(btn.dataset.chatWidth) }));
  }
  el.rngChatWidth.addEventListener("pointerdown", () => { isInteracting = true; });
  el.rngChatWidth.addEventListener("input", () => {
    el.valChatWidth.textContent = Math.round(Number(el.rngChatWidth.value)) + "%";
  });
  el.rngChatWidth.addEventListener("change", () => {
    isInteracting = false;
    saveSettings({ chatWidth: Math.round(Number(el.rngChatWidth.value)) });
  });

  for (const [input, key, fmt, output] of [
    [el.rngOpacity, "opacity", (v) => `${Math.round(v)}%`, el.valOpacity],
    [el.rngScrim, "scrim", (v) => `${Math.round(v)}%`, el.valScrim],
    [el.rngZoom, "zoom", (v) => `${Number(v).toFixed(2)}x`, el.valZoom],
  ]) {
    input.addEventListener("pointerdown", () => { isInteracting = true; });
    input.addEventListener("input", () => {
      const v = Number(input.value);
      output.textContent = fmt(v);
      if (latestState) {
        latestState.settings[key] = v;
        updatePreviewMedia(latestState);
      }
    });
    input.addEventListener("change", () => {
      isInteracting = false;
      saveSettings({ [key]: Number(input.value) });
    });
  }

  for (const btn of el.themeStyleBtns) {
    btn.addEventListener("click", () => saveSettings({ glass: { themeStyle: btn.dataset.themeStyle } }));
  }

  for (const btn of el.glassPresetBtns) {
    btn.addEventListener("click", () => {
      const shape = GLASS_PRESETS[btn.dataset.glassPreset];
      if (!shape) return;
      const regions = Object.fromEntries(
        Object.entries(shape).map(([k, [fill, blur]]) => [k, { fill, blur }])
      );
      saveSettings({ glass: { regions } });
    });
  }

  el.rngGlassVeil.addEventListener("pointerdown", () => { isInteracting = true; });
  el.rngGlassVeil.addEventListener("input", () => {
    const v = Number(el.rngGlassVeil.value);
    el.valGlassVeil.textContent = v > 0 ? v + "%" : "自动";
  });
  el.rngGlassVeil.addEventListener("change", () => {
    isInteracting = false;
    saveSettings({ glass: { veil: Number(el.rngGlassVeil.value) } });
  });

  el.rngGlassRadius.addEventListener("pointerdown", () => { isInteracting = true; });
  el.rngGlassRadius.addEventListener("input", () => {
    const v = Number(el.rngGlassRadius.value);
    el.valGlassRadius.textContent = v + "px";
    document.documentElement.style.setProperty("--ss-radius", v + "px");
  });
  el.rngGlassRadius.addEventListener("change", () => {
    isInteracting = false;
    saveSettings({ glass: { radius: Number(el.rngGlassRadius.value) } });
  });

  for (const btn of el.fontDarkBtns) {
    btn.addEventListener("click", () => {
      closeFontPicker();
      saveSettings({ font: { darkSeparate: btn.dataset.darkSep === "true" } });
    });
  }

  // 通用特性开关按钮与选项绑定
  for (const btn of el.featureToggles) {
    btn.addEventListener("click", () => {
      const next = !isSwitchChecked(btn);
      setSwitchState(btn, next);
      saveSettings(buildFeaturePatch(btn.dataset.fkey, next));
    });
  }
  for (const btn of el.featureOptionBtns) {
    btn.addEventListener("click", () => {
      saveSettings(buildFeaturePatch(btn.dataset.fopt, btn.dataset.val));
    });
  }

  // Tab 3: 遥测按钮
  for (const btn of el.usageRangeBtns) {
    btn.addEventListener("click", () => {
      currentUsageRange = btn.dataset.usageRange;
      for (const b of el.usageRangeBtns) b.classList.toggle("active", b === btn);
      loadUsageCard();
    });
  }
  el.btnRefreshUsage.addEventListener("click", () => loadUsageCard());

  // Tab 4: 内置猫宠滑块与测试按钮
  for (const [input, out, key] of [
    [el.rngPetScale, el.valPetScale, "scale"],
    [el.rngPetOpacity, el.valPetOpacity, "opacity"],
    [el.rngPetVolume, el.valPetVolume, "volume"],
  ]) {
    input.addEventListener("pointerdown", () => { isInteracting = true; });
    input.addEventListener("input", () => {
      out.textContent = input.value + "%";
    });
    input.addEventListener("change", () => {
      isInteracting = false;
      saveSettings({ features: { embeddedPet: { [key]: Number(input.value) } } });
    });
  }

  el.selPetSoundPack.addEventListener("change", () => {
    saveSettings({ features: { embeddedPet: { soundPack: el.selPetSoundPack.value } } });
  });

  el.btnPokePet.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/maomao/pet-poke", "POST", { kind: "petting" });
      if (res.ok) showToast(res.line ? `猫猫说：「${res.line}」` : "已戳一下内置猫娘～");
      else setError(res.error || "内置猫娘尚未挂载到宿主窗口");
    } catch (err) {
      setError(err.message);
    }
  });

  // Tab 5: 思考翻译保存 & 系统维护
  el.btnSaveThoughtCfg.addEventListener("click", () => {
    saveSettings({
      features: {
        workbench: {
          thoughtEndpoint: el.inputThoughtEndpoint.value.trim(),
          thoughtModel: el.inputThoughtModel.value.trim(),
          thoughtApiKey: el.inputThoughtApiKey.value.trim(),
        },
      },
    });
    showToast("思考翻译端点配置已保存");
  });

  el.btnEnsureDebugPort.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/maomao/system/ensure-debug-port", "POST", {});
      el.debugPortStatus.textContent = res.message || (res.ok ? "快捷方式已修复" : "修复未完成");
      if (res.ok) showToast("快捷方式调试参数校验/修复完成");
      else setError(res.error || res.message || "快捷方式修复失败");
    } catch (err) {
      setError(err.message);
    }
  });

  el.btnScanArchive.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/maomao/archive/scan", "GET");
      const items = Array.isArray(res.items) ? res.items : [];
      scannedArchivableIds = items.map((x) => x.id).filter(Boolean);
      el.btnRunArchive.disabled = scannedArchivableIds.length === 0;
      el.archiveSummary.textContent = scannedArchivableIds.length
        ? `发现 ${scannedArchivableIds.length} 个隐藏子代理轨迹（约 ${formatBytes(res.totalBytes || 0)}），点击右侧无损归档`
        : "当前没有需要归档的隐藏子代理轨迹";
    } catch (err) {
      setError(err.message);
    }
  });

  el.btnRunArchive.addEventListener("click", async () => {
    if (!scannedArchivableIds.length) return;
    try {
      setError("");
      const res = await requestJson("/api/maomao/archive/run", "POST", { ids: scannedArchivableIds });
      if (res.ok === false) {
        setError(res.message || res.error || "归档被阻止");
      } else {
        scannedArchivableIds = [];
        el.btnRunArchive.disabled = true;
        showToast(res.message || `已无损归档 ${res.archivedCount || 0} 个子代理轨迹`);
        loadSystemMaint();
      }
    } catch (err) {
      setError(err.message);
    }
  });

  el.btnApplyGomemlimit.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/maomao/system/gomemlimit", "POST", {
        preset: el.selGomemlimit.value,
      });
      if (res.ok === false) setError(res.error || "设置失败");
      else {
        showToast(res.message || "GOMEMLIMIT 设置已更新");
        loadSystemMaint();
      }
    } catch (err) {
      setError(err.message);
    }
  });

  el.btnStopLegacyWidget.addEventListener("click", async () => {
    try {
      setError("");
      const res = await requestJson("/api/widget", "POST", { action: "quit" });
      if (res.state) renderState(res.state);
      showToast("已发送关闭遗留独立挂件信号");
      setTimeout(fetchState, 900);
    } catch (err) {
      setError(err.message);
    }
  });

  el.pluginVersionPill?.addEventListener("click", () => {
    switchTab("enhance");
    el.pluginUpdateCard?.scrollIntoView({ behavior: "smooth", block: "center" });
  });

  const runI18nReload = async (syncRemote) => {
    const btn = syncRemote ? el.btnSyncReloadI18n : el.btnReloadI18n;
    const oldText = btn?.textContent || "";
    if (btn) {
      btn.disabled = true;
      btn.textContent = syncRemote ? "同步重载中…" : "重载中…";
    }
    try {
      setError("");
      const res = await requestJson("/api/i18n/reload", "POST", { syncRemote, forceReinject: false });
      if (res.state) renderState(res.state);
      const swInfo = res.swarmFramesReloaded ? `，Swarm 面板 ${res.swarmFramesReloaded} 个` : "";
      showToast(`汉化重载完成（覆盖词条 ${res.overrideCount || 0} 条${swInfo}）`);
    } catch (err) {
      setError("汉化重载失败：" + err.message);
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = oldText;
      }
    }
  };
  el.btnReloadI18n?.addEventListener("click", () => runI18nReload(false));
  el.btnSyncReloadI18n?.addEventListener("click", () => runI18nReload(true));

  el.btnCheckUpdate?.addEventListener("click", async () => {
    el.btnCheckUpdate.disabled = true;
    const oldText = el.btnCheckUpdate.textContent;
    el.btnCheckUpdate.textContent = "检测中…";
    try {
      setError("");
      const res = await requestJson("/api/update/check?force=1", "GET");
      renderUpdateStatus(res);
      if (res.ok && res.hasUpdate) showToast(`发现新版本 v${String(res.latestVersion).replace(/^v/i, "")}`);
      else if (res.ok) showToast("当前已是最新版本");
      else setError(res.error || "检查更新失败");
    } catch (err) {
      setError("检查更新失败：" + err.message);
    } finally {
      el.btnCheckUpdate.disabled = false;
      el.btnCheckUpdate.textContent = oldText;
    }
  });

  el.btnApplyUpdate?.addEventListener("click", async () => {
    el.btnApplyUpdate.disabled = true;
    el.btnApplyUpdate.textContent = "下载安装中…";
    try {
      setError("");
      const res = await requestJson("/api/update/apply", "POST", {});
      if (res.updateStatus) renderUpdateStatus(res.updateStatus);
      if (res.ok === false) {
        setError(res.error || "更新失败");
      } else {
        showToast(`更新至 v${String(res.toVersion || "").replace(/^v/i, "")} 成功，正在自动重载插件…`);
        setTimeout(fetchState, 2200);
      }
    } catch (err) {
      setError("更新失败：" + err.message);
    } finally {
      el.btnApplyUpdate.disabled = false;
    }
  });

  // 预览图焦点拖拽
  el.previewStage.addEventListener("pointerdown", (event) => {
    if (!latestState) return;
    isInteracting = true;
    el.previewStage.setPointerCapture(event.pointerId);
    dragging = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseX: latestState.settings.positionX,
      baseY: latestState.settings.positionY,
    };
  });

  el.previewStage.addEventListener("pointermove", (event) => {
    if (!dragging || !latestState) return;
    const rect = el.previewStage.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const dxPct = ((event.clientX - dragging.startX) / rect.width) * 100;
    const dyPct = ((event.clientY - dragging.startY) / rect.height) * 100;
    latestState.settings.positionX = Math.max(0, Math.min(100, dragging.baseX - dxPct));
    latestState.settings.positionY = Math.max(0, Math.min(100, dragging.baseY - dyPct));
    updatePreviewMedia(latestState);
  });

  const endDrag = () => {
    if (!dragging || !latestState) return;
    dragging = null;
    isInteracting = false;
    saveSettings({
      positionX: Math.round(latestState.settings.positionX * 10) / 10,
      positionY: Math.round(latestState.settings.positionY * 10) / 10,
    });
  };
  el.previewStage.addEventListener("pointerup", endDrag);
  el.previewStage.addEventListener("pointercancel", endDrag);

  // 实时响应宿主 theme-change postMessage 与系统亮暗切换
  const resyncSurface = () => {
    if (latestState?.settings) syncPanelOwnTheme(latestState.settings, latestState);
    else syncPanelOwnTheme({}, null);
  };
  window.addEventListener("message", (event) => {
    if (event.data?.type === "theme-change") {
      setTimeout(resyncSurface, 0);
    }
  });
  try {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    mq?.addEventListener?.("change", resyncSurface);
  } catch {}
  try {
    const themeObs = new MutationObserver(resyncSurface);
    themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
  } catch {}

  resyncSurface();
  fetchState();
  window.addEventListener("focus", () => {
    if (!dragging && !isInteracting) fetchState();
  });
  setInterval(() => {
    if (!document.hidden && !dragging && !isInteracting) {
      fetchState();
      if (currentTab === "telemetry") loadUsageCard();
    }
  }, 4000);
})();
