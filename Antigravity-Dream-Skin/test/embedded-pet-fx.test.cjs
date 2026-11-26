const { test } = require("node:test");
const assert = require("node:assert/strict");
const { installEmbeddedPet, EMBEDDED_PET_REV, EMBEDDED_PET_ASSETS } = require("../src/host/modules/embedded-pet.cjs");
const { installMotionFx, MOTION_FX_REV } = require("../src/host/modules/motion-fx.cjs");

function createMockDomEnv(options = {}) {
  const winListeners = new Map();
  const docListeners = new Map();
  const storageMap = new Map();
  const observers = [];
  const audioCalls = [];
  const fetchCalls = [];
  const highlightMap = new Map();
  const rafQueue = new Map();
  let nextRafId = 1;
  let fakeNow = 1000;
  let focused = options.focused !== false;

  function addListener(store, evt, fn) {
    if (!store.has(evt)) store.set(evt, new Set());
    store.get(evt).add(fn);
  }
  function removeListener(store, evt, fn) {
    store.get(evt)?.delete(fn);
  }
  function dispatch(store, evt, payload = {}) {
    const fns = Array.from(store.get(evt) || []);
    for (const fn of fns) {
      fn({ type: evt, preventDefault() {}, stopPropagation() {}, ...payload });
    }
  }
  function countListeners(store) {
    let n = 0;
    for (const set of store.values()) n += set.size;
    return n;
  }

  function matchesSelector(el, rawSel) {
    if (!el || el.nodeType !== 1 || !rawSel) return false;
    const parts = rawSel.split(",").map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      if (part.startsWith("#") && el.id === part.slice(1)) return true;
      if (part.startsWith(".") && el.classList.contains(part.slice(1))) return true;
      const attrExact = /^\[([a-zA-Z0-9_-]+)="([^"]*)"\]$/.exec(part);
      if (attrExact && el.getAttribute(attrExact[1]) === attrExact[2]) return true;
      const attrSub = /^\[([a-zA-Z0-9_-]+)\*="([^"]*)"\]$/.exec(part);
      if (attrSub && String(el.getAttribute(attrSub[1]) || "").includes(attrSub[2])) return true;
      if (part.toUpperCase() === el.tagName) return true;
    }
    return false;
  }

  function makeStyle() {
    const props = {};
    return new Proxy(
      {
        _props: props,
        cssText: "",
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
        set(target, prop, value) {
          target[prop] = value;
          props[String(prop)] = String(value);
          return true;
        },
      }
    );
  }

  function walk(node, fn) {
    for (const child of node.childNodes || []) {
      fn(child);
      walk(child, fn);
    }
  }

  function makeEl(tag, opts = {}) {
    const attrs = new Map();
    const listeners = new Map();
    const childNodes = [];
    let classNames = new Set();
    let shadowRoot = null;
    const el = {
      nodeType: 1,
      tagName: String(tag || "DIV").toUpperCase(),
      id: "",
      textContent: "",
      innerHTML: "",
      src: "",
      disabled: false,
      isConnected: Boolean(opts.connected),
      parentElement: null,
      childNodes,
      get children() {
        return childNodes.filter((n) => n.nodeType === 1);
      },
      get className() {
        return Array.from(classNames).join(" ");
      },
      set className(v) {
        classNames = new Set(String(v || "").split(/\s+/).filter(Boolean));
      },
      classList: {
        add(...cs) {
          for (const c of cs) classNames.add(c);
        },
        remove(...cs) {
          for (const c of cs) classNames.delete(c);
        },
        contains(c) {
          return classNames.has(c);
        },
      },
      style: makeStyle(),
      get shadowRoot() {
        return shadowRoot;
      },
      attachShadow() {
        shadowRoot = makeEl("SHADOW-ROOT", { connected: el.isConnected });
        shadowRoot.host = el;
        return shadowRoot;
      },
      setAttribute(k, v) {
        const s = String(v);
        if (k === "id") el.id = s;
        if (k === "class") el.className = s;
        attrs.set(k, s);
      },
      getAttribute(k) {
        if (k === "id" && el.id) return el.id;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k);
      },
      removeAttribute(k) {
        attrs.delete(k);
      },
      addEventListener(evt, fn) {
        addListener(listeners, evt, fn);
      },
      removeEventListener(evt, fn) {
        removeListener(listeners, evt, fn);
      },
      dispatchEvent(evt, payload = {}) {
        dispatch(listeners, evt, payload);
      },
      setPointerCapture() {},
      releasePointerCapture() {},
      append(...nodes) {
        for (const n of nodes) {
          if (!n) continue;
          n.parentElement = el;
          const setConn = (node, val) => {
            node.isConnected = val;
            for (const c of node.childNodes || []) setConn(c, val);
            if (node.shadowRoot) setConn(node.shadowRoot, val);
          };
          setConn(n, el.isConnected);
          childNodes.push(n);
        }
      },
      appendChild(n) {
        el.append(n);
        return n;
      },
      remove() {
        const setConn = (node, val) => {
          node.isConnected = val;
          for (const c of node.childNodes || []) setConn(c, val);
          if (node.shadowRoot) setConn(node.shadowRoot, val);
        };
        setConn(el, false);
        if (el.parentElement) {
          const i = el.parentElement.childNodes.indexOf(el);
          if (i >= 0) el.parentElement.childNodes.splice(i, 1);
          el.parentElement = null;
        }
      },
      matches(sel) {
        return matchesSelector(el, sel);
      },
      closest(sel) {
        let cur = el;
        while (cur) {
          if (cur.nodeType === 1 && matchesSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelector(sel) {
        let found = null;
        walk(el, (n) => {
          if (!found && n.nodeType === 1 && matchesSelector(n, sel)) found = n;
        });
        return found;
      },
      querySelectorAll(sel) {
        const out = [];
        walk(el, (n) => {
          if (n.nodeType === 1 && matchesSelector(n, sel)) out.push(n);
        });
        return out;
      },
      getBoundingClientRect() {
        return opts.rect || { left: 100, top: 200, width: 300, height: 28, right: 400, bottom: 228 };
      },
    };
    return el;
  }

  function makeTextNode(text) {
    return {
      nodeType: 3,
      nodeValue: String(text || ""),
      parentElement: null,
      isConnected: true,
    };
  }

  const docEl = makeEl("html", { connected: true });
  const headEl = makeEl("head", { connected: true });
  const bodyEl = makeEl("body", { connected: true });
  docEl.append(headEl, bodyEl);

  class MockHighlight {
    constructor(...ranges) {
      this.ranges = ranges;
    }
  }

  class MockAudio {
    constructor(url) {
      this.src = url;
      this.volume = 1;
      this.currentTime = 0;
      this.played = false;
      this.paused = false;
      audioCalls.push(this);
    }
    play() {
      this.played = true;
      return Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }

  class MockMutationObserver {
    constructor(cb) {
      this.cb = cb;
      this.active = false;
      observers.push(this);
    }
    observe() {
      this.active = true;
    }
    disconnect() {
      this.active = false;
    }
  }

  let currentSelection = null;

  const doc = {
    documentElement: docEl,
    head: headEl,
    body: bodyEl,
    title: options.title || "Antigravity Workspace",
    hidden: false,
    activeElement: null,
    hasFocus: () => focused,
    createElement: (tag) => makeEl(tag),
    createTextNode: (t) => makeTextNode(t),
    createRange: () => ({
      startContainer: null,
      startOffset: 0,
      endContainer: null,
      endOffset: 0,
      setStart(n, o) {
        this.startContainer = n;
        this.startOffset = o;
      },
      setEnd(n, o) {
        this.endContainer = n;
        this.endOffset = o;
      },
    }),
    getElementById(id) {
      let found = null;
      walk(docEl, (n) => {
        if (!found && n.nodeType === 1 && n.id === id) found = n;
      });
      return found;
    },
    querySelector: (sel) => docEl.querySelector(sel),
    querySelectorAll: (sel) => docEl.querySelectorAll(sel),
    addEventListener: (evt, fn) => addListener(docListeners, evt, fn),
    removeEventListener: (evt, fn) => removeListener(docListeners, evt, fn),
    dispatchEvent: (evt, payload) => dispatch(docListeners, evt, payload),
  };

  const win = {
    innerWidth: options.width || 1280,
    innerHeight: options.height || 720,
    localStorage: {
      getItem: (k) => (storageMap.has(k) ? storageMap.get(k) : null),
      setItem: (k, v) => storageMap.set(k, String(v)),
      removeItem: (k) => storageMap.delete(k),
    },
    Audio: MockAudio,
    MutationObserver: MockMutationObserver,
    CSS: options.noHighlights ? {} : { highlights: highlightMap },
    Highlight: options.noHighlights ? undefined : MockHighlight,
    performance: { now: () => fakeNow },
    requestAnimationFrame(fn) {
      const id = nextRafId++;
      rafQueue.set(id, fn);
      return id;
    },
    cancelAnimationFrame(id) {
      rafQueue.delete(id);
    },
    getSelection: () => currentSelection,
    fetch: async (url) => {
      fetchCalls.push(url);
      if (typeof options.onFetch === "function") {
        return options.onFetch(url);
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
    addEventListener: (evt, fn) => addListener(winListeners, evt, fn),
    removeEventListener: (evt, fn) => removeListener(winListeners, evt, fn),
    dispatchEvent: (evt, payload) => dispatch(winListeners, evt, payload),
  };

  const origGlobals = {
    window: global.window,
    document: global.document,
    MutationObserver: global.MutationObserver,
    CSS: global.CSS,
    Highlight: global.Highlight,
    Audio: global.Audio,
    requestAnimationFrame: global.requestAnimationFrame,
    cancelAnimationFrame: global.cancelAnimationFrame,
    performance: global.performance,
  };

  global.window = win;
  global.document = doc;
  global.MutationObserver = MockMutationObserver;
  global.CSS = win.CSS;
  global.Highlight = win.Highlight;
  global.Audio = MockAudio;
  global.requestAnimationFrame = win.requestAnimationFrame;
  global.cancelAnimationFrame = win.cancelAnimationFrame;

  return {
    win,
    doc,
    bodyEl,
    headEl,
    docEl,
    storageMap,
    observers,
    audioCalls,
    fetchCalls,
    highlightMap,
    rafQueue,
    makeEl,
    makeTextNode,
    setFocused(val) {
      focused = val;
    },
    setSelection(sel) {
      currentSelection = sel;
    },
    advanceNow(ms) {
      fakeNow += ms;
    },
    flushRaf(stepMs = 80) {
      fakeNow += stepMs;
      const entries = Array.from(rafQueue.entries());
      rafQueue.clear();
      for (const [, fn] of entries) fn(fakeNow);
    },
    triggerMutations(records = []) {
      for (const obs of observers) {
        if (obs.active) obs.cb(records);
      }
    },
    listenerCounts() {
      return {
        window: countListeners(winListeners),
        document: countListeners(docListeners),
      };
    },
    restore() {
      Object.assign(global, origGlobals);
    },
  };
}

// Helper: execute a host install function strictly via Function.prototype.toString() (proving CDP self-containment)
function runSerialized(fn, config) {
  const revived = new Function("return (" + fn.toString() + ")")();
  return revived(config);
}

test("embedded-pet: mounts Shadow DOM via CDP toString(), scales bubble proportionally, falls back gracefully, and cleans up completely", () => {
  const env = createMockDomEnv({ width: 1280, height: 720 });
  try {
    const assetBaseUrl = "http://127.0.0.1:45678/asset?token=tok123&kind=";
    const status = runSerialized(installEmbeddedPet, {
      owner: "pet-test-1",
      assetBaseUrl,
      scale: 120,
      dock: "right",
      opacity: 90,
      soundEnabled: true,
      soundPack: "bubble-pop",
      volume: 80,
      showBubbles: true,
      quipProbability: 1,
    });

    assert.equal(status.applied, true);
    assert.equal(status.rev, EMBEDDED_PET_REV);
    assert.equal(status.scale, 120);
    assert.equal(status.bubbleScale, 1.2);
    assert.ok(env.win.__agyMaomaoPet);

    const host = env.doc.getElementById("agy-maomao-pet-root");
    assert.ok(host, "Shadow DOM host #agy-maomao-pet-root must exist");
    assert.match(host.style.cssText, /position:fixed/);
    assert.match(host.style.cssText, /z-index:2147483000/);
    assert.match(host.style.cssText, /pointer-events:none/);

    const shadow = host.shadowRoot;
    assert.ok(shadow, "Shadow root must be attached");
    const stage = shadow.querySelector(".pet-stage");
    assert.equal(stage.style.getPropertyValue("--pet-scale"), "1.2");
    assert.equal(stage.style.getPropertyValue("--pet-bubble-scale"), "1.2");

    // Verify character frame asset URLs
    const idleImg = shadow.querySelector(".pet-frame--idle");
    const blinkImg = shadow.querySelector(".pet-frame--blink");
    const proudImg = shadow.querySelector(".pet-frame--proud");
    const sadImg = shadow.querySelector(".pet-frame--sad");
    assert.equal(idleImg.src, `${assetBaseUrl}pet&file=idle.png`);
    assert.equal(blinkImg.src, `${assetBaseUrl}pet&file=blink.png`);
    assert.equal(proudImg.src, `${assetBaseUrl}pet&file=proud-v3.png`);
    assert.equal(sadImg.src, `${assetBaseUrl}pet&file=sad-v3.png`);

    // Simulate idle.png load error -> graceful SVG fallback, no broken image crash
    idleImg.dispatchEvent("error");
    assert.equal(stage.getAttribute("data-fallback"), "svg");
    assert.equal(env.win.__agyMaomaoPet.status().fallbackSvg, true);
    // Recover once loaded
    idleImg.dispatchEvent("load");
    assert.equal(stage.getAttribute("data-fallback"), null);

    // Verify REV = 5 and right-dock vs left-dock orientation (exact Antigravity-Cat-Widget parity:
    // native idle.png faces inward-left -> right-dock is unflipped transform:none, left-dock mirrors rotateY(180deg),
    // and bubble/close/text are NEVER mirrored!)
    assert.equal(EMBEDDED_PET_REV, 5);
    assert.equal(status.rev, 5);
    assert.equal(status.snap, true);
    const faceEl = shadow.querySelector(".pet-face");
    const bubbleEl = shadow.querySelector(".pet-bubble");
    const closeBtn = shadow.querySelector(".pet-bubble-close");
    const thinkingDotsEl = shadow.querySelector(".pet-thinking-dots");
    const petCss = shadow.querySelector("style").textContent;
    assert.equal(status.facing, "right");
    assert.equal(status.mirrored, false);
    assert.equal(stage.getAttribute("data-facing"), "right");
    assert.equal(stage.getAttribute("data-mirrored"), "false");
    assert.equal(faceEl.style.transform, "none");
    assert.equal(bubbleEl.style.transform || "", "");
    assert.equal(closeBtn.style.transform || "", "");
    // Right-facing: thinking-dots sits top-right (above lower ear) with unflipped ↙ tail pointing into cat's head
    assert.equal(thinkingDotsEl.style.right, "1%");
    assert.equal(thinkingDotsEl.style.left, "auto");
    assert.equal(thinkingDotsEl.getAttribute("data-tail-dir"), "down-left");
    assert.equal(thinkingDotsEl.getAttribute("data-flipped"), "false");
    assert.match(petCss, /\.pet-stage\[data-facing="left"\]\s+\.pet-thinking-dots\s+svg\s*\{[\s\S]*transform:\s*scaleX\(-1\)/);

    // Switch to dock: "left" -> sprite layer flips rotateY(180deg), bubble stays unflipped,
    // and thinking-dots shifts top-left with flipped ↘ tail still pointing inward at cat's head!
    const leftSt = env.win.__agyMaomaoPet.update({ dock: "left" });
    assert.equal(leftSt.facing, "left");
    assert.equal(leftSt.mirrored, true);
    assert.equal(stage.getAttribute("data-facing"), "left");
    assert.equal(stage.getAttribute("data-mirrored"), "true");
    assert.equal(faceEl.style.transform, "rotateY(180deg)");
    assert.equal(bubbleEl.style.transform || "", "");
    assert.equal(closeBtn.style.transform || "", "");
    assert.equal(thinkingDotsEl.style.left, "1%");
    assert.equal(thinkingDotsEl.style.right, "auto");
    assert.equal(thinkingDotsEl.getAttribute("data-tail-dir"), "down-right");
    assert.equal(thinkingDotsEl.getAttribute("data-flipped"), "true");

    // Switch back to dock: "right" -> sprite layer & thinking-dots restore cleanly
    const rightSt = env.win.__agyMaomaoPet.update({ dock: "right" });
    assert.equal(rightSt.facing, "right");
    assert.equal(rightSt.mirrored, false);
    assert.equal(faceEl.style.transform, "none");
    assert.equal(thinkingDotsEl.style.right, "1%");
    assert.equal(thinkingDotsEl.getAttribute("data-flipped"), "false");

    // Hot update scale down to 60 -> bubble scales proportionally (Issue #1 fix!)
    const updated = env.win.__agyMaomaoPet.update({ scale: 60, soundPack: "wood-tap" });
    assert.equal(updated.scale, 60);
    assert.equal(updated.bubbleScale, 0.6);
    assert.equal(stage.style.getPropertyValue("--pet-bubble-scale"), "0.6");

    // Destroy cleans up DOM, observers, listeners, and global handle
    const res = env.win.__agyMaomaoPet.destroy();
    assert.deepEqual(res, { removed: true });
    assert.equal(env.win.__agyMaomaoPet, undefined);
    assert.equal(env.doc.getElementById("agy-maomao-pet-root"), null);
    assert.deepEqual(env.listenerCounts(), { window: 0, document: 0 });
    assert.equal(env.observers.every((o) => !o.active), true);
  } finally {
    env.restore();
  }
});

test("embedded-pet: click squish, non-repeating Chinese quips, dual press/release audio, and blur 0fps pause", () => {
  const env = createMockDomEnv({ width: 1280, height: 720 });
  try {
    runSerialized(installEmbeddedPet, {
      owner: "pet-click-test",
      assetBaseUrl: "http://127.0.0.1:45678/asset?token=t1&kind=",
      soundEnabled: true,
      soundPack: "original",
      volume: 70,
      showBubbles: true,
      quipProbability: 1,
      dialogue: {
        idle: ["语录A", "语录B"],
        proud: ["骄傲语录1", "骄傲语录2"],
        crying: ["委屈语录1", "委屈语录2"],
      },
    });

    const host = env.doc.getElementById("agy-maomao-pet-root");
    const hitEl = host.shadowRoot.querySelector(".pet-hit");
    const stage = host.shadowRoot.querySelector(".pet-stage");

    // Click press & release plays BOTH press and release dual audio and shows Chinese quip
    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 1, clientX: 1100, clientY: 600 });
    assert.equal(stage.getAttribute("data-pressed"), "true");
    assert.equal(env.audioCalls.length, 1);
    assert.match(env.audioCalls[0].src, /kind=audio&file=original-press\.wav$/);

    hitEl.dispatchEvent("pointerup", { pointerId: 1, clientX: 1100, clientY: 600 });
    assert.equal(stage.getAttribute("data-pressed"), null);
    assert.equal(env.audioCalls.length, 2);
    assert.match(env.audioCalls[1].src, /kind=audio&file=original-release\.wav$/);
    const st1 = env.win.__agyMaomaoPet.status();
    assert.equal(st1.bubbleOpen, true);
    assert.ok(st1.bubbleText.length > 0);

    // Consecutive clicks trigger quip even when quipProbability is 0, and mute silences audio
    env.win.__agyMaomaoPet.update({ quipProbability: 0, soundEnabled: false });
    host.shadowRoot.querySelector(".pet-bubble-close").dispatchEvent("click");
    assert.equal(env.win.__agyMaomaoPet.status().bubbleOpen, false);
    const prevAudioCount = env.audioCalls.length;
    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 2, clientX: 1100, clientY: 600 });
    hitEl.dispatchEvent("pointerup", { pointerId: 2, clientX: 1100, clientY: 600 });
    assert.equal(env.audioCalls.length, prevAudioCount, "Muted pet must not play audio");
    assert.equal(env.win.__agyMaomaoPet.status().bubbleOpen, true, "Consecutive click must pop quip bubble");

    // Consecutive triggerQuip("idle") never repeats the same line back-to-back
    const q1 = env.win.__agyMaomaoPet.triggerQuip("idle");
    const q2 = env.win.__agyMaomaoPet.triggerQuip("idle");
    assert.notEqual(q1.text, q2.text);

    // Window blur pauses animations & timers -> 0fps
    env.win.dispatchEvent("blur");
    assert.equal(env.win.__agyMaomaoPet.status().paused, true);
    assert.equal(stage.getAttribute("data-paused"), "true");

    // Focus resumes cleanly
    env.win.dispatchEvent("focus");
    assert.equal(env.win.__agyMaomaoPet.status().paused, false);
    assert.equal(stage.getAttribute("data-paused"), "false");

    env.win.__agyMaomaoPet.destroy();
  } finally {
    env.restore();
  }
});

test("embedded-pet: 0px flush corner docking, snap=true magnetic snap, snap=false free drop + resize clamp, and false->true re-snap", () => {
  const env = createMockDomEnv({ width: 1280, height: 720 });
  try {
    runSerialized(installEmbeddedPet, {
      owner: "pet-drag-test",
      dock: "right",
      snap: true,
      scale: 100,
    });

    const host = env.doc.getElementById("agy-maomao-pet-root");
    const hitEl = host.shadowRoot.querySelector(".pet-hit");
    const stage = host.shadowRoot.querySelector(".pet-stage");
    const init = env.win.__agyMaomaoPet.status();
    // 0px flush bottom-right corner
    const expectedRightX = 1280 - init.width;
    const expectedBottomY = 720 - init.height;
    assert.equal(init.x, expectedRightX);
    assert.equal(init.y, expectedBottomY);
    assert.equal(init.snap, true);

    // Drag near bottom-left corner (within 120px snap radius) -> softly magnet-snaps flush to (0, h - height)!
    const deltaToNearLeftX = 48 - init.x;
    const deltaToNearLeftY = expectedBottomY - 40 - init.y;
    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 2, clientX: init.x + 20, clientY: init.y + 20 });
    hitEl.dispatchEvent("pointermove", {
      pointerId: 2,
      clientX: init.x + 20 + deltaToNearLeftX,
      clientY: init.y + 20 + deltaToNearLeftY,
    });
    assert.equal(env.win.__agyMaomaoPet.status().state, "dragged");
    hitEl.dispatchEvent("pointerup", {
      pointerId: 2,
      clientX: init.x + 20 + deltaToNearLeftX,
      clientY: init.y + 20 + deltaToNearLeftY,
    });

    const snapped = env.win.__agyMaomaoPet.status();
    assert.equal(snapped.x, 0, "Flush bottom-left corner x must be 0");
    assert.equal(snapped.y, expectedBottomY, "Flush bottom-left corner y must be h - height");
    assert.equal(snapped.dockedSide, "left");
    assert.equal(snapped.mirrored, true);
    assert.equal(host.shadowRoot.querySelector(".pet-face").style.transform, "rotateY(180deg)");
    assert.equal(stage.getAttribute("data-snapping"), "true");

    // Verify localStorage persisted the 0px flush coordinates
    const persisted = JSON.parse(env.storageMap.get("agy.maomao.pet.pos.v1"));
    assert.equal(persisted.x, 0);
    assert.equal(persisted.y, expectedBottomY);
    assert.equal(persisted.dockedSide, "left");

    // Turn snap OFF (snap: false) while keeping dock: "right" -> drag near bottom-left corner stays where dropped!
    env.win.__agyMaomaoPet.update({ snap: false });
    assert.equal(env.win.__agyMaomaoPet.status().snap, false);
    assert.equal(env.win.__agyMaomaoPet.status().dockedSide, "");

    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 3, clientX: 40, clientY: 600 });
    hitEl.dispatchEvent("pointermove", { pointerId: 3, clientX: 40 + 44, clientY: 600 - 36 });
    hitEl.dispatchEvent("pointerup", { pointerId: 3, clientX: 40 + 44, clientY: 600 - 36 });
    const droppedFree = env.win.__agyMaomaoPet.status();
    assert.equal(droppedFree.dockedSide, "");
    assert.equal(droppedFree.x, 44, "snap=false must stay at dropped x without corner snap");
    assert.equal(droppedFree.y, expectedBottomY - 36, "snap=false must stay at dropped y without corner snap");

    // Window resize when snap=false ONLY clamps out-of-bounds, never pulls back into a corner!
    env.win.innerWidth = 1000;
    env.win.innerHeight = 680;
    env.win.dispatchEvent("resize");
    const afterResizeFree = env.win.__agyMaomaoPet.status();
    assert.equal(afterResizeFree.x, 44, "snap=false resize must not pull pet back to corner x=0");
    assert.equal(afterResizeFree.y, Math.min(expectedBottomY - 36, 680 - afterResizeFree.height));

    // Toggle snap: false -> true -> immediately glides flush to current side's corner (left half -> x=0, y=h-height)!
    const reSnapped = env.win.__agyMaomaoPet.update({ snap: true });
    assert.equal(reSnapped.snap, true);
    assert.equal(reSnapped.x, 0);
    assert.equal(reSnapped.y, 680 - reSnapped.height);
    assert.equal(reSnapped.dockedSide, "left");
    assert.equal(stage.getAttribute("data-snapping"), "true");

    // Shrink viewport drastically while snap=false -> clamps strictly inside 0 .. w-width / 0 .. h-height
    env.win.__agyMaomaoPet.update({ snap: false });
    env.win.__agyMaomaoPet.setPosition(1000, 600, { dockedSide: "" });
    env.win.innerWidth = 640;
    env.win.innerHeight = 400;
    env.win.dispatchEvent("resize");
    const clamped = env.win.__agyMaomaoPet.status();
    assert.equal(clamped.x, 640 - clamped.width);
    assert.equal(clamped.y, 400 - clamped.height);

    env.win.__agyMaomaoPet.destroy();
  } finally {
    env.restore();
  }
});

test("embedded-pet: reacts to host stop/cancel conversation state and telemetry payload (thinking -> proud with token stats & low-quota sad warning)", async () => {
  let telemetryResponse = {
    rounds: 2,
    outputTokens: 1520,
    tps: 64.5,
  };
  const env = createMockDomEnv({
    width: 1280,
    height: 720,
    onFetch: async (url) => {
      if (url.includes("/api/maomao/telemetry")) {
        return { ok: true, status: 200, json: async () => telemetryResponse };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });
  try {
    runSerialized(installEmbeddedPet, {
      owner: "pet-state-test",
      sidecarBaseUrl: "http://127.0.0.1:45679",
      sidecarToken: "sec-tok",
      showBubbles: true,
    });

    const stopBtn = env.makeEl("button");
    stopBtn.setAttribute("data-testid", "composer-stop-button");
    env.bodyEl.append(stopBtn);
    env.triggerMutations([{ type: "childList", target: env.bodyEl, addedNodes: [stopBtn] }]);

    await new Promise((r) => setTimeout(r, 490));
    const thinking = env.win.__agyMaomaoPet.status();
    assert.equal(thinking.state, "thinking");
    assert.equal(thinking.bubbleOpen, true);
    assert.match(thinking.bubbleText, /思考中/);

    // Stop button removed -> completion triggers proud expression + telemetry fetch with token/tps hint
    stopBtn.remove();
    env.triggerMutations([{ type: "childList", target: env.bodyEl, removedNodes: [stopBtn] }]);

    await new Promise((r) => setTimeout(r, 500));
    const done = env.win.__agyMaomaoPet.status();
    assert.equal(done.expression, "proud");
    assert.equal(done.bubbleOpen, true);
    assert.match(done.bubbleMeta, /Token 1\.5k/);
    assert.match(done.bubbleMeta, /64\.5 tok\/s/);
    assert.ok(env.fetchCalls.some((u) => u === "http://127.0.0.1:45679/api/maomao/telemetry?token=sec-tok"));

    // Trigger low-quota warning via telemetry -> sad expression + warning bubble
    telemetryResponse = {
      rounds: 2,
      quota: { groups: [{ id: "gemini-pro", name: "Gemini Pro", windows: { "5h": { remaining: 10 } } }] },
    };
    const warnRes = env.win.__agyMaomaoPet.triggerQuip("warning", { meta: "Gemini Pro 剩余 10%" });
    assert.equal(warnRes.expression, "sad");
    assert.equal(warnRes.tone, "warning");

    env.win.__agyMaomaoPet.destroy();
    assert.ok(EMBEDDED_PET_ASSETS.pet.includes("proud-v3.png"));
    assert.ok(EMBEDDED_PET_ASSETS.audio.includes("interaction-press.wav"));
  } finally {
    env.restore();
  }
});

test("embedded-pet: clicking (poking) cat displays live 5h & weekly quota + reset countdown + cute quip, with /api/maomao/telemetry fallback", async () => {
  const now = Date.now();
  const reset5h = now + (2 * 60 + 35) * 60 * 1000; // 2h 35m
  const resetWeekly = now + (3 * 24 + 5) * 60 * 60 * 1000; // 3d 5h

  // 1) Primary /api/maomao/quota endpoint with multi-pool switching
  const env = createMockDomEnv({
    width: 1280,
    height: 720,
    onFetch: async (url) => {
      if (url.includes("/api/maomao/quota")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            status: "ready",
            online: true,
            cached: false,
            stale: false,
            groups: [
              {
                id: "gemini-pro",
                name: "Gemini Models",
                windows: {
                  "5h": { remaining: 84, resetAt: reset5h },
                  weekly: { remaining: 62, resetAt: resetWeekly },
                },
              },
              {
                id: "claude",
                name: "Claude / GPT",
                windows: {
                  "5h": { remaining: 25, resetAt: now + 45 * 60 * 1000 },
                  weekly: { remaining: 12, resetAt: resetWeekly },
                },
              },
            ],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });

  try {
    runSerialized(installEmbeddedPet, {
      owner: "pet-quota-click",
      sidecarBaseUrl: "http://127.0.0.1:45680",
      sidecarToken: "q-tok",
      showBubbles: true,
      quipProbability: 0,
    });

    const shadow = env.doc.getElementById("agy-maomao-pet-root").shadowRoot;
    const hitEl = shadow.querySelector(".pet-hit");

    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 11, clientX: 1120, clientY: 610 });
    hitEl.dispatchEvent("pointerup", { pointerId: 11, clientX: 1120, clientY: 610 });

    await new Promise((r) => setTimeout(r, 20));

    const st = env.win.__agyMaomaoPet.status();
    assert.equal(st.bubbleOpen, true);
    assert.equal(st.bubbleMode, "quota");
    assert.ok(st.bubbleText.length > 0, "Quota bubble must also include cute tsundere quip");
    assert.ok(env.fetchCalls.some((u) => u === "http://127.0.0.1:45680/api/maomao/quota?token=q-tok"));

    const quotaBox = shadow.querySelector(".pet-quota");
    assert.equal(quotaBox.hidden, false);
    assert.equal(shadow.querySelector(".pet-quota-pool-name").textContent, "Gemini Models");

    const pctEls = shadow.querySelectorAll(".pet-quota-pct");
    const resetEls = shadow.querySelectorAll(".pet-quota-reset");
    assert.equal(pctEls[0].textContent, "84%");
    assert.equal(pctEls[1].textContent, "62%");
    assert.match(resetEls[0].textContent, /2h 3[56]m 后重置/);
    assert.match(resetEls[1].textContent, /3天 5h 后重置/);

    // Switch to 2nd model pool (Claude / GPT) and verify English pool name & low/critical styling
    // Clicking pager button (even when bubbled to .pet-bubble) must NOT close the bubble!
    const nextBtn = shadow.querySelector(".pet-quota-next");
    const bubbleEl = shadow.querySelector(".pet-bubble");
    nextBtn.dispatchEvent("click", { target: nextBtn });
    bubbleEl.dispatchEvent("click", { target: nextBtn });
    assert.equal(env.win.__agyMaomaoPet.status().bubbleOpen, true, "Clicking pager button must NOT close bubble");
    assert.equal(shadow.querySelector(".pet-quota-pool-name").textContent, "Claude / GPT");
    assert.equal(pctEls[0].textContent, "25%");
    assert.equal(pctEls[0].getAttribute("data-level"), "low");
    assert.equal(pctEls[1].textContent, "12%");
    assert.equal(pctEls[1].getAttribute("data-level"), "critical");
    assert.match(resetEls[0].textContent, /4[56]m 后重置/);

    // Verify 3 graduating thought-bubble tail dots exist & larger 28px/18px close button styling
    const tailDots = shadow.querySelectorAll(".pet-tail-dot");
    assert.equal(tailDots.length, 3, "Thought bubble must render 3 graduating tail dots (lg/md/sm)");
    const petCss = shadow.querySelector("style").textContent;
    assert.match(petCss, /\.pet-bubble-close\s*\{[\s\S]*width:\s*calc\(28px\s*\*\s*var\(--pet-bubble-scale\)\)[\s\S]*font-size:\s*calc\(18px\s*\*\s*var\(--pet-bubble-scale\)\)/);

    // Clicking anywhere on bubble body text closes the bubble immediately!
    const bubbleTextEl = shadow.querySelector(".pet-bubble-text");
    bubbleEl.dispatchEvent("click", { target: bubbleTextEl });
    assert.equal(env.win.__agyMaomaoPet.status().bubbleOpen, false, "Clicking bubble body must close bubble");

    env.win.__agyMaomaoPet.destroy();
  } finally {
    env.restore();
  }

  // 2) Fallback to /api/maomao/telemetry (quotas.groups) when /api/maomao/quota returns 404
  const envFallback = createMockDomEnv({
    width: 1280,
    height: 720,
    onFetch: async (url) => {
      if (url.includes("/api/maomao/quota")) {
        return { ok: false, status: 404, json: async () => ({}) };
      }
      if (url.includes("/api/maomao/telemetry")) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            quotas: {
              status: "cached",
              cached: true,
              groups: [
                {
                  id: "gemini-pro",
                  name: "Gemini Models",
                  windows: {
                    "5h": { remaining: 77, resetAt: now + 90 * 60 * 1000 },
                    weekly: { remaining: 55, resetAt: resetWeekly },
                  },
                },
              ],
            },
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    },
  });

  try {
    runSerialized(installEmbeddedPet, {
      owner: "pet-quota-fallback",
      sidecarBaseUrl: "http://127.0.0.1:45681",
      sidecarToken: "fb-tok",
      showBubbles: true,
    });

    const shadow = envFallback.doc.getElementById("agy-maomao-pet-root").shadowRoot;
    const hitEl = shadow.querySelector(".pet-hit");
    hitEl.dispatchEvent("pointerdown", { button: 0, pointerId: 12, clientX: 1120, clientY: 610 });
    hitEl.dispatchEvent("pointerup", { pointerId: 12, clientX: 1120, clientY: 610 });

    await new Promise((r) => setTimeout(r, 20));

    assert.ok(envFallback.fetchCalls.some((u) => u.includes("/api/maomao/quota")));
    assert.ok(envFallback.fetchCalls.some((u) => u.includes("/api/maomao/telemetry")));
    const pctEls = shadow.querySelectorAll(".pet-quota-pct");
    assert.equal(pctEls[0].textContent, "77%");
    assert.equal(pctEls[1].textContent, "55%");

    envFallback.win.__agyMaomaoPet.destroy();
  } finally {
    envFallback.restore();
  }
});

test("embedded-pet: bubble dynamically adapts across all 4 surface modes (light / dark / glass-light / glass-dark)", () => {
  const env = createMockDomEnv({ width: 1280, height: 720 });
  try {
    // 1) Pure light mode by default
    const stLight = runSerialized(installEmbeddedPet, {
      owner: "pet-surface-test",
      showBubbles: true,
    });
    const host = env.doc.getElementById("agy-maomao-pet-root");
    const shadow = host.shadowRoot;
    const stage = shadow.querySelector(".pet-stage");
    const bubbleEl = shadow.querySelector(".pet-bubble");
    const css = shadow.querySelector("style").textContent;

    assert.equal(stLight.rev, 5);
    assert.equal(stLight.surfaceMode, "light");
    assert.equal(stage.getAttribute("data-surface"), "light");
    assert.equal(bubbleEl.getAttribute("data-surface"), "light");

    // Verify stylesheet defines all 4 surface themes with backdrop-filter only on glass modes
    assert.match(css, /\.pet-bubble\[data-surface="dark"\]/);
    assert.match(css, /\.pet-bubble\[data-surface="glass-dark"\][\s\S]*backdrop-filter:\s*blur\(18px\)\s*saturate\(155%\)/);
    assert.match(css, /\.pet-bubble\[data-surface="glass-light"\][\s\S]*backdrop-filter:\s*blur\(18px\)\s*saturate\(155%\)/);

    // 2) Switch host to pure dark (html[data-theme="dark"]) -> real-time sync via themeObserver
    env.docEl.setAttribute("data-theme", "dark");
    env.triggerMutations([{ type: "attributes", target: env.docEl, attributeName: "data-theme" }]);
    assert.equal(env.win.__agyMaomaoPet.status().surfaceMode, "dark");
    assert.equal(bubbleEl.getAttribute("data-surface"), "dark");

    // 3) Activate dream glass skin (html.agy-dream-active-v2) while dark -> glass-dark
    env.docEl.classList.add("agy-dream-active-v2");
    env.triggerMutations([{ type: "attributes", target: env.docEl, attributeName: "class" }]);
    assert.equal(env.win.__agyMaomaoPet.status().surfaceMode, "glass-dark");
    assert.equal(bubbleEl.getAttribute("data-surface"), "glass-dark");

    // 4) Switch host to light while dream glass skin stays active -> glass-light
    env.docEl.setAttribute("data-theme", "light");
    env.win.__agyMaomaoPet.triggerQuip("idle");
    assert.equal(env.win.__agyMaomaoPet.status().surfaceMode, "glass-light");
    assert.equal(bubbleEl.getAttribute("data-surface"), "glass-light");

    // 5) Clean destroy disconnects themeObserver too
    env.win.__agyMaomaoPet.destroy();
    assert.equal(env.observers.every((o) => !o.active), true);
  } finally {
    env.restore();
  }
});

test("motion-fx: five-tier inkStreamFade uses CSS.highlights with zero DOM wrapping, sleeps at 0fps, and degrades gracefully", () => {
  // 1) With CSS.highlights support
  const env = createMockDomEnv();
  try {
    const status = runSerialized(installMotionFx, {
      owner: "fx-ink-test",
      inkStreamFade: true,
      semanticAura: false,
      smoothCaret: false,
      unreadBadge: false,
    });
    assert.equal(status.applied, true);
    assert.equal(status.rev, MOTION_FX_REV);
    assert.equal(status.inkSupported, true);
    assert.equal(status.idleZeroFps, true);

    const resp = env.makeEl("div");
    resp.setAttribute("data-testid", "agent-response");
    const p = env.makeEl("p");
    const textNode = env.makeTextNode("流式输出测试");
    p.append(textNode);
    resp.append(p);
    env.bodyEl.append(resp);

    // Simulate streaming characterData update
    const oldVal = textNode.nodeValue;
    textNode.nodeValue = oldVal + "，零节点包裹！";
    env.triggerMutations([{ type: "characterData", target: textNode, oldValue: oldVal }]);

    assert.equal(p.childNodes.length, 1, "Must NEVER wrap streaming text in extra DOM span nodes");
    env.flushRaf(60);
    assert.ok(env.highlightMap.has("agy-ink-0"), "Tier 0 highlight must be registered during fade");

    // Advance past 380ms duration -> highlights auto-clear & rAF sleeps at 0fps!
    env.flushRaf(420);
    assert.equal(env.highlightMap.size, 0, "Highlights must clear once fade settles");
    assert.equal(env.rafQueue.size, 0, "rAF loop must stop at 0fps when idle");
    assert.equal(env.win.__agyMaomaoMotionFx.status().idleZeroFps, true);

    env.win.__agyMaomaoMotionFx.destroy();
    assert.equal(env.win.__agyMaomaoMotionFx, undefined);
    assert.deepEqual(env.listenerCounts(), { window: 0, document: 0 });
  } finally {
    env.restore();
  }

  // 2) Graceful fallback when CSS.highlights is unavailable
  const envNoHl = createMockDomEnv({ noHighlights: true });
  try {
    const st = runSerialized(installMotionFx, {
      owner: "fx-no-hl",
      inkStreamFade: true,
    });
    assert.equal(st.applied, true);
    assert.equal(st.inkSupported, false);
    envNoHl.win.__agyMaomaoMotionFx.destroy();
  } finally {
    envNoHl.restore();
  }
});

test("motion-fx: semanticAura three states (approval/error/complete), smoothCaret FastDOM + IME guard, unreadBadge, hot toggles, and clean destroy", async () => {
  const env = createMockDomEnv({ title: "Antigravity" });
  try {
    runSerialized(installMotionFx, {
      owner: "fx-full-test",
      inkStreamFade: true,
      semanticAura: true,
      smoothCaret: false,
      unreadBadge: true,
      longTaskMs: 0,
      signalDebounceMs: 60,
    });

    const fx = env.win.__agyMaomaoMotionFx;
    assert.equal(MOTION_FX_REV, 2);
    assert.equal(fx.rev, 2);

    // Zero typing/caret document listeners when smoothCaret === false (only visibilitychange on doc)
    assert.equal(fx.status().caretListenersBound, false);
    assert.equal(env.listenerCounts().document, 1, "Only visibilitychange should be bound when smoothCaret is off");

    // Fast-filter editor/Lexical mutations: typing & backspace NEVER trigger inspectHostSignals()
    const editor = env.makeEl("div", { rect: { left: 200, top: 500, width: 400, height: 32 } });
    editor.setAttribute("data-lexical-editor", "true");
    editor.setAttribute("contenteditable", "true");
    const editText = env.makeTextNode("正在打字测试");
    editor.append(editText);
    env.bodyEl.append(editor);
    const inspectsBeforeTyping = fx.status().inspectCalls;
    env.triggerMutations([
      { type: "characterData", target: editText, oldValue: "正在打字测试" },
      { type: "childList", target: editor, addedNodes: [] },
    ]);
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(
      fx.status().inspectCalls,
      inspectsBeforeTyping,
      "Editor typing/backspace mutations must NEVER trigger host signal scans"
    );
    assert.equal(env.highlightMap.size, 0, "Editor typing must never register ink highlights");

    // Enable smoothCaret dynamically -> listeners bind; rapid Backspace triggers instant snap (data-snap=true)
    fx.update({ smoothCaret: true });
    assert.equal(fx.status().caretListenersBound, true);
    assert.ok(env.listenerCounts().document > 1);

    const auraEl = env.doc.getElementById("agy-maomao-semantic-aura");
    const caretEl = env.doc.getElementById("agy-maomao-smooth-caret");
    assert.ok(auraEl);
    assert.ok(caretEl);

    // --- Test 1: semanticAura three states ---
    assert.equal(fx.triggerAura("approval", { force: true }), true);
    assert.equal(auraEl.getAttribute("data-aura"), "approval");
    assert.equal(auraEl.getAttribute("data-phase"), "pulse");

    assert.equal(fx.triggerAura("error", { force: true }), true);
    assert.equal(auraEl.getAttribute("data-aura"), "error");

    assert.equal(fx.triggerAura("complete", { force: true }), true);
    assert.equal(auraEl.getAttribute("data-aura"), "complete");

    // Disable semanticAura clears aura immediately
    fx.update({ semanticAura: false });
    assert.equal(auraEl.getAttribute("data-aura"), null);
    assert.equal(fx.triggerAura("error", { force: true }), false);
    fx.update({ semanticAura: true });

    // --- Test 2: smoothCaret FastDOM + Backspace instant snap + IME composition avoidance ---
    env.doc.activeElement = editor;
    env.setSelection({
      rangeCount: 1,
      isCollapsed: true,
      getRangeAt: () => ({
        getClientRects: () => [{ left: 242, top: 506, height: 20 }],
      }),
    });

    env.doc.dispatchEvent("keydown", { key: "Backspace", repeat: true });
    assert.equal(caretEl.getAttribute("data-snap"), "true", "Backspace/repeat must switch caret to instant snap");
    env.doc.dispatchEvent("selectionchange");
    env.flushRaf(16);
    assert.equal(caretEl.getAttribute("data-visible"), "true");
    assert.equal(caretEl.style.transform, "translate3d(242px, 506px, 0)");
    assert.equal(editor.getAttribute("data-agy-smooth-caret"), "1");
    assert.equal(env.rafQueue.size, 0, "Smooth caret must not run continuous rAF loop");

    // IME compositionstart immediately hides custom caret and restores native caret
    env.doc.dispatchEvent("compositionstart");
    assert.equal(caretEl.getAttribute("data-visible"), "false");
    assert.equal(editor.getAttribute("data-agy-smooth-caret"), null);
    assert.equal(fx.status().isComposing, true);

    // Selection changes during IME composition are ignored
    env.doc.dispatchEvent("selectionchange");
    assert.equal(env.rafQueue.size, 0);

    // compositionend resumes tracking
    env.doc.dispatchEvent("compositionend");
    env.flushRaf(16);
    assert.equal(caretEl.getAttribute("data-visible"), "true");

    // Turning smoothCaret back off unbinds all caret/input listeners completely
    fx.update({ smoothCaret: false });
    assert.equal(fx.status().caretListenersBound, false);
    assert.equal(env.listenerCounts().document, 1);

    // --- Test 3: unreadBadge on background completion & instant clear on focus ---
    env.setFocused(false);
    env.win.dispatchEvent("blur");

    const stopBtn = env.makeEl("button");
    stopBtn.setAttribute("data-testid", "stop-generation");
    env.bodyEl.append(stopBtn);
    env.triggerMutations([{ type: "childList", target: env.bodyEl, addedNodes: [stopBtn] }]);
    await new Promise((r) => setTimeout(r, 120));

    // Completion while window unfocused increments title unread badge
    stopBtn.remove();
    env.triggerMutations([{ type: "childList", target: env.bodyEl, removedNodes: [stopBtn] }]);
    await new Promise((r) => setTimeout(r, 120));

    assert.equal(fx.getUnreadCount(), 1);
    assert.equal(env.doc.title, "(1) Antigravity");
    assert.equal(auraEl.getAttribute("data-aura"), "complete");

    // Focus clears badge and restores original title immediately
    env.setFocused(true);
    env.win.dispatchEvent("focus");
    assert.equal(fx.getUnreadCount(), 0);
    assert.equal(env.doc.title, "Antigravity");

    // --- Test 4: Full clean destroy ---
    const res = fx.destroy();
    assert.deepEqual(res, { removed: true });
    assert.equal(env.win.__agyMaomaoMotionFx, undefined);
    assert.equal(env.doc.getElementById("agy-maomao-motion-fx-style"), null);
    assert.equal(env.doc.getElementById("agy-maomao-semantic-aura"), null);
    assert.equal(env.doc.getElementById("agy-maomao-smooth-caret"), null);
    assert.equal(editor.getAttribute("data-agy-smooth-caret"), null);
    assert.deepEqual(env.listenerCounts(), { window: 0, document: 0 });
    assert.equal(env.observers.every((o) => !o.active), true);
  } finally {
    env.restore();
  }
});
