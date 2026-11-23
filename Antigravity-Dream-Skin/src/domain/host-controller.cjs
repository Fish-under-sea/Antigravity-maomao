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
    this.createClient = options.createClient || ((url, clientOptions) => new Cdp(url, clientOptions));
    this.client = null;
    this.port = null;
    this.frameStates = new Map();
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
          this.frameStates.clear();
          this.report({ connected: false, applied: false, message: "未检测到宿主调试端口（如经 Cockpit Tools 切号重开，可点击一键以调试模式重启）" });
          return;
        }
        this.port = found.port;
        this.client = this.createClient(found.target.webSocketDebuggerUrl);
        this.signature = null;
      }
      const current = await this.client.evaluate(
        "({ready:document.readyState,themed:!!window.__agyDreamSkinV2?.status().applied,mediaHealthy:window.__agyDreamSkinV2?.status()?.mediaHealthy!==false,mediaSrc:window.__agyDreamSkinV2?.status()?.mediaSrc||'',owner:window.__agyDreamSkinV2?.owner,rev:window.__agyDreamSkinV2?.rev||0,stale:typeof window.__agyDreamSkinV2?.lastSeen==='number'&&(Date.now()-window.__agyDreamSkinV2.lastSeen>15000),chatWidth:window.__agyDreamSkinV2?.consumeChatWidth?.()??null})"
      );
      if (revision !== this.revision || this.stopping) return;
      if (!settings.enabled) {
        if (current.themed && (current.owner === this.owner || current.stale)) {
          await this.client.evaluate("window.__agyDreamSkinV2?.destroy()");
        }
        try { await this.syncPluginFrames(null); } catch {}
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
        current.rev < 25 &&
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
      const rawPayload = this.loader.payload(effectiveSettings);
      const expectedMediaSrc = rawPayload.mediaUrl || rawPayload.image || "";
      const mediaBroken =
        current.themed &&
        current.owner === this.owner &&
        (current.mediaHealthy === false ||
          (Boolean(current.mediaSrc) && Boolean(expectedMediaSrc) && current.mediaSrc !== expectedMediaSrc));
      if (!current.themed || current.stale || current.rev !== 25 || signature !== this.signature || mediaBroken) {
        const payload = { ...rawPayload, owner: this.owner };
        const result = await this.client.evaluate("(" + installTheme.toString() + ")(" + JSON.stringify(payload) + ")");
        this.signature = signature;
        this.report({
          connected: true, ...result,
          message: result.applied ? "已应用到真实 Antigravity · 可随时关闭" : "宿主布局已变化，等待重新应用"
        });
      } else if (current.owner === this.owner) {
        await this.client.evaluate("window.__agyDreamSkinV2?.touch?.()");
      }
      try { await this.syncPluginFrames(effectiveSettings); } catch {}
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.port = null;
      this.frameStates.clear();
      this.signature = null;
      this.report({ connected: false, applied: false, message: "暂未接入：" + error.message });
    }
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
    for (const id of this.frameStates.keys()) {
      if (!activeIds.has(id)) this.frameStates.delete(id);
    }
    if (!effectiveSettings) {
      await Promise.allSettled(
        pluginFrames.map(async (t) => {
          const fc = this.createClient(t.webSocketDebuggerUrl, { handshakeTimeout: 1000, requestTimeout: 1200 });
          try {
            await fc.evaluate("window.__agyDreamPluginFrameV2?.destroy?.()");
          } catch {
          } finally {
            try { fc?.close(); } catch {}
          }
        })
      );
      this.frameStates.clear();
      return;
    }
    const framePayload = {
      owner: this.owner,
      glass: effectiveSettings.glass || {},
    };
    const frameSig = JSON.stringify(framePayload);
    const now = Date.now();
    await Promise.allSettled(
      pluginFrames.map(async (t) => {
        const id = t.id || t.webSocketDebuggerUrl;
        const prev = this.frameStates.get(id);
        const matched = Boolean(prev && prev.sig === frameSig && prev.url === t.url);
        if (matched && now - (prev.checkedAt || 0) < 10000) return;
        const fc = this.createClient(t.webSocketDebuggerUrl, { handshakeTimeout: 1200, requestTimeout: 1500 });
        try {
          if (matched) {
            const alive = await fc.evaluate(
              "Boolean(window.__agyDreamPluginFrameV2&&window.__agyDreamPluginFrameV2.owner===" +
                JSON.stringify(this.owner) +
                "&&window.__agyDreamPluginFrameV2.rev===4)"
            );
            if (alive) {
              this.frameStates.set(id, { sig: frameSig, url: t.url, checkedAt: now });
              return;
            }
          }
          const res = await fc.evaluate(
            "(" + installPluginFrameTheme.toString() + ")(" + JSON.stringify(framePayload) + ")"
          );
          if (res && res.applied) {
            this.frameStates.set(id, { sig: frameSig, url: t.url, checkedAt: now });
          } else {
            this.frameStates.delete(id);
          }
        } catch {
          this.frameStates.delete(id);
        } finally {
          try { fc?.close(); } catch {}
        }
      })
    );
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
    this.frameStates.clear();
    this.client?.close();
  }
}
module.exports = { HostController };
