"use strict";

/**
 * Pure MIT clean-room Reasoning Effort Starlight Capsule Slider & Faceted Crystal Bar.
 * Deeply integrated with Antigravity's real `[data-testid="model-selector-panel"]` DOM
 * and React Fiber context (`effortIndex`, `modelOptions`, `selectedModel`, outermost
 * unwrapped `setSelectedModel`, `setIsOpen`, `orchestratorPick`), plus standalone fallback.
 *
 * Performance & Reliability Guarantees (REV 5):
 * - Zero nested `backdrop-filter` inside `[data-testid="model-selector-panel"]` (prevents 4K60 video double-blur lag).
 * - Zero `will-change` GPU layer explosion: single static crisp SVG starfield inside the nebula capsule.
 * - Zero hover-time React Fiber traversals: Fiber is read only on panel mount, explicit click/drag, or trigger label change.
 * - Never blindly swallows native clicks: single-tier models (Claude/GPT) and Orchestrator pass through natively;
 *   multi-tier group rows only intercept when a verified option & working setter exist (otherwise falls back to native).
 * - Never hides `[data-testid="orchestrator-picker-effort"]` anywhere; scopes `[data-testid="model-selector-effort-option"]`
 *   suppression strictly to `body:has([data-testid="model-selector-panel"].maomao-effort-panel-enhanced)`.
 *
 * CRITICAL INVARIANT:
 * Never translate or rewrite English model names or reasoning effort tier labels
 * (Off, Minimal, Low, Medium, High, Extra High, XHigh, Max, Auto, Thinking,
 * Orchestrator, Gemini, Claude, GPT...).
 */
function installEffortSlider(config) {
  const KEY = "__agyMaomaoEffortSlider";
  const REV = 5;
  const STYLE_ID = "agy-maomao-effort-slider-style";

  function normalizeConfig(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    const sub = src.effortSlider && typeof src.effortSlider === "object" ? src.effortSlider : src;
    return {
      owner: typeof src.owner === "string" && src.owner ? src.owner : "antigravity-star-suite",
      enabled: sub.enabled !== false,
      rememberPerModel: sub.rememberPerModel !== false,
      crystalOrchestrator: sub.crystalOrchestrator !== false,
      themeStyle: (src.themeStyle || src.glass?.themeStyle) === "official" ? "official" : "star-neko",
      mode: sub.mode === "force" || sub.mode === "off" ? sub.mode : "auto",
      storageKey: typeof sub.storageKey === "string" && sub.storageKey ? sub.storageKey : "maomao_effort_memory_v1",
    };
  }

  let cfg = normalizeConfig(config);

  if (window[KEY]) {
    if (window[KEY].owner === cfg.owner && window[KEY].rev === REV && typeof window[KEY].update === "function") {
      window[KEY].update(config);
      return window[KEY].status();
    }
    try {
      window[KEY].destroy();
    } catch {}
  }

  if (typeof document === "undefined" || !document.body) {
    return { applied: false, reason: "no-dom" };
  }

  // Canonical ordered effort keys & exact preserved English display labels (NEVER translated!)
  const EFFORT_ORDER = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
  const EFFORT_LABELS = {
    off: "Off",
    minimal: "Minimal",
    low: "Low",
    medium: "Medium",
    high: "High",
    xhigh: "Extra High",
    max: "Max",
  };
  const EFFORT_RANK = [
    { key: "off", re: /^off$/i },
    { key: "minimal", re: /^minimal$/i },
    { key: "low", re: /^low$/i },
    { key: "medium", re: /^medium$/i },
    { key: "high", re: /^high$/i },
    { key: "xhigh", re: /^(?:extra[\s-]*high|xhigh|extra)$/i },
    { key: "max", re: /^max$/i },
  ];
  const AUTO_ORCH_RE = /\b(orchestrator|auto)\b/i;

  let active = true;
  let observer = null;
  let themeAttrObs = null;
  let scanTimer = 0;
  let lastCssKey = "";
  let lastTriggerLabel = "";
  let cachedEditableEl = null;
  const mountedPopups = new Map(); // hostPanelOrMenu -> { root, cleanup, mode, refreshVisualOnly, syncFromTrigger }
  const docListeners = [];

  function addDocListener(target, type, fn, opts) {
    if (!target || typeof target.addEventListener !== "function") return;
    target.addEventListener(type, fn, opts);
    docListeners.push([target, type, fn, opts]);
  }

  // ---- 4-Surface Theme Detection (dark / light / glass-dark / glass-light) ----
  function detectHostDark() {
    try {
      const html = document.documentElement;
      const body = document.body;
      const attr = html?.getAttribute?.("data-theme") || body?.getAttribute?.("data-theme");
      if (attr === "dark") return true;
      if (attr === "light") return false;
      if (
        html?.classList?.contains?.("dark") ||
        body?.classList?.contains?.("dark") ||
        body?.classList?.contains?.("dark-theme")
      ) {
        return true;
      }
      if (
        html?.classList?.contains?.("light") ||
        body?.classList?.contains?.("light") ||
        body?.classList?.contains?.("light-theme")
      ) {
        return false;
      }
      if (typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: dark)")?.matches) {
        return true;
      }
      return false;
    } catch {
      return true;
    }
  }

  function detectIsGlass() {
    try {
      return Boolean(
        document.documentElement?.classList?.contains?.("agy-dream-active-v2") ||
          document.getElementById?.("agy-dream-wallpaper-v2")
      );
    } catch {
      return false;
    }
  }

  function detectSurfaceMode() {
    const dark = detectHostDark();
    const glass = detectIsGlass();
    return glass ? (dark ? "glass-dark" : "glass-light") : (dark ? "dark" : "light");
  }

  function hasExternalSlider() {
    try {
      if (window.__agEffortSlider || window.__obsidianEffortSlider || window.AntigravityCodexEffortSlider) return true;
      return Boolean(
        document.querySelector?.(
          "[data-effort-slider]:not([data-maomao-effort]), .ag-effort-slider, #ag-effort-slider, .ces-ag-section, .ces-root"
        )
      );
    } catch {
      return false;
    }
  }

  // ---- Per-Model Effort Memory (localStorage) ----
  function readMemory() {
    try {
      if (typeof window.localStorage === "undefined" || !window.localStorage) return {};
      const raw = window.localStorage.getItem(cfg.storageKey);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  }

  function writeMemory(modelKey, effortLabel) {
    if (!cfg.rememberPerModel || !modelKey || !effortLabel) return;
    try {
      if (typeof window.localStorage === "undefined" || !window.localStorage) return;
      const map = readMemory();
      map[modelKey] = effortLabel;
      const keys = Object.keys(map);
      if (keys.length > 48) {
        for (let i = 0; i < keys.length - 48; i++) delete map[keys[i]];
      }
      window.localStorage.setItem(cfg.storageKey, JSON.stringify(map));
    } catch {}
  }

  // ---- Label & Effort Parsing (Strict English Preservation) ----
  function normalizeEffortKey(raw) {
    const s = String(raw || "")
      .replace(/[✓✔•·()]+/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (!s) return "";
    if (s === "off") return "off";
    if (s === "minimal" || s === "min") return "minimal";
    if (s === "low") return "low";
    if (s === "medium" || s === "med") return "medium";
    if (s === "high") return "high";
    if (s === "xhigh" || s === "extra high" || s === "extra-high" || s === "extra") return "xhigh";
    if (s === "max") return "max";
    return "";
  }

  function formatEffortLabel(effortKey, fallbackRaw) {
    const k = normalizeEffortKey(effortKey);
    if (k && EFFORT_LABELS[k]) return EFFORT_LABELS[k];
    const clean = String(fallbackRaw || effortKey || "").trim();
    return clean || "Auto";
  }

  function normalizeBaseSlug(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9.]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function isOrchestratorOption(opt) {
    if (!opt || typeof opt !== "object") return false;
    const id = String(opt.modelId || opt.id || "").toLowerCase();
    const lbl = String(opt.label || "").trim();
    return id.includes("orchestrator") || /^orchestrator\b/i.test(lbl);
  }

  function parseModelLabel(label) {
    const s = String(label || "").replace(/\s+/g, " ").trim();
    if (!s) return null;
    const paren = /^(.+?)\s*\(([^()]+)\)\s*$/.exec(s);
    if (paren) {
      const base = paren[1].trim();
      const inside = paren[2].trim();
      const key = normalizeEffortKey(inside);
      return {
        base,
        effortKey: key,
        effortLabel: key ? EFFORT_LABELS[key] : inside,
        isKnownEffort: Boolean(key),
      };
    }
    const tail = /^(.+?)\s+(Extra[\s-]+High|XHigh|Minimal|Medium|High|Low|Off|Max|Auto|Thinking)\s*$/i.exec(s);
    if (tail) {
      const base = tail[1].trim();
      const rawTier = tail[2].trim();
      const key = normalizeEffortKey(rawTier);
      return {
        base,
        effortKey: key,
        effortLabel: key ? EFFORT_LABELS[key] : rawTier,
        isKnownEffort: Boolean(key),
      };
    }
    return { base: s, effortKey: "", effortLabel: "", isKnownEffort: false };
  }

  function extractBaseModelName(rawText) {
    const parsed = parseModelLabel(rawText);
    return parsed ? parsed.base : String(rawText || "").trim();
  }

  function getCurrentModelLabel() {
    try {
      const trigger = document.querySelector?.('[data-testid="model-selector-trigger"]');
      if (trigger) {
        const attr = trigger.getAttribute?.("data-model-label");
        if (attr && attr.trim()) return attr.trim();
        if (trigger.textContent) return trigger.textContent.replace(/\s+/g, " ").trim();
      }
    } catch {}
    return "";
  }

  // ---- Antigravity React Fiber Context Reader ----
  function getReactFiber(el) {
    if (!el || typeof el !== "object") return null;
    try {
      const keys = Object.keys(el);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        if (k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$")) {
          return el[k] || null;
        }
      }
    } catch {}
    return null;
  }

  function addEntryToEffortGroup(indexMap, baseName, effortKey, opt) {
    if (!baseName || !effortKey || !opt) return;
    const slug = normalizeBaseSlug(baseName);
    if (!slug) return;
    let rec = indexMap.get(slug);
    if (!rec) {
      rec = { baseName, byEffort: new Map() };
      indexMap.set(slug, rec);
    }
    if (!rec.byEffort.has(effortKey)) {
      rec.byEffort.set(effortKey, opt);
    }
  }

  function buildNormalizedEffortIndex(rawEffortIndex, modelOptions) {
    const indexMap = new Map();
    if (rawEffortIndex instanceof Map) {
      rawEffortIndex.forEach((val, rawKey) => {
        if (!val) return;
        const pairs = val instanceof Map ? Array.from(val.entries()) : typeof val === "object" ? Object.entries(val) : [];
        for (let i = 0; i < pairs.length; i++) {
          const [ek, opt] = pairs[i];
          const normKey = normalizeEffortKey(ek);
          if (!normKey || !opt) continue;
          const parsed = parseModelLabel(opt.label || "");
          const baseName = (parsed && parsed.base) || String(rawKey || "");
          addEntryToEffortGroup(indexMap, baseName, normKey, opt);
          const rawSlug = normalizeBaseSlug(rawKey);
          if (rawSlug && !indexMap.has(rawSlug)) {
            indexMap.set(rawSlug, indexMap.get(normalizeBaseSlug(baseName)));
          }
        }
      });
    }
    if (Array.isArray(modelOptions)) {
      for (let i = 0; i < modelOptions.length; i++) {
        const opt = modelOptions[i];
        if (!opt || typeof opt.label !== "string" || isOrchestratorOption(opt)) continue;
        const parsed = parseModelLabel(opt.label);
        if (parsed && parsed.isKnownEffort && parsed.base) {
          addEntryToEffortGroup(indexMap, parsed.base, parsed.effortKey, opt);
        }
      }
    }
    return indexMap;
  }

  function lookupEffortGroup(effortIndex, baseName) {
    if (!effortIndex || !baseName) return null;
    const slug = normalizeBaseSlug(baseName);
    return effortIndex.get(slug) || null;
  }

  function readFiberContext(el) {
    const startFiber = getReactFiber(el);
    if (!startFiber) return null;

    let selectorCtx = null;
    let innerPopoverProps = null;
    let outerPopoverProps = null;
    let globalModelCtx = null;
    let conversationId = undefined;
    let hasConversationSelector = false;

    let cur = startFiber;
    for (let step = 0; cur && step < 160; step++, cur = cur.return) {
      const props = cur.memoizedProps;
      if (!props || typeof props !== "object") continue;

      if (!selectorCtx && props.value && typeof props.value === "object") {
        const val = props.value;
        if (val.effortIndex instanceof Map || Array.isArray(val.modelOptions)) {
          selectorCtx = val;
        }
      }

      if (
        typeof props.setIsOpen === "function" &&
        typeof props.setSelectedModel === "function" &&
        Array.isArray(props.modelOptions)
      ) {
        if (!innerPopoverProps) innerPopoverProps = props;
        outerPopoverProps = props;
      }

      if (
        !hasConversationSelector &&
        "conversationId" in props &&
        ("placement" in props || "orchestratorPickable" in props || "bestOfNConfig" in props)
      ) {
        hasConversationSelector = true;
        conversationId = props.conversationId;
      }

      if (
        !globalModelCtx &&
        props.value &&
        typeof props.value === "object" &&
        typeof props.value.setModelConfigByLabelForConversation === "function"
      ) {
        globalModelCtx = props.value;
      }

      // Stop climbing as soon as we have selectorCtx + outerPopoverProps + conversationId
      if (selectorCtx && outerPopoverProps && hasConversationSelector && step > 35) {
        break;
      }
    }

    if (!selectorCtx && !innerPopoverProps && !outerPopoverProps && !globalModelCtx) return null;

    const modelOptions =
      (outerPopoverProps && Array.isArray(outerPopoverProps.modelOptions) && outerPopoverProps.modelOptions) ||
      (innerPopoverProps && Array.isArray(innerPopoverProps.modelOptions) && innerPopoverProps.modelOptions) ||
      (selectorCtx && Array.isArray(selectorCtx.modelOptions) && selectorCtx.modelOptions) ||
      (globalModelCtx && Array.isArray(globalModelCtx.visibleModelConfigs) && globalModelCtx.visibleModelConfigs) ||
      [];

    const selectedModel =
      (outerPopoverProps && outerPopoverProps.selectedModel) ||
      (innerPopoverProps && innerPopoverProps.selectedModel) ||
      (selectorCtx && selectorCtx.selectedModel) ||
      (globalModelCtx &&
        (hasConversationSelector && typeof globalModelCtx.getModelConfigForConversation === "function"
          ? globalModelCtx.getModelConfigForConversation(conversationId)
          : globalModelCtx.currentModelConfig)) ||
      null;

    const effortIndex = buildNormalizedEffortIndex(selectorCtx?.effortIndex || null, modelOptions);

    // Outermost Popover receives the real unwrapped setSelectedModel (does NOT call setIsOpen(false))
    const unwrappedSetSelectedModel =
      (outerPopoverProps && typeof outerPopoverProps.setSelectedModel === "function" && outerPopoverProps.setSelectedModel) ||
      (innerPopoverProps && typeof innerPopoverProps.setSelectedModel === "function" && innerPopoverProps.setSelectedModel) ||
      (selectorCtx && typeof selectorCtx.setSelectedModel === "function" && selectorCtx.setSelectedModel) ||
      null;

    const setIsOpen =
      (outerPopoverProps && typeof outerPopoverProps.setIsOpen === "function" && outerPopoverProps.setIsOpen) ||
      (innerPopoverProps && typeof innerPopoverProps.setIsOpen === "function" && innerPopoverProps.setIsOpen) ||
      (selectorCtx && typeof selectorCtx.setIsOpen === "function" && selectorCtx.setIsOpen) ||
      null;

    const orchestratorPick =
      outerPopoverProps?.orchestratorPick || innerPopoverProps?.orchestratorPick || selectorCtx?.orchestratorPick || null;

    let orchestratorModelOption = null;
    for (let i = 0; i < modelOptions.length; i++) {
      if (isOrchestratorOption(modelOptions[i])) {
        orchestratorModelOption = modelOptions[i];
        break;
      }
    }

    return {
      modelOptions,
      selectedModel,
      effortIndex,
      unwrappedSetSelectedModel,
      setIsOpen,
      conversationId,
      hasConversationSelector,
      setModelConfigByLabelForConversation:
        globalModelCtx && typeof globalModelCtx.setModelConfigByLabelForConversation === "function"
          ? globalModelCtx.setModelConfigByLabelForConversation
          : null,
      orchestratorPick,
      orchestratorModelOption,
      orchestratorDefaultPlanner: selectorCtx?.orchestratorDefaultPlanner || null,
    };
  }

  function hasWorkingSetter(ctx) {
    return Boolean(
      ctx &&
        (typeof ctx.unwrappedSetSelectedModel === "function" ||
          typeof ctx.setModelConfigByLabelForConversation === "function")
    );
  }

  /**
   * Commit a target Antigravity model option via the verified outermost `setSelectedModel`
   * (with surgical Lexical editor focus guard so the menu stays open).
   * Returns true ONLY if an actual setter executed without throwing.
   */
  function commitModelOption(ctx, targetOption) {
    if (!ctx || !targetOption || !targetOption.label) return false;
    try {
      // Primary verified setter in Antigravity 2.x: outermost unwrapped `setSelectedModel(option)`
      if (typeof ctx.unwrappedSetSelectedModel === "function") {
        const editable =
          cachedEditableEl && cachedEditableEl.isConnected === true
            ? cachedEditableEl
            : document.querySelector?.('[data-lexical-editor="true"], [contenteditable="true"]') || null;
        if (editable && editable.isConnected === true) cachedEditableEl = editable;
        else cachedEditableEl = null;

        const editorInst = editable ? editable.__lexicalEditor : null;
        const editorProto = editorInst ? Object.getPrototypeOf(editorInst) : null;
        const origEditorFocus = editorProto && typeof editorProto.focus === "function" ? editorProto.focus : null;
        const origInstFocus =
          editorInst && Object.prototype.hasOwnProperty.call(editorInst, "focus") ? editorInst.focus : null;
        const origEditableFocus =
          editable && Object.prototype.hasOwnProperty.call(editable, "focus") ? editable.focus : null;
        const origHtmlFocus =
          typeof HTMLElement !== "undefined" && HTMLElement.prototype ? HTMLElement.prototype.focus : null;

        const noop = function () {};
        if (origEditorFocus) editorProto.focus = noop;
        if (origInstFocus) editorInst.focus = noop;
        if (editable && typeof editable.focus === "function") editable.focus = noop;
        if (origHtmlFocus) HTMLElement.prototype.focus = noop;

        try {
          ctx.unwrappedSetSelectedModel(targetOption);
        } finally {
          if (origEditorFocus) editorProto.focus = origEditorFocus;
          if (origInstFocus) editorInst.focus = origInstFocus;
          if (editable) {
            if (origEditableFocus) editable.focus = origEditableFocus;
            else delete editable.focus;
          }
          if (origHtmlFocus) HTMLElement.prototype.focus = origHtmlFocus;
        }

        if (typeof ctx.setIsOpen === "function") {
          try {
            ctx.setIsOpen(true);
          } catch {}
        }
        return true;
      }

      // Legacy Antigravity fallback
      if (typeof ctx.setModelConfigByLabelForConversation === "function") {
        ctx.setModelConfigByLabelForConversation(targetOption.label, ctx.conversationId, true);
        return true;
      }
    } catch {}
    return false;
  }

  function resolveProfileFromContext(ctx, overrideTarget, panel) {
    if (!ctx) return null;
    const mem = readMemory();
    const selected = overrideTarget?.modelOption || ctx.selectedModel;

    // 1. Orchestrator / Auto mode
    const wantsOrchestrator =
      Boolean(overrideTarget?.isOrchestrator) ||
      (selected && isOrchestratorOption(selected)) ||
      (overrideTarget?.baseName && /^orchestrator\b/i.test(overrideTarget.baseName));

    if (wantsOrchestrator) {
      let plannerLabel = "";
      try {
        const orchSpan = panel?.querySelector?.('[data-testid="model-selector-orchestrator-model"]');
        if (orchSpan && orchSpan.textContent) plannerLabel = orchSpan.textContent.replace(/\s+/g, " ").trim();
      } catch {}
      if (!plannerLabel && ctx.orchestratorDefaultPlanner?.label) {
        plannerLabel = ctx.orchestratorDefaultPlanner.label;
      }
      const plannerBase = plannerLabel ? extractBaseModelName(plannerLabel) : "";
      return {
        mode: "crystal",
        isOrchestrator: true,
        locked: true,
        baseName: "Orchestrator",
        subtitle: plannerBase ? "· " + plannerBase : "",
        levels: [{ key: "auto", label: "Auto", option: ctx.orchestratorModelOption || selected }],
        currentIndex: 0,
        currentKey: "auto",
        currentLabel: "Auto",
        modelOption: ctx.orchestratorModelOption || selected,
      };
    }

    // 2. Multi-tier effort model group
    let baseName = overrideTarget?.baseName || "";
    let activeEffortKey = "";
    if (selected && typeof selected.label === "string") {
      const parsed = parseModelLabel(selected.label);
      if (parsed) {
        if (!baseName) baseName = parsed.base;
        if (parsed.isKnownEffort && normalizeBaseSlug(parsed.base) === normalizeBaseSlug(baseName)) {
          activeEffortKey = parsed.effortKey;
        }
      } else if (!baseName) {
        baseName = selected.label;
      }
    }

    const group = lookupEffortGroup(ctx.effortIndex, baseName);
    if (group && group.byEffort && group.byEffort.size >= 2) {
      const sortedKeys = EFFORT_ORDER.filter((k) => group.byEffort.has(k));
      if (!activeEffortKey || !group.byEffort.has(activeEffortKey)) {
        const rememberedRaw = mem[group.baseName] || mem[baseName];
        const rememberedKey = normalizeEffortKey(rememberedRaw);
        if (rememberedKey && group.byEffort.has(rememberedKey)) {
          activeEffortKey = rememberedKey;
        } else if (group.byEffort.has("medium")) {
          activeEffortKey = "medium";
        } else {
          activeEffortKey = sortedKeys[0] || "";
        }
      }
      const levels = sortedKeys.map((k) => ({
        key: k,
        label: EFFORT_LABELS[k] || k,
        option: group.byEffort.get(k),
      }));
      const idx = Math.max(0, sortedKeys.indexOf(activeEffortKey));
      return {
        mode: "starlight",
        isOrchestrator: false,
        locked: false,
        baseName: group.baseName,
        subtitle: "",
        levels,
        currentIndex: idx,
        currentKey: levels[idx]?.key || activeEffortKey,
        currentLabel: levels[idx]?.label || formatEffortLabel(activeEffortKey),
        modelOption: levels[idx]?.option || selected,
      };
    }

    // 3. Single-tier locked model (e.g., Claude Sonnet 4.6 (Thinking), GPT-OSS 120B (Medium))
    const parsedSingle = parseModelLabel((selected && selected.label) || baseName);
    const fixedLabel = (parsedSingle && parsedSingle.effortLabel) || "Auto";
    const resolvedBase = (parsedSingle && parsedSingle.base) || baseName || "Model";
    return {
      mode: "crystal",
      isOrchestrator: false,
      locked: true,
      baseName: resolvedBase,
      subtitle: "",
      levels: [{ key: normalizeEffortKey(fixedLabel) || "fixed", label: fixedLabel, option: selected }],
      currentIndex: 0,
      currentKey: normalizeEffortKey(fixedLabel) || "fixed",
      currentLabel: fixedLabel,
      modelOption: selected,
    };
  }

  function resolveFallbackPanelProfile(panel) {
    const trigLabel = getCurrentModelLabel();
    if (AUTO_ORCH_RE.test(trigLabel)) {
      const orchSpan = panel.querySelector?.('[data-testid="model-selector-orchestrator-model"]');
      const plannerBase = orchSpan?.textContent ? extractBaseModelName(orchSpan.textContent) : "";
      return {
        mode: "crystal",
        isOrchestrator: true,
        locked: true,
        baseName: "Orchestrator",
        subtitle: plannerBase ? "· " + plannerBase : "",
        levels: [{ key: "auto", label: "Auto", option: null }],
        currentIndex: 0,
        currentKey: "auto",
        currentLabel: "Auto",
        modelOption: null,
      };
    }
    const parsed = parseModelLabel(trigLabel);
    const groupSpans = Array.from(panel.querySelectorAll?.('[data-testid="model-selector-effort-group"]') || []);
    const matchedGroup =
      groupSpans.find((sp) => normalizeBaseSlug(sp.getAttribute?.("data-model-base") || sp.textContent) === normalizeBaseSlug(parsed?.base)) ||
      groupSpans[0];
    if (matchedGroup) {
      const base = matchedGroup.getAttribute?.("data-model-base") || (matchedGroup.textContent || "").trim();
      const hasXHigh = /neon|hydrogen/i.test(base);
      const keys = hasXHigh ? ["low", "medium", "high", "xhigh"] : ["low", "medium", "high"];
      const levels = keys.map((k) => ({ key: k, label: EFFORT_LABELS[k], option: null }));
      const curKey = parsed?.isKnownEffort && keys.includes(parsed.effortKey) ? parsed.effortKey : "medium";
      const idx = Math.max(0, keys.indexOf(curKey));
      return {
        mode: "starlight",
        isOrchestrator: false,
        locked: false,
        baseName: base,
        subtitle: "",
        levels,
        currentIndex: idx,
        currentKey: curKey,
        currentLabel: EFFORT_LABELS[curKey],
        modelOption: null,
      };
    }
    return {
      mode: "crystal",
      isOrchestrator: false,
      locked: true,
      baseName: parsed?.base || "Model",
      subtitle: "",
      levels: [{ key: "auto", label: parsed?.effortLabel || "Auto", option: null }],
      currentIndex: 0,
      currentKey: "auto",
      currentLabel: parsed?.effortLabel || "Auto",
      modelOption: null,
    };
  }

  // ---- Tier Color Helpers (4-Surface Aware) ----
  function tierColorFor(key, dark) {
    const k = normalizeEffortKey(key);
    if (k === "off" || k === "minimal") return dark ? "#94a3b8" : "#64748b";
    if (k === "low") return dark ? "#93c5fd" : "#2563eb";
    if (k === "medium") return dark ? "#c4b5fd" : "#6d28d9";
    if (k === "high") return dark ? "#d8b4fe" : "#7c3aed";
    if (k === "xhigh" || k === "max") return dark ? "#e879f9" : "#a21caf";
    return dark ? "#f5f0ff" : "#312e81";
  }

  function tierFillGradientFor(key, pct, starNeko) {
    const k = normalizeEffortKey(key);
    if (!starNeko) {
      if (k === "xhigh" || k === "max") return "linear-gradient(90deg, #065f46 0%, #059669 40%, #10b981 74%, #34d399 100%)";
      if (k === "high") return "linear-gradient(90deg, #0f766e 0%, #0d9488 50%, #14b8a6 100%)";
      return "linear-gradient(90deg, #1d4ed8 0%, #2563eb 55%, #38bdf8 100%)";
    }
    if (k === "low" || k === "minimal" || k === "off") {
      return "linear-gradient(90deg, #1e1b4b 0%, #3730a3 52%, #6366f1 100%)";
    }
    if (k === "medium") {
      return "linear-gradient(90deg, #24185c 0%, #4c1d95 45%, #7c3aed 80%, #a855f7 100%)";
    }
    if (k === "high") {
      return "linear-gradient(90deg, #2b1464 0%, #5b21b6 34%, #8b5cf6 68%, #c084fc 100%)";
    }
    if (pct >= 0.85 || k === "xhigh" || k === "max") {
      return "linear-gradient(90deg, #27125c 0%, #581c87 22%, #7e22ce 48%, #a855f7 76%, #d946ef 94%, #f0abfc 100%)";
    }
    return "linear-gradient(90deg, #2b1464 0%, #6d28d9 52%, #a855f7 100%)";
  }

  // ---- Hysteresis Detent Computation ----
  function detentTargetIndex(currentIdx, ptrPct, count) {
    if (count <= 1) return 0;
    const clamped = Math.max(0, Math.min(1, ptrPct));
    const maxIdx = count - 1;
    const step = 1 / maxIdx;
    const cur = Math.max(0, Math.min(maxIdx, currentIdx));
    const curCenter = cur * step;
    const delta = clamped - curCenter;
    if (Math.abs(delta) < step * 0.64) return cur;
    if (delta > 0) {
      return Math.min(maxIdx, Math.floor((clamped + step * 0.36) / step));
    }
    return Math.max(0, Math.ceil((clamped - step * 0.36) / step));
  }

  // ---- Sync Host Row Effort Badge (Preserve Exact English!) ----
  function syncRowEffortDisplay(panel, profile) {
    if (!panel || !profile) return;
    const dark = detectHostDark();
    const color = tierColorFor(profile.currentKey, dark);
    try {
      if (!profile.isOrchestrator && profile.baseName) {
        const groupSpans = panel.querySelectorAll?.('[data-testid="model-selector-effort-group"]') || [];
        const targetSlug = normalizeBaseSlug(profile.baseName);
        for (let i = 0; i < groupSpans.length; i++) {
          const sp = groupSpans[i];
          const base = sp.getAttribute?.("data-model-base") || (sp.textContent || "").trim();
          if (normalizeBaseSlug(base) === targetSlug) {
            const sib = sp.nextSibling;
            if (sib && sib.tagName === "SPAN") {
              const displayShort = profile.currentKey === "xhigh" ? "XHigh" : profile.currentLabel;
              if (sib.textContent !== displayShort) sib.textContent = displayShort;
              if (sib.style) {
                sib.style.color = color;
                sib.style.opacity = "0.95";
                sib.style.fontWeight = "600";
              }
            }
          }
        }
      }
    } catch {}
  }

  // ---- Cached 4-Surface CSS Injection (ZERO nested backdrop-filter, ZERO will-change) ----
  function ensureStyle() {
    const head = document.head || document.documentElement;
    if (!head) return;
    const surfaceMode = detectSurfaceMode();
    const cssKey = `${surfaceMode}:${cfg.themeStyle}`;
    let style = document.getElementById?.(STYLE_ID) || head.querySelector?.("#" + STYLE_ID);
    if (style && lastCssKey === cssKey) return;
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      head.appendChild(style);
    }
    lastCssKey = cssKey;

    const dark = detectHostDark();
    const glass = detectIsGlass();
    const starNeko = cfg.themeStyle !== "official";

    // Crisp translucent surface without nested backdrop-filter (parent panel already applies glass blur!)
    const cardBg = glass
      ? dark
        ? starNeko
          ? "rgba(20, 15, 36, 0.72)"
          : "rgba(18, 20, 28, 0.74)"
        : starNeko
          ? "rgba(248, 244, 255, 0.82)"
          : "rgba(255, 255, 255, 0.84)"
      : dark
        ? starNeko
          ? "rgba(22, 19, 34, 0.96)"
          : "rgba(20, 22, 30, 0.96)"
        : "rgba(255, 255, 255, 0.98)";

    const cardBorder = dark
      ? starNeko
        ? "rgba(176, 146, 255, 0.28)"
        : "rgba(255, 255, 255, 0.16)"
      : starNeko
        ? "rgba(139, 92, 246, 0.24)"
        : "rgba(15, 23, 42, 0.14)";

    const cardMaxBorder = dark
      ? starNeko
        ? "rgba(208, 162, 255, 0.56)"
        : "rgba(52, 211, 153, 0.52)"
      : starNeko
        ? "rgba(147, 51, 234, 0.44)"
        : "rgba(5, 150, 105, 0.42)";

    const cardMaxShadow = dark
      ? starNeko
        ? "0 0 14px rgba(168, 85, 247, 0.24), inset 0 1px 0 rgba(255, 255, 255, 0.14)"
        : "0 0 12px rgba(16, 185, 129, 0.20), inset 0 1px 0 rgba(255, 255, 255, 0.12)"
      : starNeko
        ? "0 3px 12px rgba(139, 92, 246, 0.14), inset 0 1px 0 rgba(255, 255, 255, 0.94)"
        : "0 3px 10px rgba(15, 23, 42, 0.08)";

    const baseShadow = dark
      ? "inset 0 1px 0 rgba(255, 255, 255, 0.10)"
      : "inset 0 1px 0 rgba(255, 255, 255, 0.92), 0 2px 6px rgba(15, 23, 42, 0.06)";

    const fg = dark ? "#f5f0ff" : "#1a162b";
    const muted = dark ? "rgba(226, 214, 255, 0.76)" : "rgba(52, 42, 82, 0.78)";
    const trackBg = dark ? "rgba(12, 10, 24, 0.84)" : "rgba(109, 86, 178, 0.14)";
    const trackBorder = dark ? "rgba(196, 174, 255, 0.22)" : "rgba(124, 58, 237, 0.22)";

    style.textContent = `
/* Strictly scope effort-option submenu suppression ONLY while enhanced composer model panel is open!
   NEVER hide Orchestrator planner/executor effort submenus or Settings page pickers! */
body:has([data-testid="model-selector-panel"].maomao-effort-panel-enhanced) [role="menu"]:has([data-testid="model-selector-effort-option"]):not(:has([data-testid="model-selector-panel"])),
body:has([data-testid="model-selector-panel"].maomao-effort-panel-enhanced) div[role="presentation"]:has(> [role="menu"] [data-testid="model-selector-effort-option"]):not(:has([data-testid="model-selector-panel"])) {
  display: none !important;
  visibility: hidden !important;
  pointer-events: none !important;
}
[data-testid="model-selector-panel"].maomao-effort-panel-enhanced [role="menuitem"]:has([data-testid="model-selector-effort-group"]) > span:last-child svg {
  opacity: 0 !important;
  pointer-events: none !important;
}
[data-maomao-effort-hidden="1"] {
  display: none !important;
}

/* Zero Radix / Base UI focus box & text selection inside effort section */
.maomao-effort-section,
.maomao-effort-section *,
.maomao-effort-section:focus,
.maomao-effort-section:focus-visible,
.maomao-effort-section:focus-within,
.maomao-effort-section *:focus,
.maomao-effort-section *:focus-visible {
  outline: none !important;
  outline-width: 0 !important;
  user-select: none !important;
  -webkit-user-select: none !important;
}

.maomao-effort-section {
  box-sizing: border-box;
  padding: 2px 4px 4px;
  flex-shrink: 0;
  contain: layout style;
}
.maomao-effort-sep {
  height: 1px;
  margin: 2px -4px 6px;
  background: ${dark ? "rgba(255, 255, 255, 0.09)" : "rgba(15, 23, 42, 0.10)"};
}

.maomao-effort-card {
  box-sizing: border-box;
  padding: 9px 11px 10px;
  border-radius: 13px;
  background: ${cardBg};
  border: 1px solid ${cardBorder};
  box-shadow: ${baseShadow};
  color: ${fg};
  font-family: inherit;
  position: relative;
  overflow: hidden;
  contain: layout style;
  transition: border-color 160ms ease, box-shadow 180ms ease;
}
.maomao-effort-card[data-tier-max="1"] {
  border-color: ${cardMaxBorder};
  box-shadow: ${cardMaxShadow};
}

.maomao-effort-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
  font-size: 12px;
  line-height: 1.2;
}
.maomao-effort-title-wrap {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}
.maomao-effort-title {
  color: ${muted};
  font-weight: 550;
  letter-spacing: 0.01em;
  white-space: nowrap;
}
.maomao-effort-sub {
  color: ${dark ? "rgba(216, 200, 255, 0.56)" : "rgba(76, 62, 118, 0.66)"};
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.maomao-effort-value {
  font-weight: 680;
  font-size: 12px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  flex-shrink: 0;
  transition: color 140ms ease;
}

/* ---- Wide Starlight Nebula Capsule Track (26px tall, single-layer SVG starfield, 0 GPU layer bloat) ---- */
.maomao-effort-track-wrap {
  position: relative;
  height: 26px;
  display: flex;
  align-items: center;
  cursor: pointer;
  touch-action: none;
}
.maomao-effort-track {
  position: relative;
  width: 100%;
  height: 26px;
  border-radius: 9999px;
  background: ${trackBg};
  border: 1px solid ${trackBorder};
  box-shadow: inset 0 2px 5px rgba(0, 0, 0, ${dark ? "0.42" : "0.14"});
  overflow: hidden;
}
.maomao-effort-fill {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  min-width: 26px;
  border-radius: 9999px;
  background: var(--maomao-effort-grad, linear-gradient(90deg, #27125c 0%, #6d28d9 52%, #c084fc 90%, #f0abfc 100%));
  box-shadow: 0 0 14px var(--maomao-effort-glow, rgba(168, 85, 247, 0.48)), inset 0 1px 0 rgba(255, 255, 255, 0.24);
  transition: width 140ms cubic-bezier(0.22, 1, 0.36, 1);
  overflow: hidden;
}
.maomao-effort-card[data-dragging="1"] .maomao-effort-fill,
.maomao-effort-card[data-dragging="1"] .maomao-effort-thumb {
  transition: none;
}
.maomao-effort-nebula-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(64% 120% at 78% 50%, rgba(244, 182, 255, 0.34) 0%, rgba(168, 85, 247, 0.12) 48%, transparent 80%);
}
.maomao-effort-stars-svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}

.maomao-effort-stops {
  position: absolute;
  inset: 0 13px;
  pointer-events: none;
}
.maomao-effort-stop {
  position: absolute;
  top: 50%;
  width: 3.5px;
  height: 3.5px;
  border-radius: 9999px;
  transform: translate(-50%, -50%);
  background: ${dark ? "rgba(255, 255, 255, 0.24)" : "rgba(76, 29, 149, 0.24)"};
}
.maomao-effort-stop[data-passed="1"] {
  background: rgba(255, 255, 255, 0.56);
}

/* Glowing White-Jade Orb Thumb nestled inside the 26px pill */
.maomao-effort-thumb {
  position: absolute;
  top: 50%;
  width: 20px;
  height: 20px;
  border-radius: 9999px;
  transform: translate(-50%, -50%);
  background: radial-gradient(circle at 38% 34%, #ffffff 0%, #ffffff 58%, #f3e8ff 84%, #d8b4fe 100%);
  box-shadow:
    0 0 10px rgba(255, 255, 255, 0.94),
    0 0 18px var(--maomao-effort-glow, rgba(216, 180, 254, 0.72)),
    0 1px 3px rgba(15, 10, 35, 0.38);
  transition: left 140ms cubic-bezier(0.22, 1, 0.36, 1), transform 110ms ease;
  pointer-events: none;
  z-index: 2;
}
.maomao-effort-track-wrap:hover .maomao-effort-thumb,
.maomao-effort-card[data-dragging="1"] .maomao-effort-thumb {
  transform: translate(-50%, -50%) scale(1.06);
}

/* ---- Faceted Silver-White Cut-Crystal Bar (Orchestrator / Auto / Locked) ---- */
.maomao-crystal-bar {
  position: relative;
  width: 100%;
  height: 26px;
  border-radius: 9999px;
  overflow: hidden;
  border: 1px solid ${dark ? "rgba(236, 244, 255, 0.42)" : "rgba(100, 116, 139, 0.36)"};
  background: ${
    dark
      ? "linear-gradient(108deg, #1e2432 0%, #64748b 18%, #e2e8f0 36%, #ffffff 54%, #cbd5e1 72%, #334155 88%, #1e293b 100%)"
      : "linear-gradient(108deg, #94a3b8 0%, #cbd5e1 18%, #f8fafc 42%, #ffffff 58%, #e2e8f0 78%, #64748b 100%)"
  };
  box-shadow:
    inset 0 1.5px 0 rgba(255, 255, 255, 0.88),
    inset 0 -2px 4px rgba(15, 23, 42, ${dark ? "0.60" : "0.26"}),
    0 2px 10px rgba(148, 163, 184, ${dark ? "0.22" : "0.16"});
  --mx: 62%;
  --my: 45%;
  cursor: default;
}
.maomao-crystal-facets {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  pointer-events: none;
}
.maomao-crystal-sheen {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(
    92px 34px at var(--mx, 62%) var(--my, 45%),
    rgba(255, 255, 255, 0.84) 0%,
    rgba(226, 238, 255, 0.32) 44%,
    transparent 74%
  );
  mix-blend-mode: ${dark ? "screen" : "overlay"};
  opacity: 0.82;
}
.maomao-crystal-lock {
  position: absolute;
  right: 8px;
  top: 50%;
  transform: translateY(-50%);
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: ${dark ? "rgba(30, 41, 59, 0.78)" : "rgba(15, 23, 42, 0.72)"};
  pointer-events: none;
  z-index: 2;
}
`;
  }

  // ---- Single-Layer Crisp SVG Starfield (0 extra GPU layers, 0 animation overhead) ----
  function buildStarfieldSvgMarkup() {
    return (
      `<svg class="maomao-effort-stars-svg" data-testid="maomao-starfield" viewBox="0 0 260 26" preserveAspectRatio="xMinYMid slice" aria-hidden="true">` +
      `<path class="maomao-star" d="M16 12 L17.1 14.9 L20 16 L17.1 17.1 L16 20 L14.9 17.1 L12 16 L14.9 14.9 Z" fill="#ffffff" opacity="0.92"/>` +
      `<circle class="maomao-star" cx="29" cy="8" r="1.2" fill="#f5d0fe" opacity="0.82"/>` +
      `<circle class="maomao-star" cx="46" cy="19" r="1.4" fill="#ffffff" opacity="0.78"/>` +
      `<path class="maomao-star" d="M64 5.5 L65.3 8.7 L68.5 10 L65.3 11.3 L64 14.5 L62.7 11.3 L59.5 10 L62.7 8.7 Z" fill="#ffffff" opacity="0.96"/>` +
      `<circle class="maomao-star" cx="82" cy="17.5" r="1.2" fill="#e9d5ff" opacity="0.76"/>` +
      `<path class="maomao-star" d="M101 8.5 L102 11 L104.5 12 L102 13 L101 15.5 L100 13 L97.5 12 L100 11 Z" fill="#ffffff" opacity="0.88"/>` +
      `<circle class="maomao-star" cx="122" cy="7" r="1.3" fill="#ffffff" opacity="0.86"/>` +
      `<path class="maomao-star" d="M140 13 L141.2 16 L144.2 17.2 L141.2 18.4 L140 21.4 L138.8 18.4 L135.8 17.2 L138.8 16 Z" fill="#ffffff" opacity="0.95"/>` +
      `<circle class="maomao-star" cx="158" cy="9.5" r="1.1" fill="#f5d0fe" opacity="0.74"/>` +
      `<path class="maomao-star" d="M177 10.5 L178.1 13.3 L180.9 14.4 L178.1 15.5 L177 18.3 L175.9 15.5 L173.1 14.4 L175.9 13.3 Z" fill="#ffffff" opacity="0.90"/>` +
      `<circle class="maomao-star" cx="195" cy="7.5" r="1.5" fill="#ffffff" opacity="0.88"/>` +
      `<path class="maomao-star" d="M212 14 L213 16.5 L215.5 17.5 L213 18.5 L212 21 L211 18.5 L208.5 17.5 L211 16.5 Z" fill="#ffffff" opacity="0.92"/>` +
      `<circle class="maomao-star" cx="228" cy="10.5" r="1.3" fill="#f5d0fe" opacity="0.84"/>` +
      `<circle class="maomao-star" cx="241" cy="16.5" r="1.4" fill="#ffffff" opacity="0.90"/>` +
      `</svg>`
    );
  }

  // ---- Render Crystal Bar SVG Facets & Lock Icon ----
  function buildCrystalBarDom() {
    const bar = document.createElement("div");
    bar.className = "maomao-crystal-bar";
    bar.setAttribute("data-testid", "maomao-crystal-bar");
    bar.innerHTML =
      `<svg class="maomao-crystal-facets" viewBox="0 0 260 26" preserveAspectRatio="none" aria-hidden="true">` +
      `<defs>` +
      `<linearGradient id="mm-cryst-hi" x1="0" y1="0" x2="1" y2="0.4">` +
      `<stop offset="0%" stop-color="#f8fafc" stop-opacity="0.88"/>` +
      `<stop offset="50%" stop-color="#ffffff" stop-opacity="0.98"/>` +
      `<stop offset="100%" stop-color="#cbd5e1" stop-opacity="0.55"/>` +
      `</linearGradient>` +
      `<linearGradient id="mm-cryst-dark" x1="0" y1="1" x2="1" y2="0">` +
      `<stop offset="0%" stop-color="#0f172a" stop-opacity="0.72"/>` +
      `<stop offset="60%" stop-color="#334155" stop-opacity="0.46"/>` +
      `<stop offset="100%" stop-color="#94a3b8" stop-opacity="0.16"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<polygon points="0,26 24,14 68,26" fill="url(#mm-cryst-dark)"/>` +
      `<polygon points="0,0 44,0 24,14 0,18" fill="url(#mm-cryst-hi)" opacity="0.82"/>` +
      `<polygon points="44,0 108,0 74,16 24,14" fill="#e2e8f0" opacity="0.78"/>` +
      `<polygon points="24,14 74,16 122,26 68,26" fill="url(#mm-cryst-dark)" opacity="0.86"/>` +
      `<polygon points="108,0 186,0 148,14 74,16" fill="url(#mm-cryst-hi)"/>` +
      `<polygon points="74,16 148,14 198,26 122,26" fill="#475569" opacity="0.58"/>` +
      `<polygon points="186,0 260,0 236,15 148,14" fill="#ffffff" opacity="0.92"/>` +
      `<polygon points="148,14 236,15 260,26 198,26" fill="#1e293b" opacity="0.64"/>` +
      `<polyline points="0,18 24,14 74,16 148,14 236,15 260,10" fill="none" stroke="rgba(255,255,255,0.88)" stroke-width="0.9"/>` +
      `<polyline points="44,0 24,14 68,26" fill="none" stroke="rgba(255,255,255,0.65)" stroke-width="0.7"/>` +
      `<polyline points="108,0 74,16 122,26" fill="none" stroke="rgba(255,255,255,0.62)" stroke-width="0.7"/>` +
      `<polyline points="186,0 148,14 198,26" fill="none" stroke="rgba(255,255,255,0.72)" stroke-width="0.7"/>` +
      `</svg>` +
      `<div class="maomao-crystal-sheen"></div>` +
      `<span class="maomao-crystal-lock" aria-hidden="true">` +
      `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">` +
      `<rect x="5" y="11" width="14" height="10" rx="2.5"/>` +
      `<path d="M8 11V7a4 4 0 0 1 8 0v4"/>` +
      `</svg></span>`;

    bar.addEventListener("pointermove", (e) => {
      const rect = bar.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const mx = Math.max(0, Math.min(100, (((e.clientX || 0) - rect.left) / rect.width) * 100));
      const my = Math.max(0, Math.min(100, (((e.clientY || 0) - rect.top) / rect.height) * 100));
      bar.style.setProperty("--mx", mx.toFixed(1) + "%");
      bar.style.setProperty("--my", my.toFixed(1) + "%");
    });
    return bar;
  }

  // ---- Build Starlight Capsule Slider DOM ----
  function buildStarlightTrackDom(card, getProfile, onSelectIndex) {
    const trackWrap = document.createElement("div");
    trackWrap.className = "maomao-effort-track-wrap";
    trackWrap.setAttribute("role", "slider");
    trackWrap.setAttribute("tabindex", "-1");
    trackWrap.setAttribute("aria-label", "推理等级");

    const track = document.createElement("div");
    track.className = "maomao-effort-track";

    const fill = document.createElement("div");
    fill.className = "maomao-effort-fill";
    fill.innerHTML = `<div class="maomao-effort-nebula-sheen"></div>${buildStarfieldSvgMarkup()}`;

    const stops = document.createElement("div");
    stops.className = "maomao-effort-stops";

    const thumb = document.createElement("div");
    thumb.className = "maomao-effort-thumb";

    track.appendChild(fill);
    track.appendChild(stops);
    trackWrap.appendChild(track);
    trackWrap.appendChild(thumb);

    let dragging = false;
    let activeIdx = 0;
    let lastStopCount = -1;
    let stopEls = [];

    function renderVisual(idx, previewPct) {
      const prof = getProfile();
      if (!prof || prof.levels.length < 1) return;
      const count = prof.levels.length;
      const safeIdx = Math.max(0, Math.min(count - 1, idx));
      activeIdx = safeIdx;
      const snappedPct = count > 1 ? safeIdx / (count - 1) : 1;
      const pct = previewPct != null ? Math.max(0, Math.min(1, previewPct)) : snappedPct;
      const tier = prof.levels[safeIdx];
      const isMax = count > 1 && safeIdx === count - 1 && tier?.key !== "off";
      const starNeko = cfg.themeStyle !== "official";

      card.setAttribute("data-tier-max", isMax ? "1" : "0");
      card.setAttribute("data-effort-key", tier?.key || "");
      trackWrap.setAttribute("aria-valuemin", "0");
      trackWrap.setAttribute("aria-valuemax", String(Math.max(0, count - 1)));
      trackWrap.setAttribute("aria-valuenow", String(safeIdx));
      trackWrap.setAttribute("aria-valuetext", tier?.label || "");

      const grad = tierFillGradientFor(tier?.key, pct, starNeko);
      const glow =
        !starNeko
          ? "rgba(16, 185, 129, 0.56)"
          : isMax
            ? "rgba(217, 70, 239, 0.72)"
            : tier?.key === "high"
              ? "rgba(192, 132, 252, 0.64)"
              : "rgba(139, 92, 246, 0.48)";
      fill.style.setProperty("--maomao-effort-grad", grad);
      fill.style.setProperty("--maomao-effort-glow", glow);
      thumb.style.setProperty("--maomao-effort-glow", glow);

      fill.style.width = `calc(26px + (100% - 26px) * ${pct.toFixed(4)})`;
      thumb.style.left = `calc(13px + (100% - 26px) * ${pct.toFixed(4)})`;

      if (lastStopCount !== count) {
        lastStopCount = count;
        stops.innerHTML = "";
        stopEls = [];
        for (let i = 0; i < count; i++) {
          const dot = document.createElement("span");
          dot.className = "maomao-effort-stop";
          dot.style.left = (count > 1 ? (i / (count - 1)) * 100 : 50).toFixed(2) + "%";
          stops.appendChild(dot);
          stopEls.push(dot);
        }
      }
      for (let i = 0; i < stopEls.length; i++) {
        stopEls[i].setAttribute("data-passed", i <= safeIdx ? "1" : "0");
      }
    }

    function clientXToPct(clientX) {
      const rect = trackWrap.getBoundingClientRect?.();
      if (!rect || rect.width <= 0) return 0;
      const usable = Math.max(1, rect.width - 26);
      return Math.max(0, Math.min(1, ((clientX || 0) - (rect.left + 13)) / usable));
    }

    function onPointerDown(e) {
      e?.stopPropagation?.();
      e?.preventDefault?.();
      const prof = getProfile();
      if (!prof || prof.locked || prof.levels.length <= 1) return;
      dragging = true;
      card.setAttribute("data-dragging", "1");
      try {
        trackWrap.setPointerCapture?.(e.pointerId);
      } catch {}
      const pct = clientXToPct(e.clientX);
      const prevIdx = activeIdx;
      const nextIdx = detentTargetIndex(prevIdx, pct, prof.levels.length);
      renderVisual(nextIdx, pct);
      if (nextIdx !== prevIdx) {
        onSelectIndex(nextIdx);
      }
    }

    function onPointerMove(e) {
      if (!dragging) return;
      e?.stopPropagation?.();
      const prof = getProfile();
      if (!prof || prof.locked || prof.levels.length <= 1) return;
      const pct = clientXToPct(e.clientX);
      const prevIdx = activeIdx;
      const nextIdx = detentTargetIndex(prevIdx, pct, prof.levels.length);
      renderVisual(nextIdx, pct);
      if (nextIdx !== prevIdx) {
        onSelectIndex(nextIdx);
      }
    }

    function finishDrag(e) {
      if (!dragging) return;
      e?.stopPropagation?.();
      dragging = false;
      card.setAttribute("data-dragging", "0");
      const prof = getProfile();
      if (!prof || prof.locked || prof.levels.length <= 1) return;
      if (typeof e?.clientX === "number") {
        const pct = clientXToPct(e.clientX);
        const prevIdx = activeIdx;
        const nextIdx = detentTargetIndex(prevIdx, pct, prof.levels.length);
        renderVisual(nextIdx, null);
        if (nextIdx !== prevIdx) onSelectIndex(nextIdx);
      } else {
        renderVisual(activeIdx, null);
      }
    }

    function onKeyDown(e) {
      const prof = getProfile();
      if (!prof || prof.locked || prof.levels.length <= 1) return;
      let next = activeIdx;
      if (e?.key === "ArrowRight" || e?.key === "ArrowUp") next = Math.min(prof.levels.length - 1, activeIdx + 1);
      else if (e?.key === "ArrowLeft" || e?.key === "ArrowDown") next = Math.max(0, activeIdx - 1);
      else if (e?.key === "Home") next = 0;
      else if (e?.key === "End") next = prof.levels.length - 1;
      else return;
      e.preventDefault?.();
      e.stopPropagation?.();
      if (next !== activeIdx) {
        renderVisual(next, null);
        onSelectIndex(next);
      }
    }

    trackWrap.addEventListener("pointerdown", onPointerDown);
    trackWrap.addEventListener("pointermove", onPointerMove);
    trackWrap.addEventListener("pointerup", finishDrag);
    trackWrap.addEventListener("pointercancel", finishDrag);
    trackWrap.addEventListener("keydown", onKeyDown);

    const winMove = (e) => { if (dragging) onPointerMove(e); };
    const winUp = (e) => { if (dragging) finishDrag(e); };
    window.addEventListener?.("pointermove", winMove);
    window.addEventListener?.("pointerup", winUp);

    return {
      el: trackWrap,
      renderVisual,
      isDragging: () => dragging,
      cleanup() {
        window.removeEventListener?.("pointermove", winMove);
        window.removeEventListener?.("pointerup", winUp);
      },
    };
  }

  // ---- Guard: Skip Settings-owned model pickers (only enhance composer conversation model panel!) ----
  function isComposerModelPanel(panel, ctx) {
    if (!panel) return false;
    if (ctx) {
      // Real Antigravity composer panel always sits under ConversationModelSelector (`conversationId` in Fiber props)
      if (ctx.hasConversationSelector) return true;
      // Fallback if composer trigger is explicitly open (never match a closed background composer trigger while in Settings!)
      return Boolean(
        document.querySelector?.(
          '.agy-composer-footer [data-testid="model-selector-trigger"][data-popup-open], .agy-composer-footer [data-testid="model-selector-trigger"][aria-expanded="true"]'
        )
      );
    }
    // Pure DOM fallback (no Fiber): mount only when composer trigger exists
    return Boolean(document.querySelector?.('[data-testid="model-selector-trigger"]'));
  }

  // ---- Mount into Real Antigravity `[data-testid="model-selector-panel"]` ----
  function mountOnAntigravityPanel(panel) {
    if (!panel || mountedPopups.has(panel)) return;
    const initialCtx = readFiberContext(panel);
    if (!isComposerModelPanel(panel, initialCtx)) return;
    ensureStyle();

    const section = document.createElement("div");
    section.className = "maomao-effort-section";
    section.setAttribute("data-maomao-effort-section", "1");
    section.setAttribute("tabindex", "-1");

    const stopProp = (ev) => {
      ev?.stopPropagation?.();
    };
    section.addEventListener("pointerdown", stopProp);
    section.addEventListener("mousedown", stopProp);
    section.addEventListener("pointerup", stopProp);
    section.addEventListener("mouseup", stopProp);
    section.addEventListener("click", stopProp);

    const sep = document.createElement("div");
    sep.className = "maomao-effort-sep";
    sep.setAttribute("role", "separator");

    const card = document.createElement("div");
    card.className = "maomao-effort-card";
    card.setAttribute("data-surface", detectSurfaceMode());

    const head = document.createElement("div");
    head.className = "maomao-effort-head";

    const titleWrap = document.createElement("span");
    titleWrap.className = "maomao-effort-title-wrap";
    const titleEl = document.createElement("span");
    titleEl.className = "maomao-effort-title";
    titleEl.textContent = "推理等级";
    const subEl = document.createElement("span");
    subEl.className = "maomao-effort-sub";
    titleWrap.appendChild(titleEl);
    titleWrap.appendChild(subEl);

    const valueEl = document.createElement("span");
    valueEl.className = "maomao-effort-value";
    valueEl.setAttribute("data-testid", "maomao-effort-value");

    head.appendChild(titleWrap);
    head.appendChild(valueEl);

    const slot = document.createElement("div");
    slot.className = "maomao-effort-slot";

    card.appendChild(head);
    card.appendChild(slot);
    section.appendChild(sep);
    section.appendChild(card);

    let cachedCtx = initialCtx;
    let overrideTarget = null;
    let currentProfile = null;
    let starlightCtrl = null;
    let crystalBarEl = null;
    let renderedMode = "";

    function applyProfileUi(profile) {
      if (!profile) return;
      currentProfile = profile;
      const surface = detectSurfaceMode();
      const dark = detectHostDark();
      card.setAttribute("data-surface", surface);
      card.setAttribute("data-maomao-effort", profile.mode);
      card.setAttribute("data-locked", profile.locked ? "1" : "0");

      subEl.textContent = profile.subtitle || "";
      subEl.style.display = profile.subtitle ? "" : "none";
      valueEl.textContent = profile.currentLabel;
      valueEl.style.color =
        profile.mode === "crystal" ? (dark ? "#f8fafc" : "#1e1b4b") : tierColorFor(profile.currentKey, dark);

      if (profile.mode === "crystal") {
        card.setAttribute("data-tier-max", "0");
        if (renderedMode !== "crystal") {
          if (starlightCtrl) {
            starlightCtrl.cleanup();
            starlightCtrl = null;
          }
          slot.innerHTML = "";
          crystalBarEl = buildCrystalBarDom();
          slot.appendChild(crystalBarEl);
          renderedMode = "crystal";
        }
      } else {
        if (renderedMode !== "starlight") {
          slot.innerHTML = "";
          crystalBarEl = null;
          starlightCtrl = buildStarlightTrackDom(card, () => currentProfile, commitIndex);
          slot.appendChild(starlightCtrl.el);
          renderedMode = "starlight";
        }
        if (!starlightCtrl.isDragging()) {
          starlightCtrl.renderVisual(profile.currentIndex, null);
        }
      }
    }

    function refreshVisualOnly() {
      if (!currentProfile) return;
      const surface = detectSurfaceMode();
      const dark = detectHostDark();
      card.setAttribute("data-surface", surface);
      valueEl.style.color =
        currentProfile.mode === "crystal"
          ? dark
            ? "#f8fafc"
            : "#1e1b4b"
          : tierColorFor(currentProfile.currentKey, dark);
      if (renderedMode === "starlight" && starlightCtrl && !starlightCtrl.isDragging()) {
        starlightCtrl.renderVisual(currentProfile.currentIndex, null);
      }
    }

    function syncFromFiber(useFreshFiber) {
      if (useFreshFiber) cachedCtx = readFiberContext(panel) || cachedCtx;
      const prof = cachedCtx ? resolveProfileFromContext(cachedCtx, overrideTarget, panel) : resolveFallbackPanelProfile(panel);
      applyProfileUi(prof);
      return prof;
    }

    function commitIndex(idx) {
      const ctx = readFiberContext(panel) || cachedCtx;
      cachedCtx = ctx;
      const prof = currentProfile;
      if (!prof || prof.locked || !prof.levels[idx]) return;
      const chosen = prof.levels[idx];
      const nextProf = {
        ...prof,
        currentIndex: idx,
        currentKey: chosen.key,
        currentLabel: chosen.label,
        modelOption: chosen.option,
      };
      overrideTarget = {
        isOrchestrator: false,
        baseName: prof.baseName,
        modelOption: chosen.option,
      };
      if (prof.baseName && chosen.label) {
        writeMemory(prof.baseName, chosen.label);
      }
      if (ctx && chosen.option) {
        commitModelOption(ctx, chosen.option);
      }
      applyProfileUi(nextProf);
      syncRowEffortDisplay(panel, nextProf);
      lastTriggerLabel = getCurrentModelLabel();
    }

    // Verified model-row resolution: ONLY intercept when target option & verified working setter both exist!
    // If anything is missing or commit fails, ALWAYS let the native click pass straight through!
    function findClickableModelRow(target) {
      if (!target || typeof target.closest !== "function") return null;
      if (target.closest("[data-maomao-effort-section]")) return null;
      if (target.closest('button[aria-label="Edit Model"]')) return null;
      if (target.closest('[data-testid="orchestrator-picker-row"]')) return null;

      const orchRow = target.closest('[data-testid="model-selector-orchestrator"]');
      if (orchRow && panel.contains(orchRow)) return { type: "orchestrator", row: orchRow };

      const singleRow = target.closest('[data-testid="model-selector-item"]');
      if (singleRow && panel.contains(singleRow)) {
        return { type: "single", row: singleRow, label: singleRow.getAttribute?.("data-model-label") || "" };
      }

      const menuItem = target.closest('[role="menuitem"]');
      if (!menuItem || !panel.contains(menuItem)) return null;
      const groupSpan = menuItem.querySelector?.('[data-testid="model-selector-effort-group"]');
      if (groupSpan) {
        const base = groupSpan.getAttribute?.("data-model-base") || (groupSpan.textContent || "").trim();
        return base ? { type: "group", row: menuItem, base } : null;
      }
      return null;
    }

    function resolveRowCommitTarget(ctx, hit) {
      if (!ctx || !hit || !hasWorkingSetter(ctx)) return null;
      if (hit.type === "orchestrator") {
        if (!ctx.orchestratorModelOption) return null;
        const prof = resolveProfileFromContext(
          ctx,
          { isOrchestrator: true, baseName: "Orchestrator", modelOption: ctx.orchestratorModelOption },
          panel
        );
        return {
          option: ctx.orchestratorModelOption,
          override: { isOrchestrator: true, baseName: "Orchestrator", modelOption: ctx.orchestratorModelOption },
          profile: prof,
          isGroup: false,
        };
      }
      if (hit.type === "group" && hit.base) {
        const prof = resolveProfileFromContext(ctx, { isOrchestrator: false, baseName: hit.base }, panel);
        if (!prof || !prof.modelOption || !prof.modelOption.label) return null;
        return {
          option: prof.modelOption,
          override: { isOrchestrator: false, baseName: prof.baseName, modelOption: prof.modelOption },
          profile: prof,
          isGroup: true,
        };
      }
      if (hit.type === "single" && hit.label) {
        const opt = (ctx.modelOptions || []).find((o) => o && o.label === hit.label) || null;
        if (!opt || !opt.label) return null;
        const prof = resolveProfileFromContext(ctx, { isOrchestrator: false, baseName: hit.label, modelOption: opt }, panel);
        return {
          option: opt,
          override: { isOrchestrator: false, baseName: hit.label, modelOption: opt },
          profile: prof,
          isGroup: false,
        };
      }
      return null;
    }

    function onPanelUpCapture(ev) {
      if (ev?.target?.closest?.("[data-maomao-effort-section]")) return;
      const hit = findClickableModelRow(ev?.target);
      if (!hit || !resolveRowCommitTarget(cachedCtx, hit)) return;
      // Verified commit target exists: stop Base UI mouseup/pointerup from dismissing panel before click commits
      ev.stopPropagation?.();
      ev.stopImmediatePropagation?.();
    }

    function onPanelClickCapture(ev) {
      if (ev?.target?.closest?.("[data-maomao-effort-section]")) return;
      const hit = findClickableModelRow(ev?.target);
      if (!hit) return;

      const ctx = readFiberContext(panel) || cachedCtx;
      cachedCtx = ctx;
      const target = resolveRowCommitTarget(ctx, hit);
      if (!target) return; // No verified option/setter -> fall through to native click!

      const ok = commitModelOption(ctx, target.option);
      if (!ok) return; // Commit failed -> allow native click to proceed!

      ev.preventDefault?.();
      ev.stopPropagation?.();
      ev.stopImmediatePropagation?.();

      overrideTarget = target.override;
      applyProfileUi(target.profile);
      if (target.isGroup) syncRowEffortDisplay(panel, target.profile);
      lastTriggerLabel = getCurrentModelLabel();
    }

    panel.addEventListener("pointerup", onPanelUpCapture, true);
    panel.addEventListener("mouseup", onPanelUpCapture, true);
    panel.addEventListener("click", onPanelClickCapture, true);
    panel.classList?.add?.("maomao-effort-panel-enhanced");

    // Mount between scrollable model list (firstElementChild) and View Usage separator
    const listWrap = panel.children && panel.children[0] ? panel.children[0] : null;
    if (listWrap && listWrap.nextSibling && typeof panel.insertBefore === "function") {
      panel.insertBefore(section, listWrap.nextSibling);
    } else {
      panel.appendChild(section);
    }

    lastTriggerLabel = getCurrentModelLabel();
    syncFromFiber(false);

    mountedPopups.set(panel, {
      root: section,
      get mode() {
        return currentProfile?.mode || "starlight";
      },
      refreshVisualOnly,
      syncFromTrigger() {
        overrideTarget = null;
        syncFromFiber(true);
      },
      cleanup() {
        try {
          panel.removeEventListener("pointerup", onPanelUpCapture, true);
          panel.removeEventListener("mouseup", onPanelUpCapture, true);
          panel.removeEventListener("click", onPanelClickCapture, true);
          panel.classList?.remove?.("maomao-effort-panel-enhanced");
        } catch {}
        if (starlightCtrl) {
          starlightCtrl.cleanup();
          starlightCtrl = null;
        }
        try {
          section.remove();
        } catch {}
      },
    });
  }

  // ---- Fallback: Generic Standalone Effort Menu ----
  function isItemSelected(el) {
    try {
      if (
        el.getAttribute?.("aria-checked") === "true" ||
        el.getAttribute?.("aria-selected") === "true" ||
        el.getAttribute?.("data-state") === "checked" ||
        el.getAttribute?.("data-selected") === "true"
      ) {
        return true;
      }
      if (el.querySelector?.('[data-testid="check-icon"], svg.lucide-check, [aria-checked="true"]')) {
        return true;
      }
    } catch {}
    return false;
  }

  function classifyEffortItem(el) {
    if (!el || el.closest?.("[data-maomao-effort], [data-maomao-effort-section]")) return null;
    const tid = el.getAttribute?.("data-testid");
    if (tid === "model-selector-effort-option" || tid === "orchestrator-picker-effort") return null;
    const raw = String(el.getAttribute?.("data-effort-label") || el.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!raw || raw.length > 32) return null;
    const cleaned = raw.replace(/[✓✔•·]+/g, "").trim();
    for (let i = 0; i < EFFORT_RANK.length; i++) {
      if (EFFORT_RANK[i].re.test(cleaned)) {
        return { el, key: EFFORT_RANK[i].key, rank: i, label: cleaned, selected: isItemSelected(el) };
      }
    }
    return null;
  }

  function mountStandaloneMenu(popup, items) {
    if (!popup || mountedPopups.has(popup)) return;
    ensureStyle();

    const section = document.createElement("div");
    section.className = "maomao-effort-section";
    section.setAttribute("data-maomao-effort-section", "1");

    const card = document.createElement("div");
    card.className = "maomao-effort-card";
    card.setAttribute("data-surface", detectSurfaceMode());

    const head = document.createElement("div");
    head.className = "maomao-effort-head";
    const titleEl = document.createElement("span");
    titleEl.className = "maomao-effort-title";
    titleEl.textContent = "推理等级";
    const valueEl = document.createElement("span");
    valueEl.className = "maomao-effort-value";
    valueEl.setAttribute("data-testid", "maomao-effort-value");
    head.appendChild(titleEl);
    head.appendChild(valueEl);

    const slot = document.createElement("div");
    card.appendChild(head);
    card.appendChild(slot);
    section.appendChild(card);

    if (items.length >= 2) {
      items.sort((a, b) => a.rank - b.rank);
      const hiddenItems = [];
      for (let i = 0; i < items.length; i++) {
        items[i].el.setAttribute("data-maomao-effort-hidden", "1");
        hiddenItems.push(items[i].el);
      }
      let curIdx = Math.max(0, items.findIndex((it) => it.selected));
      const baseModel = extractBaseModelName(getCurrentModelLabel());
      let prof = {
        mode: "starlight",
        locked: false,
        baseName: baseModel,
        levels: items.map((it) => ({ key: it.key, label: it.label, option: it.el })),
        currentIndex: curIdx,
        currentKey: items[curIdx].key,
        currentLabel: items[curIdx].label,
      };
      card.setAttribute("data-maomao-effort", "starlight");
      const ctrl = buildStarlightTrackDom(
        card,
        () => prof,
        (nextIdx) => {
          const item = items[nextIdx];
          if (!item) return;
          curIdx = nextIdx;
          prof = { ...prof, currentIndex: nextIdx, currentKey: item.key, currentLabel: item.label };
          valueEl.textContent = item.label;
          valueEl.style.color = tierColorFor(item.key, detectHostDark());
          if (baseModel) writeMemory(baseModel, item.label);
          try {
            item.el.click?.();
          } catch {}
        }
      );
      slot.appendChild(ctrl.el);
      valueEl.textContent = prof.currentLabel;
      valueEl.style.color = tierColorFor(prof.currentKey, detectHostDark());
      ctrl.renderVisual(curIdx, null);
      popup.insertBefore(section, items[0].el);

      mountedPopups.set(popup, {
        root: section,
        mode: "starlight",
        refreshVisualOnly() {
          card.setAttribute("data-surface", detectSurfaceMode());
          valueEl.style.color = tierColorFor(prof.currentKey, detectHostDark());
        },
        cleanup() {
          ctrl.cleanup();
          for (let i = 0; i < hiddenItems.length; i++) {
            try {
              hiddenItems[i].removeAttribute("data-maomao-effort-hidden");
            } catch {}
          }
          try {
            section.remove();
          } catch {}
        },
      });
      return;
    }

    card.setAttribute("data-maomao-effort", "crystal");
    valueEl.textContent = "Auto";
    valueEl.style.color = detectHostDark() ? "#f8fafc" : "#1e1b4b";
    slot.appendChild(buildCrystalBarDom());
    popup.appendChild(section);
    mountedPopups.set(popup, {
      root: section,
      mode: "crystal",
      refreshVisualOnly() {
        card.setAttribute("data-surface", detectSurfaceMode());
        valueEl.style.color = detectHostDark() ? "#f8fafc" : "#1e1b4b";
      },
      cleanup() {
        try {
          section.remove();
        } catch {}
      },
    });
  }

  // ---- Cleanup & Zero-Hover-Fiber Scanning ----
  function cleanupDetached() {
    for (const [popup, entry] of [...mountedPopups.entries()]) {
      if (!popup.isConnected || !entry.root?.isConnected) {
        entry.cleanup();
        mountedPopups.delete(popup);
      }
    }
  }

  function unmountAll() {
    for (const [, entry] of [...mountedPopups.entries()]) {
      entry.cleanup();
    }
    mountedPopups.clear();
  }

  function scanPopups() {
    if (!active) return;
    cleanupDetached();

    if (!cfg.enabled || cfg.mode === "off") {
      unmountAll();
      return;
    }
    if (cfg.mode === "auto" && hasExternalSlider()) {
      unmountAll();
      return;
    }

    const agPanels = Array.from(document.querySelectorAll?.('[data-testid="model-selector-panel"]') || []);
    const curTrigLabel = getCurrentModelLabel();
    const triggerChanged = Boolean(curTrigLabel && curTrigLabel !== lastTriggerLabel);
    if (triggerChanged) lastTriggerLabel = curTrigLabel;

    for (let i = 0; i < agPanels.length; i++) {
      const panel = agPanels[i];
      if (!mountedPopups.has(panel)) {
        mountOnAntigravityPanel(panel);
      } else if (triggerChanged) {
        // ONLY re-read Fiber when the host model trigger label genuinely changed (ZERO Fiber walks on hover!)
        mountedPopups.get(panel).syncFromTrigger?.();
      }
    }
    if (agPanels.length > 0) return;

    // Secondary fallback: Generic standalone effort menus (never touch Antigravity native submenus)
    const menus = Array.from(document.querySelectorAll?.('[role="menu"], [role="listbox"]') || []);
    for (let i = 0; i < menus.length; i++) {
      const popup = menus[i];
      if (!popup || mountedPopups.has(popup)) continue;
      if (popup.closest?.("[data-maomao-telemetry-popover], #agy-maomao-telemetry-popover-host, #agy-maomao-dashboard-host")) {
        continue;
      }
      if (
        popup.querySelector?.(
          '[data-testid="model-selector-effort-option"], [data-testid="orchestrator-picker-effort"], [data-testid="orchestrator-picker-row"]'
        )
      ) {
        continue;
      }

      const candidates = Array.from(
        popup.querySelectorAll?.('[role="menuitem"], [role="menuitemradio"], [role="option"], button') || []
      );
      const effortItems = [];
      const seenKeys = new Set();
      for (let j = 0; j < candidates.length; j++) {
        const info = classifyEffortItem(candidates[j]);
        if (info && !seenKeys.has(info.key)) {
          seenKeys.add(info.key);
          effortItems.push(info);
        }
      }
      if (effortItems.length >= 2) {
        mountStandaloneMenu(popup, effortItems);
        continue;
      }

      if (cfg.crystalOrchestrator) {
        const popupTxt = String(popup.textContent || "");
        if (AUTO_ORCH_RE.test(curTrigLabel) && AUTO_ORCH_RE.test(popupTxt)) {
          mountStandaloneMenu(popup, []);
        }
      }
    }
  }

  // ---- Zero-Typing & Zero-Hover-Churn MutationObserver ----
  const SKIP_MUTATION_SELECTOR =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, [data-maomao-effort], [data-maomao-effort-section]';

  function shouldIgnoreMutation(rec) {
    const t = rec?.target;
    const el = t && t.nodeType === 3 ? t.parentElement : t;
    if (!el || typeof el.closest !== "function") return false;
    if (el.closest(SKIP_MUTATION_SELECTOR)) return true;
    // If mutation happened INSIDE an already-mounted model panel (e.g., hover highlight), ignore completely!
    const existingPanel = el.closest('[data-testid="model-selector-panel"]');
    if (existingPanel && mountedPopups.has(existingPanel)) return true;
    return false;
  }

  function scheduleScan() {
    if (!active || scanTimer) return;
    scanTimer = setTimeout(() => {
      scanTimer = 0;
      scanPopups();
    }, 45);
  }

  if (typeof MutationObserver === "function") {
    observer = new MutationObserver((records) => {
      if (!active || !Array.isArray(records) || !records.length) return;
      for (let i = 0; i < records.length; i++) {
        if (!shouldIgnoreMutation(records[i])) {
          scheduleScan();
          return;
        }
      }
    });
    try {
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {}

    themeAttrObs = new MutationObserver(() => {
      if (!active || !cfg.enabled || cfg.mode === "off") return;
      ensureStyle();
      for (const [, entry] of mountedPopups.entries()) {
        entry.refreshVisualOnly?.();
      }
    });
    try {
      if (document.documentElement) {
        themeAttrObs.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
      if (document.body) {
        themeAttrObs.observe(document.body, { attributes: true, attributeFilter: ["class", "data-theme"] });
      }
    } catch {}
  }

  addDocListener(
    document,
    "click",
    (e) => {
      if (!active) return;
      const t = e?.target;
      if (t && typeof t.closest === "function" && t.closest(SKIP_MUTATION_SELECTOR)) return;
      if (t && typeof t.closest === "function" && t.closest('[data-testid="model-selector-trigger"]')) {
        scheduleScan();
      }
    },
    true
  );

  function update(nextConfig) {
    cfg = normalizeConfig(nextConfig);
    if (!cfg.enabled || cfg.mode === "off") {
      unmountAll();
      return status();
    }
    ensureStyle();
    for (const [, entry] of mountedPopups.entries()) entry.refreshVisualOnly?.();
    scanPopups();
    return status();
  }

  function destroy() {
    active = false;
    if (scanTimer) {
      clearTimeout(scanTimer);
      scanTimer = 0;
    }
    if (observer) {
      try {
        observer.disconnect();
      } catch {}
      observer = null;
    }
    if (themeAttrObs) {
      try {
        themeAttrObs.disconnect();
      } catch {}
      themeAttrObs = null;
    }
    for (let i = 0; i < docListeners.length; i++) {
      const [target, type, fn, opts] = docListeners[i];
      try {
        target.removeEventListener(type, fn, opts);
      } catch {}
    }
    docListeners.length = 0;
    unmountAll();
    const style = document.getElementById?.(STYLE_ID);
    if (style) style.remove();
    lastCssKey = "";
    lastTriggerLabel = "";
    cachedEditableEl = null;
    delete window[KEY];
    return { removed: true };
  }

  function status() {
    return {
      applied: active,
      rev: REV,
      owner: cfg.owner,
      enabled: cfg.enabled,
      mode: cfg.mode,
      surfaceMode: detectSurfaceMode(),
      yielded: cfg.mode === "auto" && hasExternalSlider(),
      mountedCount: mountedPopups.size,
      modes: [...mountedPopups.values()].map((m) => m.mode),
    };
  }

  if (cfg.enabled && cfg.mode !== "off") {
    ensureStyle();
    scanPopups();
  }

  const handle = {
    rev: REV,
    owner: cfg.owner,
    lastSeen: Date.now(),
    touch() {
      handle.lastSeen = Date.now();
      return true;
    },
    update,
    destroy,
    status,
    rescan: scanPopups,
    getMemory: readMemory,
  };
  window[KEY] = handle;
  return status();
}

module.exports = {
  EFFORT_SLIDER_REV: 5,
  installEffortSlider,
};
