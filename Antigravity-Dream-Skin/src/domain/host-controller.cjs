const { discover, listTargets, Cdp } = require("../../../shared/host.cjs");
const { installTheme, installPluginFrameTheme } = require("../host/theme.cjs");
class HostController {
  constructor(loader, onStatus, options = {}) {
    this.owner = options.owner || require("node:crypto").randomUUID();
    this.loader = loader;
    this.onStatus = onStatus;
    this.onHostPatch = typeof options.onHostPatch === "function" ? options.onHostPatch : null;
    this.discover = options.discover || discover;
    this.listTargets = options.listTargets || listTargets;
    this.createClient = options.createClient || (url => new Cdp(url));
    this.client = null;
    this.port = null;
    this.frameClients = new Map();
    this.settings = { enabled: false };
    this.status = { connected: false, applied: false, message: "等待连接 Antigravity" };
    this.signature = null;
    this.revision = 0;
  }
  report(value) {
    this.status = { ...this.status, ...value };
    try { this.onStatus(this.status); } catch (error) {
      console.warn("皮肤状态通知失败：", error.message);
    }
  }
  tick() {
    if (this.stopping) return Promise.resolve();
    if (!this.inflight) {
      this.inflight = this.drain().finally(() => { this.inflight = null; });
    }
    return this.inflight;
  }
  async drain() {
    let revision;
    do {
      revision = this.revision;
      await this.runTick(revision);
    } while (!this.stopping && revision !== this.revision);
  }
  async runTick(revision) {
    const settings = { ...this.settings };
    try {
      if (!this.client || this.client.closed) {
        const found = await this.discover();
        if (!found) {
          this.port = null;
          this.closeFrameClients();
          this.report({ connected: false, applied: false, message: "未检测到宿主调试端口（如经 Cockpit Tools 切号重开，可点击一键以调试模式重启）" });
          return;
        }
        this.port = found.port;
        this.client = this.createClient(found.target.webSocketDebuggerUrl);
        this.signature = null;
      }
      const current = await this.client.evaluate(
        "({ready:document.readyState,themed:!!window.__agyDreamSkinV2?.status().applied,owner:window.__agyDreamSkinV2?.owner,rev:window.__agyDreamSkinV2?.rev||0,stale:typeof window.__agyDreamSkinV2?.lastSeen==='number'&&(Date.now()-window.__agyDreamSkinV2.lastSeen>15000),chatWidth:window.__agyDreamSkinV2?.consumeChatWidth?.()??null})"
      );
      if (revision !== this.revision || this.stopping) return;
      if (!settings.enabled) {
        if (current.themed && (current.owner === this.owner || current.stale)) {
          await this.client.evaluate("window.__agyDreamSkinV2?.destroy()");
        }
        await this.syncPluginFrames(null);
        this.signature = null;
        this.report({
          connected: true, applied: false,
          message: current.themed && current.owner !== this.owner && !current.stale
            ? "已连接 · 当前实例未启用，另一个皮肤实例正在运行"
            : "已连接 · 皮肤已关闭，宿主恢复原样"
        });
        return;
      }
      const canUpgradeLegacy =
        current.themed &&
        current.owner !== this.owner &&
        !current.stale &&
        typeof current.rev === "number" &&
        current.rev > 0 &&
        current.rev < 21 &&
        (current.owner === "antigravity-star-suite-plugin" || String(current.owner).startsWith("antigravity-star-suite-"));
      if (current.themed && current.owner !== this.owner && !current.stale && !canUpgradeLegacy) {
        this.report({ connected: true, applied: false, message: "已连接 · 皮肤由另一个运行实例管理" });
        return;
      }
      if (current.themed && (current.stale || current.owner !== this.owner)) {
        await this.client.evaluate("window.__agyDreamSkinV2?.destroy()");
        this.signature = null;
      }
      let effectiveSettings = settings;
      if (
        current.themed &&
        current.owner === this.owner &&
        typeof current.chatWidth === "number" &&
        current.chatWidth !== effectiveSettings.chatWidth
      ) {
        effectiveSettings = { ...effectiveSettings, chatWidth: current.chatWidth };
        this.settings = { ...this.settings, chatWidth: current.chatWidth };
        this.signature = JSON.stringify(effectiveSettings);
        if (this.onHostPatch) {
          try {
            await this.onHostPatch({ chatWidth: current.chatWidth });
          } catch {}
        }
      }
      const signature = JSON.stringify(effectiveSettings);
      if (!current.themed || current.stale || current.rev !== 21 || signature !== this.signature) {
        const payload = { ...this.loader.payload(effectiveSettings), owner: this.owner };
        const result = await this.client.evaluate("(" + installTheme.toString() + ")(" + JSON.stringify(payload) + ")");
        this.signature = signature;
        this.report({
          connected: true, ...result,
          message: result.applied ? "已应用到真实 Antigravity · 可随时关闭" : "宿主布局已变化，等待重新应用"
        });
      } else if (current.owner === this.owner) {
        await this.client.evaluate("window.__agyDreamSkinV2?.touch?.()");
      }
      await this.syncPluginFrames(effectiveSettings);
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.port = null;
      this.closeFrameClients();
      this.signature = null;
      this.report({ connected: false, applied: false, message: "暂未接入：" + error.message });
    }
  }
  closeFrameClients() {
    for (const entry of this.frameClients.values()) {
      try { entry.client?.close(); } catch {}
    }
    this.frameClients.clear();
  }
  async syncPluginFrames(effectiveSettings) {
    if (!this.port || typeof this.listTargets !== "function") return;
    let targets = [];
    try {
      targets = await this.listTargets(this.port);
    } catch {
      return;
    }
    const pluginFrames = targets.filter(
      (t) =>
        t &&
        t.type === "iframe" &&
        typeof t.url === "string" &&
        t.url.startsWith("plugin://") &&
        !t.url.startsWith("plugin://antigravity-star-suite--") &&
        /^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl || "")
    );
    const activeIds = new Set(pluginFrames.map((t) => t.id || t.webSocketDebuggerUrl));
    for (const [id, entry] of this.frameClients.entries()) {
      if (!activeIds.has(id) || entry.client?.closed) {
        try { entry.client?.close(); } catch {}
        this.frameClients.delete(id);
      }
    }
    if (!effectiveSettings) {
      for (const entry of this.frameClients.values()) {
        try {
          await entry.client.evaluate("window.__agyDreamPluginFrameV2?.destroy?.()");
        } catch {}
      }
      this.closeFrameClients();
      return;
    }
    const framePayload = {
      owner: this.owner,
      glass: effectiveSettings.glass || {},
    };
    const frameSig = JSON.stringify(framePayload);
    for (const t of pluginFrames) {
      const id = t.id || t.webSocketDebuggerUrl;
      let entry = this.frameClients.get(id);
      if (!entry || entry.client?.closed) {
        entry = { client: this.createClient(t.webSocketDebuggerUrl), signature: null };
        this.frameClients.set(id, entry);
      }
      if (entry.signature === frameSig) continue;
      try {
        await entry.client.evaluate(
          "(" + installPluginFrameTheme.toString() + ")(" + JSON.stringify(framePayload) + ")"
        );
        entry.signature = frameSig;
      } catch {
        try { entry.client?.close(); } catch {}
        this.frameClients.delete(id);
      }
    }
  }
  start(settings) {
    clearInterval(this.timer);
    this.stopping = false;
    this.update(settings);
    this.timer = setInterval(() => this.tick(), 2500);
  }
  update(settings) {
    this.settings = { ...settings };
    this.revision++;
    return this.tick();
  }
  async stop() {
    this.stopping = true;
    clearInterval(this.timer);
    try { await this.inflight; } catch {}
    try {
      await this.syncPluginFrames(null);
    } catch {}
    try {
      if (this.client && !this.client.closed) {
        await this.client.evaluate("window.__agyDreamSkinV2?.owner===" + JSON.stringify(this.owner) + " ? window.__agyDreamSkinV2.destroy() : null");
      }
    } catch {}
    this.closeFrameClients();
    this.client?.close();
  }
}
module.exports = { HostController };
