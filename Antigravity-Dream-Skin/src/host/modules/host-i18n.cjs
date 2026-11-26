"use strict";

/**
 * Antigravity Dream Skin — Pure MIT Host & Swarm Runtime i18n Engine
 *
 * Exports self-contained CDP-injectable functions (`fn.toString()`):
 * - installHostI18n(config)  -> mounts `window.__agyMaomaoHostI18n`
 * - installSwarmI18n(config) -> mounts `window.__agyMaomaoSwarmI18n`
 *
 * Guarantees:
 * - Zero translation of model names or thinking/reasoning effort labels.
 * - WeakMap-backed original text/attribute storage for 100% lossless destroy().
 * - Auto-yield when third-party Chinese i18n extensions are present (mode: "auto").
 * - Per-node ping-pong breaker to prevent infinite fight loops with React re-renders.
 * - Streaming-aware throttled MutationObserver batching.
 */

const {
  HOST_EXACT_MAP,
  HOST_PATTERN_RULES,
  SWARM_EXACT_MAP,
  SWARM_PATTERN_RULES,
  PROTECTED_MODEL_OR_EFFORT_RE,
  isProtectedModelOrEffortText,
} = require("./i18n-dict.cjs");

const HOST_I18N_KEY = "__agyMaomaoHostI18n";
const SWARM_I18N_KEY = "__agyMaomaoSwarmI18n";
const HOST_I18N_REV = 3;
const SWARM_I18N_REV = 2;

function serializeRules(rules) {
  return rules.map((r) => [r.regex.source, r.regex.flags || "", r.replacement]);
}

function buildInstaller({
  fnName,
  globalKey,
  rev,
  exactMap,
  patternRules,
  textExcludeSelector,
  attrExcludeSelector,
  thirdPartyCheckExpr,
  isSwarm,
}) {
  const exactJson = JSON.stringify(exactMap);
  const rulesJson = JSON.stringify(serializeRules(patternRules));
  const protSrcJson = JSON.stringify(PROTECTED_MODEL_OR_EFFORT_RE.source);
  const protFlagsJson = JSON.stringify(PROTECTED_MODEL_OR_EFFORT_RE.flags || "i");
  const keyJson = JSON.stringify(globalKey);
  const textExclJson = JSON.stringify(textExcludeSelector);
  const attrExclJson = JSON.stringify(attrExcludeSelector);
  const isSwarmLiteral = isSwarm ? "true" : "false";

  const source = `return function ${fnName}(config) {
  const cfg0 = config && typeof config === "object" ? config : {};
  const KEY = ${keyJson};
  const REV = ${rev};
  const IS_SWARM = ${isSwarmLiteral};
  const PROTECTED_RE = new RegExp(${protSrcJson}, ${protFlagsJson});
  const EXACT_MAP = ${exactJson};
  const RAW_RULES = ${rulesJson};
  const PATTERN_RULES = RAW_RULES.map(function (item) {
    return { regex: new RegExp(item[0], item[1]), replacement: item[2] };
  });
  const TEXT_EXCLUDED = ${textExclJson};
  const ATTR_EXCLUDED = ${attrExclJson};
  const ATTRS = ["placeholder", "title", "aria-label"];

  function isProtectedModelOrEffortText(text) {
    if (typeof text !== "string") return false;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 96) return false;
    return PROTECTED_RE.test(trimmed);
  }

  function normalizeMode(rawCfg) {
    const src = rawCfg && typeof rawCfg === "object" ? rawCfg : {};
    const nested = src.i18n && typeof src.i18n === "object" ? src.i18n : {};
    if (IS_SWARM && (src.swarmEnabled === false || nested.swarmEnabled === false)) {
      return "off";
    }
    const m = src.mode !== undefined ? src.mode : nested.mode;
    if (m === "on" || m === "off" || m === "auto") return m;
    if (src.enabled === false) return "off";
    return "auto";
  }

  // Reuse / upgrade existing handle idempotently
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

  if (typeof document === "undefined" || !document) {
    return { applied: false, active: false, reason: "no-document" };
  }
  if (IS_SWARM && document.readyState === "loading") {
    return { applied: false, active: false, loading: true, reason: "loading" };
  }

  let currentConfig = cfg0;
  let mode = normalizeMode(cfg0);
  let destroyed = false;
  let active = false;
  let yielded = false;
  let translatedTextCount = 0;
  let translatedAttrCount = 0;
  let trippedNodeCount = 0;
  let breakerEpoch = 1;
  let reloadedAt = 0;
  let rescanCount = 0;

  // WeakMap primary storage for lossless restore & per-node ping-pong breaker
  const textOriginals = new WeakMap();
  const attrOriginals = new WeakMap();
  const rewriteHistory = new WeakMap();

  // Lightweight live registries for lossless restore & periodic disconnected pruning
  const trackedTexts = new Set();
  const trackedAttrEls = new Set();

  // Optional custom extra dictionary passed via config (strictly red-line filtered)
  const BASE_DICT_SIZE = Object.keys(EXACT_MAP).length;
  let extraExact = {};
  function extractDictMap(c) {
    if (!c || typeof c !== "object") return null;
    const candidate = c.dict !== undefined ? c.dict : c.extraDict;
    if (!candidate || typeof candidate !== "object") return null;
    if (candidate.exact && typeof candidate.exact === "object") return candidate.exact;
    return candidate;
  }
  function syncExtraDict(c, mergeExisting) {
    const custom = extractDictMap(c);
    if (!custom) {
      if (!mergeExisting) extraExact = {};
      return false;
    }
    const next = mergeExisting ? Object.assign({}, extraExact) : {};
    let changed = !mergeExisting && Object.keys(extraExact).length > 0;
    for (const k of Object.keys(custom)) {
      if (!isProtectedModelOrEffortText(k) && typeof custom[k] === "string") {
        const val = custom[k];
        if (next[k] !== val) changed = true;
        next[k] = val;
      }
    }
    extraExact = next;
    return changed;
  }
  function computeDictSize() {
    let extraNew = 0;
    for (const k of Object.keys(extraExact)) {
      if (!Object.prototype.hasOwnProperty.call(EXACT_MAP, k)) extraNew += 1;
    }
    return BASE_DICT_SIZE + extraNew;
  }
  syncExtraDict(cfg0, false);

  function detectThirdPartyI18n() {
    try {
      return Boolean(${thirdPartyCheckExpr});
    } catch {
      return false;
    }
  }

  function translateString(raw) {
    if (typeof raw !== "string") return null;
    const trimmed = raw.trim();
    if (!trimmed) return null;
    // RED-LINE GUARD: Never translate model names or thinking/reasoning effort labels
    if (isProtectedModelOrEffortText(trimmed)) return null;
    if (Object.prototype.hasOwnProperty.call(extraExact, trimmed)) {
      return extraExact[trimmed];
    }
    if (Object.prototype.hasOwnProperty.call(EXACT_MAP, trimmed)) {
      return EXACT_MAP[trimmed];
    }
    for (let i = 0; i < PATTERN_RULES.length; i++) {
      const rule = PATTERN_RULES[i];
      if (rule.regex.test(trimmed)) {
        const out = trimmed.replace(rule.regex, rule.replacement);
        if (out && out !== trimmed) return out;
      }
    }
    return null;
  }

  function isElementExcluded(el, selector) {
    if (!el || el.nodeType !== 1) return false;
    try {
      if (typeof el.matches === "function" && el.matches(selector)) return true;
      if (typeof el.closest === "function" && el.closest(selector)) return true;
    } catch {}
    return false;
  }

  function isPingPongTripped(node) {
    const rec = rewriteHistory.get(node);
    if (!rec || rec.epoch !== breakerEpoch) return false;
    const now = Date.now();
    if (rec.trippedUntil && now < rec.trippedUntil) return true;
    return false;
  }

  function recordRewriteAndCheckBreaker(node) {
    const now = Date.now();
    let rec = rewriteHistory.get(node);
    if (!rec || rec.epoch !== breakerEpoch || now - rec.windowStart > 1500) {
      rec = { count: 1, windowStart: now, trippedUntil: 0, epoch: breakerEpoch };
      rewriteHistory.set(node, rec);
      return false;
    }
    rec.count += 1;
    if (rec.count > 6) {
      if (!rec.trippedUntil || now >= rec.trippedUntil) {
        trippedNodeCount += 1;
      }
      rec.trippedUntil = now + 60000;
      return true;
    }
    return false;
  }

  function processTextNode(node) {
    if (!active || destroyed || !node || node.nodeType !== 3) return;
    const parent = node.parentElement;
    if (!parent) return;
    if (isElementExcluded(parent, TEXT_EXCLUDED)) return;
    if (isPingPongTripped(node)) return;

    const current = typeof node.nodeValue === "string" ? node.nodeValue : "";
    if (!current || !current.trim()) return;

    const prev = textOriginals.get(node);
    if (prev && current === prev.translated) {
      // Already showing our translated value; no-op
      return;
    }

    // If the host overwrote our translation back to original (or a new string)
    const original = prev && current === prev.original ? prev.original : current;
    const trimmed = original.trim();
    if (isProtectedModelOrEffortText(trimmed)) {
      return;
    }
    const zh = translateString(trimmed);
    if (zh === null) return;

    const leadIdx = original.indexOf(trimmed);
    const translated =
      leadIdx >= 0
        ? original.slice(0, leadIdx) + zh + original.slice(leadIdx + trimmed.length)
        : zh;

    if (translated === current) return;
    if (recordRewriteAndCheckBreaker(node)) {
      // Tripped: restore original cleanly and stop touching this node
      if (prev && node.nodeValue !== prev.original) {
        node.nodeValue = prev.original;
      }
      return;
    }

    textOriginals.set(node, { original, translated });
    trackedTexts.add(node);
    node.nodeValue = translated;
    translatedTextCount = trackedTexts.size;
  }

  function processElementAttrs(el) {
    if (!active || destroyed || !el || el.nodeType !== 1) return;
    if (isElementExcluded(el, ATTR_EXCLUDED)) return;
    if (isPingPongTripped(el)) return;
    if (typeof el.getAttribute !== "function" || typeof el.setAttribute !== "function") return;

    let map = attrOriginals.get(el);
    for (let i = 0; i < ATTRS.length; i++) {
      const attr = ATTRS[i];
      const current = el.getAttribute(attr);
      if (typeof current !== "string" || !current.trim()) continue;
      const prev = map && map[attr];
      if (prev && current === prev.translated) continue;

      const original = prev && current === prev.original ? prev.original : current;
      const trimmed = original.trim();
      if (isProtectedModelOrEffortText(trimmed)) continue;
      const zh = translateString(trimmed);
      if (zh === null || zh === current) continue;

      if (recordRewriteAndCheckBreaker(el)) {
        if (prev) {
          try { el.setAttribute(attr, prev.original); } catch {}
        }
        return;
      }

      if (!map) {
        map = {};
        attrOriginals.set(el, map);
      }
      map[attr] = { original, translated: zh };
      trackedAttrEls.add(el);
      try { el.setAttribute(attr, zh); } catch {}
      translatedAttrCount = trackedAttrEls.size;
    }
  }

  let lastPruneAt = 0;
  function pruneDisconnected(force) {
    const now = Date.now();
    if (!force && now - lastPruneAt < 4000) return;
    lastPruneAt = now;
    for (const node of trackedTexts) {
      if (node.isConnected === false) {
        trackedTexts.delete(node);
      }
    }
    for (const el of trackedAttrEls) {
      if (el.isConnected === false) {
        trackedAttrEls.delete(el);
      }
    }
    translatedTextCount = trackedTexts.size;
    translatedAttrCount = trackedAttrEls.size;
  }

  function walkTextNodes(root, budgetObj) {
    if (!root || destroyed || !active) return;
    if (root.nodeType === 3) {
      processTextNode(root);
      budgetObj.count += 1;
      return;
    }
    if (root.nodeType !== 1 && root.nodeType !== 9) return;
    if (root.nodeType === 1) {
      processElementAttrs(root);
      if (isElementExcluded(root, TEXT_EXCLUDED)) return;
    }

    if (typeof document.createTreeWalker === "function") {
      try {
        const showText = typeof NodeFilter !== "undefined" && NodeFilter.SHOW_TEXT ? NodeFilter.SHOW_TEXT : 4;
        const walker = document.createTreeWalker(root, showText);
        let node;
        while ((node = walker.nextNode())) {
          processTextNode(node);
          budgetObj.count += 1;
          if (budgetObj.count >= budgetObj.limit) break;
        }
      } catch {
        walkFallback(root, budgetObj);
      }
    } else {
      walkFallback(root, budgetObj);
    }

    if (typeof root.querySelectorAll === "function") {
      try {
        const withAttrs = root.querySelectorAll("[placeholder],[title],[aria-label]");
        for (let i = 0; i < withAttrs.length; i++) {
          processElementAttrs(withAttrs[i]);
        }
      } catch {}
    }
  }

  function walkFallback(node, budgetObj) {
    if (!node || budgetObj.count >= budgetObj.limit) return;
    if (node.nodeType === 3) {
      processTextNode(node);
      budgetObj.count += 1;
      return;
    }
    if (node.nodeType === 1) {
      processElementAttrs(node);
      if (isElementExcluded(node, TEXT_EXCLUDED)) return;
    }
    const list = node.childNodes || node.children || [];
    for (let i = 0; i < list.length; i++) {
      walkFallback(list[i], budgetObj);
      if (budgetObj.count >= budgetObj.limit) break;
    }
  }

  function restoreAll() {
    for (const node of trackedTexts) {
      const rec = textOriginals.get(node);
      if (rec && node.isConnected !== false) {
        if (node.nodeValue === rec.translated) {
          node.nodeValue = rec.original;
        }
      }
      textOriginals.delete(node);
    }
    trackedTexts.clear();

    for (const el of trackedAttrEls) {
      const map = attrOriginals.get(el);
      if (map && el.isConnected !== false && typeof el.getAttribute === "function" && typeof el.setAttribute === "function") {
        for (const attr of Object.keys(map)) {
          const rec = map[attr];
          if (rec && el.getAttribute(attr) === rec.translated) {
            try { el.setAttribute(attr, rec.original); } catch {}
          }
        }
      }
      attrOriginals.delete(el);
    }
    trackedAttrEls.clear();
    translatedTextCount = 0;
    translatedAttrCount = 0;
  }

  // Streaming & typing-aware throttled MutationObserver (0.0ms overhead while typing/backspacing)
  const FAST_SKIP_MUTATION_SEL =
    '[data-lexical-editor="true"],[contenteditable="true"],[contenteditable=""],textarea,input,.monaco-editor,.cm-editor,.xterm,[data-testid="agent-response"],[data-markdown-root],.prose,.markdown-body,pre,code,[data-agy-maomao-ui],#agy-maomao-pet-root';
  const TYPING_GRACE_MS = 220;
  const AUTO_RESCAN_DEBOUNCE_MS = 160;
  const pendingNodes = new Set();
  let flushTimer = null;
  let autoRescanTimer = null;
  let observer = null;
  let typingUntil = 0;
  let lastThirdPartyCheckAt = 0;
  let typingKeyHandler = null;
  let typingInputHandler = null;
  let spaNavHandler = null;
  let trackedRootEl = null;
  let skippedMutationCount = 0;
  let flushCount = 0;

  function findAppRoot() {
    try {
      if (typeof document.getElementById === "function") {
        return document.getElementById("root") || document.getElementById("app") || null;
      }
      if (typeof document.querySelector === "function") {
        return document.querySelector("#root, #app") || null;
      }
    } catch {}
    return null;
  }

  function clearAutoRescanTimer() {
    if (autoRescanTimer !== null) {
      clearTimeout(autoRescanTimer);
      autoRescanTimer = null;
    }
  }

  function scheduleAutoRescan() {
    if (destroyed || !active) return;
    clearAutoRescanTimer();
    const now = Date.now();
    const delay = now < typingUntil ? Math.max(AUTO_RESCAN_DEBOUNCE_MS, typingUntil - now + 16) : AUTO_RESCAN_DEBOUNCE_MS;
    autoRescanTimer = setTimeout(function () {
      autoRescanTimer = null;
      if (destroyed || !active) return;
      const curNow = Date.now();
      if (curNow < typingUntil) {
        scheduleAutoRescan();
        return;
      }
      pruneDisconnected(true);
      fullScan();
    }, delay);
  }

  function isEditableElement(el) {
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

  function isFastSkippedNode(node) {
    if (!node) return true;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || el.nodeType !== 1) return true;
    // O(1) fast path: skip mutations inside currently focused editable element
    const activeEl = document.activeElement;
    if (activeEl && isEditableElement(activeEl)) {
      if (el === activeEl || (typeof activeEl.contains === "function" && activeEl.contains(el))) {
        return true;
      }
    }
    if (isEditableElement(el)) return true;
    return isElementExcluded(el, FAST_SKIP_MUTATION_SEL);
  }

  function markTypingIfEditable(ev) {
    if (destroyed || !active || !ev) return;
    const t = ev.target;
    if (!t) return;
    const el = t.nodeType === 1 ? t : t.parentElement;
    if (!el) return;
    if (
      isEditableElement(el) ||
      (typeof el.closest === "function" &&
        Boolean(el.closest('[data-lexical-editor="true"],[contenteditable="true"],[contenteditable=""],textarea,input,.monaco-editor,.cm-editor')))
    ) {
      typingUntil = Date.now() + TYPING_GRACE_MS;
    }
  }

  function isHostStreaming() {
    if (IS_SWARM || typeof document.querySelector !== "function") return false;
    try {
      return Boolean(document.querySelector('[data-testid*="stop"], [data-testid*="cancel-generation"]'));
    } catch {
      return false;
    }
  }

  function clearFlushTimer() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function flushPending(ignoreTypingGrace) {
    flushTimer = null;
    if (destroyed || !active) {
      pendingNodes.clear();
      return;
    }
    if (!ignoreTypingGrace) {
      const now = Date.now();
      if (now < typingUntil) {
        flushTimer = setTimeout(function () { flushPending(false); }, Math.max(24, typingUntil - now + 16));
        return;
      }
    }
    if (pendingNodes.size === 0) return;

    // In auto mode, check third-party i18n presence with low overhead throttle (every 4s)
    const nowTs = Date.now();
    if (mode === "auto" && nowTs - lastThirdPartyCheckAt >= 4000) {
      lastThirdPartyCheckAt = nowTs;
      if (detectThirdPartyI18n()) {
        pendingNodes.clear();
        applyModeState();
        return;
      }
    }
    flushCount += 1;
    const batch = Array.from(pendingNodes);
    pendingNodes.clear();
    const budget = { count: 0, limit: isHostStreaming() ? 220 : 600 };
    for (let i = 0; i < batch.length; i++) {
      const n = batch[i];
      if (!n || n.isConnected === false) continue;
      if (budget.count >= budget.limit) {
        pendingNodes.add(n);
        continue;
      }
      walkTextNodes(n, budget);
    }
    pruneDisconnected(false);
    if (pendingNodes.size > 0 && !destroyed && active) {
      scheduleFlush();
    }
  }

  function scheduleFlush() {
    if (flushTimer !== null || destroyed || !active) return;
    const now = Date.now();
    const baseDelay = isHostStreaming() ? 140 : 48;
    const delay = now < typingUntil ? Math.max(baseDelay, typingUntil - now + 16) : baseDelay;
    flushTimer = setTimeout(function () { flushPending(false); }, delay);
  }

  function startObserver() {
    if (observer || destroyed || typeof MutationObserver !== "function") return;
    const target = document.body || document.documentElement;
    if (!target) return;

    if (!typingKeyHandler && typeof document.addEventListener === "function") {
      typingKeyHandler = markTypingIfEditable;
      typingInputHandler = markTypingIfEditable;
      document.addEventListener("keydown", typingKeyHandler, { capture: true, passive: true });
      document.addEventListener("input", typingInputHandler, { capture: true, passive: true });
    }

    if (!spaNavHandler && typeof window.addEventListener === "function") {
      spaNavHandler = function () {
        if (destroyed || !active) return;
        trackedRootEl = findAppRoot();
        scheduleAutoRescan();
      };
      window.addEventListener("pageshow", spaNavHandler);
      window.addEventListener("hashchange", spaNavHandler);
      window.addEventListener("popstate", spaNavHandler);
    }
    trackedRootEl = findAppRoot();

    observer = new MutationObserver(function (records) {
      if (destroyed || !active) return;
      let rootReplaced = false;
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (rec.type === "characterData" && rec.target) {
          if (isFastSkippedNode(rec.target) || isElementExcluded(rec.target.parentElement, TEXT_EXCLUDED)) {
            skippedMutationCount += 1;
            continue;
          }
          pendingNodes.add(rec.target);
        } else if (rec.type === "attributes" && rec.target) {
          if (isElementExcluded(rec.target, ATTR_EXCLUDED)) {
            skippedMutationCount += 1;
            continue;
          }
          pendingNodes.add(rec.target);
        } else if (rec.type === "childList" && rec.addedNodes && rec.addedNodes.length) {
          // Detect AGY / SPA #root replacement on document.body or documentElement
          if (!rootReplaced && (rec.target === document.body || rec.target === document.documentElement)) {
            const nextRoot = findAppRoot();
            if (nextRoot && nextRoot !== trackedRootEl) {
              trackedRootEl = nextRoot;
              rootReplaced = true;
              breakerEpoch += 1;
              trippedNodeCount = 0;
              scheduleAutoRescan();
              continue;
            }
          }
          if (rec.target && (isFastSkippedNode(rec.target) || (rec.target.nodeType === 1 && isElementExcluded(rec.target, TEXT_EXCLUDED)))) {
            skippedMutationCount += 1;
            continue;
          }
          for (let j = 0; j < rec.addedNodes.length; j++) {
            const added = rec.addedNodes[j];
            if (isFastSkippedNode(added)) {
              skippedMutationCount += 1;
              continue;
            }
            pendingNodes.add(added);
          }
        }
      }
      if (pendingNodes.size > 0) scheduleFlush();
    });
    try {
      observer.observe(target, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ATTRS,
      });
    } catch {
      observer = null;
    }
  }

  function stopObserver() {
    clearFlushTimer();
    clearAutoRescanTimer();
    pendingNodes.clear();
    if (typeof document.removeEventListener === "function") {
      if (typingKeyHandler) {
        document.removeEventListener("keydown", typingKeyHandler, true);
        typingKeyHandler = null;
      }
      if (typingInputHandler) {
        document.removeEventListener("input", typingInputHandler, true);
        typingInputHandler = null;
      }
    }
    if (typeof window.removeEventListener === "function" && spaNavHandler) {
      window.removeEventListener("pageshow", spaNavHandler);
      window.removeEventListener("hashchange", spaNavHandler);
      window.removeEventListener("popstate", spaNavHandler);
      spaNavHandler = null;
    }
    if (observer) {
      try { observer.disconnect(); } catch {}
      observer = null;
    }
  }

  function fullScan() {
    if (destroyed || !active) return;
    const root = document.body || document.documentElement;
    if (!root) return;
    rescanCount += 1;
    walkTextNodes(root, { count: 0, limit: 8000 });
  }

  function applyModeState() {
    if (destroyed) return;
    if (mode === "off") {
      active = false;
      yielded = false;
      stopObserver();
      restoreAll();
      return;
    }
    if (mode === "auto" && detectThirdPartyI18n()) {
      active = false;
      yielded = true;
      stopObserver();
      restoreAll();
      return;
    }
    yielded = false;
    active = true;
    fullScan();
    startObserver();
  }

  const handle = {
    rev: REV,
    owner: cfg0.owner || "",
    lastSeen: Date.now(),
    isProtectedModelOrEffortText: isProtectedModelOrEffortText,
    translateText: translateString,
    touch: function () {
      handle.lastSeen = Date.now();
    },
    status: function () {
      return {
        applied: !destroyed && (active || yielded || mode === "off"),
        active: !destroyed && active,
        yielded: !destroyed && yielded,
        mode: mode,
        rev: REV,
        owner: handle.owner,
        isSwarm: IS_SWARM,
        translatedTexts: translatedTextCount,
        translatedAttrs: translatedAttrCount,
        trippedNodes: trippedNodeCount,
        trippedNodeCount: trippedNodeCount,
        breakerEpoch: breakerEpoch,
        dictSize: computeDictSize(),
        reloadedAt: reloadedAt,
        rescanCount: rescanCount,
        skippedMutations: skippedMutationCount,
        flushCount: flushCount,
      };
    },
    update: function (nextCfg) {
      if (destroyed) return handle.status();
      currentConfig = nextCfg && typeof nextCfg === "object" ? nextCfg : {};
      handle.lastSeen = Date.now();
      if (currentConfig.owner) handle.owner = currentConfig.owner;
      const dictChanged = syncExtraDict(currentConfig, false);
      mode = normalizeMode(currentConfig);
      if (dictChanged) restoreAll();
      applyModeState();
      return handle.status();
    },
    reload: function (nextCfg) {
      if (destroyed) return handle.status();
      handle.lastSeen = Date.now();
      breakerEpoch += 1;
      trippedNodeCount = 0;
      clearFlushTimer();
      clearAutoRescanTimer();
      pendingNodes.clear();
      if (nextCfg && typeof nextCfg === "object") {
        currentConfig = Object.assign({}, currentConfig, nextCfg);
        if (nextCfg.owner) handle.owner = nextCfg.owner;
        if (nextCfg.dict !== undefined || nextCfg.extraDict !== undefined) {
          syncExtraDict(nextCfg, nextCfg.replaceDict !== true);
        }
        if (
          nextCfg.mode !== undefined ||
          nextCfg.swarmEnabled !== undefined ||
          nextCfg.enabled !== undefined ||
          (nextCfg.i18n && typeof nextCfg.i18n === "object")
        ) {
          mode = normalizeMode(currentConfig);
        }
      }
      pruneDisconnected(true);
      restoreAll();
      trackedRootEl = findAppRoot();
      applyModeState();
      reloadedAt = Date.now();
      return handle.status();
    },
    forceRescan: function () {
      if (destroyed) return handle.status();
      handle.lastSeen = Date.now();
      breakerEpoch += 1;
      trippedNodeCount = 0;
      clearFlushTimer();
      clearAutoRescanTimer();
      pendingNodes.clear();
      pruneDisconnected(true);
      if (active) {
        fullScan();
      }
      return handle.status();
    },
    flush: function () {
      if (!destroyed && active) {
        clearFlushTimer();
        flushPending(true);
      }
      return handle.status();
    },
    destroy: function () {
      if (destroyed) return { removed: true };
      destroyed = true;
      active = false;
      yielded = false;
      stopObserver();
      restoreAll();
      if (window[KEY] === handle) {
        delete window[KEY];
      }
      return { removed: true };
    },
  };

  window[KEY] = handle;
  applyModeState();
  return handle.status();
}`;

  // Compile cleanly into a self-contained named function with zero external closures
  // eslint-disable-next-line no-new-func
  return new Function(source)();
}

const HOST_TEXT_EXCLUDED = [
  "pre",
  "code",
  "kbd",
  "samp",
  "script",
  "style",
  "noscript",
  "textarea",
  "svg",
  "math",
  ".monaco-editor",
  ".monaco-diff-editor",
  ".view-lines",
  ".cm-editor",
  ".cm-content",
  ".xterm",
  ".integrated-terminal",
  ".code-block",
  ".shiki",
  ".hljs",
  "[data-markdown-root]",
  '[data-testid="planner-response-text"]',
  '[data-testid="user-input-step"]',
  '[data-testid="user-message-bubble"]',
  "[contenteditable]",
  '[contenteditable="true"]',
  "[data-no-translate]",
  '[data-testid*="diff"]',
  '[data-testid*="code-viewer"]',
  '[data-testid*="file-viewer"]',
  '[data-testid*="file-content"]',
  '[data-testid*="editor-content"]',
  '[data-testid*="terminal"]',
  '[data-testid="model-selector-trigger"]',
  '[data-testid*="model-name"]',
  '[data-testid*="model-label"]',
  '[data-testid*="effort-option"]',
  "[data-agy-effort-slider]",
  "[data-agy-maomao-ui]",
  "[data-agy-maomao-no-i18n]",
].join(",");

const HOST_ATTR_EXCLUDED = [
  "pre",
  "code",
  "kbd",
  "samp",
  "script",
  "style",
  ".monaco-editor",
  ".monaco-diff-editor",
  ".cm-editor",
  ".xterm",
  "[data-markdown-root]",
  '[data-testid="planner-response-text"]',
  '[data-testid="user-input-step"]',
  "[data-no-translate]",
  '[data-testid="model-selector-trigger"]',
  '[data-testid*="model-name"]',
  '[data-testid*="effort-option"]',
  "[data-agy-effort-slider]",
  "[data-agy-maomao-ui]",
  "[data-agy-maomao-no-i18n]",
].join(",");

const SWARM_TEXT_EXCLUDED = [
  ".msg-body",
  ".post-body",
  ".post-md",
  ".raw",
  ".raw-pre",
  "#ov-frame",
  ".swarm-title",
  ".member-name",
  ".agent-name",
  "pre",
  "code",
  "kbd",
  "samp",
  "script",
  "style",
  "textarea",
  "[contenteditable]",
  "[data-no-translate]",
  "[data-markdown-root]",
  "[data-agy-maomao-ui]",
  "[data-agy-maomao-no-i18n]",
].join(",");

const SWARM_ATTR_EXCLUDED = [
  ".msg-body",
  ".post-body",
  ".post-md",
  ".raw",
  ".raw-pre",
  "pre",
  "code",
  "script",
  "style",
  "[data-no-translate]",
  "[data-agy-maomao-ui]",
  "[data-agy-maomao-no-i18n]",
].join(",");

const installHostI18n = buildInstaller({
  fnName: "installHostI18n",
  globalKey: HOST_I18N_KEY,
  rev: HOST_I18N_REV,
  exactMap: HOST_EXACT_MAP,
  patternRules: HOST_PATTERN_RULES,
  textExcludeSelector: HOST_TEXT_EXCLUDED,
  attrExcludeSelector: HOST_ATTR_EXCLUDED,
  thirdPartyCheckExpr:
    "Boolean(window.__AGY_SWARM_I18N__ || window.__agyLocalization || window.__agyI18n || window.__AGY_ZH_CN__ || (typeof document.querySelector === 'function' && document.querySelector('[data-agy-i18n],[data-ag-zh-widget],[data-agy-original-placeholder]')))",
  isSwarm: false,
});

const installSwarmI18n = buildInstaller({
  fnName: "installSwarmI18n",
  globalKey: SWARM_I18N_KEY,
  rev: SWARM_I18N_REV,
  exactMap: SWARM_EXACT_MAP,
  patternRules: SWARM_PATTERN_RULES,
  textExcludeSelector: SWARM_TEXT_EXCLUDED,
  attrExcludeSelector: SWARM_ATTR_EXCLUDED,
  thirdPartyCheckExpr:
    "Boolean(window.__AGY_SWARM_I18N__ || window.__agyLocalization || (typeof document.querySelector === 'function' && document.querySelector('[data-agy-i18n],[data-ag-zh-widget],[data-agy-swarm-i18n]')))",
  isSwarm: true,
});

module.exports = {
  installHostI18n,
  installSwarmI18n,
  HOST_I18N_KEY,
  SWARM_I18N_KEY,
  HOST_I18N_REV,
  SWARM_I18N_REV,
  isProtectedModelOrEffortText,
};
