const os = require("node:os");
const path = require("node:path");
const { readJson, writeJson, finite, bool } = require("../../../shared/storage.cjs");

const GLASS_REGION_KEYS = ["sidebar", "content", "overlay", "control", "header", "bar"];

const DEFAULT_GLASS = {
  themeStyle: "star-neko",
  tint: "#ffffff",
  veil: 0,
  radius: 16,
  regions: {
    sidebar: { fill: 78, blur: 18 },
    content: { fill: 60, blur: 22 },
    overlay: { fill: 68, blur: 24 },
    control: { fill: 72, blur: 14 },
    header: { fill: 84, blur: 14 },
    bar: { fill: 80, blur: 14 },
  },
};

const FONT_ROLE_KEYS = ["main", "secondary", "muted", "faint"];

const DEFAULT_FONT = {
  accent: "",
  darkSeparate: false,
  colors: { main: "", secondary: "", muted: "", faint: "" },
  colorsDark: { main: "", secondary: "", muted: "", faint: "" },
};

const FEATURE_KEYS = [
  "telemetry",
  "effortSlider",
  "composerBeam",
  "embeddedPet",
  "motionFx",
  "i18n",
  "workbench",
];

const DEFAULT_FEATURES = {
  telemetry: {
    enabled: true,
    barMode: "auto",
    vialEnabled: true,
    vialStyle: "vial",
    quotaEnabled: true,
  },
  effortSlider: {
    enabled: true,
    rememberPerModel: true,
    crystalOrchestrator: true,
  },
  composerBeam: {
    enabled: false,
    palette: "star-neko",
    quotaHalo: false,
  },
  embeddedPet: {
    enabled: true,
    scale: 100,
    dock: "right",
    snap: true,
    opacity: 100,
    soundEnabled: true,
    soundPack: "original",
    volume: 60,
    showBubbles: true,
    hideWhenZen: true,
  },
  motionFx: {
    inkStreamFade: true,
    semanticAura: true,
    smoothCaret: false,
    unreadBadge: true,
  },
  i18n: {
    mode: "auto",
    swarmEnabled: true,
  },
  workbench: {
    codeFold: true,
    contextMenu: true,
    inlineDiff: true,
    fullTextSearch: true,
    compactLayout: false,
    thoughtTranslate: "off",
    thoughtView: "immersive",
    thoughtEndpoint: "",
    thoughtModel: "",
    thoughtApiKey: "",
  },
};

const VALID_BAR_MODES = new Set(["auto", "icons", "full", "off"]);
const VALID_VIAL_STYLES = new Set(["vial", "bar"]);
const VALID_BEAM_PALETTES = new Set(["star-neko", "gemini", "aurora", "prism", "neon", "quota"]);
const VALID_PET_DOCKS = new Set(["right", "left", "free"]);
const VALID_SOUND_PACKS = new Set(["original", "bubble-pop", "wood-tap", "soft-spring", "interaction"]);
const VALID_I18N_MODES = new Set(["auto", "on", "off"]);
const VALID_THOUGHT_TRANSLATE = new Set(["off", "machine", "openai"]);
const VALID_THOUGHT_VIEW = new Set(["immersive", "bilingual"]);

const DEFAULT_SETTINGS = {
  enabled: false,
  outputMode: "transparent",
  positionX: 50,
  positionY: 50,
  zoom: 1,
  fit: "adaptive",
  scrim: 12,
  opacity: 55,
  wallpaperId: "gemini-character-sheet-v1",
  mediaType: "preset",
  customMediaPath: "",
  recentMedia: [],
  videoMuted: true,
  videoPlaybackRate: 1,
  videoPaused: false,
  videoSmoothMode: true,
  chatWidth: 0,
  widgetAutoLaunch: false,
  widgetHideTray: true,
  glass: DEFAULT_GLASS,
  font: DEFAULT_FONT,
  features: DEFAULT_FEATURES,
  protectEditor: true,
  protectTerminal: true,
};

const VALID_MEDIA_TYPES = new Set(["preset", "image", "video"]);

function sanitizePath(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096 || /[\r\n\0]/.test(trimmed)) return "";
  return trimmed;
}

function sanitizeLineString(value, maxLen = 512, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  if (!trimmed) return "";
  if (trimmed.length > maxLen || /[\r\n\0]/.test(trimmed)) return fallback;
  return trimmed;
}

function sanitizeEnum(value, validSet, fallback) {
  return typeof value === "string" && validSet.has(value) ? value : fallback;
}

function sanitizeRecentMedia(list) {
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const clean = sanitizePath(item);
    if (!clean) continue;
    const key = process.platform === "win32" ? clean.toLowerCase() : clean;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
    if (out.length >= 8) break;
  }
  return out;
}

function sanitizeHexColor(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  return match ? `#${match[1].toLowerCase()}` : fallback;
}

function sanitizeGlass(raw, current = DEFAULT_GLASS) {
  const src = raw && typeof raw === "object" ? raw : {};
  const srcRegions = src.regions && typeof src.regions === "object" ? src.regions : {};
  const curRegions = current?.regions || DEFAULT_GLASS.regions;
  const regions = {};
  for (const key of GLASS_REGION_KEYS) {
    const def = curRegions[key] || DEFAULT_GLASS.regions[key];
    const part = srcRegions[key] && typeof srcRegions[key] === "object" ? srcRegions[key] : {};
    regions[key] = {
      fill: Math.round(finite(part.fill, def.fill, 0, 100)),
      blur: Math.round(finite(part.blur, def.blur, 0, 40)),
    };
  }
  return {
    themeStyle:
      "themeStyle" in src
        ? src.themeStyle === "official"
          ? "official"
          : "star-neko"
        : current?.themeStyle === "official"
          ? "official"
          : "star-neko",
    tint:
      "tint" in src
        ? sanitizeHexColor(src.tint, "")
        : sanitizeHexColor(current?.tint, DEFAULT_GLASS.tint),
    veil: Math.round(finite(src.veil, current?.veil ?? DEFAULT_GLASS.veil, 0, 95)),
    radius: Math.round(finite(src.radius, current?.radius ?? DEFAULT_GLASS.radius, 8, 24)),
    regions,
  };
}

function sanitizeFontRoleMap(raw, fallback) {
  const src = raw && typeof raw === "object" ? raw : {};
  const out = {};
  for (const key of FONT_ROLE_KEYS) {
    out[key] = key in src ? sanitizeHexColor(src[key], "") : sanitizeHexColor(fallback?.[key], "");
  }
  return out;
}

function sanitizeFont(raw, current = DEFAULT_FONT) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    accent:
      "accent" in src
        ? sanitizeHexColor(src.accent, "")
        : sanitizeHexColor(current?.accent, ""),
    darkSeparate: bool(src.darkSeparate, Boolean(current?.darkSeparate)),
    colors: sanitizeFontRoleMap(src.colors, current?.colors || DEFAULT_FONT.colors),
    colorsDark: sanitizeFontRoleMap(src.colorsDark, current?.colorsDark || DEFAULT_FONT.colorsDark),
  };
}

function sanitizeFeatures(raw, current = DEFAULT_FEATURES) {
  const src = raw && typeof raw === "object" ? raw : {};
  const cur = current && typeof current === "object" ? current : DEFAULT_FEATURES;

  const tSrc = src.telemetry && typeof src.telemetry === "object" ? src.telemetry : {};
  const tCur = cur.telemetry || DEFAULT_FEATURES.telemetry;

  const eSrc = src.effortSlider && typeof src.effortSlider === "object" ? src.effortSlider : {};
  const eCur = cur.effortSlider || DEFAULT_FEATURES.effortSlider;

  const bSrc = src.composerBeam && typeof src.composerBeam === "object" ? src.composerBeam : {};
  const bCur = cur.composerBeam || DEFAULT_FEATURES.composerBeam;

  const pSrc = src.embeddedPet && typeof src.embeddedPet === "object" ? src.embeddedPet : {};
  const pCur = cur.embeddedPet || DEFAULT_FEATURES.embeddedPet;

  const mSrc = src.motionFx && typeof src.motionFx === "object" ? src.motionFx : {};
  const mCur = cur.motionFx || DEFAULT_FEATURES.motionFx;

  const iSrc = src.i18n && typeof src.i18n === "object" ? src.i18n : {};
  const iCur = cur.i18n || DEFAULT_FEATURES.i18n;

  const wSrc = src.workbench && typeof src.workbench === "object" ? src.workbench : {};
  const wCur = cur.workbench || DEFAULT_FEATURES.workbench;

  return {
    telemetry: {
      enabled: bool(tSrc.enabled, bool(tCur.enabled, DEFAULT_FEATURES.telemetry.enabled)),
      barMode: sanitizeEnum(tSrc.barMode, VALID_BAR_MODES, sanitizeEnum(tCur.barMode, VALID_BAR_MODES, DEFAULT_FEATURES.telemetry.barMode)),
      vialEnabled: bool(tSrc.vialEnabled, bool(tCur.vialEnabled, DEFAULT_FEATURES.telemetry.vialEnabled)),
      vialStyle: sanitizeEnum(tSrc.vialStyle, VALID_VIAL_STYLES, sanitizeEnum(tCur.vialStyle, VALID_VIAL_STYLES, DEFAULT_FEATURES.telemetry.vialStyle)),
      quotaEnabled: bool(tSrc.quotaEnabled, bool(tCur.quotaEnabled, DEFAULT_FEATURES.telemetry.quotaEnabled)),
    },
    effortSlider: {
      enabled: bool(eSrc.enabled, bool(eCur.enabled, DEFAULT_FEATURES.effortSlider.enabled)),
      rememberPerModel: bool(eSrc.rememberPerModel, bool(eCur.rememberPerModel, DEFAULT_FEATURES.effortSlider.rememberPerModel)),
      crystalOrchestrator: bool(eSrc.crystalOrchestrator, bool(eCur.crystalOrchestrator, DEFAULT_FEATURES.effortSlider.crystalOrchestrator)),
    },
    composerBeam: {
      enabled: bool(bSrc.enabled, bool(bCur.enabled, DEFAULT_FEATURES.composerBeam.enabled)),
      palette: sanitizeEnum(bSrc.palette, VALID_BEAM_PALETTES, sanitizeEnum(bCur.palette, VALID_BEAM_PALETTES, DEFAULT_FEATURES.composerBeam.palette)),
      quotaHalo: bool(bSrc.quotaHalo, bool(bCur.quotaHalo, DEFAULT_FEATURES.composerBeam.quotaHalo)),
    },
    embeddedPet: {
      enabled: bool(pSrc.enabled, bool(pCur.enabled, DEFAULT_FEATURES.embeddedPet.enabled)),
      scale: Math.round(finite(pSrc.scale, finite(pCur.scale, DEFAULT_FEATURES.embeddedPet.scale, 60, 160), 60, 160)),
      dock: sanitizeEnum(pSrc.dock, VALID_PET_DOCKS, sanitizeEnum(pCur.dock, VALID_PET_DOCKS, DEFAULT_FEATURES.embeddedPet.dock)),
      snap: bool(pSrc.snap, bool(pCur.snap, DEFAULT_FEATURES.embeddedPet.snap)),
      opacity: Math.round(finite(pSrc.opacity, finite(pCur.opacity, DEFAULT_FEATURES.embeddedPet.opacity, 20, 100), 20, 100)),
      soundEnabled: bool(pSrc.soundEnabled, bool(pCur.soundEnabled, DEFAULT_FEATURES.embeddedPet.soundEnabled)),
      soundPack: sanitizeEnum(pSrc.soundPack, VALID_SOUND_PACKS, sanitizeEnum(pCur.soundPack, VALID_SOUND_PACKS, DEFAULT_FEATURES.embeddedPet.soundPack)),
      volume: Math.round(finite(pSrc.volume, finite(pCur.volume, DEFAULT_FEATURES.embeddedPet.volume, 0, 100), 0, 100)),
      showBubbles: bool(pSrc.showBubbles, bool(pCur.showBubbles, DEFAULT_FEATURES.embeddedPet.showBubbles)),
      hideWhenZen: bool(pSrc.hideWhenZen, bool(pCur.hideWhenZen, DEFAULT_FEATURES.embeddedPet.hideWhenZen)),
    },
    motionFx: {
      inkStreamFade: bool(mSrc.inkStreamFade, bool(mCur.inkStreamFade, DEFAULT_FEATURES.motionFx.inkStreamFade)),
      semanticAura: bool(mSrc.semanticAura, bool(mCur.semanticAura, DEFAULT_FEATURES.motionFx.semanticAura)),
      smoothCaret: bool(mSrc.smoothCaret, bool(mCur.smoothCaret, DEFAULT_FEATURES.motionFx.smoothCaret)),
      unreadBadge: bool(mSrc.unreadBadge, bool(mCur.unreadBadge, DEFAULT_FEATURES.motionFx.unreadBadge)),
    },
    i18n: {
      mode: sanitizeEnum(iSrc.mode, VALID_I18N_MODES, sanitizeEnum(iCur.mode, VALID_I18N_MODES, DEFAULT_FEATURES.i18n.mode)),
      swarmEnabled: bool(iSrc.swarmEnabled, bool(iCur.swarmEnabled, DEFAULT_FEATURES.i18n.swarmEnabled)),
    },
    workbench: {
      codeFold: bool(wSrc.codeFold, bool(wCur.codeFold, DEFAULT_FEATURES.workbench.codeFold)),
      contextMenu: bool(wSrc.contextMenu, bool(wCur.contextMenu, DEFAULT_FEATURES.workbench.contextMenu)),
      inlineDiff: bool(wSrc.inlineDiff, bool(wCur.inlineDiff, DEFAULT_FEATURES.workbench.inlineDiff)),
      fullTextSearch: bool(wSrc.fullTextSearch, bool(wCur.fullTextSearch, DEFAULT_FEATURES.workbench.fullTextSearch)),
      compactLayout: bool(wSrc.compactLayout, bool(wCur.compactLayout, DEFAULT_FEATURES.workbench.compactLayout)),
      thoughtTranslate: sanitizeEnum(wSrc.thoughtTranslate, VALID_THOUGHT_TRANSLATE, sanitizeEnum(wCur.thoughtTranslate, VALID_THOUGHT_TRANSLATE, DEFAULT_FEATURES.workbench.thoughtTranslate)),
      thoughtView: sanitizeEnum(wSrc.thoughtView, VALID_THOUGHT_VIEW, sanitizeEnum(wCur.thoughtView, VALID_THOUGHT_VIEW, DEFAULT_FEATURES.workbench.thoughtView)),
      thoughtEndpoint:
        "thoughtEndpoint" in wSrc
          ? sanitizeLineString(wSrc.thoughtEndpoint, 1024, "")
          : sanitizeLineString(wCur.thoughtEndpoint, 1024, ""),
      thoughtModel:
        "thoughtModel" in wSrc
          ? sanitizeLineString(wSrc.thoughtModel, 256, "")
          : sanitizeLineString(wCur.thoughtModel, 256, ""),
      thoughtApiKey:
        "thoughtApiKey" in wSrc
          ? sanitizeLineString(wSrc.thoughtApiKey, 512, "")
          : sanitizeLineString(wCur.thoughtApiKey, 512, ""),
    },
  };
}

function cloneSettings(data) {
  return {
    ...data,
    recentMedia: [...data.recentMedia],
    glass: {
      themeStyle: data.glass.themeStyle,
      tint: data.glass.tint,
      veil: data.glass.veil,
      radius: data.glass.radius,
      regions: Object.fromEntries(
        GLASS_REGION_KEYS.map((k) => [k, { ...data.glass.regions[k] }])
      ),
    },
    font: {
      accent: data.font.accent,
      darkSeparate: data.font.darkSeparate,
      colors: { ...data.font.colors },
      colorsDark: { ...data.font.colorsDark },
    },
    features: {
      telemetry: { ...data.features.telemetry },
      effortSlider: { ...data.features.effortSlider },
      composerBeam: { ...data.features.composerBeam },
      embeddedPet: { ...data.features.embeddedPet },
      motionFx: { ...data.features.motionFx },
      i18n: { ...data.features.i18n },
      workbench: { ...data.features.workbench },
    },
  };
}

function redactSettings(data) {
  const cloned = cloneSettings(data);
  if (cloned.features?.workbench) {
    cloned.features.workbench.thoughtApiKey = "";
  }
  return cloned;
}

class DreamSkinSettings {
  constructor(file = path.join(os.homedir(), ".antigravity-dream-skin/settings.json")) {
    this.filePath = file;
    this.data = this.sanitize(readJson(file, DEFAULT_SETTINGS));
  }

  sanitize(v) {
    const raw = v && typeof v === "object" ? v : {};
    return {
      ...DEFAULT_SETTINGS,
      outputMode: raw.outputMode === "glass" ? "glass" : "transparent",
      enabled: bool(raw.enabled, false),
      positionX: finite(raw.positionX, 50, 0, 100),
      positionY: finite(raw.positionY, 50, 0, 100),
      zoom: finite(raw.zoom, 1, 1, 2),
      fit: ["cover", "contain", "adaptive"].includes(raw.fit) ? raw.fit : "adaptive",
      scrim: finite(raw.scrim, 12, 0, 60),
      opacity: finite(raw.opacity, 55, 0, 100),
      wallpaperId: sanitizeLineString(raw.wallpaperId, 128, DEFAULT_SETTINGS.wallpaperId) || DEFAULT_SETTINGS.wallpaperId,
      mediaType: VALID_MEDIA_TYPES.has(raw.mediaType) ? raw.mediaType : "preset",
      customMediaPath: sanitizePath(raw.customMediaPath),
      recentMedia: sanitizeRecentMedia(raw.recentMedia),
      videoMuted: bool(raw.videoMuted, true),
      videoPlaybackRate: finite(raw.videoPlaybackRate, 1, 0.25, 2),
      videoPaused: bool(raw.videoPaused, false),
      videoSmoothMode: bool(raw.videoSmoothMode, true),
      chatWidth: (() => {
        const w = Math.round(finite(raw.chatWidth, 0, 0, 100));
        return w === 0 ? 0 : Math.max(45, w);
      })(),
      widgetAutoLaunch: bool(raw.widgetAutoLaunch, false),
      widgetHideTray: bool(raw.widgetHideTray, true),
      glass: sanitizeGlass(raw.glass, DEFAULT_GLASS),
      font: sanitizeFont(raw.font, DEFAULT_FONT),
      features: sanitizeFeatures(raw.features, DEFAULT_FEATURES),
      protectEditor: true,
      protectTerminal: true,
    };
  }

  update(v) {
    const patch = v && typeof v === "object" ? v : {};
    const mergedGlass = patch.glass
      ? sanitizeGlass(
          {
            ...this.data.glass,
            ...patch.glass,
            regions: Object.fromEntries(
              GLASS_REGION_KEYS.map((k) => [
                k,
                {
                  ...this.data.glass.regions[k],
                  ...(patch.glass.regions?.[k] || {}),
                },
              ])
            ),
          },
          this.data.glass
        )
      : this.data.glass;

    const mergedFont = patch.font
      ? sanitizeFont(
          {
            ...this.data.font,
            ...patch.font,
            colors: { ...this.data.font.colors, ...(patch.font.colors || {}) },
            colorsDark: { ...this.data.font.colorsDark, ...(patch.font.colorsDark || {}) },
          },
          this.data.font
        )
      : this.data.font;

    const mergedFeatures =
      patch.features && typeof patch.features === "object"
        ? sanitizeFeatures(
            Object.fromEntries(
              FEATURE_KEYS.map((k) => [
                k,
                {
                  ...this.data.features[k],
                  ...(patch.features[k] && typeof patch.features[k] === "object" ? patch.features[k] : {}),
                },
              ])
            ),
            this.data.features
          )
        : this.data.features;

    this.data = this.sanitize({
      ...this.data,
      ...patch,
      glass: mergedGlass,
      font: mergedFont,
      features: mergedFeatures,
    });
    writeJson(this.filePath, this.data);
    return this.getAll();
  }

  get(k) {
    return this.data[k];
  }

  getAll() {
    return cloneSettings(this.data);
  }

  exportSanitized() {
    return redactSettings(this.data);
  }
}

module.exports = {
  DreamSkinSettings,
  DEFAULT_SETTINGS,
  DEFAULT_GLASS,
  DEFAULT_FONT,
  DEFAULT_FEATURES,
  GLASS_REGION_KEYS,
  FONT_ROLE_KEYS,
  FEATURE_KEYS,
  sanitizeHexColor,
  sanitizeFeatures,
  redactSettings,
};
