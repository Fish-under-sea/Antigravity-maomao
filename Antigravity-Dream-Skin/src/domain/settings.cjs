const os = require("node:os");
const path = require("node:path");
const { readJson, writeJson, finite, bool } = require("../../../shared/storage.cjs");

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
  widgetAutoLaunch: true,
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
      mediaType: VALID_MEDIA_TYPES.has(raw.mediaType) ? raw.mediaType : "preset",
      customMediaPath: sanitizePath(raw.customMediaPath),
      recentMedia: sanitizeRecentMedia(raw.recentMedia),
      videoMuted: bool(raw.videoMuted, true),
      videoPlaybackRate: finite(raw.videoPlaybackRate, 1, 0.25, 2),
      videoPaused: bool(raw.videoPaused, false),
      widgetAutoLaunch: bool(raw.widgetAutoLaunch, true),
      protectEditor: true,
      protectTerminal: true,
    };
  }

  update(v) {
    this.data = this.sanitize({ ...this.data, ...v });
    writeJson(this.filePath, this.data);
    return this.getAll();
  }

  get(k) {
    return this.data[k];
  }

  getAll() {
    return { ...this.data, recentMedia: [...this.data.recentMedia] };
  }
}

module.exports = { DreamSkinSettings, DEFAULT_SETTINGS };
