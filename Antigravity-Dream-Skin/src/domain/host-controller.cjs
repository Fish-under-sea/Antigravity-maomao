const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { discover, listTargets, Cdp } = require("../../../shared/host.cjs");
const themeMod = require("../host/theme.cjs");
const { installTheme, installPluginFrameTheme } = themeMod;

const THEME_REV = typeof themeMod.THEME_REV === "number" ? themeMod.THEME_REV : 27;
const FRAME_REV = typeof themeMod.FRAME_REV === "number" ? themeMod.FRAME_REV : 5;
const FRAME_RECHECK_INTERVAL_MS = 15000;
const FRAME_BACKOFF_STEPS_MS = [5000, 15000, 30000];

const HOST_TOKEN_KEYS = [
  "--foreground",
  "--secondary-foreground",
  "--muted-foreground",
  "--border",
  "--card-border",
  "--primary",
  "--secondary",
  "--muted",
  "--placeholder",
];

function tryLoadHostModule(relPath) {
  try {
    return require(relPath);
  } catch {
    return null;
  }
}

function pickRev(mod, keys, fallback) {
  if (mod && typeof mod === "object") {
    for (const k of keys) {
      if (typeof mod[k] === "number" && Number.isFinite(mod[k]) && mod[k] > 0) {
        return mod[k];
      }
    }
  }
  return fallback;
}

function loadDefaultFeatureModules() {
  const telemetryMod = tryLoadHostModule("../host/modules/telemetry-bar.cjs");
  const effortMod = tryLoadHostModule("../host/modules/effort-slider.cjs");
  const beamMod = tryLoadHostModule("../host/modules/composer-beam.cjs");
  const petMod = tryLoadHostModule("../host/modules/embedded-pet.cjs");
  const motionMod = tryLoadHostModule("../host/modules/motion-fx.cjs");
  const i18nMod = tryLoadHostModule("../host/modules/host-i18n.cjs");
  const workbenchMod = tryLoadHostModule("../host/modules/workbench-enhancer.cjs");
  const updateToastMod = tryLoadHostModule("../host/modules/update-toast.cjs");

  return {
    telemetryBar: telemetryMod?.installTelemetryBar || null,
    effortSlider: effortMod?.installEffortSlider || null,
    composerBeam: beamMod?.installComposerBeam || null,
    embeddedPet: petMod?.installEmbeddedPet || null,
    motionFx: motionMod?.installMotionFx || null,
    hostI18n: i18nMod?.installHostI18n || null,
    swarmI18n: i18nMod?.installSwarmI18n || null,
    workbench: workbenchMod?.installWorkbenchEnhancer || null,
    updateToast: updateToastMod?.installUpdateToast || null,
    revs: {
      telemetryBar: pickRev(telemetryMod, ["TELEMETRY_BAR_REV", "REV"], 6),
      effortSlider: pickRev(effortMod, ["EFFORT_SLIDER_REV", "REV"], 3),
      composerBeam: pickRev(beamMod, ["COMPOSER_BEAM_REV", "REV"], 3),
      embeddedPet: pickRev(petMod, ["EMBEDDED_PET_REV", "REV"], 3),
      motionFx: pickRev(motionMod, ["MOTION_FX_REV", "REV"], 2),
      hostI18n: pickRev(i18nMod, ["HOST_I18N_REV", "REV"], 3),
      swarmI18n: pickRev(i18nMod, ["SWARM_I18N_REV", "REV"], 2),
      workbench: pickRev(workbenchMod, ["WORKBENCH_REV", "REV"], 5),
    },
  };
}

const INITIAL_MODULE_REVS = loadDefaultFeatureModules().revs;

const HOST_MODULE_SPECS = [
  { id: "telemetryBar", globalKey: "__agyMaomaoTelemetryBar", rev: INITIAL_MODULE_REVS.telemetryBar },
  { id: "effortSlider", globalKey: "__agyMaomaoEffortSlider", rev: INITIAL_MODULE_REVS.effortSlider },
  { id: "composerBeam", globalKey: "__agyMaomaoComposerBeam", rev: INITIAL_MODULE_REVS.composerBeam },
  { id: "embeddedPet", globalKey: "__agyMaomaoPet", rev: INITIAL_MODULE_REVS.embeddedPet },
  { id: "motionFx", globalKey: "__agyMaomaoMotionFx", rev: INITIAL_MODULE_REVS.motionFx },
  { id: "hostI18n", globalKey: "__agyMaomaoHostI18n", rev: INITIAL_MODULE_REVS.hostI18n },
  { id: "workbench", globalKey: "__agyMaomaoWorkbench", rev: INITIAL_MODULE_REVS.workbench },
];

const SWARM_I18N_GLOBAL_KEY = "__agyMaomaoSwarmI18n";
const SWARM_I18N_REV = INITIAL_MODULE_REVS.swarmI18n;

function isOwnOrPluginOwner(owner, myOwner) {
  if (!owner) return false;
  if (owner === myOwner) return true;
  return owner === "antigravity-star-suite-plugin" || String(owner).startsWith("antigravity-star-suite-");
}

function sanitizeHostTokens(raw) {
  if (!raw || typeof raw !== "object") return {};
  const out = {};
  for (const key of HOST_TOKEN_KEYS) {
    const val = raw[key];
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (trimmed && trimmed.length <= 128 && !/[;{}\r\n\0]/.test(trimmed)) {
        out[key] = trimmed;
      }
    }
  }
  return out;
}

function sanitizeOverrideDict(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const entries = Object.entries(raw).filter(
    ([k, v]) => typeof k === "string" && k.trim() && typeof v === "string" && v.trim() && k.length <= 240 && v.length <= 480
  );
  if (!entries.length) return null;
  return Object.fromEntries(entries);
}

function isValidPluginIframeTarget(t) {
  if (!t || t.type !== "iframe") return false;
  if (typeof t.url !== "string") return false;
  const trimmedUrl = t.url.trim();
  if (!trimmedUrl || trimmedUrl === "about:blank" || trimmedUrl.startsWith("about:")) return false;
  if (!trimmedUrl.startsWith("plugin://")) return false;
  if (trimmedUrl.startsWith("plugin://antigravity-star-suite--")) return false;
  return /^ws:\/\/(127\.0\.0\.1|localhost):\d+\//.test(t.webSocketDebuggerUrl || "");
}

function defaultHostStateFile() {
  return path.join(os.homedir(), ".antigravity-dream-skin", "host-state.json");
}

function readHostStateSafe(filePath) {
  if (!filePath) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function writeHostStateSafe(filePath, data) {
  if (!filePath) return;
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
    fs.renameSync(tmp, filePath);
  } catch {}
}

class HostController {
  constructor(loader, onStatus, options = {}) {
    this.owner = options.owner || crypto.randomUUID();
    this.loader = loader;
    this.onStatus = onStatus;
    this.onHostPatch = typeof options.onHostPatch === "function" ? options.onHostPatch : null;
    this.discover = options.discover || discover;
    this.listTargets = options.listTargets || listTargets;
    this.createClient = options.createClient || ((url, clientOptions) => new Cdp(url, clientOptions));
    this.sidecar = options.sidecar || null;
    this.customFeatureModules = Boolean(options.featureModules);
    this.featureModules = options.featureModules || loadDefaultFeatureModules();
    this.getI18nOverrideDict = typeof options.getI18nOverrideDict === "function" ? options.getI18nOverrideDict : null;
    this.i18nOverrideDict = sanitizeOverrideDict(options.i18nOverrideDict);
    this.hostStateFile =
      options.hostStateFile !== undefined
        ? options.hostStateFile
        : (options.sidecar ? defaultHostStateFile() : null);
    this.hostStateLoaded = false;
    this.lastHostBuild = "";
    this.agyVersion = "";
    this.lastAgyUpgradeReloadAt = null;
    this.lastI18nReloadAt = null;
    this.notifiedUpdateVersion = "";
    this.now = typeof options.now === "function" ? options.now : () => Date.now();
    this.client = null;
    this.port = null;
    this.frameStates = new Map();
    this.frameBackoff = new Map();
    this.featureStates = new Map();
    this.swarmI18nStates = new Map();
    this.hostThemeContext = { hostDark: false, hostTokens: {} };
    this.settings = { enabled: false };
    this.status = { connected: false, applied: false, message: "等待连接 Antigravity" };
    this.signature = null;
    this.revision = 0;
  }

  #ensureHostStateLoaded() {
    if (this.hostStateLoaded) return;
    this.hostStateLoaded = true;
    const saved = readHostStateSafe(this.hostStateFile);
    if (saved) {
      if (typeof saved.lastHostBuild === "string" && saved.lastHostBuild) {
        this.lastHostBuild = saved.lastHostBuild;
      }
      if (typeof saved.agyVersion === "string" && saved.agyVersion && !this.agyVersion) {
        this.agyVersion = saved.agyVersion;
      }
      if (typeof saved.lastAgyUpgradeReloadAt === "number") {
        this.lastAgyUpgradeReloadAt = saved.lastAgyUpgradeReloadAt;
      }
    }
  }

  #persistHostState() {
    if (!this.hostStateFile) return;
    writeHostStateSafe(this.hostStateFile, {
      lastHostBuild: this.lastHostBuild,
      agyVersion: this.agyVersion,
      lastAgyUpgradeReloadAt: this.lastAgyUpgradeReloadAt,
      updatedAt: this.now(),
    });
  }

  #getActiveI18nDict(extraDict = null) {
    const fromGetter = this.getI18nOverrideDict ? sanitizeOverrideDict(this.getI18nOverrideDict()) : null;
    const base = this.i18nOverrideDict || fromGetter;
    const extra = sanitizeOverrideDict(extraDict);
    if (!base && !extra) return null;
    return { ...(base || {}), ...(extra || {}) };
  }

  #getSidecarEndpoints() {
    const s = this.sidecar || {};
    const sidecarBaseUrl = typeof s.getBaseUrl === "function" ? s.getBaseUrl() : (s.baseUrl || "");
    const sidecarToken = typeof s.getToken === "function" ? s.getToken() : (s.token || "");
    const assetBaseUrl =
      typeof s.getAssetBaseUrl === "function"
        ? s.getAssetBaseUrl()
        : (s.assetBaseUrl || (sidecarBaseUrl && sidecarToken ? `${sidecarBaseUrl}/asset?token=${sidecarToken}&kind=` : ""));
    return { sidecarBaseUrl, sidecarToken, assetBaseUrl };
  }

  #shouldManageFeatures(effectiveSettings) {
    return Boolean(effectiveSettings && effectiveSettings.features && typeof effectiveSettings.features === "object");
  }

  #recordFrameBackoff(id, now) {
    const prev = this.frameBackoff.get(id);
    const failures = (prev?.failures || 0) + 1;
    const delay = FRAME_BACKOFF_STEPS_MS[Math.min(failures - 1, FRAME_BACKOFF_STEPS_MS.length - 1)];
    this.frameBackoff.set(id, { failures, delay, nextRetryAt: now + delay });
  }

  #buildDesiredModules(effectiveSettings) {
    const f = effectiveSettings?.features || {};
    const themeStyle = effectiveSettings?.glass?.themeStyle === "official" ? "official" : "star-neko";
    const { sidecarBaseUrl, sidecarToken, assetBaseUrl } = this.#getSidecarEndpoints();

    const tel = f.telemetry || {};
    const eff = f.effortSlider || {};
    const beam = f.composerBeam || {};
    const pet = f.embeddedPet || {};
    const fx = f.motionFx || {};
    const i18n = f.i18n || {};
    const wb = f.workbench || {};
    const i18nDict = this.#getActiveI18nDict();

    // Never expose thoughtApiKey into the renderer DOM; /api/maomao/translate reads it server-side.
    const safeWorkbench = { ...wb, thoughtApiKey: "" };

    return {
      telemetryBar: {
        active: Boolean(tel.enabled) && tel.barMode !== "off",
        config: {
          owner: this.owner,
          themeStyle,
          sidecarBaseUrl,
          sidecarToken,
          telemetry: { ...tel },
        },
      },
      effortSlider: {
        active: Boolean(eff.enabled),
        config: {
          owner: this.owner,
          themeStyle,
          effortSlider: { ...eff },
        },
      },
      composerBeam: {
        active: Boolean(beam.enabled || beam.quotaHalo),
        config: {
          owner: this.owner,
          sidecarBaseUrl,
          sidecarToken,
          composerBeam: { ...beam },
        },
      },
      embeddedPet: {
        active: Boolean(pet.enabled),
        config: {
          owner: this.owner,
          assetBaseUrl,
          sidecarBaseUrl,
          sidecarToken,
          embeddedPet: { ...pet },
        },
      },
      motionFx: {
        active: Boolean(fx.inkStreamFade || fx.semanticAura || fx.smoothCaret || fx.unreadBadge),
        config: {
          owner: this.owner,
          enabled: true,
          motionFx: { ...fx },
        },
      },
      hostI18n: {
        active: Boolean(i18n.mode && i18n.mode !== "off"),
        config: {
          owner: this.owner,
          mode: i18n.mode || "auto",
          swarmEnabled: i18n.swarmEnabled !== false,
          ...(i18nDict ? { dict: i18nDict } : {}),
        },
      },
      workbench: {
        active: Boolean(
          wb.codeFold ||
          wb.outlineRail ||
          wb.contextMenu ||
          wb.inlineDiff ||
          wb.fullTextSearch ||
          wb.compactLayout ||
          (wb.thoughtTranslate && wb.thoughtTranslate !== "off")
        ),
        config: {
          owner: this.owner,
          sidecarBaseUrl,
          sidecarToken,
          workbench: safeWorkbench,
        },
      },
    };
  }

  #refreshDiskI18nModules() {
    if (this.customFeatureModules) return;
    try {
      for (const rel of ["../host/modules/i18n-dict.cjs", "../host/modules/host-i18n.cjs"]) {
        try {
          const resolved = require.resolve(rel);
          delete require.cache[resolved];
        } catch {}
      }
      const fresh = tryLoadHostModule("../host/modules/host-i18n.cjs");
      if (fresh) {
        this.featureModules.hostI18n = fresh.installHostI18n || this.featureModules.hostI18n;
        this.featureModules.swarmI18n = fresh.installSwarmI18n || this.featureModules.swarmI18n;
        if (!this.featureModules.revs) this.featureModules.revs = {};
        this.featureModules.revs.hostI18n = pickRev(fresh, ["HOST_I18N_REV", "REV"], this.featureModules.revs.hostI18n || 3);
        this.featureModules.revs.swarmI18n = pickRev(fresh, ["SWARM_I18N_REV", "REV"], this.featureModules.revs.swarmI18n || 2);
      }
    } catch {}
  }

  report(value) {
    this.status = {
      ...this.status,
      ...value,
      ...(this.agyVersion ? { agyVersion: this.agyVersion } : {}),
      ...(this.lastAgyUpgradeReloadAt ? { lastAgyUpgradeReloadAt: this.lastAgyUpgradeReloadAt } : {}),
    };
    try {
      this.onStatus(this.status);
    } catch (error) {
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

  async reloadI18n({ extraDict = null, forceReinject = false } = {}) {
    if (extraDict !== null) {
      this.i18nOverrideDict = sanitizeOverrideDict(extraDict);
    }
    this.#refreshDiskI18nModules();

    const now = this.now();
    const i18nCfg = this.settings?.features?.i18n || { mode: "auto", swarmEnabled: true };
    const dict = this.#getActiveI18nDict(extraDict);
    const mode = i18nCfg.mode || "auto";
    const swarmEnabled = i18nCfg.swarmEnabled !== false;

    const hostPayload = {
      owner: this.owner,
      mode,
      swarmEnabled,
      ...(dict ? { dict } : {}),
    };

    let hostStatus = null;
    let hostReloaded = false;
    const hostFn = this.featureModules?.hostI18n;

    if (this.client && !this.client.closed && mode !== "off" && typeof hostFn === "function") {
      try {
        if (!forceReinject) {
          hostStatus = await this.client.evaluate(
            `window.__agyMaomaoHostI18n && typeof window.__agyMaomaoHostI18n.reload === "function" ? window.__agyMaomaoHostI18n.reload(${JSON.stringify(hostPayload)}) : null`
          );
        }
        if (!hostStatus) {
          await this.client.evaluate("window.__agyMaomaoHostI18n?.destroy?.()");
          hostStatus = await this.client.evaluate("(" + hostFn.toString() + ")(" + JSON.stringify(hostPayload) + ")");
        }
        hostReloaded = Boolean(hostStatus);
        this.featureStates.set("hostI18n", {
          sig: JSON.stringify(hostPayload),
          active: true,
          checkedAt: now,
        });
      } catch (error) {
        hostStatus = { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }

    let swarmFramesReloaded = 0;
    const swarmFn = this.featureModules?.swarmI18n;
    if (
      this.port &&
      typeof this.listTargets === "function" &&
      mode !== "off" &&
      swarmEnabled &&
      typeof swarmFn === "function"
    ) {
      try {
        const targets = await this.listTargets(this.port);
        const swarmFrames = targets.filter((t) => isValidPluginIframeTarget(t) && t.url.startsWith("plugin://swarm--"));
        const swarmPayload = {
          owner: this.owner,
          mode,
          swarmEnabled: true,
          ...(dict ? { dict } : {}),
        };
        const swarmSig = JSON.stringify(swarmPayload);

        await Promise.allSettled(
          swarmFrames.map(async (t) => {
            const id = t.id || t.webSocketDebuggerUrl;
            const fc = this.createClient(t.webSocketDebuggerUrl, { handshakeTimeout: 1200, requestTimeout: 1500 });
            try {
              let res = null;
              if (!forceReinject) {
                res = await fc.evaluate(
                  `window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}] && typeof window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}].reload === "function" ? window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}].reload(${JSON.stringify(swarmPayload)}) : null`
                );
              }
              if (!res) {
                await fc.evaluate(`window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}]?.destroy?.()`);
                res = await fc.evaluate("(" + swarmFn.toString() + ")(" + JSON.stringify(swarmPayload) + ")");
              }
              if (res && (res.applied || res.ok || res.active !== false)) {
                swarmFramesReloaded++;
                this.swarmI18nStates.set(id, { sig: swarmSig, url: t.url, checkedAt: now });
                this.frameBackoff.delete(id);
              }
            } catch {
            } finally {
              try { fc?.close(); } catch {}
            }
          })
        );
      } catch {}
    }

    this.lastI18nReloadAt = now;
    return {
      ok: Boolean(hostReloaded || swarmFramesReloaded > 0 || (this.client && !this.client.closed)),
      connected: Boolean(this.client && !this.client.closed),
      agyVersion: this.agyVersion,
      hostStatus,
      swarmFramesReloaded,
      overrideCount: dict ? Object.keys(dict).length : 0,
      reloadedAt: now,
    };
  }

  async syncFeatureModules(effectiveSettings) {
    if (!this.client || this.client.closed) return;
    if (!this.#shouldManageFeatures(effectiveSettings)) return;

    const desiredMap = this.#buildDesiredModules(effectiveSettings);
    const probeExpr =
      "({" +
      HOST_MODULE_SPECS.map((m) => {
        const ref = `window[${JSON.stringify(m.globalKey)}]`;
        return `${m.id}:${ref}?{owner:${ref}.owner||'',rev:${ref}.rev||0,stale:typeof ${ref}.lastSeen==='number'&&(Date.now()-${ref}.lastSeen>20000)}:null`;
      }).join(",") +
      "})";

    let liveStates = {};
    try {
      liveStates = (await this.client.evaluate(probeExpr)) || {};
    } catch {
      return;
    }

    const touchKeys = [];

    for (const spec of HOST_MODULE_SPECS) {
      const fn = this.featureModules?.[spec.id];
      if (typeof fn !== "function") continue;
      const desired = desiredMap[spec.id];
      const cur = liveStates[spec.id] || null;
      const prev = this.featureStates.get(spec.id);

      try {
        if (!desired || !desired.active) {
          if (cur && (cur.owner === this.owner || cur.stale || isOwnOrPluginOwner(cur.owner, this.owner))) {
            await this.client.evaluate(`window[${JSON.stringify(spec.globalKey)}]?.destroy?.()`);
          }
          this.featureStates.delete(spec.id);
          continue;
        }

        const expectedRev = this.featureModules?.revs?.[spec.id] || spec.rev;
        const sig = JSON.stringify(desired.config);
        const isAliveMine = Boolean(cur && cur.owner === this.owner && cur.rev === expectedRev && !cur.stale);

        if (isAliveMine && prev && prev.sig === sig) {
          touchKeys.push(spec.globalKey);
          continue;
        }

        if (isAliveMine && prev && prev.sig !== sig) {
          await this.client.evaluate(
            `window[${JSON.stringify(spec.globalKey)}]?.update?.(${JSON.stringify(desired.config)})`
          );
          this.featureStates.set(spec.id, { sig, active: true, checkedAt: this.now() });
          continue;
        }

        if (cur && cur.owner !== this.owner && !cur.stale && !isOwnOrPluginOwner(cur.owner, this.owner)) {
          continue;
        }

        if (cur) {
          await this.client.evaluate(`window[${JSON.stringify(spec.globalKey)}]?.destroy?.()`);
        }

        await this.client.evaluate("(" + fn.toString() + ")(" + JSON.stringify(desired.config) + ")");
        this.featureStates.set(spec.id, { sig, active: true, checkedAt: this.now() });
      } catch (err) {
        this.featureStates.delete(spec.id);
        console.warn(`[host-controller] 模块 ${spec.id} 同步失败：`, err?.message || err);
      }
    }

    if (touchKeys.length > 0) {
      try {
        await this.client.evaluate(
          touchKeys.map((k) => `window[${JSON.stringify(k)}]?.touch?.()`).join(";")
        );
      } catch {}
    }
  }

  async destroyFeatureModules() {
    if (!this.client || this.client.closed) {
      this.featureStates.clear();
      return;
    }
    if (this.featureStates.size === 0) return;
    const expr = HOST_MODULE_SPECS.map((m) => {
      const ref = `window[${JSON.stringify(m.globalKey)}]`;
      return `if(${ref}&&${ref}.owner===${JSON.stringify(this.owner)}){try{${ref}.destroy()}catch{}}`;
    }).join(";");
    try {
      await this.client.evaluate(`(()=>{${expr}})()`);
    } catch {}
    this.featureStates.clear();
  }

  async pokeEmbeddedPet(kind = "random") {
    if (!this.client || this.client.closed) {
      return { ok: false, error: "未连接到 Antigravity 宿主窗口" };
    }
    try {
      const res = await this.client.evaluate(
        `window.__agyMaomaoPet ? window.__agyMaomaoPet.triggerQuip(${JSON.stringify(kind)}) : null`
      );
      if (!res) {
        return { ok: false, error: "内置猫娘桌宠当前未启用或尚未挂载" };
      }
      const line = typeof res === "string" ? res : (res.text || res.line || res.quip || "");
      return { ok: true, line };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async showHostUpdateToast(info = {}) {
    if (!info || typeof info !== "object" || info.hasUpdate === false) {
      return { ok: false, shown: false, reason: "no_update" };
    }
    const cleanVersion = String(info.latestVersion || info.version || "").trim().replace(/^v/i, "");
    if (!cleanVersion) {
      return { ok: false, shown: false, reason: "missing_version" };
    }
    const force = Boolean(info.force || info.forceShow);
    if (!force && this.notifiedUpdateVersion === cleanVersion) {
      return { ok: true, shown: false, deduplicated: true, version: cleanVersion };
    }
    if (!this.client || this.client.closed) {
      return { ok: false, shown: false, reason: "host_disconnected", version: cleanVersion };
    }
    const toastFn = this.featureModules?.updateToast;
    if (typeof toastFn !== "function") {
      return { ok: false, shown: false, reason: "toast_module_unavailable", version: cleanVersion };
    }
    const { sidecarBaseUrl, sidecarToken } = this.#getSidecarEndpoints();
    const payload = {
      owner: this.owner,
      currentVersion: String(info.currentVersion || "").trim().replace(/^v/i, ""),
      latestVersion: cleanVersion,
      releaseNotes: typeof info.releaseNotes === "string" ? info.releaseNotes : "",
      releaseUrl: typeof info.releaseUrl === "string" ? info.releaseUrl : "",
      downloadUrl: typeof info.downloadUrl === "string" ? info.downloadUrl : "",
      sidecarBaseUrl,
      sidecarToken,
      forceShow: force,
    };
    try {
      const res = await this.client.evaluate("(" + toastFn.toString() + ")(" + JSON.stringify(payload) + ")");
      if (res && res.shown) {
        this.notifiedUpdateVersion = cleanVersion;
      }
      return {
        ok: true,
        shown: Boolean(res?.shown),
        deduplicated: Boolean(res?.deduplicated),
        target: res?.target || "toast-viewport",
        surface: res?.surface || "",
        dodgePx: Number(res?.dodgePx) || 0,
        version: cleanVersion,
      };
    } catch (error) {
      return {
        ok: false,
        shown: false,
        error: error instanceof Error ? error.message : String(error),
        version: cleanVersion,
      };
    }
  }

  async #handleHostBuildCheck(current, effectiveSettings) {
    const hb = current?.hostBuild;
    if (!hb || typeof hb !== "object") return false;
    const detectedVer = typeof hb.agyVersion === "string" ? hb.agyVersion.trim() : "";
    const fp = typeof hb.fingerprint === "string" ? hb.fingerprint.trim() : "";
    if (detectedVer) this.agyVersion = detectedVer;
    if (!fp || !this.#shouldManageFeatures(effectiveSettings)) return false;

    this.#ensureHostStateLoaded();
    if (!this.lastHostBuild) {
      this.lastHostBuild = fp;
      this.#persistHostState();
      return false;
    }
    if (this.lastHostBuild === fp) return false;

    // AGY build/version fingerprint changed -> auto-clear caches and force reload i18n across host + Swarm
    this.lastHostBuild = fp;
    this.lastAgyUpgradeReloadAt = this.now();
    this.featureStates.clear();
    this.swarmI18nStates.clear();
    this.frameBackoff.clear();
    this.#persistHostState();
    try {
      await this.reloadI18n({ forceReinject: true });
    } catch {}
    return true;
  }

  async runTick(revision) {
    const settings = { ...this.settings };
    try {
      if (!this.client || this.client.closed) {
        const found = await this.discover();
        if (!found) {
          this.port = null;
          this.frameStates.clear();
          this.frameBackoff.clear();
          this.featureStates.clear();
          this.swarmI18nStates.clear();
          this.report({ connected: false, applied: false, message: "未检测到宿主调试端口（如经 Cockpit Tools 切号重开，可点击一键以调试模式重启）" });
          return;
        }
        this.port = found.port;
        this.client = this.createClient(found.target.webSocketDebuggerUrl);
        this.signature = null;
      }
      const current = await this.client.evaluate(
        "({ready:document.readyState,themed:!!window.__agyDreamSkinV2?.status().applied,mediaHealthy:window.__agyDreamSkinV2?.status()?.mediaHealthy!==false,mediaSrc:window.__agyDreamSkinV2?.status()?.mediaSrc||'',owner:window.__agyDreamSkinV2?.owner,rev:window.__agyDreamSkinV2?.rev||0,stale:typeof window.__agyDreamSkinV2?.lastSeen==='number'&&(Date.now()-window.__agyDreamSkinV2.lastSeen>15000),chatWidth:window.__agyDreamSkinV2?.consumeChatWidth?.()??null,hostDark:(()=>{try{const b=document.body,d=document.documentElement;return Boolean(b?.classList?.contains('dark')||b?.classList?.contains('dark-theme')||d?.classList?.contains('dark')||d?.classList?.contains('dark-theme')||d?.getAttribute?.('data-theme')==='dark'||b?.getAttribute?.('data-theme')==='dark')}catch{return false}})(),hostTokens:(()=>{try{const cs=getComputedStyle(document.documentElement);const ks=['--foreground','--secondary-foreground','--muted-foreground','--border','--card-border','--primary','--secondary','--muted','--placeholder'];const o={};for(const k of ks){const v=(cs.getPropertyValue(k)||'').trim();if(v)o[k]=v}return o}catch{return {}}})(),hostBuild:(()=>{try{const ua=String(navigator.userAgent||'');const agy=(ua.match(/Antigravity\\/([^\\s]+)/i)||[])[1]||'';const elec=(ua.match(/Electron\\/([^\\s]+)/i)||[])[1]||'';const chr=(ua.match(/Chrome\\/([^\\s]+)/i)||[])[1]||'';const s=document.querySelector('script[src]');const src=s?String(s.getAttribute('src')||s.src||'').slice(0,180):'';const ori=String(location.origin||'');return {agyVersion:agy||(elec?'Electron/'+elec:''),electronVersion:elec,chromeVersion:chr,scriptSrc:src,origin:ori,fingerprint:[agy,elec,chr,src,ori].filter(Boolean).join('|')}}catch{return {agyVersion:'',fingerprint:''}}})()})"
      );
      if (revision !== this.revision || this.stopping) return;

      this.hostThemeContext = {
        hostDark: Boolean(current.hostDark),
        hostTokens: sanitizeHostTokens(current.hostTokens),
      };

      try {
        await this.#handleHostBuildCheck(current, settings);
      } catch {}

      if (!settings.enabled) {
        if (current.themed && (current.owner === this.owner || current.stale)) {
          await this.client.evaluate("window.__agyDreamSkinV2?.destroy()");
        }
        if (this.#shouldManageFeatures(settings)) {
          try { await this.syncFeatureModules(settings); } catch {}
        }
        try {
          await this.syncPluginFrames(this.#shouldManageFeatures(settings) ? { ...settings, enabled: false } : null);
        } catch {}
        this.signature = null;
        this.report({
          connected: true,
          applied: false,
          message: current.themed && current.owner !== this.owner && !current.stale
            ? "已连接 · 当前实例未启用，另一个皮肤实例正在运行"
            : "已连接 · 皮肤已关闭，宿主恢复原样",
        });
        return;
      }
      const canUpgradeLegacy =
        current.themed &&
        current.owner !== this.owner &&
        !current.stale &&
        typeof current.rev === "number" &&
        current.rev > 0 &&
        current.rev < THEME_REV &&
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
      if (!current.themed || current.stale || current.rev !== THEME_REV || signature !== this.signature || mediaBroken) {
        const payload = { ...rawPayload, owner: this.owner };
        const result = await this.client.evaluate("(" + installTheme.toString() + ")(" + JSON.stringify(payload) + ")");
        this.signature = signature;
        this.report({
          connected: true,
          ...result,
          message: result.applied ? "已应用到真实 Antigravity · 可随时关闭" : "宿主布局已变化，等待重新应用",
        });
      } else if (current.owner === this.owner) {
        await this.client.evaluate("window.__agyDreamSkinV2?.touch?.()");
      }
      // Isolated: plugin feature module or iframe CDP failures must never disconnect main HostController or flash black
      if (this.#shouldManageFeatures(effectiveSettings)) {
        try { await this.syncFeatureModules(effectiveSettings); } catch {}
      }
      try {
        await this.syncPluginFrames(effectiveSettings);
      } catch {}
    } catch (error) {
      this.client?.close();
      this.client = null;
      this.port = null;
      this.frameStates.clear();
      this.frameBackoff.clear();
      this.featureStates.clear();
      this.swarmI18nStates.clear();
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
    const pluginFrames = targets.filter(isValidPluginIframeTarget);
    const activeIds = new Set(pluginFrames.map((t) => t.id || t.webSocketDebuggerUrl));
    for (const id of this.frameStates.keys()) {
      if (!activeIds.has(id)) this.frameStates.delete(id);
    }
    for (const id of this.swarmI18nStates.keys()) {
      if (!activeIds.has(id)) this.swarmI18nStates.delete(id);
    }
    for (const id of this.frameBackoff.keys()) {
      if (!activeIds.has(id)) this.frameBackoff.delete(id);
    }

    const skinEnabled = Boolean(effectiveSettings && effectiveSettings.enabled !== false);
    const manageFeatures = this.#shouldManageFeatures(effectiveSettings);
    const swarmI18nFn = this.featureModules?.swarmI18n;
    const i18nCfg = effectiveSettings?.features?.i18n;
    const wantSwarmI18n = Boolean(
      manageFeatures &&
      typeof swarmI18nFn === "function" &&
      i18nCfg &&
      i18nCfg.mode !== "off" &&
      i18nCfg.swarmEnabled !== false
    );
    const shouldDestroySwarmI18n = !wantSwarmI18n && this.swarmI18nStates.size > 0;

    if (!skinEnabled && !wantSwarmI18n && !shouldDestroySwarmI18n) {
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
      this.frameBackoff.clear();
      return;
    }

    const framePayload = skinEnabled
      ? {
          owner: this.owner,
          glass: effectiveSettings.glass || {},
          hostDark: Boolean(this.hostThemeContext?.hostDark),
          hostTokens: this.hostThemeContext?.hostTokens || {},
          smoothVideo: Boolean(effectiveSettings.mediaType === "video" && effectiveSettings.videoSmoothMode !== false),
        }
      : null;
    const frameSig = framePayload ? JSON.stringify(framePayload) : "";
    const i18nDict = wantSwarmI18n ? this.#getActiveI18nDict() : null;
    const swarmPayload = wantSwarmI18n
      ? {
          owner: this.owner,
          mode: i18nCfg.mode || "auto",
          swarmEnabled: true,
          ...(i18nDict ? { dict: i18nDict } : {}),
        }
      : null;
    const swarmSig = swarmPayload ? JSON.stringify(swarmPayload) : "";
    const now = this.now();

    await Promise.allSettled(
      pluginFrames.map(async (t) => {
        const id = t.id || t.webSocketDebuggerUrl;
        const isSwarmFrame = t.url.startsWith("plugin://swarm--");

        // Per-target backoff cooldown: never hammer a stalled OOPIF on every 2.5s tick
        const backoff = this.frameBackoff.get(id);
        if (backoff && now < backoff.nextRetryAt) {
          return;
        }

        const prevTheme = this.frameStates.get(id);
        const themeMatched = Boolean(skinEnabled && prevTheme && prevTheme.sig === frameSig && prevTheme.url === t.url);
        const needThemeWork = skinEnabled
          ? (!themeMatched || now - (prevTheme?.checkedAt || 0) >= FRAME_RECHECK_INTERVAL_MS)
          : this.frameStates.has(id);

        const prevI18n = this.swarmI18nStates.get(id);
        const i18nMatched = Boolean(isSwarmFrame && wantSwarmI18n && prevI18n && prevI18n.sig === swarmSig && prevI18n.url === t.url);
        const needI18nWork = isSwarmFrame && (
          wantSwarmI18n
            ? (!i18nMatched || now - (prevI18n?.checkedAt || 0) >= FRAME_RECHECK_INTERVAL_MS)
            : this.swarmI18nStates.has(id)
        );

        if (!needThemeWork && !needI18nWork) return;

        const fc = this.createClient(t.webSocketDebuggerUrl, { handshakeTimeout: 1200, requestTimeout: 1500 });
        try {
          if (needThemeWork) {
            if (!skinEnabled) {
              await fc.evaluate("window.__agyDreamPluginFrameV2?.destroy?.()");
              this.frameStates.delete(id);
            } else {
              let themeAlive = false;
              if (themeMatched) {
                themeAlive = Boolean(
                  await fc.evaluate(
                    "Boolean(window.__agyDreamPluginFrameV2&&window.__agyDreamPluginFrameV2.owner===" +
                      JSON.stringify(this.owner) +
                      "&&window.__agyDreamPluginFrameV2.rev===" +
                      FRAME_REV +
                      ")"
                  )
                );
              }
              if (themeAlive) {
                this.frameStates.set(id, { sig: frameSig, url: t.url, checkedAt: now });
                this.frameBackoff.delete(id);
              } else {
                const res = await fc.evaluate(
                  "(" + installPluginFrameTheme.toString() + ")(" + JSON.stringify(framePayload) + ")"
                );
                if (res && res.applied) {
                  this.frameStates.set(id, { sig: frameSig, url: t.url, checkedAt: now });
                  this.frameBackoff.delete(id);
                } else {
                  this.frameStates.delete(id);
                  this.#recordFrameBackoff(id, now);
                }
              }
            }
          }

          if (needI18nWork) {
            if (!wantSwarmI18n) {
              await fc.evaluate(`window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}]?.destroy?.()`);
              this.swarmI18nStates.delete(id);
            } else {
              let i18nAlive = false;
              const expectedSwarmRev = this.featureModules?.revs?.swarmI18n || SWARM_I18N_REV;
              if (i18nMatched) {
                i18nAlive = Boolean(
                  await fc.evaluate(
                    `Boolean(window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}]&&window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}].owner===${JSON.stringify(this.owner)}&&window[${JSON.stringify(SWARM_I18N_GLOBAL_KEY)}].rev===${expectedSwarmRev})`
                  )
                );
              }
              if (i18nAlive) {
                this.swarmI18nStates.set(id, { sig: swarmSig, url: t.url, checkedAt: now });
                this.frameBackoff.delete(id);
              } else {
                const res = await fc.evaluate(
                  "(" + swarmI18nFn.toString() + ")(" + JSON.stringify(swarmPayload) + ")"
                );
                if (res && (res.applied || res.ok || res.active !== false)) {
                  this.swarmI18nStates.set(id, { sig: swarmSig, url: t.url, checkedAt: now });
                  this.frameBackoff.delete(id);
                } else {
                  this.swarmI18nStates.delete(id);
                  this.#recordFrameBackoff(id, now);
                }
              }
            }
          }
        } catch {
          if (needThemeWork) this.frameStates.delete(id);
          if (needI18nWork) this.swarmI18nStates.delete(id);
          this.#recordFrameBackoff(id, now);
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
      await this.destroyFeatureModules();
    } catch {}
    try {
      if (this.notifiedUpdateVersion && this.client && !this.client.closed) {
        await this.client.evaluate("window.__agyMaomaoUpdateToast?.destroy?.()");
      }
    } catch {}
    this.notifiedUpdateVersion = "";
    try {
      if (this.client && !this.client.closed) {
        await this.client.evaluate("window.__agyDreamSkinV2?.owner===" + JSON.stringify(this.owner) + " ? window.__agyDreamSkinV2.destroy() : null");
      }
    } catch {}
    this.frameStates.clear();
    this.frameBackoff.clear();
    this.featureStates.clear();
    this.swarmI18nStates.clear();
    this.client?.close();
  }
}

module.exports = {
  HostController,
  HOST_MODULE_SPECS,
  THEME_REV,
  FRAME_REV,
  FRAME_RECHECK_INTERVAL_MS,
  FRAME_BACKOFF_STEPS_MS,
  HOST_TOKEN_KEYS,
};
