// MIT License — Clean-room 0fps optical motion effects module for Antigravity Star Suite.
// Serialized into the Antigravity host window via CDP (Function.prototype.toString()).
// MUST remain 100% self-contained inside installMotionFx (no external requires or closures).

const MOTION_FX_REV = 2;
const MOTION_FX_GLOBAL_KEY = "__agyMaomaoMotionFx";

function installMotionFx(rawConfig) {
  const GLOBAL_KEY = "__agyMaomaoMotionFx";
  const FX_REV = 2;
  const STYLE_ID = "agy-maomao-motion-fx-style";
  const AURA_ID = "agy-maomao-semantic-aura";
  const CARET_ID = "agy-maomao-smooth-caret";
  const INK_TIERS = 5;
  const INK_DURATION_MS = 380;
  const INK_MAX_SLICES = 24;
  const INK_MAX_CHUNK_CHARS = 600;
  const AURA_DURATION_MS = 1400;
  const LONG_TASK_MS = 3500;
  const HOST_SIGNAL_DEBOUNCE_MS = 400;
  const RAPID_KEY_MS = 55;
  const TITLE_BADGE_RE = /^\(\d+\)\s+/;
  const EDITOR_IGNORE_SEL =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, .monaco-editor, .cm-editor, .xterm, #agy-maomao-pet-root';
  const COMPOSER_IGNORE_SEL =
    '[data-lexical-editor="true"], [contenteditable="true"], textarea, input, .surface-composer, .monaco-editor, .cm-editor, .xterm, #agy-maomao-pet-root';
  const ASSISTANT_RESP_SEL =
    '[data-testid="agent-response"], [data-markdown-root], .prose, .markdown-body, [role="article"], [data-message-role="assistant"]';

  const win = typeof window !== "undefined" ? window : globalThis;
  const doc = typeof document !== "undefined" ? document : null;
  if (!doc) return { applied: false, reason: "no-document", rev: FX_REV };

  function normalizeConfig(input, prev) {
    const src = input && typeof input === "object" ? input : {};
    const nested = src.motionFx && typeof src.motionFx === "object" ? src.motionFx : {};
    const merged = Object.assign({}, prev || {}, src, nested);
    const masterEnabled = merged.enabled !== false;
    return {
      owner: typeof merged.owner === "string" && merged.owner ? merged.owner : prev?.owner || "maomao-motion-fx",
      enabled: masterEnabled,
      inkStreamFade: masterEnabled && merged.inkStreamFade !== false,
      semanticAura: masterEnabled && merged.semanticAura !== false,
      smoothCaret: masterEnabled && Boolean(merged.smoothCaret),
      unreadBadge: masterEnabled && merged.unreadBadge !== false,
      reducedMotion: Boolean(merged.reducedMotion),
      longTaskMs:
        Number.isFinite(Number(merged.longTaskMs)) && Number(merged.longTaskMs) >= 0
          ? Number(merged.longTaskMs)
          : LONG_TASK_MS,
      signalDebounceMs:
        Number.isFinite(Number(merged.signalDebounceMs)) && Number(merged.signalDebounceMs) >= 0
          ? Number(merged.signalDebounceMs)
          : HOST_SIGNAL_DEBOUNCE_MS,
    };
  }

  const initialCfg = normalizeConfig(rawConfig, null);

  if (win[GLOBAL_KEY]) {
    const existing = win[GLOBAL_KEY];
    if (existing.owner === initialCfg.owner && existing.rev === FX_REV && existing.status?.().applied) {
      existing.touch?.();
      existing.update(rawConfig);
      return existing.status();
    }
    try {
      existing.destroy();
    } catch {}
  }

  let cfg = initialCfg;
  let destroyed = false;
  let windowFocused = typeof doc.hasFocus === "function" ? doc.hasFocus() !== false : true;
  let docHidden = Boolean(doc.hidden);

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

  const rafFn =
    typeof win.requestAnimationFrame === "function"
      ? win.requestAnimationFrame.bind(win)
      : typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn) => setTimeout(() => fn(Date.now()), 16);
  const cafFn =
    typeof win.cancelAnimationFrame === "function"
      ? win.cancelAnimationFrame.bind(win)
      : typeof cancelAnimationFrame === "function"
        ? cancelAnimationFrame
        : (id) => clearTimeout(id);
  const nowFn =
    typeof win.performance?.now === "function"
      ? () => win.performance.now()
      : typeof performance?.now === "function"
        ? () => performance.now()
        : () => Date.now();

  // Remove stale elements from any crashed prior injection
  for (const staleId of [STYLE_ID, AURA_ID, CARET_ID]) {
    try {
      doc.getElementById?.(staleId)?.remove?.();
    } catch {}
  }

  // Inject lightweight zero-backdrop-filter stylesheet
  const styleEl = doc.createElement("style");
  styleEl.id = STYLE_ID;
  styleEl.textContent = `
/* 1. Five-tier Ink Stream Fade via native CSS Custom Highlight API (0 DOM nodes!) */
::highlight(agy-ink-0) { color: color-mix(in srgb, currentColor 18%, transparent); }
::highlight(agy-ink-1) { color: color-mix(in srgb, currentColor 36%, transparent); }
::highlight(agy-ink-2) { color: color-mix(in srgb, currentColor 56%, transparent); }
::highlight(agy-ink-3) { color: color-mix(in srgb, currentColor 76%, transparent); }
::highlight(agy-ink-4) { color: color-mix(in srgb, currentColor 90%, transparent); }

/* 2. Three-state 0fps Semantic Edge Aura (no backdrop-filter, safe with 4K video wallpapers) */
#${AURA_ID} {
  position: fixed;
  inset: 0;
  pointer-events: none;
  z-index: 2147482900;
  opacity: 0;
  contain: strict;
  transition: opacity 260ms ease;
}
#${AURA_ID}[data-aura="approval"] {
  background:
    linear-gradient(180deg, rgba(251, 191, 36, 0.24) 0%, transparent 14%, transparent 86%, rgba(245, 158, 11, 0.2) 100%),
    linear-gradient(90deg, rgba(245, 158, 11, 0.22) 0%, transparent 10%, transparent 90%, rgba(251, 191, 36, 0.22) 100%);
  box-shadow: inset 0 0 28px rgba(245, 158, 11, 0.42), inset 0 0 0 2px rgba(251, 191, 36, 0.55);
}
#${AURA_ID}[data-aura="error"] {
  background:
    linear-gradient(180deg, rgba(244, 63, 94, 0.26) 0%, transparent 14%, transparent 86%, rgba(236, 72, 153, 0.22) 100%),
    linear-gradient(90deg, rgba(244, 63, 94, 0.22) 0%, transparent 10%, transparent 90%, rgba(236, 72, 153, 0.22) 100%);
  box-shadow: inset 0 0 30px rgba(244, 63, 94, 0.44), inset 0 0 0 2px rgba(251, 113, 133, 0.58);
}
#${AURA_ID}[data-aura="complete"] {
  background:
    linear-gradient(180deg, rgba(168, 142, 229, 0.24) 0%, transparent 14%, transparent 86%, rgba(52, 211, 153, 0.24) 100%),
    linear-gradient(90deg, rgba(168, 142, 229, 0.22) 0%, transparent 10%, transparent 90%, rgba(52, 211, 153, 0.24) 100%);
  box-shadow: inset 0 0 28px rgba(132, 188, 214, 0.4), inset 0 0 0 2px rgba(134, 239, 172, 0.52);
}
#${AURA_ID}[data-phase="pulse"] {
  animation: agy-maomao-aura-pulse 1400ms ease-out 1 forwards;
}
#${AURA_ID}[data-phase="settled"] {
  animation: none;
  opacity: 0.34;
}
@keyframes agy-maomao-aura-pulse {
  0% { opacity: 0; }
  24% { opacity: 0.95; }
  58% { opacity: 0.48; }
  80% { opacity: 0.82; }
  100% { opacity: 0; }
}

/* 3. FastDOM Smooth Caret (instant snap during rapid typing / held backspace) */
[data-agy-smooth-caret="1"] {
  caret-color: transparent !important;
}
#${CARET_ID} {
  position: fixed;
  left: 0;
  top: 0;
  width: 2px;
  height: 18px;
  border-radius: 999px;
  pointer-events: none;
  z-index: 2147482950;
  opacity: 0;
  background: linear-gradient(180deg, #c4b5fd, var(--primary, #a88ee5));
  box-shadow: 0 0 8px rgba(168, 142, 229, 0.7);
  will-change: transform, opacity;
  transform: translate3d(-9999px, -9999px, 0);
  transition: transform 65ms cubic-bezier(.22, 1, .36, 1), height 65ms ease, opacity 120ms ease;
}
#${CARET_ID}[data-snap="true"] {
  transition: none !important;
}
#${CARET_ID}[data-visible="true"] {
  opacity: 1;
}
@media (prefers-reduced-motion: reduce) {
  #${AURA_ID}[data-phase="pulse"] { animation: none; opacity: 0.35; }
  #${CARET_ID} { transition: none; }
}
`;
  (doc.head || doc.documentElement).append(styleEl);

  // =========================================================================
  // Effect 1: Five-tier Ink Stream Fade (CSS.highlights, 0 DOM wrappers, 0fps idle)
  // =========================================================================
  const cssRegistry =
    win.CSS && win.CSS.highlights
      ? win.CSS.highlights
      : typeof CSS !== "undefined" && CSS && CSS.highlights
        ? CSS.highlights
        : null;
  const HighlightCtor =
    typeof win.Highlight === "function" ? win.Highlight : typeof Highlight === "function" ? Highlight : null;
  const inkSupported = Boolean(cssRegistry && HighlightCtor && typeof doc.createRange === "function");

  const knownTextLen = new WeakMap();
  const activeInkSlices = [];
  let inkRafId = null;
  let inkHighlightRegistered = false;

  function clearInkHighlights() {
    if (inkRafId !== null) {
      cafFn(inkRafId);
      inkRafId = null;
    }
    activeInkSlices.length = 0;
    if (cssRegistry && inkHighlightRegistered) {
      for (let i = 0; i < INK_TIERS; i++) {
        try {
          cssRegistry.delete("agy-ink-" + i);
        } catch {}
      }
      inkHighlightRegistered = false;
    }
  }

  function isNodeInSelector(node, sel) {
    if (!node) return false;
    const el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || typeof el.closest !== "function") return false;
    return Boolean(el.closest(sel));
  }

  function isEligibleInkTextNode(textNode) {
    if (!textNode || textNode.nodeType !== 3) return false;
    const parent = textNode.parentElement;
    if (!parent) return false;
    if (typeof parent.closest === "function") {
      if (parent.closest(COMPOSER_IGNORE_SEL + ", pre, code")) return false;
      if (!parent.closest(ASSISTANT_RESP_SEL)) return false;
    }
    return true;
  }

  function stepInkFrame(ts) {
    inkRafId = null;
    if (destroyed || !cfg.inkStreamFade || !inkSupported || docHidden || cfg.reducedMotion) {
      clearInkHighlights();
      return;
    }
    const now = typeof ts === "number" ? ts : nowFn();
    const buckets = Array.from({ length: INK_TIERS }, () => []);
    let writeIdx = 0;

    for (let i = 0; i < activeInkSlices.length; i++) {
      const slice = activeInkSlices[i];
      if (!slice.node || slice.node.isConnected === false) continue;
      const len = (slice.node.nodeValue || "").length;
      if (slice.start >= len) continue;
      const clampedEnd = Math.min(slice.end, len);
      const progress = (now - slice.bornAt) / INK_DURATION_MS;
      if (progress >= 1) continue;
      const tier = Math.max(0, Math.min(INK_TIERS - 1, Math.floor(progress * INK_TIERS)));
      try {
        const range = doc.createRange();
        range.setStart(slice.node, slice.start);
        range.setEnd(slice.node, clampedEnd);
        buckets[tier].push(range);
        activeInkSlices[writeIdx++] = slice;
      } catch {}
    }
    activeInkSlices.length = writeIdx;

    if (activeInkSlices.length === 0) {
      clearInkHighlights();
      return;
    }

    for (let t = 0; t < INK_TIERS; t++) {
      const key = "agy-ink-" + t;
      if (buckets[t].length > 0) {
        try {
          cssRegistry.set(key, new HighlightCtor(...buckets[t]));
          inkHighlightRegistered = true;
        } catch {}
      } else {
        try {
          cssRegistry.delete(key);
        } catch {}
      }
    }

    inkRafId = rafFn(stepInkFrame);
  }

  function enqueueInkTextNode(textNode, oldValue) {
    if (!cfg.inkStreamFade || !inkSupported || docHidden || cfg.reducedMotion) return;
    if (!isEligibleInkTextNode(textNode)) return;
    const text = textNode.nodeValue || "";
    const len = text.length;
    const prev = knownTextLen.has(textNode)
      ? knownTextLen.get(textNode)
      : typeof oldValue === "string"
        ? oldValue.length
        : 0;
    knownTextLen.set(textNode, len);
    if (len <= prev) return;
    const delta = len - prev;
    if (delta > INK_MAX_CHUNK_CHARS) return;
    activeInkSlices.push({ node: textNode, start: prev, end: len, bornAt: nowFn() });
    if (activeInkSlices.length > INK_MAX_SLICES) {
      activeInkSlices.splice(0, activeInkSlices.length - INK_MAX_SLICES);
    }
    if (inkRafId === null) {
      inkRafId = rafFn(stepInkFrame);
    }
  }

  function collectTextNodes(node, out, limit) {
    if (!node || out.length >= limit) return;
    if (node.nodeType === 3) {
      out.push(node);
      return;
    }
    const list = node.childNodes || node.children || [];
    for (let i = 0; i < list.length && out.length < limit; i++) {
      collectTextNodes(list[i], out, limit);
    }
  }

  // =========================================================================
  // Effect 2: Three-state 0fps Semantic Edge Aura (approval / error / complete)
  // =========================================================================
  const auraEl = doc.createElement("div");
  auraEl.id = AURA_ID;
  auraEl.setAttribute("aria-hidden", "true");
  (doc.body || doc.documentElement).append(auraEl);

  let auraTimer = null;
  let currentAura = "";
  let currentAuraPhase = "idle";
  const lastAuraByKind = { approval: 0, error: 0, complete: 0 };

  function clearAura() {
    clearTimeout(auraTimer);
    auraTimer = null;
    currentAura = "";
    currentAuraPhase = "idle";
    auraEl.removeAttribute("data-aura");
    auraEl.removeAttribute("data-phase");
  }

  function triggerAura(kind, opts) {
    if (destroyed || !cfg.semanticAura) return false;
    if (kind !== "approval" && kind !== "error" && kind !== "complete") return false;
    const force = Boolean(opts && opts.force);
    const now = Date.now();
    if (!force && now - (lastAuraByKind[kind] || 0) < 2800) return false;
    lastAuraByKind[kind] = now;

    clearTimeout(auraTimer);
    currentAura = kind;
    currentAuraPhase = "pulse";
    auraEl.setAttribute("data-aura", kind);
    auraEl.setAttribute("data-phase", "pulse");

    const settle = Boolean(opts && opts.settle) || kind === "approval";
    auraTimer = setTimeout(() => {
      auraTimer = null;
      if (destroyed || !cfg.semanticAura) {
        clearAura();
        return;
      }
      if (settle && currentAura === kind) {
        currentAuraPhase = "settled";
        auraEl.setAttribute("data-phase", "settled");
      } else {
        clearAura();
      }
    }, cfg.reducedMotion ? 80 : AURA_DURATION_MS + 40);
    return true;
  }

  // =========================================================================
  // Effect 3: FastDOM Smooth Caret (dynamically bound ONLY when enabled!
  // Zero listeners when smoothCaret === false; instant snap on rapid typing/backspace)
  // =========================================================================
  const caretEl = doc.createElement("div");
  caretEl.id = CARET_ID;
  caretEl.setAttribute("aria-hidden", "true");
  (doc.body || doc.documentElement).append(caretEl);

  let caretRafId = null;
  let caretSnapTimer = null;
  let isComposing = false;
  let caretHostEl = null;
  let caretVisible = false;
  let caretSnapping = false;
  let lastKeydownAt = 0;
  let lastCaretRect = null;
  let caretListenersBound = false;
  const caretCleanups = [];

  function isComposerEditable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (typeof el.closest === "function") {
      if (el.closest(".monaco-editor, .cm-editor, .xterm, #agy-maomao-pet-root")) return false;
      if (el.closest('[data-lexical-editor="true"]')) return true;
    }
    if (el.getAttribute?.("data-lexical-editor") === "true") return true;
    if (el.getAttribute?.("contenteditable") === "true") return true;
    if (el.tagName === "TEXTAREA" && (!el.closest || el.closest('.surface-composer, [data-testid="composer"]'))) {
      return true;
    }
    return false;
  }

  function clearCaretSnap() {
    clearTimeout(caretSnapTimer);
    caretSnapTimer = null;
    caretSnapping = false;
    caretEl.removeAttribute("data-snap");
  }

  function enableCaretSnap() {
    caretSnapping = true;
    caretEl.setAttribute("data-snap", "true");
    clearTimeout(caretSnapTimer);
    caretSnapTimer = setTimeout(() => {
      caretSnapTimer = null;
      caretSnapping = false;
      caretEl.removeAttribute("data-snap");
    }, 120);
  }

  function hideSmoothCaret() {
    if (caretRafId !== null) {
      cafFn(caretRafId);
      caretRafId = null;
    }
    clearCaretSnap();
    if (caretHostEl) {
      try {
        caretHostEl.removeAttribute?.("data-agy-smooth-caret");
      } catch {}
      caretHostEl = null;
    }
    caretVisible = false;
    caretEl.setAttribute("data-visible", "false");
  }

  // Strictly separated FastDOM measure -> mutate inside one rAF tick
  function runSmoothCaretTick() {
    caretRafId = null;
    if (destroyed || !cfg.smoothCaret || isComposing || docHidden || !windowFocused) {
      hideSmoothCaret();
      return;
    }

    // ---- PHASE 1: READ ONLY (no DOM mutations allowed here!) ----
    const active = doc.activeElement;
    if (!isComposerEditable(active)) {
      hideSmoothCaret();
      return;
    }

    let measured = null;
    try {
      const sel = typeof win.getSelection === "function" ? win.getSelection() : doc.getSelection?.();
      if (sel && sel.rangeCount > 0 && sel.isCollapsed) {
        const range = sel.getRangeAt(0);
        const rects = typeof range.getClientRects === "function" ? range.getClientRects() : null;
        const rect = rects && rects.length > 0 ? rects[0] : range.getBoundingClientRect?.();
        if (rect && (rect.height > 0 || rect.left > 0 || rect.top > 0)) {
          measured = {
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            h: Math.max(14, Math.min(36, Math.round(rect.height || 18))),
          };
        }
      }
      if (!measured && typeof active.getBoundingClientRect === "function") {
        const box = active.getBoundingClientRect();
        if (box && box.height > 0) {
          measured = {
            x: Math.round(box.left + 8),
            y: Math.round(box.top + Math.max(4, (box.height - 18) / 2)),
            h: 18,
          };
        }
      }
    } catch {}

    // ---- PHASE 2: WRITE ONLY (zero layout reads below!) ----
    if (!measured) {
      hideSmoothCaret();
      return;
    }

    if (caretHostEl && caretHostEl !== active) {
      try {
        caretHostEl.removeAttribute?.("data-agy-smooth-caret");
      } catch {}
    }
    caretHostEl = active;
    try {
      active.setAttribute?.("data-agy-smooth-caret", "1");
    } catch {}
    lastCaretRect = measured;
    caretVisible = true;
    caretEl.style.height = measured.h + "px";
    caretEl.style.transform = "translate3d(" + measured.x + "px, " + measured.y + "px, 0)";
    caretEl.setAttribute("data-visible", "true");
  }

  function scheduleSmoothCaret() {
    if (destroyed || !cfg.smoothCaret || isComposing || docHidden || !windowFocused) return;
    if (caretRafId !== null) return;
    caretRafId = rafFn(runSmoothCaretTick);
  }

  function detachSmoothCaretListeners() {
    if (!caretListenersBound) return;
    caretListenersBound = false;
    for (const off of caretCleanups) {
      try {
        off();
      } catch {}
    }
    caretCleanups.length = 0;
  }

  function attachSmoothCaretListeners() {
    if (caretListenersBound || destroyed) return;
    caretListenersBound = true;
    const bind = (event, handler, options) => {
      if (typeof doc.addEventListener !== "function") return;
      doc.addEventListener(event, handler, options);
      caretCleanups.push(() => {
        try {
          doc.removeEventListener?.(event, handler, options);
        } catch {}
      });
    };

    bind("compositionstart", () => {
      isComposing = true;
      hideSmoothCaret();
    });
    bind("compositionend", () => {
      isComposing = false;
      scheduleSmoothCaret();
    });
    bind("keydown", (e) => {
      const now = Date.now();
      const key = e && e.key;
      const isDeleteKey = key === "Backspace" || key === "Delete";
      if (isDeleteKey || (e && e.repeat) || now - lastKeydownAt < RAPID_KEY_MS) {
        enableCaretSnap();
      }
      lastKeydownAt = now;
    }, true);
    bind("selectionchange", scheduleSmoothCaret);
    bind("input", scheduleSmoothCaret, true);
    bind("mouseup", scheduleSmoothCaret, true);
    bind("focusin", scheduleSmoothCaret, true);
    bind("focusout", () => {
      if (!cfg.smoothCaret) return;
      scheduleSmoothCaret();
    }, true);
  }

  function syncSmoothCaretBinding() {
    if (cfg.smoothCaret && !destroyed) {
      attachSmoothCaretListeners();
    } else {
      detachSmoothCaretListeners();
      hideSmoothCaret();
    }
  }

  // =========================================================================
  // Effect 4: Window Title Unread Badge (`(N) ` while unfocused -> reset on focus)
  // =========================================================================
  let unreadCount = 0;

  function stripTitleBadge(title) {
    return String(title || "").replace(TITLE_BADGE_RE, "");
  }

  function applyUnreadTitle() {
    if (typeof doc.title !== "string") return;
    const base = stripTitleBadge(doc.title);
    if (cfg.unreadBadge && unreadCount > 0) {
      doc.title = "(" + unreadCount + ") " + base;
    } else if (TITLE_BADGE_RE.test(doc.title)) {
      doc.title = base;
    }
  }

  function clearUnreadBadge() {
    unreadCount = 0;
    applyUnreadTitle();
  }

  function recordBackgroundCompletion() {
    if (!cfg.unreadBadge) return;
    if (windowFocused && !docHidden) return;
    unreadCount += 1;
    applyUnreadTitle();
  }

  // =========================================================================
  // Shared Host State Observer (zero-lag editor fast-filter + 400ms debounce)
  // =========================================================================
  let agentRunning = false;
  let runStartedAt = 0;
  let approvalActive = false;
  let errorActive = false;
  let lastEditorMutationAt = 0;
  let stateDebounceTimer = null;
  let mutObserver = null;
  let mutObserverCharacterData = false;
  let inspectCalls = 0;

  function isElementVisible(el) {
    if (!el || el.disabled) return false;
    if (el.getAttribute?.("aria-hidden") === "true") return false;
    if (el.getAttribute?.("hidden") !== null && el.getAttribute?.("hidden") !== undefined) return false;
    if (el.style && (el.style.display === "none" || el.style.visibility === "hidden")) return false;
    return true;
  }

  function hasVisibleMatchIn(scope, selector) {
    if (!scope) return false;
    try {
      const first = scope.querySelector?.(selector);
      if (!first) return false;
      if (isElementVisible(first)) return true;
      const list = scope.querySelectorAll?.(selector);
      if (!list || list.length <= 1) return false;
      for (const el of list) {
        if (isElementVisible(el)) return true;
      }
    } catch {}
    return false;
  }

  function inspectHostSignals() {
    if (destroyed) return;
    const needRunCheck = cfg.semanticAura || cfg.unreadBadge;
    if (!needRunCheck) return;
    inspectCalls += 1;

    // Prefer fast composer-footer scoped single-hit lookup for stop/cancel
    const footer = doc.querySelector?.('.agy-composer-footer, [data-testid="input-box-bottom-toolbar"]');
    const running =
      (footer ? hasVisibleMatchIn(footer, '[data-testid*="stop"], [data-testid*="cancel"]') : false) ||
      hasVisibleMatchIn(doc, '[data-testid*="stop"], [data-testid*="cancel"]');

    if (running && !agentRunning) {
      agentRunning = true;
      runStartedAt = Date.now();
    } else if (!running && agentRunning) {
      const elapsed = Date.now() - runStartedAt;
      agentRunning = false;
      const wasAway = !windowFocused || docHidden;
      if (wasAway) {
        recordBackgroundCompletion();
      }
      if (cfg.semanticAura && (elapsed >= cfg.longTaskMs || wasAway)) {
        triggerAura("complete");
      }
    }

    if (!cfg.semanticAura) return;

    const approval = hasVisibleMatchIn(
      doc,
      '[data-testid*="approve"], [data-testid*="permission-action"], [data-testid*="confirm-command"]'
    );
    const hasErr = hasVisibleMatchIn(doc, '[role="alert"], [data-testid*="error-banner"], [data-testid*="retry-turn"]');

    if (approval && !approvalActive) {
      approvalActive = true;
      triggerAura("approval", { settle: true });
    } else if (!approval && approvalActive) {
      approvalActive = false;
      if (currentAura === "approval") clearAura();
    }

    if (hasErr && !errorActive) {
      errorActive = true;
      triggerAura("error");
    } else if (!hasErr && errorActive) {
      errorActive = false;
    }
  }

  function scheduleHostSignalInspect() {
    if (destroyed || (!cfg.semanticAura && !cfg.unreadBadge)) return;
    const sinceTyping = Date.now() - lastEditorMutationAt;
    const waitMs = Math.max(cfg.signalDebounceMs, sinceTyping < cfg.signalDebounceMs ? cfg.signalDebounceMs - sinceTyping : 0);
    if (stateDebounceTimer) clearTimeout(stateDebounceTimer);
    stateDebounceTimer = setTimeout(() => {
      stateDebounceTimer = null;
      if (Date.now() - lastEditorMutationAt < cfg.signalDebounceMs) {
        scheduleHostSignalInspect();
        return;
      }
      inspectHostSignals();
    }, waitMs);
  }

  function syncMutationObserver() {
    const needObserver = !destroyed && (cfg.inkStreamFade || cfg.semanticAura || cfg.unreadBadge);
    const wantCharData = Boolean(cfg.inkStreamFade && inkSupported);

    if (!needObserver) {
      if (mutObserver) {
        try {
          mutObserver.disconnect();
        } catch {}
        mutObserver = null;
      }
      return;
    }

    if (mutObserver && mutObserverCharacterData === wantCharData) return;
    if (mutObserver) {
      try {
        mutObserver.disconnect();
      } catch {}
      mutObserver = null;
    }

    const MutObs =
      typeof win.MutationObserver === "function"
        ? win.MutationObserver
        : typeof MutationObserver === "function"
          ? MutationObserver
          : null;

    if (!MutObs || !doc.body) return;

    mutObserverCharacterData = wantCharData;
    mutObserver = new MutObs((records) => {
      if (destroyed || !Array.isArray(records) || records.length === 0) return;

      let hasNonEditorSignalChange = false;
      const canInk = Boolean(cfg.inkStreamFade && inkSupported && !docHidden && !cfg.reducedMotion);

      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        if (!rec || !rec.target) continue;

        // FIRST LINE FAST-FILTER: immediately skip all typing/backspace mutations in editable areas!
        if (isNodeInSelector(rec.target, EDITOR_IGNORE_SEL)) {
          lastEditorMutationAt = Date.now();
          continue;
        }

        if (rec.type === "characterData") {
          if (canInk && !isNodeInSelector(rec.target, COMPOSER_IGNORE_SEL)) {
            enqueueInkTextNode(rec.target, rec.oldValue);
          }
          continue;
        }

        if (rec.type === "childList" && canInk && rec.addedNodes && rec.addedNodes.length > 0) {
          if (!isNodeInSelector(rec.target, COMPOSER_IGNORE_SEL)) {
            const found = [];
            for (let j = 0; j < rec.addedNodes.length && found.length < 16; j++) {
              collectTextNodes(rec.addedNodes[j], found, 16);
            }
            for (let k = 0; k < found.length; k++) {
              enqueueInkTextNode(found[k], undefined);
            }
          }
        }

        // Skip non-button interior mutations inside .surface-composer except footer stop/cancel controls
        if (isNodeInSelector(rec.target, ".surface-composer")) {
          if (isNodeInSelector(rec.target, '.agy-composer-footer, [data-testid="input-box-bottom-toolbar"]')) {
            hasNonEditorSignalChange = true;
          }
          continue;
        }

        hasNonEditorSignalChange = true;
      }

      if (hasNonEditorSignalChange) {
        scheduleHostSignalInspect();
      }
    });

    try {
      const obsOpts = {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled", "hidden", "aria-hidden"],
      };
      if (wantCharData) {
        obsOpts.characterData = true;
        obsOpts.characterDataOldValue = true;
      }
      mutObserver.observe(doc.body, obsOpts);
    } catch {}
  }

  on(win, "blur", () => {
    windowFocused = false;
    hideSmoothCaret();
  });
  on(win, "focus", () => {
    windowFocused = true;
    docHidden = Boolean(doc.hidden);
    clearUnreadBadge();
    if (cfg.smoothCaret) scheduleSmoothCaret();
  });
  on(doc, "visibilitychange", () => {
    docHidden = Boolean(doc.hidden);
    if (docHidden) {
      clearInkHighlights();
      hideSmoothCaret();
    } else if (windowFocused) {
      clearUnreadBadge();
    }
  });

  function update(nextRaw) {
    if (destroyed) return status();
    cfg = normalizeConfig(nextRaw, cfg);
    if (!cfg.inkStreamFade) clearInkHighlights();
    if (!cfg.semanticAura) {
      clearAura();
      lastAuraByKind.approval = 0;
      lastAuraByKind.error = 0;
      lastAuraByKind.complete = 0;
    }
    syncSmoothCaretBinding();
    if (!cfg.unreadBadge) clearUnreadBadge();
    syncMutationObserver();
    api.lastSeen = Date.now();
    return status();
  }

  function status() {
    return {
      applied: !destroyed && Boolean(styleEl.isConnected),
      rev: FX_REV,
      owner: cfg.owner,
      enabled: cfg.enabled,
      inkStreamFade: cfg.inkStreamFade,
      inkSupported,
      activeInkSlices: activeInkSlices.length,
      semanticAura: cfg.semanticAura,
      currentAura,
      currentAuraPhase,
      smoothCaret: cfg.smoothCaret,
      caretListenersBound,
      caretVisible,
      caretSnapping,
      isComposing,
      lastCaretRect,
      unreadBadge: cfg.unreadBadge,
      unreadCount,
      inspectCalls,
      idleZeroFps: inkRafId === null && caretRafId === null && currentAuraPhase !== "pulse",
    };
  }

  function destroy() {
    if (destroyed) return { removed: true };
    destroyed = true;
    clearInkHighlights();
    clearAura();
    detachSmoothCaretListeners();
    hideSmoothCaret();
    clearUnreadBadge();
    clearTimeout(stateDebounceTimer);
    stateDebounceTimer = null;
    try {
      mutObserver?.disconnect();
    } catch {}
    mutObserver = null;
    for (const off of cleanups) {
      try {
        off();
      } catch {}
    }
    cleanups.length = 0;
    for (const el of [styleEl, auraEl, caretEl]) {
      try {
        el.remove?.();
      } catch {}
    }
    if (win[GLOBAL_KEY] === api) {
      delete win[GLOBAL_KEY];
    }
    return { removed: true };
  }

  const api = {
    rev: FX_REV,
    owner: cfg.owner,
    lastSeen: Date.now(),
    touch() {
      api.lastSeen = Date.now();
      return true;
    },
    update,
    triggerAura,
    getUnreadCount() {
      return unreadCount;
    },
    status,
    destroy,
  };

  win[GLOBAL_KEY] = api;
  syncSmoothCaretBinding();
  syncMutationObserver();
  inspectHostSignals();

  return status();
}

module.exports = {
  installMotionFx,
  MOTION_FX_REV,
  MOTION_FX_GLOBAL_KEY,
};
