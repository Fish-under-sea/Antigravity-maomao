"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { createVialEngine, createVialEngineSource } = require("../src/host/modules/vial-physics.cjs");
const { installTelemetryBar, createVialEngineSource: telemetryVialSrc, TELEMETRY_BAR_REV } = require("../src/host/modules/telemetry-bar.cjs");
const { installEffortSlider, EFFORT_SLIDER_REV } = require("../src/host/modules/effort-slider.cjs");
const { installComposerBeam, COMPOSER_BEAM_REV } = require("../src/host/modules/composer-beam.cjs");

/**
 * Lightweight, faithful DOM + Event + Selector + rAF + Timer stub for host-module testing.
 */
function createDomHarness() {
  const listenersByTarget = new WeakMap();
  const rafQueue = new Map();
  let rafSeq = 0;
  let activeIntervals = 0;
  let activeTimeouts = 0;
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  const origSetTimeout = global.setTimeout;
  const origClearTimeout = global.clearTimeout;
  const trackedIntervals = new Set();
  const trackedTimeouts = new Set();

  function makeStyle() {
    const props = {};
    return new Proxy(
      {
        _props: props,
        setProperty(k, v) {
          props[k] = String(v);
        },
        getPropertyValue(k) {
          return props[k] || "";
        },
        removeProperty(k) {
          delete props[k];
        },
      },
      {
        get(target, prop) {
          if (prop in target) return target[prop];
          return props[prop] || "";
        },
        set(target, prop, val) {
          props[prop] = String(val);
          return true;
        },
      }
    );
  }

  function matchesSelector(el, sel) {
    if (!el || !sel) return false;
    const parts = String(sel)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const part of parts) {
      if (matchCompound(el, part)) return true;
    }
    return false;
  }

  function matchCompound(el, raw) {
    // Support simple descendant combinator ("A B")
    if (raw.includes(" ")) {
      const tokens = raw.split(/\s+/).filter(Boolean);
      const last = tokens[tokens.length - 1];
      if (!matchSimple(el, last)) return false;
      let cur = el.parentElement;
      for (let i = tokens.length - 2; i >= 0; i--) {
        let found = false;
        while (cur) {
          if (matchSimple(cur, tokens[i])) {
            found = true;
            cur = cur.parentElement;
            break;
          }
          cur = cur.parentElement;
        }
        if (!found) return false;
      }
      return true;
    }
    return matchSimple(el, raw);
  }

  function matchSimple(el, sel) {
    let s = sel;
    // Handle :not(...)
    const notRe = /:not\(([^)]+)\)/g;
    let nm;
    while ((nm = notRe.exec(sel)) !== null) {
      if (matchSimple(el, nm[1])) return false;
    }
    s = s.replace(/:not\([^)]+\)/g, "");
    if (!s) return true;

    // Extract attribute selectors
    const attrRe = /\[([^\]=*~^$|]+)(?:(\*?=)['"]?([^'"\]]*)['"]?)?\]/g;
    let am;
    while ((am = attrRe.exec(s)) !== null) {
      const attrName = am[1].trim();
      const op = am[2];
      const expected = am[3];
      const val = el.getAttribute?.(attrName);
      if (!op) {
        if (val === null || val === undefined) return false;
      } else if (op === "=") {
        if (val !== expected) return false;
      } else if (op === "*=") {
        if (val == null || !String(val).includes(expected)) return false;
      }
    }
    s = s.replace(attrRe, "");

    // Extract #id
    const idMatch = /#([a-zA-Z0-9_-]+)/.exec(s);
    if (idMatch) {
      if (el.id !== idMatch[1]) return false;
      s = s.replace(idMatch[0], "");
    }

    // Extract .classes
    const classMatches = [...s.matchAll(/\.([a-zA-Z0-9_-]+)/g)];
    for (const cm of classMatches) {
      if (!el.classList?.contains(cm[1])) return false;
    }
    s = s.replace(/\.[a-zA-Z0-9_-]+/g, "");

    // Remaining tag name
    if (s && s !== "*") {
      if (String(el.tagName || "").toUpperCase() !== s.toUpperCase()) return false;
    }
    return true;
  }

  function makeCanvasCtx2d() {
    const calls = [];
    const grad = { addColorStop() {} };
    return {
      calls,
      save() {},
      restore() {},
      clearRect() { calls.push("clearRect"); },
      fillRect() { calls.push("fillRect"); },
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      arc() {},
      fill() { calls.push("fill"); },
      stroke() { calls.push("stroke"); },
      clip() {},
      setTransform() {},
      setLineDash() {},
      createLinearGradient() { return grad; },
      createRadialGradient() { return grad; },
      fillText(txt) { calls.push("fillText:" + txt); },
    };
  }

  function makeElement(tag, initial = {}) {
    const attrs = new Map();
    const children = [];
    const classes = new Set();
    let _innerHTML = "";
    let _textContent = initial.textContent || "";
    const rect = initial.rect || { left: 0, top: 0, width: 640, height: 120, right: 640, bottom: 120 };
    const ctx2d = tag.toLowerCase() === "canvas" ? makeCanvasCtx2d() : null;

    const el = {
      tagName: tag.toUpperCase(),
      id: "",
      children,
      isConnected: true,
      parentElement: null,
      style: makeStyle(),
      shadowRoot: null,
      width: 112,
      height: 224,
      disabled: false,
      value: "",
      clickCount: 0,
      focused: false,
      rect,
      _ctx2d: ctx2d,
      get className() {
        return [...classes].join(" ");
      },
      set className(v) {
        classes.clear();
        for (const c of String(v || "").split(/\s+/).filter(Boolean)) classes.add(c);
      },
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
      },
      get textContent() {
        if (children.length) {
          return [_textContent, ...children.map((c) => c.textContent || "")].filter(Boolean).join(" ");
        }
        return _textContent;
      },
      set textContent(v) {
        _textContent = String(v ?? "");
      },
      get innerHTML() {
        return _innerHTML;
      },
      set innerHTML(html) {
        _innerHTML = String(html || "");
        children.length = 0;
        // Parse lightweight HTML into queryable stub children for assertions & click testing
        parseSimpleHtml(_innerHTML, el);
      },
      setAttribute(k, v) {
        const val = String(v);
        if (k === "id") el.id = val;
        if (k === "class") el.className = val;
        attrs.set(k, val);
      },
      getAttribute(k) {
        if (k === "id" && el.id) return el.id;
        if (k === "class") return el.className;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k) || (k === "id" && Boolean(el.id));
      },
      removeAttribute(k) {
        attrs.delete(k);
        if (k === "id") el.id = "";
      },
      append(...nodes) {
        for (const n of nodes) {
          if (!n) continue;
          if (n.parentElement) n.remove?.();
          n.parentElement = el;
          n.isConnected = el.isConnected;
          children.push(n);
        }
      },
      appendChild(n) {
        el.append(n);
        return n;
      },
      insertBefore(n, ref) {
        if (!n) return n;
        if (n.parentElement) n.remove?.();
        n.parentElement = el;
        n.isConnected = el.isConnected;
        const idx = ref ? children.indexOf(ref) : -1;
        if (idx >= 0) children.splice(idx, 0, n);
        else children.push(n);
        return n;
      },
      remove() {
        el.isConnected = false;
        if (el.parentElement) {
          const i = el.parentElement.children.indexOf(el);
          if (i >= 0) el.parentElement.children.splice(i, 1);
          el.parentElement = null;
        }
      },
      get firstChild() {
        return children[0] || null;
      },
      get nextSibling() {
        if (!el.parentElement) return null;
        const i = el.parentElement.children.indexOf(el);
        return i >= 0 ? el.parentElement.children[i + 1] || null : null;
      },
      matches(sel) {
        return matchesSelector(el, sel);
      },
      closest(sel) {
        for (let cur = el; cur; cur = cur.parentElement) {
          if (matchesSelector(cur, sel)) return cur;
        }
        return null;
      },
      contains(target) {
        if (!target) return false;
        if (target === el) return true;
        return children.some((c) => c.contains?.(target));
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      querySelectorAll(sel) {
        const out = [];
        function walk(node) {
          for (const child of node.children) {
            if (matchesSelector(child, sel)) out.push(child);
            walk(child);
          }
        }
        walk(el);
        return out;
      },
      getBoundingClientRect() {
        return { ...el.rect };
      },
      attachShadow() {
        const sr = makeElement("shadow-root");
        sr.host = el;
        el.shadowRoot = sr;
        return sr;
      },
      getContext(kind) {
        if (kind === "2d") return ctx2d;
        return null; // Force WebGL -> Canvas 2D fallback in headless Node tests
      },
      addEventListener(type, fn) {
        let map = listenersByTarget.get(el);
        if (!map) {
          map = new Map();
          listenersByTarget.set(el, map);
        }
        let set = map.get(type);
        if (!set) {
          set = new Set();
          map.set(type, set);
        }
        set.add(fn);
      },
      removeEventListener(type, fn) {
        listenersByTarget.get(el)?.get(type)?.delete(fn);
      },
      dispatchEvent(evt) {
        const e = evt && typeof evt === "object" ? evt : { type: String(evt) };
        if (!e.target) e.target = el;
        let stopped = false;
        e.stopPropagation = () => { stopped = true; };
        e.stopImmediatePropagation = () => { stopped = true; };
        e.preventDefault = () => {};
        for (let cur = el; cur && !stopped; cur = cur.parentElement) {
          const set = listenersByTarget.get(cur)?.get(e.type);
          if (set) {
            for (const fn of [...set]) {
              fn(e);
              if (stopped) break;
            }
          }
        }
        return true;
      },
      click() {
        el.clickCount++;
        el.dispatchEvent({ type: "click", target: el });
      },
      focus() {
        el.focused = true;
      },
    };
    if (initial.id) el.setAttribute("id", initial.id);
    if (initial.className) el.className = initial.className;
    if (initial.attrs) {
      for (const [k, v] of Object.entries(initial.attrs)) el.setAttribute(k, v);
    }
    return el;
  }

  function parseSimpleHtml(html, parent) {
    // Minimal HTML tokenizer sufficient for button/div/span/canvas/svg tags with attributes & text
    const stack = [parent];
    const tokenRe = /<(\/?)([a-zA-Z0-9-]+)([^>]*?)(\/?)>|([^<]+)/g;
    let m;
    while ((m = tokenRe.exec(html)) !== null) {
      const top = stack[stack.length - 1];
      if (m[5] !== undefined) {
        const txt = m[5].trim();
        if (txt) {
          top.textContent = (top.textContent ? top.textContent + " " : "") + txt;
        }
        continue;
      }
      const closing = m[1] === "/";
      const tag = m[2].toLowerCase();
      const attrStr = m[3] || "";
      const selfClose = m[4] === "/" || tag === "input" || tag === "br" || tag === "hr";
      if (closing) {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const node = makeElement(tag);
      const attrRe = /([a-zA-Z0-9_:-]+)(?:\s*=\s*"([^"]*)")?/g;
      let am;
      while ((am = attrRe.exec(attrStr)) !== null) {
        node.setAttribute(am[1], am[2] ?? "");
      }
      top.append(node);
      if (!selfClose) stack.push(node);
    }
  }

  const docEl = makeElement("html");
  docEl.classList.add("dark");
  const head = makeElement("head");
  const body = makeElement("body");
  docEl.append(head, body);

  const storageMap = new Map();
  const localStorage = {
    getItem(k) { return storageMap.has(k) ? storageMap.get(k) : null; },
    setItem(k, v) { storageMap.set(k, String(v)); },
    removeItem(k) { storageMap.delete(k); },
    clear() { storageMap.clear(); },
  };

  const docListeners = new Map();
  const winListeners = new Map();

  const documentStub = {
    documentElement: docEl,
    head,
    body,
    hidden: false,
    readyState: "complete",
    createElement: (tag) => makeElement(tag),
    createElementNS: (_ns, tag) => makeElement(tag),
    getElementById: (id) => docEl.querySelector("#" + id),
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    dispatchEvent(evt) {
      for (const fn of [...(docListeners.get(evt.type) || [])]) fn(evt);
    },
  };

  const windowStub = {
    innerWidth: 1280,
    innerHeight: 720,
    devicePixelRatio: 2,
    location: { pathname: "/c/conv-alpha-001" },
    localStorage,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(evt) {
      for (const fn of [...(winListeners.get(evt.type) || [])]) fn(evt);
    },
  };

  const resizeCallbacks = [];
  class MockResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = new Set(); }
    observe(el) { this.targets.add(el); resizeCallbacks.push(this); }
    unobserve(el) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
  }
  const mutationObservers = [];
  class MockMutationObserver {
    constructor(cb) { this.cb = cb; this.active = false; mutationObservers.push(this); }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
    trigger(records) { if (this.active) this.cb(records); }
  }

  const origGlobals = {
    window: global.window,
    document: global.document,
    getComputedStyle: global.getComputedStyle,
    MutationObserver: global.MutationObserver,
    ResizeObserver: global.ResizeObserver,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
    fetch: global.fetch,
    Event: global.Event,
    CustomEvent: global.CustomEvent,
    setInterval: global.setInterval,
    clearInterval: global.clearInterval,
    setTimeout: global.setTimeout,
    clearTimeout: global.clearTimeout,
  };

  function install() {
    global.window = windowStub;
    global.document = documentStub;
    global.getComputedStyle = () => ({ position: "relative", borderRadius: "20px", display: "flex" });
    global.MutationObserver = MockMutationObserver;
    global.ResizeObserver = MockResizeObserver;
    global.Event = class MockEvent {
      constructor(type, opts) { this.type = type; Object.assign(this, opts); }
    };
    global.CustomEvent = class MockCustomEvent {
      constructor(type, opts) { this.type = type; this.detail = opts?.detail; }
    };
    global.requestAnimationFrame = (fn) => {
      const id = ++rafSeq;
      rafQueue.set(id, fn);
      return id;
    };
    global.cancelAnimationFrame = (id) => {
      rafQueue.delete(id);
    };
    global.setInterval = (fn, ms) => {
      const id = origSetInterval(fn, ms);
      trackedIntervals.add(id);
      activeIntervals = trackedIntervals.size;
      return id;
    };
    global.clearInterval = (id) => {
      trackedIntervals.delete(id);
      activeIntervals = trackedIntervals.size;
      return origClearInterval(id);
    };
    global.setTimeout = (fn, ms) => {
      const id = origSetTimeout(() => {
        trackedTimeouts.delete(id);
        activeTimeouts = trackedTimeouts.size;
        fn();
      }, ms);
      trackedTimeouts.add(id);
      activeTimeouts = trackedTimeouts.size;
      return id;
    };
    global.clearTimeout = (id) => {
      trackedTimeouts.delete(id);
      activeTimeouts = trackedTimeouts.size;
      return origClearTimeout(id);
    };
  }

  function flushRaf(timestamp) {
    const entries = [...rafQueue.entries()];
    rafQueue.clear();
    for (const [, fn] of entries) fn(timestamp);
  }

  function triggerResize() {
    for (const ro of resizeCallbacks) {
      if (ro.targets.size > 0) ro.cb();
    }
  }

  function restore() {
    for (const id of trackedIntervals) origClearInterval(id);
    for (const id of trackedTimeouts) origClearTimeout(id);
    trackedIntervals.clear();
    trackedTimeouts.clear();
    rafQueue.clear();
    Object.assign(global, origGlobals);
  }

  return {
    install,
    restore,
    makeElement,
    window: windowStub,
    document: documentStub,
    body,
    head,
    localStorage,
    flushRaf,
    triggerResize,
    triggerMutations: (records) => {
      for (const mo of mutationObservers) mo.trigger(records);
    },
    getPendingRafCount: () => rafQueue.size,
    getActiveIntervalCount: () => activeIntervals,
    getActiveTimeoutCount: () => activeTimeouts,
    getDocListenerCount: () => [...docListeners.values()].reduce((s, set) => s + set.size, 0),
    getWinListenerCount: () => [...winListeners.values()].reduce((s, set) => s + set.size, 0),
  };
}

// =========================================================================
// 1. Self-containment CDP serialization check
// =========================================================================
test("all host install functions serialize cleanly via toString() without external closures or require()", () => {
  const fns = [
    ["installTelemetryBar", installTelemetryBar],
    ["installEffortSlider", installEffortSlider],
    ["installComposerBeam", installComposerBeam],
  ];
  for (const [name, fn] of fns) {
    const src = fn.toString();
    assert.match(src, new RegExp("^function\\s+" + name + "\\s*\\("), `${name} should serialize as named function`);
    assert.doesNotMatch(src, /\brequire\s*\(/, `${name} must not call require() inside serialized body`);
    // Compile inside a completely isolated VM context with zero Node globals
    const script = new vm.Script("(" + src + ")");
    const compiled = script.runInNewContext({});
    assert.equal(typeof compiled, "function", `${name} must compile standalone in isolated VM`);
  }
  const vialSrc = createVialEngineSource();
  assert.equal(vialSrc, telemetryVialSrc());
  const compiledVial = new vm.Script("(" + vialSrc + ")").runInNewContext({});
  assert.equal(typeof compiledVial, "function");
});

// =========================================================================
// 2. Vial shallow-water physics convergence, pendulum slosh, droplets & 0fps sleep
// =========================================================================
test("vial-physics 24-node shallow-water waves converge stably, respond to drag/poke, draw 128k/256k/384k ticks, and hibernate at 0fps", () => {
  const engine = createVialEngine({ nodes: 24, initialLevel: 0.45, maxTokens: 524288 });
  assert.equal(engine.state.nodes, 24);
  assert.equal(engine.isSleeping(), true);

  // Poke wakes engine and creates bounded wave displacement
  engine.poke(0.5, 0.85);
  assert.equal(engine.isSleeping(), false);
  engine.step(0.016);
  assert.ok(engine.getEnergy() > 0.001, "poke should inject wave energy");

  // Raising target level spawns falling droplets
  engine.setTargetLevel(0.62, { usedTokens: 325000, maxTokens: 524288 });
  assert.ok(engine.state.droplets.length >= 1, "rising level should spawn glowing droplets");

  // Drag acceleration excites damped gravity pendulum
  engine.applyDragAccel(12, -2);
  engine.step(0.016);
  assert.ok(Math.abs(engine.state.tiltAngle) > 0.0005, "drag acceleration should tilt liquid pendulum");

  // Run physics forward (including large dt spikes clamped safely) until natural convergence & 1.1s sleep
  let maxAbsH = 0;
  for (let i = 0; i < 600; i++) {
    engine.step(i % 40 === 0 ? 0.25 : 0.016);
    for (let j = 0; j < engine.state.nodes; j++) {
      assert.ok(Number.isFinite(engine.state.h[j]), "wave height must stay finite");
      maxAbsH = Math.max(maxAbsH, Math.abs(engine.state.h[j]));
    }
    if (engine.isSleeping()) break;
  }
  assert.ok(maxAbsH > 0 && maxAbsH <= 0.35, "wave displacement must remain physically bounded");
  assert.equal(engine.isSleeping(), true, "engine must hibernate at 0fps after settling for 1.1s");
  assert.equal(engine.getEnergy(), 0);
  assert.ok(Math.abs(engine.state.level - 0.62) < 0.001);

  // Render onto mock 2D canvas and verify laser-etched 128k / 256k / 384k graduations
  const drawnTexts = [];
  const mockCtx = {
    save() {}, restore() {}, clearRect() {}, fillRect() {}, beginPath() {}, closePath() {},
    moveTo() {}, lineTo() {}, quadraticCurveTo() {}, arc() {}, fill() {}, stroke() {}, clip() {},
    createLinearGradient() { return { addColorStop() {} }; },
    createRadialGradient() { return { addColorStop() {} }; },
    fillText(t) { drawnTexts.push(t); },
  };
  engine.render(mockCtx, 112, 224, { dark: true, themeStyle: "star-neko" });
  assert.deepEqual(drawnTexts, ["128k", "256k", "384k"]);
});

// =========================================================================
// 3. Telemetry Bar: 3 icons, narrow folding, external yield/takeover, 512K vial popover, /compact, 53w heatmap & destroy
// =========================================================================
test("telemetry-bar mounts 3 icons, folds on narrow width, yields/takes over AG Pulse, opens vial popover + /compact + 53w dashboard, and destroys cleanly", async () => {
  const dom = createDomHarness();
  dom.install();
  try {
    const composer = dom.makeElement("div", { className: "surface-composer" });
    const card = dom.makeElement("div", { className: "surface-composer-card" });
    const editor = dom.makeElement("div", { attrs: { "data-lexical-editor": "true", contenteditable: "true" } });
    const footer = dom.makeElement("div", {
      className: "agy-composer-footer",
      rect: { left: 100, top: 620, width: 860, height: 34, right: 960, bottom: 654 },
    });
    const leftGroup = dom.makeElement("div", { className: "flex min-w-0 flex-1 items-center gap-0" });
    const modelTrigger = dom.makeElement("button", { attrs: { "data-testid": "model-selector-trigger" }, textContent: "Gemini 4 Neon Extra High" });
    leftGroup.append(modelTrigger);
    const rightActionGroup = dom.makeElement("div", { className: "shrink-0 flex items-center gap-0.5" });
    const permBtn = dom.makeElement("button", { attrs: { "data-testid": "permissions-selector-trigger" }, textContent: "极速" });
    const sendBtn = dom.makeElement("button", { attrs: { "data-testid": "input-send-button" } });
    rightActionGroup.append(permBtn, sendBtn);
    footer.append(leftGroup, rightActionGroup);
    card.append(editor, footer);
    composer.append(card);
    dom.body.append(composer);

    const sampleTelemetry = {
      conversationId: "conv-alpha-001",
      model: "Gemini 4 Neon",
      role: "planner",
      tps: 144.6,
      latestTps: 72.5,
      ttftSeconds: 0.38,
      rounds: 7,
      totalTokens: 205040000,
      inputTokens: 42000,
      cacheReadTokens: 132000,
      outputTokens: 10200,
      cacheHitPercent: 84.0,
      costUsd: 0.14,
      cacheSizeBytes: 12582912,
      context: {
        usedTokens: 432000,
        maxTokens: 524288,
        usedPercent: 82.4,
        compactions: 1,
        compactedPending: false,
        hasOrchestrator: true,
        categories: [
          { key: "sys", label: "System Prompt", tokens: 32000, percent: 6.1 },
          { key: "skills", label: "Skills", tokens: 18000, percent: 3.4 },
          { key: "tools", label: "Tools", tokens: 44000, percent: 8.4 },
          { key: "mcp", label: "MCP", tokens: 12000, percent: 2.3 },
          { key: "chat", label: "Chat Messages", tokens: 210000, percent: 40.1 },
          { key: "thinking", label: "Thinking", tokens: 52000, percent: 9.9 },
          { key: "toolout", label: "Tool Outputs", tokens: 38000, percent: 7.2 },
          { key: "files", label: "Files", tokens: 20000, percent: 3.8 },
          { key: "media", label: "Media", tokens: 6000, percent: 1.1 },
          { key: "free", label: "Free", tokens: 92288, percent: 17.6 },
        ],
      },
      subagents: [{ id: "sub-1", title: "researcher", totalTokens: 24500, costUsd: 0.02 }],
      quota: {
        groups: [
          { id: "claude", name: "Claude", windows: { "5h": { remaining: 0.72, resetAt: Date.now() + 7200000 }, weekly: { remaining: 0.88 } } },
          { id: "gemini-pro", name: "Gemini Pro", windows: { "5h": { remaining: 0.45 }, weekly: { remaining: 0.61 } } },
          { id: "gemini-flash", name: "Gemini Flash", windows: { "5h": { remaining: 0.96 }, weekly: { remaining: 0.94 } } },
        ],
      },
    };

    const sampleDashboard = {
      totalRequests: 128,
      totalTokens: 2450000,
      cacheHitPercent: 84.2,
      costUsd: 1.92,
      days: [{ date: new Date().toISOString().slice(0, 10), requests: 14, tokens: 310000 }],
      models: [{ model: "Gemini 4 Neon", tokens: 1800000, cacheHitPercent: 86, costUsd: 1.3 }],
      recentCalls: [
        {
          timestampMs: new Date(2026, 10, 26, 18, 20, 5).getTime(),
          model: "Gemini 4 Neon (XHigh)",
          provider: "Antigravity",
          ttftMs: 5150,
          streamingMs: 11050,
          durationMs: 16200,
          tps: 163.2,
          inputTokens: 2330,
          cacheReadTokens: 255000,
          cacheWriteTokens: 0,
          thinkingTokens: 1200,
          outputTokens: 1800,
          responseTokens: 600,
          cacheHitRate: 99.1,
          status: "ok",
          error: "",
          retries: 0,
          conversationId: "conv-alpha-001",
          requestId: "req-call-001",
        },
        {
          timestampMs: new Date(2026, 10, 26, 18, 15, 0).getTime(),
          model: "Claude Sonnet 4",
          provider: "Antigravity",
          ttftMs: 1800,
          streamingMs: 3200,
          durationMs: 5000,
          tps: 88.4,
          inputTokens: 1200,
          cacheReadTokens: 48000,
          cacheWriteTokens: 0,
          thinkingTokens: 400,
          outputTokens: 900,
          responseTokens: 500,
          cacheHitRate: 97.6,
          status: "error",
          error: "rate_limit_exceeded",
          retries: 2,
          conversationId: "conv-alpha-001",
          requestId: "req-call-002",
        },
      ],
    };

    const fetchCalls = [];
    global.fetch = async (url) => {
      fetchCalls.push(String(url));
      if (String(url).includes("/api/maomao/usage")) {
        return { ok: true, json: async () => sampleDashboard };
      }
      return { ok: true, json: async () => sampleTelemetry };
    };

    // Simulate pre-existing rev:7 instance to confirm rev:8 hot-upgrade replaces it cleanly
    let oldDestroyed = 0;
    dom.window.__agyMaomaoTelemetryBar = { owner: "test-owner", rev: 7, destroy() { oldDestroyed++; } };

    // Mount in auto mode
    const res = installTelemetryBar({
      owner: "test-owner",
      sidecarBaseUrl: "http://127.0.0.1:45678",
      sidecarToken: "tok-123",
      telemetry: { enabled: true, barMode: "auto", vialEnabled: true, vialStyle: "vial", quotaEnabled: true },
    });
    assert.equal(oldDestroyed, 1, "rev:8 must hot-replace stale rev:7 instance");
    assert.equal(res.applied, true);
    assert.equal(res.rev, 8);
    assert.equal(res.surfaceMode, "dark");
    assert.equal(res.mounted, true);

    await new Promise((r) => setTimeout(r, 10));
    assert.ok(fetchCalls.some((u) => u.includes("/api/maomao/telemetry?conversationId=conv-alpha-001&strict=1&token=tok-123")));

    const host = dom.body.querySelector("#agy-maomao-telemetry-host");
    assert.ok(host, "telemetry host mounted in footer");
    // Exact inline placement: right before rightActionGroup (permissions + send) and after leftGroup!
    assert.equal(footer.children.indexOf(leftGroup), 0);
    assert.equal(footer.children.indexOf(host), 1, "telemetry bar must sit immediately left of the right action group");
    assert.equal(footer.children.indexOf(rightActionGroup), 2);
    assert.equal(host.nextSibling, rightActionGroup);

    let sr = host.shadowRoot;
    // Unified single clickable capsule pill (zero misleading 3-separate sub-buttons!)
    const pillButtons = sr.querySelectorAll("button");
    assert.equal(pillButtons.length, 1, "toolbar must render ONE unified clickable capsule button");
    const pill = sr.querySelector('[data-role="telemetry-pill"]');
    assert.ok(pill);
    assert.ok(sr.querySelector('[data-role="speed"]'));
    assert.ok(sr.querySelector('[data-role="tokens"]'));
    assert.ok(sr.querySelector('[data-role="context"]'));
    assert.equal(sr.querySelector(".tb-wrap").getAttribute("data-compact"), "full");
    assert.equal(sr.querySelector(".tb-wrap").getAttribute("data-density"), "wide");
    assert.match(sr.querySelector('[data-role="speed"]').textContent, /72\.5 tok\/s/);
    assert.match(sr.querySelector('[data-role="tokens"]').textContent, /205\.04M · 缓存命中 84%/);
    assert.match(sr.querySelector('[data-role="context"]').textContent, /上下文 82%/);

    // Clicking the unified capsule toggles popover cleanly & reflects aria-expanded
    const tbCss = sr.querySelector("style")?.textContent || "";
    assert.match(tbCss, /\.tb-pill\s*\{[^}]*border:\s*1px solid transparent[^}]*background:\s*transparent[^}]*box-shadow:\s*none/);
    assert.match(tbCss, /\.tb-pill:hover,\s*\.tb-pill:focus-visible,\s*\.tb-pill\[aria-expanded="true"\]/);
    assert.equal(pill.getAttribute("aria-expanded"), "false");
    pill.click();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().popoverOpen, true);
    assert.equal(sr.querySelector('[data-role="telemetry-pill"]').getAttribute("aria-expanded"), "true");
    sr.querySelector('[data-role="telemetry-pill"]').click();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().popoverOpen, false);
    assert.equal(sr.querySelector('[data-role="telemetry-pill"]').getAttribute("aria-expanded"), "false");

    // Regression: when React detaches and remounts the footer host element, the new ShadowRoot <style> must be populated immediately (no unstyled grey button!)
    host.remove();
    dom.window.__agyMaomaoTelemetryBar.rescan();
    const remountedHost = dom.body.querySelector("#agy-maomao-telemetry-host");
    assert.ok(remountedHost && remountedHost !== host, "telemetry host must cleanly remount after footer replacement");
    const remountedCss = remountedHost.shadowRoot?.querySelector("style")?.textContent || "";
    assert.match(remountedCss, /\.tb-pill\s*\{[^}]*background:\s*transparent/, "remounted ShadowRoot must inject full CSS even when theme key is unchanged");
    assert.ok(remountedHost.shadowRoot?.querySelector('[data-role="telemetry-pill"]'), "remounted ShadowRoot must render pill content");
    sr = remountedHost.shadowRoot;

    // Regression: switching to a brand-new conversation (pathname="/") must NEVER leak an unrelated sidebar [data-cascade-id] or old conversation stats!
    const sidebarItem = dom.makeElement("div", { attrs: { "data-cascade-id": "unrelated-sidebar-conv-999" } });
    dom.body.append(sidebarItem);
    const prevPath = dom.window.location.pathname;
    dom.window.location.pathname = "/";
    dom.window.__agyMaomaoTelemetryBar.rescan();
    assert.match(sr.querySelector('[data-role="speed"]').textContent, /-- tok\/s/, "new conversation must reset TPS instead of leaking old conversation");
    assert.match(sr.querySelector('[data-role="tokens"]').textContent, /0 tok/, "new conversation must reset tokens to 0");
    assert.match(sr.querySelector('[data-role="context"]').textContent, /上下文 0%/, "new conversation must reset context to 0%");
    assert.ok(
      fetchCalls.some((u) => u.includes("/api/maomao/telemetry?conversationId=&strict=1&token=tok-123")),
      "new conversation must query strict=1 with empty conversationId (not sidebar data-cascade-id)"
    );
    sidebarItem.remove();
    dom.window.location.pathname = prevPath;
    dom.window.__agyMaomaoTelemetryBar.rescan();
    await new Promise((r) => setTimeout(r, 15));

    // Medium width progressively folds to concise "缓存命中 84%" + "82%"
    footer.rect.width = 560;
    dom.triggerResize();
    assert.equal(sr.querySelector(".tb-wrap").getAttribute("data-density"), "medium");
    assert.equal(sr.querySelector('[data-role="tokens"]').textContent.trim(), "缓存命中 84%");
    assert.equal(sr.querySelector('[data-role="context"]').textContent.trim(), "82%");

    // Narrow width folds cleanly to pure 3 icons
    footer.rect.width = 410;
    dom.triggerResize();
    assert.equal(sr.querySelector(".tb-wrap").getAttribute("data-compact"), "icons");
    assert.equal(sr.querySelector(".tb-wrap").getAttribute("data-density"), "icons");

    // External ag-pulse-status-bar triggers yield in auto mode + one-click takeover
    const extPulse = dom.makeElement("div", { id: "ag-pulse-status-bar" });
    dom.body.append(extPulse);
    dom.window.__agyMaomaoTelemetryBar.rescan();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().yielded, true);
    assert.ok(sr.querySelector('[data-role="takeover"]'));
    dom.window.__agyMaomaoTelemetryBar.takeover();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().yielded, false);
    assert.ok(sr.querySelector('[data-role="context"]'));

    // Click icon to open 512K vial popover
    dom.window.__agyMaomaoTelemetryBar.openPopover();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().popoverOpen, true);
    const popHost = dom.body.querySelector("#agy-maomao-telemetry-popover-host");
    assert.ok(popHost);
    const popSr = popHost.shadowRoot;
    assert.match(popSr.querySelector(".pop-model-name").textContent, /Gemini 4 Neon/);
    assert.match(popSr.querySelector('[data-testid="maomao-metric-tps"]').textContent, /144\.6\s*tok\/s/);
    // Archive button removed from 512K vial popover footer (prevents accidental history deletion)
    assert.equal(popSr.querySelector('[data-role="archive-scan"]'), null, "popover footer must NOT have archive button");
    assert.ok(popSr.querySelector('[data-role="open-dashboard"]'), "popover footer retains dashboard button");
    const popCss = popSr.querySelector("style")?.textContent || "";
    assert.match(popCss, /::-webkit-scrollbar\s*\{[\s\S]*width:\s*5px/);
    assert.match(popCss, /::-webkit-scrollbar-button\s*\{[\s\S]*display:\s*none\s*!important/);
    assert.match(popCss, /rgba\(196,\s*181,\s*253,\s*0\.14\)/);
    assert.match(popCss, /scrollbar-width:\s*thin/);
    assert.doesNotMatch(popCss, /\.cat-list\s*\{[^}]*overflow-y:\s*auto/);
    assert.ok(popSr.querySelector('[data-role="vial-canvas"]'), "vial canvas rendered");
    assert.ok(popSr.querySelector('[data-testid="maomao-quota-section"]'), "dual-window quota rendered");
    assert.ok(popSr.querySelector('[data-testid="maomao-subagents-section"]'), "subagent summary rendered");
    assert.ok(popSr.querySelector('[data-role="compact-btn"]'), ">=80% compact button rendered");

    // Switch vial -> minimal bar and back
    popSr.querySelector('[data-role="toggle-style"]').click();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().vialStyle, "bar");
    assert.ok(popSr.querySelector('[data-testid="maomao-minimal-bar"]'));
    assert.equal(dom.getPendingRafCount(), 0, "minimal bar mode uses 0 rAF");
    popSr.querySelector('[data-role="toggle-style"]').click();
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().vialStyle, "vial");

    // Click one-click /compact button -> fills composer editor and closes popover
    popSr.querySelector('[data-role="compact-btn"]').click();
    assert.equal(editor.textContent, "/compact");
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().popoverOpen, false);

    // Open 53-week Usage Dashboard modal with Model Call Logs table (replacing old cache anomalies block)
    dom.window.__agyMaomaoTelemetryBar.openDashboard();
    await new Promise((r) => setTimeout(r, 10));
    const dashHost = dom.body.querySelector("#agy-maomao-dashboard-host");
    assert.ok(dashHost);
    const dashSr = dashHost.shadowRoot;
    const dashStyleEl = dashSr.querySelector("style");
    const dashCss = dashStyleEl?.textContent || "";
    assert.match(dashCss, /width:\s*min\(980px,\s*92vw\)/);
    assert.match(dashCss, /::-webkit-scrollbar-button\s*\{\s*display:\s*none\s*!important/);
    // Performance (#59): .backdrop must NOT run fullscreen backdrop-filter blur on 4K60 video; .modal/.pop use contain: layout style
    const backdropBlock = /\.backdrop\s*\{[^}]*\}/.exec(dashCss)?.[0] || "";
    assert.doesNotMatch(backdropBlock, /backdrop-filter/, ".backdrop must NOT apply fullscreen backdrop-filter blur");
    assert.match(dashCss, /\.modal\s*\{[^}]*contain:\s*layout style/, ".modal must declare contain: layout style");

    const heatmapElBefore = dashSr.querySelector('[data-testid="maomao-heatmap-53w"]');
    const cells = dashSr.querySelectorAll(".h-cell");
    assert.equal(cells.length, 53 * 7, "53-week heatmap has 371 day cells");
    assert.equal(dashSr.querySelector('[data-testid="maomao-cache-anomalies"]'), null, "old red cache anomalies block must be replaced");
    const callLogs = dashSr.querySelector('[data-testid="maomao-call-logs"]');
    assert.ok(callLogs, "model call logs table rendered");
    const logRows = callLogs.querySelectorAll("tr.log-row");
    assert.equal(logRows.length, 2);
    assert.match(logRows[0].textContent, /11月26日 18:20:05/);
    assert.match(logRows[0].textContent, /Gemini 4 Neon \(XHigh\)/);
    assert.match(logRows[0].textContent, /Antigravity/);
    assert.match(logRows[0].textContent, /5\.15 s/);
    assert.match(logRows[0].textContent, /163 tok\/s/);
    assert.match(logRows[0].textContent, /2\.33K.*255K.*1\.80K/);
    assert.match(logRows[0].textContent, /99\.1%/);
    assert.match(logRows[0].textContent, /16\.2 s/);
    assert.match(logRows[0].textContent, /已完成/);
    assert.match(logRows[1].textContent, /异常/);

    // Track CSS writes to prove cached CSS key prevents redundant styleEl.textContent rewrites
    let dashCssWrites = 0;
    const origDashStyleDesc = Object.getOwnPropertyDescriptor(dashStyleEl, "textContent");
    Object.defineProperty(dashStyleEl, "textContent", {
      configurable: true,
      get() { return origDashStyleDesc.get.call(this); },
      set(v) { dashCssWrites++; origDashStyleDesc.set.call(this, v); },
    });

    // Click row to expand detail sub-row — must ONLY refresh <tbody> without rebuilding 371-cell heatmap or CSS!
    logRows[0].click();
    assert.strictEqual(
      dashSr.querySelector('[data-testid="maomao-heatmap-53w"]'),
      heatmapElBefore,
      "expanding a call log row must NOT rebuild the 53-week heatmap DOM node"
    );
    assert.equal(dashCssWrites, 0, "expanding a call log row must NOT rewrite dashboard CSS");
    const detailRow = dashSr.querySelector('[data-testid="maomao-call-detail"]');
    assert.ok(detailRow, "clicking call log row expands detail sub-row");
    assert.match(detailRow.textContent, /1\.20K/);
    assert.match(detailRow.textContent, /req-call-001/);

    // Sort asc/desc toggle reverses order cleanly via partial <tbody> refresh
    dashSr.querySelector('[data-role="log-sort-dir"]').click();
    assert.strictEqual(
      dashSr.querySelector('[data-testid="maomao-heatmap-53w"]'),
      heatmapElBefore,
      "toggling sort direction must NOT rebuild heatmap"
    );
    const ascRows = dashSr.querySelectorAll("tr.log-row");
    assert.match(ascRows[0].textContent, /Claude Sonnet 4/);

    // Filter by model narrows rows via partial <tbody> refresh
    const modelFilter = dashSr.querySelector('[data-role="log-model-filter"]');
    modelFilter.value = "Claude Sonnet 4";
    modelFilter.dispatchEvent({ type: "change", target: modelFilter });
    assert.strictEqual(
      dashSr.querySelector('[data-testid="maomao-heatmap-53w"]'),
      heatmapElBefore,
      "changing model filter must NOT rebuild heatmap"
    );
    const filteredRows = dashSr.querySelectorAll("tr.log-row");
    assert.equal(filteredRows.length, 1);
    assert.match(filteredRows[0].textContent, /Claude Sonnet 4/);
    filteredRows[0].click();
    assert.match(dashSr.querySelector('[data-testid="maomao-call-detail"]').textContent, /rate_limit_exceeded/);

    // Client-side 30s range cache: switching today -> all reuses cached "all" without duplicate fetch!
    const usageFetchesBefore = fetchCalls.filter((u) => u.includes("/api/maomao/usage")).length;
    dashSr.querySelector('[data-range="today"]').click();
    await new Promise((r) => setTimeout(r, 10));
    const usageFetchesAfterToday = fetchCalls.filter((u) => u.includes("/api/maomao/usage")).length;
    assert.equal(usageFetchesAfterToday, usageFetchesBefore + 1, "uncached range fetches once");
    dashSr.querySelector('[data-range="all"]').click();
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(
      fetchCalls.filter((u) => u.includes("/api/maomao/usage")).length,
      usageFetchesAfterToday,
      "returning to cached range within 30s must hit client cache with 0 network calls"
    );

    // Popover signature dedup: repeated identical poll must NOT recreate <canvas>
    dom.window.__agyMaomaoTelemetryBar.openPopover();
    const canvasBeforePoll = dom.body.querySelector("#agy-maomao-telemetry-popover-host").shadowRoot.querySelector('[data-role="vial-canvas"]');
    await dom.window.__agyMaomaoTelemetryBar.refresh();
    const canvasAfterPoll = dom.body.querySelector("#agy-maomao-telemetry-popover-host").shadowRoot.querySelector('[data-role="vial-canvas"]');
    assert.strictEqual(canvasAfterPoll, canvasBeforePoll, "identical telemetry poll must NOT recreate vial <canvas>");

    // Verify 4-surface-state switching: dark -> glass-dark -> glass-light -> light
    dom.document.documentElement.classList.add("agy-dream-active-v2");
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().surfaceMode, "glass-dark");
    dom.window.__agyMaomaoTelemetryBar.openPopover();
    const glassPopCss = dom.body.querySelector("#agy-maomao-telemetry-popover-host").shadowRoot.querySelector("style").textContent;
    assert.match(glassPopCss, /blur\(12px\)\s*saturate\(140%\)/, "glass popover must use lightweight single-layer blur(12px) saturate(140%)");
    assert.match(glassPopCss, /contain:\s*layout style/, "popover must declare contain: layout style");
    dom.document.documentElement.classList.remove("dark");
    dom.document.documentElement.setAttribute("data-theme", "light");
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().surfaceMode, "glass-light");
    dom.document.documentElement.classList.remove("agy-dream-active-v2");
    assert.equal(dom.window.__agyMaomaoTelemetryBar.status().surfaceMode, "light");
    dom.window.__agyMaomaoTelemetryBar.openPopover();
    const lightPopCss = dom.body.querySelector("#agy-maomao-telemetry-popover-host").shadowRoot.querySelector("style").textContent;
    assert.match(lightPopCss, /rgba\(255,\s*255,\s*255,\s*0\.98\)/, "pure light popover uses crisp porcelain white");
    assert.match(lightPopCss, /backdrop-filter:\s*none/, "pure light popover disables glass blur");
    dom.document.documentElement.removeAttribute("data-theme");
    dom.document.documentElement.classList.add("dark");

    // Destroy cleans up 100% of DOM, timers, rAF, listeners, and global handle
    dom.window.__agyMaomaoTelemetryBar.destroy();
    assert.equal(dom.window.__agyMaomaoTelemetryBar, undefined);
    assert.equal(dom.body.querySelector("#agy-maomao-telemetry-host"), null);
    assert.equal(dom.body.querySelector("#agy-maomao-telemetry-popover-host"), null);
    assert.equal(dom.body.querySelector("#agy-maomao-dashboard-host"), null);
    assert.equal(dom.getPendingRafCount(), 0);
    assert.equal(dom.getActiveIntervalCount(), 0);
    assert.equal(dom.getDocListenerCount(), 0);
    assert.equal(dom.getWinListenerCount(), 0);
  } finally {
    dom.restore();
  }
});

// =========================================================================
// 4. Effort Slider: Real Antigravity model-selector-panel + Fiber, Starlight wide capsule, Crystal Orchestrator/Locked, Memory & Destroy
// =========================================================================
test("effort-slider mounts in real Antigravity model-selector-panel via React Fiber, commits effort live without closing menu, remembers per model, renders crystal Orchestrator/locked bar, and destroys cleanly", () => {
  const dom = createDomHarness();
  dom.install();
  try {
    // Build authentic Antigravity `[data-testid="model-selector-panel"]` + React Fiber tree
    const modelTrigger = dom.makeElement("button", {
      attrs: { "data-testid": "model-selector-trigger", "data-model-label": "Gemini 4 Neon Medium" },
      textContent: "Gemini 4 Neon Medium",
    });
    dom.body.append(modelTrigger);

    const modelOptions = [
      { label: "Gemini 4 Neon (Low)", value: 1534, modelId: "gemini-4-neon-low" },
      { label: "Gemini 4 Neon (Medium)", value: 1533, modelId: "gemini-4-neon-medium" },
      { label: "Gemini 4 Neon (High)", value: 1532, modelId: "gemini-4-neon-high" },
      { label: "Gemini 4 Neon (XHigh)", value: 1535, modelId: "gemini-4-neon-xhigh" },
      { label: "Gemini 4 Carbon (Low)", value: 1438, modelId: "gemini-4-carbon-low" },
      { label: "Gemini 4 Carbon (Medium)", value: 1437, modelId: "gemini-4-carbon-medium" },
      { label: "Gemini 4 Carbon (High)", value: 1427, modelId: "gemini-4-carbon-high" },
      { label: "Orchestrator (Neon)", value: 1537, modelId: "gemini-pro-orchestrator-neon" },
      { label: "Claude Sonnet 4.6 (Thinking)", value: 1035, modelId: "claude-sonnet-4-6" },
    ];
    const effortIndex = new Map([
      [
        "gemini-4-neon",
        new Map([
          ["low", modelOptions[0]],
          ["medium", modelOptions[1]],
          ["high", modelOptions[2]],
          ["xhigh", modelOptions[3]],
        ]),
      ],
      [
        "gemini-4-carbon",
        new Map([
          ["low", modelOptions[4]],
          ["medium", modelOptions[5]],
          ["high", modelOptions[6]],
        ]),
      ],
    ]);

    let currentSelected = modelOptions[1]; // Gemini 4 Neon (Medium)
    let popoverOpenState = true;
    const unwrappedCommits = [];
    let innerCloseCalls = 0;

    // Inner Popover wraps setSelectedModel with setIsOpen(false); Outer Popover has the pure unwrapped setter!
    const outerPopoverProps = {
      modelOptions,
      get selectedModel() { return currentSelected; },
      setSelectedModel(opt) {
        currentSelected = opt;
        unwrappedCommits.push(opt.label);
      },
      setIsOpen(v) { popoverOpenState = Boolean(v); },
      open: true,
      orchestratorPick: { model: 0, select() {} },
    };
    const innerPopoverProps = {
      modelOptions,
      get selectedModel() { return currentSelected; },
      setSelectedModel(opt) {
        innerCloseCalls++;
        currentSelected = opt;
        popoverOpenState = false;
      },
      setIsOpen(v) { popoverOpenState = Boolean(v); },
      open: true,
    };
    const providerFiber = {
      memoizedProps: {
        value: {
          effortIndex,
          modelOptions,
          get selectedModel() { return currentSelected; },
          setSelectedModel: innerPopoverProps.setSelectedModel,
          setIsOpen: innerPopoverProps.setIsOpen,
        },
      },
      return: {
        memoizedProps: innerPopoverProps,
        return: {
          memoizedProps: outerPopoverProps,
          return: {
            memoizedProps: { conversationId: "conv-alpha-001", orchestratorPickable: true },
            return: null,
          },
        },
      },
    };

    const panel = dom.makeElement("div", { attrs: { "data-testid": "model-selector-panel" } });
    panel["__reactFiber$mock"] = { memoizedProps: {}, return: providerFiber };

    const listWrap = dom.makeElement("div");
    const neonRow = dom.makeElement("div", { attrs: { role: "menuitem", "aria-haspopup": "menu" } });
    const neonSpan = dom.makeElement("span", {
      attrs: { "data-testid": "model-selector-effort-group", "data-model-base": "Gemini 4 Neon" },
      textContent: "Gemini 4 Neon",
    });
    const neonTierBadge = dom.makeElement("span", { textContent: "Medium" });
    neonRow.append(neonSpan, neonTierBadge);

    const carbonRow = dom.makeElement("div", { attrs: { role: "menuitem", "aria-haspopup": "menu" } });
    const carbonSpan = dom.makeElement("span", {
      attrs: { "data-testid": "model-selector-effort-group", "data-model-base": "Gemini 4 Carbon" },
      textContent: "Gemini 4 Carbon",
    });
    const carbonTierBadge = dom.makeElement("span", { textContent: "Medium" });
    carbonRow.append(carbonSpan, carbonTierBadge);

    const orchRow = dom.makeElement("div", {
      attrs: { role: "menuitem", "data-testid": "model-selector-orchestrator", "data-model-label": "Orchestrator" },
    });
    const orchSub = dom.makeElement("span", {
      attrs: { "data-testid": "model-selector-orchestrator-model" },
      textContent: "Gemini 4 Neon High",
    });
    orchRow.append(orchSub);

    const claudeRow = dom.makeElement("div", {
      attrs: { role: "menuitem", "data-testid": "model-selector-item", "data-model-label": "Claude Sonnet 4.6 (Thinking)" },
      textContent: "Claude Sonnet 4.6 (Thinking)",
    });

    listWrap.append(neonRow, carbonRow, orchRow, claudeRow);
    const usageSep = dom.makeElement("div", { attrs: { role: "separator" } });
    const usageWrap = dom.makeElement("div", { textContent: "查看用量明细" });
    panel.append(listWrap, usageSep, usageWrap);
    dom.body.append(panel);

    assert.equal(EFFORT_SLIDER_REV, 5);
    // Verify stale rev:4 hot-upgrade
    let staleDestroyed = 0;
    dom.window.__agyMaomaoEffortSlider = { owner: "test-owner", rev: 4, destroy() { staleDestroyed++; } };

    const st = installEffortSlider({
      owner: "test-owner",
      effortSlider: { enabled: true, rememberPerModel: true, crystalOrchestrator: true },
    });
    assert.equal(staleDestroyed, 1, "EFFORT_SLIDER_REV=5 must replace stale rev:4 instance");
    assert.equal(st.applied, true);
    assert.equal(st.rev, 5);
    assert.equal(st.surfaceMode, "dark");
    assert.equal(st.mountedCount, 1);
    assert.deepEqual(st.modes, ["starlight"]);

    // Section must sit right between model list (index 0) and View Usage separator (index 2)
    const section = panel.querySelector('[data-maomao-effort-section="1"]');
    assert.ok(section, "effort section mounted inside real model-selector-panel");
    assert.equal(panel.children.indexOf(section), 1, "effort section mounts between model list and View Usage separator");
    assert.ok(panel.classList.contains("maomao-effort-panel-enhanced"));

    const card = section.querySelector('[data-maomao-effort="starlight"]');
    assert.ok(card, "starlight wide capsule card mounted for Gemini 4 Neon");
    assert.equal(card.querySelector(".maomao-effort-title").textContent, "推理等级");
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Medium");
    assert.equal(card.querySelectorAll(".maomao-effort-stop").length, 4, "Gemini 4 Neon has 4 tiers (Low/Medium/High/Extra High)");
    assert.ok(card.querySelector('[data-testid="maomao-starfield"]'), "single-layer SVG starfield rendered");
    assert.ok(card.querySelectorAll(".maomao-star").length >= 10, "nebula capsule renders crisp starfield");

    // Performance & Settings isolation regressions (#70 + #71):
    // 1. ZERO nested backdrop-filter on .maomao-effort-card
    // 2. ZERO will-change GPU layer bloat
    // 3. NEVER hide orchestrator-picker-effort anywhere!
    // 4. model-selector-effort-option hide rule MUST be strictly scoped to body:has([data-testid="model-selector-panel"].maomao-effort-panel-enhanced)
    const sliderCss = dom.head.querySelector("#agy-maomao-effort-slider-style")?.textContent || "";
    assert.match(sliderCss, /height:\s*26px/, "capsule track must be wide 26px pill");
    assert.doesNotMatch(sliderCss, /backdrop-filter/, "effort card must NOT stack nested backdrop-filter over model panel");
    assert.doesNotMatch(sliderCss, /will-change/, "starfield must NOT create per-star will-change GPU layers");
    assert.doesNotMatch(sliderCss, /orchestrator-picker-effort/, "must NEVER hide orchestrator-picker-effort in Settings or menu");
    assert.match(
      sliderCss,
      /body:has\(\[data-testid="model-selector-panel"\]\.maomao-effort-panel-enhanced\)\s+\[role="menu"\]:has\(\[data-testid="model-selector-effort-option"\]\)/,
      "model-selector-effort-option suppression must be strictly scoped to enhanced composer panel"
    );
    assert.match(sliderCss, /outline:\s*none\s*!important/, "CSS must prevent Radix/Base UI focus box");

    // Hover mutations inside an already-mounted panel must NOT schedule rescans / Fiber walks!
    const timeoutsBeforeHover = dom.getActiveTimeoutCount();
    dom.triggerMutations([{ type: "childList", target: carbonRow }]);
    assert.equal(dom.getActiveTimeoutCount(), timeoutsBeforeHover, "hovering rows inside mounted panel must schedule 0 rescans");

    // Drag across hysteresis threshold -> commits live via unwrapped outer setter WITHOUT closing menu!
    const trackWrap = card.querySelector(".maomao-effort-track-wrap");
    trackWrap.rect = { left: 0, top: 0, width: 326, height: 26, right: 326, bottom: 26 }; // usable = 300px (13..313)
    // Start inside hysteresis deadband for Medium (index 1, center=100+13=113; x=168 -> pct=0.517 -> stays Medium!)
    trackWrap.dispatchEvent({ type: "pointerdown", clientX: 168, pointerId: 1 });
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Medium");
    assert.equal(unwrappedCommits.length, 0);
    // Drag to x=305 (pct=0.973) -> commits Extra High LIVE during pointermove!
    trackWrap.dispatchEvent({ type: "pointermove", clientX: 305, pointerId: 1 });
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Extra High");
    assert.equal(card.getAttribute("data-tier-max"), "1");
    assert.deepEqual(unwrappedCommits, ["Gemini 4 Neon (XHigh)"]);
    assert.equal(innerCloseCalls, 0, "must call outermost unwrapped setSelectedModel, never inner menu-closing wrapper");
    assert.equal(popoverOpenState, true, "dragging effort slider must keep model menu open");
    trackWrap.dispatchEvent({ type: "pointerup", clientX: 305, pointerId: 1 });

    // Verify per-model memory persisted in localStorage with exact English label
    const mem = dom.window.__agyMaomaoEffortSlider.getMemory();
    assert.equal(mem["Gemini 4 Neon"], "Extra High");

    // Click Gemini 4 Carbon row inside panel -> switches model without closing menu & adapts to 3 tiers!
    carbonRow.click();
    assert.equal(popoverOpenState, true, "clicking model row inside panel keeps menu open");
    assert.equal(currentSelected.label, "Gemini 4 Carbon (Medium)");
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Medium");
    assert.equal(card.querySelectorAll(".maomao-effort-stop").length, 3, "Gemini 4 Carbon has 3 tiers (Low/Medium/High)");

    // Click Gemini 4 Neon row again -> restores remembered "Extra High" tier automatically!
    neonRow.click();
    assert.equal(currentSelected.label, "Gemini 4 Neon (XHigh)");
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Extra High");

    // Clicking Orchestrator & single-tier rows commits cleanly via verified outer setter (immune to hidden submenus)
    orchRow.click();
    assert.equal(currentSelected.label, "Orchestrator (Neon)");
    assert.equal(card.getAttribute("data-maomao-effort"), "crystal");
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Auto");
    assert.ok(card.querySelector('[data-testid="maomao-crystal-bar"]'), "crystal bar rendered for Orchestrator");
    assert.ok(card.querySelector(".maomao-crystal-lock"), "crystal bar displays right-side padlock icon");
    assert.match(card.querySelector(".maomao-effort-sub").textContent, /Gemini 4 Neon/);

    claudeRow.click();
    assert.equal(currentSelected.label, "Claude Sonnet 4.6 (Thinking)");
    assert.equal(card.getAttribute("data-maomao-effort"), "crystal");
    assert.equal(card.getAttribute("data-locked"), "1");
    assert.equal(card.querySelector('[data-testid="maomao-effort-value"]').textContent, "Thinking");

    // Verify Settings-owned model-selector-panel (no conversationId, closed composer trigger) is NOT hijacked!
    const settingsPanel = dom.makeElement("div", { attrs: { "data-testid": "model-selector-panel" } });
    settingsPanel["__reactFiber$mock"] = {
      memoizedProps: { value: { effortIndex, modelOptions, selectedModel: modelOptions[1] } },
      return: null,
    };
    dom.body.append(settingsPanel);
    dom.window.__agyMaomaoEffortSlider.rescan();
    assert.equal(
      settingsPanel.querySelector('[data-maomao-effort-section="1"]'),
      null,
      "Settings-owned model-selector-panel (without conversationId or open composer trigger) must remain 100% native"
    );
    settingsPanel.remove();

    // Verify external slider polite yield in auto mode
    const ext = dom.makeElement("div", { className: "ces-ag-section" });
    dom.body.append(ext);
    dom.window.__agyMaomaoEffortSlider.rescan();
    assert.equal(dom.window.__agyMaomaoEffortSlider.status().yielded, true);
    assert.equal(panel.querySelector('[data-maomao-effort-section="1"]'), null);
    ext.remove();
    dom.window.__agyMaomaoEffortSlider.rescan();
    assert.ok(panel.querySelector('[data-maomao-effort-section="1"]'));

    // Destroy cleans up style, panel class, listeners, and global handle
    dom.window.__agyMaomaoEffortSlider.destroy();
    assert.equal(dom.window.__agyMaomaoEffortSlider, undefined);
    assert.equal(panel.classList.contains("maomao-effort-panel-enhanced"), false);
    assert.equal(panel.querySelector('[data-maomao-effort-section="1"]'), null);
    assert.equal(dom.head.querySelector("#agy-maomao-effort-slider-style"), null);
    assert.equal(dom.getDocListenerCount(), 0);
  } finally {
    dom.restore();
  }
});

// =========================================================================
// 5. Composer Beam: 6 palettes, 0fps idle, working fade-in/out, clockwise quota halo cross-fade & destroy
// =========================================================================
test("composer-beam stays 0fps while idle, animates on working state, cross-fades quota halo, and destroys cleanly", () => {
  const dom = createDomHarness();
  dom.install();
  try {
    const composer = dom.makeElement("div", {
      className: "surface-composer",
      rect: { left: 20, top: 500, width: 640, height: 110, right: 660, bottom: 610 },
    });
    const card = dom.makeElement("div", {
      className: "surface-composer-card",
      rect: { left: 20, top: 500, width: 640, height: 110, right: 660, bottom: 610 },
    });
    composer.append(card);
    dom.body.append(composer);

    assert.equal(COMPOSER_BEAM_REV, 3);
    assert.equal(TELEMETRY_BAR_REV, 8);
    // Simulate stale rev:2 instance to confirm rev:3 hot-upgrade replaces it cleanly
    let oldBeamDestroyed = 0;
    dom.window.__agyMaomaoComposerBeam = { owner: "test-owner", rev: 2, destroy() { oldBeamDestroyed++; } };

    const st = installComposerBeam({
      owner: "test-owner",
      composerBeam: { enabled: true, palette: "star-neko", quotaHalo: true },
    });
    assert.equal(oldBeamDestroyed, 1, "COMPOSER_BEAM_REV=3 must hot-replace stale rev:2 instance");
    assert.equal(st.applied, true);
    assert.equal(st.rev, 3);
    assert.equal(st.surfaceMode, "dark");
    assert.equal(st.mountedCards, 1);
    assert.ok(st.coreLineWidth >= 1.25 && st.coreLineWidth <= 1.75, "core line width must be razor-fine 1.25..1.75px");
    assert.ok(st.outerHaloPx >= 2 && st.outerHaloPx <= 3, "outer micro-halo must stay within 2..3px");
    assert.equal(st.rgbSpectrum, true, "default working beam must run continuous RGB spectrum");
    assert.match(installComposerBeam.toString(), /vec3 rgbSpectrum\(float t,\s*float darkMode\)/, "shader must implement dark/light-tuned continuous RGB spectrum");
    assert.equal(st.palettes.length, 6);
    assert.deepEqual(st.palettes, ["star-neko", "gemini", "aurora", "prism", "neon", "quota"]);

    // Idle state: 0fps (zero active rAFs!)
    assert.equal(st.working, false);
    assert.equal(dom.getPendingRafCount(), 0, "must remain 0fps while idle");

    // Mounted on .surface-composer wrapper (outside .surface-composer-card overflow:hidden!)
    const beamRoot = composer.querySelector('[data-maomao-composer-beam="1"]');
    assert.ok(beamRoot);
    assert.equal(beamRoot.parentElement, composer);

    // Supply quota -> clockwise halo renders green (ok), then amber (warning), then red (critical)
    dom.window.__agyMaomaoComposerBeam.setQuota({ fraction: 0.76, window: "5h" });
    const halo = beamRoot.querySelector('[data-testid="maomao-composer-quota-halo"]');
    assert.equal(halo.getAttribute("data-tone"), "ok");
    assert.equal(halo.getAttribute("data-percent"), "76");
    assert.equal(halo.getAttribute("data-dimmed"), null);

    dom.window.__agyMaomaoComposerBeam.setQuota({ fraction: 0.35, window: "weekly" });
    assert.equal(halo.getAttribute("data-tone"), "warning");
    dom.window.__agyMaomaoComposerBeam.setQuota({ fraction: 0.12, window: "5h" });
    assert.equal(halo.getAttribute("data-tone"), "critical");

    // Activate working state -> beam starts animating & quota halo dims (cross-fade, no clash!)
    dom.window.__agyMaomaoComposerBeam.setWorking(true);
    assert.equal(dom.window.__agyMaomaoComposerBeam.status().working, true);
    assert.equal(dom.getPendingRafCount(), 1);
    assert.equal(halo.getAttribute("data-dimmed"), "true");

    // Step several frames while active
    for (let t = 16; t <= 160; t += 16) dom.flushRaf(t);
    const canvas = beamRoot.querySelector('[data-testid="maomao-composer-working-beam"]');
    assert.equal(canvas.getAttribute("data-active"), "true");
    assert.ok(canvas._ctx2d.calls.includes("stroke"), "Canvas 2D fallback draws rotating RGB border segments");
    assert.ok(canvas._ctx2d.lineWidth >= 1.25 && canvas._ctx2d.lineWidth <= 1.75, "Canvas 2D lineWidth stays razor-fine 1.25..1.75px");
    assert.ok(canvas._ctx2d.shadowBlur >= 2 && canvas._ctx2d.shadowBlur <= 3, "Canvas 2D outer micro-halo stays 2..3px");

    // Stop working -> halo un-dims and beam fades smoothly back to 0fps hibernation!
    dom.window.__agyMaomaoComposerBeam.setWorking(false);
    assert.equal(halo.getAttribute("data-dimmed"), null);
    let ts = 200;
    for (let i = 0; i < 60; i++) {
      ts += 32;
      dom.flushRaf(ts);
      if (dom.getPendingRafCount() === 0) break;
    }
    assert.equal(dom.getPendingRafCount(), 0, "working beam must hibernate back to 0fps after fade-out");
    assert.equal(canvas.getAttribute("data-active"), "false");

    // Verify editable-area MutationObserver fast-filter: typing/backspace in Lexical editor schedules 0 rescans!
    const lexicalEditor = dom.makeElement("div", { attrs: { "data-lexical-editor": "true", contenteditable: "true" } });
    const textSpan = dom.makeElement("span", { textContent: "hello" });
    lexicalEditor.append(textSpan);
    card.append(lexicalEditor);
    const beforeTimeouts = dom.getActiveTimeoutCount();
    dom.triggerMutations([{ type: "childList", target: textSpan }, { type: "characterData", target: lexicalEditor }]);
    assert.equal(dom.getActiveTimeoutCount(), beforeTimeouts, "composer-beam MutationObserver must skip editable mutations with 0 timers");

    // Verify drawFrame performs zero layout reads (getBoundingClientRect/getComputedStyle)
    const beamSrc = installComposerBeam.toString();
    const drawStart = beamSrc.indexOf("function drawFrame");
    const drawEnd = beamSrc.indexOf("function sync()", drawStart);
    const drawBody = beamSrc.slice(drawStart, drawEnd);
    assert.doesNotMatch(drawBody, /getBoundingClientRect|getComputedStyle/, "rAF drawFrame must not force layout reflow");

    // Destroy cleans up everything cleanly
    dom.window.__agyMaomaoComposerBeam.destroy();
    assert.equal(dom.window.__agyMaomaoComposerBeam, undefined);
    assert.equal(composer.querySelector('[data-maomao-composer-beam="1"]'), null);
    assert.equal(dom.head.querySelector("#agy-maomao-composer-beam-style"), null);
    assert.equal(dom.getPendingRafCount(), 0);
    assert.equal(dom.getActiveIntervalCount(), 0);
    assert.equal(dom.getDocListenerCount(), 0);
  } finally {
    dom.restore();
  }
});
