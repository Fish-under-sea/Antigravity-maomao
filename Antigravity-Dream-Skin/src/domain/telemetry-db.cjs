'use strict';

/**
 * Read-only local Antigravity telemetry, usage dashboard, transcript search,
 * and trajectory cache analyzer (100% MIT, zero external npm dependencies).
 *
 * Uses Node 22+ built-in `node:sqlite` (`DatabaseSync`) with graceful degradation
 * when unavailable.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fields, first, nested, string, milliseconds } = require('./protobuf.cjs');

let DatabaseSync = null;
try {
  const sqliteMod = (typeof process.getBuiltinModule === 'function' && process.getBuiltinModule('node:sqlite'))
    || require('node:sqlite');
  if (sqliteMod && typeof sqliteMod.DatabaseSync === 'function') {
    DatabaseSync = sqliteMod.DatabaseSync;
  }
} catch {
  // Older Node runtime without built-in node:sqlite: degrade gracefully without throwing.
  DatabaseSync = null;
}

const VALID_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/;
const FENCE_RE = /```[^\n]*\n([\s\S]*?)```/g;
const DAY_MS = 86400_000;

// Official API reference prices (USD per 1M tokens; output includes thinking).
const DEFAULT_RATES = [
  { model: 'gemini-4-carbon', input: 2, cache: 0.1, output: 10, until: '2026-12-01', next: { input: 4, cache: 0.2, output: 20 } },
  { model: 'gemini-4-argon', input: 2, cache: 0.1, output: 10, until: '2026-12-01', next: { input: 4, cache: 0.2, output: 20 } },
  { model: 'gemini-4-neon', input: 3, cache: 0.15, output: 15 },
  { model: 'gemini-4-hydrogen', input: 1.5, cache: 0.075, output: 7.5 },
  { model: 'gemini-3-pro', input: 2, cache: 0.1, output: 12 },
  { model: 'gemini-3-flash', input: 0.5, cache: 0.05, output: 3 },
  { model: 'gemini-2.5-pro', input: 1.25, cache: 0.31, output: 10 },
  { model: 'gemini-2.5-flash', input: 0.3, cache: 0.075, output: 2.5 },
  { model: 'claude-opus-5-5', input: 4, cache: 0.2, output: 20 },
  { model: 'claude-sonnet-5-5', input: 2, cache: 0.1, output: 10 },
  { model: 'claude-opus-4-6', input: 5, cache: 0.5, output: 25 },
  { model: 'claude-sonnet-4-6', input: 3, cache: 0.3, output: 15 },
  { model: 'claude-sonnet-4-5', input: 3, cache: 0.3, output: 15 },
  { model: 'claude-opus-4-5', input: 5, cache: 0.5, output: 25 },
  { model: 'claude-haiku-4-5', input: 1, cache: 0.1, output: 5 },
];

const dbCache = new Map();
const DB_CACHE_MAX = 32;

const fileEventsCache = new Map();
let fileEventsCacheDir = '';
let dashboardCache = null;
const DASHBOARD_RAW_TTL_MS = 60_000;

const dashboardResultCache = new Map();
const DASHBOARD_RESULT_CACHE_MAX = 32;

const trajectoryStatsCache = new Map();
const TRAJECTORY_STATS_TTL_MS = 45_000;

const metaIndexCache = new Map();
const META_INDEX_MAX = 2048;

function resolveAppDataDir(appDataDir) {
  if (typeof appDataDir === 'string' && appDataDir.trim()) return appDataDir.trim();
  return process.env.ANTIGRAVITY_APP_DATA_DIR || path.join(os.homedir(), '.gemini', 'antigravity');
}

function isValidConversationId(id) {
  return typeof id === 'string' && VALID_ID_RE.test(id);
}

function dbStamp(dbPath) {
  return [dbPath, `${dbPath}-wal`].map((p) => {
    try {
      const s = fs.statSync(p);
      return `${s.mtimeMs}:${s.size}`;
    } catch {
      return '';
    }
  }).join('|');
}

function dbTrioSize(conversationsDir, id) {
  let total = 0;
  for (const suffix of ['.db', '.db-wal', '.db-shm']) {
    try {
      const s = fs.statSync(path.join(conversationsDir, `${id}${suffix}`));
      if (s.isFile()) total += s.size;
    } catch {
      // Optional WAL/SHM files may not exist.
    }
  }
  return total;
}

function normalizeCategoryKey(label, index) {
  const low = String(label || '').trim().toLowerCase();
  if (!low) return `group-${index}`;
  if (low.includes('system')) return 'system';
  if (low.includes('mcp')) return 'mcp';
  if (low.includes('subagent')) return 'subagents';
  if (low === 'skills' || low.includes('skill')) return 'skills';
  if (low.includes('plugin')) return 'plugins';
  if (low.includes('rule')) return 'rules';
  if (low === 'tools' || low.includes('tool')) return 'tools';
  if (low.includes('message') || low.includes('chat')) return 'messages';
  if (low.includes('memory') || low.includes('artifact')) return 'memory';
  return low.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `group-${index}`;
}

function decodePackedVarints(buf) {
  const out = [];
  let val = 0;
  let shift = 0;
  for (const byte of buf) {
    val |= (byte & 0x7f) << shift;
    if (byte & 0x80) {
      shift += 7;
      if (shift > 35) break;
    } else {
      out.push(val);
      val = 0;
      shift = 0;
    }
  }
  return out;
}

/**
 * Decode Antigravity `gen_metadata.data` protobuf blob.
 */
function decodeGeneration(bytes) {
  const generation = fields(bytes);
  const chat = nested(generation, 1); // CortexStepGeneratorMetadata.chat_model
  const plannerConfig = nested(generation, 3); // CascadePlannerConfig
  const planExecute = nested(plannerConfig, 60); // PlanExecuteConfig
  const usage = nested(chat, 4); // ChatModelMetadata.usage
  const start = nested(chat, 9);
  const context = nested(start, 10); // ChatStartMetadata.context_window_metadata
  const breakdown = nested(context, 3);

  const modelEnum = first(chat, 3, 0) || null;
  const executionModelEnum = first(planExecute, 1, 0) || null;

  let requestId = '';
  for (const entryBytes of chat.get(20) || []) {
    if (typeof entryBytes === 'number') continue;
    try {
      const entry = fields(entryBytes);
      if (string(entry, 1) === 'request_id') {
        requestId = string(entry, 2);
        break;
      }
    } catch {
      // Skip malformed map entry.
    }
  }

  const retryErrors = [];
  for (const errBytes of chat.get(17) || []) {
    if (typeof errBytes === 'number') continue;
    try {
      const msg = string(fields(errBytes), 3);
      if (msg) retryErrors.push(msg);
    } catch {
      // Skip malformed retry error.
    }
  }

  const stepIndices = (generation.get(2) || []).flatMap((value) => {
    if (typeof value === 'number') return [value];
    if (Buffer.isBuffer(value) || value instanceof Uint8Array) return decodePackedVarints(value);
    return [];
  });

  const maxTokens = first(context, 4, 0);
  const parsedContext = maxTokens > 0
    ? {
        usedTokens: first(context, 1, 0),
        maxTokens,
        categories: (breakdown.get(1) || []).map((groupBytes, index) => {
          const group = fields(groupBytes);
          const label = string(group, 1);
          const children = (group.get(5) || []).map((childBytes) => {
            const child = fields(childBytes);
            return { label: string(child, 1), tokens: first(child, 3, 0) };
          });
          return {
            key: normalizeCategoryKey(label, index),
            label,
            tokens: first(group, 4, 0),
            children,
            tone: 'active',
          };
        }),
      }
    : null;

  return {
    executionId: string(generation, 4),
    error: string(generation, 5),
    stepIndices,
    modelName: string(chat, 21) || string(chat, 19),
    modelEnum,
    executionModelEnum,
    role: executionModelEnum ? (modelEnum === executionModelEnum ? 'execution' : 'planner') : '',
    providerInputTokens: usage.has(2) || usage.has(5) ? first(usage, 2, 0) + first(usage, 5, 0) : null,
    inputTokens: first(usage, 2, 0),
    cacheReadTokens: first(usage, 5, 0),
    outputTokens: first(usage, 3, 0),
    thinkingTokens: first(usage, 9, 0),
    responseTokens: first(usage, 10, 0),
    requestId,
    retries: first(chat, 14, 0),
    retryErrors,
    ttftMs: milliseconds(first(chat, 11)),
    streamingMs: milliseconds(first(chat, 12)),
    context: parsedContext,
  };
}

function estimateTextTokens(text = '') {
  if (!text) return 0;
  let cjk = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    }
  }
  const other = text.length - cjk;
  return Math.ceil(cjk * 1.15 + other / 3.8);
}

/**
 * Estimate retained tokens from a completed CHECKPOINT step payload (step_type === 23).
 */
function decodeCheckpointTokens(stepPayload) {
  if (!stepPayload || !stepPayload.length) return 0;
  try {
    const payload = fields(stepPayload);
    const cp = nested(payload, 30);
    if (!cp || !cp.size) return 0;
    const summary = string(cp, 5);
    let tokens = estimateTextTokens(summary);
    for (const reqBuf of cp.get(30) || []) {
      if (typeof reqBuf === 'number') continue;
      const reqText = string(fields(reqBuf), 1);
      tokens += estimateTextTokens(reqText);
    }
    const artifactCount = (cp.get(14) || []).length;
    tokens += Math.min(artifactCount, 200) * 35;
    return tokens > 0 ? Math.max(500, tokens) : 0;
  } catch {
    return 0;
  }
}

function decodeTrajectoryMetaBlob(bytes) {
  if (!bytes || !bytes.length) {
    return { parentConversationId: '', rootConversationId: '', nestingDepth: 0, createdAtMs: null, workspaceUri: '' };
  }
  try {
    const map = fields(bytes);
    const parentConversationId = string(map, 5);
    const rootConversationId = string(map, 6);
    const nestingDepth = Number(first(map, 17, 0)) || 0;
    const createdAtMs = milliseconds(first(map, 2));
    const workspaceUri = string(map, 7);
    return {
      parentConversationId: isValidConversationId(parentConversationId) ? parentConversationId : '',
      rootConversationId: isValidConversationId(rootConversationId) ? rootConversationId : '',
      nestingDepth,
      createdAtMs: Number.isFinite(createdAtMs) ? createdAtMs : null,
      workspaceUri,
    };
  } catch {
    return { parentConversationId: '', rootConversationId: '', nestingDepth: 0, createdAtMs: null, workspaceUri: '' };
  }
}

/**
 * Read-only SQLite parser for `~/.gemini/antigravity/conversations/<id>.db`.
 * Uses `.db` + `.db-wal` (mtimeMs + size) stamp cache to prevent redundant scans.
 */
function readDatabase(appDataDir, conversationId) {
  if (!isValidConversationId(conversationId)) return null;
  const dir = resolveAppDataDir(appDataDir);
  const dbPath = path.join(dir, 'conversations', `${conversationId}.db`);
  if (!DatabaseSync || !fs.existsSync(dbPath)) return null;

  const stamp = dbStamp(dbPath);
  const cached = dbCache.get(dbPath);
  if (cached && cached.stamp === stamp) return cached.value;

  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=1000;');

    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
    );

    const generations = [];
    if (tables.has('gen_metadata')) {
      for (const row of db.prepare('SELECT idx, data FROM gen_metadata ORDER BY idx').all()) {
        try {
          generations.push({ index: row.idx, ...decodeGeneration(row.data) });
        } catch {
          // Incomplete or corrupt generation record.
        }
      }
    }

    const times = new Map();
    const checkpointSteps = [];
    let userInputCount = 0;
    let stepCount = 0;
    let firstStepType = null;
    let latestCompletedCpIdx = -1;
    let hasPayload = false;

    if (tables.has('steps')) {
      const cols = db.prepare('PRAGMA table_info(steps)').all().map((c) => c.name);
      const hasStepType = cols.includes('step_type');
      const hasStatus = cols.includes('status');
      hasPayload = cols.includes('step_payload');
      const hasMetadata = cols.includes('metadata');
      const selectCols = ['idx'];
      if (hasStepType) selectCols.push('step_type');
      if (hasStatus) selectCols.push('status');
      if (hasMetadata) selectCols.push('metadata');

      for (const row of db.prepare(`SELECT ${selectCols.join(', ')} FROM steps ORDER BY idx`).all()) {
        stepCount++;
        if (firstStepType === null && hasStepType) firstStepType = row.step_type;
        if (hasStepType && row.step_type === 14) userInputCount++;
        if (hasStepType && row.step_type === 23) {
          checkpointSteps.push(row.idx);
          if (!hasStatus || row.status === 3) latestCompletedCpIdx = row.idx;
        }
        if (hasMetadata && row.metadata) {
          try {
            const f = fields(row.metadata);
            times.set(row.idx, {
              createdMs: milliseconds(first(f, 1)),
              viewableMs: milliseconds(first(f, 6)),
              finishedMs: milliseconds(first(f, 7)),
              completedMs: milliseconds(first(f, 8)),
              startedMs: milliseconds(first(f, 32)),
            });
          } catch {
            // Incomplete metadata blob.
          }
        }
      }
    }

    let latestCheckpoint = null;
    if (latestCompletedCpIdx >= 0) {
      let summaryTokens = 0;
      if (hasPayload) {
        try {
          const cpRow = db.prepare('SELECT step_payload FROM steps WHERE idx = ?').get(latestCompletedCpIdx);
          summaryTokens = decodeCheckpointTokens(cpRow && cpRow.step_payload);
        } catch {
          // Ignore unreadable checkpoint payload.
        }
      }
      latestCheckpoint = { stepIndex: latestCompletedCpIdx, summaryTokens };
    }

    let trajectoryMeta = { parentConversationId: '', rootConversationId: '', nestingDepth: 0, createdAtMs: null, workspaceUri: '' };
    if (tables.has('trajectory_metadata_blob')) {
      try {
        const blobRow = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
        if (blobRow && blobRow.data) trajectoryMeta = decodeTrajectoryMetaBlob(blobRow.data);
      } catch {
        // Ignore unreadable metadata blob.
      }
    }

    let parentReferenceCount = 0;
    if (tables.has('parent_references')) {
      try {
        const cntRow = db.prepare('SELECT COUNT(*) AS c FROM parent_references').get();
        parentReferenceCount = Number(cntRow && cntRow.c) || 0;
      } catch {
        // Ignore.
      }
    }

    const value = {
      generations,
      times,
      checkpointSteps,
      latestCheckpoint,
      stepCount,
      userInputCount,
      firstStepType,
      trajectoryMeta,
      parentReferenceCount,
    };

    dbCache.set(dbPath, { stamp, value });
    if (dbCache.size > DB_CACHE_MAX) {
      dbCache.delete(dbCache.keys().next().value);
    }
    return value;
  } catch {
    return null;
  } finally {
    try {
      db?.close();
    } catch {
      // Best-effort close.
    }
  }
}

/**
 * Lightweight cached subagent metadata probe for scanning all DBs quickly.
 */
function readTrajectoryIndexEntry(conversationsDir, id) {
  const dbPath = path.join(conversationsDir, `${id}.db`);
  if (!fs.existsSync(dbPath)) return null;
  const stamp = dbStamp(dbPath);
  const cached = metaIndexCache.get(dbPath);
  if (cached && cached.stamp === stamp) return cached.value;

  let parentConversationId = '';
  let rootConversationId = '';
  let nestingDepth = 0;
  let parentReferenceCount = 0;
  let stepCount = 0;
  let createdAtMs = null;

  if (DatabaseSync) {
    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=500;');
      const tables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name)
      );
      if (tables.has('trajectory_metadata_blob')) {
        const blobRow = db.prepare('SELECT data FROM trajectory_metadata_blob LIMIT 1').get();
        if (blobRow && blobRow.data) {
          const parsed = decodeTrajectoryMetaBlob(blobRow.data);
          parentConversationId = parsed.parentConversationId;
          rootConversationId = parsed.rootConversationId;
          nestingDepth = parsed.nestingDepth;
          createdAtMs = parsed.createdAtMs;
        }
      }
      if (tables.has('parent_references')) {
        const cntRow = db.prepare('SELECT COUNT(*) AS c FROM parent_references').get();
        parentReferenceCount = Number(cntRow && cntRow.c) || 0;
      }
      if (tables.has('steps')) {
        const scRow = db.prepare('SELECT COUNT(*) AS c FROM steps').get();
        stepCount = Number(scRow && scRow.c) || 0;
      }
    } catch {
      // Ignore locked/corrupt DB during light scan.
    } finally {
      try { db?.close(); } catch {}
    }
  }

  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(dbPath).mtimeMs;
  } catch {
    mtimeMs = 0;
  }

  const isSubagent = Boolean(
    (parentConversationId && parentConversationId !== id) ||
    (rootConversationId && rootConversationId !== id) ||
    nestingDepth >= 1 ||
    parentReferenceCount > 0
  );

  const value = {
    id,
    isSubagent,
    parentConversationId,
    rootConversationId,
    nestingDepth,
    parentReferenceCount,
    stepCount,
    createdAtMs,
    mtimeMs,
    sizeBytes: dbTrioSize(conversationsDir, id),
  };

  metaIndexCache.set(dbPath, { stamp, value });
  if (metaIndexCache.size > META_INDEX_MAX) {
    metaIndexCache.delete(metaIndexCache.keys().next().value);
  }
  return value;
}

/**
 * Compute context window snapshot with 9-category breakdown, largest-remainder apportionment,
 * and immediate post-compaction estimation when a completed CHECKPOINT follows the latest generation.
 */
function contextSnapshot(generation, fallbackTokens = 0, latestCheckpoint = null) {
  const metadata = generation && generation.context;
  const reportedMaxTokens = metadata && metadata.maxTokens > 0 ? metadata.maxTokens : null;
  const actual = generation && generation.providerInputTokens;
  const hasActual = Number.isFinite(actual) && actual > 0;
  const estimatedUsedTokens = metadata && metadata.usedTokens != null ? metadata.usedTokens : null;
  const baseUsedTokens = hasActual ? actual : Math.max(0, estimatedUsedTokens != null ? estimatedUsedTokens : fallbackTokens);

  const sourceCats = Array.isArray(metadata && metadata.categories) ? metadata.categories : [];
  const hasTopSkills = sourceCats.some((g) => /^skills$/i.test(String((g && g.label) || '').trim()));

  const rawGroups = sourceCats
    .flatMap((group, idx) => {
      if (!group) return [];
      const normalized = {
        ...group,
        key: group.key || normalizeCategoryKey(group.label, idx),
        tone: group.tone || 'active',
      };
      if (!hasTopSkills && normalized.label === 'System Prompt' && Array.isArray(normalized.children)) {
        const skillsChild = normalized.children.find((child) => child && child.label === 'skills' && child.tokens > 0);
        if (skillsChild) {
          return [
            { ...normalized, tokens: Math.max(0, normalized.tokens - skillsChild.tokens) },
            { key: 'skills', label: 'Skills', tokens: skillsChild.tokens, tone: 'active' },
          ];
        }
      }
      return [normalized];
    })
    .filter((group) => Number.isFinite(group.tokens) && group.tokens > 0);

  const genMaxStep = Array.isArray(generation && generation.stepIndices) && generation.stepIndices.length
    ? Math.max(...generation.stepIndices)
    : -1;
  const isPostCompact = Boolean(
    latestCheckpoint &&
    Number.isFinite(latestCheckpoint.stepIndex) &&
    latestCheckpoint.stepIndex > genMaxStep &&
    genMaxStep >= 0 &&
    baseUsedTokens > 0
  );

  let usedTokens = baseUsedTokens;
  let groups = rawGroups;
  let compactedPending = false;
  let preCompactUsedTokens = null;
  let preCompactPercent = null;

  if (isPostCompact) {
    const summaryEst = Number(latestCheckpoint.summaryTokens) > 0
      ? Number(latestCheckpoint.summaryTokens)
      : Math.min(Math.round(baseUsedTokens * 0.12), 12000);
    const nonMessages = rawGroups.filter((g) => !/^(?:chat\s+)?messages$/i.test(String(g.label || '')));
    const fixedTokens = nonMessages.length
      ? nonMessages.reduce((sum, g) => sum + Math.max(0, g.tokens), 0)
      : Math.min(Math.round(baseUsedTokens * 0.12), 18000);
    const estTotal = fixedTokens + summaryEst;
    if (estTotal < baseUsedTokens) {
      compactedPending = true;
      preCompactUsedTokens = baseUsedTokens;
      const baseMax = reportedMaxTokens != null && baseUsedTokens <= reportedMaxTokens ? reportedMaxTokens : null;
      preCompactPercent = baseMax ? Number(((baseUsedTokens / baseMax) * 100).toFixed(1)) : null;
      usedTokens = estTotal;
      groups = nonMessages.length
        ? [...nonMessages, { key: 'messages-compacted', label: 'Chat Messages', tokens: summaryEst, tone: 'active' }]
        : [];
    }
  }

  // Guard against inconsistent capacity exceeding reality.
  const maxTokens = reportedMaxTokens != null && usedTokens <= reportedMaxTokens ? reportedMaxTokens : null;
  const percent = (tokens) => (maxTokens ? Number(((tokens / maxTokens) * 100).toFixed(1)) : null);
  const total = groups.reduce((sum, group) => sum + Math.max(0, group.tokens), 0);

  // Largest-remainder apportionment preserves the exact total.
  const apportioned = groups.map((group) => (total ? (usedTokens * Math.max(0, group.tokens)) / total : 0));
  const counts = apportioned.map(Math.floor);
  const order = apportioned
    .map((value, index) => ({ index, remainder: value - counts[index] }))
    .sort((a, b) => b.remainder - a.remainder);
  if (total && order.length) {
    const remaining = usedTokens - counts.reduce((a, b) => a + b, 0);
    for (let i = 0; i < remaining; i++) {
      counts[order[i % order.length].index]++;
    }
  }

  const categories = groups.map((group, index) => {
    const tokens = total ? counts[index] : group.tokens;
    return {
      ...group,
      reportedTokens: group.tokens,
      tokens,
      estimated: true,
      percent: percent(tokens),
    };
  });

  if (!categories.length && usedTokens > 0) {
    categories.push({
      key: 'input',
      label: '输入上下文',
      tokens: usedTokens,
      estimated: !hasActual || compactedPending,
      percent: percent(usedTokens),
      tone: 'active',
    });
  }

  const freeTokens = maxTokens == null ? null : maxTokens - usedTokens;
  if (freeTokens != null) {
    categories.push({
      key: 'free',
      label: '剩余空间',
      tokens: freeTokens,
      percent: percent(freeTokens),
      tone: 'free',
    });
  }

  return {
    usedTokens,
    maxTokens,
    reportedMaxTokens,
    estimatedUsedTokens,
    usedPercent: percent(usedTokens),
    freePercent: freeTokens == null ? null : percent(freeTokens),
    categories,
    compactedPending,
    preCompactUsedTokens,
    preCompactPercent,
    source: compactedPending
      ? 'post-compact-estimate'
      : hasActual
        ? 'provider-usage'
        : metadata
          ? 'client-estimate'
          : 'transcript',
  };
}

function shortModelName(name) {
  const clean = String(name || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (!clean) return 'Unknown';
  const g4 = clean.match(/^gemini[\s-]+4[\s-]+([a-z0-9]+)/i);
  if (g4) return g4[1].charAt(0).toUpperCase() + g4[1].slice(1).toLowerCase();
  const gVer = clean.match(/^gemini[\s-]+(\d+(?:\.\d+)?)[\s-]+(pro|flash)/i);
  if (gVer) return `${gVer[1]} ${gVer[2].charAt(0).toUpperCase()}${gVer[2].slice(1).toLowerCase()}`;
  const claude = clean.match(/^claude[\s-]+(opus|sonnet|haiku)(?:[\s-]+([\d.]+))?/i);
  if (claude) {
    const fam = claude[1].charAt(0).toUpperCase() + claude[1].slice(1).toLowerCase();
    return claude[2] ? `${fam} ${claude[2]}` : fam;
  }
  return clean.replace(/-(?:high|xhigh|medium|low|trial|n)$/i, '');
}

/**
 * Track multi-model and Orchestrator (planner vs execution) contexts and compaction counts.
 */
function modelContexts(generations = [], checkpointSteps = [], postCompactSnapshot = null) {
  const valid = (generations || []).filter(
    (g) => g && g.modelName && ((Number.isFinite(g.providerInputTokens) && g.providerInputTokens > 0) || (g.context && g.context.usedTokens > 0))
  );
  const knownExecutionEnum = (valid.find((g) => g.executionModelEnum) || {}).executionModelEnum || null;
  const hasOrchestrator = Boolean(knownExecutionEnum) || valid.some(
    (g) => g.role === 'execution' || g.role === 'planner' || /orchestrator/i.test(g.modelName || '')
  );

  const map = new Map();
  let lastKey = '';

  for (const g of valid) {
    const used = Number.isFinite(g.providerInputTokens) && g.providerInputTokens > 0
      ? g.providerInputTokens
      : g.context.usedTokens;
    const rawMax = g.context && g.context.maxTokens > 0 ? g.context.maxTokens : null;
    const maxTokens = rawMax != null && used <= rawMax ? rawMax : null;
    const inferredRole = g.role || (knownExecutionEnum && g.modelEnum ? (g.modelEnum === knownExecutionEnum ? 'execution' : 'planner') : '');
    const role = hasOrchestrator ? (inferredRole || 'planner') : '';
    const shortName = shortModelName(g.modelName);
    const key = `${role}:${shortName.toLowerCase()}`;
    const prev = map.get(key);
    let compactions = prev ? prev.compactions : 0;
    if (prev && prev.usedTokens > 0 && used < prev.usedTokens * 0.72 && prev.usedTokens - used > 30000) {
      compactions++;
    }
    const resolvedMax = maxTokens != null ? maxTokens : (prev ? prev.maxTokens : null);
    const usedPercent = resolvedMax ? Number(((used / resolvedMax) * 100).toFixed(1)) : null;
    map.set(key, {
      key,
      role,
      shortName,
      fullName: g.modelName,
      usedTokens: used,
      maxTokens: resolvedMax,
      usedPercent,
      compactions,
      isCurrent: false,
    });
    lastKey = key;
  }

  const models = [...map.values()].map((entry) => {
    const isCurrent = entry.key === lastKey;
    if (isCurrent && postCompactSnapshot && postCompactSnapshot.compactedPending && postCompactSnapshot.usedTokens > 0) {
      const resolvedMax = postCompactSnapshot.maxTokens != null ? postCompactSnapshot.maxTokens : entry.maxTokens;
      return {
        ...entry,
        isCurrent,
        usedTokens: postCompactSnapshot.usedTokens,
        maxTokens: resolvedMax,
        usedPercent: resolvedMax ? Number(((postCompactSnapshot.usedTokens / resolvedMax) * 100).toFixed(1)) : entry.usedPercent,
      };
    }
    return { ...entry, isCurrent };
  });

  const detectedCompactions = models.reduce((sum, entry) => sum + entry.compactions, 0);
  const compactions = Math.max(Array.isArray(checkpointSteps) ? checkpointSteps.length : 0, detectedCompactions);
  if (models.length === 1 && compactions > models[0].compactions) {
    models[0].compactions = compactions;
  }
  return { models, hasOrchestrator, compactions };
}

function modelKey(label) {
  return String(label || '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/(claude-(?:opus|sonnet|haiku)-\d+)\.(\d+)/, '$1-$2');
}

function modelIdentity(label = '') {
  const raw = String(label || '').trim();
  const effort = raw.match(/\((low|medium|high|xhigh|extra\s+high|max|minimal|thinking)\)|[-_\s](low|medium|high|xhigh|extra\s+high|max|minimal)$/i);
  const depth = (effort && (effort[1] || effort[2]) || '').toLowerCase().replace(/^extra\s+high$/, 'xhigh');
  const orch = raw.match(/^orchestrator(?:\s*\(([^)]+)\)|\s+(.+))?$/i);
  if (orch) {
    const tail = (orch[1] || orch[2] || '')
      .replace(/\([^)]*\)/g, '')
      .replace(/\s+(low|medium|high|xhigh|extra\s+high|max|minimal|thinking)$/i, '')
      .trim()
      .toLowerCase();
    if (/claude/i.test(tail)) {
      const norm = tail.replace(/\s+/g, '-').replace(/(claude-(?:opus|sonnet|haiku)-\d+)\.(\d+)/, '$1-$2');
      return { id: `orchestrator-${norm}`, effort: depth };
    }
    const g4 = tail.match(/(?:gemini[\s-]*4[\s-]*)?(neon|carbon|argon|hydrogen)$/);
    const variant = g4 ? g4[1] : tail.replace(/\s+/g, '-');
    const id = !variant || variant === 'carbon' ? 'gemini-pro-orchestrator' : `gemini-pro-orchestrator-${variant}`;
    return { id, effort: depth };
  }
  let id = raw
    .toLowerCase()
    .replace(/\([^)]*\)/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-(low|medium|high|xhigh|extra-high|max|minimal)$/, '');
  id = id.replace(/(claude-(?:opus|sonnet|haiku)-\d+)\.(\d+)/, '$1-$2');
  return { id: id || 'unknown', effort: depth };
}

function pricingKey(request) {
  const raw = String((request && request.model) || '').trim();
  if (/orchestrator/i.test(raw)) {
    if (request && request.role === 'execution' && /^orchestrator\b/i.test(raw)) return 'gemini-4-hydrogen';
    const claude = raw.match(/claude[\s-]*(opus|sonnet|haiku)[\s-]*(\d+)[.-](\d+)/i);
    if (claude) return `claude-${claude[1].toLowerCase()}-${claude[2]}-${claude[3]}`;
    const gFlash = raw.match(/gemini[\s-]*(\d+(?:\.\d+)?)[\s-]*flash/i);
    if (gFlash) return `gemini-${gFlash[1]}-flash`;
    if (/hydrogen/i.test(raw)) return 'gemini-4-hydrogen';
    if (/neon/i.test(raw)) return 'gemini-4-neon';
    if (/argon/i.test(raw)) return 'gemini-4-argon';
    if (/carbon/i.test(raw)) return 'gemini-4-carbon';
    if (request && request.role === 'execution') return 'gemini-4-hydrogen';
    return 'gemini-4-carbon';
  }
  return modelKey(raw);
}

function resolveRate(rate, { pricingMode = 'promo', date } = {}) {
  if (!rate) return null;
  const day = date || new Date().toISOString().slice(0, 10);
  const hasScheduled = Boolean(rate.until && rate.next);
  const standard = hasScheduled ? rate.next : rate;
  const active = pricingMode === 'standard' ? standard : (hasScheduled && day >= rate.until ? rate.next : rate);
  return { active, standard };
}

function estimateCost(request, rates = DEFAULT_RATES, options = {}) {
  if (!request) return null;
  const key = pricingKey(request);
  const rate = rates.find((r) => key === r.model || key.startsWith(`${r.model}-`));
  if (!rate) return null;
  const date = Number.isFinite(request.timestampMs)
    ? new Date(request.timestampMs).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);
  const pricingMode = options.pricingMode === 'standard' ? 'standard' : 'promo';
  const resolved = resolveRate(rate, { pricingMode, date });
  const active = resolved && resolved.active;
  if (!active) return null;
  const input = Number(request.inputTokens) || 0;
  const cache = Number(request.cacheReadTokens) || 0;
  const output = Number(request.outputTokens) || 0;
  return (input * active.input + cache * active.cache + output * active.output) / 1e6;
}

/**
 * Convert parsed database generations into structured request events.
 * Uses pure streaming duration for TPS when `streamingMs >= 500 && outputTokens >= 20`,
 * falling back to whole-request duration (`ttftMs + streamingMs`) for short/buffered responses.
 */
function requestEvents(database, conversationId) {
  const generations = ((database && database.generations) || []).filter(
    (g) => g && (g.modelName || g.error || g.outputTokens)
  );
  const knownExecutionEnum = (generations.find((g) => g.executionModelEnum) || {}).executionModelEnum || null;
  const timesMap = (database && database.times instanceof Map) ? database.times : new Map();

  return generations.map((g, idx) => {
    const indices = Array.isArray(g.stepIndices) ? g.stepIndices : [];
    const stepTimes = indices.map((index) => timesMap.get(index)).filter(Boolean);
    const created = stepTimes.map((t) => t.createdMs).filter(Number.isFinite);
    const finished = stepTimes
      .map((t) => (Number.isFinite(t.finishedMs) ? t.finishedMs : t.completedMs))
      .filter(Number.isFinite);
    const timestampMs = created.length ? Math.min(...created) : null;
    const stepDurationMs = created.length && finished.length
      ? Math.max(0, Math.max(...finished) - Math.min(...created))
      : null;
    const role = g.role || (knownExecutionEnum && g.modelEnum ? (g.modelEnum === knownExecutionEnum ? 'execution' : 'planner') : '');
    const inputTokens = Number(g.inputTokens) || 0;
    const cacheReadTokens = Number(g.cacheReadTokens) || 0;
    const outputTokens = Number(g.outputTokens) || 0;
    const thinkingTokens = Number(g.thinkingTokens) || 0;
    const responseTokens = Number(g.responseTokens) || 0;
    const ttftMs = Number.isFinite(g.ttftMs) ? g.ttftMs : null;
    const streamingMs = Number.isFinite(g.streamingMs) ? g.streamingMs : null;
    const durationMs = ttftMs != null && streamingMs != null ? ttftMs + streamingMs : null;

    const isStreamed = Boolean(streamingMs != null && streamingMs >= 500 && outputTokens >= 20);
    const tpsDurationMs = isStreamed ? streamingMs : durationMs;
    const tps = tpsDurationMs != null && tpsDurationMs > 0
      ? Number(((outputTokens * 1000) / tpsDurationMs).toFixed(1))
      : null;
    const wholeTps = durationMs != null && durationMs > 0
      ? Number(((outputTokens * 1000) / durationMs).toFixed(1))
      : null;

    const totalIn = inputTokens + cacheReadTokens;
    const cacheHitPercent = totalIn > 0 ? Number(((cacheReadTokens / totalIn) * 100).toFixed(1)) : null;

    const event = {
      id: g.requestId || `${g.executionId || conversationId}:${g.index != null ? g.index : idx}:${timestampMs}:${g.modelName}`,
      requestId: g.requestId || '',
      conversationId,
      timestampMs,
      model: g.modelName || '',
      role,
      inputTokens,
      cacheReadTokens,
      outputTokens,
      cacheHitPercent,
      thinkingTokens,
      responseTokens,
      ttftMs,
      streamingMs,
      durationMs,
      stepDurationMs,
      tpsDurationMs,
      tps,
      wholeTps,
      tpsMode: tps == null ? null : (isStreamed ? 'stream' : 'whole'),
      error: g.error || '',
      status: g.error ? 'error' : outputTokens > 0 ? 'success' : 'recorded',
      retries: Number(g.retries) || 0,
      retryErrors: Array.isArray(g.retryErrors) ? g.retryErrors : [],
    };
    event.costUsd = estimateCost(event);
    return event;
  });
}

function readTranscriptSteps(appDataDir, conversationId) {
  if (!isValidConversationId(conversationId)) return [];
  const filePath = path.join(appDataDir, 'brain', conversationId, '.system_generated', 'logs', 'transcript.jsonl');
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const out = [];
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // Ignore partial line while writer flushes.
      }
    }
    return out;
  } catch {
    return [];
  }
}

function resolveDefaultConversationId(appDataDir) {
  const convDir = path.join(appDataDir, 'conversations');
  const candidates = [];
  if (fs.existsSync(convDir)) {
    try {
      for (const name of fs.readdirSync(convDir)) {
        if (!name.endsWith('.db')) continue;
        const id = name.slice(0, -3);
        if (!isValidConversationId(id)) continue;
        try {
          const st = fs.statSync(path.join(convDir, name));
          if (st.isFile()) candidates.push({ id, mtimeMs: st.mtimeMs });
        } catch {}
      }
    } catch {}
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  // Prefer most recent root conversation (non-subagent).
  for (const cand of candidates.slice(0, 24)) {
    const entry = readTrajectoryIndexEntry(convDir, cand.id);
    if (entry && !entry.isSubagent) return cand.id;
  }
  if (candidates.length) return candidates[0].id;

  const brainDir = path.join(appDataDir, 'brain');
  if (fs.existsSync(brainDir)) {
    const brainEntries = [];
    try {
      for (const dirent of fs.readdirSync(brainDir, { withFileTypes: true })) {
        if (!dirent.isDirectory() || !isValidConversationId(dirent.name)) continue;
        const tp = path.join(brainDir, dirent.name, '.system_generated', 'logs', 'transcript.jsonl');
        try {
          const st = fs.statSync(tp);
          if (st.isFile()) brainEntries.push({ id: dirent.name, mtimeMs: st.mtimeMs });
        } catch {}
      }
    } catch {}
    brainEntries.sort((a, b) => b.mtimeMs - a.mtimeMs);
    if (brainEntries.length) return brainEntries[0].id;
  }
  return '';
}

function summarizeSingleSession(dir, conversationId, database, steps) {
  const requests = database ? requestEvents(database, conversationId) : [];

  let transcriptTurns = 0;
  let transcriptModel = '';
  let transcriptInput = 0;
  let transcriptCache = 0;
  let transcriptOutput = 0;
  let latestInput = 0;
  let latestCache = 0;

  for (const step of steps) {
    if (!step || typeof step !== 'object') continue;
    if (step.type === 'USER_INPUT') {
      const content = typeof step.content === 'string' ? step.content : '';
      if (/^Error: The stream was interrupted/i.test(content)) continue;
      const sel = content.match(/changed setting `Model Selection` from .*? to ([^\n]+?)\./);
      if (sel) transcriptModel = sel[1].trim();
      transcriptTurns++;
    } else if (step.type === 'PLANNER_RESPONSE') {
      const inp = Number(step.input_tokens) > 0 ? Number(step.input_tokens) : 0;
      const cac = Number(step.cache_read_tokens) > 0 ? Number(step.cache_read_tokens) : 0;
      const out = Number(step.output_tokens) > 0 ? Number(step.output_tokens) : 0;
      transcriptInput += inp;
      transcriptCache += cac;
      transcriptOutput += out;
      if (inp + cac + out > 0) {
        latestInput = inp;
        latestCache = cac;
      }
    }
  }

  let inputTokens = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let costSum = 0;
  let pricedCount = 0;

  for (const r of requests) {
    inputTokens += r.inputTokens;
    cacheReadTokens += r.cacheReadTokens;
    outputTokens += r.outputTokens;
    if (typeof r.costUsd === 'number' && Number.isFinite(r.costUsd)) {
      costSum += r.costUsd;
      pricedCount++;
    }
  }

  if (inputTokens + cacheReadTokens + outputTokens === 0 && transcriptInput + transcriptCache + transcriptOutput > 0) {
    inputTokens = transcriptInput;
    cacheReadTokens = transcriptCache;
    outputTokens = transcriptOutput;
  }

  const totalInput = inputTokens + cacheReadTokens;
  const totalTokens = totalInput + outputTokens;
  const cacheHitPercent = totalInput > 0 ? Number(((cacheReadTokens / totalInput) * 100).toFixed(1)) : null;

  const validGens = ((database && database.generations) || []).filter(
    (g) => g && (g.context || g.providerInputTokens > 0)
  );
  const latestGen = validGens.length ? validGens[validGens.length - 1] : null;
  const latestAnyGen = database && database.generations && database.generations.length
    ? database.generations[database.generations.length - 1]
    : null;

  const model = (latestGen && latestGen.modelName)
    || (latestAnyGen && latestAnyGen.modelName)
    || transcriptModel
    || '';
  const role = (requests.length ? requests[requests.length - 1].role : '')
    || (latestGen && latestGen.role)
    || '';

  const speeds = requests.map((r) => r.tps).filter(Number.isFinite);
  const completeReqs = requests.filter((r) => r.tps != null && r.outputTokens > 0);
  const totalTpsDuration = completeReqs.reduce((sum, r) => sum + (r.tpsDurationMs > 0 ? r.tpsDurationMs : (r.durationMs || 0)), 0);
  const tps = totalTpsDuration > 0
    ? Number(((completeReqs.reduce((sum, r) => sum + r.outputTokens, 0) * 1000) / totalTpsDuration).toFixed(1))
    : null;
  const latestTps = speeds.length ? speeds[speeds.length - 1] : null;

  const ttfts = requests.map((r) => r.ttftMs).filter((v) => Number.isFinite(v) && v >= 0);
  const ttftSeconds = ttfts.length
    ? Number(((ttfts.reduce((a, b) => a + b, 0) / ttfts.length) / 1000).toFixed(2))
    : null;

  const rounds = transcriptTurns > 0
    ? transcriptTurns
    : ((database && database.userInputCount > 0) ? database.userInputCount : requests.length);

  const ctxSnap = contextSnapshot(latestGen, latestInput + latestCache, (database && database.latestCheckpoint) || null);
  const multiModel = modelContexts(
    (database && database.generations) || [],
    (database && database.checkpointSteps) || [],
    ctxSnap
  );

  const costUsd = pricedCount > 0
    ? Number(costSum.toFixed(6))
    : (requests.length === 0 ? 0 : null);

  return {
    conversationId,
    model,
    role,
    tps,
    latestTps,
    ttftSeconds,
    rounds,
    totalTokens,
    inputTokens,
    cacheReadTokens,
    outputTokens,
    cacheHitPercent,
    costUsd,
    context: {
      usedTokens: ctxSnap.usedTokens,
      maxTokens: ctxSnap.maxTokens,
      usedPercent: ctxSnap.usedPercent,
      categories: ctxSnap.categories,
      compactions: multiModel.compactions,
      compactedPending: ctxSnap.compactedPending,
      preCompactPercent: ctxSnap.preCompactPercent,
      models: multiModel.models,
      hasOrchestrator: multiModel.hasOrchestrator,
    },
  };
}

/**
 * Compute trajectory cache statistics for `conversations/`.
 * Cached per directory for 45s (`opts.force = true` bypasses cache) to avoid blocking
 * the event loop with repeated synchronous `statSync` sweeps over hundreds of `.db` files.
 */
function getTrajectoryCacheStats(appDataDir, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const nowMs = Date.now();
  if (!opts.force) {
    const cached = trajectoryStatsCache.get(dir);
    if (cached && nowMs - cached.at < TRAJECTORY_STATS_TTL_MS) {
      return cached.value;
    }
  }
  const convDir = path.join(dir, 'conversations');
  if (!fs.existsSync(convDir)) {
    const empty = {
      totalBytes: 0,
      conversationCount: 0,
      subagentCount: 0,
      subagentBytes: 0,
      fileCount: 0,
      conversationsDir: convDir,
      items: [],
    };
    trajectoryStatsCache.set(dir, { at: nowMs, value: empty });
    if (trajectoryStatsCache.size > 16) trajectoryStatsCache.delete(trajectoryStatsCache.keys().next().value);
    return empty;
  }

  const dbIds = new Set();
  let totalBytes = 0;
  let fileCount = 0;

  let names = [];
  try {
    names = fs.readdirSync(convDir);
  } catch {
    names = [];
  }

  for (const name of names) {
    if (!/\.(?:db|db-wal|db-shm)$/.test(name)) continue;
    const full = path.join(convDir, name);
    try {
      const st = fs.statSync(full);
      if (!st.isFile()) continue;
      totalBytes += st.size;
      fileCount++;
      if (name.endsWith('.db')) {
        const id = name.slice(0, -3);
        if (isValidConversationId(id)) dbIds.add(id);
      }
    } catch {
      // Ignore transient files.
    }
  }

  let subagentCount = 0;
  let subagentBytes = 0;
  const items = [];

  for (const id of dbIds) {
    const entry = readTrajectoryIndexEntry(convDir, id);
    if (!entry) continue;
    if (entry.isSubagent) {
      subagentCount++;
      subagentBytes += entry.sizeBytes;
    }
    items.push({
      conversationId: id,
      bytes: entry.sizeBytes,
      isSubagent: entry.isSubagent,
      parentConversationId: entry.parentConversationId,
      rootConversationId: entry.rootConversationId,
      nestingDepth: entry.nestingDepth,
      mtimeMs: entry.mtimeMs,
    });
  }

  items.sort((a, b) => b.bytes - a.bytes);

  const result = {
    totalBytes,
    conversationCount: dbIds.size,
    subagentCount,
    subagentBytes,
    fileCount,
    conversationsDir: convDir,
    items,
  };
  trajectoryStatsCache.set(dir, { at: nowMs, value: result });
  if (trajectoryStatsCache.size > 16) trajectoryStatsCache.delete(trajectoryStatsCache.keys().next().value);
  return result;
}

/**
 * Gather full telemetry for a conversation, including context breakdown, streaming TPS,
 * child subagents, and local trajectory cache size.
 */
function getConversationTelemetry(appDataDir, conversationId, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const strict = Boolean(opts && opts.strict);
  const resolvedId = conversationId
    ? (isValidConversationId(conversationId) ? conversationId : '')
    : (strict ? '' : resolveDefaultConversationId(dir));
  const cacheStats = getTrajectoryCacheStats(dir);

  if (!resolvedId) {
    return {
      conversationId: '',
      model: '',
      role: '',
      tps: null,
      latestTps: null,
      ttftSeconds: null,
      rounds: 0,
      totalTokens: 0,
      inputTokens: 0,
      cacheReadTokens: 0,
      outputTokens: 0,
      cacheHitPercent: null,
      costUsd: 0,
      context: {
        usedTokens: 0,
        maxTokens: null,
        usedPercent: null,
        categories: [],
        compactions: 0,
        compactedPending: false,
        preCompactPercent: null,
        models: [],
        hasOrchestrator: false,
      },
      subagents: [],
      cacheSizeBytes: cacheStats.totalBytes,
    };
  }

  const database = readDatabase(dir, resolvedId);
  const steps = readTranscriptSteps(dir, resolvedId);
  const summary = summarizeSingleSession(dir, resolvedId, database, steps);

  // Discover subagents linked to this conversation via cached trajectory index.
  const subagents = [];
  const relatedSubItems = cacheStats.items.filter(
    (item) =>
      item.isSubagent &&
      item.conversationId !== resolvedId &&
      (item.parentConversationId === resolvedId || item.rootConversationId === resolvedId)
  );

  for (const subItem of relatedSubItems.slice(0, 64)) {
    const subDb = readDatabase(dir, subItem.conversationId);
    const subSteps = readTranscriptSteps(dir, subItem.conversationId);
    const subSummary = summarizeSingleSession(dir, subItem.conversationId, subDb, subSteps);
    subagents.push({
      conversationId: subItem.conversationId,
      model: subSummary.model,
      shortModel: shortModelName(subSummary.model),
      role: subSummary.role,
      rounds: subSummary.rounds,
      totalTokens: subSummary.totalTokens,
      inputTokens: subSummary.inputTokens,
      cacheReadTokens: subSummary.cacheReadTokens,
      outputTokens: subSummary.outputTokens,
      cacheHitPercent: subSummary.cacheHitPercent,
      costUsd: subSummary.costUsd,
      tps: subSummary.tps,
      usedTokens: subSummary.context.usedTokens,
      maxTokens: subSummary.context.maxTokens,
      usedPercent: subSummary.context.usedPercent,
      nestingDepth: subItem.nestingDepth,
      sizeBytes: subItem.bytes,
    });
  }

  return {
    ...summary,
    subagents,
    cacheSizeBytes: cacheStats.totalBytes,
  };
}

function dateRange(preset = 'all', now = Date.now(), custom = {}) {
  const end = Number.isFinite(now) ? now : Date.now();
  const startDate = new Date(end);
  startDate.setHours(0, 0, 0, 0);

  if (preset === 'today') return { start: +startDate, end: end + 1 };
  if (preset === '24h') return { start: end - DAY_MS, end: end + 1 };
  if (preset === 'yesterday') {
    const until = +startDate;
    startDate.setDate(startDate.getDate() - 1);
    return { start: +startDate, end: until };
  }
  if (preset === 'week') {
    startDate.setDate(startDate.getDate() - ((startDate.getDay() + 6) % 7));
    return { start: +startDate, end: end + 1 };
  }
  if (preset === 'month') {
    startDate.setDate(1);
    return { start: +startDate, end: end + 1 };
  }
  if (preset === '30d') {
    startDate.setDate(startDate.getDate() - 29);
    return { start: +startDate, end: end + 1 };
  }
  if (preset === 'custom' && custom && custom.start && custom.end) {
    const a = Date.parse(`${custom.start}T00:00:00`);
    const bDate = new Date(`${custom.end}T00:00:00`);
    bDate.setDate(bDate.getDate() + 1);
    if (!Number.isFinite(a) || !Number.isFinite(+bDate)) return { start: end - DAY_MS, end: end + 1 };
    if (a < +bDate) return { start: a, end: +bDate };
    const until = new Date(a);
    until.setDate(until.getDate() + 1);
    return { start: +new Date(`${custom.end}T00:00:00`), end: +until };
  }
  return { start: -Infinity, end: Infinity };
}

/**
 * Detect short-interval cache wipeout / cliff drop / consecutive cache misses while
 * avoiding false positives on cold starts, large pastes (dilution), compactions,
 * non-caching models, and TTL expirations (> maxGapMs).
 */
function annotateCacheAnomalies(
  requests = [],
  {
    maxGapMs = 180_000,
    minPrevCache = 4000,
    minPrevHit = 50,
    minCurInput = 4000,
    minMissedInput = 16000,
    minKeepRatio = 0.6,
  } = {}
) {
  const anomalies = new Map();
  if (!Array.isArray(requests) || !requests.length) return anomalies;

  const ordered = requests
    .filter((r) => r && r.conversationId && Number.isFinite(r.timestampMs) && r.status !== 'error')
    .slice()
    .sort((a, b) => a.timestampMs - b.timestampMs || String(a.id || '').localeCompare(String(b.id || '')));

  const cachedModels = new Set();
  for (const r of ordered) {
    if ((r.cacheReadTokens || 0) > 0) cachedModels.add(modelIdentity(r.model).id);
  }

  const lastByKey = new Map();
  for (const r of ordered) {
    const modelId = modelIdentity(r.model).id;
    const key = `${r.conversationId}::${modelId}`;
    const curIn = r.inputTokens || 0;
    const curCache = r.cacheReadTokens || 0;
    const curTotalIn = curIn + curCache;
    const curHit = curTotalIn > 0 ? Number(((curCache / curTotalIn) * 100).toFixed(1)) : null;
    const prev = lastByKey.get(key);
    let anomalous = false;

    if (prev && curHit != null && curTotalIn >= minCurInput && curTotalIn >= prev.totalIn * minKeepRatio) {
      const gapMs = r.timestampMs - prev.timestampMs;
      if (gapMs >= 0 && gapMs <= maxGapMs) {
        if (prev.cache >= minPrevCache && prev.hit >= minPrevHit) {
          if (curCache === 0) {
            anomalies.set(r.id, {
              kind: 'cleared',
              gapMs,
              prevHit: prev.hit,
              curHit: 0,
              prevCache: prev.cache,
              curCache: 0,
              prevTotalIn: prev.totalIn,
            });
            anomalous = true;
          } else if (prev.hit - curHit >= 40 && curHit < 20 && curCache < prev.cache * 0.5) {
            anomalies.set(r.id, {
              kind: 'dropped',
              gapMs,
              prevHit: prev.hit,
              curHit,
              prevCache: prev.cache,
              curCache,
              prevTotalIn: prev.totalIn,
            });
            anomalous = true;
          }
        } else if (curCache === 0 && cachedModels.has(modelId) && (prev.anomalous || prev.totalIn >= minMissedInput)) {
          anomalies.set(r.id, {
            kind: 'missed',
            gapMs,
            prevHit: prev.hit,
            curHit: 0,
            prevCache: prev.cache,
            curCache: 0,
            prevTotalIn: prev.totalIn,
          });
          anomalous = true;
        }
      }
    }

    if (curTotalIn >= 2000 && curHit != null) {
      lastByKey.set(key, {
        timestampMs: r.timestampMs,
        cache: curCache,
        hit: curHit,
        totalIn: curTotalIn,
        anomalous,
      });
    }
  }

  return anomalies;
}

function formatLocalDateKey(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function collectAllRequests(dir, { force = false } = {}) {
  if (!force && dashboardCache && dashboardCache.dir === dir && Date.now() - dashboardCache.at < DASHBOARD_RAW_TTL_MS) {
    return dashboardCache;
  }
  if (fileEventsCacheDir !== dir) {
    fileEventsCache.clear();
    fileEventsCacheDir = dir;
  }

  const convDir = path.join(dir, 'conversations');
  let files = [];
  try {
    files = fs.readdirSync(convDir).filter((name) => /^[\w-]+\.db$/.test(name));
  } catch {
    files = [];
  }

  const activeFiles = new Set(files);
  for (const cachedFile of fileEventsCache.keys()) {
    if (!activeFiles.has(cachedFile)) fileEventsCache.delete(cachedFile);
  }

  const unique = new Map();
  for (const file of files) {
    const id = file.slice(0, -3);
    const stamp = dbStamp(path.join(convDir, file));
    let cached = fileEventsCache.get(file);
    if (!cached || cached.stamp !== stamp) {
      const db = readDatabase(dir, id);
      cached = { stamp, events: requestEvents(db, id) };
      fileEventsCache.set(file, cached);
    }
    for (const event of cached.events) {
      if (!unique.has(event.id)) unique.set(event.id, event);
    }
  }

  const requests = [...unique.values()].sort((a, b) => (b.timestampMs || 0) - (a.timestampMs || 0));
  dashboardCache = { dir, at: Date.now(), requests };
  dashboardResultCache.clear();
  return dashboardCache;
}

/**
 * Aggregate multi-conversation usage dashboard with range filtering (today / week / 30d / all / custom),
 * daily heatmap buckets, per-model breakdown, recentCalls log, errors, and optional cache anomalies.
 *
 * Performance options:
 * - `opts.includeRequests` (default `true`): pass `false` to omit the full `requests` array (avoids multi-MB JSON).
 * - `opts.includeAnomalies` (default `true`): pass `false` to skip full-history `annotateCacheAnomalies` scan.
 */
function getUsageDashboard(appDataDir, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const preset = opts.range || opts.preset || 'all';
  const hasExplicitNow = Number.isFinite(opts.now);
  const now = hasExplicitNow ? opts.now : Date.now();
  const pricingMode = opts.pricingMode === 'standard' ? 'standard' : 'promo';
  const includeRequests = opts.includeRequests !== false;
  const includeAnomalies = opts.includeAnomalies !== false;
  const recentCallsLimit = Number.isInteger(opts.recentCallsLimit) && opts.recentCallsLimit > 0
    ? opts.recentCallsLimit
    : 150;

  const rawEntry = collectAllRequests(dir, { force: opts.force === true });
  const hasCustomAnomalyOpts = Boolean(opts.anomalyOptions && Object.keys(opts.anomalyOptions).length > 0);
  const resultCacheKey = !hasCustomAnomalyOpts
    ? `${dir}|${preset}|${opts.start || ''}|${opts.end || ''}|${pricingMode}|${includeRequests ? 1 : 0}|${includeAnomalies ? 1 : 0}|${recentCallsLimit}|${hasExplicitNow ? now : ''}`
    : '';

  if (resultCacheKey && !opts.force) {
    const cachedResult = dashboardResultCache.get(resultCacheKey);
    if (cachedResult && cachedResult.sourceAt === rawEntry.at) {
      return cachedResult.value;
    }
  }

  const allRaw = rawEntry.requests;
  const range = dateRange(preset, now, { start: opts.start, end: opts.end });

  // Compute anomalies over full history ONLY when explicitly requested.
  const anomalyMap = includeAnomalies ? annotateCacheAnomalies(allRaw, opts.anomalyOptions || {}) : null;

  const selected = preset === 'all'
    ? allRaw
    : allRaw.filter((r) => Number.isFinite(r.timestampMs) && r.timestampMs >= range.start && r.timestampMs < range.end);

  const daysMap = new Map();
  const modelsMap = new Map();
  let totalInput = 0;
  let totalCache = 0;
  let totalOutput = 0;
  let costSum = 0;
  let pricedCount = 0;

  const enrichedRequests = includeRequests ? [] : null;
  const cacheAnomalies = [];
  const errors = [];

  for (const r of selected) {
    const rCostUsd = pricingMode === 'promo'
      ? (r.costUsd !== undefined ? r.costUsd : estimateCost(r, DEFAULT_RATES, { pricingMode }))
      : estimateCost(r, DEFAULT_RATES, { pricingMode });
    const anomaly = anomalyMap ? (anomalyMap.get(r.id) || null) : null;

    if (includeRequests) {
      enrichedRequests.push({ ...r, costUsd: rCostUsd, cacheAnomaly: anomaly });
    }

    if (anomaly) {
      cacheAnomalies.push({
        requestId: r.id,
        conversationId: r.conversationId,
        model: r.model,
        timestampMs: r.timestampMs,
        ...anomaly,
      });
    }

    if (r.error) {
      errors.push(includeRequests ? enrichedRequests[enrichedRequests.length - 1] : { ...r, costUsd: rCostUsd, cacheAnomaly: anomaly });
    }
    if (r.retryErrors && r.retryErrors.length) {
      for (let index = 0; index < r.retryErrors.length; index++) {
        const err = r.retryErrors[index];
        if (err && String(err).trim() && err !== r.error) {
          errors.push({ ...r, costUsd: rCostUsd, cacheAnomaly: anomaly, id: `${r.id}:retry:${index}`, status: 'error', error: err });
        }
      }
    }

    const inTok = r.inputTokens || 0;
    const cacheTok = r.cacheReadTokens || 0;
    const outTok = r.outputTokens || 0;
    const tokTotal = inTok + cacheTok + outTok;

    totalInput += inTok;
    totalCache += cacheTok;
    totalOutput += outTok;
    if (typeof rCostUsd === 'number' && Number.isFinite(rCostUsd)) {
      costSum += rCostUsd;
      pricedCount++;
    }

    if (Number.isFinite(r.timestampMs)) {
      const dateKey = formatLocalDateKey(r.timestampMs);
      let day = daysMap.get(dateKey);
      if (!day) {
        day = { date: dateKey, requests: 0, tokens: 0 };
        daysMap.set(dateKey, day);
      }
      day.requests++;
      day.tokens += tokTotal;
    }

    const { id: modelId } = modelIdentity(r.model);
    let m = modelsMap.get(modelId);
    if (!m) {
      m = {
        id: modelId,
        name: r.model || modelId,
        requests: 0,
        success: 0,
        errors: 0,
        tokens: 0,
        inputTokens: 0,
        cacheReadTokens: 0,
        outputTokens: 0,
        costSum: 0,
        priced: 0,
        speedOutput: 0,
        speedDuration: 0,
        peakTps: null,
      };
      modelsMap.set(modelId, m);
    }
    m.requests++;
    m.tokens += tokTotal;
    m.inputTokens += inTok;
    m.cacheReadTokens += cacheTok;
    m.outputTokens += outTok;
    if (r.status === 'success') m.success++;
    if (r.status === 'error') m.errors++;
    if (typeof rCostUsd === 'number' && Number.isFinite(rCostUsd)) {
      m.costSum += rCostUsd;
      m.priced++;
    }
    const speedDur = r.tpsDurationMs > 0 ? r.tpsDurationMs : r.durationMs;
    if (speedDur > 0 && outTok > 0) {
      m.speedOutput += outTok;
      m.speedDuration += speedDur;
      const curTps = r.tps != null ? r.tps : (outTok * 1000) / speedDur;
      m.peakTps = m.peakTps == null ? curTps : Math.max(m.peakTps, curTps);
    }
  }

  const totalIn = totalInput + totalCache;
  const totalTokens = totalIn + totalOutput;
  const cacheHitPercent = totalIn > 0 ? Number(((totalCache / totalIn) * 100).toFixed(1)) : null;
  const costUsd = pricedCount > 0 ? Number(costSum.toFixed(6)) : (selected.length === 0 ? 0 : null);

  const days = [...daysMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  const models = [...modelsMap.values()]
    .map((m) => {
      const mIn = m.inputTokens + m.cacheReadTokens;
      return {
        id: m.id,
        name: m.name,
        requests: m.requests,
        success: m.success,
        errors: m.errors,
        tokens: m.tokens,
        inputTokens: m.inputTokens,
        cacheReadTokens: m.cacheReadTokens,
        outputTokens: m.outputTokens,
        cacheHitPercent: mIn > 0 ? Number(((m.cacheReadTokens / mIn) * 100).toFixed(1)) : null,
        costUsd: m.priced > 0 ? Number(m.costSum.toFixed(6)) : null,
        avgTps: m.speedDuration > 0 ? Number(((m.speedOutput * 1000) / m.speedDuration).toFixed(1)) : null,
        peakTps: m.peakTps != null ? Number(m.peakTps.toFixed(1)) : null,
      };
    })
    .sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));

  // `selected` is already in descending `timestampMs` order from `collectAllRequests`.
  const recentCalls = selected
    .slice(0, recentCallsLimit)
    .map((r) => {
      const inputTokens = Number(r.inputTokens) || 0;
      const cacheReadTokens = Number(r.cacheReadTokens) || 0;
      const outputTokens = Number(r.outputTokens) || 0;
      const thinkingTokens = Number(r.thinkingTokens) || 0;
      const responseTokens = Number(r.responseTokens) || 0;
      const ttftMs = Number.isFinite(r.ttftMs) && r.ttftMs >= 0 ? Math.round(r.ttftMs) : null;
      const streamingMs = Number.isFinite(r.streamingMs) && r.streamingMs >= 0 ? Math.round(r.streamingMs) : null;
      const durationMs = Number.isFinite(r.ttftMs) && Number.isFinite(r.streamingMs)
        ? Math.round(r.ttftMs + r.streamingMs)
        : (Number.isFinite(r.stepDurationMs) && r.stepDurationMs > 0 ? Math.round(r.stepDurationMs) : null);
      const tps = Number.isFinite(r.streamingMs) && r.streamingMs > 0 && outputTokens > 0
        ? Number((outputTokens / (r.streamingMs / 1000)).toFixed(1))
        : null;
      const totalInCall = inputTokens + cacheReadTokens;
      const cacheHitRate = totalInCall > 0
        ? Number(((cacheReadTokens / totalInCall) * 100).toFixed(1))
        : null;
      const error = r.error || '';
      return {
        timestampMs: Number.isFinite(r.timestampMs) ? Math.round(r.timestampMs) : null,
        model: r.model || '',
        provider: 'Antigravity',
        ttftMs,
        streamingMs,
        durationMs,
        tps,
        inputTokens,
        cacheReadTokens,
        cacheWriteTokens: 0,
        thinkingTokens,
        outputTokens,
        responseTokens,
        cacheHitRate,
        status: error ? 'error' : 'ok',
        error,
        retries: Number(r.retries) || 0,
        conversationId: r.conversationId || '',
        requestId: r.requestId || r.id || '',
      };
    });

  const outErrors = includeRequests
    ? errors
    : errors.slice(0, 50).map((e) => ({
        id: e.id,
        conversationId: e.conversationId,
        timestampMs: e.timestampMs,
        model: e.model,
        status: 'error',
        error: String(e.error || '').slice(0, 240),
        retries: e.retries || 0,
      }));

  const result = {
    range: preset,
    totalRequests: selected.length,
    totalErrors: errors.length,
    totalTokens,
    inputTokens: totalInput,
    cacheReadTokens: totalCache,
    outputTokens: totalOutput,
    cacheHitPercent,
    costUsd,
    days,
    models,
    requests: includeRequests ? enrichedRequests : [],
    recentCalls,
    errors: outErrors,
    cacheAnomalies,
    updatedAtMs: Date.now(),
  };

  if (resultCacheKey) {
    dashboardResultCache.set(resultCacheKey, { sourceAt: rawEntry.at, value: result });
    if (dashboardResultCache.size > DASHBOARD_RESULT_CACHE_MAX) {
      dashboardResultCache.delete(dashboardResultCache.keys().next().value);
    }
  }
  return result;
}

function extractUserPrompt(raw) {
  const text = typeof raw === 'string' ? raw : '';
  const match = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
  return (match ? match[1] : text).trim();
}

function parseToolArgString(val) {
  if (typeof val !== 'string') return '';
  if (val.startsWith('"')) {
    try {
      return String(JSON.parse(val));
    } catch {
      return val;
    }
  }
  return val;
}

function readTranscriptTail(filePath, size, maxFileBytes, tailBytes) {
  if (size <= maxFileBytes) return fs.readFileSync(filePath, 'utf8');
  let fd;
  try {
    const length = Math.min(size, tailBytes);
    const offset = Math.max(0, size - length);
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(length);
    const bytesRead = fs.readSync(fd, buf, 0, length, offset);
    const chunk = buf.subarray(0, bytesRead).toString('utf8');
    if (offset === 0) return chunk;
    const nl = chunk.indexOf('\n');
    return nl >= 0 ? chunk.slice(nl + 1) : chunk;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch {}
    }
  }
}

function buildSnippet(source, needleLower, maxChars = 200) {
  const clean = String(source || '').replace(/\r\n/g, '\n').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  const lower = clean.toLowerCase();
  const idx = lower.indexOf(needleLower);
  if (idx < 0) return null;
  const half = Math.max(24, Math.floor((maxChars - needleLower.length) / 2));
  let start = Math.max(0, idx - half);
  let end = Math.min(clean.length, start + maxChars);
  if (end - start < maxChars && start > 0) start = Math.max(0, end - maxChars);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < clean.length ? '…' : '';
  const snippet = prefix + clean.slice(start, end) + suffix;
  const matchIndex = prefix.length + (idx - start);
  const matchLength = needleLower.length;
  return {
    snippet,
    matchIndex,
    matchLength,
    highlight: {
      before: snippet.slice(0, matchIndex),
      match: snippet.slice(matchIndex, matchIndex + matchLength),
      after: snippet.slice(matchIndex + matchLength),
    },
  };
}

function extractSearchCandidates(step, needleLower, scope) {
  const out = [];
  if (!step || typeof step !== 'object') return out;
  const wantText = scope === 'all' || scope === 'text';
  const wantCode = scope === 'all' || scope === 'code';

  if (step.type === 'USER_INPUT') {
    const prompt = extractUserPrompt(step.content);
    if (!prompt || /^Error: The stream was interrupted/i.test(prompt)) return out;
    if (wantCode) {
      FENCE_RE.lastIndex = 0;
      let m;
      while ((m = FENCE_RE.exec(prompt)) !== null) {
        const block = m[1].trim();
        if (block && block.toLowerCase().includes(needleLower)) {
          out.push({ kind: 'code', text: block, copyText: block.slice(0, 600) });
        }
      }
    }
    if (wantText && prompt.toLowerCase().includes(needleLower)) {
      out.push({ kind: 'prompt', text: prompt, copyText: '' });
    }
    return out;
  }

  if (step.type === 'PLANNER_RESPONSE') {
    if (wantCode && Array.isArray(step.tool_calls)) {
      for (const call of step.tool_calls) {
        if (!call || typeof call !== 'object') continue;
        if (/run_command/.test(String(call.name || ''))) {
          const cmd = parseToolArgString(call.args && call.args.CommandLine).trim();
          if (cmd && cmd.toLowerCase().includes(needleLower)) {
            out.push({ kind: 'command', text: cmd, copyText: cmd.slice(0, 600) });
          }
        }
      }
    }
    const content = typeof step.content === 'string' ? step.content : '';
    if (content) {
      if (wantCode) {
        FENCE_RE.lastIndex = 0;
        let m;
        while ((m = FENCE_RE.exec(content)) !== null) {
          const block = m[1].trim();
          if (block && block.toLowerCase().includes(needleLower)) {
            out.push({ kind: 'code', text: block, copyText: block.slice(0, 600) });
          }
        }
      }
      if (wantText && content.toLowerCase().includes(needleLower)) {
        out.push({ kind: 'response', text: content, copyText: '' });
      }
    }
    return out;
  }

  if (step.type === 'GENERIC' && wantCode) {
    const raw = typeof step.content === 'string' ? step.content : '';
    if (!raw || !raw.toLowerCase().includes(needleLower)) return out;
    const markerIdx = raw.indexOf('Command output:');
    const body = (markerIdx >= 0 ? raw.slice(markerIdx + 15) : raw).trim();
    if (body && body.toLowerCase().includes(needleLower)) {
      out.push({ kind: 'output', text: body, copyText: body.slice(0, 600) });
    }
  }

  return out;
}

/**
 * Full-text search across historical conversation transcripts (`brain/<id>/.system_generated/logs/transcript.jsonl`).
 * Supports `opts.scope` in `'all' | 'text' | 'code'` (matching prompts, responses, fenced code blocks, and commands).
 */
function searchTranscripts(appDataDir, query, opts = {}) {
  const dir = resolveAppDataDir(appDataDir);
  const rawQuery = typeof query === 'string' ? query.trim() : '';
  const scope = opts.scope === 'text' || opts.scope === 'code' ? opts.scope : 'all';
  const hasNonAscii = /[^\x00-\x7f]/.test(rawQuery);
  if (!rawQuery || (!hasNonAscii && rawQuery.length < 2)) {
    return { query: rawQuery, scope, results: [], scannedConversations: 0, truncated: false };
  }

  const brainDir = path.join(dir, 'brain');
  if (!fs.existsSync(brainDir)) {
    return { query: rawQuery, scope, results: [], scannedConversations: 0, truncated: false };
  }

  const maxConversations = Number.isInteger(opts.maxConversations) && opts.maxConversations > 0 ? opts.maxConversations : 250;
  const maxResults = Number.isInteger(opts.maxResults) && opts.maxResults > 0 ? Math.min(100, opts.maxResults) : 40;
  const maxPerConversation = Number.isInteger(opts.maxPerConversation) && opts.maxPerConversation > 0 ? opts.maxPerConversation : 3;
  const maxFileBytes = Number.isInteger(opts.maxFileBytes) && opts.maxFileBytes > 0 ? opts.maxFileBytes : 8 * 1024 * 1024;
  const tailBytes = Number.isInteger(opts.tailBytes) && opts.tailBytes > 0 ? opts.tailBytes : 4 * 1024 * 1024;

  const excluded = new Set(Array.isArray(opts.excludeIds) ? opts.excludeIds.filter(isValidConversationId) : []);

  let entries = [];
  let truncated = false;

  if (Array.isArray(opts.conversationIds)) {
    const uniqueIds = [...new Set(opts.conversationIds.filter(isValidConversationId))].slice(0, 500);
    for (const id of uniqueIds) {
      if (excluded.has(id)) continue;
      const filePath = path.join(brainDir, id, '.system_generated', 'logs', 'transcript.jsonl');
      try {
        const st = fs.statSync(filePath);
        if (st.isFile() && st.size > 0) entries.push({ id, filePath, mtimeMs: st.mtimeMs, size: st.size });
      } catch {}
    }
  } else {
    try {
      for (const dirent of fs.readdirSync(brainDir, { withFileTypes: true })) {
        if (!dirent.isDirectory() || !isValidConversationId(dirent.name) || excluded.has(dirent.name)) continue;
        const filePath = path.join(brainDir, dirent.name, '.system_generated', 'logs', 'transcript.jsonl');
        try {
          const st = fs.statSync(filePath);
          if (st.isFile() && st.size > 0) entries.push({ id: dirent.name, filePath, mtimeMs: st.mtimeMs, size: st.size });
        } catch {}
      }
    } catch {}
  }

  entries.sort((a, b) => b.mtimeMs - a.mtimeMs);
  if (entries.length > maxConversations) {
    entries = entries.slice(0, maxConversations);
    truncated = true;
  }

  const needleLower = rawQuery.toLowerCase();
  const results = [];
  let scannedConversations = 0;

  for (const entry of entries) {
    if (results.length >= maxResults) {
      truncated = true;
      break;
    }
    scannedConversations++;
    let content;
    try {
      content = readTranscriptTail(entry.filePath, entry.size, maxFileBytes, tailBytes);
    } catch {
      continue;
    }
    if (!content || !content.toLowerCase().includes(needleLower)) continue;

    const lines = content.split('\n');
    let turnNumber = 0;
    let stepIndexStart = 0;
    let fallbackTitle = '';
    let currentTurnSummary = '';
    const convMatches = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line) continue;
      const isUserInputHint = line.includes('"USER_INPUT"');
      const hasMatchHint = line.toLowerCase().includes(needleLower);
      if (!isUserInputHint && !hasMatchHint) continue;

      let step;
      try {
        step = JSON.parse(line);
      } catch {
        continue;
      }

      if (step && step.type === 'USER_INPUT') {
        const prompt = extractUserPrompt(step.content);
        if (prompt && !/^Error: The stream was interrupted/i.test(prompt)) {
          turnNumber++;
          stepIndexStart = Number.isInteger(step.step_index) ? step.step_index : 0;
          currentTurnSummary = prompt.split('\n')[0].slice(0, 80);
          if (!fallbackTitle) fallbackTitle = currentTurnSummary;
        }
      }
      if (!hasMatchHint) continue;

      const candidates = extractSearchCandidates(step, needleLower, scope);
      if (!candidates.length) continue;
      const chosen = candidates[0];
      const built = buildSnippet(chosen.text, needleLower, 200);
      if (!built) continue;
      const createdAtMs = step.created_at ? Date.parse(step.created_at) : null;
      convMatches.push({
        conversationId: entry.id,
        fallbackTitle: fallbackTitle || '会话',
        turnSummary: currentTurnSummary || fallbackTitle || '会话',
        turnNumber: turnNumber || 1,
        stepIndexStart,
        stepIndex: Number.isInteger(step.step_index) ? step.step_index : stepIndexStart,
        kind: chosen.kind,
        snippet: built.snippet,
        highlight: built.highlight,
        matchIndex: built.matchIndex,
        matchLength: built.matchLength,
        copyText: chosen.copyText || '',
        timestampMs: Number.isFinite(createdAtMs) ? createdAtMs : Math.round(entry.mtimeMs),
      });
    }

    if (convMatches.length) {
      const recentOnes = convMatches.slice(-maxPerConversation).reverse();
      for (const item of recentOnes) {
        if (results.length >= maxResults) {
          truncated = true;
          break;
        }
        results.push(item);
      }
    }
  }

  return { query: rawQuery, scope, results, scannedConversations, truncated };
}

function clearTelemetryCaches() {
  dbCache.clear();
  fileEventsCache.clear();
  fileEventsCacheDir = '';
  dashboardCache = null;
  dashboardResultCache.clear();
  trajectoryStatsCache.clear();
  metaIndexCache.clear();
}

module.exports = {
  decodeGeneration,
  decodeCheckpointTokens,
  readDatabase,
  contextSnapshot,
  modelContexts,
  requestEvents,
  getConversationTelemetry,
  getUsageDashboard,
  searchTranscripts,
  getTrajectoryCacheStats,
  // Auxiliary MIT helpers useful to sibling backend/tests
  shortModelName,
  modelIdentity,
  estimateCost,
  annotateCacheAnomalies,
  dateRange,
  isValidConversationId,
  resolveAppDataDir,
  readTrajectoryIndexEntry,
  clearTelemetryCaches,
  DEFAULT_RATES,
};
