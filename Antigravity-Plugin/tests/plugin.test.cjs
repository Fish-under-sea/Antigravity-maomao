const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const pluginRoot = path.resolve(__dirname, "..");

test("plugin manifest and sidecar manifest conform to Antigravity native plugin layout", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  assert.equal(manifest.name, "antigravity-star-suite");
  const sidecar = JSON.parse(
    fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/sidecar.json"), "utf8")
  );
  assert.equal(sidecar.command, "node");
  assert.deepEqual(sidecar.args, ["main.mjs"]);
  assert.equal(sidecar.restart_policy, "always");
  assert.equal(sidecar.has_web_ui, true);
  assert.equal(sidecar.ui_config.views[0].entrypoint, "SIDECAR_UI_ENTRYPOINT_AUX_PANE");
});

test("widget supervisor sanitizes ELECTRON_RUN_AS_NODE and locates installed executable", async () => {
  const { buildWidgetSpawnEnv, resolveWidgetTarget } = await import(
    "../sidecars/star-suite/widget-supervisor.mjs"
  );
  const env = buildWidgetSpawnEnv({
    ELECTRON_RUN_AS_NODE: "1",
    PATH: "C:\\Windows",
  });
  assert.equal("ELECTRON_RUN_AS_NODE" in env, false);
  assert.equal(env.PATH, "C:\\Windows");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "star-widget-loc-"));
  const fakeExe = path.join(dir, "StarWidget.exe");
  fs.writeFileSync(fakeExe, "stub");
  const found = resolveWidgetTarget({ configuredPath: fakeExe, localAppData: dir });
  assert.deepEqual(found, { kind: "exe", command: fakeExe, argsPrefix: [], cwd: dir });
});

test("runtime-loader prefers staged ./runtime when present and falls back to source root", async () => {
  const { resolveSuiteRoot } = await import("../sidecars/star-suite/runtime-loader.mjs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-loader-"));
  const unStaged = resolveSuiteRoot(tmpDir);
  assert.equal(unStaged.staged, false);

  fs.mkdirSync(path.join(tmpDir, "runtime/Antigravity-Dream-Skin"), { recursive: true });
  const staged = resolveSuiteRoot(tmpDir);
  assert.equal(staged.staged, true);
  assert.equal(staged.root, path.join(tmpDir, "runtime"));
});

test("sidecar service HTTP endpoints manage Dream Skin MP4/preset switching and widget actions", async (t) => {
  const { createStarSuiteService, startStandaloneHttpServer } = await import(
    "../sidecars/star-suite/main.mjs"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-svc-"));
  const settingsFile = path.join(tmpDir, "settings.json");
  const mp4File = path.join(tmpDir, "loop.mp4");
  fs.writeFileSync(mp4File, Buffer.from("0123456789ABCDEF"));

  const widgetCalls = [];
  let running = false;
  const fakeWidget = {
    ensureStarted(opts) {
      running = true;
      widgetCalls.push(["start", opts]);
      return { ok: true, started: true };
    },
    recall() {
      running = true;
      widgetCalls.push(["recall"]);
      return { ok: true };
    },
    quit() {
      running = false;
      widgetCalls.push(["quit"]);
      return { ok: true };
    },
    status() {
      return {
        available: true,
        kind: "exe",
        path: "C:\\Fake\\StarWidget.exe",
        running,
        managedByPlugin: running,
        error: "",
      };
    },
  };

  const service = await createStarSuiteService({
    settingsFile,
    discover: async () => null,
    pickMedia: async () => mp4File,
    widgetSupervisor: fakeWidget,
    autoTick: false,
    autoStartWidget: false,
  });
  await service.start();
  const httpSrv = await startStandaloneHttpServer(service, { port: 0 });
  t.after(async () => {
    await httpSrv.close();
    await service.stop();
  });

  // 1. Static panel assets respond 200
  const htmlRes = await fetch(`${httpSrv.url}/`);
  assert.equal(htmlRes.status, 200);
  assert.match(await htmlRes.text(), /喵言喵语/);

  const pngRes = await fetch(`${httpSrv.url}/preset-wallpaper.png`);
  assert.equal(pngRes.status, 200);
  assert.ok((await pngRes.arrayBuffer()).byteLength > 1000);

  // 2. Pick MP4 via /api/pick-media switches mediaType to video and streams via LocalMediaServer
  const pickRes = await fetch(`${httpSrv.url}/api/pick-media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(pickRes.status, 200);
  const picked = await pickRes.json();
  assert.equal(picked.picked, true);
  assert.equal(picked.state.settings.mediaType, "video");
  assert.equal(picked.state.settings.customMediaPath, mp4File);
  assert.equal(picked.state.settings.enabled, true);
  assert.equal(picked.state.activeMedia.mediaKind, "video");
  assert.ok(picked.state.activeMedia.mediaUrl.startsWith(service.mediaServer.baseUrl));

  const streamRes = await fetch(picked.state.activeMedia.mediaUrl, {
    headers: { Range: "bytes=4-9" },
  });
  assert.equal(streamRes.status, 206);
  assert.equal(await streamRes.text(), "456789");

  // 3. Switch back to built-in preset
  const presetRes = await fetch(`${httpSrv.url}/api/select-media`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mediaType: "preset" }),
  });
  assert.equal(presetRes.status, 200);
  const presetState = await presetRes.json();
  assert.equal(presetState.settings.mediaType, "preset");
  assert.equal(presetState.activeMedia.mediaUrl, "./preset-wallpaper.png");
  assert.equal(presetState.recentItems.length, 1);

  // 4. Widget actions & auto-launch toggle
  const recallRes = await fetch(`${httpSrv.url}/api/widget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "recall" }),
  });
  assert.equal(recallRes.status, 200);
  const recallBody = await recallRes.json();
  assert.equal(recallBody.state.widget.running, true);

  const autoRes = await fetch(`${httpSrv.url}/api/widget`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "autoLaunch", value: false }),
  });
  assert.equal(autoRes.status, 200);
  const autoBody = await autoRes.json();
  assert.equal(autoBody.state.settings.widgetAutoLaunch, false);
  assert.deepEqual(widgetCalls, [["recall"]]);
});

test("installStarSuitePlugin stages self-contained runtime and enables plugin in config.json", async () => {
  const { installStarSuitePlugin } = await import("../../tools/install-plugin.mjs");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-install-"));
  const targetDir = path.join(tmpRoot, "plugins", "antigravity-star-suite");
  const configFile = path.join(tmpRoot, "config.json");
  fs.writeFileSync(configFile, JSON.stringify({ plugins: { swarm: { enabled: true } } }), "utf8");

  const result = installStarSuitePlugin({ targetDir, configFile });
  assert.ok(result.copiedCount >= 18);
  assert.ok(fs.existsSync(path.join(targetDir, "plugin.json")));
  assert.ok(fs.existsSync(path.join(targetDir, "sidecars/star-suite/main.mjs")));

  const { resolveSuiteRoot, loadDreamSkinModules } = await import(
    require("node:url").pathToFileURL(
      path.join(targetDir, "sidecars/star-suite/runtime-loader.mjs")
    ).href
  );
  assert.equal(resolveSuiteRoot(path.join(targetDir, "sidecars/star-suite")).staged, true);
  const loaded = loadDreamSkinModules(path.join(targetDir, "sidecars/star-suite"));
  assert.equal(loaded.staged, true);
  const loader = new loaded.DreamSkinThemeLoader({ rootDir: loaded.skinRoot });
  assert.equal(loader.verifyIntegrity().verified, true);

  const cfg = JSON.parse(fs.readFileSync(configFile, "utf8"));
  assert.equal(cfg.plugins.swarm.enabled, true);
  assert.equal(cfg.plugins["antigravity-star-suite"].enabled, true);
});

test("plugin UI avoids ES module scripts inside plugin:// iframe and includes themeStyle + concentric radius controls", () => {
  const html = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/index.html"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/styles.css"), "utf8");
  const app = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/app.js"), "utf8");
  assert.doesNotMatch(html, /type\s*=\s*["']module["']/i);
  assert.match(html, /<script[^>]+defer[^>]+src=["']\.\/app\.js(?:\?[^"']*)?["']/i);
  assert.match(html, /data-theme-style=["']star-neko["']/);
  assert.match(html, /data-theme-style=["']official["']/);
  assert.match(html, /id=["']rngGlassRadius["']/);
  assert.doesNotMatch(css, /color\s*:\s*var\(--muted\)/i);
  assert.match(css, /--ss-radius-inner/);
  assert.match(css, /html,\s*body\s*\{[\s\S]*background:\s*transparent\s*!important/);
  assert.match(app, /ssStandalone/);
  assert.match(app, /themeStyleBtns/);
  assert.match(app, /rngGlassRadius/);
});

test("widget supervisor defaults to --no-tray and service manages ~/.antigravity-cat-widget settings", async (t) => {
  const { buildWidgetLaunchArgs } = await import("../sidecars/star-suite/widget-supervisor.mjs");
  assert.deepEqual(buildWidgetLaunchArgs({ silent: true, hideTray: true }), ["--background", "--no-tray"]);
  assert.deepEqual(buildWidgetLaunchArgs({ silent: false, hideTray: true }), ["--no-tray"]);
  assert.deepEqual(buildWidgetLaunchArgs({ silent: true, hideTray: false }), ["--background", "--tray"]);

  const { createStarSuiteService, startStandaloneHttpServer } = await import(
    "../sidecars/star-suite/main.mjs"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-widget-cfg-"));
  const settingsFile = path.join(tmpDir, "skin-settings.json");
  const widgetSettingsFile = path.join(tmpDir, "widget-settings.json");
  let reloadCount = 0;
  const fakeWidget = {
    ensureStarted: () => ({ ok: true }),
    recall: () => ({ ok: true }),
    restart: () => ({ ok: true }),
    reloadSettings: () => {
      reloadCount += 1;
      return { ok: true };
    },
    quit: () => ({ ok: true }),
    status: () => ({ available: true, running: true, managedByPlugin: true, error: "" }),
  };

  const service = await createStarSuiteService({
    settingsFile,
    widgetSettingsFile,
    discover: async () => null,
    widgetSupervisor: fakeWidget,
    autoTick: false,
    autoStartWidget: false,
  });
  await service.start();
  const httpSrv = await startStandaloneHttpServer(service, { port: 0 });
  t.after(async () => {
    await httpSrv.close();
    await service.stop();
  });

  const wsRes = await fetch(`${httpSrv.url}/api/widget-settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scale: 180, bubbleOn: false, hostWindowOnly: true, sound: true }),
  });
  assert.equal(wsRes.status, 200);
  const wsBody = await wsRes.json();
  assert.equal(wsBody.widgetSettings.scale, 180);
  assert.equal(wsBody.widgetSettings.bubbleOn, false);
  assert.equal(reloadCount, 1);
  const savedWidget = JSON.parse(fs.readFileSync(widgetSettingsFile, "utf8"));
  assert.equal(savedWidget.scale, 180);
  assert.equal(savedWidget.bubbleOn, false);
});

test("media picker uses UTF-8 UTF-16LE encoded PowerShell args and web preview avoids duplicate 4K decoding", async (t) => {
  const { buildWin32PickerArgs } = await import("../sidecars/star-suite/media-picker.mjs");
  const args = buildWin32PickerArgs();
  const encIdx = args.indexOf("-EncodedCommand");
  assert.ok(encIdx >= 0 && args[encIdx + 1]);
  const script = Buffer.from(args[encIdx + 1], "base64").toString("utf16le");
  assert.match(script, /OutputEncoding\s*=\s*\[System\.Text\.UTF8Encoding\]::new\(\$false\)/);
  assert.match(script, /TopMost\s*=\s*\$true/);
  assert.match(script, /ShowDialog\(\$owner\)/);

  const html = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/index.html"), "utf8");
  const css = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/styles.css"), "utf8");
  const app = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/app.js"), "utf8");
  assert.match(html, /id=["']chkVideoSmoothMode["']/);
  assert.match(html, /id=["']rngChatWidth["']/);
  assert.match(html, /data-chat-width=["']94["']/);
  const previewTagMatch = html.match(/<video[^>]+id=["']previewVideo["'][^>]*>/);
  assert.ok(previewTagMatch);
  assert.doesNotMatch(previewTagMatch[0], /\bautoplay\b/i);
  assert.doesNotMatch(previewTagMatch[0], /\bloop\b/i);
  assert.match(css, /::-webkit-scrollbar\s*\{[\s\S]*width:\s*[45]px;/);
  assert.match(css, /::-webkit-scrollbar-button\s*\{[\s\S]*display:\s*none/);
  assert.doesNotMatch(app, /el\.previewVideo\.play\(/);
  assert.match(app, /el\.previewVideo\.pause\(\)/);

  const { createStarSuiteService, startStandaloneHttpServer } = await import(
    "../sidecars/star-suite/main.mjs"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-width-"));
  const service = await createStarSuiteService({
    settingsFile: path.join(tmpDir, "settings.json"),
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
  });
  await service.start();
  const httpSrv = await startStandaloneHttpServer(service, { port: 0 });
  t.after(async () => {
    await httpSrv.close();
    await service.stop();
  });

  const res = await fetch(`${httpSrv.url}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chatWidth: 86, videoSmoothMode: false }),
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.settings.chatWidth, 86);
  assert.equal(body.settings.videoSmoothMode, false);

  const s2 = await createStarSuiteService({
    settingsFile: path.join(tmpDir, "settings2.json"),
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
  });
  try {
    assert.notEqual(service.controller.owner, s2.controller.owner);
    assert.match(service.controller.owner, /^antigravity-star-suite-\d+-/);
  } finally {
    await s2.stop();
  }
});

test("v0.4.0 plugin manifest uses 喵言喵语 branding, bundles cat-pet & host modules, and enforces API/SSRF guards", async (t) => {
  const manifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  const sidecar = JSON.parse(fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/sidecar.json"), "utf8"));
  assert.match(manifest.version, /^0\.4\.\d+$/);
  assert.equal(manifest.display_name, "喵言喵语");
  assert.equal(sidecar.display_name, "喵言喵语");
  assert.equal(sidecar.ui_config.display_name, "喵言喵语");
  assert.equal(sidecar.ui_config.views[0].title, "喵言喵语");

  const html = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/index.html"), "utf8");
  assert.match(html, /<title>喵言喵语<\/title>/);
  assert.match(html, /<h1>喵言喵语<\/h1>/);
  for (const tab of ["wallpaper", "glass", "telemetry", "pet", "enhance"]) {
    assert.match(html, new RegExp(`data-tab=["']${tab}["']`));
  }
  // All checkboxes replaced by glass button[role=switch], outlineRail removed, telemetry tab deduplicated
  assert.doesNotMatch(html, /<input[^>]+type=["']checkbox["']/i);
  assert.match(html, /<button[^>]+class=["'][^"']*toggle-btn[^"']*["'][^>]+role=["']switch["']/);
  assert.match(html, /data-fkey=["']embeddedPet\.snap["']/);
  assert.match(html, /角落贴边吸附/);
  assert.doesNotMatch(html, /outlineRail|会话大纲/);
  assert.doesNotMatch(html, /btnJumpArchive|清理轨迹归档|quotaMiniList|usageModelList/);

  // 4-surface theme compatibility (dark / light / glass-dark / glass-light)
  const css = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/styles.css"), "utf8");
  const appJs = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/web/app.js"), "utf8");
  for (const mode of ["dark", "light", "glass-dark", "glass-light"]) {
    assert.match(css, new RegExp(`data-ss-surface=["']${mode}["']`));
  }
  assert.match(appJs, /resolveSurfaceMode/);
  assert.match(appJs, /theme-change/);
  assert.match(appJs, /data-ss-surface|ssSurface/);

  // In-plugin update & AGY version i18n reload controls in sidebar UI
  for (const id of [
    "pluginVersionPill",
    "updateBadgeDot",
    "agyVersionLabel",
    "btnReloadI18n",
    "btnSyncReloadI18n",
    "pluginUpdateCard",
    "btnCheckUpdate",
    "btnApplyUpdate",
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }

  // Verify installer stages all new domain/*.cjs, host/modules/*.cjs, and cat-pet assets
  const { installStarSuitePlugin } = await import("../../tools/install-plugin.mjs");
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-v040-inst-"));
  const targetDir = path.join(tmpRoot, "plugins", "antigravity-star-suite");
  const configFile = path.join(tmpRoot, "config.json");
  installStarSuitePlugin({ targetDir, configFile });
  const rt = path.join(targetDir, "sidecars/star-suite/runtime/Antigravity-Dream-Skin");
  for (const rel of [
    "src/domain/protobuf.cjs",
    "src/domain/telemetry-db.cjs",
    "src/domain/quota-bridge.cjs",
    "src/host/modules/vial-physics.cjs",
    "src/host/modules/telemetry-bar.cjs",
    "src/host/modules/effort-slider.cjs",
    "src/host/modules/composer-beam.cjs",
    "src/host/modules/embedded-pet.cjs",
    "src/host/modules/motion-fx.cjs",
    "src/host/modules/i18n-dict.cjs",
    "src/host/modules/host-i18n.cjs",
    "src/host/modules/workbench-enhancer.cjs",
    "assets/cat-pet/frames/idle.png",
    "assets/cat-pet/audio/original-press.wav",
    "assets/cat-pet/dialogue/zh-CN.json",
  ]) {
    assert.ok(fs.existsSync(path.join(rt, rel)), `Expected staged file: ${rel}`);
  }

  // Verify SSRF guards on validateTranslateEndpoint & /api/maomao/* endpoints on mediaServer + standalone HTTP
  const { createStarSuiteService, startStandaloneHttpServer, validateTranslateEndpoint } = await import(
    "../sidecars/star-suite/main.mjs"
  );
  await assert.rejects(validateTranslateEndpoint("http://169.254.169.254/latest/meta-data"), /HTTPS|私网/);
  await assert.rejects(validateTranslateEndpoint("https://10.0.0.1/v1/chat/completions"), /私网/);
  await assert.rejects(validateTranslateEndpoint("http://evil.example.com/v1"), /HTTPS/);
  await assert.rejects(validateTranslateEndpoint("https://metadata.google.internal/v1"), /内部元数据/);
  await assert.rejects(
    validateTranslateEndpoint("https://rebind.example/v1", { lookup: async () => [{ address: "127.0.0.1" }] }),
    /受限/
  );
  assert.equal(
    await validateTranslateEndpoint("http://127.0.0.1:11434/v1/chat/completions"),
    "http://127.0.0.1:11434/v1/chat/completions"
  );
  assert.equal(
    await validateTranslateEndpoint("https://api.openai.com/v1/chat/completions", {
      lookup: async () => [{ address: "104.18.7.192" }],
    }),
    "https://api.openai.com/v1/chat/completions"
  );

  const tmpSvc = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-v040-svc-"));
  const service = await createStarSuiteService({
    settingsFile: path.join(tmpSvc, "settings.json"),
    appDataDir: tmpSvc,
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
  });
  await service.start();
  const httpSrv = await startStandaloneHttpServer(service, { port: 0 });
  t.after(async () => {
    await httpSrv.close();
    await service.stop();
  });

  // Asset route serves bundled cat pet frames from LocalMediaServer
  const frameRes = await fetch(`${service.mediaServer.assetBaseUrl}pet&file=idle.png`);
  assert.equal(frameRes.status, 200);
  assert.equal(frameRes.headers.get("content-type"), "image/png");

  // CORS-enabled token-protected /api/maomao/* on LocalMediaServer
  const unauthApi = await fetch(`${service.mediaServer.baseUrl}/api/maomao/telemetry?token=bad`);
  assert.equal(unauthApi.status, 401);
  const okTelemetry = await fetch(`${service.mediaServer.baseUrl}/api/maomao/telemetry?token=${service.mediaServer.token}`);
  assert.equal(okTelemetry.status, 200);
  assert.equal(okTelemetry.headers.get("access-control-allow-origin"), "*");

  // Lightweight /api/maomao/usage defaults to includeRequests=false & includeAnomalies=false
  const usageRes = await fetch(`${service.mediaServer.baseUrl}/api/maomao/usage?range=week&token=${service.mediaServer.token}`);
  assert.equal(usageRes.status, 200);
  const usageJson = await usageRes.json();
  assert.equal(usageJson.ok, true);
  assert.deepEqual(usageJson.requests, []);
  assert.deepEqual(usageJson.cacheAnomalies, []);
  const mainSrc = fs.readFileSync(path.join(pluginRoot, "sidecars/star-suite/main.mjs"), "utf8");
  assert.match(mainSrc, /includeRequests:\s*wantFull/);
  assert.match(mainSrc, /includeAnomalies:\s*wantFull/);

  // Standalone panel routes: export config redacts thoughtApiKey, gomemlimit rejects invalid preset
  await fetch(`${httpSrv.url}/api/settings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features: { workbench: { thoughtApiKey: "sk-topsecret" } } }),
  });
  const expRes = await fetch(`${httpSrv.url}/api/maomao/config/export`);
  assert.equal(expRes.status, 200);
  const expJson = await expRes.json();
  assert.equal(expJson.settings.features.workbench.thoughtApiKey, "");

  const badMem = await fetch(`${httpSrv.url}/api/maomao/system/gomemlimit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ preset: "99GiB; calc.exe" }),
  });
  const badMemJson = await badMem.json();
  assert.equal(badMemJson.ok, false);
});

test("sidecar exposes /api/update/check, /api/update/apply (with restart hook & dev-repo guard), and /api/i18n/reload", async (t) => {
  const { createStarSuiteService, startStandaloneHttpServer } = await import(
    "../sidecars/star-suite/main.mjs"
  );
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-upd-"));
  const installedDir = path.join(tmpDir, "installed-plugin");
  const overrideFile = path.join(tmpDir, "i18n-override.json");
  let restartedPayload = null;
  let syncedRemoteCalled = false;
  let appliedTargetDir = "";

  const fakeUpdater = {
    loadI18nOverrideDict: () => ({ "Custom Label": "自定义标签" }),
    syncRemoteI18nDict: async () => {
      syncedRemoteCalled = true;
      return { synced: true, dict: { "Custom Label": "自定义标签", "Remote Item": "远程条目" } };
    },
    checkForPluginUpdate: async ({ currentVersion }) => ({
      currentVersion,
      latestVersion: "0.4.9",
      hasUpdate: true,
      releaseNotes: "修复汉化重载与新增在线更新",
      releaseUrl: "https://github.com/Fish-under-sea/Antigravity-maomao/releases/tag/v0.4.9",
      assetName: "antigravity-maomao-plugin-v0.4.9.zip",
      assetSize: 524288,
      downloadUrl: "https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.9/antigravity-maomao-plugin-v0.4.9.zip",
      publishedAt: "2026-11-26T10:00:00Z",
      checkedAt: Date.now(),
    }),
    downloadAndInstallUpdate: async ({ targetDir }) => {
      appliedTargetDir = targetDir;
      return { ok: true, fromVersion: "0.4.1", toVersion: "0.4.9", targetDir };
    },
  };

  const service = await createStarSuiteService({
    settingsFile: path.join(tmpDir, "settings.json"),
    hostStateFile: path.join(tmpDir, "host-state.json"),
    i18nOverrideFile: overrideFile,
    appDataDir: tmpDir,
    pluginUpdater: fakeUpdater,
    updateTargetDir: installedDir,
    restartSidecar: (info) => { restartedPayload = info; },
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
  });
  await service.start();
  const httpSrv = await startStandaloneHttpServer(service, { port: 0 });
  t.after(async () => {
    await httpSrv.close();
    await service.stop();
  });

  const pkgManifest = JSON.parse(fs.readFileSync(path.join(pluginRoot, "plugin.json"), "utf8"));
  const st0 = await (await fetch(`${httpSrv.url}/api/state`)).json();
  assert.equal(st0.pluginVersion, pkgManifest.version);
  assert.equal(st0.i18nOverrideCount, 1);
  assert.equal(typeof st0.updateStatus, "object");

  const chkRes = await (await fetch(`${httpSrv.url}/api/update/check?force=1`)).json();
  assert.equal(chkRes.ok, true);
  assert.equal(chkRes.hasUpdate, true);
  assert.equal(chkRes.latestVersion, "0.4.9");

  const applyRes = await (await fetch(`${httpSrv.url}/api/update/apply`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  })).json();
  assert.equal(applyRes.ok, true);
  assert.equal(applyRes.restarting, true);
  assert.equal(appliedTargetDir, installedDir);
  assert.ok(restartedPayload && restartedPayload.toVersion === "0.4.9");

  const relRes = await (await fetch(`${httpSrv.url}/api/i18n/reload`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ syncRemote: true }),
  })).json();
  assert.equal(syncedRemoteCalled, true);
  assert.equal(relRes.overrideCount, 2);
  assert.ok(relRes.reloadedAt > 0);
  assert.equal(relRes.state.lastI18nReloadAt, relRes.reloadedAt);
});

test("mediaServer exposes CORS /api/maomao/update/apply for host toast, startup check triggers toast and degrades silently offline", async (t) => {
  const { createStarSuiteService } = await import("../sidecars/star-suite/main.mjs");
  const { installStarSuitePlugin } = await import("../../tools/install-plugin.mjs");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "star-suite-toast-"));

  // 1. Verify installer stages update-toast.cjs
  const stageDest = path.join(tmpDir, "staged-plugin");
  installStarSuitePlugin({ targetDir: stageDest, enableInConfig: false });
  assert.equal(
    fs.existsSync(path.join(stageDest, "sidecars/star-suite/runtime/Antigravity-Dream-Skin/src/host/modules/update-toast.cjs")),
    true
  );

  // 2. Startup delayed check invokes checkForPluginUpdate & shows host toast; CORS /api/maomao/update/apply triggers install + restart
  let checkCount = 0;
  let toastPayloads = [];
  let restarted = null;
  const fakeUpdater = {
    loadI18nOverrideDict: () => ({}),
    checkForPluginUpdate: async ({ currentVersion }) => {
      checkCount++;
      return {
        currentVersion,
        latestVersion: "0.4.5",
        hasUpdate: true,
        releaseNotes: "自动检测发现新版本",
        downloadUrl: "https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.5/pkg.zip",
        checkedAt: Date.now(),
      };
    },
    downloadAndInstallUpdate: async ({ targetDir }) => ({
      ok: true,
      fromVersion: "0.4.0",
      toVersion: "0.4.5",
      targetDir,
    }),
  };

  const service = await createStarSuiteService({
    settingsFile: path.join(tmpDir, "settings.json"),
    hostStateFile: path.join(tmpDir, "host-state.json"),
    i18nOverrideFile: path.join(tmpDir, "i18n-override.json"),
    appDataDir: tmpDir,
    pluginUpdater: fakeUpdater,
    updateTargetDir: path.join(tmpDir, "installed"),
    restartSidecar: (info) => { restarted = info; },
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
    autoCheckUpdate: true,
    startupUpdateDelayMs: 20,
  });
  const origShowToast = service.controller.showHostUpdateToast.bind(service.controller);
  service.controller.showHostUpdateToast = async (info) => {
    toastPayloads.push(info);
    return origShowToast(info);
  };

  await service.start();
  t.after(async () => {
    await service.stop();
  });

  await new Promise((r) => setTimeout(r, 90));
  assert.equal(checkCount, 1);
  assert.equal(toastPayloads.length, 1);
  assert.equal(toastPayloads[0].latestVersion, "0.4.5");

  // Call CORS-protected /api/maomao/update/apply via mediaServer (same path used by host update toast)
  const applyRes = await fetch(
    `${service.mediaServer.baseUrl}/api/maomao/update/apply?token=${encodeURIComponent(service.mediaServer.token)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Maomao-Token": service.mediaServer.token },
      body: JSON.stringify({}),
    }
  );
  assert.equal(applyRes.status, 200);
  assert.equal(applyRes.headers.get("access-control-allow-origin"), "*");
  const applyJson = await applyRes.json();
  assert.equal(applyJson.ok, true);
  assert.equal(applyJson.toVersion, "0.4.5");
  assert.ok(restarted && restarted.toVersion === "0.4.5");

  // 3. Offline startup check fails silently without throwing
  const offlineService = await createStarSuiteService({
    settingsFile: path.join(tmpDir, "settings-off.json"),
    hostStateFile: path.join(tmpDir, "host-state-off.json"),
    i18nOverrideFile: path.join(tmpDir, "i18n-override-off.json"),
    appDataDir: tmpDir,
    pluginUpdater: {
      loadI18nOverrideDict: () => ({}),
      checkForPluginUpdate: async () => { throw new Error("ENOTFOUND api.github.com"); },
    },
    discover: async () => null,
    widgetSupervisor: { status: () => ({ available: false, running: false }) },
    autoTick: false,
    autoStartWidget: false,
    autoCheckUpdate: true,
    startupUpdateDelayMs: 15,
  });
  await offlineService.start();
  t.after(async () => {
    await offlineService.stop();
  });
  await new Promise((r) => setTimeout(r, 70));
  const offSnap = offlineService.snapshot();
  assert.equal(offSnap.updateStatus.hasUpdate, false);
  assert.match(offSnap.updateStatus.error, /ENOTFOUND/);
});
