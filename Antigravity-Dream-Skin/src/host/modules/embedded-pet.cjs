// MIT License — Clean-room embedded desktop companion module for Antigravity Star Suite.
// Serialized into the Antigravity host window via CDP (Function.prototype.toString()).
// MUST remain 100% self-contained inside installEmbeddedPet (no external requires or closures).

const EMBEDDED_PET_REV = 5;
const EMBEDDED_PET_GLOBAL_KEY = "__agyMaomaoPet";

const EMBEDDED_PET_ASSETS = {
  pet: ["idle.png", "blink.png", "proud-v3.png", "sad-v3.png"],
  audio: [
    "original-press.wav",
    "original-release.wav",
    "bubble-pop-press.wav",
    "bubble-pop-release.wav",
    "wood-tap-press.wav",
    "wood-tap-release.wav",
    "interaction-press.wav",
    "interaction-release.wav",
  ],
  dialogue: ["zh-CN.json"],
};

function installEmbeddedPet(rawConfig) {
  const GLOBAL_KEY = "__agyMaomaoPet";
  const PET_REV = 5;
  const ROOT_ID = "agy-maomao-pet-root";
  const STORAGE_KEY = "agy.maomao.pet.pos.v1";
  const EDGE_MARGIN = 0;
  const BOTTOM_MARGIN = 0;
  const SNAP_RADIUS = 120;
  const BASE_PET_WIDTH = 176;
  const PET_ASPECT = 1146 / 1372; // native gemini-star-v1 frame ratio (1372x1146)

  const win = typeof window !== "undefined" ? window : globalThis;
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return { applied: false, reason: "no-document", rev: PET_REV };

  const SOUND_PACKS = {
    original: { press: "original-press.wav", release: "original-release.wav", gain: 1.0 },
    "bubble-pop": { press: "bubble-pop-press.wav", release: "bubble-pop-release.wav", gain: 0.55 },
    "wood-tap": { press: "wood-tap-press.wav", release: "wood-tap-release.wav", gain: 0.55 },
    "soft-spring": { press: "interaction-press.wav", release: "interaction-release.wav", gain: 0.55 },
    interaction: { press: "interaction-press.wav", release: "interaction-release.wav", gain: 0.55 },
  };

  const DEFAULT_DIALOGUE = {
    idle: [
      "才、才不是特意陪你的！",
      "本喵可是星语猫猫，记住啦。",
      "Token 可以省，夸夸不能省。",
      "怎么，又被本喵可爱到了？",
      "少熬夜！才不是担心你呢。",
      "代码写累了？准你摸一下耳朵。",
      "看什么看，本喵只是在等你。",
      "哼，这么安静，是在憋大招？",
      "星星归天空，本喵归……才不告诉你！",
      "人类，今天也要记得喝水。",
      "本喵没摸鱼，只是在进行低功耗推理。",
      "先保存文件，再夸本喵，两件都很重要。",
      "报错红了？别慌，本喵的脸可没红。",
      "提交之前看一眼 diff，少掉两根头发。",
      "你说收到，本喵说喵到。",
      "星星有引力，本喵有脾气。",
      "才没有等你回来，窗口刚好开着而已。",
      "晚点再走嘛，本喵还有一颗星星没数完。",
    ],
    thinking: [
      "思考中…别催，在长脑子了。",
      "思考中…本喵认真起来，你可看好了。",
      "思考中…让我捋捋，脑袋还没冒烟呢。",
      "思考中…喵式推理中，先别揪耳朵。",
      "思考中…聪明猫猫也要想一下的嘛。",
    ],
    success: [
      "又走完一步啦，夸本喵！",
      "小小一步，得意一下怎么了？",
      "这一步完成了，本喵记着呢。",
    ],
    proud: [
      "哼，天才猫猫得意一下怎么了？",
      "看吧，本喵就是这么厉害。",
      "不许偷笑，快夸本喵可爱！",
    ],
    warning: [
      "额度偏低啦，省着点用！才不是怕你不够。",
      "注意额度窗口哦，别太逞强啦。",
    ],
    error: [
      "这步没走通，陪你再看看。",
      "哼，报错而已，一起查就是了。",
      "本喵也会卡壳，不许笑！",
    ],
    crying: [
      "才、才没哭！眼睛在散热！",
      "只是想要夸夸，才没委屈呢。",
      "哼，摸摸头就原谅你。",
    ],
    petting: [
      "只准摸一下……再一下也行。",
      "哼，手法还算合格。",
      "谁、谁在呼噜？反正不是本喵。",
    ],
    dragged: [
      "本喵会走路！放下来啦。",
      "轻点拎，呆毛要乱了！",
    ],
    pressed: [
      "喵？有事求本喵？",
      "哼，戳到聪明猫猫了。",
    ],
    release: [
      "站稳了！才没有晃。",
      "本喵的弹性，满分。",
    ],
  };

  const SVG_EFFECTS = {
    heart:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><path d="M24 41 7 25C-4 12 12 1 24 13 36 1 52 12 41 25Z" fill="#f5a8d4" stroke="#b867a7" stroke-width="2.5" stroke-linejoin="round"/><path d="M11 16q3-5 7-1" fill="none" stroke="#fff2fa" stroke-width="3" stroke-linecap="round"/></svg>',
    sparkle:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="m32 5 7 20 20 7-20 7-7 20-7-20L5 32l20-7Z" fill="#fff4b5" stroke="#c69b3c" stroke-width="2.5"/><path d="m32 14 5 13 13 5-13 5-5 13-5-13-13-5 13-5Z" fill="#c2dcff"/><path d="m32 14 5 13 13 5H32Z" fill="#f0b0f4"/></svg>',
    teardrop:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 44"><path d="M16 3C13 13 4 21 4 29a12 12 0 0 0 24 0c0-8-9-16-12-26Z" fill="#9ce1f5" stroke="#61b5d5" stroke-width="2.5"/><ellipse cx="12" cy="27" rx="3" ry="5" fill="#edfbff"/></svg>',
    thinking:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 88 48"><path d="M19 5h49a14 14 0 0 1 0 28H31l-9 9 1-9h-4a14 14 0 0 1 0-28Z" fill="#faf7ff" stroke="#b5a7e4" stroke-width="2"/><g fill="#8271c9"><circle cx="29" cy="19" r="3.2"/><circle cx="44" cy="19" r="3.2"/><circle cx="59" cy="19" r="3.2"/></g></svg>',
  };

  // Fallback minimalist star-cat chibi SVG shown only if idle.png fails to load
  const FALLBACK_CAT_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 156" aria-hidden="true">' +
    '<defs><linearGradient id="agyCatGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e9ddff"/><stop offset="100%" stop-color="#c3aef7"/></linearGradient></defs>' +
    '<path d="M44 58 34 18l36 22c12-4 28-4 40 0l36-22-10 40c12 14 18 32 16 52-3 24-28 38-62 38s-59-14-62-38c-2-20 4-38 16-52Z" fill="url(#agyCatGrad)" stroke="#6d56b0" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M48 48 44 27l19 12Z" fill="#f7b7df"/><path d="M132 48l4-21-19 12Z" fill="#f7b7df"/>' +
    '<circle cx="67" cy="84" r="7" fill="#3a2c63"/><circle cx="113" cy="84" r="7" fill="#3a2c63"/>' +
    '<circle cx="69" cy="81" r="2.2" fill="#fff"/><circle cx="115" cy="81" r="2.2" fill="#fff"/>' +
    '<path d="M84 96q6 6 12 0" fill="none" stroke="#5c4498" stroke-width="3" stroke-linecap="round"/>' +
    '<ellipse cx="52" cy="96" rx="8" ry="4.5" fill="#f5a8d4" opacity="0.7"/>' +
    '<ellipse cx="128" cy="96" rx="8" ry="4.5" fill="#f5a8d4" opacity="0.7"/>' +
    '<path d="m90 22 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="#ffe999" stroke="#c89a38" stroke-width="1.5"/>' +
    "</svg>";

  function clamp(num, def, min, max) {
    const n = Number(num);
    if (!Number.isFinite(n)) return def;
    return Math.min(max, Math.max(min, n));
  }

  function normalizeConfig(input, prev) {
    const src = input && typeof input === "object" ? input : {};
    const nested = src.embeddedPet && typeof src.embeddedPet === "object" ? src.embeddedPet : {};
    const merged = Object.assign({}, prev || {}, src, nested);
    const rawDock = String(merged.dock || "right").toLowerCase();
    const dock = rawDock === "left" || rawDock === "free" ? rawDock : "right";
    const rawPack = String(merged.soundPack || merged.soundSet || "original").toLowerCase();
    const soundPack = SOUND_PACKS[rawPack] ? rawPack : "original";
    return {
      owner: typeof merged.owner === "string" && merged.owner ? merged.owner : prev?.owner || "maomao-pet",
      enabled: merged.enabled !== false,
      scale: Math.round(clamp(merged.scale, 100, 60, 160)),
      dock,
      snap: merged.snap !== false,
      opacity: Math.round(clamp(merged.opacity, 100, 20, 100)),
      soundEnabled: merged.soundEnabled !== undefined ? Boolean(merged.soundEnabled) : merged.sound !== false,
      soundPack,
      volume: Math.round(clamp(merged.volume, 60, 0, 100)),
      showBubbles: merged.showBubbles !== undefined ? Boolean(merged.showBubbles) : merged.bubbleOn !== false,
      hideWhenZen: merged.hideWhenZen !== false,
      reducedMotion: Boolean(merged.reducedMotion),
      assetBaseUrl: typeof merged.assetBaseUrl === "string" ? merged.assetBaseUrl.trim() : "",
      sidecarBaseUrl: typeof merged.sidecarBaseUrl === "string" ? merged.sidecarBaseUrl.trim().replace(/\/+$/, "") : "",
      sidecarToken: typeof merged.sidecarToken === "string" ? merged.sidecarToken.trim() : "",
      dialogue: merged.dialogue && typeof merged.dialogue === "object" ? merged.dialogue : null,
      quipProbability: clamp(merged.quipProbability, 0.15, 0, 1),
      telemetryPollMs: Math.round(clamp(merged.telemetryPollMs, 8000, 1500, 60000)),
    };
  }

  function buildAssetUrl(base, kind, file) {
    if (!base || !file) return "";
    const encKind = encodeURIComponent(kind);
    const encFile = encodeURIComponent(file);
    if (/[?&]kind=$/i.test(base)) {
      return base + encKind + "&file=" + encFile;
    }
    if (/[?&]kind=/i.test(base)) {
      return base + "&file=" + encFile;
    }
    const sep = base.includes("?") ? "&" : "?";
    const prefix = base.includes("/asset") ? base : base.replace(/\/+$/, "") + "/asset";
    return prefix + sep + "kind=" + encKind + "&file=" + encFile;
  }

  function buildApiUrl(cfgObj, apiPath) {
    if (!cfgObj.sidecarBaseUrl) return "";
    const base = cfgObj.sidecarBaseUrl + apiPath;
    if (!cfgObj.sidecarToken) return base;
    return base + "?token=" + encodeURIComponent(cfgObj.sidecarToken);
  }

  function parseTimestampMs(raw) {
    if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
      return raw < 1e12 ? Math.round(raw * 1000) : Math.round(raw);
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Date.parse(raw.trim());
      if (Number.isFinite(parsed) && parsed > 0) return parsed;
    }
    return null;
  }

  function formatResetCountdown(resetAt, nowMs) {
    const targetMs = parseTimestampMs(resetAt);
    if (targetMs === null) return "";
    const diffMs = targetMs - (typeof nowMs === "number" ? nowMs : Date.now());
    if (!Number.isFinite(diffMs)) return "";
    if (diffMs <= 0) return "即将重置";
    const totalMin = Math.ceil(diffMs / 60000);
    if (totalMin < 60) return totalMin + "m 后重置";
    const hours = Math.floor(totalMin / 60);
    const mins = totalMin % 60;
    if (hours < 24) {
      return hours + "h" + (mins > 0 ? " " + mins + "m" : "") + " 后重置";
    }
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return days + "天" + (remHours > 0 ? " " + remHours + "h" : "") + " 后重置";
  }

  function normalizePercent(val) {
    if (typeof val !== "number" || !Number.isFinite(val)) return null;
    return Math.max(0, Math.min(100, Number(val.toFixed(1))));
  }

  function normalizeQuotaSnapshot(raw) {
    if (!raw || typeof raw !== "object") return null;
    const src =
      (raw.quota && typeof raw.quota === "object" ? raw.quota : null) ||
      (raw.quotas && typeof raw.quotas === "object" ? raw.quotas : null) ||
      raw;
    const rawGroups = Array.isArray(src.groups) ? src.groups : [];
    const groups = [];

    for (let i = 0; i < rawGroups.length; i++) {
      const g = rawGroups[i];
      if (!g || typeof g !== "object") continue;
      const w = g.windows && typeof g.windows === "object" ? g.windows : {};
      const w5 = w["5h"] || w.fiveHour || {};
      const ww = w.weekly || w["7d"] || {};
      const r5 = normalizePercent(
        typeof w5.remaining === "number"
          ? w5.remaining
          : typeof w5.remainingFraction === "number"
            ? w5.remainingFraction * 100
            : null
      );
      const rw = normalizePercent(
        typeof ww.remaining === "number"
          ? ww.remaining
          : typeof ww.remainingFraction === "number"
            ? ww.remainingFraction * 100
            : null
      );
      groups.push({
        id: String(g.id || "pool-" + i),
        name: String(g.name || g.displayName || "Gemini Models"),
        fiveHour: { remaining: r5, resetAt: parseTimestampMs(w5.resetAt ?? w5.resetTimeMs) },
        weekly: { remaining: rw, resetAt: parseTimestampMs(ww.resetAt ?? ww.resetTimeMs) },
      });
    }

    if (groups.length === 0 && (typeof src.fiveHour === "number" || typeof src.weekly === "number")) {
      groups.push({
        id: "gemini-pro",
        name: "Gemini Models",
        fiveHour: { remaining: normalizePercent(src.fiveHour), resetAt: parseTimestampMs(src.fiveHourResetAt) },
        weekly: { remaining: normalizePercent(src.weekly), resetAt: parseTimestampMs(src.weeklyResetAt) },
      });
    }

    return {
      status: String(src.status || (groups.length > 0 ? "ready" : "quota-unavailable")),
      online: Boolean(src.online),
      cached: Boolean(src.cached),
      stale: Boolean(src.stale),
      fetchedAt: parseTimestampMs(src.fetchedAt),
      observedAt: parseTimestampMs(src.observedAt),
      groups,
    };
  }

  const initialCfg = normalizeConfig(rawConfig, null);

  // Idempotent takeover / hot-update handling
  if (win[GLOBAL_KEY]) {
    const existing = win[GLOBAL_KEY];
    if (!initialCfg.enabled) {
      try {
        existing.destroy();
      } catch {}
      return { applied: false, disabled: true, rev: PET_REV };
    }
    if (existing.owner === initialCfg.owner && existing.rev === PET_REV && existing.status?.().applied) {
      existing.touch?.();
      existing.update(rawConfig);
      return existing.status();
    }
    try {
      existing.destroy();
    } catch {}
  } else if (!initialCfg.enabled) {
    return { applied: false, disabled: true, rev: PET_REV };
  }

  // Remove any orphaned root node from a crashed previous injection
  try {
    const staleRoot = doc.getElementById?.(ROOT_ID);
    if (staleRoot && typeof staleRoot.remove === "function") staleRoot.remove();
  } catch {}

  let cfg = initialCfg;
  let destroyed = false;
  let visible = true;
  let windowFocused = typeof doc.hasFocus === "function" ? doc.hasFocus() !== false : true;
  let docHidden = Boolean(doc.hidden);
  let paused = false;

  // Pet state
  let persistentState = "idle"; // idle | thinking | warning | error
  let transientState = null; // pressed | dragged | release | petting | success
  let activeExpression = null; // null | proud | sad
  let isBlinking = false;
  let bubbleOpen = false;
  let bubbleMode = "quip"; // "quip" | "quota"
  let bubbleHover = false;
  let currentBubbleText = "";
  let currentBubbleMeta = "";
  let currentBubbleTone = "normal";
  let currentFacing = "right";
  let currentMirrored = false;
  let currentSurfaceMode = "light";

  function detectHostDark() {
    try {
      const htmlEl = doc.documentElement;
      const bodyEl = doc.body;
      const htmlTheme = String(htmlEl?.getAttribute?.("data-theme") || "").toLowerCase();
      const bodyTheme = String(bodyEl?.getAttribute?.("data-theme") || "").toLowerCase();
      if (htmlTheme === "dark" || bodyTheme === "dark") return true;
      if (htmlTheme === "light" || bodyTheme === "light") return false;
      if (
        htmlEl?.classList?.contains?.("dark") ||
        htmlEl?.classList?.contains?.("dark-theme") ||
        bodyEl?.classList?.contains?.("dark") ||
        bodyEl?.classList?.contains?.("dark-theme")
      ) {
        return true;
      }
      if (
        htmlEl?.classList?.contains?.("light") ||
        htmlEl?.classList?.contains?.("light-theme") ||
        bodyEl?.classList?.contains?.("light") ||
        bodyEl?.classList?.contains?.("light-theme")
      ) {
        return false;
      }
      if (typeof win.matchMedia === "function") {
        const mq = win.matchMedia("(prefers-color-scheme: dark)");
        if (mq && typeof mq.matches === "boolean") return mq.matches;
      }
    } catch {}
    return false;
  }

  function detectSurfaceMode() {
    let isGlass = false;
    try {
      isGlass = Boolean(
        doc.documentElement?.classList?.contains?.("agy-dream-active-v2") ||
          doc.getElementById?.("agy-dream-wallpaper-v2")
      );
    } catch {}
    const isDark = detectHostDark();
    return isGlass ? (isDark ? "glass-dark" : "glass-light") : isDark ? "dark" : "light";
  }

  // Quota state
  let latestQuota = null;
  let quotaFetchedAt = 0;
  let quotaLoading = false;
  let quotaPoolIdx = 0;

  // Asset availability flags
  const frameReady = { idle: false, blink: false, proud: false, sad: false };
  const frameFailed = { idle: false, blink: false, proud: false, sad: false };
  let idleRetryCount = 0;

  // Dialogue store (mutable so fetched zh-CN.json can enrich it)
  const dialogueBank = {};
  for (const k of Object.keys(DEFAULT_DIALOGUE)) {
    dialogueBank[k] = DEFAULT_DIALOGUE[k].slice();
  }
  const lastLineByKind = new Map();

  function mergeDialogue(source) {
    if (!source || typeof source !== "object") return;
    const lines = source.lines && typeof source.lines === "object" ? source.lines : source;
    for (const key of Object.keys(lines)) {
      if (Array.isArray(lines[key])) {
        const clean = lines[key].filter((item) => typeof item === "string" && item.trim().length > 0);
        if (clean.length > 0) dialogueBank[key] = clean;
      }
    }
  }
  if (cfg.dialogue) mergeDialogue(cfg.dialogue);

  function pickLine(kind) {
    const normalized = kind === "sad" ? "crying" : kind;
    const pool =
      (Array.isArray(dialogueBank[normalized]) && dialogueBank[normalized].length ? dialogueBank[normalized] : null) ||
      dialogueBank.idle ||
      DEFAULT_DIALOGUE.idle;
    const prev = lastLineByKind.get(normalized);
    const filtered = pool.length > 1 ? pool.filter((item) => item !== prev) : pool;
    const list = filtered.length ? filtered : pool;
    const line = list[Math.floor(Math.random() * list.length) % list.length];
    lastLineByKind.set(normalized, line);
    return line;
  }

  // Timers & observers registry (all cleared on destroy)
  let blinkTimer = null;
  let blinkOffTimer = null;
  let bubbleTimer = null;
  let expressionTimer = null;
  let transientTimer = null;
  let telemetryTimer = null;
  let obsDebounceTimer = null;
  let idleRetryTimer = null;
  let snapTransitionTimer = null;
  let mutObserver = null;
  let themeObserver = null;
  const particleTimers = new Set();
  const cleanups = [];

  function on(target, event, handler, options) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(event, handler, options);
    cleanups.push(() => {
      try {
        target.removeEventListener?.(event, handler, options);
      } catch {}
    });
  }

  // Audio playback (per-phase anti-spam so rapid press -> release pairs both play cleanly)
  let activeAudio = null;
  const lastAudioAtByPhase = { press: 0, release: 0 };

  function stopAudio() {
    if (activeAudio) {
      try {
        activeAudio.pause?.();
        activeAudio.currentTime = 0;
      } catch {}
      activeAudio = null;
    }
  }

  function playSound(phase) {
    if (destroyed || !cfg.soundEnabled || cfg.volume <= 0 || !cfg.assetBaseUrl) return;
    const key = phase === "release" ? "release" : "press";
    const now = Date.now();
    if (now - (lastAudioAtByPhase[key] || 0) < 45) return;
    lastAudioAtByPhase[key] = now;
    const pack = SOUND_PACKS[cfg.soundPack] || SOUND_PACKS.original;
    const file = key === "release" ? pack.release : pack.press;
    const url = buildAssetUrl(cfg.assetBaseUrl, "audio", file);
    if (!url) return;
    const AudioCtor =
      typeof win.Audio === "function" ? win.Audio : typeof Audio === "function" ? Audio : null;
    if (!AudioCtor) return;
    stopAudio();
    try {
      const audio = new AudioCtor(url);
      audio.volume = clamp((cfg.volume / 100) * pack.gain, 0.5, 0, 1);
      activeAudio = audio;
      const playRes = audio.play?.();
      if (playRes && typeof playRes.catch === "function") {
        playRes.catch(() => {});
      }
    } catch {}
  }

  // Viewport & geometry helpers
  function viewportSize() {
    const w = Number(win.innerWidth) || Number(doc.documentElement?.clientWidth) || 1280;
    const h = Number(win.innerHeight) || Number(doc.documentElement?.clientHeight) || 720;
    return { w: Math.max(320, w), h: Math.max(240, h) };
  }

  function petDimensions() {
    const scaleRatio = cfg.scale / 100;
    const width = Math.round(BASE_PET_WIDTH * scaleRatio);
    const height = Math.round(width * PET_ASPECT);
    return { width, height, scaleRatio };
  }

  function defaultPositionForDock(dockMode) {
    const { w, h } = viewportSize();
    const { width, height } = petDimensions();
    const y = Math.max(EDGE_MARGIN, h - height - BOTTOM_MARGIN);
    if (dockMode === "left") {
      return { x: EDGE_MARGIN, y, dockedSide: "left" };
    }
    return {
      x: Math.max(EDGE_MARGIN, w - width - EDGE_MARGIN),
      y,
      dockedSide: dockMode === "free" ? "" : "right",
    };
  }

  function clampPosition(x, y) {
    const { w, h } = viewportSize();
    const { width, height } = petDimensions();
    const maxX = Math.max(EDGE_MARGIN, w - width - EDGE_MARGIN);
    const maxY = Math.max(EDGE_MARGIN, h - height - EDGE_MARGIN);
    return {
      x: Math.round(clamp(x, maxX, EDGE_MARGIN, maxX)),
      y: Math.round(clamp(y, maxY, EDGE_MARGIN, maxY)),
    };
  }

  function loadSavedPosition() {
    try {
      const storage = win.localStorage;
      if (!storage || typeof storage.getItem !== "function") return null;
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
      return parsed;
    } catch {
      return null;
    }
  }

  function savePosition() {
    try {
      const storage = win.localStorage;
      if (!storage || typeof storage.setItem !== "function") return;
      const { w, h } = viewportSize();
      storage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          x: posX,
          y: posY,
          dockedSide,
          vw: w,
          vh: h,
        })
      );
    } catch {}
  }

  // Initialize coordinates (0px flush corners when snapped; exact clamped coordinates when snap=false)
  let posX = 0;
  let posY = 0;
  let dockedSide = cfg.snap && cfg.dock !== "free" ? cfg.dock : "";
  {
    const saved = loadSavedPosition();
    if (saved) {
      const clamped = clampPosition(saved.x, saved.y);
      posX = clamped.x;
      posY = clamped.y;
      if (cfg.snap && cfg.dock !== "free") {
        if (saved.dockedSide === "left" || saved.dockedSide === "right") {
          const flush = defaultPositionForDock(saved.dockedSide);
          posX = flush.x;
          posY = flush.y;
          dockedSide = flush.dockedSide;
        } else {
          dockedSide = "";
        }
      } else {
        dockedSide = "";
      }
    } else {
      const def = defaultPositionForDock(cfg.dock);
      posX = def.x;
      posY = def.y;
      dockedSide = cfg.snap && cfg.dock !== "free" ? def.dockedSide : "";
    }
  }

  // Create Shadow DOM host
  const host = doc.createElement("div");
  host.id = ROOT_ID;
  host.setAttribute("data-agy-maomao-pet", "1");
  host.setAttribute("data-owner", cfg.owner);
  host.style.cssText =
    "position:fixed;left:0;top:0;width:0;height:0;overflow:visible;z-index:2147483000;pointer-events:none;contain:layout style;";

  const shadow =
    typeof host.attachShadow === "function" ? host.attachShadow({ mode: "open" }) : host;

  const styleEl = doc.createElement("style");
  styleEl.textContent = `
:host {
  all: initial;
  position: fixed;
  left: 0;
  top: 0;
  width: 0;
  height: 0;
  overflow: visible;
  z-index: 2147483000;
  pointer-events: none;
  font-family: "Microsoft YaHei UI", "PingFang SC", "Segoe UI", system-ui, sans-serif;
}
* { box-sizing: border-box; }
[hidden] { display: none !important; }

.pet-stage {
  --pet-width: 176px;
  --pet-scale: 1;
  --pet-bubble-scale: 1;
  --pet-opacity: 1;
  position: fixed;
  left: 0;
  top: 0;
  width: var(--pet-width);
  opacity: var(--pet-opacity);
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
  will-change: transform;
  transform: translate3d(0px, 0px, 0);
}
.pet-stage[data-snapping="true"] {
  transition: transform 320ms cubic-bezier(.22, 1.18, .36, 1);
}
.pet-stage[data-hidden="true"] {
  display: none !important;
}
.pet-stage[data-paused="true"],
.pet-stage[data-paused="true"] * {
  animation-play-state: paused !important;
}
.pet-stage[data-reduced-motion="true"],
.pet-stage[data-reduced-motion="true"] * {
  animation: none !important;
  transition: none !important;
}
@media (prefers-reduced-motion: reduce) {
  .pet-stage, .pet-stage * {
    animation: none !important;
    transition: none !important;
  }
}

.pet-hit {
  position: relative;
  width: 100%;
  pointer-events: auto;
  cursor: grab;
  touch-action: none;
  outline: none;
}
.pet-hit:active,
.pet-stage[data-state="dragged"] .pet-hit {
  cursor: grabbing;
}
.pet-hit:focus-visible .pet-motion {
  filter: drop-shadow(0 0 8px rgba(176, 146, 245, 0.85));
}

.pet-motion {
  position: relative;
  width: 100%;
  transform-origin: 50% 100%;
  filter: drop-shadow(0 8px 18px rgba(32, 20, 62, 0.28));
}
.pet-stage[data-state="idle"] .pet-motion {
  animation: agy-pet-breath 4.2s ease-in-out infinite;
}
.pet-stage[data-state="thinking"] .pet-motion {
  animation: agy-pet-ponder 3.2s ease-in-out infinite;
}
.pet-stage[data-state="success"] .pet-motion {
  animation: agy-pet-duang 680ms ease-out 1 both;
}
.pet-stage[data-state="warning"] .pet-motion,
.pet-stage[data-state="error"] .pet-motion {
  animation: agy-pet-worry 3.4s ease-in-out infinite;
}
.pet-stage[data-state="release"] .pet-motion {
  animation: agy-pet-rebound 520ms cubic-bezier(.22, 1.25, .36, 1) 1 both;
}
.pet-stage[data-state="petting"] .pet-motion {
  animation: agy-pet-nuzzle 1.4s ease-in-out 1 both;
}

/* Sprite layer ONLY mirrors horizontally so bubble/close/text NEVER flip.
   Matches Antigravity-Cat-Widget/src/renderer/widget.css L37 & src/main/index.cjs L49/145:
   native idle.png faces inward-left for right-dock (transform: none),
   and mirrors horizontally (rotateY(180deg)) on left-dock so the cat always faces inward toward chat. */
.pet-face {
  position: relative;
  width: 100%;
  aspect-ratio: 1372 / 1146;
  line-height: 0;
  transform-origin: 50% 100%;
  transform: none;
  transition: transform 240ms cubic-bezier(.22, .7, .3, 1), scale 170ms cubic-bezier(.2, .85, .3, 1.35);
  scale: 1;
}
.pet-stage[data-facing="left"] .pet-face {
  transform: rotateY(180deg);
}
.pet-stage[data-pressed="true"]:not([data-state="dragged"]) .pet-face {
  scale: 1.07 0.87;
}

.pet-frame {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: contain;
  display: block;
  user-select: none;
  -webkit-user-drag: none;
  pointer-events: none;
}
.pet-frame--idle { opacity: 1; }
.pet-frame--blink,
.pet-frame--proud,
.pet-frame--sad { opacity: 0; }
.pet-stage[data-blink="true"] .pet-frame--blink { opacity: 1; }
.pet-stage[data-blink="true"] .pet-frame--idle { opacity: 0; }
.pet-stage[data-expression="proud"] .pet-frame--proud { opacity: 1; }
.pet-stage[data-expression="proud"] .pet-frame--idle,
.pet-stage[data-expression="proud"] .pet-frame--blink { opacity: 0; }
.pet-stage[data-expression="sad"] .pet-frame--sad { opacity: 1; }
.pet-stage[data-expression="sad"] .pet-frame--idle,
.pet-stage[data-expression="sad"] .pet-frame--blink { opacity: 0; }

.pet-fallback {
  position: absolute;
  inset: 4%;
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.pet-fallback svg {
  width: 100%;
  height: 100%;
}
.pet-stage[data-fallback="svg"] .pet-fallback { display: flex; }
.pet-stage[data-fallback="svg"] .pet-frame { opacity: 0 !important; }

/* Persistent thinking dots indicator:
   thinking-dots.svg native tail points bottom-left (↙).
   - data-facing="right" (native unflipped idle.png): open crown pocket is top-right (top: 4%, right: 1%),
     SVG stays scaleX(1) so the ↙ tail points directly into her head without touching her right ear or ahoge,
     and stays 100% inside the viewport even with 0px flush corner docking.
   - data-facing="left" (mirrored idle.png): open crown pocket is top-left (top: 4%, left: 1%),
     SVG flips scaleX(-1) so the ↘ tail points directly into her head without touching her ear or ahoge. */
.pet-thinking-dots {
  position: absolute;
  top: 4%;
  right: 1%;
  left: auto;
  width: 28%;
  opacity: 0;
  pointer-events: none;
  filter: drop-shadow(0 2px 6px rgba(108, 86, 186, 0.34));
  transition: opacity 180ms ease;
}
.pet-thinking-dots svg {
  width: 100%;
  height: auto;
  display: block;
  transform: scaleX(1);
  transform-origin: 50% 50%;
}
.pet-stage[data-facing="left"] .pet-thinking-dots {
  left: 1%;
  right: auto;
}
.pet-stage[data-facing="left"] .pet-thinking-dots svg {
  transform: scaleX(-1);
}
.pet-stage[data-state="thinking"] .pet-thinking-dots {
  opacity: 1;
  animation: agy-pet-float 1.9s ease-in-out infinite;
}

/* Particle burst layer */
.pet-particles {
  position: absolute;
  inset: -14% -12% 0 -12%;
  pointer-events: none;
  overflow: visible;
}
.pet-particle {
  position: absolute;
  width: calc(26px * var(--pet-scale));
  height: calc(26px * var(--pet-scale));
  pointer-events: none;
  animation: agy-pet-particle 1150ms cubic-bezier(.18, .85, .3, 1) forwards;
}
.pet-particle svg {
  width: 100%;
  height: 100%;
  display: block;
}

/* Speech & Quota bubble — proportionally scaled with character (fixes upstream Issue #1!)
   Lives outside .pet-face so it is NEVER horizontally mirrored.
   Full 4-surface theme support: light | dark | glass-light | glass-dark */
.pet-bubble {
  position: absolute;
  bottom: calc(100% + 34px * var(--pet-bubble-scale));
  left: 50%;
  transform: translateX(-50%) translateY(8px) scale(0.84);
  width: calc(248px * var(--pet-bubble-scale));
  max-width: min(calc(280px * var(--pet-bubble-scale)), calc(100vw - 28px));
  padding: calc(11px * var(--pet-bubble-scale)) calc(14px * var(--pet-bubble-scale));
  border-radius: calc(18px * var(--pet-bubble-scale));
  border: 1.5px solid rgba(184, 154, 244, 0.78);
  background:
    radial-gradient(circle at 16% 20%, rgba(250, 224, 255, 0.94) 0, transparent 42%),
    radial-gradient(circle at 86% 78%, rgba(218, 232, 255, 0.92) 0, transparent 46%),
    linear-gradient(135deg, rgba(255, 250, 255, 0.98), rgba(238, 230, 255, 0.97));
  color: #4d2f82;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 8px 24px rgba(58, 36, 108, 0.22),
    0 0 14px rgba(182, 146, 250, 0.3);
  pointer-events: none;
  cursor: pointer;
  opacity: 0;
  transition: opacity 180ms ease, transform 220ms cubic-bezier(.2, .85, .3, 1.2), background 180ms ease, border-color 180ms ease;
  z-index: 5;
}
.pet-bubble[data-open="true"] {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
  pointer-events: auto;
}
.pet-stage[data-align="right"] .pet-bubble {
  left: auto;
  right: 6px;
  transform: translateY(8px) scale(0.84);
  transform-origin: 85% 100%;
}
.pet-stage[data-align="right"] .pet-bubble[data-open="true"] {
  transform: translateY(0) scale(1);
}
.pet-stage[data-align="left"] .pet-bubble {
  left: 6px;
  right: auto;
  transform: translateY(8px) scale(0.84);
  transform-origin: 15% 100%;
}
.pet-stage[data-align="left"] .pet-bubble[data-open="true"] {
  transform: translateY(0) scale(1);
}
.pet-stage[data-vpos="below"] .pet-bubble {
  bottom: auto;
  top: calc(100% + 34px * var(--pet-bubble-scale));
}

/* Three graduating thought-bubble tail dots (large -> medium -> small) curving toward cat head */
.pet-bubble-tail {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 0;
  pointer-events: none;
}
.pet-stage[data-vpos="below"] .pet-bubble-tail {
  bottom: auto;
  top: 0;
}
.pet-tail-dot {
  position: absolute;
  border-radius: 50%;
  background: #f2e8ff;
  border: 1.5px solid rgba(184, 154, 244, 0.78);
  box-shadow: 0 2px 8px rgba(90, 62, 154, 0.2), 0 0 8px rgba(196, 164, 255, 0.32);
}
.pet-tail-dot--lg {
  width: calc(16px * var(--pet-bubble-scale));
  height: calc(13px * var(--pet-bubble-scale));
  bottom: calc(-15px * var(--pet-bubble-scale));
  left: 52%;
  transform: translateX(-50%);
}
.pet-tail-dot--md {
  width: calc(11px * var(--pet-bubble-scale));
  height: calc(9px * var(--pet-bubble-scale));
  bottom: calc(-25px * var(--pet-bubble-scale));
  left: 48%;
  transform: translateX(-50%);
}
.pet-tail-dot--sm {
  width: calc(7px * var(--pet-bubble-scale));
  height: calc(6px * var(--pet-bubble-scale));
  bottom: calc(-33px * var(--pet-bubble-scale));
  left: 44%;
  transform: translateX(-50%);
}

/* Dock-aligned tail curves toward cat head on right / left */
.pet-stage[data-align="right"] .pet-tail-dot--lg { left: auto; right: calc(36px * var(--pet-bubble-scale)); transform: none; }
.pet-stage[data-align="right"] .pet-tail-dot--md { left: auto; right: calc(48px * var(--pet-bubble-scale)); transform: none; }
.pet-stage[data-align="right"] .pet-tail-dot--sm { left: auto; right: calc(56px * var(--pet-bubble-scale)); transform: none; }

.pet-stage[data-align="left"] .pet-tail-dot--lg { left: calc(36px * var(--pet-bubble-scale)); right: auto; transform: none; }
.pet-stage[data-align="left"] .pet-tail-dot--md { left: calc(48px * var(--pet-bubble-scale)); right: auto; transform: none; }
.pet-stage[data-align="left"] .pet-tail-dot--sm { left: calc(56px * var(--pet-bubble-scale)); right: auto; transform: none; }

/* Inverted vertical tail when bubble flips below cat */
.pet-stage[data-vpos="below"] .pet-tail-dot--lg { bottom: auto; top: calc(-15px * var(--pet-bubble-scale)); }
.pet-stage[data-vpos="below"] .pet-tail-dot--md { bottom: auto; top: calc(-25px * var(--pet-bubble-scale)); }
.pet-stage[data-vpos="below"] .pet-tail-dot--sm { bottom: auto; top: calc(-33px * var(--pet-bubble-scale)); }

/* Surface: glass-light (frosted lavender-porcelain star crystal glass) */
.pet-bubble[data-surface="glass-light"] {
  border-color: rgba(176, 144, 242, 0.66);
  background:
    radial-gradient(circle at 16% 20%, rgba(250, 224, 255, 0.62) 0, transparent 44%),
    radial-gradient(circle at 86% 78%, rgba(218, 232, 255, 0.58) 0, transparent 48%),
    linear-gradient(135deg, rgba(255, 250, 255, 0.76), rgba(238, 230, 255, 0.72));
  -webkit-backdrop-filter: blur(18px) saturate(155%);
  backdrop-filter: blur(18px) saturate(155%);
  color: #3e246e;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.92),
    0 10px 28px rgba(48, 28, 92, 0.18),
    0 0 16px rgba(182, 146, 250, 0.26);
}
.pet-bubble[data-surface="glass-light"] .pet-tail-dot {
  background: rgba(244, 236, 255, 0.84);
  border-color: rgba(176, 144, 242, 0.66);
}

/* Surface: dark (solid starlight night crystal) */
.pet-bubble[data-surface="dark"] {
  border-color: rgba(186, 158, 255, 0.52);
  background:
    radial-gradient(circle at 18% 18%, rgba(168, 142, 229, 0.24) 0, transparent 46%),
    radial-gradient(circle at 86% 80%, rgba(114, 156, 248, 0.18) 0, transparent 48%),
    linear-gradient(145deg, rgba(24, 20, 38, 0.97), rgba(16, 13, 28, 0.98));
  color: #f2ecff;
  box-shadow:
    inset 0 1px 0 rgba(236, 224, 255, 0.18),
    0 12px 30px rgba(4, 2, 14, 0.58),
    0 0 18px rgba(168, 136, 250, 0.28);
}
.pet-bubble[data-surface="dark"] .pet-tail-dot {
  background: #1a152b;
  border-color: rgba(186, 158, 255, 0.52);
  box-shadow: 0 3px 10px rgba(4, 2, 14, 0.5), 0 0 8px rgba(168, 136, 250, 0.26);
}

/* Surface: glass-dark (frosted translucent starlight night glass) */
.pet-bubble[data-surface="glass-dark"] {
  border-color: rgba(196, 170, 255, 0.46);
  background:
    radial-gradient(circle at 16% 18%, rgba(188, 158, 255, 0.22) 0, transparent 44%),
    radial-gradient(circle at 86% 80%, rgba(120, 172, 255, 0.16) 0, transparent 48%),
    linear-gradient(145deg, rgba(26, 21, 42, 0.72), rgba(16, 13, 30, 0.68));
  -webkit-backdrop-filter: blur(18px) saturate(155%);
  backdrop-filter: blur(18px) saturate(155%);
  color: #f5f0ff;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.24),
    0 12px 32px rgba(4, 2, 16, 0.5),
    0 0 18px rgba(176, 142, 255, 0.3);
}
.pet-bubble[data-surface="glass-dark"] .pet-tail-dot {
  background: rgba(24, 19, 40, 0.84);
  border-color: rgba(196, 170, 255, 0.46);
  box-shadow: 0 3px 10px rgba(4, 2, 16, 0.45), 0 0 8px rgba(176, 142, 255, 0.28);
}

/* Shared dark & glass-dark inner typography + glowing quota tracks */
.pet-bubble[data-surface="dark"] .pet-bubble-title,
.pet-bubble[data-surface="glass-dark"] .pet-bubble-title { color: #d8c2ff; }
.pet-bubble[data-surface="dark"] .pet-bubble-close,
.pet-bubble[data-surface="glass-dark"] .pet-bubble-close { color: #b7a4de; }
.pet-bubble[data-surface="dark"] .pet-bubble-close:hover,
.pet-bubble[data-surface="glass-dark"] .pet-bubble-close:hover { background: rgba(196, 172, 255, 0.16); color: #ffffff; }
.pet-bubble[data-surface="dark"] .pet-quota,
.pet-bubble[data-surface="glass-dark"] .pet-quota { border-bottom-color: rgba(186, 158, 255, 0.24); }
.pet-bubble[data-surface="dark"] .pet-quota-pool-name,
.pet-bubble[data-surface="glass-dark"] .pet-quota-pool-name { color: #e8dcff; }
.pet-bubble[data-surface="dark"] .pet-quota-nav button,
.pet-bubble[data-surface="glass-dark"] .pet-quota-nav button {
  border-color: rgba(196, 170, 255, 0.34);
  background: rgba(255, 255, 255, 0.08);
  color: #e4d8ff;
}
.pet-bubble[data-surface="dark"] .pet-quota-nav button:hover,
.pet-bubble[data-surface="glass-dark"] .pet-quota-nav button:hover { background: rgba(186, 158, 255, 0.24); }
.pet-bubble[data-surface="dark"] .pet-quota-page,
.pet-bubble[data-surface="glass-dark"] .pet-quota-page,
.pet-bubble[data-surface="dark"] .pet-quota-reset,
.pet-bubble[data-surface="glass-dark"] .pet-quota-reset,
.pet-bubble[data-surface="dark"] .pet-quota-caption,
.pet-bubble[data-surface="glass-dark"] .pet-quota-caption,
.pet-bubble[data-surface="dark"] .pet-bubble-meta,
.pet-bubble[data-surface="glass-dark"] .pet-bubble-meta { color: #b9a8dc; }
.pet-bubble[data-surface="dark"] .pet-quota-label,
.pet-bubble[data-surface="glass-dark"] .pet-quota-label { color: #d9ccf6; }
.pet-bubble[data-surface="dark"] .pet-quota-pct,
.pet-bubble[data-surface="glass-dark"] .pet-quota-pct { color: #e0ccff; }
.pet-bubble[data-surface="dark"] .pet-quota-pct[data-level="low"],
.pet-bubble[data-surface="glass-dark"] .pet-quota-pct[data-level="low"] { color: #fcd34d; }
.pet-bubble[data-surface="dark"] .pet-quota-pct[data-level="critical"],
.pet-bubble[data-surface="glass-dark"] .pet-quota-pct[data-level="critical"] { color: #fda4af; }
.pet-bubble[data-surface="dark"] .pet-quota-pct[data-level="unknown"],
.pet-bubble[data-surface="glass-dark"] .pet-quota-pct[data-level="unknown"] { color: #9c8ec0; }
.pet-bubble[data-surface="dark"] .pet-quota-track,
.pet-bubble[data-surface="glass-dark"] .pet-quota-track {
  background: rgba(154, 126, 226, 0.22);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, 0.38);
}
.pet-bubble[data-surface="dark"] .pet-quota-fill,
.pet-bubble[data-surface="glass-dark"] .pet-quota-fill {
  background: linear-gradient(90deg, #8b8dff, #c490ff, #f5a8e8);
  box-shadow: 0 0 10px rgba(186, 146, 255, 0.55);
}
.pet-bubble[data-surface="dark"][data-mode="quota"] .pet-bubble-text,
.pet-bubble[data-surface="glass-dark"][data-mode="quota"] .pet-bubble-text { color: #ede5ff; }

.pet-bubble[data-tone="warning"] {
  border-color: rgba(242, 178, 76, 0.82);
  color: #8a5114;
}
.pet-bubble[data-tone="error"] {
  border-color: rgba(235, 112, 152, 0.82);
  color: #8f2950;
}
.pet-bubble[data-tone="thinking"] {
  border-color: rgba(144, 136, 248, 0.82);
  color: #44398c;
}
.pet-bubble[data-surface="dark"][data-tone="warning"],
.pet-bubble[data-surface="glass-dark"][data-tone="warning"] {
  border-color: rgba(251, 191, 36, 0.72);
  color: #fde68a;
}
.pet-bubble[data-surface="dark"][data-tone="error"],
.pet-bubble[data-surface="glass-dark"][data-tone="error"] {
  border-color: rgba(251, 113, 133, 0.72);
  color: #fecdd3;
}
.pet-bubble[data-surface="dark"][data-tone="thinking"],
.pet-bubble[data-surface="glass-dark"][data-tone="thinking"] {
  border-color: rgba(165, 180, 252, 0.68);
  color: #e0e7ff;
}

.pet-bubble-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: calc(5px * var(--pet-bubble-scale));
}
.pet-bubble-title {
  font-size: calc(11px * var(--pet-bubble-scale));
  font-weight: 700;
  letter-spacing: 0.4px;
  color: #7c52bd;
}
.pet-bubble-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: calc(28px * var(--pet-bubble-scale));
  height: calc(28px * var(--pet-bubble-scale));
  margin: calc(-4px * var(--pet-bubble-scale)) calc(-4px * var(--pet-bubble-scale)) 0 0;
  border: 0;
  background: rgba(138, 108, 210, 0.08);
  color: #7c62ac;
  font-size: calc(18px * var(--pet-bubble-scale));
  font-weight: 600;
  line-height: 1;
  padding: 0;
  border-radius: 50%;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, transform 140ms ease;
}
.pet-bubble-close:hover {
  background: rgba(138, 108, 210, 0.2);
  color: #4d2f82;
  transform: scale(1.06);
}

/* 5h & Weekly Quota Panel inside bubble */
.pet-quota {
  display: flex;
  flex-direction: column;
  gap: calc(5px * var(--pet-bubble-scale));
  margin-bottom: calc(7px * var(--pet-bubble-scale));
  padding-bottom: calc(7px * var(--pet-bubble-scale));
  border-bottom: 1px dashed rgba(154, 122, 214, 0.34);
}
.pet-quota-pool {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.pet-quota-pool-name {
  font-size: calc(11.5px * var(--pet-bubble-scale));
  font-weight: 700;
  color: #5a3a96;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.pet-quota-nav {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.pet-quota-nav button {
  border: 1px solid rgba(176, 146, 232, 0.55);
  background: rgba(255, 255, 255, 0.72);
  color: #6a48a8;
  font-size: calc(11px * var(--pet-bubble-scale));
  line-height: 1;
  padding: 1px 5px;
  border-radius: 5px;
  cursor: pointer;
}
.pet-quota-nav button:hover {
  background: rgba(232, 218, 255, 0.9);
}
.pet-quota-page {
  font-size: calc(9.5px * var(--pet-bubble-scale));
  color: #846aa8;
  font-variant-numeric: tabular-nums;
}
.pet-quota-row {
  display: flex;
  flex-direction: column;
  gap: calc(3px * var(--pet-bubble-scale));
}
.pet-quota-label {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 6px;
  font-size: calc(11px * var(--pet-bubble-scale));
  color: #6c4d9c;
}
.pet-quota-reset {
  flex: 1;
  text-align: right;
  font-size: calc(9.5px * var(--pet-bubble-scale));
  color: #8970ad;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.pet-quota-reset:empty { display: none; }
.pet-quota-pct {
  font-size: calc(12px * var(--pet-bubble-scale));
  font-weight: 800;
  color: #6e44c2;
  font-variant-numeric: tabular-nums;
  min-width: 3em;
  text-align: right;
}
.pet-quota-pct[data-level="low"] { color: #b9751c; }
.pet-quota-pct[data-level="critical"] { color: #c73e6a; }
.pet-quota-pct[data-level="unknown"] { color: #8c7ea6; }

.pet-quota-track {
  height: calc(7px * var(--pet-bubble-scale));
  width: 100%;
  border-radius: 999px;
  background: rgba(212, 194, 240, 0.72);
  overflow: hidden;
  box-shadow: inset 0 1px 2px rgba(96, 62, 148, 0.16);
}
.pet-quota-fill {
  display: block;
  height: 100%;
  width: 0%;
  border-radius: inherit;
  background: linear-gradient(90deg, #7778ff, #b47dff, #f1a5e6);
  transition: width 260ms ease-out;
}
.pet-quota-track[data-level="low"] .pet-quota-fill {
  background: linear-gradient(90deg, #ecaa47, #ffd38b);
}
.pet-quota-track[data-level="critical"] .pet-quota-fill {
  background: linear-gradient(90deg, #e56b88, #ffa2ac);
}
.pet-quota-track[data-known="false"] .pet-quota-fill {
  width: 100% !important;
  opacity: 0.55;
  background: repeating-linear-gradient(120deg, #b898ee 0, #b898ee 6px, #d7bbf8 6px, #d7bbf8 12px);
}
.pet-quota-caption {
  font-size: calc(9.5px * var(--pet-bubble-scale));
  color: #846aa8;
}
.pet-quota-caption:empty { display: none; }

.pet-bubble-text {
  font-size: calc(13px * var(--pet-bubble-scale));
  line-height: 1.45;
  font-weight: 600;
  word-break: break-word;
}
.pet-bubble[data-mode="quota"] .pet-bubble-text {
  font-size: calc(12px * var(--pet-bubble-scale));
  color: #66429c;
}
.pet-bubble-meta {
  margin-top: calc(4px * var(--pet-bubble-scale));
  font-size: calc(10px * var(--pet-bubble-scale));
  color: #7b66a0;
  font-variant-numeric: tabular-nums;
}
.pet-bubble-meta:empty { display: none; }

@keyframes agy-pet-breath {
  0%, 100% { transform: translateY(0) scale(1); }
  50% { transform: translateY(-2px) scale(1.006, 1.012); }
}
@keyframes agy-pet-ponder {
  0%, 100% { transform: rotate(-1.1deg) translateY(0); }
  50% { transform: rotate(1.1deg) translateY(-2px); }
}
@keyframes agy-pet-duang {
  0%, 100% { transform: translateY(0) scale(1); }
  20% { transform: scale(1.04, 0.96); }
  45% { transform: translateY(-9px) scale(0.98, 1.035); }
  74% { transform: translateY(0) scale(1.018, 0.986); }
}
@keyframes agy-pet-worry {
  0%, 100% { transform: rotate(-0.5deg); }
  50% { transform: rotate(0.5deg) translateY(1.5px); }
}
@keyframes agy-pet-rebound {
  0% { transform: scale(1.05, 0.92); }
  38% { transform: scale(0.97, 1.04); }
  68% { transform: scale(1.015, 0.99); }
  100% { transform: scale(1); }
}
@keyframes agy-pet-nuzzle {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-2.2deg) translateY(-2px); }
  70% { transform: rotate(2.2deg) translateY(-1px); }
}
@keyframes agy-pet-float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-4px); }
}
@keyframes agy-pet-particle {
  0% { opacity: 0; transform: translate3d(0, 6px, 0) scale(0.55); }
  22% { opacity: 1; transform: translate3d(var(--dx, 4px), -10px, 0) scale(1.05); }
  100% { opacity: 0; transform: translate3d(var(--dx2, 8px), -34px, 0) scale(0.85); }
}
`;

  const stage = doc.createElement("div");
  stage.className = "pet-stage";
  stage.setAttribute("data-state", "idle");
  stage.setAttribute("data-facing", "right");
  stage.setAttribute("data-mirrored", "false");

  const bubbleEl = doc.createElement("div");
  bubbleEl.className = "pet-bubble";
  bubbleEl.setAttribute("role", "status");
  bubbleEl.setAttribute("aria-live", "polite");
  bubbleEl.setAttribute("data-open", "false");
  bubbleEl.setAttribute("data-mode", "quip");

  const bubbleHead = doc.createElement("div");
  bubbleHead.className = "pet-bubble-head";
  const bubbleTitle = doc.createElement("span");
  bubbleTitle.className = "pet-bubble-title";
  bubbleTitle.textContent = "✦ 喵言喵语 ✧";
  const bubbleClose = doc.createElement("button");
  bubbleClose.className = "pet-bubble-close";
  bubbleClose.type = "button";
  bubbleClose.setAttribute("aria-label", "关闭气泡");
  bubbleClose.textContent = "×";
  bubbleHead.append(bubbleTitle, bubbleClose);

  // Quota panel DOM inside bubble
  const quotaEl = doc.createElement("div");
  quotaEl.className = "pet-quota";
  quotaEl.hidden = true;
  quotaEl.setAttribute("hidden", "");

  const quotaPoolRow = doc.createElement("div");
  quotaPoolRow.className = "pet-quota-pool";
  const quotaPoolNameEl = doc.createElement("span");
  quotaPoolNameEl.className = "pet-quota-pool-name";
  quotaPoolNameEl.textContent = "Gemini Models";
  const quotaNavEl = doc.createElement("span");
  quotaNavEl.className = "pet-quota-nav";
  quotaNavEl.hidden = true;
  quotaNavEl.setAttribute("hidden", "");
  const quotaPrevBtn = doc.createElement("button");
  quotaPrevBtn.className = "pet-quota-prev";
  quotaPrevBtn.type = "button";
  quotaPrevBtn.setAttribute("aria-label", "上一个模型池");
  quotaPrevBtn.textContent = "‹";
  const quotaPageEl = doc.createElement("span");
  quotaPageEl.className = "pet-quota-page";
  quotaPageEl.textContent = "1/1";
  const quotaNextBtn = doc.createElement("button");
  quotaNextBtn.className = "pet-quota-next";
  quotaNextBtn.type = "button";
  quotaNextBtn.setAttribute("aria-label", "下一个模型池");
  quotaNextBtn.textContent = "›";
  quotaNavEl.append(quotaPrevBtn, quotaPageEl, quotaNextBtn);
  quotaPoolRow.append(quotaPoolNameEl, quotaNavEl);

  function makeQuotaWindowRow(winKey, labelText) {
    const row = doc.createElement("div");
    row.className = "pet-quota-row";
    const label = doc.createElement("div");
    label.className = "pet-quota-label";
    const nameSpan = doc.createElement("span");
    nameSpan.textContent = labelText;
    const resetSpan = doc.createElement("span");
    resetSpan.className = "pet-quota-reset";
    resetSpan.setAttribute("data-win", winKey);
    const pctEl = doc.createElement("strong");
    pctEl.className = "pet-quota-pct";
    pctEl.setAttribute("data-win", winKey);
    pctEl.setAttribute("data-level", "unknown");
    pctEl.textContent = "—";
    label.append(nameSpan, resetSpan, pctEl);

    const track = doc.createElement("div");
    track.className = "pet-quota-track";
    track.setAttribute("data-win", winKey);
    track.setAttribute("data-known", "false");
    track.setAttribute("data-level", "unknown");
    const fill = doc.createElement("span");
    fill.className = "pet-quota-fill";
    fill.setAttribute("data-win", winKey);
    track.append(fill);

    row.append(label, track);
    return { row, resetSpan, pctEl, track, fill };
  }

  const quota5h = makeQuotaWindowRow("5h", "5 小时");
  const quotaWeekly = makeQuotaWindowRow("weekly", "1 周");
  const quotaCaptionEl = doc.createElement("div");
  quotaCaptionEl.className = "pet-quota-caption";

  quotaEl.append(quotaPoolRow, quota5h.row, quotaWeekly.row, quotaCaptionEl);

  const bubbleTextEl = doc.createElement("div");
  bubbleTextEl.className = "pet-bubble-text";
  const bubbleMetaEl = doc.createElement("div");
  bubbleMetaEl.className = "pet-bubble-meta";

  // Iconic 3-dot graduating thought-bubble tail chain (large -> medium -> small)
  const bubbleTailEl = doc.createElement("div");
  bubbleTailEl.className = "pet-bubble-tail";
  bubbleTailEl.setAttribute("aria-hidden", "true");
  for (const sizeCls of ["lg", "md", "sm"]) {
    const dot = doc.createElement("span");
    dot.className = "pet-tail-dot pet-tail-dot--" + sizeCls;
    bubbleTailEl.append(dot);
  }

  bubbleEl.append(bubbleHead, quotaEl, bubbleTextEl, bubbleMetaEl, bubbleTailEl);

  const hitEl = doc.createElement("div");
  hitEl.className = "pet-hit";
  hitEl.setAttribute("role", "button");
  hitEl.setAttribute("tabindex", "0");
  hitEl.setAttribute("aria-label", "星语猫娘桌宠");

  const motionEl = doc.createElement("div");
  motionEl.className = "pet-motion";
  const faceEl = doc.createElement("div");
  faceEl.className = "pet-face";

  function makeFrameImg(cls, keyName) {
    const img = doc.createElement("img");
    img.className = "pet-frame pet-frame--" + cls;
    img.setAttribute("alt", "");
    img.setAttribute("draggable", "false");
    on(img, "load", () => {
      frameReady[keyName] = true;
      frameFailed[keyName] = false;
      if (keyName === "idle") {
        idleRetryCount = 0;
        stage.removeAttribute("data-fallback");
      }
    });
    on(img, "error", () => {
      frameReady[keyName] = false;
      frameFailed[keyName] = true;
      if (keyName === "idle") {
        stage.setAttribute("data-fallback", "svg");
        if (idleRetryCount < 2 && cfg.assetBaseUrl && !destroyed) {
          idleRetryCount++;
          clearTimeout(idleRetryTimer);
          idleRetryTimer = setTimeout(() => {
            if (!destroyed && frameFailed.idle) loadCharacterAssets(true);
          }, 3000 * idleRetryCount);
        }
      }
    });
    return img;
  }

  const idleImg = makeFrameImg("idle", "idle");
  const blinkImg = makeFrameImg("blink", "blink");
  const proudImg = makeFrameImg("proud", "proud");
  const sadImg = makeFrameImg("sad", "sad");

  const fallbackEl = doc.createElement("div");
  fallbackEl.className = "pet-fallback";
  fallbackEl.innerHTML = FALLBACK_CAT_SVG;

  const thinkingDotsEl = doc.createElement("div");
  thinkingDotsEl.className = "pet-thinking-dots";
  thinkingDotsEl.innerHTML = SVG_EFFECTS.thinking;

  const particlesEl = doc.createElement("div");
  particlesEl.className = "pet-particles";

  faceEl.append(idleImg, blinkImg, proudImg, sadImg, fallbackEl);
  motionEl.append(faceEl, thinkingDotsEl, particlesEl);
  hitEl.append(motionEl);
  stage.append(bubbleEl, hitEl);
  shadow.append(styleEl, stage);
  (doc.body || doc.documentElement).append(host);

  let loadedAssetBase = "";
  let dialogueLoadedForBase = "";

  function getFetchFn() {
    if (typeof win.fetch === "function") return win.fetch.bind(win);
    if (typeof fetch === "function") return fetch;
    return null;
  }

  function loadCharacterAssets(forceRetry) {
    if (!cfg.assetBaseUrl) {
      stage.setAttribute("data-fallback", "svg");
      return;
    }
    if (!forceRetry && loadedAssetBase === cfg.assetBaseUrl) return;
    loadedAssetBase = cfg.assetBaseUrl;
    const suffix = forceRetry ? "&retry=" + idleRetryCount : "";
    idleImg.src = buildAssetUrl(cfg.assetBaseUrl, "pet", "idle.png") + suffix;
    blinkImg.src = buildAssetUrl(cfg.assetBaseUrl, "pet", "blink.png") + suffix;
    proudImg.src = buildAssetUrl(cfg.assetBaseUrl, "pet", "proud-v3.png") + suffix;
    sadImg.src = buildAssetUrl(cfg.assetBaseUrl, "pet", "sad-v3.png") + suffix;

    // Optionally hydrate full zh-CN.json dialogue bank once per assetBaseUrl
    const fetchFn = getFetchFn();
    if (fetchFn && !cfg.dialogue && dialogueLoadedForBase !== cfg.assetBaseUrl) {
      dialogueLoadedForBase = cfg.assetBaseUrl;
      try {
        const resPromise = fetchFn(buildAssetUrl(cfg.assetBaseUrl, "dialogue", "zh-CN.json"));
        if (resPromise && typeof resPromise.then === "function") {
          resPromise
            .then((res) => (res && res.ok ? res.json() : null))
            .then((json) => {
              if (!destroyed && json) mergeDialogue(json);
            })
            .catch(() => {});
        }
      } catch {}
    }
  }

  function effectiveState() {
    return transientState || persistentState;
  }

  function syncVisualState() {
    const state = effectiveState();
    stage.setAttribute("data-state", state);
    if (activeExpression && !frameFailed[activeExpression]) {
      stage.setAttribute("data-expression", activeExpression);
    } else {
      stage.removeAttribute("data-expression");
    }
    stage.setAttribute("data-blink", isBlinking && !activeExpression && !frameFailed.blink ? "true" : "false");
  }

  function syncSurfaceMode() {
    const nextMode = detectSurfaceMode();
    currentSurfaceMode = nextMode;
    stage.setAttribute("data-surface", nextMode);
    bubbleEl.setAttribute("data-surface", nextMode);
    return nextMode;
  }

  function applyScaleAndAppearance() {
    const { width, scaleRatio } = petDimensions();
    // Bubble scales proportionally with pet scale (60..160 -> 0.60..1.60), solving upstream Issue #1!
    const bubbleScale = Number(clamp(scaleRatio, 1, 0.6, 1.6).toFixed(3));
    stage.style.setProperty("--pet-width", width + "px");
    stage.style.setProperty("--pet-scale", String(scaleRatio));
    stage.style.setProperty("--pet-bubble-scale", String(bubbleScale));
    stage.style.setProperty("--pet-opacity", String(cfg.opacity / 100));
    stage.setAttribute("data-scale", String(cfg.scale));
    stage.setAttribute("data-bubble-scale", String(bubbleScale));
    stage.setAttribute("data-reduced-motion", cfg.reducedMotion ? "true" : "false");
    syncSurfaceMode();
    syncVisibility();
  }

  function isZenModeActive() {
    if (!cfg.hideWhenZen) return false;
    try {
      if (doc.documentElement?.getAttribute?.("data-zen-mode") === "true") return true;
      if (doc.body?.classList?.contains?.("zen-mode")) return true;
      if (doc.querySelector?.('[data-zen-mode="true"]')) return true;
    } catch {}
    return false;
  }

  function syncVisibility() {
    const shouldHide = !cfg.enabled || !visible || isZenModeActive();
    stage.setAttribute("data-hidden", shouldHide ? "true" : "false");
  }

  function applyPosition(animateSnap) {
    const { w } = viewportSize();
    const { width } = petDimensions();
    const clamped = clampPosition(posX, posY);
    posX = clamped.x;
    posY = clamped.y;

    if (animateSnap && !cfg.reducedMotion) {
      stage.setAttribute("data-snapping", "true");
      clearTimeout(snapTransitionTimer);
      snapTransitionTimer = setTimeout(() => {
        stage.removeAttribute("data-snapping");
      }, 340);
    } else {
      stage.removeAttribute("data-snapping");
    }

    stage.style.transform = "translate3d(" + posX + "px, " + posY + "px, 0)";
    stage.setAttribute("data-x", String(posX));
    stage.setAttribute("data-y", String(posY));
    stage.setAttribute("data-dock-side", dockedSide || "free");

    // Facing & horizontal mirroring on .pet-face ONLY (100% parity with Antigravity-Cat-Widget):
    // Native idle.png faces inward-left (golden eye on viewer-left, pink eye + star clip on viewer-right).
    // - Right-dock / right half: data-facing="right", mirrored=false -> transform: none (looks inward left!)
    // - Left-dock / left half:  data-facing="left",  mirrored=true  -> rotateY(180deg) (looks inward right!)
    // Bubble/close button/text live outside .pet-face and are NEVER mirrored.
    const centerX = posX + width / 2;
    const isLeftSide = dockedSide === "left" ? true : dockedSide === "right" ? false : centerX < w / 2;
    const nearLeft = centerX < w * 0.34;
    const nearRight = centerX > w * 0.66;
    currentFacing = isLeftSide ? "left" : "right";
    currentMirrored = isLeftSide;

    stage.setAttribute("data-facing", currentFacing);
    stage.setAttribute("data-mirrored", currentMirrored ? "true" : "false");
    faceEl.style.transform = currentMirrored ? "rotateY(180deg)" : "none";
    // Keep thinking-dots tail always pointing inward toward cat's head in both facings
    if (currentFacing === "left") {
      thinkingDotsEl.style.left = "1%";
      thinkingDotsEl.style.right = "auto";
      thinkingDotsEl.setAttribute("data-side", "left");
      thinkingDotsEl.setAttribute("data-tail-dir", "down-right");
      thinkingDotsEl.setAttribute("data-flipped", "true");
    } else {
      thinkingDotsEl.style.left = "auto";
      thinkingDotsEl.style.right = "1%";
      thinkingDotsEl.setAttribute("data-side", "right");
      thinkingDotsEl.setAttribute("data-tail-dir", "down-left");
      thinkingDotsEl.setAttribute("data-flipped", "false");
    }
    stage.setAttribute("data-align", nearRight ? "right" : nearLeft ? "left" : "center");
    stage.setAttribute("data-vpos", posY < 160 ? "below" : "above");
  }

  function spawnParticles(kind, count) {
    if (destroyed || paused || cfg.reducedMotion) return;
    const svgMarkup = SVG_EFFECTS[kind];
    if (!svgMarkup) return;
    const total = Math.max(1, Math.min(4, count || 1));
    for (let i = 0; i < total; i++) {
      const p = doc.createElement("span");
      p.className = "pet-particle";
      p.innerHTML = svgMarkup;
      const leftPct = 22 + Math.round(Math.random() * 56);
      const topPct = 10 + Math.round(Math.random() * 34);
      const dx = Math.round((Math.random() - 0.5) * 26);
      p.style.left = leftPct + "%";
      p.style.top = topPct + "%";
      p.style.setProperty("--dx", dx + "px");
      p.style.setProperty("--dx2", Math.round(dx * 1.6) + "px");
      particlesEl.append(p);
      const pt = setTimeout(() => {
        particleTimers.delete(pt);
        try {
          p.remove?.();
        } catch {}
      }, 1200);
      particleTimers.add(pt);
    }
  }

  function renderQuotaWindow(ui, winData, nowMs) {
    const val = winData && typeof winData.remaining === "number" ? winData.remaining : null;
    const known = val !== null;
    const level = !known ? "unknown" : val <= 15 ? "critical" : val <= 30 ? "low" : "normal";
    ui.pctEl.textContent = known ? Math.round(val) + "%" : "—";
    ui.pctEl.setAttribute("data-level", level);
    ui.track.setAttribute("data-known", known ? "true" : "false");
    ui.track.setAttribute("data-level", level);
    ui.fill.style.width = known ? val + "%" : "100%";
    ui.resetSpan.textContent = formatResetCountdown(winData?.resetAt, nowMs);
  }

  function renderQuotaPanel() {
    const groups = latestQuota && Array.isArray(latestQuota.groups) ? latestQuota.groups : [];
    const nowMs = Date.now();
    if (groups.length === 0) {
      quotaPoolNameEl.textContent = "Gemini Models";
      quotaNavEl.hidden = true;
      quotaNavEl.setAttribute("hidden", "");
      renderQuotaWindow(quota5h, null, nowMs);
      renderQuotaWindow(quotaWeekly, null, nowMs);
      quotaCaptionEl.textContent = quotaLoading
        ? "正在读取实时额度…"
        : cfg.sidecarBaseUrl
          ? "尚未读取到宿主额度"
          : "未连接本地遥测服务";
      return null;
    }

    quotaPoolIdx = ((quotaPoolIdx % groups.length) + groups.length) % groups.length;
    const activeGroup = groups[quotaPoolIdx];
    quotaPoolNameEl.textContent = activeGroup.name;

    if (groups.length > 1) {
      quotaNavEl.hidden = false;
      quotaNavEl.removeAttribute("hidden");
      quotaPageEl.textContent = quotaPoolIdx + 1 + "/" + groups.length;
    } else {
      quotaNavEl.hidden = true;
      quotaNavEl.setAttribute("hidden", "");
    }

    renderQuotaWindow(quota5h, activeGroup.fiveHour, nowMs);
    renderQuotaWindow(quotaWeekly, activeGroup.weekly, nowMs);
    quotaCaptionEl.textContent = latestQuota.stale
      ? "上次缓存 · 待更新"
      : latestQuota.cached
        ? "上次读取缓存"
        : "实时额度 · 点点猫猫刷新";
    return activeGroup;
  }

  function closeBubble() {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
    bubbleOpen = false;
    bubbleEl.setAttribute("data-open", "false");
  }

  function armBubbleAutoHide(durationMs) {
    clearTimeout(bubbleTimer);
    bubbleTimer = null;
    if (durationMs > 0 && !bubbleHover) {
      bubbleTimer = setTimeout(() => {
        if (!bubbleHover) closeBubble();
      }, durationMs);
    }
  }

  function showBubble(text, opts) {
    if (destroyed) return;
    const force = Boolean(opts && opts.force);
    if (!cfg.showBubbles && !force) return;
    const mode = opts && opts.mode === "quota" ? "quota" : "quip";
    const tone = (opts && opts.tone) || "normal";
    const meta = (opts && opts.meta) || "";
    const durationMs = opts && typeof opts.durationMs === "number" ? opts.durationMs : mode === "quota" ? 6500 : 4600;
    const title = (opts && opts.title) || (mode === "quota" ? "✦ 模型额度 ✧" : "✦ 喵言喵语 ✧");

    bubbleMode = mode;
    syncSurfaceMode();
    currentBubbleText = String(text || "");
    currentBubbleMeta = String(meta || "");
    currentBubbleTone = tone;
    bubbleEl.setAttribute("data-mode", mode);
    bubbleTitle.textContent = title;
    bubbleTextEl.textContent = currentBubbleText;
    bubbleMetaEl.textContent = currentBubbleMeta;
    bubbleEl.setAttribute("data-tone", tone);

    if (mode === "quota") {
      quotaEl.hidden = false;
      quotaEl.removeAttribute("hidden");
      renderQuotaPanel();
    } else {
      quotaEl.hidden = true;
      quotaEl.setAttribute("hidden", "");
    }

    bubbleOpen = true;
    bubbleEl.setAttribute("data-open", "true");
    armBubbleAutoHide(durationMs);
  }

  async function fetchQuotaSnapshot(forceRefresh) {
    if (destroyed || !cfg.sidecarBaseUrl) return latestQuota;
    const fetchFn = getFetchFn();
    if (!fetchFn) return latestQuota;
    const now = Date.now();
    if (!forceRefresh && latestQuota && latestQuota.groups.length > 0 && now - quotaFetchedAt < 12000) {
      return latestQuota;
    }
    quotaLoading = true;
    if (bubbleOpen && bubbleMode === "quota") renderQuotaPanel();

    let nextQuota = null;
    try {
      const qUrl = buildApiUrl(cfg, "/api/maomao/quota");
      const res = await fetchFn(qUrl, { cache: "no-store" });
      if (res && res.ok) {
        const json = await res.json();
        const parsed = normalizeQuotaSnapshot(json);
        if (parsed && parsed.groups.length > 0) nextQuota = parsed;
      }
    } catch {}

    // Fallback to /api/maomao/telemetry (supports both data.quota and data.quotas.groups)
    if (!nextQuota) {
      try {
        const tUrl = buildApiUrl(cfg, "/api/maomao/telemetry");
        const res = await fetchFn(tUrl, { cache: "no-store" });
        if (res && res.ok) {
          const json = await res.json();
          const parsed = normalizeQuotaSnapshot(json);
          if (parsed && parsed.groups.length > 0) nextQuota = parsed;
        }
      } catch {}
    }

    quotaLoading = false;
    if (destroyed) return latestQuota;
    if (nextQuota) {
      latestQuota = nextQuota;
      quotaFetchedAt = Date.now();
    }
    if (bubbleOpen && bubbleMode === "quota") {
      renderQuotaPanel();
    }
    return latestQuota;
  }

  function showQuota(opts) {
    if (destroyed) return null;
    const options = opts && typeof opts === "object" ? opts : {};
    const quipKind = options.quipKind || (isLatestQuotaLow() ? "warning" : "idle");
    const quip = typeof options.text === "string" && options.text ? options.text : pickLine(quipKind);
    const tone = options.tone || (isLatestQuotaLow() ? "warning" : "normal");

    showBubble(quip, {
      mode: "quota",
      tone,
      title: options.title || "✦ 模型额度 ✧",
      meta: options.meta || "",
      durationMs: typeof options.durationMs === "number" ? options.durationMs : 6500,
      force: options.force !== false,
    });

    if (cfg.sidecarBaseUrl) {
      fetchQuotaSnapshot(Boolean(options.refresh)).catch(() => {});
    }
    return { mode: "quota", text: quip, quota: latestQuota };
  }

  function isLatestQuotaLow() {
    if (!latestQuota || !Array.isArray(latestQuota.groups)) return false;
    for (const g of latestQuota.groups) {
      if (typeof g.fiveHour?.remaining === "number" && g.fiveHour.remaining <= 15) return true;
      if (typeof g.weekly?.remaining === "number" && g.weekly.remaining <= 15) return true;
    }
    return false;
  }

  function setTransient(state, durationMs) {
    clearTimeout(transientTimer);
    transientTimer = null;
    transientState = state;
    syncVisualState();
    if (durationMs > 0) {
      transientTimer = setTimeout(() => {
        transientState = null;
        syncVisualState();
      }, durationMs);
    }
  }

  function setExpression(expr, durationMs) {
    clearTimeout(expressionTimer);
    expressionTimer = null;
    activeExpression = expr || null;
    syncVisualState();
    if (expr && durationMs > 0) {
      expressionTimer = setTimeout(() => {
        activeExpression = null;
        syncVisualState();
      }, durationMs);
    }
  }

  function triggerQuip(kind, opts) {
    if (destroyed) return null;
    const options = opts && typeof opts === "object" ? opts : {};
    const k = typeof kind === "string" && kind ? kind : "idle";
    if (k === "quota") {
      spawnParticles("sparkle", 1);
      return showQuota(options);
    }
    const resolvedKind = k === "random" ? (Math.random() < 0.5 ? "idle" : "proud") : k;
    const text = typeof options.text === "string" && options.text ? options.text : pickLine(resolvedKind);
    let tone = options.tone || "normal";
    let expr = options.expression || null;
    let effect = options.effect || null;

    if (resolvedKind === "proud" || resolvedKind === "success") {
      expr = expr || "proud";
      effect = effect || "sparkle";
      setTransient("success", 680);
    } else if (resolvedKind === "sad" || resolvedKind === "crying" || resolvedKind === "error") {
      expr = expr || "sad";
      effect = effect || "teardrop";
      tone = resolvedKind === "error" ? "error" : "warning";
    } else if (resolvedKind === "warning") {
      expr = expr || "sad";
      effect = effect || "teardrop";
      tone = "warning";
    } else if (resolvedKind === "thinking") {
      tone = "thinking";
    } else if (resolvedKind === "petting") {
      effect = effect || "heart";
      setTransient("petting", 1400);
    } else {
      effect = effect || (Math.random() < 0.5 ? "sparkle" : "heart");
    }

    if (expr) setExpression(expr, options.expressionMs || 3400);
    if (effect) spawnParticles(effect, resolvedKind === "petting" ? 3 : 2);
    showBubble(text, {
      mode: options.showQuota ? "quota" : "quip",
      tone,
      meta: options.meta || "",
      title: options.title,
      durationMs: typeof options.durationMs === "number" ? options.durationMs : 4600,
      force: options.force !== false,
    });
    return { kind: resolvedKind, text, expression: activeExpression, tone };
  }

  // Blink scheduler (strictly paused on blur/hidden -> 0fps)
  function clearBlinkTimers() {
    clearTimeout(blinkTimer);
    clearTimeout(blinkOffTimer);
    blinkTimer = null;
    blinkOffTimer = null;
    if (isBlinking) {
      isBlinking = false;
      syncVisualState();
    }
  }

  function scheduleBlink() {
    clearBlinkTimers();
    if (destroyed || paused || cfg.reducedMotion || !cfg.enabled) return;
    const delay = 2800 + Math.floor(Math.random() * 3400);
    blinkTimer = setTimeout(() => {
      if (destroyed || paused) return;
      if (
        !activeExpression &&
        !frameFailed.blink &&
        (effectiveState() === "idle" || effectiveState() === "thinking")
      ) {
        isBlinking = true;
        syncVisualState();
        blinkOffTimer = setTimeout(() => {
          isBlinking = false;
          syncVisualState();
          scheduleBlink();
        }, 135);
      } else {
        scheduleBlink();
      }
    }, delay);
  }

  // Pointer dragging + soft magnetic corner docking + click-to-quota & quips + hover petting
  let dragCtx = null;
  let clickStreak = 0;
  let lastClickAt = 0;
  let hoverStrokeCount = 0;
  let lastHoverAt = 0;
  let lastPettingAt = 0;

  on(bubbleClose, "click", (e) => {
    e.stopPropagation?.();
    closeBubble();
  });

  // Clicking anywhere on the bubble panel closes it (except internal pager buttons ‹ / ›)
  on(bubbleEl, "click", (e) => {
    const target = e && e.target;
    if (target && typeof target.closest === "function") {
      const btn = target.closest("button");
      if (btn && !btn.classList?.contains?.("pet-bubble-close")) {
        return;
      }
    }
    e.stopPropagation?.();
    closeBubble();
  });

  on(quotaPrevBtn, "click", (e) => {
    e.stopPropagation?.();
    quotaPoolIdx -= 1;
    renderQuotaPanel();
    armBubbleAutoHide(6500);
  });

  on(quotaNextBtn, "click", (e) => {
    e.stopPropagation?.();
    quotaPoolIdx += 1;
    renderQuotaPanel();
    armBubbleAutoHide(6500);
  });

  on(bubbleEl, "pointerenter", () => {
    bubbleHover = true;
    clearTimeout(bubbleTimer);
  });
  on(bubbleEl, "pointerleave", () => {
    bubbleHover = false;
    if (bubbleOpen) {
      armBubbleAutoHide(3200);
    }
  });

  on(hitEl, "pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault?.();
    dragCtx = {
      pointerId: e.pointerId,
      startClientX: Number(e.clientX) || 0,
      startClientY: Number(e.clientY) || 0,
      originX: posX,
      originY: posY,
      moved: false,
    };
    try {
      hitEl.setPointerCapture?.(e.pointerId);
    } catch {}
    stage.setAttribute("data-pressed", "true");
    setTransient("pressed", 0);
    playSound("press");
  });

  function handleDragMove(e) {
    if (!dragCtx) return;
    const dx = (Number(e.clientX) || 0) - dragCtx.startClientX;
    const dy = (Number(e.clientY) || 0) - dragCtx.startClientY;
    if (!dragCtx.moved && Math.hypot(dx, dy) > 6) {
      dragCtx.moved = true;
      dockedSide = "";
      setTransient("dragged", 0);
    }
    if (dragCtx.moved) {
      posX = dragCtx.originX + dx;
      posY = dragCtx.originY + dy;
      applyPosition(false);
    }
  }

  on(hitEl, "pointermove", (e) => {
    if (dragCtx) {
      handleDragMove(e);
      return;
    }

    // Hover petting gesture
    if (paused || persistentState === "thinking") return;
    const now = Date.now();
    hoverStrokeCount = now - lastHoverAt < 260 ? hoverStrokeCount + 1 : 1;
    lastHoverAt = now;
    if (hoverStrokeCount >= 14 && now - lastPettingAt > 12000) {
      hoverStrokeCount = 0;
      lastPettingAt = now;
      triggerQuip("petting", { force: false });
    }
  });

  function finishPointer(canceled) {
    if (!dragCtx) return;
    const ctx = dragCtx;
    dragCtx = null;
    try {
      if (ctx.pointerId !== undefined) hitEl.releasePointerCapture?.(ctx.pointerId);
    } catch {}
    stage.removeAttribute("data-pressed");
    playSound("release");
    setTransient("release", 520);

    if (ctx.moved) {
      let snapped = false;
      if (cfg.snap && (cfg.dock === "right" || cfg.dock === "left")) {
        const { w, h } = viewportSize();
        const { width, height } = petDimensions();
        const leftTarget = { x: EDGE_MARGIN, y: Math.max(EDGE_MARGIN, h - height - BOTTOM_MARGIN) };
        const rightTarget = {
          x: Math.max(EDGE_MARGIN, w - width - EDGE_MARGIN),
          y: Math.max(EDGE_MARGIN, h - height - BOTTOM_MARGIN),
        };
        const distLeft = Math.hypot(posX - leftTarget.x, posY - leftTarget.y);
        const distRight = Math.hypot(posX - rightTarget.x, posY - rightTarget.y);
        if (distLeft <= SNAP_RADIUS && distLeft <= distRight) {
          posX = leftTarget.x;
          posY = leftTarget.y;
          dockedSide = "left";
          snapped = true;
        } else if (distRight <= SNAP_RADIUS) {
          posX = rightTarget.x;
          posY = rightTarget.y;
          dockedSide = "right";
          snapped = true;
        } else {
          dockedSide = "";
        }
      } else {
        dockedSide = "";
      }
      applyPosition(snapped);
      savePosition();
      return;
    }

    if (canceled) return;

    // Click (poke) interaction: restore original Antigravity-Cat-Widget click-to-quota UX!
    // Shows real-time 5h & weekly model quota + reset countdown + cute tsundere quip together.
    const now = Date.now();
    clickStreak = now - lastClickAt <= 2200 ? clickStreak + 1 : 1;
    lastClickAt = now;

    if (clickStreak >= 4) {
      clickStreak = 0;
      setTransient("petting", 1400);
      spawnParticles("heart", 3);
      showQuota({ quipKind: "petting", force: false });
      return;
    }

    let quipKind = isLatestQuotaLow() ? "warning" : "idle";
    if (Math.random() < cfg.quipProbability) {
      const isProud = Math.random() < 0.6;
      setExpression(isProud ? "proud" : "sad", 3200);
      spawnParticles(isProud ? "sparkle" : "teardrop", 2);
      quipKind = isProud ? "proud" : "crying";
    } else {
      spawnParticles("sparkle", 1);
    }

    showQuota({ quipKind, force: false });
  }

  on(hitEl, "pointerup", () => finishPointer(false));
  on(hitEl, "pointercancel", () => finishPointer(true));
  on(hitEl, "lostpointercapture", () => finishPointer(true));
  on(win, "pointermove", (e) => {
    if (dragCtx) handleDragMove(e);
  });
  on(win, "pointerup", () => {
    if (dragCtx) finishPointer(false);
  });

  on(hitEl, "keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault?.();
      playSound("press");
      setTransient("release", 520);
      showQuota({ force: false });
    }
  });

  // Conversation state detection & optional lightweight telemetry polling
  let agentRunning = false;
  let runningStartedAt = 0;
  let lastWarningAt = 0;
  let lastTelemetryRounds = -1;

  function isVisibleControl(el) {
    if (!el || el.disabled) return false;
    if (el.getAttribute?.("aria-hidden") === "true") return false;
    if (el.getAttribute?.("hidden") !== null && el.getAttribute?.("hidden") !== undefined) return false;
    const style = el.style;
    if (style && (style.display === "none" || style.visibility === "hidden")) return false;
    return true;
  }

  function detectAgentRunning() {
    try {
      const footer = doc.querySelector?.('.agy-composer-footer, [data-testid="input-box-bottom-toolbar"]');
      const scope = footer || doc;
      const firstHit = scope.querySelector?.('[data-testid*="stop"], [data-testid*="cancel"]');
      if (firstHit && isVisibleControl(firstHit)) return true;
      if (footer) {
        const docHit = doc.querySelector?.('[data-testid*="stop"], [data-testid*="cancel"]');
        if (docHit && isVisibleControl(docHit)) return true;
      }
      if (firstHit) {
        const nodes = scope.querySelectorAll?.('[data-testid*="stop"], [data-testid*="cancel"]');
        if (nodes && nodes.length > 1) {
          for (const el of nodes) {
            if (isVisibleControl(el)) return true;
          }
        }
      }
    } catch {}
    return false;
  }

  function formatTokens(n) {
    const v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "";
    if (v >= 1000000) return (v / 1000000).toFixed(1) + "M";
    if (v >= 1000) return (v / 1000).toFixed(1) + "k";
    return String(Math.round(v));
  }

  function handleTelemetryPayload(raw, justFinished) {
    if (destroyed || !raw || typeof raw !== "object") return;
    const data = raw.telemetry && typeof raw.telemetry === "object" ? raw.telemetry : raw;
    const parsedQuota = normalizeQuotaSnapshot(raw.quota || raw.quotas || data.quota || data.quotas);
    if (parsedQuota && parsedQuota.groups.length > 0) {
      latestQuota = parsedQuota;
      quotaFetchedAt = Date.now();
      if (bubbleOpen && bubbleMode === "quota") renderQuotaPanel();
    }

    const rounds = Number(data.rounds);
    const outTok = Number(data.outputTokens) || Number(data.totalTokens) || 0;
    const tps = Number(data.tps || data.latestTps) || 0;
    const hasError = Boolean(data.error || data.hasError);

    // Check low quota (<= 15% remaining)
    let lowQuotaLabel = "";
    if (parsedQuota && parsedQuota.groups.length > 0) {
      for (const g of parsedQuota.groups) {
        if (typeof g.fiveHour?.remaining === "number" && g.fiveHour.remaining <= 15) {
          lowQuotaLabel = g.name + " 5h 剩余 " + Math.round(g.fiveHour.remaining) + "%";
          break;
        }
        if (typeof g.weekly?.remaining === "number" && g.weekly.remaining <= 15) {
          lowQuotaLabel = g.name + " 周剩余 " + Math.round(g.weekly.remaining) + "%";
          break;
        }
      }
    } else if (data.quotaLow) {
      lowQuotaLabel = typeof data.quotaLow === "string" ? data.quotaLow : "剩余额度偏低";
    }

    const now = Date.now();
    if (hasError && now - lastWarningAt > 30000) {
      lastWarningAt = now;
      persistentState = "error";
      syncVisualState();
      triggerQuip("error", {
        meta: typeof data.error === "string" ? data.error.slice(0, 48) : "请检查最新报错",
        force: false,
      });
      return;
    }

    if (lowQuotaLabel && now - lastWarningAt > 60000) {
      lastWarningAt = now;
      persistentState = "warning";
      syncVisualState();
      triggerQuip("warning", { meta: lowQuotaLabel, force: false });
      return;
    }

    if (justFinished || (Number.isFinite(rounds) && rounds > lastTelemetryRounds && lastTelemetryRounds >= 0)) {
      const parts = [];
      const tokStr = formatTokens(outTok);
      if (tokStr) parts.push("Token " + tokStr);
      if (tps > 0) parts.push(tps.toFixed(1) + " tok/s");
      if (justFinished && runningStartedAt > 0) {
        const sec = Math.max(0.1, (now - runningStartedAt) / 1000);
        parts.push("耗时 " + sec.toFixed(1) + "s");
      }
      if (parts.length > 0 && persistentState !== "thinking") {
        triggerQuip("proud", { meta: parts.join(" · "), durationMs: 5200, force: false });
      }
    }

    if (Number.isFinite(rounds)) lastTelemetryRounds = rounds;
  }

  function fetchTelemetryOnce(justFinished) {
    if (destroyed || paused || !cfg.enabled) return;
    const url = buildApiUrl(cfg, "/api/maomao/telemetry");
    if (!url) return;
    const fetchFn = getFetchFn();
    if (!fetchFn) return;
    try {
      const p = fetchFn(url, { cache: "no-store" });
      if (p && typeof p.then === "function") {
        p.then((res) => (res && res.ok ? res.json() : null))
          .then((json) => handleTelemetryPayload(json, justFinished))
          .catch(() => {});
      }
    } catch {}
  }

  function scheduleTelemetryPolling() {
    clearInterval(telemetryTimer);
    telemetryTimer = null;
    if (destroyed || paused || !cfg.enabled || !cfg.sidecarBaseUrl) return;
    telemetryTimer = setInterval(() => {
      fetchTelemetryOnce(false);
    }, cfg.telemetryPollMs);
  }

  function checkHostState() {
    if (destroyed || paused || !cfg.enabled) return;
    syncVisibility();
    const running = detectAgentRunning();
    if (running && !agentRunning) {
      agentRunning = true;
      runningStartedAt = Date.now();
      persistentState = "thinking";
      activeExpression = null;
      syncVisualState();
      if (cfg.showBubbles) {
        showBubble("思考中…", { mode: "quip", tone: "thinking", durationMs: 0, force: false });
      }
    } else if (!running && agentRunning) {
      const elapsedSec = runningStartedAt > 0 ? Math.max(0.1, (Date.now() - runningStartedAt) / 1000) : 0;
      agentRunning = false;
      persistentState = "idle";
      syncVisualState();
      const meta = elapsedSec >= 0.5 ? "耗时 " + elapsedSec.toFixed(1) + "s" : "";
      triggerQuip("proud", { meta, durationMs: 4800, force: false });
      if (cfg.sidecarBaseUrl) {
        fetchTelemetryOnce(true);
      }
    }
  }

  // Pause/Resume management on blur / hidden (true 0fps when inactive)
  function updatePausedState() {
    const nextPaused = Boolean(docHidden || !windowFocused || !cfg.enabled);
    if (nextPaused === paused) return;
    paused = nextPaused;
    stage.setAttribute("data-paused", paused ? "true" : "false");
    if (paused) {
      clearBlinkTimers();
      clearInterval(telemetryTimer);
      telemetryTimer = null;
      clearTimeout(obsDebounceTimer);
      obsDebounceTimer = null;
      finishPointer(true);
    } else {
      scheduleBlink();
      scheduleTelemetryPolling();
      checkHostState();
    }
  }

  on(doc, "visibilitychange", () => {
    docHidden = Boolean(doc.hidden);
    updatePausedState();
  });
  on(win, "blur", () => {
    windowFocused = false;
    updatePausedState();
  });
  on(win, "focus", () => {
    windowFocused = true;
    docHidden = Boolean(doc.hidden);
    updatePausedState();
  });

  on(win, "resize", () => {
    if (destroyed) return;
    if (cfg.snap && (dockedSide === "right" || dockedSide === "left")) {
      const def = defaultPositionForDock(dockedSide);
      posX = def.x;
      posY = def.y;
    }
    applyPosition(false);
    savePosition();
  });

  const EDITOR_IGNORE_SEL =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, .monaco-editor, .cm-editor, .xterm, #agy-maomao-pet-root';

  function isIgnoredEditorNode(node) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(el.closest(EDITOR_IGNORE_SEL));
  }

  const MutObs = typeof win.MutationObserver === "function" ? win.MutationObserver : typeof MutationObserver === "function" ? MutationObserver : null;
  if (MutObs && doc.body) {
    mutObserver = new MutObs((records) => {
      if (destroyed || paused || !cfg.enabled) return;
      // Fast-filter typing/backspace mutations inside Lexical / editable areas -> zero overhead!
      if (Array.isArray(records) && records.length > 0) {
        let relevant = false;
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          if (!rec || rec.type === "characterData") continue;
          if (!isIgnoredEditorNode(rec.target)) {
            relevant = true;
            break;
          }
        }
        if (!relevant) return;
      }
      if (obsDebounceTimer) return;
      obsDebounceTimer = setTimeout(() => {
        obsDebounceTimer = null;
        checkHostState();
      }, 450);
    });
    try {
      mutObserver.observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden", "class", "data-zen-mode"] });
    } catch {}
  }

  // Dedicated non-subtree theme observer on <html> and <body> (0 typing overhead!)
  if (MutObs) {
    themeObserver = new MutObs(() => {
      if (!destroyed) syncSurfaceMode();
    });
    try {
      if (doc.documentElement) {
        themeObserver.observe(doc.documentElement, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
      }
      if (doc.body) {
        themeObserver.observe(doc.body, {
          attributes: true,
          attributeFilter: ["class", "data-theme"],
        });
      }
    } catch {}
  }
  try {
    const colorSchemeMq = typeof win.matchMedia === "function" ? win.matchMedia("(prefers-color-scheme: dark)") : null;
    if (colorSchemeMq && typeof colorSchemeMq.addEventListener === "function") {
      on(colorSchemeMq, "change", () => {
        if (!destroyed) syncSurfaceMode();
      });
    }
  } catch {}

  function update(nextRaw) {
    if (destroyed) return status();
    const prevDock = cfg.dock;
    const prevSnap = cfg.snap;
    const prevShowBubbles = cfg.showBubbles;
    cfg = normalizeConfig(nextRaw, cfg);
    if (cfg.dialogue) mergeDialogue(cfg.dialogue);

    if (!cfg.soundEnabled || cfg.volume <= 0) {
      stopAudio();
    }
    if (!cfg.showBubbles && prevShowBubbles) {
      closeBubble();
    }

    loadCharacterAssets(false);
    applyScaleAndAppearance();

    if (cfg.dock !== prevDock && (cfg.dock === "left" || cfg.dock === "right")) {
      const target = defaultPositionForDock(cfg.dock);
      posX = target.x;
      posY = target.y;
      dockedSide = cfg.snap ? target.dockedSide : "";
      applyPosition(true);
      savePosition();
    } else if (!prevSnap && cfg.snap && cfg.dock !== "free") {
      // Turning snap from false -> true immediately glides flush into current side's corner
      const { w } = viewportSize();
      const { width } = petDimensions();
      const side = posX + width / 2 < w / 2 ? "left" : "right";
      const target = defaultPositionForDock(side);
      posX = target.x;
      posY = target.y;
      dockedSide = target.dockedSide;
      applyPosition(true);
      savePosition();
    } else if (!cfg.snap || cfg.dock === "free") {
      dockedSide = "";
      applyPosition(false);
      if (prevSnap !== cfg.snap) savePosition();
    } else {
      applyPosition(false);
    }

    updatePausedState();
    if (!paused) {
      scheduleBlink();
      scheduleTelemetryPolling();
    }
    api.lastSeen = Date.now();
    return status();
  }

  function setPosition(x, y, opts) {
    if (destroyed) return { x: posX, y: posY };
    posX = Number(x) || 0;
    posY = Number(y) || 0;
    if (opts && "dockedSide" in opts) dockedSide = opts.dockedSide || "";
    applyPosition(Boolean(opts && opts.animate));
    if (!opts || opts.persist !== false) savePosition();
    return { x: posX, y: posY, dockedSide };
  }

  function status() {
    const { width, height, scaleRatio } = petDimensions();
    return {
      applied: !destroyed && Boolean(host.isConnected),
      enabled: cfg.enabled,
      rev: PET_REV,
      owner: cfg.owner,
      state: effectiveState(),
      expression: activeExpression,
      paused,
      scale: cfg.scale,
      bubbleScale: Number(clamp(scaleRatio, 1, 0.6, 1.6).toFixed(3)),
      width,
      height,
      x: posX,
      y: posY,
      dock: cfg.dock,
      dockedSide,
      snap: cfg.snap,
      facing: currentFacing,
      mirrored: currentMirrored,
      surfaceMode: currentSurfaceMode,
      bubbleOpen,
      bubbleMode,
      bubbleText: currentBubbleText,
      bubbleMeta: currentBubbleMeta,
      bubbleTone: currentBubbleTone,
      quota: latestQuota,
      soundEnabled: cfg.soundEnabled,
      soundPack: cfg.soundPack,
      volume: cfg.volume,
      fallbackSvg: stage.getAttribute("data-fallback") === "svg",
    };
  }

  function destroy() {
    if (destroyed) return { removed: true };
    destroyed = true;
    clearBlinkTimers();
    clearTimeout(bubbleTimer);
    clearTimeout(expressionTimer);
    clearTimeout(transientTimer);
    clearInterval(telemetryTimer);
    clearTimeout(obsDebounceTimer);
    clearTimeout(idleRetryTimer);
    clearTimeout(snapTransitionTimer);
    for (const pt of particleTimers) clearTimeout(pt);
    particleTimers.clear();
    bubbleTimer = expressionTimer = transientTimer = telemetryTimer = obsDebounceTimer = idleRetryTimer = snapTransitionTimer = null;
    try {
      mutObserver?.disconnect();
    } catch {}
    mutObserver = null;
    try {
      themeObserver?.disconnect();
    } catch {}
    themeObserver = null;
    stopAudio();
    for (const off of cleanups) {
      try {
        off();
      } catch {}
    }
    cleanups.length = 0;
    try {
      host.remove?.();
    } catch {}
    if (win[GLOBAL_KEY] === api) {
      delete win[GLOBAL_KEY];
    }
    return { removed: true };
  }

  const api = {
    rev: PET_REV,
    owner: cfg.owner,
    lastSeen: Date.now(),
    touch() {
      api.lastSeen = Date.now();
      return true;
    },
    update,
    triggerQuip,
    showQuota,
    setPosition,
    status,
    destroy,
  };

  win[GLOBAL_KEY] = api;

  loadCharacterAssets(false);
  applyScaleAndAppearance();
  applyPosition(false);
  syncVisualState();
  updatePausedState();
  if (!paused) {
    scheduleBlink();
    scheduleTelemetryPolling();
    checkHostState();
  }

  return status();
}

module.exports = {
  installEmbeddedPet,
  EMBEDDED_PET_REV,
  EMBEDDED_PET_GLOBAL_KEY,
  EMBEDDED_PET_ASSETS,
};
