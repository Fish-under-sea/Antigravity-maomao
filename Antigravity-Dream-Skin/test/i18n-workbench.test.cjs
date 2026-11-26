"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");

const {
  HOST_EXACT_MAP,
  HOST_PATTERN_RULES,
  SWARM_EXACT_MAP,
  SWARM_PATTERN_RULES,
  PROTECTED_MODEL_OR_EFFORT_RE,
  isProtectedModelOrEffortText,
} = require("../src/host/modules/i18n-dict.cjs");

const {
  installHostI18n,
  installSwarmI18n,
  HOST_I18N_KEY,
  SWARM_I18N_KEY,
  HOST_I18N_REV,
  SWARM_I18N_REV,
} = require("../src/host/modules/host-i18n.cjs");

const {
  installWorkbenchEnhancer,
  WORKBENCH_KEY,
  WORKBENCH_REV,
} = require("../src/host/modules/workbench-enhancer.cjs");

// ---------------------------------------------------------------------------
// Minimal deterministic DOM simulator (supports selectors, TreeWalker,
// MutationObserver hooks, events, clipboard, and CDP vm.runInNewContext).
// ---------------------------------------------------------------------------
function createMockDom() {
  const observers = [];
  const docListeners = new Map();

  function matchesSimple(el, part) {
    if (!el || el.nodeType !== 1) return false;
    const sel = part.trim();
    if (!sel) return false;

    // Handle compound selectors like `div.foo[data-x="1"]` or `a[href^="file://"]`
    const tokens = [];
    let rest = sel;
    while (rest.length > 0) {
      if (rest.startsWith("[")) {
        const end = rest.indexOf("]");
        if (end < 0) return false;
        tokens.push({ kind: "attr", raw: rest.slice(1, end) });
        rest = rest.slice(end + 1);
      } else if (rest.startsWith(".")) {
        const m = /^\.([A-Za-z0-9_-]+)/.exec(rest);
        if (!m) return false;
        tokens.push({ kind: "class", val: m[1] });
        rest = rest.slice(m[0].length);
      } else if (rest.startsWith("#")) {
        const m = /^#([A-Za-z0-9_-]+)/.exec(rest);
        if (!m) return false;
        tokens.push({ kind: "id", val: m[1] });
        rest = rest.slice(m[0].length);
      } else {
        const m = /^([A-Za-z0-9_-]+)/.exec(rest);
        if (!m) return false;
        tokens.push({ kind: "tag", val: m[1].toUpperCase() });
        rest = rest.slice(m[0].length);
      }
    }

    for (const tok of tokens) {
      if (tok.kind === "tag" && el.tagName !== tok.val) return false;
      if (tok.kind === "id" && el.id !== tok.val) return false;
      if (tok.kind === "class") {
        const classes = String(el.className || "").split(/\s+/).filter(Boolean);
        if (!classes.includes(tok.val)) return false;
      }
      if (tok.kind === "attr") {
        const m = /^([^\s=*^$]+)(?:\s*(\*=|\^=|=)\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))(?:\s+i)?)?$/.exec(tok.raw.trim());
        if (!m) return false;
        const attrName = m[1];
        const op = m[2];
        const expected = m[3] ?? m[4] ?? m[5] ?? "";
        const actual = el.getAttribute(attrName);
        if (actual === null || actual === undefined) return false;
        if (op === "=" && actual !== expected) return false;
        if (op === "*=" && !actual.includes(expected)) return false;
        if (op === "^=" && !actual.startsWith(expected)) return false;
      }
    }
    return true;
  }

  function splitOutsideBrackets(str, delimRe) {
    const parts = [];
    let buf = "";
    let depth = 0;
    let quote = "";
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (quote) {
        buf += ch;
        if (ch === quote) quote = "";
      } else if (ch === '"' || ch === "'") {
        quote = ch;
        buf += ch;
      } else if (ch === "[") {
        depth += 1;
        buf += ch;
      } else if (ch === "]") {
        depth = Math.max(0, depth - 1);
        buf += ch;
      } else if (depth === 0 && delimRe.test(ch)) {
        if (buf.trim()) parts.push(buf.trim());
        buf = "";
      } else {
        buf += ch;
      }
    }
    if (buf.trim()) parts.push(buf.trim());
    return parts;
  }

  function matchesSelector(el, selector) {
    if (!el || el.nodeType !== 1 || typeof selector !== "string") return false;
    const branches = splitOutsideBrackets(selector, /,/);
    for (const branch of branches) {
      if (!branch) continue;
      const parts = splitOutsideBrackets(branch, /\s/);
      if (parts.length === 1) {
        if (matchesSimple(el, parts[0])) return true;
      } else {
        if (!matchesSimple(el, parts[parts.length - 1])) continue;
        let cur = el.parentElement;
        let idx = parts.length - 2;
        while (cur && idx >= 0) {
          if (matchesSimple(cur, parts[idx])) idx--;
          cur = cur.parentElement;
        }
        if (idx < 0) return true;
      }
    }
    return false;
  }

  function createTextNode(initial) {
    const node = {
      nodeType: 3,
      nodeValue: String(initial),
      parentElement: null,
      isConnected: false,
      remove() {
        if (node.parentElement) {
          const i = node.parentElement.childNodes.indexOf(node);
          if (i >= 0) node.parentElement.childNodes.splice(i, 1);
          node.parentElement = null;
        }
        node.isConnected = false;
      },
    };
    return node;
  }

  function markConnected(node, connected) {
    node.isConnected = connected;
    if (node.childNodes) {
      for (const ch of node.childNodes) markConnected(ch, connected);
    }
  }

  function createElement(tag) {
    const attrs = new Map();
    const listeners = new Map();
    const childNodes = [];
    const el = {
      nodeType: 1,
      tagName: String(tag).toUpperCase(),
      id: "",
      className: "",
      value: "",
      type: "",
      scrollTop: 0,
      scrollHeight: 800,
      clientHeight: 400,
      focused: false,
      scrolledIntoViewCount: 0,
      clickedCount: 0,
      parentElement: null,
      isConnected: false,
      childNodes,
      style: {},
      classList: {
        contains(name) {
          return String(el.className || "").split(/\s+/).filter(Boolean).includes(name);
        },
        add(name) {
          const set = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
          set.add(name);
          el.className = Array.from(set).join(" ");
        },
        remove(name) {
          const set = new Set(String(el.className || "").split(/\s+/).filter(Boolean));
          set.delete(name);
          el.className = Array.from(set).join(" ");
        },
      },
      _rect: { left: 0, top: 0, width: 600, height: 100, right: 600, bottom: 100 },
      get children() {
        return childNodes.filter((n) => n.nodeType === 1);
      },
      get firstChild() {
        return childNodes[0] || null;
      },
      get nextSibling() {
        if (!el.parentElement) return null;
        const idx = el.parentElement.childNodes.indexOf(el);
        return idx >= 0 ? el.parentElement.childNodes[idx + 1] || null : null;
      },
      get textContent() {
        return childNodes
          .map((n) => (n.nodeType === 3 ? n.nodeValue : n.textContent))
          .join("");
      },
      set textContent(v) {
        for (const ch of childNodes) {
          ch.parentElement = null;
          markConnected(ch, false);
        }
        childNodes.length = 0;
        const str = String(v ?? "");
        if (str) {
          const t = createTextNode(str);
          t.parentElement = el;
          t.isConnected = el.isConnected;
          childNodes.push(t);
        }
      },
      setAttribute(k, v) {
        const str = String(v);
        if (k === "id") el.id = str;
        if (k === "class") el.className = str;
        attrs.set(k, str);
      },
      getAttribute(k) {
        if (k === "id" && el.id) return el.id;
        if (k === "class" && el.className) return el.className;
        return attrs.has(k) ? attrs.get(k) : null;
      },
      hasAttribute(k) {
        return attrs.has(k) || (k === "id" && Boolean(el.id));
      },
      removeAttribute(k) {
        if (k === "id") el.id = "";
        if (k === "class") el.className = "";
        attrs.delete(k);
      },
      appendChild(node) {
        if (node.parentElement) node.remove();
        node.parentElement = el;
        childNodes.push(node);
        markConnected(node, el.isConnected);
        return node;
      },
      append(...nodes) {
        for (const n of nodes) el.appendChild(n);
      },
      prepend(...nodes) {
        for (let i = nodes.length - 1; i >= 0; i--) {
          const node = nodes[i];
          if (node.parentElement) node.remove();
          node.parentElement = el;
          childNodes.unshift(node);
          markConnected(node, el.isConnected);
        }
      },
      insertBefore(node, ref) {
        if (node.parentElement) node.remove();
        node.parentElement = el;
        const idx = ref ? childNodes.indexOf(ref) : -1;
        if (idx >= 0) childNodes.splice(idx, 0, node);
        else childNodes.push(node);
        markConnected(node, el.isConnected);
        return node;
      },
      removeChild(node) {
        const idx = childNodes.indexOf(node);
        if (idx >= 0) {
          childNodes.splice(idx, 1);
          node.parentElement = null;
          markConnected(node, false);
        }
        return node;
      },
      remove() {
        if (el.parentElement) el.parentElement.removeChild(el);
        else markConnected(el, false);
      },
      contains(target) {
        if (target === el) return true;
        return childNodes.some((n) => n === target || (n.contains && n.contains(target)));
      },
      matches(sel) {
        return matchesSelector(el, sel);
      },
      closest(sel) {
        let cur = el;
        while (cur && cur.nodeType === 1) {
          if (matchesSelector(cur, sel)) return cur;
          cur = cur.parentElement;
        }
        return null;
      },
      querySelectorAll(sel) {
        const out = [];
        function walk(node) {
          for (const ch of node.childNodes || []) {
            if (ch.nodeType === 1) {
              if (matchesSelector(ch, sel)) out.push(ch);
              walk(ch);
            }
          }
        }
        walk(el);
        return out;
      },
      querySelector(sel) {
        return el.querySelectorAll(sel)[0] || null;
      },
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        listeners.get(type)?.delete(fn);
      },
      dispatchEvent(ev) {
        const eventObj = ev || {};
        if (!eventObj.target) eventObj.target = el;
        if (typeof eventObj.preventDefault !== "function") {
          eventObj.defaultPrevented = false;
          eventObj.preventDefault = () => { eventObj.defaultPrevented = true; };
        }
        if (typeof eventObj.stopPropagation !== "function") {
          eventObj.stopPropagation = () => {};
        }
        const fns = listeners.get(eventObj.type);
        if (fns) {
          for (const fn of [...fns]) fn(eventObj);
        }
        // Also dispatch document capture listeners for events originating inside document
        const docFns = docListeners.get(eventObj.type);
        if (docFns) {
          for (const fn of [...docFns]) fn(eventObj);
        }
        return !eventObj.defaultPrevented;
      },
      click() {
        el.clickedCount += 1;
        el.dispatchEvent({ type: "click", target: el });
      },
      focus() {
        el.focused = true;
      },
      scrollIntoView() {
        el.scrolledIntoViewCount += 1;
      },
      getBoundingClientRect() {
        return { ...el._rect };
      },
    };
    return el;
  }

  const documentElement = createElement("html");
  documentElement.isConnected = true;
  const head = createElement("head");
  const body = createElement("body");
  documentElement.appendChild(head);
  documentElement.appendChild(body);

  class MockMutationObserver {
    constructor(cb) {
      this._cb = cb;
      this._targets = [];
      this.active = false;
      observers.push(this);
    }
    observe(target, opts) {
      this._target = target;
      this._targets.push(target);
      this._opts = opts;
      this.active = true;
    }
    disconnect() {
      this.active = false;
    }
    emit(records) {
      if (this.active) this._cb(records);
    }
  }

  const document = {
    nodeType: 9,
    readyState: "complete",
    documentElement,
    head,
    body,
    scrollingElement: documentElement,
    createElement,
    createElementNS(_ns, tag) {
      return createElement(tag);
    },
    createTextNode,
    querySelector: (sel) => documentElement.querySelector(sel),
    querySelectorAll: (sel) => documentElement.querySelectorAll(sel),
    getElementById: (id) => documentElement.querySelector("#" + id),
    createTreeWalker(root, whatToShow) {
      const list = [];
      function collect(node) {
        for (const ch of node.childNodes || []) {
          if (whatToShow === 4 && ch.nodeType === 3) list.push(ch);
          if (ch.nodeType === 1) collect(ch);
        }
      }
      collect(root);
      let idx = -1;
      return {
        nextNode() {
          idx += 1;
          return list[idx] || null;
        },
      };
    },
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      docListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const fns = docListeners.get(ev.type);
      if (fns) {
        for (const fn of [...fns]) fn(ev);
      }
    },
  };

  const clipboardWrites = [];
  const winListeners = new Map();
  const window = {
    innerWidth: 1280,
    innerHeight: 720,
    getSelection: () => "",
    addEventListener(type, fn) {
      if (!winListeners.has(type)) winListeners.set(type, new Set());
      winListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      winListeners.get(type)?.delete(fn);
    },
    dispatchEvent(ev) {
      const fns = winListeners.get(ev.type);
      if (fns) {
        for (const fn of [...fns]) fn(ev);
      }
    },
  };
  const navigator = {
    clipboard: {
      async writeText(txt) {
        clipboardWrites.push(String(txt));
      },
    },
  };

  function runSelfContained(fn, payload, extraGlobals = {}) {
    const sandbox = {
      window,
      document,
      navigator,
      NodeFilter: { SHOW_TEXT: 4 },
      MutationObserver: MockMutationObserver,
      AbortController,
      Event: class MockEvent {
        constructor(type) { this.type = type; }
      },
      getComputedStyle: () => ({ overflowY: "auto" }),
      setTimeout,
      clearTimeout,
      Date,
      RegExp,
      Map,
      Set,
      WeakMap,
      Object,
      Array,
      String,
      Number,
      Boolean,
      Math,
      JSON,
      encodeURIComponent,
      decodeURIComponent,
      ...extraGlobals,
    };
    const expr = "(" + fn.toString() + ")(" + JSON.stringify(payload) + ")";
    return vm.runInNewContext(expr, sandbox);
  }

  return {
    window,
    document,
    navigator,
    body,
    head,
    documentElement,
    observers,
    docListeners,
    winListeners,
    clipboardWrites,
    createElement,
    createTextNode,
    MockMutationObserver,
    runSelfContained,
  };
}

// ---------------------------------------------------------------------------
// 1. Dictionary red-line audit tests
// ---------------------------------------------------------------------------
test("i18n-dict contains ZERO entries translating model names or thinking/reasoning effort labels", () => {
  const mustStayEnglish = [
    "Gemini 4 Neon Extra High",
    "Gemini 4 Neon",
    "Gemini 4 Hydrogen",
    "Gemini 4 Flash",
    "Gemini 4 Carbon",
    "Gemini 4 Argon",
    "Gemini 3.1 Pro",
    "Gemini 3.5 Flash",
    "Claude Sonnet 4",
    "Claude Opus 4.5",
    "Claude Haiku",
    "GPT-5",
    "GPT-4o",
    "GPT-OSS 120B",
    "o3-mini",
    "o4-mini",
    "Off",
    "Minimal",
    "Low",
    "Medium",
    "High",
    "Extra High",
    "XHigh",
    "Max",
    "Auto",
    "Thinking",
    "Orchestrator",
  ];

  for (const label of mustStayEnglish) {
    assert.equal(
      isProtectedModelOrEffortText(label),
      true,
      `Expected protected guard to match: ${label}`
    );
    assert.equal(
      PROTECTED_MODEL_OR_EFFORT_RE.test(label),
      true,
      `Expected PROTECTED_MODEL_OR_EFFORT_RE to match: ${label}`
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(HOST_EXACT_MAP, label),
      false,
      `HOST_EXACT_MAP must NOT contain: ${label}`
    );
    assert.equal(
      Object.prototype.hasOwnProperty.call(SWARM_EXACT_MAP, label),
      false,
      `SWARM_EXACT_MAP must NOT contain: ${label}`
    );
  }

  // Audit every single key in both dictionaries
  for (const key of Object.keys(HOST_EXACT_MAP)) {
    assert.equal(
      isProtectedModelOrEffortText(key),
      false,
      `HOST_EXACT_MAP contains protected key: ${key}`
    );
  }
  for (const key of Object.keys(SWARM_EXACT_MAP)) {
    assert.equal(
      isProtectedModelOrEffortText(key),
      false,
      `SWARM_EXACT_MAP contains protected key: ${key}`
    );
  }

  // Orchestrator descriptions retain "Orchestrator" in English
  assert.match(HOST_EXACT_MAP["Orchestrator Settings"], /Orchestrator/);
  assert.match(
    HOST_EXACT_MAP[
      "Default uses server-managed routing and Orchestrator quota. Custom pins specific models for orchestration and execution."
    ],
    /Orchestrator/
  );
  assert.ok(HOST_PATTERN_RULES.length >= 20);
  assert.ok(SWARM_PATTERN_RULES.length >= 20);
});

// ---------------------------------------------------------------------------
// 2. Host i18n engine tests (via CDP-equivalent fn.toString() in isolated VM)
// ---------------------------------------------------------------------------
test("installHostI18n translates UI accurately, strictly preserves model names & effort levels, respects protected containers, and restores 100% on destroy()", () => {
  const dom = createMockDom();

  const makeItem = (tag, text, attrs = {}) => {
    const el = dom.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    el.appendChild(dom.createTextNode(text));
    dom.body.appendChild(el);
    return el;
  };

  // UI items that MUST be translated
  const btnNew = makeItem("button", "New Conversation");
  const btnSettings = makeItem("button", "Settings");
  const lblThought = makeItem("span", "Thought for 12s");
  const lblWorked = makeItem("span", "Worked for 2m 15s");
  const lblStep = makeItem("span", "Step 2 of 5");
  const lblFiles = makeItem("span", "3 files changed");
  const btnDel = makeItem("button", "Delete Permanently");
  const btnInbox = makeItem("button", "Return to Inbox");
  const btnOlder = makeItem("button", "Load older messages");
  const searchInput = dom.createElement("input");
  searchInput.setAttribute("placeholder", "Search conversations...");
  searchInput.setAttribute("title", "Settings");
  dom.body.appendChild(searchInput);

  // Model names & effort labels that MUST NEVER be translated
  const protectedSamples = [
    "Gemini 4 Neon Extra High",
    "Gemini 4 Flash",
    "Gemini 4 Hydrogen",
    "Gemini 4 Carbon",
    "Claude Sonnet 4",
    "Claude Opus 4.5",
    "GPT-5",
    "Low",
    "Medium",
    "High",
    "Extra High",
    "XHigh",
    "Minimal",
    "Off",
    "Max",
    "Auto",
    "Orchestrator",
    "Thinking",
  ];
  const protectedEls = protectedSamples.map((txt) => makeItem("span", txt));
  const modelBtn = dom.createElement("button");
  modelBtn.setAttribute("title", "Gemini 4 Flash");
  modelBtn.appendChild(dom.createTextNode("Gemini 4 Neon Extra High"));
  dom.body.appendChild(modelBtn);

  // Protected containers (code, monaco, markdown chat body, contenteditable, data-no-translate)
  const preEl = dom.createElement("pre");
  const codeEl = dom.createElement("code");
  codeEl.appendChild(dom.createTextNode("New Conversation"));
  preEl.appendChild(codeEl);
  dom.body.appendChild(preEl);

  const monacoEl = dom.createElement("div");
  monacoEl.setAttribute("class", "monaco-editor");
  const monacoLine = dom.createElement("span");
  monacoLine.appendChild(dom.createTextNode("Settings"));
  monacoEl.appendChild(monacoLine);
  dom.body.appendChild(monacoEl);

  const mdRoot = dom.createElement("div");
  mdRoot.setAttribute("data-markdown-root", "true");
  const mdP = dom.createElement("p");
  mdP.appendChild(dom.createTextNode("Cancel"));
  mdRoot.appendChild(mdP);
  dom.body.appendChild(mdRoot);

  const noTrans = dom.createElement("div");
  noTrans.setAttribute("data-no-translate", "1");
  noTrans.appendChild(dom.createTextNode("Save"));
  dom.body.appendChild(noTrans);

  // Execute via CDP-identical fn.toString() inside isolated VM (proves zero external closures)
  const status = dom.runSelfContained(installHostI18n, { owner: "test-host", mode: "auto" });
  assert.equal(status.applied, true);
  assert.equal(status.active, true);
  assert.equal(status.yielded, false);

  // Assert normal UI translations
  assert.equal(btnNew.textContent, "新建会话");
  assert.equal(btnSettings.textContent, "设置");
  assert.equal(lblThought.textContent, "思考了 12 秒");
  assert.equal(lblWorked.textContent, "用时 2分15秒");
  assert.equal(lblStep.textContent, "第 2 / 5 步");
  assert.equal(lblFiles.textContent, "3 个文件已更改");
  assert.equal(btnDel.textContent, "永久删除");
  assert.equal(btnInbox.textContent, "退回收件箱");
  assert.equal(btnOlder.textContent, "加载更早的消息");
  assert.equal(searchInput.getAttribute("placeholder"), "搜索会话…");
  assert.equal(searchInput.getAttribute("title"), "设置");

  // Assert ALL model names & thinking effort labels remain 100% original English
  for (let i = 0; i < protectedSamples.length; i++) {
    assert.equal(
      protectedEls[i].textContent,
      protectedSamples[i],
      `Protected text was wrongly translated: ${protectedSamples[i]} -> ${protectedEls[i].textContent}`
    );
  }
  assert.equal(modelBtn.textContent, "Gemini 4 Neon Extra High");
  assert.equal(modelBtn.getAttribute("title"), "Gemini 4 Flash");

  // Assert protected containers remain untouched
  assert.equal(codeEl.textContent, "New Conversation");
  assert.equal(monacoLine.textContent, "Settings");
  assert.equal(mdP.textContent, "Cancel");
  assert.equal(noTrans.textContent, "Save");

  // Assert destroy() restores 100% original English text and attributes
  dom.window[HOST_I18N_KEY].destroy();
  assert.equal(dom.window[HOST_I18N_KEY], undefined);
  assert.equal(btnNew.textContent, "New Conversation");
  assert.equal(btnSettings.textContent, "Settings");
  assert.equal(lblThought.textContent, "Thought for 12s");
  assert.equal(lblWorked.textContent, "Worked for 2m 15s");
  assert.equal(lblStep.textContent, "Step 2 of 5");
  assert.equal(lblFiles.textContent, "3 files changed");
  assert.equal(btnDel.textContent, "Delete Permanently");
  assert.equal(btnInbox.textContent, "Return to Inbox");
  assert.equal(btnOlder.textContent, "Load older messages");
  assert.equal(searchInput.getAttribute("placeholder"), "Search conversations...");
  assert.equal(searchInput.getAttribute("title"), "Settings");
});

test("installHostI18n auto mode yields to third-party i18n markers, and ping-pong breaker stops React fight loops", () => {
  const dom = createMockDom();
  const btn = dom.createElement("button");
  const txt = dom.createTextNode("Settings");
  btn.appendChild(txt);
  dom.body.appendChild(btn);

  // Third-party marker present -> auto mode yields cleanly
  const thirdPartyBadge = dom.createElement("div");
  thirdPartyBadge.setAttribute("data-ag-zh-widget", "1");
  dom.body.appendChild(thirdPartyBadge);

  const autoStatus = dom.runSelfContained(installHostI18n, { owner: "o1", mode: "auto" });
  assert.equal(autoStatus.active, false);
  assert.equal(autoStatus.yielded, true);
  assert.equal(btn.textContent, "Settings");

  // Force mode: "on" overrides yield
  const forced = dom.window[HOST_I18N_KEY].update({ owner: "o1", mode: "on" });
  assert.equal(forced.active, true);
  assert.equal(btn.textContent, "设置");

  // Simulate React repeatedly rewriting the same text node back to "Settings"
  const obs = dom.observers.find((o) => o.active);
  assert.ok(obs, "MutationObserver should be active");
  for (let i = 0; i < 8; i++) {
    txt.nodeValue = "Settings";
    obs.emit([{ type: "characterData", target: txt }]);
    dom.window[HOST_I18N_KEY].flush();
  }

  const st = dom.window[HOST_I18N_KEY].status();
  assert.ok(st.trippedNodes >= 1, "Ping-pong breaker should trip on repeated host overwrites");
  assert.equal(txt.nodeValue, "Settings", "Tripped node should be left in original English cleanly");

  dom.window[HOST_I18N_KEY].destroy();
});

// ---------------------------------------------------------------------------
// 3. Swarm i18n engine tests (via CDP-equivalent fn.toString() in isolated VM)
// ---------------------------------------------------------------------------
test("installSwarmI18n translates Swarm UI, skips .msg-body & code, preserves model name in 'Runs on ...', and restores on destroy()", () => {
  const dom = createMockDom();

  const makeEl = (tag, text, cls = "") => {
    const el = dom.createElement(tag);
    if (cls) el.setAttribute("class", cls);
    el.appendChild(dom.createTextNode(text));
    dom.body.appendChild(el);
    return el;
  };

  const tabBoard = makeEl("button", "Board");
  const tabMembers = makeEl("button", "Members");
  const btnExport = makeEl("button", "Export GIF");
  const emptyTitle = makeEl("div", "No swarm in this conversation");
  const runsOn = makeEl("span", "Runs on Gemini 4 Neon");
  const pureModel = makeEl("span", "Gemini 4 Flash");
  const msgBody = makeEl("div", "Board", "msg-body");
  const pre = dom.createElement("pre");
  const code = dom.createElement("code");
  code.appendChild(dom.createTextNode("Export GIF"));
  pre.appendChild(code);
  dom.body.appendChild(pre);

  const st = dom.runSelfContained(installSwarmI18n, { owner: "swarm-owner", mode: "auto" });
  assert.equal(st.applied, true);
  assert.equal(st.active, true);

  assert.equal(tabBoard.textContent, "讨论板");
  assert.equal(tabMembers.textContent, "成员");
  assert.equal(btnExport.textContent, "导出 GIF");
  assert.equal(emptyTitle.textContent, "当前会话暂无蜂群");
  assert.equal(runsOn.textContent, "运行于 Gemini 4 Neon");
  assert.equal(pureModel.textContent, "Gemini 4 Flash");
  // Message bodies and code blocks MUST NOT be touched
  assert.equal(msgBody.textContent, "Board");
  assert.equal(code.textContent, "Export GIF");

  dom.window[SWARM_I18N_KEY].destroy();
  assert.equal(dom.window[SWARM_I18N_KEY], undefined);
  assert.equal(tabBoard.textContent, "Board");
  assert.equal(tabMembers.textContent, "Members");
  assert.equal(btnExport.textContent, "Export GIF");
  assert.equal(runsOn.textContent, "Runs on Gemini 4 Neon");
});

// ---------------------------------------------------------------------------
// 4. Workbench Enhancer tests (codeFold, outlineRail, contextMenu, inlineDiff,
//    fullTextSearch, compactLayout, thoughtTranslate, and full destroy)
// ---------------------------------------------------------------------------
test("installWorkbenchEnhancer handles codeFold (>=48 lines + scroll compensation), contextMenu (slash + file reveal), and compactLayout cleanly", async () => {
  const dom = createMockDom();
  const fetchCalls = [];
  const mockFetch = async (url, init) => {
    fetchCalls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { ok: true };
      },
    };
  };

  // Scrollable conversation container
  const conv = dom.createElement("div");
  conv.setAttribute("data-testid", "conversation-view");
  conv.scrollTop = 600;
  conv.scrollHeight = 2000;
  conv.clientHeight = 500;
  dom.body.appendChild(conv);

  // Composer input
  const composer = dom.createElement("textarea");
  dom.body.appendChild(composer);

  // Short code block (10 lines -> must NOT get fold button)
  const shortPre = dom.createElement("pre");
  const shortCode = dom.createElement("code");
  shortCode.textContent = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join("\n");
  shortPre.appendChild(shortCode);
  conv.appendChild(shortPre);

  // Long code block (60 lines -> MUST get sticky fold pill)
  const longPre = dom.createElement("pre");
  longPre._rect = { left: 0, top: -320, width: 600, height: 960, right: 600, bottom: 640 };
  const longCode = dom.createElement("code");
  longCode.textContent = Array.from({ length: 60 }, (_, i) => `const x${i} = ${i};`).join("\n");
  longPre.appendChild(longCode);
  conv.appendChild(longPre);

  // File pill inside conversation
  const filePill = dom.createElement("a");
  filePill.setAttribute("href", "file:///D:/Fish-code/demo.js");
  filePill.textContent = "demo.js";
  conv.appendChild(filePill);

  const st = dom.runSelfContained(
    installWorkbenchEnhancer,
    {
      owner: "wb-owner",
      sidecarBaseUrl: "http://127.0.0.1:45555",
      sidecarToken: "secret-tok",
      workbench: {
        codeFold: true,
        outlineRail: false,
        contextMenu: true,
        inlineDiff: false,
        fullTextSearch: false,
        compactLayout: true,
        thoughtTranslate: "off",
      },
    },
    { fetch: mockFetch }
  );

  assert.equal(st.applied, true);
  assert.equal(st.counts.codeFoldBlocks, 1);

  // Compact layout active without touching font-size
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-compact"), "1");
  const styleText = dom.head.querySelector("#agy-maomao-workbench-style")?.textContent || "";
  assert.doesNotMatch(styleText, /data-agy-maomao-compact[^}]*font-size/i);

  // Short pre untouched; long pre has fold pill & stays expanded by default
  assert.equal(shortPre.querySelector("[data-agy-maomao-code-fold-btn]"), null);
  const foldBtn = longPre.querySelector("[data-agy-maomao-code-fold-btn]");
  assert.ok(foldBtn);
  assert.match(foldBtn.textContent, /折叠 \(60 行\)/);
  assert.equal(longPre.getAttribute("data-agy-maomao-folded"), null);

  // Click fold -> folds + compensates scrollTop
  const beforeScrollTop = conv.scrollTop;
  longPre._rect = { left: 0, top: -320, width: 600, height: 960, right: 600, bottom: 640 };
  const origRect = longPre.getBoundingClientRect;
  let rectCalls = 0;
  longPre.getBoundingClientRect = () => {
    rectCalls += 1;
    return rectCalls === 1
      ? { left: 0, top: -320, width: 600, height: 960, right: 600, bottom: 640 }
      : { left: 0, top: -320, width: 600, height: 220, right: 600, bottom: -100 };
  };
  foldBtn.click();
  longPre.getBoundingClientRect = origRect;
  assert.equal(longPre.getAttribute("data-agy-maomao-folded"), "1");
  assert.match(foldBtn.textContent, /展开 \(60 行\)/);
  assert.ok(conv.scrollTop < beforeScrollTop, "Folding off-screen top code block should compensate scrollTop");

  // Click again -> unfolds
  foldBtn.click();
  assert.equal(longPre.getAttribute("data-agy-maomao-folded"), null);

  // Context menu on conversation blank area -> slash commands including /btw & /compact
  conv.dispatchEvent({ type: "contextmenu", target: conv, clientX: 120, clientY: 160 });
  const ctx1 = dom.body.querySelector("#agy-maomao-context-menu");
  assert.ok(ctx1, "Slash context menu should open on conversation right-click");
  const btwBtn = ctx1.querySelector('[data-agy-maomao-ctx-action="slash-btw"]');
  assert.ok(btwBtn);
  btwBtn.click();
  assert.equal(composer.value, "/btw ");
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);

  // Context menu on file pill -> copy path, reveal via sidecar API, insert @mention
  filePill.dispatchEvent({ type: "contextmenu", target: filePill, clientX: 200, clientY: 220 });
  const ctx2 = dom.body.querySelector("#agy-maomao-context-menu");
  assert.ok(ctx2, "File context menu should open on file pill right-click");
  const revealBtn = ctx2.querySelector('[data-agy-maomao-ctx-action="reveal-file"]');
  assert.ok(revealBtn);
  revealBtn.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(fetchCalls.length, 1);
  assert.match(fetchCalls[0].url, /\/api\/maomao\/file-action\?token=secret-tok/);
  assert.deepEqual(JSON.parse(fetchCalls[0].init.body), {
    action: "reveal",
    path: "D:\\Fish-code\\demo.js",
  });

  // Hot-toggle compactLayout & codeFold off -> cleans up immediately
  dom.window[WORKBENCH_KEY].update({
    owner: "wb-owner",
    workbench: { codeFold: false, compactLayout: false, contextMenu: false, outlineRail: false, inlineDiff: false, fullTextSearch: false, thoughtTranslate: "off" },
  });
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-compact"), null);
  assert.equal(longPre.querySelector("[data-agy-maomao-code-fold-btn]"), null);
  assert.equal(longPre.getAttribute("data-agy-maomao-foldable"), null);

  // Destroy removes style sheet and global key completely
  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.window[WORKBENCH_KEY], undefined);
  assert.equal(dom.head.querySelector("#agy-maomao-workbench-style"), null);
});

test("installWorkbenchEnhancer supports inlineDiff (cache), fullTextSearch, and dual-mode thoughtTranslate", async () => {
  const dom = createMockDom();
  let diffFetchCount = 0;
  let searchFetchCount = 0;
  let translateFetchCount = 0;

  const mockFetch = async (url, init) => {
    if (url.includes("/api/maomao/git-diff")) {
      diffFetchCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, additions: 2, deletions: 1, diff: "@@ -1,2 +1,3 @@\n-old\n+new1\n+new2" };
        },
      };
    }
    if (url.includes("/api/maomao/search")) {
      searchFetchCount += 1;
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            results: [
              { conversationId: "c1", fallbackTitle: "测试会话", turnNumber: 2, kind: "code", snippet: "found needle here", copyText: "needle" },
            ],
          };
        },
      };
    }
    if (url.includes("/api/maomao/translate")) {
      translateFetchCount += 1;
      const body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        async json() {
          return { ok: true, translatedText: `[译文:${body.mode}] 已分析完毕` };
        },
      };
    }
    return { ok: false, status: 404, async json() { return { ok: false }; } };
  };

  // Turns inside conversation-view (simulating expanded sidebar with left=257)
  const convView = dom.createElement("div");
  convView.setAttribute("data-testid", "conversation-view");
  convView._rect = { left: 257, top: 44, width: 760, height: 660, right: 1017, bottom: 704 };
  const turn1 = dom.createElement("div");
  turn1.setAttribute("data-testid", "user-input-step");
  turn1.textContent = "帮我检查登录接口";
  const turn2 = dom.createElement("div");
  turn2.setAttribute("data-testid", "user-input-step");
  turn2.textContent = "优化数据库查询性能";
  convView.appendChild(turn1);
  convView.appendChild(turn2);
  dom.body.appendChild(convView);

  // File change chip for inlineDiff
  const wrap = dom.createElement("div");
  const chip = dom.createElement("span");
  chip.setAttribute("data-testid", "changed-file-chip");
  chip.setAttribute("data-file-path", "D:\\repo\\app.js");
  chip.textContent = "app.js";
  wrap.appendChild(chip);
  dom.body.appendChild(wrap);

  // Search dialog for fullTextSearch
  const dialog = dom.createElement("div");
  dialog.setAttribute("role", "dialog");
  const searchInput = dom.createElement("input");
  searchInput.setAttribute("placeholder", "Search for conversations...");
  dialog.appendChild(searchInput);
  dom.body.appendChild(dialog);

  // Thought block for thoughtTranslate
  const thoughtWrap = dom.createElement("div");
  const thoughtEl = dom.createElement("div");
  thoughtEl.setAttribute("data-testid", "thought-content");
  thoughtEl.textContent = "Let me carefully analyze the architecture and verify every invariant before editing.";
  thoughtWrap.appendChild(thoughtEl);
  dom.body.appendChild(thoughtWrap);

  dom.runSelfContained(
    installWorkbenchEnhancer,
    {
      owner: "wb2",
      sidecarBaseUrl: "http://127.0.0.1:45555",
      sidecarToken: "tok",
      workbench: {
        codeFold: false,
        outlineRail: true,
        contextMenu: false,
        inlineDiff: true,
        fullTextSearch: true,
        compactLayout: false,
        thoughtTranslate: "off",
        thoughtView: "immersive",
      },
    },
    { fetch: mockFetch }
  );

  // 1. Thought translate MUST do zero work when off
  assert.equal(translateFetchCount, 0);
  assert.equal(thoughtEl.getAttribute("data-agy-maomao-thought-hidden"), null);

  // 2. Removed outlineRail MUST NEVER mount even if legacy config passes outlineRail: true
  assert.equal(dom.body.querySelector("#agy-maomao-outline-rail"), null);
  assert.equal(dom.body.querySelector("#agy-maomao-outline-pop"), null);
  dom.document.dispatchEvent({ type: "keydown", altKey: true, key: "ArrowDown", preventDefault() {} });
  assert.equal(turn1.scrolledIntoViewCount, 0);

  // 3. Inline diff expand + collapse + memory cache reuse
  const diffBtn = wrap.querySelector("[data-agy-maomao-diff-btn]");
  assert.ok(diffBtn);
  diffBtn.click();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(diffFetchCount, 1);
  const diffPanel = wrap.querySelector("[data-agy-maomao-diff-panel]");
  assert.ok(diffPanel);
  assert.match(diffPanel.textContent, /\+new1/);
  // Close & re-open -> hits in-memory cache (no second fetch)
  diffBtn.click();
  assert.equal(wrap.querySelector("[data-agy-maomao-diff-panel]"), null);
  diffBtn.click();
  await new Promise((r) => setTimeout(r, 15));
  assert.equal(diffFetchCount, 1);

  // 4. Native search full-text enhancement
  const searchPanel = dialog.querySelector("[data-agy-maomao-search-panel]");
  assert.ok(searchPanel);
  searchInput.value = "needle";
  searchInput.dispatchEvent({ type: "input" });
  await new Promise((r) => setTimeout(r, 260));
  assert.equal(searchFetchCount, 1);
  assert.match(searchPanel.textContent, /测试会话/);
  // Switch scope tab to "code"
  const codeTab = searchPanel.querySelector('[data-scope="code"]');
  assert.ok(codeTab);
  codeTab.click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(searchFetchCount, 2);

  // 5. Enable thoughtTranslate -> translates, hides original in immersive mode, shows both in bilingual
  dom.window[WORKBENCH_KEY].update({
    owner: "wb2",
    sidecarBaseUrl: "http://127.0.0.1:45555",
    sidecarToken: "tok",
    workbench: {
      codeFold: false,
      outlineRail: true,
      contextMenu: false,
      inlineDiff: true,
      fullTextSearch: true,
      compactLayout: false,
      thoughtTranslate: "machine",
      thoughtView: "immersive",
    },
  });
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(translateFetchCount, 1);
  assert.equal(thoughtEl.getAttribute("data-agy-maomao-thought-hidden"), "1");
  const thoughtBox = thoughtWrap.querySelector("[data-agy-maomao-thought-box]");
  assert.ok(thoughtBox);
  assert.match(thoughtBox.textContent, /已分析完毕/);

  // Switch to bilingual -> original becomes visible alongside translation
  dom.window[WORKBENCH_KEY].update({
    owner: "wb2",
    sidecarBaseUrl: "http://127.0.0.1:45555",
    sidecarToken: "tok",
    workbench: {
      codeFold: false,
      outlineRail: true,
      contextMenu: false,
      inlineDiff: true,
      fullTextSearch: true,
      compactLayout: false,
      thoughtTranslate: "machine",
      thoughtView: "bilingual",
    },
  });
  assert.equal(thoughtEl.getAttribute("data-agy-maomao-thought-hidden"), null);

  // Destroy cleans everything up
  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.window[WORKBENCH_KEY], undefined);
  assert.equal(dom.body.querySelector("#agy-maomao-outline-rail"), null);
  assert.equal(wrap.querySelector("[data-agy-maomao-diff-btn]"), null);
  assert.equal(wrap.querySelector("[data-agy-maomao-diff-panel]"), null);
  assert.equal(dialog.querySelector("[data-agy-maomao-search-panel]"), null);
  assert.equal(thoughtWrap.querySelector("[data-agy-maomao-thought-box]"), null);
  assert.equal(thoughtEl.getAttribute("data-agy-maomao-thought-hidden"), null);
});

test("installHostI18n and installWorkbenchEnhancer cooperate cleanly without clobbering search placeholder or workbench UI", async () => {
  const dom = createMockDom();
  const dialog = dom.createElement("div");
  dialog.setAttribute("role", "dialog");
  const searchInput = dom.createElement("input");
  searchInput.setAttribute("placeholder", "Search for conversations...");
  dialog.appendChild(searchInput);
  dom.body.appendChild(dialog);

  const modelBadge = dom.createElement("span");
  modelBadge.appendChild(dom.createTextNode("Gemini 4 Neon Extra High"));
  dom.body.appendChild(modelBadge);

  dom.runSelfContained(installHostI18n, { owner: "coop", mode: "on" });
  assert.equal(searchInput.getAttribute("placeholder"), "搜索会话…");
  assert.equal(modelBadge.textContent, "Gemini 4 Neon Extra High");

  // Workbench fullTextSearch STILL discovers the translated search input
  dom.runSelfContained(installWorkbenchEnhancer, {
    owner: "coop",
    sidecarBaseUrl: "http://127.0.0.1:45555",
    sidecarToken: "tok",
    workbench: {
      codeFold: false,
      outlineRail: false,
      contextMenu: false,
      inlineDiff: false,
      fullTextSearch: true,
      compactLayout: false,
      thoughtTranslate: "off",
    },
  });

  const panel = dialog.querySelector("[data-agy-maomao-search-panel]");
  assert.ok(panel, "Workbench should find search input even after host-i18n translated its placeholder");

  dom.window[WORKBENCH_KEY].destroy();
  dom.window[HOST_I18N_KEY].destroy();
  assert.equal(searchInput.getAttribute("placeholder"), "Search for conversations...");
});

// ---------------------------------------------------------------------------
// 5. REV 2 Radial Pie Ring Context Menu tests
// ---------------------------------------------------------------------------
test("installWorkbenchEnhancer REV 6 renders 6-slice SVG Radial Pie Ring, handles all 6 slices (/swarm, /btw, /compact, /plan, /grill-me, /learn), edge clamping, Shift bypass, exclusion zones, and clean destroy()", async () => {
  assert.equal(WORKBENCH_REV, 6);

  const dom = createMockDom();
  const conv = dom.createElement("div");
  conv.setAttribute("data-testid", "conversation-view");
  dom.body.appendChild(conv);

  const msg = dom.createElement("div");
  msg.setAttribute("data-testid", "agent-response");
  msg.textContent = "Hello world";
  conv.appendChild(msg);

  // Safe exclusion targets inside or alongside conversation
  const codeWrap = dom.createElement("pre");
  const codeNode = dom.createElement("code");
  codeNode.textContent = "const a = 1;";
  codeWrap.appendChild(codeNode);
  msg.appendChild(codeWrap);

  const extLink = dom.createElement("a");
  extLink.setAttribute("href", "https://example.com");
  extLink.textContent = "Example";
  msg.appendChild(extLink);

  const actionBtn = dom.createElement("button");
  actionBtn.textContent = "Copy";
  msg.appendChild(actionBtn);

  const sidebar = dom.createElement("aside");
  dom.body.appendChild(sidebar);

  // Main composer (Lexical-style contenteditable) + separate side-question panel
  const inputBox = dom.createElement("div");
  inputBox.setAttribute("data-testid", "agent-input-box");
  const composer = dom.createElement("div");
  composer.setAttribute("contenteditable", "true");
  composer.setAttribute("data-lexical-editor", "true");
  inputBox.appendChild(composer);
  dom.body.appendChild(inputBox);

  // Simulate an older rev 1 instance -> REV 2 must upgrade & replace cleanly
  let legacyDestroyed = false;
  dom.window[WORKBENCH_KEY] = {
    rev: 1,
    owner: "wb-radial",
    lastSeen: Date.now(),
    destroy() { legacyDestroyed = true; delete dom.window[WORKBENCH_KEY]; },
  };

  const st = dom.runSelfContained(installWorkbenchEnhancer, {
    owner: "wb-radial",
    themeStyle: "star-neko",
    workbench: {
      codeFold: false,
      outlineRail: false,
      contextMenu: true,
      inlineDiff: false,
      fullTextSearch: false,
      compactLayout: false,
      thoughtTranslate: "off",
    },
  });
  assert.equal(legacyDestroyed, true);
  assert.equal(st.rev, 6);
  assert.equal(dom.window[WORKBENCH_KEY].rev, 6);

  // 1. Shift + Right-click bypasses radial menu and does NOT preventDefault
  const shiftEv = { type: "contextmenu", target: msg, clientX: 400, clientY: 300, shiftKey: true };
  msg.dispatchEvent(shiftEv);
  assert.equal(shiftEv.defaultPrevented, false);
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);

  // 2. Host exclusion zones (code block, external link, button, composer, sidebar) do NOT open radial menu
  for (const excludedTarget of [codeNode, extLink, actionBtn, composer, sidebar]) {
    const ev = { type: "contextmenu", target: excludedTarget, clientX: 300, clientY: 300 };
    excludedTarget.dispatchEvent(ev);
    assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null, `Excluded element ${excludedTarget.tagName} should not trigger radial menu`);
  }

  // 3. Viewport edge clamping (top-left & bottom-right corners)
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 4, clientY: 6 });
  let radial = dom.body.querySelector("#agy-maomao-context-menu");
  assert.ok(radial);
  assert.equal(radial.getAttribute("data-agy-maomao-menu-kind"), "radial");
  assert.equal(radial.getAttribute("data-theme-style"), "star-neko");
  assert.equal(Number(radial.getAttribute("data-clamped-x")), 140);
  assert.equal(Number(radial.getAttribute("data-clamped-y")), 140);
  assert.equal(radial.style.left, "12px");
  assert.equal(radial.style.top, "12px");

  // Close by clicking central hub
  const hubClose = radial.querySelector('[data-agy-maomao-ctx-action="close-radial"]');
  assert.ok(hubClose);
  hubClose.click();
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);

  // Bottom-right corner clamping (1280x720 -> max cx = 1280-140 = 1140, max cy = 720-140 = 580)
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 1276, clientY: 718 });
  radial = dom.body.querySelector("#agy-maomao-context-menu");
  assert.ok(radial);
  assert.equal(Number(radial.getAttribute("data-clamped-x")), 1140);
  assert.equal(Number(radial.getAttribute("data-clamped-y")), 580);
  assert.equal(radial.style.left, "1012px");
  assert.equal(radial.style.top, "452px");

  // Verify 6 slices exist with SVG annular paths
  const slices = radial.querySelectorAll(".agy-mm-pie-slice");
  assert.equal(slices.length, 6);
  const cmds = slices.map((s) => s.getAttribute("data-cmd"));
  assert.deepEqual(cmds, ["/swarm", "/btw", "/compact", "/plan", "/grill-me", "/learn"]);
  for (const s of slices) {
    const p = s.querySelector(".agy-mm-pie-path");
    assert.ok(p && /^M .* A .* L .* A .* Z$/.test(p.getAttribute("d") || ""));
  }

  // Close via Escape
  dom.document.dispatchEvent({ type: "keydown", key: "Escape" });
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);

  // 4. Test all 6 slices trigger expected composer insertions
  const expectedByAction = [
    ["slash-swarm", "/swarm "],
    ["slash-btw", "/btw "],
    ["slash-compact", "/compact"],
    ["slash-plan", "/plan "],
    ["slash-grill-me", "/grill-me "],
    ["slash-learn", "/learn "],
  ];
  for (const [actionId, expectedText] of expectedByAction) {
    composer.textContent = "";
    msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
    const menu = dom.body.querySelector("#agy-maomao-context-menu");
    const slice = menu.querySelector(`[data-agy-maomao-ctx-action="${actionId}"]`);
    assert.ok(slice, `Slice ${actionId} should exist`);
    slice.click();
    assert.equal(composer.textContent, expectedText);
    assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);
  }

  // 5. Native selection /btw button priority + selection copy hub
  dom.window.getSelection = () => "explain this cache behavior";
  const nativeBtwBtn = dom.createElement("button");
  nativeBtwBtn.setAttribute("data-testid", "selection-btw-button");
  dom.body.appendChild(nativeBtwBtn);

  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  radial = dom.body.querySelector("#agy-maomao-context-menu");
  const copyHub = radial.querySelector('[data-agy-maomao-ctx-action="copy-selection"]');
  assert.ok(copyHub, "Hub should become copy-selection when text is selected");
  copyHub.click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(dom.clipboardWrites.at(-1), "explain this cache behavior");

  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  radial = dom.body.querySelector("#agy-maomao-context-menu");
  radial.querySelector('[data-agy-maomao-ctx-action="slash-btw"]').click();
  assert.equal(nativeBtwBtn.clickedCount, 1, "/btw slice should prefer native selection-btw-button when available");
  dom.window.getSelection = () => "";

  // 6. Pointer leave past radial radius auto-dismisses menu
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  assert.ok(dom.body.querySelector("#agy-maomao-context-menu"));
  dom.document.dispatchEvent({ type: "pointermove", clientX: 900, clientY: 360 });
  await new Promise((r) => setTimeout(r, 310));
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);

  // 7. Official style switch + destroy() leaves zero listeners or DOM remnants
  dom.window[WORKBENCH_KEY].update({ owner: "wb-radial", themeStyle: "official", workbench: { contextMenu: true } });
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  radial = dom.body.querySelector("#agy-maomao-context-menu");
  assert.equal(radial.getAttribute("data-theme-style"), "official");

  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.window[WORKBENCH_KEY], undefined);
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);
  assert.equal(dom.head.querySelector("#agy-maomao-workbench-style"), null);

  // After destroy, right-click does nothing
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  assert.equal(dom.body.querySelector("#agy-maomao-context-menu"), null);
});

// ---------------------------------------------------------------------------
// 6. Typing / Backspace zero-overhead MutationObserver fast-skip & grace window
// ---------------------------------------------------------------------------
test("host-i18n REV 3 and workbench-enhancer REV 6 fast-skip editable/composer mutations and defer during typing grace window (0ms typing/backspace overhead)", async () => {
  assert.equal(HOST_I18N_REV, 3);
  assert.equal(SWARM_I18N_REV, 2);
  assert.equal(WORKBENCH_REV, 6);

  const dom = createMockDom();
  const inputBox = dom.createElement("div");
  inputBox.setAttribute("data-testid", "agent-input-box");
  const lexical = dom.createElement("div");
  lexical.setAttribute("data-lexical-editor", "true");
  lexical.setAttribute("contenteditable", "true");
  const editSpan = dom.createElement("span");
  const editText = dom.createTextNode("Settings hello world");
  editSpan.appendChild(editText);
  lexical.appendChild(editSpan);
  inputBox.appendChild(lexical);
  dom.body.appendChild(inputBox);

  const agentResp = dom.createElement("div");
  agentResp.setAttribute("data-testid", "agent-response");
  const respText = dom.createTextNode("streaming token");
  agentResp.appendChild(respText);
  dom.body.appendChild(agentResp);

  // Set focused editable element
  dom.document.activeElement = lexical;

  const i18nSt = dom.runSelfContained(installHostI18n, { owner: "perf-test", mode: "on" });
  assert.equal(i18nSt.rev, 3);

  const wbSt = dom.runSelfContained(installWorkbenchEnhancer, {
    owner: "perf-test",
    workbench: {
      codeFold: true,
      outlineRail: true,
      contextMenu: true,
      inlineDiff: true,
      fullTextSearch: true,
      compactLayout: false,
      thoughtTranslate: "off",
    },
  });
  assert.equal(wbSt.rev, 6);

  const activeObservers = dom.observers.filter((o) => o.active && o._opts && o._opts.subtree);
  assert.equal(activeObservers.length, 2);

  // Simulate rapid Backspace / typing mutations inside Lexical editor and streaming agent-response
  for (let i = 0; i < 12; i++) {
    dom.document.dispatchEvent({ type: "keydown", key: "Backspace", target: lexical });
    dom.document.dispatchEvent({ type: "input", target: lexical });
    editText.nodeValue = "Settings " + i;
    for (const obs of activeObservers) {
      obs.emit([
        { type: "characterData", target: editText },
        { type: "childList", target: lexical, addedNodes: [editSpan] },
        { type: "characterData", target: respText },
      ]);
    }
  }

  // Even after waiting past normal 48ms/90ms throttle, zero flushes/rescans should occur for editor mutations!
  await new Promise((r) => setTimeout(r, 110));
  const i18nMid = dom.window[HOST_I18N_KEY].status();
  const wbMid = dom.window[WORKBENCH_KEY].status();
  assert.equal(i18nMid.flushCount, 0, "host-i18n must not flush on editor/agent-response mutations");
  assert.ok(i18nMid.skippedMutations >= 24);
  assert.equal(wbMid.counts.scans, 0, "workbench-enhancer must not rescan on editor mutations");
  assert.ok(wbMid.counts.skippedMutations >= 12);

  // Now simulate a genuine UI button added outside editor WHILE typing grace window (220ms) is active
  dom.document.dispatchEvent({ type: "keydown", key: "Backspace", target: lexical });
  const newUiBtn = dom.createElement("button");
  newUiBtn.appendChild(dom.createTextNode("New Conversation"));
  dom.body.appendChild(newUiBtn);
  for (const obs of activeObservers) {
    obs.emit([{ type: "childList", target: dom.body, addedNodes: [newUiBtn] }]);
  }

  // Within 80ms (< 220ms typing grace window), must defer without stealing typing frames
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(dom.window[HOST_I18N_KEY].status().flushCount, 0, "Should defer UI flush during active typing grace window");
  assert.equal(newUiBtn.textContent, "New Conversation");

  // After typing stops (> 240ms), deferred UI flush translates the new button automatically
  await new Promise((r) => setTimeout(r, 210));
  assert.equal(dom.window[HOST_I18N_KEY].status().flushCount, 1);
  assert.equal(newUiBtn.textContent, "新建会话");

  // Clean destroy removes all listeners
  dom.window[HOST_I18N_KEY].destroy();
  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.docListeners.get("keydown")?.size || 0, 0);
  assert.equal(dom.docListeners.get("input")?.size || 0, 0);
});

// ---------------------------------------------------------------------------
// 7. outlineRail permanent removal & legacy node cleanup + floating thin scrollbar styling
// ---------------------------------------------------------------------------
test("workbench-enhancer REV 6 permanently removes outlineRail, purges any legacy outline DOM nodes on hot upgrade, and keeps floating thin scrollbars", () => {
  const dom = createMockDom();
  const convView = dom.createElement("div");
  convView.setAttribute("data-testid", "conversation-view");
  const turn = dom.createElement("div");
  turn.setAttribute("data-testid", "user-input-step");
  turn.setAttribute("data-agy-maomao-turn-pulse", "1");
  turn.textContent = "测试大纲彻底移除";
  convView.appendChild(turn);
  dom.body.appendChild(convView);

  // Plant legacy outline nodes from older REV <= 5
  const legacyRail = dom.createElement("div");
  legacyRail.setAttribute("id", "agy-maomao-outline-rail");
  const legacyPop = dom.createElement("div");
  legacyPop.setAttribute("id", "agy-maomao-outline-pop");
  dom.body.appendChild(legacyRail);
  dom.body.appendChild(legacyPop);

  // Even when legacy settings still pass outlineRail: true, REV 6 purges legacy nodes and NEVER mounts outline DOM
  const st = dom.runSelfContained(installWorkbenchEnhancer, {
    owner: "wb-outline-removed",
    workbench: { outlineRail: true },
  });
  assert.equal(st.rev, 6);
  assert.equal("outlineRail" in st.workbench, false);
  assert.equal(dom.body.querySelector("#agy-maomao-outline-rail"), null);
  assert.equal(dom.body.querySelector("#agy-maomao-outline-pop"), null);
  assert.equal(turn.getAttribute("data-agy-maomao-turn-pulse"), null);

  // Verify floating thin scrollbar CSS rules (5px, hidden scrollbar-button, transparent track) remain intact
  const css = dom.head.querySelector("#agy-maomao-workbench-style")?.textContent || "";
  assert.doesNotMatch(css, /\.agy-mm-outline-rail/);
  assert.match(css, /\.agy-mm-search-list,\s*\.agy-mm-diff-body[\s\S]*scrollbar-width:\s*thin/);
  assert.match(css, /::-webkit-scrollbar-button\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /::-webkit-scrollbar\s*\{\s*width:\s*5px;\s*height:\s*5px;/);
  assert.match(css, /::-webkit-scrollbar-track[\s\S]*background:\s*transparent\s*!important/);

  // Alt+ArrowDown must NOT hijack navigation
  dom.document.dispatchEvent({ type: "keydown", altKey: true, key: "ArrowDown", preventDefault() {} });
  assert.equal(turn.scrolledIntoViewCount, 0);

  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.window[WORKBENCH_KEY], undefined);
});

// ---------------------------------------------------------------------------
// 8. Radial Pie Ring zero square outer card + 4-surface adaptation (dark/light/glass-dark/glass-light)
// ---------------------------------------------------------------------------
test("workbench-enhancer REV 6 strips any outer square box on radial menu and adapts all panels across dark, light, glass-dark, and glass-light surfaces", () => {
  const dom = createMockDom();
  const conv = dom.createElement("div");
  conv.setAttribute("data-testid", "conversation-view");
  const msg = dom.createElement("div");
  msg.setAttribute("data-testid", "agent-response");
  msg.textContent = "Surface theme test";
  conv.appendChild(msg);
  dom.body.appendChild(conv);

  // 1. Pure Dark (no agy-dream-active-v2, html.dark)
  dom.documentElement.className = "dark";
  const st1 = dom.runSelfContained(installWorkbenchEnhancer, {
    owner: "wb-surface",
    workbench: { contextMenu: true },
  });
  assert.equal(st1.rev, 6);
  assert.equal(st1.surface, "dark");
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-wb-surface"), "dark");

  // Open radial menu & verify strict circular transparent outer box + inner circular ring
  msg.dispatchEvent({ type: "contextmenu", target: msg, clientX: 500, clientY: 360 });
  const radial = dom.body.querySelector("#agy-maomao-context-menu");
  assert.ok(radial);
  assert.equal(radial.getAttribute("data-agy-maomao-radial"), "1");
  assert.equal(radial.getAttribute("data-surface"), "dark");
  assert.equal(radial.style.background, "transparent");
  assert.equal(radial.style.backgroundImage, "none");
  assert.equal(radial.style.border, "0");
  assert.equal(radial.style.boxShadow, "none");
  assert.equal(radial.style.backdropFilter, "none");
  assert.equal(radial.style.borderRadius, "50%");
  assert.equal(radial.style.padding, "0");
  assert.ok(radial.querySelector(".agy-mm-radial-glass-ring"), "Inner circular glass ring element should exist");

  // Verify CSS defines all 4 surface token sets & strict no-box rules for [data-agy-maomao-radial="1"]
  const css = dom.head.querySelector("#agy-maomao-workbench-style")?.textContent || "";
  assert.match(css, /html\[data-agy-maomao-wb-surface="dark"\]/);
  assert.match(css, /html\[data-agy-maomao-wb-surface="light"\]/);
  assert.match(css, /html\[data-agy-maomao-wb-surface="glass-dark"\]/);
  assert.match(css, /html\[data-agy-maomao-wb-surface="glass-light"\]/);
  assert.match(css, /\[data-agy-maomao-radial="1"\][\s\S]*background:\s*transparent\s*!important/);
  assert.match(css, /\[data-agy-maomao-radial="1"\][\s\S]*backdrop-filter:\s*none\s*!important/);
  assert.match(css, /\[data-agy-maomao-radial="1"\][\s\S]*border-radius:\s*50%\s*!important/);
  assert.match(css, /\.agy-mm-radial-glass-ring[\s\S]*border-radius:\s*50%[\s\S]*backdrop-filter:\s*blur\(18px\)\s*saturate\(155%\)/);

  // 2. Pure Light (switch html class -> live themeObserver updates open radial & html attr)
  dom.documentElement.className = "light";
  const themeObs = dom.observers.find((o) => o.active && o._targets.includes(dom.documentElement));
  assert.ok(themeObs, "Surface MutationObserver should watch documentElement");
  themeObs.emit([{ type: "attributes", target: dom.documentElement, attributeName: "class" }]);
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-wb-surface"), "light");
  assert.equal(radial.getAttribute("data-surface"), "light");

  // 3. Glass Dark (agy-dream-active-v2 + dark)
  dom.documentElement.className = "dark agy-dream-active-v2";
  themeObs.emit([{ type: "attributes", target: dom.documentElement, attributeName: "class" }]);
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-wb-surface"), "glass-dark");
  assert.equal(radial.getAttribute("data-surface"), "glass-dark");

  // 4. Glass Light (wallpaper element + light data-theme)
  dom.documentElement.className = "";
  dom.documentElement.setAttribute("data-theme", "light");
  const wp = dom.createElement("div");
  wp.setAttribute("id", "agy-dream-wallpaper-v2");
  dom.body.appendChild(wp);
  themeObs.emit([{ type: "attributes", target: dom.documentElement, attributeName: "data-theme" }]);
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-wb-surface"), "glass-light");
  assert.equal(radial.getAttribute("data-surface"), "glass-light");

  // Cleanup removes surface attribute and disconnects theme observer
  dom.window[WORKBENCH_KEY].destroy();
  assert.equal(dom.documentElement.getAttribute("data-agy-maomao-wb-surface"), null);
  assert.equal(themeObs.active, false);
});

// ---------------------------------------------------------------------------
// 9. host-i18n REV 3 & swarm-i18n REV 2 reload(), forceRescan(), breakerEpoch,
//    red-line override filtering, and SPA #root replacement self-heal
// ---------------------------------------------------------------------------
test("host-i18n REV 3 & swarm-i18n REV 2 support reload() breaker reset + hot dict merge with red-line guard, forceRescan(), and #root / SPA auto self-heal", async () => {
  assert.equal(HOST_I18N_REV, 3);
  assert.equal(SWARM_I18N_REV, 2);

  const dom = createMockDom();
  const root1 = dom.createElement("div");
  root1.setAttribute("id", "root");
  dom.body.appendChild(root1);

  const btnSettings = dom.createElement("button");
  const txtSettings = dom.createTextNode("Settings");
  btnSettings.appendChild(txtSettings);
  root1.appendChild(btnSettings);

  const customLabel = dom.createElement("span");
  customLabel.appendChild(dom.createTextNode("Custom Release Channel"));
  root1.appendChild(customLabel);

  const modelEl = dom.createElement("span");
  modelEl.appendChild(dom.createTextNode("Gemini 4 Neon Extra High"));
  root1.appendChild(modelEl);

  const effortEl = dom.createElement("span");
  effortEl.appendChild(dom.createTextNode("Extra High"));
  root1.appendChild(effortEl);

  const st0 = dom.runSelfContained(installHostI18n, { owner: "reload-owner", mode: "on" });
  assert.equal(st0.rev, 3);
  assert.equal(st0.reloadedAt, 0);
  assert.ok(st0.dictSize >= 200);
  assert.equal(st0.rescanCount, 1);
  assert.equal(st0.trippedNodeCount, 0);
  assert.equal(btnSettings.textContent, "设置");
  assert.equal(customLabel.textContent, "Custom Release Channel");

  // Trip ping-pong breaker on txtSettings
  const obs = dom.observers.find((o) => o.active);
  assert.ok(obs);
  for (let i = 0; i < 8; i++) {
    txtSettings.nodeValue = "Settings";
    obs.emit([{ type: "characterData", target: txtSettings }]);
    dom.window[HOST_I18N_KEY].flush();
  }
  const stTripped = dom.window[HOST_I18N_KEY].status();
  assert.ok(stTripped.trippedNodeCount >= 1);
  assert.equal(txtSettings.nodeValue, "Settings");

  // reload() resets breakerEpoch, hot-merges custom dict, AND blocks protected model/effort overrides!
  const stReloaded = dom.window[HOST_I18N_KEY].reload({
    dict: {
      "Custom Release Channel": "自定义发布通道",
      "Gemini 4 Neon Extra High": "不应被汉化的模型",
      "Extra High": "超高",
    },
  });
  assert.equal(stReloaded.trippedNodeCount, 0);
  assert.ok(stReloaded.breakerEpoch > stTripped.breakerEpoch);
  assert.ok(stReloaded.reloadedAt > 0);
  assert.equal(stReloaded.dictSize, st0.dictSize + 1, "Only non-protected custom entry should increase dictSize");
  assert.ok(stReloaded.rescanCount >= 2);
  assert.equal(btnSettings.textContent, "设置", "Previously tripped node should translate again after reload()");
  assert.equal(customLabel.textContent, "自定义发布通道");
  assert.equal(modelEl.textContent, "Gemini 4 Neon Extra High", "Override dict MUST NOT translate model name");
  assert.equal(effortEl.textContent, "Extra High", "Override dict MUST NOT translate effort level");

  // forceRescan() increments breakerEpoch & rescanCount cleanly
  const beforeRescans = stReloaded.rescanCount;
  const stForced = dom.window[HOST_I18N_KEY].forceRescan();
  assert.equal(stForced.rescanCount, beforeRescans + 1);
  assert.equal(stForced.trippedNodeCount, 0);

  // Simulate AGY SPA #root replacement -> auto-debounced self-heal rescan translates new root
  root1.remove();
  const root2 = dom.createElement("div");
  root2.setAttribute("id", "root");
  const freshBtn = dom.createElement("button");
  freshBtn.appendChild(dom.createTextNode("New Conversation"));
  root2.appendChild(freshBtn);
  dom.body.appendChild(root2);
  obs.emit([{ type: "childList", target: dom.body, addedNodes: [root2] }]);
  await new Promise((r) => setTimeout(r, 210));
  assert.equal(freshBtn.textContent, "新建会话", "#root replacement should trigger automatic self-heal rescan");
  assert.ok(dom.window[HOST_I18N_KEY].status().rescanCount > stForced.rescanCount);

  // Simulate SPA hashchange -> triggers debounced auto-rescan
  const dynamicSpan = dom.createElement("span");
  dynamicSpan.appendChild(dom.createTextNode("Automations"));
  root2.appendChild(dynamicSpan);
  dom.window.dispatchEvent({ type: "hashchange" });
  await new Promise((r) => setTimeout(r, 210));
  assert.equal(dynamicSpan.textContent, "自动化");

  // Verify destroy() cleans up SPA listeners cleanly
  dom.window[HOST_I18N_KEY].destroy();
  assert.equal(dom.winListeners.get("pageshow")?.size || 0, 0);
  assert.equal(dom.winListeners.get("hashchange")?.size || 0, 0);
  assert.equal(dom.winListeners.get("popstate")?.size || 0, 0);

  // Also verify Swarm i18n REV 2 reload() + forceRescan() + status fields
  const swarmDom = createMockDom();
  const swarmBtn = swarmDom.createElement("button");
  swarmBtn.appendChild(swarmDom.createTextNode("Board"));
  const swarmCustom = swarmDom.createElement("span");
  swarmCustom.appendChild(swarmDom.createTextNode("Custom Swarm View"));
  const swarmModel = swarmDom.createElement("span");
  swarmModel.appendChild(swarmDom.createTextNode("Gemini 4 Flash"));
  swarmDom.body.appendChild(swarmBtn);
  swarmDom.body.appendChild(swarmCustom);
  swarmDom.body.appendChild(swarmModel);

  const sw0 = swarmDom.runSelfContained(installSwarmI18n, { owner: "sw-owner", mode: "on" });
  assert.equal(sw0.rev, 2);
  assert.ok(sw0.dictSize >= 100);
  assert.equal(swarmBtn.textContent, "讨论板");

  const swReloaded = swarmDom.window[SWARM_I18N_KEY].reload({
    dict: { "Custom Swarm View": "自定义蜂群视图", "Gemini 4 Flash": "不应译" },
  });
  assert.ok(swReloaded.reloadedAt > 0);
  assert.equal(swarmCustom.textContent, "自定义蜂群视图");
  assert.equal(swarmModel.textContent, "Gemini 4 Flash");
  assert.equal(swarmDom.window[SWARM_I18N_KEY].forceRescan().trippedNodeCount, 0);

  swarmDom.window[SWARM_I18N_KEY].destroy();
  assert.equal(swarmDom.window[SWARM_I18N_KEY], undefined);
});






