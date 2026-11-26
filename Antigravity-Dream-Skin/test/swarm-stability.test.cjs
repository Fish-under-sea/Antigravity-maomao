"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const { installTheme, installPluginFrameTheme } = require("../src/host/theme.cjs");

function createFrameDomStub({ initialTheme = "light", computedVars = {} } = {}) {
  const attrs = new Map();
  if (initialTheme !== null) attrs.set("data-theme", initialTheme);
  const classes = new Set();
  const inlineVars = new Map();
  const headChildren = [];
  const observers = [];

  const docEl = {
    classList: {
      add(...cs) { cs.forEach((c) => classes.add(c)); },
      remove(...cs) { cs.forEach((c) => classes.delete(c)); },
      contains(c) { return classes.has(c); },
    },
    style: {
      setProperty(k, v, p = "") { inlineVars.set(k, { value: String(v), priority: p }); },
      getPropertyValue(k) { return inlineVars.get(k)?.value || ""; },
      getPropertyPriority(k) { return inlineVars.get(k)?.priority || ""; },
      removeProperty(k) { inlineVars.delete(k); },
    },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
    hasAttribute(k) { return attrs.has(k); },
    setAttribute(k, v) { attrs.set(k, String(v)); },
    removeAttribute(k) { attrs.delete(k); },
  };

  const head = {
    children: headChildren,
    appendChild(node) {
      node.isConnected = true;
      node.parentElement = head;
      if (!headChildren.includes(node)) headChildren.push(node);
      return node;
    },
  };

  const boardProps = {};
  const boardEl = {
    style: {
      setProperty(k, v) { boardProps[k] = v; },
      removeProperty(k) { delete boardProps[k]; },
    },
  };
  const headerEl = {
    getBoundingClientRect() { return { height: 76.66667 }; },
  };

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      observers.push(this);
    }
    observe() { this.active = true; }
    disconnect() { this.active = false; }
    trigger() { if (this.active) this.cb([]); }
  }
  class MockResizeObserver {
    observe() {}
    disconnect() {}
  }

  const orig = {
    window: global.window,
    document: global.document,
    getComputedStyle: global.getComputedStyle,
    MutationObserver: global.MutationObserver,
    ResizeObserver: global.ResizeObserver,
  };

  function install() {
    global.window = { devicePixelRatio: 1.5 };
    global.document = {
      readyState: "complete",
      head,
      documentElement: docEl,
      getElementById(id) {
        if (id === "board") return boardEl;
        return headChildren.find((n) => n.id === id) || null;
      },
      querySelector(sel) {
        if (sel === ".header") return headerEl;
        return null;
      },
      createElement(tag) {
        const node = {
          tagName: tag.toUpperCase(),
          id: "",
          textContent: "",
          isConnected: false,
          parentElement: null,
          remove() {
            node.isConnected = false;
            const i = headChildren.indexOf(node);
            if (i >= 0) headChildren.splice(i, 1);
          },
        };
        return node;
      },
    };
    global.getComputedStyle = () => ({
      getPropertyValue(k) {
        if (inlineVars.has(k)) return inlineVars.get(k).value;
        return computedVars[k] || "";
      },
    });
    global.MutationObserver = MockMutationObserver;
    global.ResizeObserver = MockResizeObserver;
  }

  function restore() {
    Object.assign(global, orig);
  }

  return {
    install,
    restore,
    docEl,
    head,
    headChildren,
    inlineVars,
    boardProps,
    observers,
  };
}

test("installTheme and installPluginFrameTheme remain CDP-serializable with THEME_REV=27 and FRAME_REV=5", () => {
  for (const fn of [installTheme, installPluginFrameTheme]) {
    const src = fn.toString();
    assert.doesNotMatch(src, /\brequire\s*\(/);
    const compiled = new vm.Script("(" + src + ")").runInNewContext({});
    assert.equal(typeof compiled, "function");
  }
  assert.match(installTheme.toString(), /const THEME_REV = 27;/);
  assert.match(installPluginFrameTheme.toString(), /const FRAME_REV = 5;/);
});

test("installPluginFrameTheme heals white-flash (hostDark=true with data-theme=light & empty --foreground), preserves gapPx=0, and restores verbatim on destroy()", () => {
  const stub = createFrameDomStub({ initialTheme: "light", computedVars: {} });
  stub.install();
  try {
    const res = installPluginFrameTheme({
      owner: "swarm-owner",
      hostDark: true,
      hostTokens: {
        "--foreground": "#f3edfc",
        "--secondary-foreground": "#d9cef0",
        "--muted-foreground": "#a59bb8",
        "--border": "rgba(174, 142, 218, 0.28)",
        "--card-border": "rgba(174, 142, 218, 0.24)",
        "--primary": "#c084fc",
        "--secondary": "rgba(255, 255, 255, 0.08)",
        "--muted": "rgba(255, 255, 255, 0.05)",
        "--placeholder": "#9c8fb8",
      },
      glass: { themeStyle: "star-neko", radius: 16, regions: { content: { fill: 60 }, header: { fill: 84 } } },
    });
    assert.equal(res.applied, true);
    assert.equal(res.rev, 5);
    assert.equal(global.window.__agyDreamPluginFrameV2.rev, 5);

    // Repaired data-theme from "light" -> "dark" and populated host tokens
    assert.equal(stub.docEl.getAttribute("data-theme"), "dark");
    assert.equal(stub.inlineVars.get("--foreground")?.value, "#f3edfc");
    assert.equal(stub.inlineVars.get("--border")?.value, "rgba(174, 142, 218, 0.28)");
    assert.equal(stub.inlineVars.get("--primary")?.value, "#c084fc");

    // Seamless header + full-width toolbar + exact --agy-header-h preserved without regression
    const css = stub.headChildren[0]?.textContent || "";
    assert.equal(stub.boardProps["--agy-header-h"], (Math.floor(76.66667 * 1.5) / 1.5) + "px");
    assert.match(css, /rgba\(22, 18, 34,/); // Dark body tint, never white flash!
    assert.match(css, /\.board:has\(#tab-feed\.active\)\s*\.header\s*\{[\s\S]*border-bottom:\s*0\s*!important/);
    assert.match(css, /#tab-feed\s*>\s*\.toolbar\s*\{[\s\S]*top:\s*var\(--agy-header-h/);
    assert.match(css, /width:\s*100%\s*!important/);

    // destroy() restores original data-theme="light" and removes all injected inline tokens
    global.window.__agyDreamPluginFrameV2.destroy();
    assert.equal(global.window.__agyDreamPluginFrameV2, undefined);
    assert.equal(stub.docEl.getAttribute("data-theme"), "light");
    assert.equal(stub.inlineVars.size, 0);
    assert.equal(stub.headChildren.length, 0);
    assert.equal(stub.docEl.classList.contains("agy-dream-plugin-frame-v2"), false);
    assert.equal(stub.boardProps["--agy-header-h"], undefined);
  } finally {
    stub.restore();
  }
});

test("installPluginFrameTheme MutationObserver self-heals removed style, stripped html class, and light-theme flip without flicker", async () => {
  const stub = createFrameDomStub({ initialTheme: "light", computedVars: { "--foreground": "#111827" } });
  stub.install();
  try {
    installPluginFrameTheme({
      owner: "heal-owner",
      hostDark: true,
      hostTokens: { "--foreground": "#f5f0ff" },
      glass: { themeStyle: "star-neko", radius: 16, regions: { content: { fill: 60 }, header: { fill: 84 } } },
    });
    assert.equal(stub.headChildren.length, 1);
    assert.equal(stub.docEl.getAttribute("data-theme"), "dark");
    assert.equal(stub.inlineVars.get("--foreground")?.value, "#f5f0ff");

    // Simulate Swarm reload / framework wiping style, class, and flipping data-theme back to light
    stub.headChildren[0].remove();
    stub.docEl.classList.remove("agy-dream-plugin-frame-v2");
    stub.docEl.setAttribute("data-theme", "light");
    assert.equal(stub.headChildren.length, 0);

    for (const obs of stub.observers) obs.trigger();
    await new Promise((r) => setTimeout(r, 35));

    assert.equal(stub.headChildren.length, 1, "style#agy-dream-plugin-frame-v2 must self-heal");
    assert.equal(stub.docEl.classList.contains("agy-dream-plugin-frame-v2"), true, "html class must self-heal");
    assert.equal(stub.docEl.getAttribute("data-theme"), "dark", "data-theme must self-heal back to dark");

    global.window.__agyDreamPluginFrameV2.destroy();
    assert.equal(stub.observers.every((o) => !o.active), true, "MutationObserver disconnects on destroy");
  } finally {
    stub.restore();
  }
});

test("installTheme REV 26 uses single-layer Swarm backdrop (blur(12px) in smooth-video, none during split animation), forbids sidecar-iframe-slot blur, and hot-updates without destroy()", async () => {
  function makeEl(tag) {
    const attrs = new Map();
    const children = [];
    const classes = new Set();
    const el = {
      tagName: tag.toUpperCase(),
      id: "",
      textContent: "",
      children,
      isConnected: true,
      parentElement: null,
      style: {
        _props: {},
        setProperty(k, v) { this._props[k] = v; },
        getPropertyValue(k) { return this._props[k] || ""; },
        getPropertyPriority() { return ""; },
        removeProperty(k) { delete this._props[k]; },
      },
      setAttribute(k, v) { if (k === "id") el.id = v; attrs.set(k, String(v)); },
      getAttribute(k) { return attrs.get(k) ?? null; },
      hasAttribute(k) { return attrs.has(k); },
      removeAttribute(k) { attrs.delete(k); },
      addEventListener() {},
      removeEventListener() {},
      append(...nodes) { for (const n of nodes) { n.parentElement = el; n.isConnected = true; children.push(n); } },
      prepend(...nodes) { for (const n of nodes) { n.parentElement = el; n.isConnected = true; children.unshift(n); } },
      remove() { el.isConnected = false; if (el.parentElement) { const i = el.parentElement.children.indexOf(el); if (i >= 0) el.parentElement.children.splice(i, 1); } },
      matches() { return false; },
      closest() { return null; },
      contains(target) { return target === el || children.some((c) => c.contains?.(target)); },
      querySelector(sel) { return sel === "#root" ? rootEl : null; },
      querySelectorAll() { return []; },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1280, height: 720, right: 1280, bottom: 720 }; },
      play() { return Promise.resolve(); },
      pause() {},
      load() {},
      classList: {
        add(...cs) { cs.forEach((c) => classes.add(c)); },
        remove(...cs) { cs.forEach((c) => classes.delete(c)); },
        contains(c) { return classes.has(c); },
      },
    };
    return el;
  }

  const rootEl = makeEl("div");
  rootEl.id = "root";
  const bodyEl = makeEl("body");
  bodyEl.classList.add("dark");
  bodyEl.append(rootEl);
  const headEl = makeEl("head");
  const docEl = makeEl("html");

  const orig = {
    window: global.window,
    document: global.document,
    getComputedStyle: global.getComputedStyle,
    MutationObserver: global.MutationObserver,
    ResizeObserver: global.ResizeObserver,
    innerWidth: global.innerWidth,
    innerHeight: global.innerHeight,
  };

  try {
    global.window = {};
    global.document = {
      documentElement: docEl,
      head: headEl,
      body: bodyEl,
      hidden: false,
      addEventListener() {},
      removeEventListener() {},
      createElement: (tag) => makeEl(tag),
      querySelector: (sel) => (sel === "#root" ? rootEl : null),
      querySelectorAll: () => [],
    };
    global.getComputedStyle = () => ({ backgroundColor: "rgb(20, 20, 28)", backgroundImage: "none" });
    global.MutationObserver = class { observe() {} disconnect() {} };
    global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
    global.innerWidth = 1280;
    global.innerHeight = 720;

    const cfg = {
      owner: "stable-owner",
      outputMode: "transparent",
      mediaKind: "video",
      mediaUrl: "http://127.0.0.1:45555/media?token=abc&path=clip.mp4",
      videoSmoothMode: true,
      glass: {
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
      },
      font: { accent: "", darkSeparate: false, colors: {}, colorsDark: {} },
    };

    const s1 = await installTheme(cfg);
    assert.equal(s1.applied, true);
    assert.equal(global.window.__agyDreamSkinV2.rev, 27);

    const baseCss = headEl.children.find((c) => c.id === "agy-dream-style-v2")?.textContent || "";
    // Global [role=menu] glass card rule MUST exclude radial pie menu so it never gets a square glass box!
    assert.match(baseCss, /\[role=menu\][\s\S]*?:not\(\[data-agy-maomao-radial="1"\]\)/);
    // No dual-layer ::after + mask-image heavy backdrop on aux-pane-split
    assert.doesNotMatch(baseCss, /\[data-testid="aux-pane-split"\]\s*>\s*div:last-child::after/);
    assert.doesNotMatch(baseCss, /\[data-testid="sidecar-iframe-slot"\]:has\([^)]*\)::(before|after)/);
    // Single-layer ::before with smooth-video blur(12px) (no saturate) and split-animation blur disable
    assert.match(baseCss, /\[data-agy-smooth-video="1"\]:has\([^\n]*plugin:\/\/swarm[^\n]*div:last-child::before\s*\{[\s\S]*?backdrop-filter:\s*blur\(12px\)\s*!important/);
    assert.match(baseCss, /\.agy-dream-animating-split:has\([^\n]*plugin:\/\/swarm[^\n]*div:last-child::before\s*\{[\s\S]*?backdrop-filter:\s*none\s*!important/);

    // Verify same-owner + same-rev hot update NEVER triggers destroy() (prevents black screen flash!)
    let destroyCalls = 0;
    const origDestroy = global.window.__agyDreamSkinV2.destroy;
    global.window.__agyDreamSkinV2.destroy = () => {
      destroyCalls++;
      return origDestroy();
    };
    const s2 = await installTheme({ ...cfg, opacity: 0.72 });
    assert.equal(s2.applied, true);
    assert.equal(destroyCalls, 0, "hot update for same owner & rev must never call destroy()");

    origDestroy();
    assert.equal(global.window.__agyDreamSkinV2, undefined);
  } finally {
    Object.assign(global, orig);
  }
});
