import crypto from "node:crypto";
import { execFile, spawn } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadDreamSkinModules, loadSidecarSdk } from "./runtime-loader.mjs";
import { WidgetSupervisor } from "./widget-supervisor.mjs";
import { pickLocalMediaFile } from "./media-picker.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIR = path.join(__dirname, "web");

const ALLOWED_SETTINGS_KEYS = new Set([
  "outputMode",
  "enabled",
  "fit",
  "scrim",
  "opacity",
  "positionX",
  "positionY",
  "zoom",
  "mediaType",
  "customMediaPath",
  "recentMedia",
  "videoMuted",
  "videoPlaybackRate",
  "videoPaused",
  "videoSmoothMode",
  "chatWidth",
  "widgetAutoLaunch",
  "widgetHideTray",
  "glass",
  "font",
  "features",
]);

const ALLOWED_WIDGET_KEYS = new Set([
  "scale",
  "alwaysOnTop",
  "reducedMotion",
  "sound",
  "volume",
  "soundSet",
  "bubbleOn",
  "turnCostOn",
  "turnCostDurationMs",
  "clickThrough",
  "snap",
  "hostWindowOnly",
  "hostDock",
  "hostOffsetX",
  "hostOffsetY",
  "easterEggs",
  "bubblePage",
  "manualQuota",
  "manualPercent",
  "manualWeeklyPercent",
]);

const ALLOWED_POKE_KINDS = new Set([
  "random",
  "petting",
  "idle",
  "pressed",
  "proud",
  "thinking",
  "success",
  "crying",
]);

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const MAX_TRANSLATE_TEXT_LEN = 12000;
const MAX_JSON_BODY_BYTES = 256 * 1024;

function filterAllowed(partial, allowSet) {
  if (!partial || typeof partial !== "object") return {};
  return Object.fromEntries(Object.entries(partial).filter(([key]) => allowSet.has(key)));
}

function defaultSettingsPath() {
  return process.env.DREAM_SKIN_SETTINGS_FILE || path.join(os.homedir(), ".antigravity-dream-skin/settings.json");
}

function defaultWidgetSettingsPath() {
  return process.env.CAT_WIDGET_SETTINGS_FILE || path.join(os.homedir(), ".antigravity-cat-widget/settings.json");
}

function readWebAsset(filename) {
  return fs.readFileSync(path.join(WEB_DIR, filename), "utf8");
}

function isBlockedNonLoopbackIp(ip) {
  const cleaned = String(ip || "").trim().toLowerCase();
  if (!cleaned) return true;
  if (net.isIPv4(cleaned)) {
    const parts = cleaned.split(".").map(Number);
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast/reserved
    return false;
  }
  if (net.isIPv6(cleaned)) {
    if (cleaned === "::" || cleaned === "::1") return true;
    if (cleaned.startsWith("fe80:") || cleaned.startsWith("fc") || cleaned.startsWith("fd")) return true;
    if (cleaned.startsWith("::ffff:")) {
      return isBlockedNonLoopbackIp(cleaned.slice(7));
    }
    return false;
  }
  return true;
}

export async function validateTranslateEndpoint(rawUrl, options = {}) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("未配置 OpenAI 兼容翻译端点 URL");
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("无效的翻译端点 URL");
  }
  if (parsed.username || parsed.password) {
    throw new Error("翻译端点 URL 不允许内嵌凭据");
  }
  const hostname = parsed.hostname.toLowerCase();
  const isLoopback = LOOPBACK_HOSTS.has(hostname);

  if (parsed.protocol === "http:") {
    if (!isLoopback) {
      throw new Error("非本机翻译端点必须使用 HTTPS 协议");
    }
  } else if (parsed.protocol !== "https:") {
    throw new Error("翻译端点仅支持 https:// 或本机 http://127.0.0.1 / localhost");
  }

  if (hostname === "metadata.google.internal" || hostname.endsWith(".internal")) {
    throw new Error("禁止访问内部元数据域名");
  }

  if (!isLoopback) {
    const bareHost = hostname.replace(/^\[|\]$/g, "");
    if (net.isIP(bareHost)) {
      if (isBlockedNonLoopbackIp(bareHost)) {
        throw new Error("禁止访问私网或链路本地 IP 地址");
      }
    } else {
      const lookupFn = options.lookup || ((h) => dns.lookup(h, { all: true }));
      let records;
      try {
        records = await lookupFn(bareHost);
      } catch {
        throw new Error(`无法解析翻译端点域名：${bareHost}`);
      }
      if (!Array.isArray(records) || !records.length) {
        throw new Error(`翻译端点域名无解析记录：${bareHost}`);
      }
      for (const rec of records) {
        if (isBlockedNonLoopbackIp(rec.address)) {
          throw new Error("翻译端点域名解析到了受限私网/本机地址，已拒绝请求");
        }
      }
    }
  }
  return parsed.toString();
}

function revealPathInOsFileManager(rawPath) {
  if (typeof rawPath !== "string" || !rawPath.trim() || rawPath.length > 4096 || /[\r\n\0]/.test(rawPath)) {
    return { ok: false, error: "非法文件路径" };
  }
  const resolved = path.resolve(rawPath.trim());
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    return { ok: false, error: `路径不存在：${path.basename(resolved)}` };
  }
  try {
    if (process.platform === "win32") {
      const args = stat.isDirectory() ? [resolved] : [`/select,${resolved}`];
      const child = spawn("explorer.exe", args, { detached: true, stdio: "ignore", windowsHide: true, shell: false });
      child.unref();
    } else if (process.platform === "darwin") {
      const args = stat.isDirectory() ? [resolved] : ["-R", resolved];
      const child = spawn("open", args, { detached: true, stdio: "ignore", shell: false });
      child.unref();
    } else {
      const targetDir = stat.isDirectory() ? resolved : path.dirname(resolved);
      const child = spawn("xdg-open", [targetDir], { detached: true, stdio: "ignore", shell: false });
      child.unref();
    }
    return { ok: true, action: "reveal", path: resolved };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function normalizeUsageRange(raw) {
  const val = String(raw || "today").trim().toLowerCase();
  if (val === "7d") return "week";
  if (["today", "24h", "yesterday", "week", "month", "30d", "all", "custom"].includes(val)) {
    return val;
  }
  return "today";
}

export async function createStarSuiteService(options = {}) {
  const {
    root,
    skinRoot,
    staged,
    pluginVersion,
    catPetAssetDirs,
    DreamSkinSettings,
    DEFAULT_SETTINGS,
    DreamSkinThemeLoader,
    HostController,
    LocalMediaServer,
    detectMediaKind,
    telemetryDb,
    quotaBridge,
    pluginUpdater: loadedPluginUpdater,
    WidgetSettingsManager,
    DEFAULT_WIDGET_SETTINGS,
    ALLOWED_SOUND_SETS,
  } = loadDreamSkinModules(__dirname);

  const pluginUpdater = options.pluginUpdater || loadedPluginUpdater;
  const currentPluginVersion = options.pluginVersion || pluginVersion || "0.4.0";
  const i18nOverrideFile =
    options.i18nOverrideFile || path.join(os.homedir(), ".antigravity-dream-skin", "i18n-override.json");

  const extractDictMap = (raw) => {
    if (!raw || typeof raw !== "object") return {};
    if (raw.dict && typeof raw.dict === "object" && !Array.isArray(raw.dict)) return raw.dict;
    if (Array.isArray(raw)) return {};
    return Object.fromEntries(
      Object.entries(raw).filter(([k, v]) => typeof k === "string" && typeof v === "string")
    );
  };

  let currentI18nOverrideDict = {};
  try {
    if (pluginUpdater?.loadI18nOverrideDict) {
      currentI18nOverrideDict = extractDictMap(pluginUpdater.loadI18nOverrideDict(i18nOverrideFile));
    }
  } catch {}

  let updateStatus = {
    checking: false,
    updating: false,
    currentVersion: currentPluginVersion,
    latestVersion: null,
    hasUpdate: false,
    releaseNotes: "",
    releaseUrl: "",
    assetName: "",
    assetSize: 0,
    downloadUrl: "",
    publishedAt: null,
    checkedAt: null,
    appliedVersion: null,
    error: "",
  };

  const settings = new DreamSkinSettings(options.settingsFile || defaultSettingsPath());
  const widgetSettings = WidgetSettingsManager
    ? new WidgetSettingsManager(options.widgetSettingsFile || defaultWidgetSettingsPath())
    : null;
  const mediaServer = new LocalMediaServer({ assetDirs: options.assetDirs || catPetAssetDirs });
  await mediaServer.start();

  const syncAllowedMedia = () => {
    const s = settings.getAll();
    const candidates = [s.customMediaPath, ...(s.recentMedia || [])].filter(Boolean);
    mediaServer.setAllowedFiles(candidates);
  };
  syncAllowedMedia();

  const loader = new DreamSkinThemeLoader({ rootDir: skinRoot, mediaServer });
  const pickMedia = options.pickMedia || pickLocalMediaFile;
  const widgetSupervisor =
    options.widgetSupervisor ||
    new WidgetSupervisor({
      repoRoot: root,
      getConfiguredPath: () => process.env.ANTIGRAVITY_STAR_WIDGET_PATH || "",
      getHideTray: () => settings.get("widgetHideTray") !== false,
    });

  const instanceOwner = options.owner || `antigravity-star-suite-${process.pid}-${crypto.randomUUID().slice(0, 8)}`;
  const appDataDir = options.appDataDir || (telemetryDb?.resolveAppDataDir ? telemetryDb.resolveAppDataDir() : undefined);

  const controller = new HostController(
    loader,
    () => {
      if (typeof options.onStatus === "function") {
        options.onStatus(snapshot());
      }
    },
    {
      owner: instanceOwner,
      discover: options.discover,
      listTargets: options.listTargets,
      createClient: options.createClient,
      hostStateFile: options.hostStateFile,
      getI18nOverrideDict: () => currentI18nOverrideDict,
      sidecar: {
        getBaseUrl: () => mediaServer.baseUrl,
        getToken: () => mediaServer.token,
        getAssetBaseUrl: () => mediaServer.assetBaseUrl,
      },
      onHostPatch: (patch) => {
        const clean = filterAllowed(patch, ALLOWED_SETTINGS_KEYS);
        if (Object.keys(clean).length > 0) {
          settings.update(clean);
          if (typeof options.onStatus === "function") {
            options.onStatus(snapshot());
          }
        }
      },
    }
  );

  let pollTimer = null;
  let startupUpdateTimer = null;
  let widgetActionError = "";
  let cachedQuota = { value: null, at: 0 };

  const readQuotaCached = async (force = false) => {
    if (!quotaBridge?.readQuotaSnapshot) return null;
    const now = Date.now();
    if (!force && cachedQuota.value && now - cachedQuota.at < 20000) {
      return cachedQuota.value;
    }
    try {
      const snap = await quotaBridge.readQuotaSnapshot({
        appDataDir,
        discover: options.discover,
        createClient: options.createClient,
      });
      cachedQuota = { value: snap, at: now };
      return snap;
    } catch {
      return cachedQuota.value || null;
    }
  };

  const inspectActiveMedia = (s) => {
    try {
      const inspected = loader.inspectActiveMedia(s);
      return {
        mediaKind: inspected.mediaKind,
        mediaName: inspected.mediaName,
        mediaPath: s.mediaType === "preset" ? "" : inspected.mediaPath,
        mediaUrl: inspected.mediaUrl || "./preset-wallpaper.png",
        wallpaperError: null,
      };
    } catch (error) {
      return {
        mediaKind: s.mediaType === "video" ? "video" : "image",
        mediaName: s.customMediaPath ? path.basename(s.customMediaPath) : "背景未就绪",
        mediaPath: s.customMediaPath || "",
        mediaUrl: "./preset-wallpaper.png",
        wallpaperError: error instanceof Error ? error.message : String(error),
      };
    }
  };

  const buildRecentItems = (s) =>
    (s.recentMedia || []).map((filePath) => ({
      path: filePath,
      name: path.basename(filePath),
      kind: detectMediaKind(filePath) || "image",
      exists: fs.existsSync(filePath),
    }));

  const snapshot = () => {
    const s = settings.getAll();
    const activeMedia = inspectActiveMedia(s);
    const widget = widgetSupervisor.status();
    if (widgetActionError && !widget.error) {
      widget.error = widgetActionError;
    }
    return {
      settings: s,
      defaults: DEFAULT_SETTINGS,
      status: controller.status,
      hostDark: controller.status?.connected ? Boolean(controller.hostThemeContext?.hostDark) : null,
      pluginVersion: currentPluginVersion,
      agyVersion: controller.agyVersion || "",
      lastI18nReloadAt: controller.lastI18nReloadAt || null,
      lastAgyUpgradeReloadAt: controller.lastAgyUpgradeReloadAt || null,
      i18nOverrideCount: Object.keys(currentI18nOverrideDict || {}).length,
      updateStatus: { ...updateStatus },
      wallpaper: activeMedia.mediaName,
      wallpaperError: activeMedia.wallpaperError,
      activeMedia,
      recentItems: buildRecentItems(s),
      mediaServerUrl: mediaServer.baseUrl,
      assetBaseUrl: mediaServer.assetBaseUrl,
      widget,
      widgetSettings: widgetSettings ? widgetSettings.getAll() : DEFAULT_WIDGET_SETTINGS || {},
      widgetDefaults: { ...(DEFAULT_WIDGET_SETTINGS || {}), soundSets: ALLOWED_SOUND_SETS },
      staged,
    };
  };

  const updateSettings = async (partial) => {
    const allowed = filterAllowed(partial, ALLOWED_SETTINGS_KEYS);
    settings.update(allowed);
    syncAllowedMedia();
    await controller.update(settings.getAll());
    return snapshot();
  };

  const updateWidgetSettings = async (partial, { extraFlag = "" } = {}) => {
    const allowed = filterAllowed(partial, ALLOWED_WIDGET_KEYS);
    if (widgetSettings && Object.keys(allowed).length > 0) {
      widgetSettings.update(allowed);
    }
    await widgetSupervisor.reloadSettings?.({
      hideTray: settings.get("widgetHideTray") !== false,
      extraFlag,
    });
    return snapshot();
  };

  const applySelectedMediaPath = async (rawPath, { enableIfSelected = true } = {}) => {
    const trimmed = typeof rawPath === "string" ? rawPath.trim() : "";
    if (!trimmed) {
      throw new Error("媒体路径不能为空");
    }
    const kind = detectMediaKind(trimmed);
    if (!kind) {
      throw new Error("不支持的背景格式，请选择 MP4 / WEBM / PNG / JPG / WEBP / GIF");
    }
    const resolved = path.resolve(trimmed);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
      throw new Error(`找不到背景文件：${path.basename(resolved)}`);
    }
    const prev = settings.getAll();
    const recentMedia = [resolved, ...(prev.recentMedia || [])];
    const patch = {
      mediaType: kind,
      customMediaPath: resolved,
      recentMedia,
    };
    if (enableIfSelected) {
      patch.enabled = true;
    }
    if (kind === "video") {
      patch.videoPaused = false;
    }
    return updateSettings(patch);
  };

  const selectPreset = async () => updateSettings({ mediaType: "preset" });

  const pickAndApplyMedia = async () => {
    const pickedPath = await pickMedia();
    if (!pickedPath) {
      return { picked: false, canceled: true, state: snapshot() };
    }
    const state = await applySelectedMediaPath(pickedPath, { enableIfSelected: true });
    return { picked: true, filePath: pickedPath, state };
  };

  const refresh = async () => {
    syncAllowedMedia();
    await controller.tick();
    return snapshot();
  };

  const handleWidgetAction = async (action, value) => {
    widgetActionError = "";
    const hideTray = settings.get("widgetHideTray") !== false;
    let result;
    if (action === "start") {
      result = await widgetSupervisor.ensureStarted({ silent: false, hideTray });
    } else if (action === "recall") {
      result = await widgetSupervisor.recall({ hideTray });
    } else if (action === "restart") {
      result = await (widgetSupervisor.restart
        ? widgetSupervisor.restart({ silent: true, hideTray })
        : widgetSupervisor.ensureStarted({ silent: true, hideTray }));
    } else if (action === "quit") {
      result = widgetSupervisor.quit();
    } else if (action === "dock-left") {
      if (widgetSettings) widgetSettings.update({ hostDock: "left", hostOffsetY: 0 });
      result = await widgetSupervisor.reloadSettings?.({ hideTray, extraFlag: "--dock-left" });
    } else if (action === "dock-right") {
      if (widgetSettings) widgetSettings.update({ hostDock: "right", hostOffsetX: 0, hostOffsetY: 0 });
      result = await widgetSupervisor.reloadSettings?.({ hideTray, extraFlag: "--dock-right" });
    } else if (action === "reset-pos") {
      if (widgetSettings) widgetSettings.update({ hostDock: "", hostOffsetX: 18, hostOffsetY: 18 });
      result = await widgetSupervisor.reloadSettings?.({ hideTray, extraFlag: "--reset-pos" });
    } else if (action === "autoLaunch") {
      settings.update({ widgetAutoLaunch: Boolean(value) });
      result = { ok: true, widgetAutoLaunch: settings.get("widgetAutoLaunch") };
    } else if (action === "hideTray") {
      const nextHide = Boolean(value);
      settings.update({ widgetHideTray: nextHide });
      if (widgetSupervisor.status().running) {
        result = await (widgetSupervisor.restart
          ? widgetSupervisor.restart({ silent: true, hideTray: nextHide })
          : { ok: true });
      } else {
        result = { ok: true, widgetHideTray: nextHide };
      }
    } else {
      throw new Error(`未知桌宠操作：${action}`);
    }
    if (result && result.ok === false && result.reason) {
      widgetActionError = result.reason;
    }
    return { result, state: snapshot() };
  };

  // ── v0.4.0 Maomao Telemetry / Search / Diff / Translate / Archive / System Handlers ──

  const getTelemetry = async (params = {}) => {
    if (!telemetryDb?.getConversationTelemetry) {
      return { ok: false, error: "遥测模块未加载" };
    }
    const convId = typeof params.conversationId === "string" && params.conversationId.trim() ? params.conversationId.trim() : undefined;
    const telemetry = telemetryDb.getConversationTelemetry(appDataDir, convId);
    const includeQuota = params.includeQuota !== "0" && settings.get("features")?.telemetry?.quotaEnabled !== false;
    const quota = includeQuota ? await readQuotaCached(params.force === "1") : null;
    const cacheStats = telemetryDb.getTrajectoryCacheStats ? telemetryDb.getTrajectoryCacheStats(appDataDir) : null;
    return {
      ok: true,
      ...telemetry,
      quota,
      quotas: quota,
      cacheStats: cacheStats
        ? {
            totalBytes: cacheStats.totalBytes,
            conversationCount: cacheStats.conversationCount,
            subagentCount: cacheStats.subagentCount,
            subagentBytes: cacheStats.subagentBytes,
            fileCount: cacheStats.fileCount,
          }
        : null,
    };
  };

  const getUsage = async (params = {}) => {
    if (!telemetryDb?.getUsageDashboard) {
      return { ok: false, error: "遥测模块未加载" };
    }
    const range = normalizeUsageRange(params.range);
    const wantFull = params.full === "1" || params.full === true;
    const dashboard = telemetryDb.getUsageDashboard(appDataDir, {
      range,
      force: params.force === "1" || params.force === true,
      pricingMode: typeof params.pricingMode === "string" ? params.pricingMode : undefined,
      includeRequests: wantFull,
      includeAnomalies: wantFull,
    });
    const cacheStats = telemetryDb.getTrajectoryCacheStats ? telemetryDb.getTrajectoryCacheStats(appDataDir) : null;
    const quota = params.includeQuota === "0" ? null : await readQuotaCached(false);
    return {
      ok: true,
      ...dashboard,
      cacheStats: cacheStats
        ? {
            totalBytes: cacheStats.totalBytes,
            conversationCount: cacheStats.conversationCount,
            subagentCount: cacheStats.subagentCount,
            subagentBytes: cacheStats.subagentBytes,
            fileCount: cacheStats.fileCount,
          }
        : null,
      quota,
    };
  };

  const searchHistory = async (params = {}) => {
    if (!telemetryDb?.searchTranscripts) {
      return { query: "", scope: "all", results: [], scannedConversations: 0, truncated: false };
    }
    const q = String(params.q ?? params.query ?? "").trim();
    const scope = ["all", "text", "code"].includes(params.scope) ? params.scope : "all";
    const limitRaw = Number(params.limit);
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(50, Math.round(limitRaw)) : 20;
    return telemetryDb.searchTranscripts(appDataDir, q, { scope, limit });
  };

  const getGitDiff = async (params = {}) => {
    if (!quotaBridge?.getSafeGitDiff) {
      return { ok: false, error: "Git Diff 模块未加载" };
    }
    const filePath = String(params.path ?? params.filePath ?? "").trim();
    return quotaBridge.getSafeGitDiff(filePath);
  };

  const handleFileAction = async (body = {}) => {
    const action = String(body.action || "").trim();
    if (action !== "reveal") {
      return { ok: false, error: `不支持的文件操作：${action}` };
    }
    if (typeof options.revealFile === "function") {
      return options.revealFile(body.path);
    }
    return revealPathInOsFileManager(body.path);
  };

  const translateThought = async (body = {}) => {
    const rawText = typeof body.text === "string" ? body.text.trim() : "";
    if (!rawText) return { ok: true, translatedText: "", mode: "none" };
    if (rawText.length > MAX_TRANSLATE_TEXT_LEN) {
      throw new Error(`待翻译文本超过长度上限（最大 ${MAX_TRANSLATE_TEXT_LEN} 字符）`);
    }
    const wb = settings.get("features")?.workbench || {};
    const mode = body.mode || wb.thoughtTranslate || "off";
    if (mode === "off") {
      return { ok: false, error: "思考过程翻译未开启" };
    }

    const fetchFn = options.fetchImpl || globalThis.fetch;

    if (mode === "machine") {
      const gtxUrl =
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=zh-CN&dt=t&q=" +
        encodeURIComponent(rawText);
      const res = await fetchFn(gtxUrl, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      if (!res.ok) {
        throw new Error(`免费翻译服务返回状态 ${res.status}`);
      }
      const data = await res.json();
      const translatedText = Array.isArray(data?.[0])
        ? data[0].map((seg) => (Array.isArray(seg) ? String(seg[0] || "") : "")).join("")
        : "";
      return { ok: true, translatedText: translatedText.trim() || rawText, mode: "machine" };
    }

    if (mode === "openai") {
      const endpoint = String(body.endpoint || wb.thoughtEndpoint || "").trim();
      const model = String(body.model || wb.thoughtModel || "gpt-4o-mini").trim();
      const apiKey = String(body.apiKey || wb.thoughtApiKey || "").trim();
      const safeEndpoint = await validateTranslateEndpoint(endpoint, { lookup: options.dnsLookup });
      const headers = { "Content-Type": "application/json" };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;

      const res = await fetchFn(safeEndpoint, {
        method: "POST",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          model,
          temperature: 0.2,
          messages: [
            {
              role: "system",
              content:
                "将以下 AI 思考过程准确、自然地翻译为简体中文。保留代码、文件路径、命令、模型名称与思考强度英文原样，仅输出译文。",
            },
            { role: "user", content: rawText },
          ],
        }),
      });
      if (!res.ok) {
        throw new Error(`OpenAI 兼容翻译接口返回状态 ${res.status}`);
      }
      const json = await res.json();
      const translatedText = String(json?.choices?.[0]?.message?.content || "").trim();
      if (!translatedText) {
        throw new Error("翻译接口未返回有效译文");
      }
      return { ok: true, translatedText, mode: "openai" };
    }

    throw new Error(`不支持的翻译模式：${mode}`);
  };

  const scanArchive = () => {
    if (!quotaBridge?.scanArchivableSubagents) {
      return { ok: false, items: [], totalCount: 0, totalBytes: 0 };
    }
    return { ok: true, ...quotaBridge.scanArchivableSubagents(appDataDir) };
  };

  const runArchive = (body = {}) => {
    if (!quotaBridge?.archiveSubagents) {
      return { ok: false, message: "归档模块未加载" };
    }
    const ids = Array.isArray(body.ids) ? body.ids : [];
    return quotaBridge.archiveSubagents(appDataDir, ids);
  };

  const getArchiveBatches = () => {
    if (!quotaBridge?.listArchiveBatches) {
      return { ok: true, batches: [] };
    }
    return { ok: true, ...quotaBridge.listArchiveBatches(appDataDir) };
  };

  const restoreArchive = (body = {}) => {
    if (!quotaBridge?.restoreArchiveBatch) {
      return { ok: false, message: "归档模块未加载" };
    }
    return quotaBridge.restoreArchiveBatch(appDataDir, String(body.batchId || ""));
  };

  const getSystemStatus = async () => {
    const debugPort = quotaBridge?.getDebugPortStatus ? await quotaBridge.getDebugPortStatus() : null;
    const gomemlimit = quotaBridge?.getGomemlimitStatus ? quotaBridge.getGomemlimitStatus() : null;
    return { ok: true, debugPort, gomemlimit };
  };

  const ensureDebugPort = async () => {
    if (!quotaBridge?.ensureDebugPortShortcuts) {
      return { ok: false, message: "快捷方式维护模块未加载" };
    }
    return quotaBridge.ensureDebugPortShortcuts();
  };

  const applyGomemlimit = (body = {}) => {
    if (!quotaBridge?.setGomemlimit) {
      return { ok: false, error: "GOMEMLIMIT 模块未加载" };
    }
    return quotaBridge.setGomemlimit(typeof body.preset === "string" ? body.preset : "");
  };

  const pokePet = async (body = {}) => {
    const kind = ALLOWED_POKE_KINDS.has(body.kind) ? body.kind : "random";
    if (typeof controller.pokeEmbeddedPet !== "function") {
      return { ok: false, error: "宿主控制器不支持内置猫宠互动" };
    }
    return controller.pokeEmbeddedPet(kind);
  };

  const exportSanitizedConfig = () => ({
    version: currentPluginVersion,
    exportedAt: new Date().toISOString(),
    settings: settings.exportSanitized(),
  });

  const checkForUpdate = async (params = {}) => {
    if (!pluginUpdater?.checkForPluginUpdate) {
      updateStatus = { ...updateStatus, checking: false, error: "更新检测模块未加载" };
      return { ok: false, ...updateStatus };
    }
    updateStatus = { ...updateStatus, checking: true, error: "" };
    try {
      const result = await pluginUpdater.checkForPluginUpdate({
        currentVersion: currentPluginVersion,
        repo: options.updateRepo || "Fish-under-sea/Antigravity-maomao",
        fetchImpl: options.fetchImpl,
        force: params.force === "1" || params.force === true,
      });
      updateStatus = {
        ...updateStatus,
        checking: false,
        currentVersion: result.currentVersion || currentPluginVersion,
        latestVersion: result.latestVersion || null,
        hasUpdate: Boolean(result.hasUpdate),
        releaseNotes: typeof result.releaseNotes === "string" ? result.releaseNotes : "",
        releaseUrl: typeof result.releaseUrl === "string" ? result.releaseUrl : "",
        assetName: typeof result.assetName === "string" ? result.assetName : "",
        assetSize: Number(result.assetSize) || 0,
        downloadUrl: typeof result.downloadUrl === "string" ? result.downloadUrl : "",
        publishedAt: result.publishedAt || null,
        checkedAt: result.checkedAt || Date.now(),
        error: "",
      };
      let toastResult = null;
      if (updateStatus.hasUpdate && typeof controller.showHostUpdateToast === "function") {
        toastResult = await controller.showHostUpdateToast({
          ...updateStatus,
          force: Boolean(params.forceToast),
        }).catch(() => null);
      }
      return { ok: true, ...updateStatus, toast: toastResult };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateStatus = {
        ...updateStatus,
        checking: false,
        checkedAt: Date.now(),
        error: msg,
      };
      return { ok: false, ...updateStatus };
    }
  };

  const resolveSafeUpdateTargetDir = () => {
    if (options.updateTargetDir) {
      return path.resolve(options.updateTargetDir);
    }
    const defaultInstalledDir = path.join(os.homedir(), ".gemini", "config", "plugins", "antigravity-star-suite");
    if (staged) {
      const selfPluginDir = path.resolve(__dirname, "../..");
      if (!fs.existsSync(path.join(selfPluginDir, ".git")) && !fs.existsSync(path.resolve(selfPluginDir, "../.git"))) {
        return selfPluginDir;
      }
    }
    // Never overwrite the development git workspace; update the installed plugin directory instead
    return defaultInstalledDir;
  };

  const applyPluginUpdate = async (body = {}) => {
    if (!pluginUpdater?.downloadAndInstallUpdate) {
      return { ok: false, error: "插件更新模块未加载" };
    }
    let downloadUrl = typeof body.downloadUrl === "string" && body.downloadUrl.trim()
      ? body.downloadUrl.trim()
      : updateStatus.downloadUrl;
    if (!downloadUrl) {
      const checked = await checkForUpdate({ force: true });
      downloadUrl = checked.downloadUrl || "";
    }
    if (!downloadUrl) {
      return { ok: false, error: updateStatus.error || "未找到可安装的插件更新包，请先检查更新" };
    }
    const targetDir = resolveSafeUpdateTargetDir();
    updateStatus = { ...updateStatus, updating: true, error: "" };
    try {
      const res = await pluginUpdater.downloadAndInstallUpdate({
        downloadUrl,
        targetDir,
        fetchImpl: options.fetchImpl,
        extractZip: options.extractZip,
      });
      if (res && res.ok === false) {
        updateStatus = { ...updateStatus, updating: false, error: res.error || "更新安装失败" };
        return res;
      }
      updateStatus = {
        ...updateStatus,
        updating: false,
        hasUpdate: false,
        appliedVersion: res?.toVersion || updateStatus.latestVersion || null,
        error: "",
      };
      if (typeof options.restartSidecar === "function") {
        options.restartSidecar({ ...res, targetDir });
      } else if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
        const timer = setTimeout(() => {
          process.exit(0);
        }, 600);
        timer.unref?.();
      }
      return { ok: true, restarting: true, ...res, targetDir, updateStatus: { ...updateStatus } };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      updateStatus = { ...updateStatus, updating: false, error: msg };
      return { ok: false, error: msg, updateStatus: { ...updateStatus } };
    }
  };

  const reloadI18nNow = async (body = {}) => {
    const syncRemote = Boolean(body.syncRemote);
    let remoteSynced = false;
    let syncMessage = "";
    if (syncRemote && pluginUpdater?.syncRemoteI18nDict) {
      try {
        const synced = await pluginUpdater.syncRemoteI18nDict({
          url: typeof body.url === "string" && body.url.trim() ? body.url.trim() : undefined,
          filePath: i18nOverrideFile,
          fetchImpl: options.fetchImpl,
        });
        currentI18nOverrideDict = extractDictMap(synced);
        remoteSynced = Boolean(synced?.synced ?? synced?.remote ?? true);
        if (synced?.message) syncMessage = String(synced.message);
      } catch (err) {
        syncMessage = err instanceof Error ? err.message : String(err);
      }
    }
    if (!remoteSynced && pluginUpdater?.loadI18nOverrideDict) {
      try {
        currentI18nOverrideDict = extractDictMap(pluginUpdater.loadI18nOverrideDict(i18nOverrideFile));
      } catch {}
    }
    const reloadRes =
      typeof controller.reloadI18n === "function"
        ? await controller.reloadI18n({
            extraDict: currentI18nOverrideDict,
            forceReinject: Boolean(body.forceReinject),
          })
        : { ok: false, error: "宿主控制器不支持汉化重载" };
    return {
      ...reloadRes,
      syncRemote,
      remoteSynced,
      syncMessage,
      overrideCount: Object.keys(currentI18nOverrideDict || {}).length,
      state: snapshot(),
    };
  };

  const maomaoApiHandlers = new Map([
    ["GET:/api/maomao/config/export", async () => ({ status: 200, data: exportSanitizedConfig() })],
    ["GET:/api/maomao/telemetry", async (p) => ({ status: 200, data: await getTelemetry(p) })],
    ["GET:/api/maomao/quota", async (p) => ({ status: 200, data: (await readQuotaCached(p.force === "1")) || { groups: [] } })],
    ["GET:/api/maomao/usage", async (p) => ({ status: 200, data: await getUsage(p) })],
    ["GET:/api/maomao/search", async (p) => ({ status: 200, data: await searchHistory(p) })],
    ["GET:/api/maomao/git-diff", async (p) => ({ status: 200, data: await getGitDiff(p) })],
    ["POST:/api/maomao/file-action", async (p) => ({ status: 200, data: await handleFileAction(p) })],
    ["POST:/api/maomao/translate", async (p) => ({ status: 200, data: await translateThought(p) })],
    ["GET:/api/maomao/archive/scan", async () => ({ status: 200, data: scanArchive() })],
    ["POST:/api/maomao/archive/run", async (p) => ({ status: 200, data: runArchive(p) })],
    ["GET:/api/maomao/archive/batches", async () => ({ status: 200, data: getArchiveBatches() })],
    ["POST:/api/maomao/archive/restore", async (p) => ({ status: 200, data: restoreArchive(p) })],
    ["GET:/api/maomao/system/status", async () => ({ status: 200, data: await getSystemStatus() })],
    ["POST:/api/maomao/system/ensure-debug-port", async () => ({ status: 200, data: await ensureDebugPort() })],
    ["POST:/api/maomao/system/gomemlimit", async (p) => ({ status: 200, data: applyGomemlimit(p) })],
    ["POST:/api/maomao/pet-poke", async (p) => ({ status: 200, data: await pokePet(p) })],
    ["GET:/api/maomao/update/check", async (p) => ({ status: 200, data: await checkForUpdate(p) })],
    ["POST:/api/maomao/update/apply", async (p) => ({ status: 200, data: await applyPluginUpdate(p) })],
  ]);

  // Wire CORS + Token + Loopback-Host protected /api/maomao/* onto LocalMediaServer for Antigravity host scripts
  mediaServer.setApiHandler(async (req, res, url) => {
    const key = `${req.method}:${url.pathname}`;
    const handler = maomaoApiHandlers.get(key);
    if (!handler) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    try {
      const params = {};
      for (const [k, v] of url.searchParams.entries()) {
        if (k.toLowerCase() !== "token") params[k] = v;
      }
      if (req.method === "POST") {
        Object.assign(params, await readJsonRequestBody(req));
      }
      const result = await handler(params);
      res.writeHead(result.status || 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(result.data));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  const readPresetPngBuffer = () => {
    const m = loader.verifyIntegrity();
    return fs.readFileSync(m.file);
  };

  const start = async () => {
    await mediaServer.start();
    syncAllowedMedia();
    await controller.update(settings.getAll());
    // v0.4.0: 猫宠已内置进插件，默认不再自动拉起独立外部 StarWidget.exe 进程
    if (
      options.autoStartWidget === true &&
      settings.get("widgetAutoLaunch") &&
      !settings.get("features")?.embeddedPet?.enabled
    ) {
      await widgetSupervisor.ensureStarted({
        silent: true,
        hideTray: settings.get("widgetHideTray") !== false,
      });
    }
    if (options.autoTick !== false) {
      const intervalMs = Number.isFinite(options.pollIntervalMs) ? options.pollIntervalMs : 4000;
      pollTimer = setInterval(() => {
        controller.tick().catch(() => {});
      }, intervalMs);
      pollTimer.unref?.();
    }
    const shouldAutoCheckUpdate =
      options.autoCheckUpdate === true ||
      (options.autoCheckUpdate !== false && options.autoTick !== false);
    if (shouldAutoCheckUpdate && pluginUpdater?.checkForPluginUpdate) {
      const delayMs = Number.isFinite(options.startupUpdateDelayMs) ? options.startupUpdateDelayMs : 8000;
      startupUpdateTimer = setTimeout(() => {
        startupUpdateTimer = null;
        checkForUpdate({ force: false }).catch(() => {});
      }, delayMs);
      startupUpdateTimer.unref?.();
    }
    return snapshot();
  };

  const stop = async () => {
    if (startupUpdateTimer) {
      clearTimeout(startupUpdateTimer);
      startupUpdateTimer = null;
    }
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    await controller.stop();
    await mediaServer.stop();
  };

  function relaunchHostWithDebugPort() {
    if (process.platform !== "win32") {
      return { ok: false, error: "当前仅支持 Windows 自动以调试模式重启 Antigravity" };
    }
    const candidates = [
      process.env.ANTIGRAVITY_EXE_PATH,
      process.execPath && /Antigravity\.exe$/i.test(process.execPath) ? process.execPath : "",
      path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData/Local"), "Programs/antigravity/Antigravity.exe"),
    ].filter(Boolean);
    const exePath = candidates.find((p) => fs.existsSync(p));
    if (!exePath) {
      return { ok: false, error: "未找到 Antigravity.exe 安装路径，请从桌面或开始菜单快捷方式重新打开" };
    }
    const cleanEnv = { ...process.env };
    delete cleanEnv.ELECTRON_RUN_AS_NODE;
    const escaped = exePath.replace(/'/g, "''");
    const psScript = [
      "Start-Sleep -Milliseconds 350",
      "$procs = Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 }",
      "foreach ($p in $procs) { try { $p.CloseMainWindow() | Out-Null } catch {} }",
      "$deadline = (Get-Date).AddSeconds(6)",
      "while ((Get-Date) -lt $deadline) { if (-not (Get-Process -Name 'Antigravity' -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 })) { break }; Start-Sleep -Milliseconds 250 }",
      "Start-Sleep -Milliseconds 300",
      `Start-Process -FilePath '${escaped}' -ArgumentList '--remote-debugging-address=127.0.0.1','--remote-debugging-port=0'`,
    ].join("; ");
    const encoded = Buffer.from(psScript, "utf16le").toString("base64");
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded],
      { detached: true, stdio: "ignore", env: cleanEnv, windowsHide: true }
    );
    child.unref();
    return { ok: true, exePath, message: "正在以调试模式重启 Antigravity，请稍候 3 秒…" };
  }

  return {
    root,
    skinRoot,
    staged,
    settings,
    loader,
    controller,
    mediaServer,
    widgetSupervisor,
    maomaoApiHandlers,
    snapshot,
    updateSettings,
    updateWidgetSettings,
    applySelectedMediaPath,
    selectPreset,
    pickAndApplyMedia,
    refresh,
    handleWidgetAction,
    relaunchHostWithDebugPort,
    checkForUpdate,
    applyPluginUpdate,
    reloadI18nNow,
    readPresetPngBuffer,
    start,
    stop,
  };
}

function readJsonRequestBody(req) {
  if (req && typeof req.body === "object" && req.body !== null) {
    return Promise.resolve(req.body);
  }
  if (typeof req?.body === "string") {
    try {
      return Promise.resolve(req.body ? JSON.parse(req.body) : {});
    } catch {
      return Promise.reject(new Error("Invalid JSON body"));
    }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    req.on("data", (c) => {
      if (settled) return;
      total += c.length;
      if (total > MAX_JSON_BODY_BYTES) {
        settled = true;
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (settled) return;
      settled = true;
      const text = Buffer.concat(chunks).toString("utf8").trim();
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}

function buildRouteHandlers(service) {
  const maomaoApis = [];
  for (const [key, handle] of service.maomaoApiHandlers.entries()) {
    const sep = key.indexOf(":");
    maomaoApis.push({
      method: key.slice(0, sep),
      path: key.slice(sep + 1),
      handle,
    });
  }

  return {
    pages: [
      { path: "/", contentType: "text/html; charset=utf-8", read: () => readWebAsset("index.html") },
      { path: "/styles.css", contentType: "text/css; charset=utf-8", read: () => readWebAsset("styles.css") },
      { path: "/app.js", contentType: "application/javascript; charset=utf-8", read: () => readWebAsset("app.js") },
      { path: "/logo.png", contentType: "image/png", read: () => fs.readFileSync(path.join(WEB_DIR, "logo.png")) },
      { path: "/preset-wallpaper.png", contentType: "image/png", read: () => service.readPresetPngBuffer() },
    ],
    apis: [
      {
        method: "GET",
        path: "/api/state",
        handle: async () => ({ status: 200, data: service.snapshot() }),
      },
      {
        method: "POST",
        path: "/api/settings",
        handle: async (body) => ({ status: 200, data: await service.updateSettings(body) }),
      },
      {
        method: "POST",
        path: "/api/pick-media",
        handle: async () => ({ status: 200, data: await service.pickAndApplyMedia() }),
      },
      {
        method: "POST",
        path: "/api/select-media",
        handle: async (body) => {
          if (body?.mediaType === "preset") {
            return { status: 200, data: await service.selectPreset() };
          }
          return {
            status: 200,
            data: await service.applySelectedMediaPath(body?.path, {
              enableIfSelected: body?.enable !== false,
            }),
          };
        },
      },
      {
        method: "POST",
        path: "/api/refresh",
        handle: async () => ({ status: 200, data: await service.refresh() }),
      },
      {
        method: "POST",
        path: "/api/relaunch-host",
        handle: async () => ({ status: 200, data: service.relaunchHostWithDebugPort() }),
      },
      {
        method: "POST",
        path: "/api/widget",
        handle: async (body) => ({
          status: 200,
          data: await service.handleWidgetAction(body?.action, body?.value),
        }),
      },
      {
        method: "POST",
        path: "/api/widget-settings",
        handle: async (body) => ({
          status: 200,
          data: await service.updateWidgetSettings(body),
        }),
      },
      {
        method: "GET",
        path: "/api/update/check",
        handle: async (params) => ({
          status: 200,
          data: await service.checkForUpdate(params),
        }),
      },
      {
        method: "POST",
        path: "/api/update/apply",
        handle: async (body) => ({
          status: 200,
          data: await service.applyPluginUpdate(body),
        }),
      },
      {
        method: "POST",
        path: "/api/i18n/reload",
        handle: async (body) => ({
          status: 200,
          data: await service.reloadI18nNow(body),
        }),
      },
      ...maomaoApis,
    ],
  };
}

export async function startStandaloneHttpServer(service, { port = 0, host = "127.0.0.1" } = {}) {
  const routes = buildRouteHandlers(service);
  const pageMap = new Map(routes.pages.map((p) => [p.path, p]));
  const apiMap = new Map(routes.apis.map((a) => [`${a.method}:${a.path}`, a]));

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://${host}`);
    if (req.method === "GET" && url.pathname === "/preload.js") {
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      res.end("window.sidecar = window.sidecar || null;");
      return;
    }

    if (req.method === "GET" && pageMap.has(url.pathname)) {
      const page = pageMap.get(url.pathname);
      try {
        const body = page.read();
        res.writeHead(200, { "Content-Type": page.contentType, "Cache-Control": "no-store" });
        res.end(body);
      } catch (error) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    const api = apiMap.get(`${req.method}:${url.pathname}`);
    if (!api) {
      res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    try {
      const params = {};
      for (const [k, v] of url.searchParams.entries()) {
        if (k.toLowerCase() !== "token") params[k] = v;
      }
      if (req.method === "POST") {
        Object.assign(params, await readJsonRequestBody(req));
      }
      const result = await api.handle(params);
      res.writeHead(result.status || 200, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(JSON.stringify(result.data));
    } catch (error) {
      res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const addr = server.address();
  const actualPort = addr && typeof addr === "object" ? addr.port : port;
  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function runSidecarRuntime() {
  const service = await createStarSuiteService();
  await service.start();
  const routes = buildRouteHandlers(service);

  let closeHttp = null;
  if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    const { SidecarApp, Response } = await loadSidecarSdk();
    const app = new SidecarApp();

    for (const page of routes.pages) {
      app.page(page.path, () => new Response(page.read(), { contentType: page.contentType }));
    }

    for (const api of routes.apis) {
      app.api(
        api.path,
        async (data) => {
          try {
            // SidecarApp passes merged query params + parsed JSON body object directly
            const params = data && typeof data === "object" ? data : {};
            const result = await api.handle(params);
            return new Response(JSON.stringify(result.data), {
              status: result.status || 200,
              contentType: "application/json; charset=utf-8",
            });
          } catch (error) {
            return new Response(
              JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
              { status: 400, contentType: "application/json; charset=utf-8" }
            );
          }
        },
        api.method
      );
    }

    const sdkServer = await app.run();
    closeHttp = () =>
      new Promise((resolve) => {
        if (sdkServer && typeof sdkServer.close === "function") {
          sdkServer.close(() => resolve());
        } else {
          resolve();
        }
      });
  } else {
    const previewPort = Number(process.env.STAR_SUITE_PREVIEW_PORT || 0);
    const standalone = await startStandaloneHttpServer(service, { port: previewPort });
    closeHttp = standalone.close;
    console.log(`[star-suite] standalone panel preview running at ${standalone.url}`);
  }

  let watchdogTimer = null;
  let lockFile = "";
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    if (watchdogTimer) clearInterval(watchdogTimer);
    if (lockFile) {
      try {
        const cur = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (cur && cur.pid === process.pid) fs.unlinkSync(lockFile);
      } catch {}
    }
    try {
      if (closeHttp) await closeHttp();
    } catch {}
    try {
      await service.stop();
    } catch {}
    process.exit(0);
  };

  if (process.env.ANTIGRAVITY_SIDECAR_WEB_PORT) {
    const lockDir = path.join(os.homedir(), ".antigravity-dream-skin");
    lockFile = path.join(lockDir, "star-suite-sidecar.pid.json");
    try {
      fs.mkdirSync(lockDir, { recursive: true });
      fs.writeFileSync(lockFile, JSON.stringify({ pid: process.pid, ppid: process.ppid, startedAt: Date.now() }), "utf8");
    } catch {}

    const isPidAlive = (pid) => {
      if (!pid || pid <= 1) return true;
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return err && err.code === "EPERM";
      }
    };

    let grandparentPid = 0;
    if (process.platform === "win32" && process.ppid > 1) {
      execFile(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-Command", `(Get-CimInstance Win32_Process -Filter 'ProcessId=${process.ppid}').ParentProcessId`],
        { encoding: "utf8", windowsHide: true, timeout: 5000 },
        (err, stdout) => {
          if (!err) {
            const parsed = Number(String(stdout || "").trim());
            if (Number.isInteger(parsed) && parsed > 1) grandparentPid = parsed;
          }
        }
      );
    }

    watchdogTimer = setInterval(() => {
      if (!isPidAlive(process.ppid) || (grandparentPid > 1 && !isPidAlive(grandparentPid))) {
        shutdown();
        return;
      }
      try {
        const lock = JSON.parse(fs.readFileSync(lockFile, "utf8"));
        if (lock && typeof lock.pid === "number" && lock.pid !== process.pid && isPidAlive(lock.pid)) {
          shutdown();
        }
      } catch {}
    }, 4000);
    watchdogTimer.unref?.();
  }

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

const isEntrypoint =
  Boolean(process.argv[1]) &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  runSidecarRuntime().catch((error) => {
    console.error("[star-suite] fatal startup error:", error);
    process.exit(1);
  });
}
