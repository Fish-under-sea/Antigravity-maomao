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
  assert.match(await htmlRes.text(), /星语 · Dream Skin/);

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
