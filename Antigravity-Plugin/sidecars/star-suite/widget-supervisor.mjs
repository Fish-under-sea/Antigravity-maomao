import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * Remove ELECTRON_RUN_AS_NODE so Electron apps spawned from an Antigravity
 * sidecar launch as full Electron desktop apps instead of plain Node.
 */
export function buildWidgetSpawnEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function readWindowsWidgetInstallPath() {
  if (process.platform !== "win32") return "";
  try {
    const out = execFileSync(
      "reg.exe",
      ["query", "HKCU\\Software\\AntigravityStarSuite\\Widget", "/v", "InstallPath"],
      { encoding: "utf8", windowsHide: true }
    );
    const match = /InstallPath\s+REG_\w+\s+(.+)/i.exec(out);
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

export function resolveWidgetTarget({
  configuredPath = "",
  localAppData = process.env.LOCALAPPDATA || "",
  repoRoot = "",
  registryInstallPath,
} = {}) {
  const candidates = [];
  if (configuredPath && typeof configuredPath === "string") {
    candidates.push(path.resolve(configuredPath));
  }
  const regDir = registryInstallPath !== undefined ? registryInstallPath : readWindowsWidgetInstallPath();
  if (regDir) {
    candidates.push(path.join(regDir, "StarWidget.exe"));
  }
  if (localAppData) {
    candidates.push(path.join(localAppData, "Programs", "AntigravityStarSuite", "Widget", "StarWidget.exe"));
  }

  for (const exePath of candidates) {
    if (exePath && fs.existsSync(exePath) && fs.statSync(exePath).isFile()) {
      return {
        kind: "exe",
        command: exePath,
        argsPrefix: [],
        cwd: path.dirname(exePath),
      };
    }
  }

  if (repoRoot) {
    const widgetEntry = path.join(repoRoot, "Antigravity-Cat-Widget", "src", "main", "index.cjs");
    const electronBins = [
      path.join(repoRoot, "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron"),
      path.join(repoRoot, "Antigravity-Cat-Widget", "node_modules", "electron", "dist", process.platform === "win32" ? "electron.exe" : "electron"),
    ];
    if (fs.existsSync(widgetEntry)) {
      for (const bin of electronBins) {
        if (fs.existsSync(bin)) {
          return {
            kind: "electron-source",
            command: bin,
            argsPrefix: [widgetEntry],
            cwd: path.join(repoRoot, "Antigravity-Cat-Widget"),
          };
        }
      }
    }
  }
  return null;
}

export function isWidgetProcessRunning() {
  try {
    if (process.platform === "win32") {
      const out = execFileSync("tasklist", ["/FI", "IMAGENAME eq StarWidget.exe", "/NH"], {
        encoding: "utf8",
        windowsHide: true,
      });
      return /StarWidget\.exe/i.test(out);
    }
    execFileSync("pgrep", ["-f", "Antigravity-Cat-Widget"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export class WidgetSupervisor {
  constructor({ repoRoot = "", getConfiguredPath = () => "" } = {}) {
    this.repoRoot = repoRoot;
    this.getConfiguredPath = getConfiguredPath;
    this.managedByPlugin = false;
    this.lastError = "";
    this.lastLaunchAt = 0;
  }

  locate() {
    return resolveWidgetTarget({
      configuredPath: this.getConfiguredPath(),
      repoRoot: this.repoRoot,
    });
  }

  #spawnTarget(target, extraArgs) {
    const child = spawn(target.command, [...target.argsPrefix, ...extraArgs], {
      cwd: target.cwd,
      env: buildWidgetSpawnEnv(process.env),
      detached: true,
      stdio: "ignore",
      windowsHide: false,
    });
    child.unref();
  }

  ensureStarted({ silent = true } = {}) {
    const target = this.locate();
    if (!target) {
      this.lastError = "未找到 StarWidget.exe（请确认已安装星语桌宠挂件）";
      return { ok: false, reason: this.lastError };
    }
    if (isWidgetProcessRunning()) {
      this.lastError = "";
      return { ok: true, alreadyRunning: true };
    }
    const now = Date.now();
    if (now - this.lastLaunchAt < 3000) {
      return { ok: true, throttled: true };
    }
    try {
      const args = silent ? ["--background", "--tray"] : ["--tray"];
      this.#spawnTarget(target, args);
      this.managedByPlugin = true;
      this.lastLaunchAt = now;
      this.lastError = "";
      return { ok: true, started: true };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: this.lastError };
    }
  }

  recall() {
    const target = this.locate();
    if (!target) {
      this.lastError = "未找到 StarWidget.exe（请确认已安装星语桌宠挂件）";
      return { ok: false, reason: this.lastError };
    }
    try {
      this.#spawnTarget(target, ["--tray"]);
      this.managedByPlugin = true;
      this.lastError = "";
      return { ok: true };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: this.lastError };
    }
  }

  quit() {
    const target = this.locate();
    if (!target || !isWidgetProcessRunning()) {
      this.managedByPlugin = false;
      return { ok: true, running: false };
    }
    try {
      this.#spawnTarget(target, ["--quit"]);
      this.managedByPlugin = false;
      this.lastError = "";
      return { ok: true };
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      return { ok: false, reason: this.lastError };
    }
  }

  status() {
    const target = this.locate();
    const running = isWidgetProcessRunning();
    return {
      available: Boolean(target),
      kind: target?.kind || null,
      path: target?.command || "",
      running,
      managedByPlugin: this.managedByPlugin,
      error: this.lastError,
    };
  }
}
