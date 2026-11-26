'use strict';

/**
 * Local quota bridge, non-destructive hidden subagent archiver, GOMEMLIMIT
 * environment guard, debug-port shortcut repair, and safe Git Diff helper.
 *
 * 100% clean-room MIT implementation, zero external npm dependencies.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { discover, listTargets, Cdp } = require('../../../shared/host.cjs');
const {
  isValidConversationId,
  resolveAppDataDir,
  readTrajectoryIndexEntry,
  clearTelemetryCaches,
} = require('./telemetry-db.cjs');

const ALLOWED_GOMEMLIMIT_PRESETS = Object.freeze(['', '2GiB', '2500MiB', '3GiB', '4GiB']);
const ALLOWED_GOMEMLIMIT_SET = new Set(ALLOWED_GOMEMLIMIT_PRESETS);

const VALID_BATCH_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const DEBUG_FLAG = '--remote-debugging-port=0';
const HAS_DEBUG_RE = /(?:^|\s)--remote-debugging-port(?:=\S+|\s+\d+|\b)/;

const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico', '.tif', '.tiff', '.avif',
  '.mp4', '.webm', '.mov', '.avi', '.mkv', '.mp3', '.wav', '.ogg', '.flac', '.m4a',
  '.pdf', '.zip', '.gz', '.tar', '.7z', '.rar', '.bz2', '.xz',
  '.exe', '.dll', '.so', '.dylib', '.bin', '.o', '.obj', '.pdb', '.node',
  '.db', '.db-wal', '.db-shm', '.sqlite', '.sqlite3',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
]);

function timestampToMs(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (!value || typeof value !== 'object') return null;
  if (value.seconds !== undefined && value.seconds !== null) {
    const seconds = Number(value.seconds);
    if (!Number.isFinite(seconds)) return null;
    const nanos = Number(value.nanos);
    return Math.round(seconds * 1000 + (Number.isFinite(nanos) ? nanos / 1e6 : 0));
  }
  return null;
}

function normalizeQuotaGroupId(displayName = '', buckets = []) {
  const bucketText = buckets.map((b) => String((b && b.bucketId) || '')).join(' ');
  const combined = `${displayName} ${bucketText}`;
  if (/claude|gpt|\b3p\b/i.test(combined)) return { id: 'claude', name: displayName || 'Claude / GPT' };
  if (/argon/i.test(combined)) return { id: 'argon', name: displayName || 'Gemini Argon' };
  if (/flash/i.test(combined) && /gemini/i.test(combined)) return { id: 'gemini-flash', name: displayName || 'Gemini Flash' };
  if (/gemini/i.test(combined)) return { id: 'gemini-pro', name: displayName || 'Gemini Models' };
  const clean = String(displayName || 'Quota Pool').trim();
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'quota';
  return { id: slug, name: clean };
}

function normalizeRemainingPercent(bucket) {
  const raw = bucket && bucket.remaining && bucket.remaining.case === 'remainingFraction'
    ? bucket.remaining.value
    : (bucket && bucket.remainingFraction !== undefined ? bucket.remainingFraction : bucket && bucket.remaining);
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return null;
  if (raw >= 0 && raw <= 1) return Number((raw * 100).toFixed(1));
  if (raw > 1 && raw <= 100) return Number(raw.toFixed(1));
  return null;
}

function normalizeQuotaGroups(rawGroups) {
  if (!Array.isArray(rawGroups)) return [];
  const byId = new Map();

  for (const group of rawGroups) {
    if (!group || typeof group !== 'object') continue;
    const buckets = Array.isArray(group.buckets) ? group.buckets : [];

    // Also accept already-normalized { id, name, windows: { '5h', weekly } } shape.
    if (!buckets.length && group.windows && typeof group.windows === 'object') {
      const id = String(group.id || normalizeQuotaGroupId(group.name).id);
      const name = String(group.name || id);
      const w5h = group.windows['5h'] || {};
      const wWeek = group.windows.weekly || {};
      byId.set(id, {
        id,
        name,
        windows: {
          '5h': {
            remaining: typeof w5h.remaining === 'number' && Number.isFinite(w5h.remaining) ? Number(w5h.remaining.toFixed(1)) : null,
            resetAt: timestampToMs(w5h.resetAt),
          },
          weekly: {
            remaining: typeof wWeek.remaining === 'number' && Number.isFinite(wWeek.remaining) ? Number(wWeek.remaining.toFixed(1)) : null,
            resetAt: timestampToMs(wWeek.resetAt),
          },
        },
      });
      continue;
    }

    const { id, name } = normalizeQuotaGroupId(group.displayName || group.name || '', buckets);
    const entry = byId.get(id) || {
      id,
      name,
      windows: {
        '5h': { remaining: null, resetAt: null },
        weekly: { remaining: null, resetAt: null },
      },
    };

    for (const bucket of buckets) {
      if (!bucket || bucket.disabled === true) continue;
      const bucketId = String(bucket.bucketId || '');
      const isWeekly = bucket.window === 'weekly' || /weekly|7d|week/i.test(bucketId);
      const is5h = bucket.window === '5h' || /5h|five|short/i.test(bucketId);
      const winKey = isWeekly ? 'weekly' : is5h ? '5h' : null;
      if (!winKey) continue;
      const remaining = normalizeRemainingPercent(bucket);
      const resetAt = timestampToMs(bucket.resetTime != null ? bucket.resetTime : bucket.resetTimeMs);
      if (remaining !== null) entry.windows[winKey].remaining = remaining;
      if (resetAt !== null) entry.windows[winKey].resetAt = resetAt;
    }

    byId.set(id, entry);
  }

  return [...byId.values()];
}

/**
 * Self-contained browser-side reader compatible with existing host-quota.cjs logic.
 * Evaluates in the Antigravity renderer window via CDP; reads only quota summaries.
 */
function readHostQuotaGroupsInBrowser() {
  const serializeTimestamp = (ts) => {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      const p = Date.parse(ts);
      return Number.isFinite(p) ? p : null;
    }
    if (ts && typeof ts === 'object' && ts.seconds != null) {
      const sec = Number(ts.seconds);
      const nan = Number(ts.nanos) || 0;
      return Number.isFinite(sec) ? Math.round(sec * 1000 + nan / 1e6) : null;
    }
    return null;
  };
  const packGroups = (groups) => {
    if (!Array.isArray(groups)) return [];
    return groups.filter((g) => g && Array.isArray(g.buckets)).map((g) => ({
      displayName: String(g.displayName || g.name || ''),
      buckets: g.buckets.filter((b) => b && !b.disabled).map((b) => ({
        bucketId: String(b.bucketId || ''),
        window: b.window || '',
        disabled: Boolean(b.disabled),
        remainingFraction: b.remaining && b.remaining.case === 'remainingFraction'
          ? b.remaining.value
          : (typeof b.remainingFraction === 'number' ? b.remainingFraction : null),
        resetTimeMs: serializeTimestamp(b.resetTime != null ? b.resetTime : b.resetTimeMs),
      })),
    }));
  };

  let groups = typeof nY !== 'undefined' && Array.isArray(nY) ? nY : (typeof pY !== 'undefined' && Array.isArray(pY) ? pY : []);
  if (!groups.length && typeof document !== 'undefined') {
    const seen = new Set();
    for (const el of document.querySelectorAll('[role=dialog] *')) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let fiber = key ? el[key] : null;
      for (let i = 0; fiber && i < 40; fiber = fiber.return, i++) {
        if (seen.has(fiber)) break;
        seen.add(fiber);
        for (let state = fiber.memoizedState, j = 0; state && j < 80; state = state.next, j++) {
          if (Array.isArray(state.memoizedState) && state.memoizedState.some((g) => g && Array.isArray(g.buckets))) {
            groups = state.memoizedState;
            break;
          }
        }
        if (groups.length) break;
      }
      if (groups.length) break;
    }
  }
  const timestamp = typeof nY !== 'undefined' && Array.isArray(nY) && typeof mFb === 'number'
    ? mFb
    : (typeof jFb === 'number' ? jFb : null);
  const fetchedAt = typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0 && timestamp <= Date.now() + 60000
    ? timestamp
    : null;
  const packed = packGroups(groups);
  return { cacheAvailable: packed.length > 0, groups: packed, fetchedAt };
}

async function queryHostQuotaGroupsInBrowser(readCacheFn) {
  const serializeTimestamp = (ts) => {
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
    if (typeof ts === 'string') {
      const p = Date.parse(ts);
      return Number.isFinite(p) ? p : null;
    }
    if (ts && typeof ts === 'object' && ts.seconds != null) {
      const sec = Number(ts.seconds);
      const nan = Number(ts.nanos) || 0;
      return Number.isFinite(sec) ? Math.round(sec * 1000 + nan / 1e6) : null;
    }
    return null;
  };
  const seen = new Set();
  if (typeof document !== 'undefined') {
    for (const el of document.querySelectorAll('body *')) {
      const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
      let fiber = key ? el[key] : null;
      for (; fiber && !seen.has(fiber); fiber = fiber.return) {
        seen.add(fiber);
        const service = fiber.memoizedProps && fiber.memoizedProps.value && fiber.memoizedProps.value.core && fiber.memoizedProps.value.core.cloudCodeService;
        if (typeof (service && service.retrieveUserQuotaSummary) !== 'function') continue;
        const response = await service.retrieveUserQuotaSummary(undefined, false);
        const rawGroups = response && response.response && response.response.groups;
        if (!Array.isArray(rawGroups) || !rawGroups.length) break;
        const groups = rawGroups.filter((g) => g && Array.isArray(g.buckets)).map((g) => ({
          displayName: String(g.displayName || g.name || ''),
          buckets: g.buckets.filter((b) => b && !b.disabled).map((b) => ({
            bucketId: String(b.bucketId || ''),
            window: b.window || '',
            disabled: Boolean(b.disabled),
            remainingFraction: b.remaining && b.remaining.case === 'remainingFraction'
              ? b.remaining.value
              : (typeof b.remainingFraction === 'number' ? b.remainingFraction : null),
            resetTimeMs: serializeTimestamp(b.resetTime != null ? b.resetTime : b.resetTimeMs),
          })),
        }));
        return { cacheAvailable: groups.length > 0, groups, fetchedAt: Date.now() };
      }
    }
  }
  return readCacheFn();
}

function defaultQuotaCacheFile(opts = {}) {
  if (opts.cacheFile) return opts.cacheFile;
  const dir = resolveAppDataDir(opts.appDataDir);
  return path.join(dir, 'plugin_data', 'antigravity-star-suite', 'quota-cache.json');
}

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function writeJsonSafe(filePath, value) {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  } catch {
    // Non-fatal cache write error.
  }
}

function buildQuotaResult(groups, meta = {}) {
  const primary = groups.find((g) => g.id === 'gemini-pro') || groups[0] || null;
  return {
    status: meta.status || (groups.length ? 'ready' : 'quota-unavailable'),
    online: Boolean(meta.online),
    cached: Boolean(meta.cached),
    stale: Boolean(meta.stale),
    fetchedAt: Number.isFinite(meta.fetchedAt) ? meta.fetchedAt : null,
    observedAt: Number.isFinite(meta.observedAt) ? meta.observedAt : null,
    fiveHour: primary && primary.windows['5h'] ? primary.windows['5h'].remaining : null,
    weekly: primary && primary.windows.weekly ? primary.windows.weekly.remaining : null,
    groups,
  };
}

/**
 * Read current dual-window (5h + weekly) model quota snapshot from Antigravity host CDP
 * with graceful fallback to local cache file.
 */
async function readQuotaSnapshot(opts = {}) {
  const nowFn = typeof opts.now === 'function' ? opts.now : Date.now;
  const nowMs = nowFn();
  const cacheFile = defaultQuotaCacheFile(opts);
  const staleThresholdMs = Number.isFinite(opts.staleThresholdMs) ? opts.staleThresholdMs : 300_000;

  // Direct normalization fast-path (for sidecar/test injection).
  if (Array.isArray(opts.rawGroups)) {
    const groups = normalizeQuotaGroups(opts.rawGroups);
    const snapshot = buildQuotaResult(groups, {
      status: groups.length ? 'ready' : 'quota-unavailable',
      online: true,
      cached: false,
      stale: false,
      fetchedAt: Number.isFinite(opts.fetchedAt) ? opts.fetchedAt : nowMs,
      observedAt: nowMs,
    });
    if (groups.length && opts.persistCache !== false) {
      writeJsonSafe(cacheFile, { groups, fetchedAt: snapshot.fetchedAt, observedAt: snapshot.observedAt });
    }
    return snapshot;
  }

  const discoverFn = opts.discover || discover;
  const createClient = opts.createClient || ((url) => new (opts.Client || Cdp)(url, { handshakeTimeout: 1500, requestTimeout: 3500 }));
  let client = null;

  try {
    const host = await discoverFn();
    if (!host || !host.target || !host.target.webSocketDebuggerUrl) {
      const cached = readJsonSafe(cacheFile);
      if (cached && Array.isArray(cached.groups) && cached.groups.length) {
        const groups = normalizeQuotaGroups(cached.groups);
        const obs = Number.isFinite(cached.observedAt) ? cached.observedAt : null;
        return buildQuotaResult(groups, {
          status: 'cached',
          online: false,
          cached: true,
          stale: obs == null || nowMs - obs >= staleThresholdMs,
          fetchedAt: cached.fetchedAt ?? null,
          observedAt: obs,
        });
      }
      return buildQuotaResult([], { status: 'waiting-host', online: false, cached: false, stale: true });
    }

    client = createClient(host.target.webSocketDebuggerUrl);
    const sample = await client.evaluate(
      `(${queryHostQuotaGroupsInBrowser.toString()})(${readHostQuotaGroupsInBrowser.toString()})`
    );

    if (sample && sample.cacheAvailable) {
      const rawList = Array.isArray(sample.groups) && sample.groups.length
        ? sample.groups
        : (typeof sample.fiveHour === 'number' || typeof sample.weekly === 'number'
            ? [{
                displayName: 'Gemini Models',
                buckets: [
                  ...(typeof sample.fiveHour === 'number' ? [{ bucketId: 'gemini-5h', window: '5h', remaining: sample.fiveHour }] : []),
                  ...(typeof sample.weekly === 'number' ? [{ bucketId: 'gemini-weekly', window: 'weekly', remaining: sample.weekly }] : []),
                ],
              }]
            : []);
      if (rawList.length) {
        const groups = normalizeQuotaGroups(rawList);
        const fetchedAt = Number.isFinite(sample.fetchedAt) ? sample.fetchedAt : nowMs;
        const snapshot = buildQuotaResult(groups, {
          status: groups.length ? 'ready' : 'quota-unavailable',
          online: true,
          cached: false,
          stale: false,
          fetchedAt,
          observedAt: nowMs,
        });
        if (groups.length && opts.persistCache !== false) {
          writeJsonSafe(cacheFile, { groups, fetchedAt, observedAt: nowMs });
        }
        return snapshot;
      }
    }

    const cached = readJsonSafe(cacheFile);
    if (cached && Array.isArray(cached.groups) && cached.groups.length) {
      const groups = normalizeQuotaGroups(cached.groups);
      const obs = Number.isFinite(cached.observedAt) ? cached.observedAt : null;
      return buildQuotaResult(groups, {
        status: 'cached',
        online: true,
        cached: true,
        stale: obs == null || nowMs - obs >= staleThresholdMs,
        fetchedAt: cached.fetchedAt ?? null,
        observedAt: obs,
      });
    }

    return buildQuotaResult([], { status: 'quota-unavailable', online: true, cached: false, stale: false });
  } catch {
    const cached = readJsonSafe(cacheFile);
    if (cached && Array.isArray(cached.groups) && cached.groups.length) {
      const groups = normalizeQuotaGroups(cached.groups);
      const obs = Number.isFinite(cached.observedAt) ? cached.observedAt : null;
      return buildQuotaResult(groups, {
        status: 'cached',
        online: false,
        cached: true,
        stale: obs == null || nowMs - obs >= staleThresholdMs,
        fetchedAt: cached.fetchedAt ?? null,
        observedAt: obs,
      });
    }
    return buildQuotaResult([], { status: 'query-failed', online: false, cached: false, stale: true });
  } finally {
    try { client?.close(); } catch {}
  }
}

/* ==========================================================================
 * Clean-room Hidden Subagent Non-Destructive Archiving
 * ========================================================================== */

function defaultIsLanguageServerRunning(platform = process.platform) {
  try {
    if (platform === 'win32') {
      const res = spawnSync('tasklist', ['/FO', 'CSV', '/NH'], {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 4000,
      });
      if (res.error || res.status !== 0) return true; // Fail safe: do not touch DBs if uncertain.
      return /language_server/i.test(res.stdout || '');
    }
    const res = spawnSync('ps', ['-A', '-o', 'comm='], {
      encoding: 'utf8',
      timeout: 4000,
    });
    if (res.error || res.status !== 0) return true;
    return /language_server/i.test(res.stdout || '');
  } catch {
    return true;
  }
}

function checkLanguageServerRunning(opts = {}) {
  if (typeof opts.isLanguageServerRunning === 'boolean') return opts.isLanguageServerRunning;
  if (typeof opts.isLanguageServerRunning === 'function') return Boolean(opts.isLanguageServerRunning());
  return defaultIsLanguageServerRunning(opts.platform || process.platform);
}

function defaultArchiveRoot(appDataDir, opts = {}) {
  if (opts.archiveRoot) return path.resolve(opts.archiveRoot);
  return path.join(resolveAppDataDir(appDataDir), 'plugin_data', 'antigravity-star-suite', 'subagent-archives');
}

function moveFileSafe(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  try {
    fs.renameSync(src, dst);
  } catch (err) {
    if (err && err.code === 'EXDEV') {
      fs.copyFileSync(src, dst);
      const srcStat = fs.statSync(src);
      const dstStat = fs.statSync(dst);
      if (srcStat.size !== dstStat.size) {
        try { fs.unlinkSync(dst); } catch {}
        throw new Error(`跨卷复制校验失败：${path.basename(src)}`);
      }
      fs.unlinkSync(src);
    } else {
      throw err;
    }
  }
}

function isPathInside(parentDir, candidatePath) {
  const base = path.resolve(parentDir);
  const target = path.resolve(candidatePath);
  const rel = path.relative(base, target);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Scan `conversations/` for hidden subagent SQLite databases eligible for safe archiving.
 */
function scanArchivableSubagents(appDataDir, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const convDir = path.join(dir, 'conversations');
  const archiveRoot = defaultArchiveRoot(dir, opts);
  const languageServerRunning = checkLanguageServerRunning(opts);

  if (!fs.existsSync(convDir)) {
    return {
      conversationsDir: convDir,
      archiveRoot,
      languageServerRunning,
      totalCount: 0,
      totalBytes: 0,
      items: [],
    };
  }

  let dbNames = [];
  try {
    dbNames = fs.readdirSync(convDir).filter((n) => n.endsWith('.db'));
  } catch {
    dbNames = [];
  }

  const items = [];
  let totalBytes = 0;

  for (const name of dbNames) {
    const id = name.slice(0, -3);
    if (!isValidConversationId(id)) continue;
    const entry = readTrajectoryIndexEntry(convDir, id);
    if (!entry || !entry.isSubagent) continue;

    const trioFiles = [];
    for (const suffix of ['.db', '.db-wal', '.db-shm']) {
      const fname = `${id}${suffix}`;
      const fpath = path.join(convDir, fname);
      try {
        const st = fs.statSync(fpath);
        if (st.isFile()) trioFiles.push({ name: fname, sizeBytes: st.size });
      } catch {}
    }

    const sizeBytes = trioFiles.reduce((sum, f) => sum + f.sizeBytes, 0);
    totalBytes += sizeBytes;
    items.push({
      id,
      files: trioFiles.map((f) => f.name),
      fileDetails: trioFiles,
      sizeBytes,
      mtimeMs: entry.mtimeMs,
      parentConversationId: entry.parentConversationId,
      rootConversationId: entry.rootConversationId,
      nestingDepth: entry.nestingDepth,
      stepCount: entry.stepCount,
    });
  }

  items.sort((a, b) => b.sizeBytes - a.sizeBytes || b.mtimeMs - a.mtimeMs);

  return {
    conversationsDir: convDir,
    archiveRoot,
    languageServerRunning,
    totalCount: items.length,
    totalBytes,
    items,
  };
}

function makeBatchId(nowMs = Date.now()) {
  const d = new Date(nowMs);
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const rand = crypto.randomBytes(2).toString('hex');
  return `batch-${stamp}-${rand}`;
}

/**
 * Non-destructively archive selected hidden subagent `.db/.db-wal/.db-shm` trios
 * into an isolated batch folder with a `manifest.json`.
 * Refuses immediately if `language_server` is running.
 */
function archiveSubagents(appDataDir, ids, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const convDir = path.join(dir, 'conversations');
  const archiveRoot = defaultArchiveRoot(dir, opts);

  if (checkLanguageServerRunning(opts)) {
    return {
      ok: false,
      blocked: true,
      reason: 'language_server_running',
      message: '检测到 Antigravity 语言服务（language_server）正在运行，为防止损坏 SQLite 数据库，已拒绝归档移动。请先完全退出 Antigravity 后重试。',
    };
  }

  if (!Array.isArray(ids) || ids.length === 0) {
    return { ok: false, blocked: false, reason: 'empty_ids', message: '请至少选择一个隐藏子代理会话进行归档。' };
  }

  const uniqueIds = [];
  const invalidIds = [];
  for (const rawId of ids) {
    if (!isValidConversationId(rawId)) {
      invalidIds.push(String(rawId));
    } else if (!uniqueIds.includes(rawId)) {
      uniqueIds.push(rawId);
    }
  }
  if (invalidIds.length > 0) {
    return {
      ok: false,
      blocked: false,
      reason: 'invalid_id',
      invalidIds,
      message: `包含非法会话 ID，已拒绝操作：${invalidIds.join(', ')}`,
    };
  }

  const scan = scanArchivableSubagents(dir, { ...opts, isLanguageServerRunning: false });
  const allowedMap = new Map(scan.items.map((item) => [item.id, item]));

  const targets = [];
  const skippedIds = [];
  for (const id of uniqueIds) {
    const item = allowedMap.get(id);
    if (item) targets.push(item);
    else skippedIds.push(id);
  }

  if (!targets.length) {
    return {
      ok: false,
      blocked: false,
      reason: 'no_archivable_subagents',
      skippedIds,
      message: '所选会话均非可安全归档的隐藏子代理（主会话受保护不会被移动）。',
    };
  }

  const nowMs = typeof opts.now === 'function' ? opts.now() : Date.now();
  const batchId = makeBatchId(nowMs);
  const batchDir = path.join(archiveRoot, batchId);
  const filesDir = path.join(batchDir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });

  const movedPairs = [];
  const manifestItems = [];
  let totalBytes = 0;

  try {
    for (const item of targets) {
      const movedFiles = [];
      let itemBytes = 0;
      for (const suffix of ['.db', '.db-wal', '.db-shm']) {
        const fname = `${item.id}${suffix}`;
        const src = path.join(convDir, fname);
        if (!fs.existsSync(src)) continue;
        const st = fs.statSync(src);
        if (!st.isFile()) continue;
        const dst = path.join(filesDir, fname);
        moveFileSafe(src, dst);
        movedPairs.push({ src, dst });
        movedFiles.push({
          name: fname,
          sizeBytes: st.size,
          originalRel: fname,
          archivedRel: path.posix.join('files', fname),
        });
        itemBytes += st.size;
      }
      totalBytes += itemBytes;
      manifestItems.push({
        id: item.id,
        parentConversationId: item.parentConversationId,
        rootConversationId: item.rootConversationId,
        nestingDepth: item.nestingDepth,
        sizeBytes: itemBytes,
        files: movedFiles,
      });
    }
  } catch (err) {
    // Roll back any already-moved files on unexpected filesystem error.
    for (let i = movedPairs.length - 1; i >= 0; i--) {
      try {
        moveFileSafe(movedPairs[i].dst, movedPairs[i].src);
      } catch {}
    }
    try { fs.rmSync(batchDir, { recursive: true, force: true }); } catch {}
    return {
      ok: false,
      blocked: false,
      reason: 'move_failed',
      message: `归档移动失败并已自动回滚：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const manifest = {
    version: 1,
    batchId,
    status: 'archived',
    createdAt: new Date(nowMs).toISOString(),
    createdAtMs: nowMs,
    restoredAt: null,
    sourceDir: convDir,
    totalBytes,
    items: manifestItems,
  };

  fs.writeFileSync(path.join(batchDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  clearTelemetryCaches();

  return {
    ok: true,
    batchId,
    batchDir,
    archivedCount: manifestItems.length,
    archivedIds: manifestItems.map((i) => i.id),
    skippedIds,
    totalBytes,
    manifest,
    message: `已无损归档 ${manifestItems.length} 个隐藏子代理会话至批次 ${batchId}，可随时一键还原。`,
  };
}

/**
 * List all archived subagent batches with metadata from their `manifest.json`.
 */
function listArchiveBatches(appDataDir, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const archiveRoot = defaultArchiveRoot(dir, opts);
  if (!fs.existsSync(archiveRoot)) {
    return { archiveRoot, batches: [] };
  }

  const batches = [];
  let entries = [];
  try {
    entries = fs.readdirSync(archiveRoot, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const dirent of entries) {
    if (!dirent.isDirectory() || !VALID_BATCH_ID_RE.test(dirent.name)) continue;
    const batchDir = path.join(archiveRoot, dirent.name);
    const manifestPath = path.join(batchDir, 'manifest.json');
    const manifest = readJsonSafe(manifestPath);
    if (!manifest || !Array.isArray(manifest.items)) continue;

    let remainingFiles = 0;
    for (const item of manifest.items) {
      for (const f of item.files || []) {
        const archivedFile = path.join(batchDir, 'files', path.basename(String(f.name || '')));
        if (fs.existsSync(archivedFile)) remainingFiles++;
      }
    }

    batches.push({
      batchId: manifest.batchId || dirent.name,
      status: manifest.status || (remainingFiles > 0 ? 'archived' : 'restored'),
      createdAt: manifest.createdAt || null,
      createdAtMs: Number(manifest.createdAtMs) || 0,
      restoredAt: manifest.restoredAt || null,
      itemCount: manifest.items.length,
      ids: manifest.items.map((i) => i.id),
      totalBytes: Number(manifest.totalBytes) || 0,
      remainingFiles,
      restorable: remainingFiles > 0 && manifest.status !== 'restored',
    });
  }

  batches.sort((a, b) => b.createdAtMs - a.createdAtMs || b.batchId.localeCompare(a.batchId));
  return { archiveRoot, batches };
}

/**
 * Restore all files in a previously archived subagent batch back to `conversations/`.
 * Refuses immediately if `language_server` is running or if batchId is invalid.
 */
function restoreArchiveBatch(appDataDir, batchId, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const convDir = path.join(dir, 'conversations');
  const archiveRoot = defaultArchiveRoot(dir, opts);

  if (checkLanguageServerRunning(opts)) {
    return {
      ok: false,
      blocked: true,
      reason: 'language_server_running',
      message: '检测到 Antigravity 语言服务（language_server）正在运行，为防止损坏 SQLite 数据库，已拒绝还原。请先完全退出 Antigravity 后重试。',
    };
  }

  if (typeof batchId !== 'string' || !VALID_BATCH_ID_RE.test(batchId)) {
    return { ok: false, blocked: false, reason: 'invalid_batch_id', message: '非法归档批次 ID。' };
  }

  const batchDir = path.join(archiveRoot, batchId);
  if (!isPathInside(archiveRoot, batchDir)) {
    return { ok: false, blocked: false, reason: 'invalid_batch_id', message: '归档批次路径越界，已拒绝操作。' };
  }

  const manifestPath = path.join(batchDir, 'manifest.json');
  const manifest = readJsonSafe(manifestPath);
  if (!manifest || !Array.isArray(manifest.items)) {
    return { ok: false, blocked: false, reason: 'batch_not_found', message: `未找到有效的归档批次：${batchId}` };
  }

  const plan = [];
  const conflicts = [];

  for (const item of manifest.items) {
    if (!isValidConversationId(item.id)) continue;
    for (const f of item.files || []) {
      const safeName = path.basename(String(f.name || ''));
      if (!safeName || !safeName.startsWith(`${item.id}.db`)) continue;
      const src = path.join(batchDir, 'files', safeName);
      const dst = path.join(convDir, safeName);
      if (!isPathInside(batchDir, src) || !isPathInside(convDir, dst)) continue;
      if (!fs.existsSync(src)) continue;
      if (fs.existsSync(dst) && opts.overwrite !== true) {
        conflicts.push(safeName);
      }
      plan.push({ id: item.id, name: safeName, src, dst, sizeBytes: Number(f.sizeBytes) || 0 });
    }
  }

  if (conflicts.length > 0) {
    return {
      ok: false,
      blocked: false,
      reason: 'destination_conflict',
      conflicts,
      message: `目标目录已存在同名数据库文件，未覆盖：${conflicts.join(', ')}`,
    };
  }

  if (!plan.length) {
    return {
      ok: false,
      blocked: false,
      reason: 'nothing_to_restore',
      message: `归档批次 ${batchId} 中没有可还原的文件（可能已完成还原）。`,
    };
  }

  fs.mkdirSync(convDir, { recursive: true });
  const movedPairs = [];
  try {
    for (const step of plan) {
      moveFileSafe(step.src, step.dst);
      movedPairs.push(step);
    }
  } catch (err) {
    for (let i = movedPairs.length - 1; i >= 0; i--) {
      try {
        moveFileSafe(movedPairs[i].dst, movedPairs[i].src);
      } catch {}
    }
    return {
      ok: false,
      blocked: false,
      reason: 'restore_failed',
      message: `还原失败并已自动回滚：${err instanceof Error ? err.message : String(err)}`,
    };
  }

  const restoredIds = [...new Set(movedPairs.map((p) => p.id))];
  const restoredBytes = movedPairs.reduce((sum, p) => sum + p.sizeBytes, 0);
  const nowIso = new Date(typeof opts.now === 'function' ? opts.now() : Date.now()).toISOString();
  manifest.status = 'restored';
  manifest.restoredAt = nowIso;
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  clearTelemetryCaches();

  return {
    ok: true,
    batchId,
    restoredCount: restoredIds.length,
    restoredFilesCount: movedPairs.length,
    restoredIds,
    totalBytes: restoredBytes,
    message: `已无损还原批次 ${batchId} 中的 ${restoredIds.length} 个子代理会话（${movedPairs.length} 个文件）。`,
  };
}

/* ==========================================================================
 * Clean-room GOMEMLIMIT Helper (strict whitelist, Windows HKCU\Environment)
 * ========================================================================== */

function defaultRunReg(args) {
  return spawnSync('reg.exe', args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 5000,
    shell: false,
  });
}

function parseRegQueryValue(stdout = '', valueName = 'GOMEMLIMIT') {
  const lines = String(stdout || '').split(/\r?\n/);
  const re = new RegExp(`^\\s*${valueName}\\s+REG_(?:EXPAND_)?SZ\\s+(.*)$`, 'i');
  for (const line of lines) {
    const match = line.match(re);
    if (match) return match[1].trim();
  }
  return '';
}

/**
 * Inspect current user `GOMEMLIMIT` environment setting (`HKCU\Environment` on Windows).
 */
function getGomemlimitStatus(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const processValue = typeof env.GOMEMLIMIT === 'string' ? env.GOMEMLIMIT.trim() : '';

  if (platform !== 'win32') {
    return {
      supported: false,
      platform,
      value: processValue,
      processValue,
      effectivePreset: ALLOWED_GOMEMLIMIT_SET.has(processValue) ? processValue : null,
      inWhitelist: ALLOWED_GOMEMLIMIT_SET.has(processValue),
      presets: [...ALLOWED_GOMEMLIMIT_PRESETS],
      restartRequired: false,
    };
  }

  const runReg = opts.runReg || defaultRunReg;
  const res = runReg(['query', 'HKCU\\Environment', '/v', 'GOMEMLIMIT']);
  const regValue = res && !res.error && res.status === 0
    ? parseRegQueryValue(res.stdout, 'GOMEMLIMIT')
    : '';

  return {
    supported: true,
    platform,
    value: regValue,
    processValue,
    effectivePreset: ALLOWED_GOMEMLIMIT_SET.has(regValue) ? regValue : null,
    inWhitelist: ALLOWED_GOMEMLIMIT_SET.has(regValue),
    presets: [...ALLOWED_GOMEMLIMIT_PRESETS],
    restartRequired: regValue !== processValue,
  };
}

/**
 * Write or clear `HKCU\Environment\GOMEMLIMIT` strictly validating against the whitelist:
 * `['', '2GiB', '2500MiB', '3GiB', '4GiB']`.
 */
function setGomemlimit(preset, opts = {}) {
  if (typeof preset !== 'string' || !ALLOWED_GOMEMLIMIT_SET.has(preset)) {
    return {
      ok: false,
      error: `非法 GOMEMLIMIT 预设值：${String(preset)}。仅允许白名单值：'' / '2GiB' / '2500MiB' / '3GiB' / '4GiB'`,
      allowed: [...ALLOWED_GOMEMLIMIT_PRESETS],
    };
  }

  const platform = opts.platform || process.platform;
  if (platform !== 'win32') {
    return {
      ok: false,
      supported: false,
      error: '当前仅支持在 Windows 系统中写入 HKCU\\Environment\\GOMEMLIMIT',
    };
  }

  const runReg = opts.runReg || defaultRunReg;
  if (preset === '') {
    const res = runReg(['delete', 'HKCU\\Environment', '/v', 'GOMEMLIMIT', '/f']);
    const stderr = String((res && res.stderr) || '');
    const notFound = res && res.status !== 0 && /unable to find|找不到|not found/i.test(stderr);
    if (res && !res.error && (res.status === 0 || notFound)) {
      return {
        ok: true,
        value: '',
        cleared: true,
        restartRequired: true,
        message: '已清除 HKCU\\Environment\\GOMEMLIMIT，完全重启 Antigravity 后恢复 Go 默认内存管理。',
      };
    }
    return {
      ok: false,
      error: `清除 GOMEMLIMIT 失败：${(res && res.error && res.error.message) || stderr.trim() || '注册表写入异常'}`,
    };
  }

  const res = runReg(['add', 'HKCU\\Environment', '/v', 'GOMEMLIMIT', '/t', 'REG_SZ', '/d', preset, '/f']);
  if (res && !res.error && res.status === 0) {
    return {
      ok: true,
      value: preset,
      cleared: false,
      restartRequired: true,
      message: `已设置 HKCU\\Environment\\GOMEMLIMIT=${preset}，完全重启 Antigravity 后生效。`,
    };
  }

  return {
    ok: false,
    error: `写入 GOMEMLIMIT 失败：${(res && res.error && res.error.message) || String((res && res.stderr) || '').trim() || '注册表写入异常'}`,
  };
}

/* ==========================================================================
 * Debug Port Status & Shortcut Repair (MIT)
 * ========================================================================== */

function resolveDebugPortFile(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  if (opts.portFile) return opts.portFile;
  if (env.ANTIGRAVITY_CDP_PORT_FILE) return env.ANTIGRAVITY_CDP_PORT_FILE;
  if (platform === 'win32') {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Antigravity', 'DevToolsActivePort');
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Antigravity', 'DevToolsActivePort');
  }
  return path.join(env.XDG_CONFIG_HOME || path.join(home, '.config'), 'Antigravity', 'DevToolsActivePort');
}

function defaultRunPowerShell(script, env) {
  const res = spawnSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 8000, env: env || process.env }
  );
  if (res.error || res.status !== 0) return null;
  return (res.stdout || '').trim();
}

function windowsShortcutCandidates({ home, env, sandbox, runPowerShell }) {
  const appData = sandbox ? path.join(home, 'AppData', 'Roaming') : (env.APPDATA || path.join(home, 'AppData', 'Roaming'));
  const dirs = new Set([
    path.join(home, 'Desktop'),
    path.join(appData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(appData, 'Microsoft', 'Internet Explorer', 'Quick Launch', 'User Pinned', 'TaskBar'),
  ]);
  if (!sandbox) {
    const out = runPowerShell(
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; @([Environment]::GetFolderPath("Desktop"), [Environment]::GetFolderPath("Programs")) | ConvertTo-Json -Compress',
      env
    );
    try {
      for (const folder of JSON.parse(out || '[]')) {
        if (typeof folder === 'string' && folder) dirs.add(folder);
      }
    } catch {}
  }

  const files = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isFile() && /\.lnk$/i.test(entry.name)) {
          files.add(full);
        } else if (entry.isDirectory() && /^antigravity$/i.test(entry.name)) {
          for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
            if (sub.isFile() && /\.lnk$/i.test(sub.name)) files.add(path.join(full, sub.name));
          }
        }
      }
    } catch {}
  }
  return [...files];
}

function inspectWindowsShortcuts({ home, env, sandbox, runPowerShell }) {
  const candidates = windowsShortcutCandidates({ home, env, sandbox, runPowerShell });
  if (!candidates.length) return { total: 0, configured: 0, missing: 0, items: [] };
  const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
  const script = [
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
    '$ws = New-Object -ComObject WScript.Shell',
    '$items = @()',
    'foreach ($p in $paths) {',
    '  try {',
    '    if (-not (Test-Path -LiteralPath $p)) { continue }',
    '    $s = $ws.CreateShortcut($p)',
    '    $leaf = Split-Path -Leaf $s.TargetPath',
    '    if ($leaf -match "^antigravity\\.exe$") {',
    '      $args = [string]$s.Arguments',
    '      $hasFlag = $args -match "(?:^|\\s)--remote-debugging-port(?:=\\S+|\\s+\\d+|\\b)"',
    '      $items += [PSCustomObject]@{ path = $p; hasDebugPort = [bool]$hasFlag; args = $args }',
    '    }',
    '  } catch {}',
    '}',
    'ConvertTo-Json -Compress @($items)',
  ].join('\n');
  const out = runPowerShell(script, psEnv);
  try {
    const parsed = JSON.parse(out || '[]');
    const items = (Array.isArray(parsed) ? parsed : [parsed]).filter((i) => i && i.path);
    const configured = items.filter((i) => i.hasDebugPort).length;
    return { total: items.length, configured, missing: items.length - configured, items };
  } catch {
    return { total: 0, configured: 0, missing: 0, items: [] };
  }
}

function patchDesktopEntry(content) {
  let changed = false;
  const lines = String(content || '').split(/\r?\n/).map((line) => {
    if (!/^Exec\s*=/.test(line) || HAS_DEBUG_RE.test(line)) return line;
    const eq = line.indexOf('=');
    const prefix = line.slice(0, eq + 1);
    const cmd = line.slice(eq + 1).trim();
    if (!/antigravity/i.test(cmd)) return line;
    const match = cmd.match(/^("[^"]+"|\S+)([\s\S]*)$/);
    if (!match) return line;
    changed = true;
    const rest = match[2].trim();
    return `${prefix}${match[1]} ${DEBUG_FLAG}${rest ? ` ${rest}` : ''}`;
  });
  return { content: lines.join('\n'), changed };
}

/**
 * Inspect whether Antigravity CDP debug port is active and whether shortcuts carry `--remote-debugging-port=0`.
 */
async function getDebugPortStatus(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const sandbox = typeof opts.sandbox === 'boolean' ? opts.sandbox : path.resolve(home) !== path.resolve(os.homedir());
  const portFile = resolveDebugPortFile({ platform, env, home, portFile: opts.portFile });

  let port = null;
  try {
    const firstLine = fs.readFileSync(portFile, 'utf8').split(/\r?\n/)[0];
    const parsed = Number(firstLine);
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) port = parsed;
  } catch {
    port = null;
  }

  let ready = false;
  let targetCount = 0;
  if (port !== null) {
    const listTargetsFn = opts.listTargets || listTargets;
    try {
      const targets = await listTargetsFn(port);
      if (Array.isArray(targets) && targets.length > 0) {
        ready = true;
        targetCount = targets.length;
      }
    } catch {
      ready = false;
    }
  }

  let shortcuts = { total: 0, configured: 0, missing: 0, items: [] };
  if (platform === 'win32') {
    const runPowerShell = opts.runPowerShell || defaultRunPowerShell;
    shortcuts = opts.inspectShortcuts
      ? opts.inspectShortcuts({ home, env, sandbox })
      : inspectWindowsShortcuts({ home, env, sandbox, runPowerShell });
  } else if (platform === 'linux') {
    const userDesktop = path.join(env.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'applications', 'antigravity.desktop');
    if (fs.existsSync(userDesktop)) {
      const content = fs.readFileSync(userDesktop, 'utf8');
      const hasFlag = HAS_DEBUG_RE.test(content);
      shortcuts = {
        total: 1,
        configured: hasFlag ? 1 : 0,
        missing: hasFlag ? 0 : 1,
        items: [{ path: userDesktop, hasDebugPort: hasFlag }],
      };
    }
  }

  return {
    ready,
    port,
    portFile,
    targetCount,
    shortcuts,
    platform,
    flag: DEBUG_FLAG,
  };
}

/**
 * Ensure Antigravity desktop/start-menu/taskbar shortcuts include `--remote-debugging-port=0`.
 */
function ensureDebugPortShortcuts(opts = {}) {
  const platform = opts.platform || process.platform;
  const env = opts.env || process.env;
  const home = opts.home || os.homedir();
  const sandbox = typeof opts.sandbox === 'boolean' ? opts.sandbox : path.resolve(home) !== path.resolve(os.homedir());
  const runPowerShell = opts.runPowerShell || defaultRunPowerShell;

  if (platform === 'win32') {
    const candidates = windowsShortcutCandidates({ home, env, sandbox, runPowerShell });
    if (!candidates.length) {
      return {
        ok: true,
        updated: [],
        alreadyConfigured: [],
        total: 0,
        restartRequired: false,
        message: '未找到 Antigravity 快捷方式。',
      };
    }
    const psEnv = { ...env, AGY_LNK_LIST: JSON.stringify(candidates) };
    const script = [
      '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
      '$paths = $env:AGY_LNK_LIST | ConvertFrom-Json',
      '$ws = New-Object -ComObject WScript.Shell',
      '$updated = @()',
      '$already = @()',
      'foreach ($p in $paths) {',
      '  try {',
      '    if (-not (Test-Path -LiteralPath $p)) { continue }',
      '    $s = $ws.CreateShortcut($p)',
      '    $leaf = Split-Path -Leaf $s.TargetPath',
      '    if ($leaf -match "^antigravity\\.exe$") {',
      '      $args = [string]$s.Arguments',
      '      if ($args -notmatch "(?:^|\\s)--remote-debugging-port(?:=\\S+|\\s+\\d+|\\b)") {',
      '        $s.Arguments = ($args + " --remote-debugging-port=0").Trim()',
      '        $s.Save()',
      '        $updated += $p',
      '      } else {',
      '        $already += $p',
      '      }',
      '    }',
      '  } catch {}',
      '}',
      'ConvertTo-Json -Compress @{ updated = @($updated); already = @($already) }',
    ].join('\n');
    const out = runPowerShell(script, psEnv);
    try {
      const parsed = JSON.parse(out || '{}');
      const updated = Array.isArray(parsed.updated) ? parsed.updated.filter(Boolean) : [];
      const alreadyConfigured = Array.isArray(parsed.already) ? parsed.already.filter(Boolean) : [];
      const total = updated.length + alreadyConfigured.length;
      return {
        ok: true,
        updated,
        alreadyConfigured,
        total,
        restartRequired: updated.length > 0,
        message: updated.length > 0
          ? `已修复 ${updated.length} 个快捷方式并写入 ${DEBUG_FLAG}，重启 Antigravity 后生效。`
          : (total > 0 ? `全部 ${total} 个快捷方式均已配置调试端口。` : '未找到指向 Antigravity.exe 的快捷方式。'),
      };
    } catch {
      return {
        ok: false,
        updated: [],
        alreadyConfigured: [],
        total: 0,
        restartRequired: false,
        message: '校验或更新 Windows 快捷方式失败。',
      };
    }
  }

  if (platform === 'linux') {
    const appsDir = path.join(sandbox ? path.join(home, '.local', 'share') : (env.XDG_DATA_HOME || path.join(home, '.local', 'share')), 'applications');
    const userDesktop = path.join(appsDir, 'antigravity.desktop');
    const systemDesktop = opts.systemApplicationsDir ? path.join(opts.systemApplicationsDir, 'antigravity.desktop') : (sandbox ? '' : '/usr/share/applications/antigravity.desktop');
    if (fs.existsSync(userDesktop)) {
      const content = fs.readFileSync(userDesktop, 'utf8');
      const patched = patchDesktopEntry(content);
      if (patched.changed) {
        fs.writeFileSync(userDesktop, patched.content, 'utf8');
        return { ok: true, updated: [userDesktop], alreadyConfigured: [], total: 1, restartRequired: true, message: '已修复 Linux 桌面入口文件。' };
      }
      return { ok: true, updated: [], alreadyConfigured: [userDesktop], total: 1, restartRequired: false, message: 'Linux 桌面入口已包含调试端口参数。' };
    }
    if (systemDesktop && fs.existsSync(systemDesktop)) {
      const patched = patchDesktopEntry(fs.readFileSync(systemDesktop, 'utf8'));
      if (patched.changed) {
        fs.mkdirSync(appsDir, { recursive: true });
        fs.writeFileSync(userDesktop, patched.content, 'utf8');
        return { ok: true, updated: [userDesktop], alreadyConfigured: [], total: 1, restartRequired: true, message: '已生成带调试端口的用户级桌面入口。' };
      }
    }
    return { ok: true, updated: [], alreadyConfigured: [], total: 0, restartRequired: false, message: '未找到 antigravity.desktop。' };
  }

  return {
    ok: true,
    updated: [],
    alreadyConfigured: [],
    total: 0,
    restartRequired: false,
    message: 'macOS 请使用命令行或菜单重启方式附带 --remote-debugging-port=0 启动。',
  };
}

/* ==========================================================================
 * Safe Git Diff Helper (strict validation, anti-injection, truncation-safe)
 * ========================================================================== */

function isBinaryBuffer(buf) {
  const len = Math.min(buf.length, 8192);
  let nonText = 0;
  for (let i = 0; i < len; i++) {
    const b = buf[i];
    if (b === 0) return true;
    if (b < 7 || (b > 14 && b < 32)) nonText++;
  }
  return len > 0 && nonText / len > 0.3;
}

function canonicalForCompare(p) {
  const norm = path.resolve(p);
  return process.platform === 'win32' ? norm.toLowerCase() : norm;
}

function isRealPathInside(rootDir, targetFile) {
  const rootCmp = canonicalForCompare(rootDir);
  const fileCmp = canonicalForCompare(targetFile);
  const rel = path.relative(rootCmp, fileCmp);
  return Boolean(rel && !rel.startsWith('..') && !path.isAbsolute(rel));
}

function countAndTruncateDiff(rawDiff, maxLines, maxBytes) {
  const normalized = String(rawDiff || '').replace(/\r\n/g, '\n').replace(/\n$/, '');
  if (!normalized) {
    return { diff: '', additions: 0, deletions: 0, totalLines: 0, truncated: false };
  }
  const lines = normalized.split('\n');
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) additions++;
    else if (line.startsWith('-') && !line.startsWith('---')) deletions++;
  }

  let truncated = false;
  let kept = lines;
  if (kept.length > maxLines) {
    kept = kept.slice(0, maxLines);
    truncated = true;
  }

  let text = kept.join('\n');
  if (Buffer.byteLength(text, 'utf8') > maxBytes) {
    const buf = Buffer.from(text, 'utf8').subarray(0, maxBytes);
    text = buf.toString('utf8');
    const lastNl = text.lastIndexOf('\n');
    if (lastNl > 0) text = text.slice(0, lastNl);
    truncated = true;
  }

  if (truncated) {
    text = `${text}\n... (diff 已按安全上限截断，总计 ${lines.length} 行)`;
  }

  return { diff: text, additions, deletions, totalLines: lines.length, truncated };
}

/**
 * Safely retrieve a truncated unified Git diff for a single local text file.
 * Enforces:
 * - Path existence & regular file check
 * - Binary detection (extension + content sniffing)
 * - Canonical containment inside a valid Git repository
 * - Argument-injection immunity (`--literal-pathspecs --no-optional-locks` + `--` separator + `shell: false`)
 */
function getSafeGitDiff(filePath, opts = {}) {
  const maxLines = Number.isInteger(opts.maxLines) && opts.maxLines > 0 ? opts.maxLines : 400;
  const maxBytes = Number.isInteger(opts.maxBytes) && opts.maxBytes > 0 ? opts.maxBytes : 65_536;
  const maxFileBytes = Number.isInteger(opts.maxFileBytes) && opts.maxFileBytes > 0 ? opts.maxFileBytes : 2 * 1024 * 1024;

  if (typeof filePath !== 'string') {
    return { ok: false, error: '文件路径必须是字符串' };
  }
  const trimmed = filePath.trim();
  if (!trimmed || /[\x00\r\n]/.test(trimmed)) {
    return { ok: false, error: '文件路径包含非法控制字符' };
  }
  // Reject bare git flag injection attempts like "--output=..." or "-c ..."
  if (trimmed.startsWith('-') && !fs.existsSync(trimmed)) {
    return { ok: false, error: '文件路径非法（禁止以参数前缀开头）' };
  }

  const resolved = path.resolve(trimmed);
  if (!fs.existsSync(resolved)) {
    return { ok: false, error: '目标文件不存在' };
  }

  let st;
  try {
    st = fs.statSync(resolved);
  } catch {
    return { ok: false, error: '无法读取目标文件信息' };
  }
  if (!st.isFile()) {
    return { ok: false, error: '目标路径不是常规文件' };
  }
  if (st.size > maxFileBytes) {
    return { ok: false, error: '文件体积超过 Diff 安全预览上限（2MB）' };
  }

  const ext = path.extname(resolved).toLowerCase();
  if (BINARY_EXTENSIONS.has(ext)) {
    return { ok: false, isBinary: true, error: '二进制文件不支持文本 Diff 预览' };
  }

  // Sniff file header for NUL / binary content.
  let fd;
  try {
    fd = fs.openSync(resolved, 'r');
    const probe = Buffer.allocUnsafe(Math.min(st.size, 8192));
    const n = probe.length > 0 ? fs.readSync(fd, probe, 0, probe.length, 0) : 0;
    if (n > 0 && isBinaryBuffer(probe.subarray(0, n))) {
      return { ok: false, isBinary: true, error: '检测到二进制内容，不支持文本 Diff 预览' };
    }
  } catch {
    return { ok: false, error: '读取文件内容失败' };
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }

  let realFile;
  try {
    realFile = fs.realpathSync(resolved);
  } catch {
    realFile = resolved;
  }

  const gitExec = (args, cwd) =>
    spawnSync('git', args, {
      cwd,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 6000,
      maxBuffer: 4 * 1024 * 1024,
      shell: false,
    });

  const topRes = gitExec(['--no-optional-locks', 'rev-parse', '--show-toplevel'], path.dirname(realFile));
  if (topRes.error || topRes.status !== 0 || !(topRes.stdout || '').trim()) {
    return { ok: false, inRepo: false, error: '目标文件不在合法 Git 仓库内' };
  }

  let realRepoRoot;
  try {
    realRepoRoot = fs.realpathSync(topRes.stdout.trim());
  } catch {
    realRepoRoot = path.resolve(topRes.stdout.trim());
  }

  if (!isRealPathInside(realRepoRoot, realFile)) {
    return { ok: false, inRepo: false, error: '目标文件解析路径超出 Git 仓库边界' };
  }

  const relPosix = path.relative(realRepoRoot, realFile).split(path.sep).join('/');
  const safePathspec = relPosix.startsWith('-') ? `./${relPosix}` : relPosix;

  // Try diff against HEAD first (covers both staged + unstaged edits); fallback if repo has no commits yet.
  let diffRes = gitExec(
    ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-color', '--unified=3', 'HEAD', '--', safePathspec],
    realRepoRoot
  );
  if (diffRes.status !== 0) {
    diffRes = gitExec(
      ['--no-optional-locks', '--literal-pathspecs', 'diff', '--no-ext-diff', '--no-color', '--unified=3', '--', safePathspec],
      realRepoRoot
    );
  }

  let rawDiff = diffRes.stdout || '';
  let untracked = false;

  if (!rawDiff.trim()) {
    // Check if the file is an untracked new file in the repository.
    const statusRes = gitExec(
      ['--no-optional-locks', '--literal-pathspecs', 'status', '--porcelain', '--', safePathspec],
      realRepoRoot
    );
    const statusOut = (statusRes.stdout || '').trim();
    if (statusOut.startsWith('?? ')) {
      untracked = true;
      try {
        const body = fs.readFileSync(realFile, 'utf8').replace(/\r\n/g, '\n');
        const stripped = body.endsWith('\n') ? body.slice(0, -1) : body;
        const bodyLines = stripped.length ? stripped.split('\n') : [];
        rawDiff = [
          `--- /dev/null`,
          `+++ b/${relPosix}`,
          `@@ -0,0 +1,${bodyLines.length} @@`,
          ...bodyLines.map((l) => `+${l}`),
        ].join('\n');
      } catch {
        rawDiff = '';
      }
    }
  }

  const summary = countAndTruncateDiff(rawDiff, maxLines, maxBytes);
  return {
    ok: true,
    filePath: realFile,
    repoRoot: realRepoRoot,
    relativePath: relPosix,
    inRepo: true,
    isBinary: false,
    untracked,
    hasChanges: Boolean(summary.diff),
    additions: summary.additions,
    deletions: summary.deletions,
    totalLines: summary.totalLines,
    truncated: summary.truncated,
    diff: summary.diff,
  };
}

module.exports = {
  readQuotaSnapshot,
  scanArchivableSubagents,
  archiveSubagents,
  listArchiveBatches,
  restoreArchiveBatch,
  getGomemlimitStatus,
  setGomemlimit,
  getDebugPortStatus,
  ensureDebugPortShortcuts,
  getSafeGitDiff,
  ALLOWED_GOMEMLIMIT_PRESETS,
  normalizeQuotaGroups,
};
