'use strict';

/**
 * Safe in-plugin GitHub Releases updater & hot-reloadable i18n override dictionary loader.
 * 100% MIT, zero external npm dependencies, CommonJS (.cjs).
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');

const DEFAULT_REPO = 'Fish-under-sea/Antigravity-maomao';
const DEFAULT_REMOTE_I18N_URL = `https://raw.githubusercontent.com/${DEFAULT_REPO}/main/Antigravity-Dream-Skin/assets/i18n-override.json`;
const DEFAULT_CACHE_TTL_MS = 600_000;
const DEFAULT_MAX_BYTES = 67_108_864; // 64 MiB
const DEFAULT_I18N_MAX_BYTES = 1_048_576; // 1 MiB
const MAX_REDIRECTS = 5;
const MAX_OVERRIDE_ENTRIES = 2000;
const MAX_OVERRIDE_KEY_LEN = 120;
const MAX_OVERRIDE_VALUE_LEN = 240;

const ALLOWED_RELEASE_HOSTS = new Set([
  'github.com',
  'api.github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'codeload.github.com',
]);

const ALLOWED_I18N_HOSTS = new Set([
  'raw.githubusercontent.com',
  'github.com',
]);

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/i;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

let isProtectedModelOrEffortText = null;
try {
  const dictMod = require('../host/modules/i18n-dict.cjs');
  if (dictMod && typeof dictMod.isProtectedModelOrEffortText === 'function') {
    isProtectedModelOrEffortText = dictMod.isProtectedModelOrEffortText;
  }
} catch {
  isProtectedModelOrEffortText = null;
}

if (!isProtectedModelOrEffortText) {
  const EFFORT_WORDS = '(?:off|minimal|low|medium|med|high|extra[\\s-]?high|x[\\s-]?high|max|maximum|auto|thinking)';
  const FALLBACK_PROTECTED_RE = new RegExp(
    [
      `^${EFFORT_WORDS}(?:\\s*\\(${EFFORT_WORDS}\\))?$`,
      `^(?:orchestrator|auto)(?:\\s*[·•|/\\-]\\s*${EFFORT_WORDS})?(?:\\s*\\([^)]{1,28}\\))?$`,
      `^(?:google\\s+)?gemini(?!\\s+models?\\b)(?:[\\s-]+(?:\\d+(?:\\.\\d+)*|pro|flash|ultra|nano|live|lite|neon|hydrogen|carbon|argon|exp|experimental|preview|thinking|fast|mini|max|latest|v\\d+|${EFFORT_WORDS}|[·•|/\\-])){1,8}(?:\\s*\\([^)]{1,32}\\))?$`,
      `^(?:anthropic\\s+)?claude(?!\\s+and\\b)(?!\\s+models?\\b)(?:[\\s-]+(?:\\d+(?:\\.\\d+)*|sonnet|opus|haiku|instant|thinking|preview|latest|fast|mini|max|${EFFORT_WORDS}|[·•|/\\-])){1,8}(?:\\s*\\([^)]{1,32}\\))?$`,
      `^(?:openai\\s+)?(?:gpt(?:-[a-z0-9.]+|\\s+\\d[a-z0-9.-]*)|o[134](?:-(?:mini|pro|preview|high|medium|low))?|chatgpt-[a-z0-9.-]+)(?:[\\s-]+(?:\\d+(?:\\.\\d+)*|oss|mini|nano|pro|turbo|preview|latest|\\d+b|${EFFORT_WORDS}|[·•|/\\-])){0,6}(?:\\s*\\([^)]{1,32}\\))?$`,
      `^(?:deepseek|qwen|llama|mistral|mixtral|grok|sonnet|opus|haiku|neon|hydrogen|carbon|argon)(?:[\\s-]+(?:v?\\d+(?:\\.\\d+)*|r\\d+|coder|chat|instruct|pro|flash|mini|max|fast|preview|latest|${EFFORT_WORDS}|[·•|/\\-])){0,6}(?:\\s*\\([^)]{1,32}\\))?$`,
    ].join('|'),
    'i'
  );
  isProtectedModelOrEffortText = (text) => {
    if (typeof text !== 'string') return false;
    const trimmed = text.trim();
    if (!trimmed || trimmed.length > 96) return false;
    return FALLBACK_PROTECTED_RE.test(trimmed);
  };
}

const updateCheckCache = new Map();

/* ==========================================================================
 * 1. SemVer Parsing & Comparison
 * ========================================================================== */

function parseSemver(raw) {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = trimmed.match(SEMVER_RE);
  if (!match) return null;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);
  if (![major, minor, patch].every(Number.isSafeInteger)) return null;
  const prerelease = match[4] ? match[4].split('.').filter(Boolean) : [];
  return { major, minor, patch, prerelease, normalized: `${major}.${minor}.${patch}${match[4] ? `-${match[4]}` : ''}` };
}

/**
 * Standard SemVer 2.0.0 comparator supporting optional `v` prefix and prerelease tags.
 * Returns -1 when a < b, 0 when a == b, 1 when a > b.
 */
function compareSemver(a, b) {
  const pa = parseSemver(String(a ?? ''));
  const pb = parseSemver(String(b ?? ''));
  if (!pa || !pb) {
    throw new TypeError(`Invalid SemVer version: "${String(a)}" vs "${String(b)}"`);
  }
  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1;
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1;
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1;

  const aHasPre = pa.prerelease.length > 0;
  const bHasPre = pb.prerelease.length > 0;
  if (!aHasPre && !bHasPre) return 0;
  if (!aHasPre && bHasPre) return 1;
  if (aHasPre && !bHasPre) return -1;

  const len = Math.max(pa.prerelease.length, pb.prerelease.length);
  for (let i = 0; i < len; i++) {
    const ai = pa.prerelease[i];
    const bi = pb.prerelease[i];
    if (ai === undefined) return -1;
    if (bi === undefined) return 1;
    if (ai === bi) continue;
    const aNum = /^\d+$/.test(ai);
    const bNum = /^\d+$/.test(bi);
    if (aNum && bNum) {
      const an = BigInt(ai);
      const bn = BigInt(bi);
      if (an !== bn) return an > bn ? 1 : -1;
      continue;
    }
    if (aNum && !bNum) return -1;
    if (!aNum && bNum) return 1;
    return ai > bi ? 1 : -1;
  }
  return 0;
}

/* ==========================================================================
 * 2. Strict HTTPS Domain Whitelist (Anti-SSRF)
 * ========================================================================== */

function validateWhitelistedHttpsUrl(rawUrl, allowedHosts) {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    throw new Error('更新 URL 不能为空');
  }
  let parsed;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error(`非法 URL 格式：${rawUrl}`);
  }
  if (parsed.protocol !== 'https:') {
    throw new Error(`仅允许 HTTPS 协议，已拒绝：${parsed.protocol}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error('禁止在更新 URL 中携带凭据');
  }
  if (parsed.port && parsed.port !== '443') {
    throw new Error(`禁止使用非标准端口：${parsed.port}`);
  }
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (!host || net.isIP(host) !== 0 || host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    throw new Error(`禁止访问本地或 IP 地址主机：${host || '(empty)'}`);
  }
  if (!allowedHosts.has(host)) {
    throw new Error(`主机不在安全白名单内，已拒绝：${host}`);
  }
  return parsed.toString();
}

async function fetchWithWhitelistedRedirects(rawUrl, allowedHosts, { fetchImpl = globalThis.fetch, headers = {}, timeoutMs = 15_000 } = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行时缺少 fetch 实现');
  }
  let currentUrl = validateWhitelistedHttpsUrl(rawUrl, allowedHosts);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const init = {
      method: 'GET',
      headers,
      redirect: 'manual',
    };
    if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' && timeoutMs > 0) {
      init.signal = AbortSignal.timeout(timeoutMs);
    }
    const res = await fetchImpl(currentUrl, init);
    const status = Number(res && res.status) || 0;
    if (status >= 300 && status < 400) {
      const location = res.headers && typeof res.headers.get === 'function' ? res.headers.get('location') : '';
      if (!location) {
        throw new Error(`重定向响应缺少 Location 头 (${status})`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new Error('重定向次数超过安全上限');
      }
      const resolvedNext = new URL(location, currentUrl).toString();
      currentUrl = validateWhitelistedHttpsUrl(resolvedNext, allowedHosts);
      continue;
    }
    return { response: res, finalUrl: currentUrl };
  }
  throw new Error('重定向次数超过安全上限');
}

async function readResponseBufferBounded(res, maxBytes) {
  const clRaw = res.headers && typeof res.headers.get === 'function' ? res.headers.get('content-length') : null;
  if (clRaw != null && clRaw !== '') {
    const declared = Number(clRaw);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`下载体积超过安全上限（${declared} > ${maxBytes} 字节）`);
    }
  }

  if (res.body && typeof res.body.getReader === 'function') {
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buf = Buffer.isBuffer(value) ? value : Buffer.from(value);
        total += buf.length;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch {}
          throw new Error(`下载体积超过安全上限（>${maxBytes} 字节）`);
        }
        chunks.push(buf);
      }
    } finally {
      try { reader.releaseLock(); } catch {}
    }
    return Buffer.concat(chunks, total);
  }

  if (typeof res.arrayBuffer === 'function') {
    const ab = await res.arrayBuffer();
    const buf = Buffer.from(ab);
    if (buf.length > maxBytes) {
      throw new Error(`下载体积超过安全上限（${buf.length} > ${maxBytes} 字节）`);
    }
    return buf;
  }

  if (typeof res.text === 'function') {
    const buf = Buffer.from(await res.text(), 'utf8');
    if (buf.length > maxBytes) {
      throw new Error(`下载体积超过安全上限（${buf.length} > ${maxBytes} 字节）`);
    }
    return buf;
  }

  throw new Error('无法读取响应体');
}

/* ==========================================================================
 * 3. GitHub Releases Check
 * ========================================================================== */

function selectPluginAsset(assets) {
  if (!Array.isArray(assets) || !assets.length) return null;
  const validZipAssets = assets.filter((a) => {
    if (!a || typeof a.name !== 'string' || !/\.zip$/i.test(a.name)) return false;
    if (typeof a.browser_download_url !== 'string' || !a.browser_download_url.trim()) return false;
    try {
      validateWhitelistedHttpsUrl(a.browser_download_url, ALLOWED_RELEASE_HOSTS);
      return true;
    } catch {
      return false;
    }
  });
  if (!validZipAssets.length) return null;

  const exact = validZipAssets.find((a) => /^antigravity-maomao-plugin-v.*\.zip$/i.test(a.name));
  if (exact) return exact;
  const fallback = validZipAssets.find((a) => /plugin/i.test(a.name));
  return fallback || null;
}

/**
 * Check GitHub Releases latest version against `currentVersion`.
 */
async function checkForPluginUpdate({
  currentVersion = '0.0.0',
  repo = DEFAULT_REPO,
  fetchImpl = globalThis.fetch,
  force = false,
  cacheTtlMs = DEFAULT_CACHE_TTL_MS,
  now = Date.now,
} = {}) {
  const cleanRepo = String(repo || DEFAULT_REPO).trim();
  if (!REPO_RE.test(cleanRepo)) {
    throw new Error(`非法 GitHub 仓库标识：${cleanRepo}`);
  }
  const nowMs = typeof now === 'function' ? now() : Date.now();
  const parsedCurrent = parseSemver(String(currentVersion || ''));
  const normalizedCurrent = parsedCurrent ? parsedCurrent.normalized : String(currentVersion || '').replace(/^v/i, '').trim();
  const cacheKey = `${cleanRepo}::${normalizedCurrent}`;

  if (!force && cacheTtlMs > 0) {
    const cached = updateCheckCache.get(cacheKey);
    if (cached && nowMs - cached.at < cacheTtlMs) {
      return { ...cached.value };
    }
  }

  const apiUrl = `https://api.github.com/repos/${cleanRepo}/releases/latest`;
  const { response } = await fetchWithWhitelistedRedirects(apiUrl, ALLOWED_RELEASE_HOSTS, {
    fetchImpl,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'Antigravity-Maomao-Updater/0.4',
    },
    timeoutMs: 12_000,
  });

  if (!response || !response.ok) {
    throw new Error(`检查更新失败（HTTP ${response ? response.status : 'network'}）`);
  }

  const data = typeof response.json === 'function'
    ? await response.json()
    : JSON.parse((await readResponseBufferBounded(response, DEFAULT_I18N_MAX_BYTES)).toString('utf8'));

  const rawTag = String((data && (data.tag_name || data.name)) || '').trim();
  const parsedLatest = parseSemver(rawTag);
  const latestVersion = parsedLatest ? parsedLatest.normalized : rawTag.replace(/^v/i, '');
  const hasUpdate = Boolean(parsedLatest && parsedCurrent && compareSemver(latestVersion, normalizedCurrent) > 0);
  const asset = selectPluginAsset(data && data.assets);

  let releaseUrl = '';
  if (data && typeof data.html_url === 'string' && data.html_url.trim()) {
    try {
      releaseUrl = validateWhitelistedHttpsUrl(data.html_url, ALLOWED_RELEASE_HOSTS);
    } catch {
      releaseUrl = '';
    }
  }

  const result = {
    currentVersion: normalizedCurrent,
    latestVersion,
    hasUpdate,
    releaseNotes: typeof (data && data.body) === 'string' ? data.body : '',
    releaseUrl,
    assetName: asset ? String(asset.name || '') : '',
    assetSize: asset && Number.isFinite(Number(asset.size)) ? Number(asset.size) : 0,
    downloadUrl: asset ? String(asset.browser_download_url || '') : '',
    publishedAt: typeof (data && data.published_at) === 'string' ? data.published_at : '',
    checkedAt: new Date(nowMs).toISOString(),
  };

  updateCheckCache.set(cacheKey, { at: nowMs, value: result });
  return { ...result };
}

/* ==========================================================================
 * 4. Zip-Slip Verification, Extraction, & Atomic Backup/Swap/Rollback
 * ========================================================================== */

function canonicalForCompare(p) {
  const norm = path.resolve(p);
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function isStrictlyInside(rootDir, candidatePath) {
  const base = canonicalForCompare(rootDir);
  const target = canonicalForCompare(candidatePath);
  const rel = path.relative(base, target);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function validateArchiveEntryName(entryName, extractDir) {
  const name = String(entryName || '');
  if (!name || name.includes('\0')) {
    throw new Error(`压缩包包含非法空/控制字符路径：${name}`);
  }
  if (/^[A-Za-z]:/.test(name) || name.startsWith('/') || name.startsWith('\\')) {
    throw new Error(`检测到 Zip-Slip 绝对路径越界：${name}`);
  }
  const segments = name.split(/[\\/]+/);
  if (segments.some((seg) => seg === '..')) {
    throw new Error(`检测到 Zip-Slip 目录穿越：${name}`);
  }
  const resolved = path.resolve(extractDir, name);
  if (canonicalForCompare(resolved) !== canonicalForCompare(extractDir) && !isStrictlyInside(extractDir, resolved)) {
    throw new Error(`检测到 Zip-Slip 越界路径：${name}`);
  }
}

/**
 * Inspect ZIP Central Directory entries before extraction to stop Zip-Slip before any file touches disk.
 */
function inspectZipEntriesForSlip(zipBuf, extractDir) {
  if (!Buffer.isBuffer(zipBuf) || zipBuf.length < 22) return;
  // Locate End of Central Directory (EOCD) signature 0x06054b50 from end (max comment 65535 bytes).
  const minOffset = Math.max(0, zipBuf.length - 65557);
  let eocdOffset = -1;
  for (let i = zipBuf.length - 22; i >= minOffset; i--) {
    if (
      zipBuf[i] === 0x50 &&
      zipBuf[i + 1] === 0x4b &&
      zipBuf[i + 2] === 0x05 &&
      zipBuf[i + 3] === 0x06
    ) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) return; // Not a standard ZIP (may be a mock buffer handled by custom extractZip).

  const totalEntries = zipBuf.readUInt16LE(eocdOffset + 10);
  const cdSize = zipBuf.readUInt32LE(eocdOffset + 12);
  const cdOffset = zipBuf.readUInt32LE(eocdOffset + 16);
  if (cdOffset + cdSize > zipBuf.length) {
    throw new Error('压缩包中央目录损坏或被截断');
  }

  let cursor = cdOffset;
  for (let idx = 0; idx < totalEntries && cursor + 46 <= cdOffset + cdSize; idx++) {
    if (zipBuf.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('压缩包中央目录条目头无效');
    }
    const nameLen = zipBuf.readUInt16LE(cursor + 28);
    const extraLen = zipBuf.readUInt16LE(cursor + 30);
    const commentLen = zipBuf.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLen;
    if (nameEnd > zipBuf.length) throw new Error('压缩包条目文件名截断');
    const entryName = zipBuf.subarray(nameStart, nameEnd).toString('utf8');
    validateArchiveEntryName(entryName, extractDir);
    cursor = nameEnd + extraLen + commentLen;
  }
}

/**
 * Post-extraction full filesystem tree verification: ensures every extracted file/dir
 * resolves strictly inside `extractDir` and contains no escaping symlinks.
 */
function verifyExtractedTreeSafe(extractDir) {
  const realRoot = fs.realpathSync(extractDir);
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (!isStrictlyInside(realRoot, full)) {
        throw new Error(`检测到解压路径越界：${full}`);
      }
      const lst = fs.lstatSync(full);
      if (lst.isSymbolicLink()) {
        throw new Error(`插件压缩包不允许包含符号链接：${entry.name}`);
      }
      if (lst.isDirectory()) {
        walk(full);
      }
    }
  };
  walk(realRoot);
}

function defaultExtractZip(zipPath, extractDir) {
  return new Promise((resolvePromise, rejectPromise) => {
    fs.mkdirSync(extractDir, { recursive: true });
    if (process.platform === 'win32') {
      const script = [
        "$ErrorActionPreference = 'Stop'",
        'Add-Type -AssemblyName System.IO.Compression.FileSystem',
        '$dstFull = [System.IO.Path]::GetFullPath($env:MAOMAO_ZIP_DST)',
        'if (-not $dstFull.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $dstFull += [System.IO.Path]::DirectorySeparatorChar }',
        '$zip = [System.IO.Compression.ZipFile]::OpenRead($env:MAOMAO_ZIP_SRC)',
        'try {',
        '  foreach ($entry in $zip.Entries) {',
        '    $rel = $entry.FullName',
        '    if ([string]::IsNullOrEmpty($rel)) { continue }',
        '    $target = [System.IO.Path]::GetFullPath((Join-Path $dstFull $rel))',
        '    if (-not $target.StartsWith($dstFull, [System.StringComparison]::OrdinalIgnoreCase)) {',
        '      throw ("Zip-Slip blocked: " + $rel)',
        '    }',
        '    if ($rel.EndsWith("/") -or $rel.EndsWith("\\")) {',
        '      [System.IO.Directory]::CreateDirectory($target) | Out-Null',
        '    } else {',
        '      $parent = [System.IO.Path]::GetDirectoryName($target)',
        '      if ($parent) { [System.IO.Directory]::CreateDirectory($parent) | Out-Null }',
        '      [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $true)',
        '    }',
        '  }',
        '} finally {',
        '  $zip.Dispose()',
        '}',
      ].join('\n');
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        {
          shell: false,
          windowsHide: true,
          timeout: 60_000,
          env: { ...process.env, MAOMAO_ZIP_SRC: zipPath, MAOMAO_ZIP_DST: extractDir },
        },
        (err, _stdout, stderr) => {
          if (err) {
            rejectPromise(new Error(`解压插件包失败：${(stderr && stderr.trim()) || err.message}`));
            return;
          }
          resolvePromise();
        }
      );
      return;
    }

    execFile('unzip', ['-qq', '-o', zipPath, '-d', extractDir], { shell: false, timeout: 60_000 }, (err, _stdout, stderr) => {
      if (err) {
        rejectPromise(new Error(`解压插件包失败：${(stderr && stderr.trim()) || err.message}`));
        return;
      }
      resolvePromise();
    });
  });
}

function locateValidatedPluginPackage(extractDir) {
  const candidates = [extractDir];
  try {
    const topEntries = fs.readdirSync(extractDir, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name !== '__MACOSX');
    if (topEntries.length === 1) {
      candidates.push(path.join(extractDir, topEntries[0].name));
    }
  } catch {}

  for (const cand of candidates) {
    const manifestPath = path.join(cand, 'plugin.json');
    if (!fs.existsSync(manifestPath)) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch {
      throw new Error('更新包内 plugin.json 无法解析');
    }
    if (!manifest || typeof manifest !== 'object' || manifest.name !== 'antigravity-star-suite') {
      throw new Error(`更新包插件标识不匹配：${String(manifest && manifest.name)}`);
    }
    const parsedVer = parseSemver(String(manifest.version || ''));
    if (!parsedVer) {
      throw new Error(`更新包内 plugin.json 版本号无效：${String(manifest.version)}`);
    }
    const mainEntry = path.join(cand, 'sidecars', 'star-suite', 'main.mjs');
    if (!fs.existsSync(mainEntry) || !fs.statSync(mainEntry).isFile()) {
      throw new Error('更新包缺少核心入口 sidecars/star-suite/main.mjs');
    }
    return { packageRoot: cand, manifest, version: parsedVer.normalized };
  }

  throw new Error('更新包内未找到有效的 plugin.json');
}

function copyDirRecursive(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) {
      throw new Error(`拒绝复制符号链接：${entry.name}`);
    }
    if (st.isDirectory()) {
      copyDirRecursive(src, dst);
    } else if (st.isFile()) {
      fs.copyFileSync(src, dst);
    }
  }
}

function readExistingPluginVersion(targetDir) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8'));
    return typeof raw.version === 'string' ? raw.version.trim() : '';
  } catch {
    return '';
  }
}

function syncDirInPlace(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  const srcNames = new Set();
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    srcNames.add(entry.name);
    const src = path.join(srcDir, entry.name);
    const dst = path.join(dstDir, entry.name);
    const st = fs.lstatSync(src);
    if (st.isSymbolicLink()) {
      throw new Error(`拒绝复制符号链接：${entry.name}`);
    }
    if (st.isDirectory()) {
      if (fs.existsSync(dst) && !fs.lstatSync(dst).isDirectory()) {
        fs.rmSync(dst, { force: true });
      }
      syncDirInPlace(src, dst);
    } else if (st.isFile()) {
      if (fs.existsSync(dst) && fs.lstatSync(dst).isDirectory()) {
        fs.rmSync(dst, { recursive: true, force: true });
      }
      fs.copyFileSync(src, dst);
    }
  }
  for (const existing of fs.readdirSync(dstDir, { withFileTypes: true })) {
    if (!srcNames.has(existing.name)) {
      fs.rmSync(path.join(dstDir, existing.name), { recursive: true, force: true });
    }
  }
}

/**
 * Download, verify, backup, atomically install, and auto-rollback on any error.
 */
async function downloadAndInstallUpdate({
  downloadUrl,
  targetDir,
  tempRoot,
  fetchImpl = globalThis.fetch,
  extractZip = defaultExtractZip,
  maxBytes = DEFAULT_MAX_BYTES,
  _afterBackupHook = null,
} = {}) {
  const safeUrl = validateWhitelistedHttpsUrl(downloadUrl, ALLOWED_RELEASE_HOSTS);
  if (typeof targetDir !== 'string' || !targetDir.trim()) {
    throw new Error('必须指定插件安装目标目录 targetDir');
  }
  const resolvedTarget = path.resolve(targetDir);
  if (path.parse(resolvedTarget).root === resolvedTarget) {
    throw new Error('禁止将文件系统根目录作为插件安装目标');
  }
  const userSettingsDir = path.resolve(path.join(os.homedir(), '.antigravity-dream-skin'));
  if (canonicalForCompare(resolvedTarget) === canonicalForCompare(userSettingsDir)) {
    throw new Error('禁止覆盖用户配置目录 ~/.antigravity-dream-skin');
  }

  const baseTemp = tempRoot ? path.resolve(tempRoot) : os.tmpdir();
  fs.mkdirSync(baseTemp, { recursive: true });
  const workDir = fs.mkdtempSync(path.join(baseTemp, 'maomao-update-'));
  const zipPath = path.join(workDir, 'plugin-update.zip');
  const extractDir = path.join(workDir, 'extracted');

  const stamp = `${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const parentDir = path.dirname(resolvedTarget);
  const baseName = path.basename(resolvedTarget);
  const stageDir = path.join(parentDir, `.${baseName}.stage-${stamp}`);
  const backupDir = path.join(parentDir, `.${baseName}.bak-${stamp}`);

  try {
    // 1. Download with strict redirect whitelist & byte cap
    const { response } = await fetchWithWhitelistedRedirects(safeUrl, ALLOWED_RELEASE_HOSTS, {
      fetchImpl,
      headers: { 'User-Agent': 'Antigravity-Maomao-Updater/0.4' },
      timeoutMs: 60_000,
    });
    if (!response || !response.ok) {
      throw new Error(`下载更新包失败（HTTP ${response ? response.status : 'network'}）`);
    }
    const zipBuf = await readResponseBufferBounded(response, maxBytes);
    if (!zipBuf.length) {
      throw new Error('下载的更新包为空');
    }

    // 2. Pre-extraction Zip-Slip check on Central Directory
    fs.mkdirSync(extractDir, { recursive: true });
    inspectZipEntriesForSlip(zipBuf, extractDir);
    fs.writeFileSync(zipPath, zipBuf);

    // 3. Extract & post-extraction full-tree Zip-Slip verification
    await extractZip(zipPath, extractDir);
    verifyExtractedTreeSafe(extractDir);

    // 4. Strictly verify plugin.json & sidecars/star-suite/main.mjs
    const { packageRoot, version: toVersion } = locateValidatedPluginPackage(extractDir);
    const fromVersion = readExistingPluginVersion(resolvedTarget);

    // 5. Stage on same filesystem, backup existing targetDir, atomic swap with guaranteed rollback
    fs.mkdirSync(parentDir, { recursive: true });
    copyDirRecursive(packageRoot, stageDir);

    const hadExisting = fs.existsSync(resolvedTarget);
    let backedUp = false;
    let inPlaceMode = false;
    try {
      if (hadExisting) {
        try {
          fs.renameSync(resolvedTarget, backupDir);
          backedUp = true;
        } catch (renameErr) {
          // On Windows, if running sidecar cwd is inside targetDir, renameSync returns EPERM/EBUSY.
          if (renameErr && (renameErr.code === 'EPERM' || renameErr.code === 'EBUSY')) {
            copyDirRecursive(resolvedTarget, backupDir);
            backedUp = true;
            inPlaceMode = true;
          } else {
            throw renameErr;
          }
        }
      }

      if (typeof _afterBackupHook === 'function') {
        await _afterBackupHook({ backupDir, stageDir, targetDir: resolvedTarget });
      }

      if (inPlaceMode) {
        syncDirInPlace(stageDir, resolvedTarget);
      } else {
        fs.renameSync(stageDir, resolvedTarget);
      }

      // Final sanity verification on live target
      if (
        !fs.existsSync(path.join(resolvedTarget, 'plugin.json')) ||
        !fs.existsSync(path.join(resolvedTarget, 'sidecars', 'star-suite', 'main.mjs'))
      ) {
        throw new Error('安装后完整性校验失败');
      }
    } catch (swapErr) {
      if (inPlaceMode && backedUp && fs.existsSync(backupDir)) {
        try {
          syncDirInPlace(backupDir, resolvedTarget);
        } catch {}
      } else {
        try {
          if (fs.existsSync(resolvedTarget)) {
            fs.rmSync(resolvedTarget, { recursive: true, force: true });
          }
        } catch {}
        if (backedUp && fs.existsSync(backupDir)) {
          try {
            fs.renameSync(backupDir, resolvedTarget);
          } catch {}
        }
      }
      throw swapErr;
    }

    // Clean up backup after confirmed swap
    if (backedUp && fs.existsSync(backupDir)) {
      try {
        fs.rmSync(backupDir, { recursive: true, force: true });
      } catch {}
    }

    return {
      ok: true,
      fromVersion,
      toVersion,
      targetDir: resolvedTarget,
    };
  } finally {
    try { fs.rmSync(stageDir, { recursive: true, force: true }); } catch {}
    try { fs.rmSync(workDir, { recursive: true, force: true }); } catch {}
  }
}

/* ==========================================================================
 * 5. Hot-Reloadable i18n Override Dictionary (Model/Effort Red-Line Safe)
 * ========================================================================== */

function defaultI18nOverridePath() {
  return path.join(os.homedir(), '.antigravity-dream-skin', 'i18n-override.json');
}

function sanitizeOverrideDict(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? (raw.dict && typeof raw.dict === 'object' && !Array.isArray(raw.dict) ? raw.dict : raw)
    : null;
  const clean = {};
  if (!source) return clean;

  let count = 0;
  for (const [rawKey, rawVal] of Object.entries(source)) {
    if (count >= MAX_OVERRIDE_ENTRIES) break;
    if (typeof rawKey !== 'string' || typeof rawVal !== 'string') continue;
    if (FORBIDDEN_KEYS.has(rawKey)) continue;
    const key = rawKey.trim();
    const val = rawVal.trim();
    if (!key || !val) continue;
    if (key.length > MAX_OVERRIDE_KEY_LEN || val.length > MAX_OVERRIDE_VALUE_LEN) continue;
    if (/[\x00-\x1f\x7f]/.test(key) || /[\x00-\x1f\x7f]/.test(val)) continue;
    // Red-line invariant: NEVER allow translating model names or thinking effort labels!
    if (isProtectedModelOrEffortText(key)) continue;
    clean[key] = val;
    count++;
  }
  return clean;
}

/**
 * Safely load and sanitize `~/.antigravity-dream-skin/i18n-override.json`.
 * Never throws on missing or corrupt files; enforces model/effort red-line & length limits.
 */
function loadI18nOverrideDict(filePath = defaultI18nOverridePath()) {
  if (typeof filePath !== 'string' || !filePath.trim()) return {};
  try {
    if (!fs.existsSync(filePath)) return {};
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitizeOverrideDict(parsed);
  } catch {
    return {};
  }
}

function writeJsonAtomic(filePath, payload) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomBytes(3).toString('hex')}`);
  try {
    fs.writeFileSync(tmpFile, JSON.stringify(payload, null, 2) + '\n', 'utf8');
    fs.renameSync(tmpFile, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmpFile); } catch {}
    throw err;
  }
}

/**
 * Fetch optional remote i18n patch dictionary from HTTPS whitelist (`raw.githubusercontent.com` / `github.com`),
 * sanitize through model/effort protection, and atomically persist locally.
 * On offline / 404 / parse failure, degrades gracefully and returns local dictionary without throwing.
 * Non-whitelisted or non-HTTPS URLs are strictly rejected with an Error.
 */
async function syncRemoteI18nDict({
  url = DEFAULT_REMOTE_I18N_URL,
  filePath = defaultI18nOverridePath(),
  fetchImpl = globalThis.fetch,
  maxBytes = DEFAULT_I18N_MAX_BYTES,
} = {}) {
  // Always enforce strict HTTPS domain whitelist before touching the network.
  const safeUrl = validateWhitelistedHttpsUrl(url, ALLOWED_I18N_HOSTS);
  const localFallback = (reason) => {
    const localDict = loadI18nOverrideDict(filePath);
    return {
      ok: true,
      degraded: true,
      source: 'local',
      reason,
      dict: localDict,
      count: Object.keys(localDict).length,
      filePath,
    };
  };

  try {
    const { response } = await fetchWithWhitelistedRedirects(safeUrl, ALLOWED_I18N_HOSTS, {
      fetchImpl,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Antigravity-Maomao-Updater/0.4',
      },
      timeoutMs: 10_000,
    });
    if (!response || !response.ok) {
      return localFallback(`HTTP ${response ? response.status : 'network'}`);
    }
    const buf = await readResponseBufferBounded(response, maxBytes);
    const parsed = JSON.parse(buf.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return localFallback('invalid_remote_json');
    }
    const sanitized = sanitizeOverrideDict(parsed);
    writeJsonAtomic(filePath, sanitized);
    return {
      ok: true,
      degraded: false,
      source: 'remote',
      dict: sanitized,
      count: Object.keys(sanitized).length,
      filePath,
      syncedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Re-throw whitelist / security violations discovered during redirect hops.
    if (err && /白名单|仅允许 HTTPS|禁止访问本地|凭据|非标准端口/.test(String(err.message || ''))) {
      throw err;
    }
    return localFallback(err instanceof Error ? err.message : String(err));
  }
}

function clearUpdateCheckCache() {
  updateCheckCache.clear();
}

module.exports = {
  compareSemver,
  parseSemver,
  checkForPluginUpdate,
  downloadAndInstallUpdate,
  loadI18nOverrideDict,
  syncRemoteI18nDict,
  validateWhitelistedHttpsUrl,
  sanitizeOverrideDict,
  clearUpdateCheckCache,
  DEFAULT_REPO,
  DEFAULT_REMOTE_I18N_URL,
  ALLOWED_RELEASE_HOSTS,
  ALLOWED_I18N_HOSTS,
};
