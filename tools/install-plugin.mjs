import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const PLUGIN_FILES = [
  "plugin.json",
  "README.md",
  "assets/logo.svg",
  "assets/logo.png",
  "sidecars/star-suite/sidecar.json",
  "sidecars/star-suite/main.mjs",
  "sidecars/star-suite/runtime-loader.mjs",
  "sidecars/star-suite/widget-supervisor.mjs",
  "sidecars/star-suite/media-picker.mjs",
  "sidecars/star-suite/web/index.html",
  "sidecars/star-suite/web/styles.css",
  "sidecars/star-suite/web/app.js",
  "sidecars/star-suite/web/logo.png",
];

const SKIN_REQUIRED_FILES = [
  "src/domain/settings.cjs",
  "src/domain/theme-loader.cjs",
  "src/domain/host-controller.cjs",
  "src/domain/media-server.cjs",
  "src/host/theme.cjs",
  "assets/wallpapers/gemini-character-sheet-v1/manifest.json",
  "assets/wallpapers/gemini-character-sheet-v1/wallpaper.png",
];

const WIDGET_RUNTIME_FILES = [
  "src/domain/settings.cjs",
  "src/adapters/host-quota.cjs",
];

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function collectFilesRecursive(dirPath, baseDir = dirPath, acc = []) {
  if (!fs.existsSync(dirPath)) return acc;
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const full = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      collectFilesRecursive(full, baseDir, acc);
    } else if (entry.isFile()) {
      acc.push(path.relative(baseDir, full));
    }
  }
  return acc;
}

function collectDirFiles(dirPath, extFilter = null) {
  if (!fs.existsSync(dirPath)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (extFilter && !extFilter.has(path.extname(entry.name).toLowerCase())) continue;
    out.push(entry.name);
  }
  return out.sort();
}

function copyFileClean(src, dst) {
  if (!fs.existsSync(src)) {
    throw new Error(`Missing required source file: ${src}`);
  }
  ensureDir(path.dirname(dst));
  fs.copyFileSync(src, dst);
}

export function defaultPluginTargetDir() {
  return path.join(os.homedir(), ".gemini", "config", "plugins", "antigravity-star-suite");
}

export function defaultConfigFilePath() {
  return path.join(os.homedir(), ".gemini", "config", "config.json");
}

export function installStarSuitePlugin(options = {}) {
  const repoRoot = path.resolve(options.repoRoot || REPO_ROOT);
  const targetDir = path.resolve(options.targetDir || defaultPluginTargetDir());
  const configFile = path.resolve(options.configFile || defaultConfigFilePath());
  const enableInConfig = options.enableInConfig !== false;
  const dryRun = Boolean(options.dryRun);

  const pluginSrcDir = path.join(repoRoot, "Antigravity-Plugin");
  const skinSrcDir = path.join(repoRoot, "Antigravity-Dream-Skin");
  const widgetSrcDir = path.join(repoRoot, "Antigravity-Cat-Widget");
  const sharedSrcDir = path.join(repoRoot, "shared");
  const stagedRuntimeRoot = path.join(targetDir, "sidecars", "star-suite", "runtime");

  const plannedCopies = [];
  const seenDst = new Set();
  const addCopy = (src, dst) => {
    const key = process.platform === "win32" ? dst.toLowerCase() : dst;
    if (seenDst.has(key)) return;
    seenDst.add(key);
    plannedCopies.push({ src, dst });
  };

  for (const rel of PLUGIN_FILES) {
    addCopy(path.join(pluginSrcDir, rel), path.join(targetDir, rel));
  }

  for (const rel of collectFilesRecursive(sharedSrcDir)) {
    addCopy(path.join(sharedSrcDir, rel), path.join(stagedRuntimeRoot, "shared", rel));
  }

  // Required Dream-Skin core files
  for (const rel of SKIN_REQUIRED_FILES) {
    addCopy(path.join(skinSrcDir, rel), path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", rel));
  }

  // Dynamically include all domain/*.cjs (protobuf, telemetry-db, quota-bridge, etc.)
  const domainDir = path.join(skinSrcDir, "src", "domain");
  for (const name of collectDirFiles(domainDir, new Set([".cjs"]))) {
    addCopy(
      path.join(domainDir, name),
      path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", "src", "domain", name)
    );
  }

  // Dynamically include all host/modules/*.cjs (vial-physics, telemetry-bar, effort-slider, composer-beam, embedded-pet, motion-fx, i18n-dict, host-i18n, workbench-enhancer, etc.)
  const hostModulesDir = path.join(skinSrcDir, "src", "host", "modules");
  for (const name of collectDirFiles(hostModulesDir, new Set([".cjs"]))) {
    addCopy(
      path.join(hostModulesDir, name),
      path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", "src", "host", "modules", name)
    );
  }

  // Bundle built-in Cat Pet static assets into self-contained runtime/Antigravity-Dream-Skin/assets/cat-pet/*
  const petFramesSrc = path.join(widgetSrcDir, "assets", "character-packs", "gemini-star-v1", "frames");
  for (const name of collectDirFiles(petFramesSrc, new Set([".png", ".webp", ".gif", ".svg"]))) {
    addCopy(
      path.join(petFramesSrc, name),
      path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", "assets", "cat-pet", "frames", name)
    );
  }

  const petAudioSrc = path.join(widgetSrcDir, "assets", "audio", "codex-maid-widget", "files");
  for (const name of collectDirFiles(petAudioSrc, new Set([".wav", ".mp3", ".ogg"]))) {
    addCopy(
      path.join(petAudioSrc, name),
      path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", "assets", "cat-pet", "audio", name)
    );
  }

  const petDialogueSrc = path.join(widgetSrcDir, "assets", "dialogue", "zh-CN.json");
  if (fs.existsSync(petDialogueSrc)) {
    addCopy(
      petDialogueSrc,
      path.join(stagedRuntimeRoot, "Antigravity-Dream-Skin", "assets", "cat-pet", "dialogue", "zh-CN.json")
    );
  }

  // Legacy widget settings & quota adapter compatibility
  for (const rel of WIDGET_RUNTIME_FILES) {
    const src = path.join(widgetSrcDir, rel);
    if (fs.existsSync(src)) {
      addCopy(src, path.join(stagedRuntimeRoot, "Antigravity-Cat-Widget", rel));
    }
  }

  if (!dryRun) {
    // Refresh staged runtime cleanly without deleting unknown top-level plugin files
    fs.rmSync(stagedRuntimeRoot, { recursive: true, force: true });
    for (const pair of plannedCopies) {
      copyFileClean(pair.src, pair.dst);
    }

    if (enableInConfig) {
      let config = {};
      if (fs.existsSync(configFile)) {
        const raw = fs.readFileSync(configFile, "utf8").trim();
        config = raw ? JSON.parse(raw) : {};
      }
      if (!config || typeof config !== "object" || Array.isArray(config)) {
        throw new Error(`Invalid config JSON structure in ${configFile}`);
      }
      config.plugins = config.plugins && typeof config.plugins === "object" ? config.plugins : {};
      const current = config.plugins["antigravity-star-suite"];
      config.plugins["antigravity-star-suite"] = {
        ...(current && typeof current === "object" ? current : {}),
        enabled: true,
      };
      ensureDir(path.dirname(configFile));
      fs.writeFileSync(configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
    }
  }

  return {
    repoRoot,
    targetDir,
    configFile,
    stagedRuntimeRoot,
    enableInConfig,
    dryRun,
    copiedCount: plannedCopies.length,
    files: plannedCopies.map((p) => p.dst),
  };
}

function parseCliArgs(argv) {
  const opts = {};
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--dry-run") {
      opts.dryRun = true;
    } else if (arg === "--no-enable") {
      opts.enableInConfig = false;
    } else if (arg.startsWith("--target=")) {
      opts.targetDir = arg.slice("--target=".length);
    } else if (arg.startsWith("--config=")) {
      opts.configFile = arg.slice("--config=".length);
    }
  }
  return opts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const opts = parseCliArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(
      [
        "Usage: node tools/install-plugin.mjs [options]",
        "",
        "Options:",
        "  --target=<dir>   Plugin install directory (default: ~/.gemini/config/plugins/antigravity-star-suite)",
        "  --config=<file>  Global Antigravity config path (default: ~/.gemini/config/config.json)",
        "  --no-enable      Copy plugin files without modifying config.json",
        "  --dry-run        Print planned operations without writing files",
      ].join("\n")
    );
    process.exit(0);
  }
  const result = installStarSuitePlugin(opts);
  console.log(
    JSON.stringify(
      {
        status: opts.dryRun ? "dry-run" : "installed",
        targetDir: result.targetDir,
        configFile: result.configFile,
        enabledInConfig: result.enableInConfig,
        copiedCount: result.copiedCount,
      },
      null,
      2
    )
  );
}
