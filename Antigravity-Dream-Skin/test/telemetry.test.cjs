'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const protobuf = require('../src/domain/protobuf.cjs');
const telemetryDb = require('../src/domain/telemetry-db.cjs');
const quotaBridge = require('../src/domain/quota-bridge.cjs');

/* ---------------- Minimal Protobuf Wire Encoder for Test Fixtures ---------------- */

function encodeVarint(value) {
  let v = BigInt.asUintN(64, BigInt(value));
  const bytes = [];
  do {
    let byte = Number(v & 0x7fn);
    v >>= 7n;
    if (v !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (v !== 0n);
  return Buffer.from(bytes);
}

function pbVarint(fieldNum, value) {
  return Buffer.concat([encodeVarint((fieldNum << 3) | 0), encodeVarint(value)]);
}

function pbBytes(fieldNum, buf) {
  const payload = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  return Buffer.concat([encodeVarint((fieldNum << 3) | 2), encodeVarint(payload.length), payload]);
}

function pbString(fieldNum, str) {
  return pbBytes(fieldNum, Buffer.from(String(str), 'utf8'));
}

function pbTimestamp(ms) {
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  return Buffer.concat([pbVarint(1, seconds), pbVarint(2, nanos)]);
}

function pbDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  const nanos = Math.round((ms - seconds * 1000) * 1e6);
  return Buffer.concat([pbVarint(1, seconds), pbVarint(2, nanos)]);
}

function buildGenerationBlob({
  executionId = 'exec-1',
  error = '',
  stepIndices = [0, 1],
  modelName = 'Gemini 4 Neon (High)',
  modelEnum = 1537,
  executionModelEnum = 0,
  inputTokens = 10000,
  cacheReadTokens = 40000,
  outputTokens = 1200,
  thinkingTokens = 500,
  responseTokens = 700,
  requestId = 'req-1',
  retries = 0,
  retryErrors = [],
  ttftMs = 1500,
  streamingMs = 6000,
  context = null,
}) {
  const usageParts = [
    pbVarint(2, inputTokens),
    pbVarint(3, outputTokens),
    pbVarint(5, cacheReadTokens),
    pbVarint(9, thinkingTokens),
    pbVarint(10, responseTokens),
  ];

  const chatParts = [
    pbVarint(3, modelEnum),
    pbBytes(4, Buffer.concat(usageParts)),
    pbString(21, modelName),
  ];
  if (ttftMs != null) chatParts.push(pbBytes(11, pbDuration(ttftMs)));
  if (streamingMs != null) chatParts.push(pbBytes(12, pbDuration(streamingMs)));
  if (retries > 0) chatParts.push(pbVarint(14, retries));
  for (const rErr of retryErrors) {
    chatParts.push(pbBytes(17, pbString(3, rErr)));
  }
  if (requestId) {
    chatParts.push(pbBytes(20, Buffer.concat([pbString(1, 'request_id'), pbString(2, requestId)])));
  }

  if (context) {
    const breakdownParts = (context.categories || []).map((cat) => {
      const catParts = [pbString(1, cat.label), pbVarint(4, cat.tokens)];
      for (const child of cat.children || []) {
        catParts.push(pbBytes(5, Buffer.concat([pbString(1, child.label), pbVarint(3, child.tokens)])));
      }
      return pbBytes(1, Buffer.concat(catParts));
    });
    const ctxMsg = Buffer.concat([
      pbVarint(1, context.usedTokens || 0),
      pbBytes(3, Buffer.concat(breakdownParts)),
      pbVarint(4, context.maxTokens || 0),
    ]);
    chatParts.push(pbBytes(9, pbBytes(10, ctxMsg)));
  }

  const genParts = [pbBytes(1, Buffer.concat(chatParts))];
  if (stepIndices.length) {
    // Encode as packed varints to also exercise packed decoding.
    const packed = Buffer.concat(stepIndices.map((idx) => encodeVarint(idx)));
    genParts.push(pbBytes(2, packed));
  }
  if (executionModelEnum) {
    genParts.push(pbBytes(3, pbBytes(60, pbVarint(1, executionModelEnum))));
  }
  if (executionId) genParts.push(pbString(4, executionId));
  if (error) genParts.push(pbString(5, error));
  return Buffer.concat(genParts);
}

function buildStepMetadata(createdMs) {
  return pbBytes(1, pbTimestamp(createdMs));
}

function buildCheckpointPayload({ summary = '', requests = [], artifactCount = 0 }) {
  const cpParts = [];
  if (summary) cpParts.push(pbString(5, summary));
  for (let i = 0; i < artifactCount; i++) cpParts.push(pbString(14, `artifact-${i}.md`));
  for (const r of requests) cpParts.push(pbBytes(30, pbString(1, r)));
  return pbBytes(30, Buffer.concat(cpParts));
}

function buildTrajectoryMetaBlob({
  createdAtMs = Date.now(),
  parentConversationId = '',
  rootConversationId = '',
  nestingDepth = 0,
}) {
  const parts = [pbBytes(2, pbTimestamp(createdAtMs))];
  if (parentConversationId) parts.push(pbString(5, parentConversationId));
  if (rootConversationId) parts.push(pbString(6, rootConversationId));
  if (nestingDepth > 0) parts.push(pbVarint(17, nestingDepth));
  return Buffer.concat(parts);
}

function createConversationDb(appDataDir, id, {
  generations = [],
  steps = [],
  metaBlob = null,
  parentRefs = [],
} = {}) {
  const convDir = path.join(appDataDir, 'conversations');
  fs.mkdirSync(convDir, { recursive: true });
  const dbPath = path.join(convDir, `${id}.db`);
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE gen_metadata (idx INTEGER PRIMARY KEY, data BLOB, size INTEGER DEFAULT 0);
    CREATE TABLE steps (idx INTEGER PRIMARY KEY, step_type INTEGER DEFAULT 0, status INTEGER DEFAULT 0, metadata BLOB, step_payload BLOB);
    CREATE TABLE trajectory_metadata_blob (id TEXT PRIMARY KEY DEFAULT 'main', data BLOB);
    CREATE TABLE parent_references (idx INTEGER PRIMARY KEY, data BLOB);
  `);
  const insGen = db.prepare('INSERT INTO gen_metadata (idx, data, size) VALUES (?, ?, ?)');
  generations.forEach((blob, idx) => insGen.run(idx, blob, blob.length));
  const insStep = db.prepare('INSERT INTO steps (idx, step_type, status, metadata, step_payload) VALUES (?, ?, ?, ?, ?)');
  for (const s of steps) {
    insStep.run(s.idx, s.step_type ?? 0, s.status ?? 3, s.metadata ?? null, s.step_payload ?? null);
  }
  if (metaBlob) {
    db.prepare("INSERT INTO trajectory_metadata_blob (id, data) VALUES ('main', ?)").run(metaBlob);
  }
  const insRef = db.prepare('INSERT INTO parent_references (idx, data) VALUES (?, ?)');
  parentRefs.forEach((blob, idx) => insRef.run(idx, blob));
  db.close();
  return dbPath;
}

function writeTranscript(appDataDir, id, steps, mtimeMs = Date.now()) {
  const logsDir = path.join(appDataDir, 'brain', id, '.system_generated', 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const filePath = path.join(logsDir, 'transcript.jsonl');
  fs.writeFileSync(filePath, steps.map((s) => JSON.stringify(s)).join('\n') + '\n', 'utf8');
  const d = new Date(mtimeMs);
  fs.utimesSync(filePath, d, d);
  return filePath;
}

/* ==========================================================================
 * 1. Protobuf Decoder Tests
 * ========================================================================== */

test('protobuf.cjs decodes varints, nested messages, strings, fixed fields, timestamps and rejects malformed wire', () => {
  const fixed32 = Buffer.alloc(4);
  fixed32.writeUInt32LE(0x12345678, 0);
  const fixed64 = Buffer.alloc(8);
  fixed64.writeBigUInt64LE(0x1122334455667788n, 0);
  const msg = Buffer.concat([
    pbVarint(1, 42),
    pbVarint(1, -5),
    pbString(2, '你好喵呜'),
    pbBytes(3, Buffer.concat([pbVarint(1, 1700000000), pbVarint(2, 500_000_000)])),
    Buffer.concat([encodeVarint((4 << 3) | 5), fixed32]),
    Buffer.concat([encodeVarint((5 << 3) | 1), fixed64]),
  ]);

  const map = protobuf.fields(msg);
  assert.deepEqual(map.get(1), [42, -5]);
  assert.equal(protobuf.first(map, 1), 42);
  assert.equal(protobuf.first(map, 99, 'fallback'), 'fallback');
  assert.equal(protobuf.string(map, 2), '你好喵呜');
  assert.equal(protobuf.milliseconds(protobuf.first(map, 3)), 1_700_000_000_500);
  assert.equal(protobuf.first(map, 4).readUInt32LE(0), 0x12345678);
  assert.equal(protobuf.first(map, 5).readBigUInt64LE(0), 0x1122334455667788n);
  assert.equal(protobuf.nested(map, 3).get(1)[0], 1700000000);
  assert.equal(protobuf.fields(null).size, 0);
  assert.equal(protobuf.milliseconds(null), null);

  assert.throws(() => protobuf.fields(Buffer.from([0x00])), /Invalid protobuf field/);
  assert.throws(() => protobuf.fields(Buffer.from([0x0a, 0x10, 0x41])), /Truncated protobuf/);
  assert.throws(() => protobuf.fields(Buffer.from([0x0b])), /Unsupported protobuf wire type/);
});

/* ==========================================================================
 * 2. 9-Category Context Breakdown, Post-Compaction Estimate & Orchestrator
 * ========================================================================== */

test('contextSnapshot supports 9-category breakdown, exact apportionment, legacy skills split, and post-compaction estimation', () => {
  const nineInputGroups = [
    { label: 'System Prompt', tokens: 5000 },
    { label: 'Mcp Tools', tokens: 1200 },
    { label: 'Subagents', tokens: 2800 },
    { label: 'Skills', tokens: 3000 },
    { label: 'Plugins', tokens: 1500 },
    { label: 'Rules', tokens: 1500 },
    { label: 'Tools', tokens: 8000 },
    { label: 'Chat Messages', tokens: 277000 },
  ];
  const gen = {
    stepIndices: [10, 11],
    providerInputTokens: 256000,
    context: { usedTokens: 300000, maxTokens: 512000, categories: nineInputGroups },
  };
  const snap = telemetryDb.contextSnapshot(gen);
  assert.equal(snap.usedTokens, 256000);
  assert.equal(snap.maxTokens, 512000);
  assert.equal(snap.usedPercent, 50);
  assert.equal(snap.categories.length, 9); // 8 active categories + free = 9
  assert.equal(snap.categories.reduce((s, c) => s + c.tokens, 0), 512000);
  assert.equal(snap.categories.filter((c) => c.key !== 'free').reduce((s, c) => s + c.tokens, 0), 256000);
  assert.deepEqual(
    snap.categories.map((c) => c.key),
    ['system', 'mcp', 'subagents', 'skills', 'plugins', 'rules', 'tools', 'messages', 'free']
  );

  // Legacy nested skills inside System Prompt splits out cleanly
  const legacySnap = telemetryDb.contextSnapshot({
    providerInputTokens: 10000,
    context: {
      usedTokens: 10000,
      maxTokens: 100000,
      categories: [
        { label: 'System Prompt', tokens: 4000, children: [{ label: 'skills', tokens: 1500 }] },
        { label: 'Chat Messages', tokens: 6000 },
      ],
    },
  });
  assert.equal(legacySnap.categories.find((c) => c.key === 'skills')?.tokens, 1500);
  assert.equal(legacySnap.categories.find((c) => c.key === 'system')?.tokens, 2500);

  // Post-compaction pending estimate when completed CHECKPOINT step follows latest generation
  const cpPayload = buildCheckpointPayload({
    summary: '这是一段压缩后的会话摘要，记录已完成的功能与下一步计划。'.repeat(20),
    requests: ['完成遥测后端模块并运行单元测试'],
    artifactCount: 4,
  });
  const cpTokens = telemetryDb.decodeCheckpointTokens(cpPayload);
  assert.ok(cpTokens >= 500);

  const postCompact = telemetryDb.contextSnapshot(gen, 0, { stepIndex: 15, summaryTokens: cpTokens });
  assert.equal(postCompact.compactedPending, true);
  assert.equal(postCompact.preCompactPercent, 50);
  assert.equal(postCompact.usedTokens, 23000 + cpTokens);
  assert.ok(postCompact.usedPercent < 10);
  assert.equal(postCompact.categories.reduce((s, c) => s + c.tokens, 0), 512000);

  // Orchestrator multi-model tracking
  const mc = telemetryDb.modelContexts(
    [
      { modelName: 'Orchestrator (Neon)', modelEnum: 1537, executionModelEnum: 1669, role: 'planner', providerInputTokens: 120000, context: { maxTokens: 512000 } },
      { modelName: 'Gemini 4 Hydrogen (High)', modelEnum: 1669, executionModelEnum: 1669, role: 'execution', providerInputTokens: 310000, context: { maxTokens: 512000 } },
      { modelName: 'Gemini 4 Hydrogen (High)', modelEnum: 1669, executionModelEnum: 1669, role: 'execution', providerInputTokens: 90000, context: { maxTokens: 512000 } },
    ],
    [15]
  );
  assert.equal(mc.hasOrchestrator, true);
  assert.equal(mc.compactions, 1);
  assert.equal(mc.models.length, 2);
  assert.equal(mc.models[0].role, 'planner');
  assert.equal(mc.models[1].role, 'execution');
  assert.equal(mc.models[1].isCurrent, true);
});

/* ==========================================================================
 * 3. Streaming TPS vs Short-Response Whole-Request Fallback
 * ========================================================================== */

test('requestEvents excludes TTFT for genuine streaming (>=500ms & >=20 output tokens) and falls back for short responses', () => {
  const events = telemetryDb.requestEvents(
    {
      generations: [
        {
          requestId: 'req-stream',
          stepIndices: [0],
          modelName: 'Gemini 4 Neon (High)',
          inputTokens: 5000,
          cacheReadTokens: 45000,
          outputTokens: 1000,
          ttftMs: 10000,
          streamingMs: 5000,
        },
        {
          requestId: 'req-short-ms',
          stepIndices: [1],
          modelName: 'Gemini 4 Neon (High)',
          inputTokens: 1000,
          cacheReadTokens: 0,
          outputTokens: 100,
          ttftMs: 3800,
          streamingMs: 200,
        },
        {
          requestId: 'req-short-tok',
          stepIndices: [2],
          modelName: 'Gemini 4 Neon (High)',
          inputTokens: 1000,
          cacheReadTokens: 0,
          outputTokens: 10,
          ttftMs: 1000,
          streamingMs: 1000,
        },
      ],
      times: new Map([
        [0, { createdMs: 1_700_000_000_000 }],
        [1, { createdMs: 1_700_000_010_000 }],
        [2, { createdMs: 1_700_000_020_000 }],
      ]),
    },
    'conv-tps'
  );

  assert.equal(events[0].tpsMode, 'stream');
  assert.equal(events[0].tps, 200); // 1000 / 5s (TTFT 10s excluded)
  assert.equal(events[0].wholeTps, 66.7);
  assert.equal(events[0].cacheHitPercent, 90);

  assert.equal(events[1].tpsMode, 'whole');
  assert.equal(events[1].tps, 25); // 100 / (3.8 + 0.2)s

  assert.equal(events[2].tpsMode, 'whole');
  assert.equal(events[2].tps, 5); // 10 / (1 + 1)s
});

/* ==========================================================================
 * 4. SQLite DB Reading, WAL Stamp Cache, Conversation Telemetry & Subagents
 * ========================================================================== */

test('readDatabase, getConversationTelemetry, and getTrajectoryCacheStats parse real temporary SQLite DBs with subagents and WAL cache invalidation', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-telemetry-'));
  try {
    telemetryDb.clearTelemetryCaches();
    const now = Date.parse('2026-11-26T10:00:00Z');
    const rootId = 'conv-main-001';
    const subId = 'conv-sub-001';

    const categories = [
      { label: 'System Prompt', tokens: 4000 },
      { label: 'Mcp Tools', tokens: 1000 },
      { label: 'Subagents', tokens: 2000 },
      { label: 'Skills', tokens: 2500 },
      { label: 'Plugins', tokens: 1500 },
      { label: 'Rules', tokens: 1000 },
      { label: 'Tools', tokens: 8000 },
      { label: 'Chat Messages', tokens: 80000 },
    ];

    const rootDbPath = createConversationDb(appDataDir, rootId, {
      generations: [
        buildGenerationBlob({
          requestId: 'r-main-1',
          stepIndices: [0, 1],
          modelName: 'Gemini 4 Neon (High)',
          inputTokens: 20000,
          cacheReadTokens: 80000,
          outputTokens: 2000,
          ttftMs: 1200,
          streamingMs: 10000,
          context: { usedTokens: 100000, maxTokens: 512000, categories },
        }),
      ],
      steps: [
        { idx: 0, step_type: 14, status: 3, metadata: buildStepMetadata(now) },
        { idx: 1, step_type: 15, status: 3, metadata: buildStepMetadata(now + 2000) },
      ],
      metaBlob: buildTrajectoryMetaBlob({ createdAtMs: now, rootConversationId: rootId }),
    });

    createConversationDb(appDataDir, subId, {
      generations: [
        buildGenerationBlob({
          requestId: 'r-sub-1',
          stepIndices: [0, 1],
          modelName: 'Gemini 4 Hydrogen (High)',
          inputTokens: 10000,
          cacheReadTokens: 30000,
          outputTokens: 600,
          ttftMs: 800,
          streamingMs: 3000,
          context: { usedTokens: 40000, maxTokens: 512000, categories: [{ label: 'Chat Messages', tokens: 40000 }] },
        }),
      ],
      steps: [
        { idx: 0, step_type: 101, status: 3, metadata: buildStepMetadata(now + 5000) },
        { idx: 1, step_type: 15, status: 3, metadata: buildStepMetadata(now + 8000) },
      ],
      metaBlob: buildTrajectoryMetaBlob({
        createdAtMs: now + 5000,
        parentConversationId: rootId,
        rootConversationId: rootId,
        nestingDepth: 1,
      }),
    });

    // Verify cache hit on second readDatabase call, then invalidation when WAL changes
    const db1 = telemetryDb.readDatabase(appDataDir, rootId);
    const db2 = telemetryDb.readDatabase(appDataDir, rootId);
    assert.equal(db1, db2); // exact cached object reference
    fs.writeFileSync(`${rootDbPath}-wal`, Buffer.alloc(64, 0xaa));
    const db3 = telemetryDb.readDatabase(appDataDir, rootId);
    assert.notEqual(db3, db1); // invalidated due to WAL stamp change
    fs.unlinkSync(`${rootDbPath}-wal`);

    // Verify path-traversal ID is rejected safely
    assert.equal(telemetryDb.readDatabase(appDataDir, '../evil'), null);

    const tel = telemetryDb.getConversationTelemetry(appDataDir, rootId);
    assert.equal(tel.conversationId, rootId);
    assert.equal(tel.model, 'Gemini 4 Neon (High)');
    assert.equal(tel.role, '');
    assert.equal(tel.tps, 200);
    assert.equal(tel.latestTps, 200);
    assert.equal(tel.ttftSeconds, 1.2);
    assert.equal(tel.rounds, 1);
    assert.equal(tel.inputTokens, 20000);
    assert.equal(tel.cacheReadTokens, 80000);
    assert.equal(tel.outputTokens, 2000);
    assert.equal(tel.totalTokens, 102000);
    assert.equal(tel.cacheHitPercent, 80);
    assert.ok(tel.costUsd > 0);
    assert.equal(tel.context.usedTokens, 100000);
    assert.equal(tel.context.maxTokens, 512000);
    assert.equal(tel.context.usedPercent, 19.5);
    assert.equal(tel.context.categories.length, 9);
    assert.equal(tel.context.compactions, 0);
    assert.equal(tel.context.compactedPending, false);
    assert.equal(tel.context.preCompactPercent, null);
    assert.equal(tel.context.hasOrchestrator, false);
    assert.equal(tel.context.models.length, 1);
    assert.equal(tel.subagents.length, 1);
    assert.equal(tel.subagents[0].conversationId, subId);
    assert.equal(tel.subagents[0].shortModel, 'Hydrogen');
    assert.equal(tel.subagents[0].totalTokens, 40600);
    assert.ok(tel.cacheSizeBytes > 0);

    const cacheStats = telemetryDb.getTrajectoryCacheStats(appDataDir);
    assert.equal(cacheStats.conversationCount, 2);
    assert.equal(cacheStats.subagentCount, 1);
    assert.equal(cacheStats.totalBytes, tel.cacheSizeBytes);
  } finally {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 5. Usage Dashboard (Range Filtering + Cache Anomaly Detection)
 * ========================================================================== */

test('getUsageDashboard filters today/week/30d/all and marks short-interval cache anomalies without false positives', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-dash-'));
  try {
    telemetryDb.clearTelemetryCaches();
    // 2026-11-26 is Thursday
    const now = new Date(2026, 10, 26, 15, 0, 0).getTime();
    const tToday1 = new Date(2026, 10, 26, 10, 0, 0).getTime();
    const tToday2 = tToday1 + 30_000; // warm cached
    const tToday3 = tToday1 + 75_000; // 45s later -> full wipeout (cleared anomaly!)
    const tToday4 = tToday1 + 95_000; // 20s later -> consecutive miss (missed anomaly!)
    const tWeekEarlier = new Date(2026, 10, 24, 12, 0, 0).getTime(); // Tuesday same week
    const t20dAgo = new Date(2026, 10, 6, 12, 0, 0).getTime(); // within 30d
    const t60dAgo = new Date(2026, 8, 20, 12, 0, 0).getTime(); // outside 30d

    createConversationDb(appDataDir, 'conv-dash-1', {
      generations: [
        buildGenerationBlob({ requestId: 'd-old', stepIndices: [0], modelName: 'Gemini 4 Carbon (High)', inputTokens: 10000, cacheReadTokens: 0, outputTokens: 200, ttftMs: 500, streamingMs: 1000 }),
        buildGenerationBlob({ requestId: 'd-20d', stepIndices: [1], modelName: 'Gemini 4 Carbon (High)', inputTokens: 10000, cacheReadTokens: 20000, outputTokens: 300, ttftMs: 500, streamingMs: 1000 }),
        buildGenerationBlob({ requestId: 'd-week', stepIndices: [2], modelName: 'Gemini 4 Neon (High)', inputTokens: 5000, cacheReadTokens: 15000, outputTokens: 400, ttftMs: 500, streamingMs: 1000, error: 'rate limit', retryErrors: ['transient 503'] }),
        buildGenerationBlob({ requestId: 'd-t1', stepIndices: [3], modelName: 'Gemini 4 Neon (High)', inputTokens: 20000, cacheReadTokens: 0, outputTokens: 500, ttftMs: 500, streamingMs: 1000 }),
        buildGenerationBlob({ requestId: 'd-t2', stepIndices: [4], modelName: 'Gemini 4 Neon (High)', inputTokens: 2000, cacheReadTokens: 18000, outputTokens: 400, ttftMs: 500, streamingMs: 1000 }),
        buildGenerationBlob({ requestId: 'd-t3', stepIndices: [5], modelName: 'Gemini 4 Neon (High)', inputTokens: 22000, cacheReadTokens: 0, outputTokens: 500, ttftMs: 500, streamingMs: 1000 }),
        buildGenerationBlob({ requestId: 'd-t4', stepIndices: [6], modelName: 'Gemini 4 Neon (High)', inputTokens: 24000, cacheReadTokens: 0, outputTokens: 400, ttftMs: 500, streamingMs: 1000 }),
      ],
      steps: [
        { idx: 0, step_type: 14, metadata: buildStepMetadata(t60dAgo) },
        { idx: 1, step_type: 14, metadata: buildStepMetadata(t20dAgo) },
        { idx: 2, step_type: 14, metadata: buildStepMetadata(tWeekEarlier) },
        { idx: 3, step_type: 14, metadata: buildStepMetadata(tToday1) },
        { idx: 4, step_type: 14, metadata: buildStepMetadata(tToday2) },
        { idx: 5, step_type: 14, metadata: buildStepMetadata(tToday3) },
        { idx: 6, step_type: 14, metadata: buildStepMetadata(tToday4) },
      ],
    });

    const today = telemetryDb.getUsageDashboard(appDataDir, { range: 'today', now, force: true });
    assert.equal(today.totalRequests, 4);
    assert.equal(today.days.length, 1);
    assert.equal(today.cacheAnomalies.length, 2);
    assert.equal(today.cacheAnomalies.find((a) => a.requestId === 'd-t3')?.kind, 'cleared');
    assert.equal(today.cacheAnomalies.find((a) => a.requestId === 'd-t4')?.kind, 'missed');
    assert.equal(today.cacheAnomalies.some((a) => a.requestId === 'd-t1'), false);

    const week = telemetryDb.getUsageDashboard(appDataDir, { range: 'week', now });
    assert.equal(week.totalRequests, 5);
    assert.equal(week.errors.length, 2); // main error + distinct retry error

    const d30 = telemetryDb.getUsageDashboard(appDataDir, { range: '30d', now });
    assert.equal(d30.totalRequests, 6);

    const all = telemetryDb.getUsageDashboard(appDataDir, { range: 'all', now });
    assert.equal(all.totalRequests, 7);
    assert.equal(all.days.length, 4);
    assert.ok(all.models.length >= 2);
    assert.ok(all.costUsd > 0);

    // Verify recentCalls descending ordering, range scoping, and exact schema fields
    assert.equal(today.recentCalls.length, 4);
    assert.deepEqual(today.recentCalls.map((c) => c.requestId), ['d-t4', 'd-t3', 'd-t2', 'd-t1']);
    const warmCall = today.recentCalls.find((c) => c.requestId === 'd-t2');
    assert.deepEqual(warmCall, {
      timestampMs: tToday2,
      model: 'Gemini 4 Neon (High)',
      provider: 'Antigravity',
      ttftMs: 500,
      streamingMs: 1000,
      durationMs: 1500,
      tps: 400,
      inputTokens: 2000,
      cacheReadTokens: 18000,
      cacheWriteTokens: 0,
      thinkingTokens: 500,
      outputTokens: 400,
      responseTokens: 700,
      cacheHitRate: 90,
      status: 'ok',
      error: '',
      retries: 0,
      conversationId: 'conv-dash-1',
      requestId: 'd-t2',
    });

    const weekErrCall = week.recentCalls.find((c) => c.requestId === 'd-week');
    assert.equal(weekErrCall.status, 'error');
    assert.equal(weekErrCall.error, 'rate limit');
    assert.equal(weekErrCall.cacheHitRate, 75);
  } finally {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

test('getUsageDashboard recentCalls caps at 150 records in descending time order and supports step-duration fallback', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-recentcalls-'));
  try {
    telemetryDb.clearTelemetryCaches();
    const baseMs = new Date(2026, 10, 26, 8, 0, 0).getTime();
    const generations = [];
    const steps = [];
    for (let i = 0; i < 165; i++) {
      const ts = baseMs + i * 1000;
      const isStepFallback = i === 164;
      generations.push(buildGenerationBlob({
        requestId: `call-${String(i).padStart(3, '0')}`,
        stepIndices: [i],
        modelName: i % 2 === 0 ? 'Gemini 4 Neon (XHigh)' : 'Gemini 4 Hydrogen (High)',
        inputTokens: 2330,
        cacheReadTokens: 255000,
        outputTokens: isStepFallback ? 0 : 1800,
        thinkingTokens: 1200,
        responseTokens: 600,
        ttftMs: isStepFallback ? null : 5150,
        streamingMs: isStepFallback ? null : 11050,
        retries: isStepFallback ? 2 : 0,
        error: isStepFallback ? 'timeout' : '',
      }));
      steps.push({
        idx: i,
        step_type: 14,
        metadata: isStepFallback
          ? Buffer.concat([pbBytes(1, pbTimestamp(ts)), pbBytes(7, pbTimestamp(ts + 4200))])
          : buildStepMetadata(ts),
      });
    }
    createConversationDb(appDataDir, 'conv-many', { generations, steps });

    const dash = telemetryDb.getUsageDashboard(appDataDir, { range: 'all', now: baseMs + 200_000, force: true });
    assert.equal(dash.totalRequests, 165);
    assert.equal(dash.recentCalls.length, 150);
    // Strict descending timestamp ordering
    for (let i = 1; i < dash.recentCalls.length; i++) {
      assert.ok(dash.recentCalls[i - 1].timestampMs >= dash.recentCalls[i].timestampMs);
    }
    // Newest record (idx 164) uses step duration fallback & null tps when streamingMs is absent
    const latest = dash.recentCalls[0];
    assert.equal(latest.requestId, 'call-164');
    assert.equal(latest.durationMs, 4200);
    assert.equal(latest.tps, null);
    assert.equal(latest.status, 'error');
    assert.equal(latest.error, 'timeout');
    assert.equal(latest.retries, 2);
    // Second newest (idx 163) matches exact formula
    const prev = dash.recentCalls[1];
    assert.equal(prev.requestId, 'call-163');
    assert.equal(prev.provider, 'Antigravity');
    assert.equal(prev.durationMs, 16200);
    assert.equal(prev.tps, 162.9);
    assert.equal(prev.cacheHitRate, 99.1);
    assert.equal(prev.status, 'ok');
    // Oldest retained is call-015 (165 - 150 = 15)
    assert.equal(dash.recentCalls[149].requestId, 'call-015');

    // Lightweight mode: includeRequests=false & includeAnomalies=false keeps totals/models/days/recentCalls intact while dropping heavy requests/anomalies
    const lite1 = telemetryDb.getUsageDashboard(appDataDir, {
      range: 'all',
      now: baseMs + 200_000,
      includeRequests: false,
      includeAnomalies: false,
    });
    assert.equal(lite1.totalRequests, 165);
    assert.equal(lite1.totalTokens, dash.totalTokens);
    assert.deepEqual(lite1.requests, []);
    assert.deepEqual(lite1.cacheAnomalies, []);
    assert.equal(lite1.recentCalls.length, 150);
    assert.equal(lite1.models.length, dash.models.length);
    assert.equal(lite1.days.length, dash.days.length);

    // Multi-level aggregated result cache returns exact cached reference on repeated range lookup, and invalidates on force=true
    const lite2 = telemetryDb.getUsageDashboard(appDataDir, {
      range: 'all',
      now: baseMs + 200_000,
      includeRequests: false,
      includeAnomalies: false,
    });
    assert.equal(lite2, lite1);

    const liteForced = telemetryDb.getUsageDashboard(appDataDir, {
      range: 'all',
      now: baseMs + 200_000,
      includeRequests: false,
      includeAnomalies: false,
      force: true,
    });
    assert.notEqual(liteForced, lite1);

    // Trajectory cache stats TTL cache hit & force invalidation
    const stats1 = telemetryDb.getTrajectoryCacheStats(appDataDir);
    const stats2 = telemetryDb.getTrajectoryCacheStats(appDataDir);
    assert.equal(stats2, stats1);
    const statsForced = telemetryDb.getTrajectoryCacheStats(appDataDir, { force: true });
    assert.notEqual(statsForced, stats1);
  } finally {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 6. Full-Text Transcript Search
 * ========================================================================== */

test('searchTranscripts searches all/text/code scopes with turn summaries, highlights, and ID validation', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-search-'));
  try {
    writeTranscript(appDataDir, 'conv-alpha', [
      {
        step_index: 0,
        type: 'USER_INPUT',
        created_at: '2026-11-26T08:00:00Z',
        content: '<USER_REQUEST>\n如何优化 SQLite WAL 读取性能？\n</USER_REQUEST>',
      },
      {
        step_index: 1,
        type: 'PLANNER_RESPONSE',
        created_at: '2026-11-26T08:00:05Z',
        content: '建议先确认端口和数据库状态：\n```js\nconst db = new DatabaseSync(path, { readOnly: true });\n```',
        tool_calls: [{ name: 'run_command', args: { CommandLine: '"sqlite3 --version && ls -la"' } }],
      },
    ]);

    const allHit = telemetryDb.searchTranscripts(appDataDir, 'SQLite', { scope: 'all' });
    assert.equal(allHit.results.length, 2);
    assert.equal(allHit.results[0].conversationId, 'conv-alpha');
    assert.ok(allHit.results[0].turnSummary.includes('SQLite'));
    assert.equal(allHit.results[0].highlight.match.toLowerCase(), 'sqlite');

    const textOnly = telemetryDb.searchTranscripts(appDataDir, 'DatabaseSync', { scope: 'text' });
    assert.equal(textOnly.results.length, 1);
    assert.equal(textOnly.results[0].kind, 'response');

    const codeOnly = telemetryDb.searchTranscripts(appDataDir, 'sqlite3 --version', { scope: 'code' });
    assert.equal(codeOnly.results.length, 1);
    assert.equal(codeOnly.results[0].kind, 'command');
    assert.equal(codeOnly.results[0].copyText, 'sqlite3 --version && ls -la');

    assert.equal(telemetryDb.searchTranscripts(appDataDir, 'sqlite3 --version', { scope: 'text' }).results.length, 0);
    assert.equal(telemetryDb.searchTranscripts(appDataDir, 'x').results.length, 0); // single ASCII char ignored

    // Path traversal IDs in allowlist are filtered out cleanly
    const safeList = telemetryDb.searchTranscripts(appDataDir, 'DatabaseSync', {
      conversationIds: ['../etc/passwd', 'conv-alpha'],
    });
    assert.equal(safeList.results.length, 1);
  } finally {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 7. Quota Bridge (Dual-Window Normalization + Local Cache Fallback)
 * ========================================================================== */

test('readQuotaSnapshot normalizes dual-window (5h + weekly) groups and falls back to local cache when offline', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-quota-'));
  const cacheFile = path.join(dir, 'quota-cache.json');
  try {
    const now = 1_795_500_000_000;
    const reset5h = now + 3 * 3600_000;
    const resetWeekly = now + 5 * 86400_000;

    const fakeClient = {
      closed: false,
      async evaluate() {
        return {
          cacheAvailable: true,
          fetchedAt: now,
          groups: [
            {
              displayName: 'Gemini Models',
              buckets: [
                { bucketId: 'gemini-5h', window: '5h', remaining: { case: 'remainingFraction', value: 0.82 }, resetTime: { seconds: Math.floor(reset5h / 1000), nanos: 0 } },
                { bucketId: 'gemini-weekly', window: 'weekly', remaining: { case: 'remainingFraction', value: 0.64 }, resetTimeMs: resetWeekly },
              ],
            },
            {
              displayName: 'Claude and GPT models',
              buckets: [
                { bucketId: 'claude-5h', window: '5h', remainingFraction: 0.95, resetTimeMs: reset5h },
                { bucketId: 'claude-weekly', window: 'weekly', remainingFraction: 0.5, resetTimeMs: resetWeekly },
              ],
            },
          ],
        };
      },
      close() { this.closed = true; },
    };

    const live = await quotaBridge.readQuotaSnapshot({
      discover: async () => ({ target: { webSocketDebuggerUrl: 'ws://127.0.0.1:9222/page/1' } }),
      createClient: () => fakeClient,
      cacheFile,
      now: () => now,
    });
    assert.equal(live.online, true);
    assert.equal(live.cached, false);
    assert.equal(live.groups.length, 2);
    assert.equal(live.groups[0].id, 'gemini-pro');
    assert.equal(live.groups[0].windows['5h'].remaining, 82);
    assert.equal(live.groups[0].windows['5h'].resetAt, reset5h);
    assert.equal(live.groups[0].windows.weekly.remaining, 64);
    assert.equal(live.groups[1].id, 'claude');
    assert.equal(live.groups[1].windows['5h'].remaining, 95);
    assert.equal(fakeClient.closed, true);

    // Offline fallback returns cached groups and flags stale after 5 minutes
    const offline = await quotaBridge.readQuotaSnapshot({
      discover: async () => null,
      cacheFile,
      now: () => now + 600_000,
    });
    assert.equal(offline.online, false);
    assert.equal(offline.cached, true);
    assert.equal(offline.stale, true);
    assert.equal(offline.groups.length, 2);
    assert.equal(offline.groups[0].windows.weekly.remaining, 64);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 8. Hidden Subagent Archiving & Lossless Restoration (Safety Guardrails)
 * ========================================================================== */

test('subagent archiver refuses while language_server runs, protects root convs, archives .db/.db-wal/.db-shm trio with manifest, and restores losslessly', () => {
  const appDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-archive-'));
  try {
    telemetryDb.clearTelemetryCaches();
    const rootId = 'root-user-conv';
    const subId = 'hidden-sub-001';

    createConversationDb(appDataDir, rootId, {
      steps: [{ idx: 0, step_type: 14, status: 3 }],
      metaBlob: buildTrajectoryMetaBlob({ rootConversationId: rootId }),
    });
    const subDbPath = createConversationDb(appDataDir, subId, {
      steps: [{ idx: 0, step_type: 101, status: 3 }],
      metaBlob: buildTrajectoryMetaBlob({ parentConversationId: rootId, rootConversationId: rootId, nestingDepth: 1 }),
    });

    // Attach WAL & SHM companions to verify full trio handling
    fs.writeFileSync(`${subDbPath}-wal`, Buffer.from('WAL-DATA-FIXTURE-BYTES'));
    fs.writeFileSync(`${subDbPath}-shm`, Buffer.from('SHM-DATA-FIXTURE-BYTES'));

    // Scan identifies ONLY hidden subagent, never root conversation
    const scan = quotaBridge.scanArchivableSubagents(appDataDir, { isLanguageServerRunning: true });
    assert.equal(scan.languageServerRunning, true);
    assert.equal(scan.totalCount, 1);
    assert.equal(scan.items[0].id, subId);
    assert.deepEqual(scan.items[0].files.sort(), [`${subId}.db`, `${subId}.db-shm`, `${subId}.db-wal`]);

    // Capture exact bytes on disk right before archive to assert 100% lossless byte-for-byte restore
    const originalDbBytes = fs.readFileSync(subDbPath);
    const walContent = fs.readFileSync(`${subDbPath}-wal`);
    const shmContent = fs.readFileSync(`${subDbPath}-shm`);

    // Refuses to archive while language_server is running
    const blocked = quotaBridge.archiveSubagents(appDataDir, [subId], { isLanguageServerRunning: true });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.blocked, true);
    assert.equal(blocked.reason, 'language_server_running');
    assert.match(blocked.message, /language_server/);
    assert.equal(fs.existsSync(subDbPath), true);

    // Protects root conversation even if caller passes rootId
    const rootAttempt = quotaBridge.archiveSubagents(appDataDir, [rootId], { isLanguageServerRunning: false });
    assert.equal(rootAttempt.ok, false);
    assert.equal(fs.existsSync(path.join(appDataDir, 'conversations', `${rootId}.db`)), true);

    // Rejects path traversal IDs
    const evilAttempt = quotaBridge.archiveSubagents(appDataDir, ['../escape'], { isLanguageServerRunning: false });
    assert.equal(evilAttempt.ok, false);
    assert.equal(evilAttempt.reason, 'invalid_id');

    // Archives full trio safely when language_server is stopped
    const archived = quotaBridge.archiveSubagents(appDataDir, [subId, rootId], { isLanguageServerRunning: false });
    assert.equal(archived.ok, true);
    assert.equal(archived.archivedCount, 1);
    assert.deepEqual(archived.skippedIds, [rootId]);
    assert.equal(fs.existsSync(subDbPath), false);
    assert.equal(fs.existsSync(`${subDbPath}-wal`), false);
    assert.equal(fs.existsSync(`${subDbPath}-shm`), false);
    assert.equal(fs.existsSync(path.join(archived.batchDir, 'manifest.json')), true);

    const listed = quotaBridge.listArchiveBatches(appDataDir);
    assert.equal(listed.batches.length, 1);
    assert.equal(listed.batches[0].batchId, archived.batchId);
    assert.equal(listed.batches[0].restorable, true);

    // Refuses restore while language_server is running
    const blockedRestore = quotaBridge.restoreArchiveBatch(appDataDir, archived.batchId, { isLanguageServerRunning: true });
    assert.equal(blockedRestore.ok, false);
    assert.equal(blockedRestore.blocked, true);

    // Lossless restore brings back all 3 files byte-for-byte
    const restored = quotaBridge.restoreArchiveBatch(appDataDir, archived.batchId, { isLanguageServerRunning: false });
    assert.equal(restored.ok, true);
    assert.equal(restored.restoredCount, 1);
    assert.equal(restored.restoredFilesCount, 3);
    assert.deepEqual(fs.readFileSync(subDbPath), originalDbBytes);
    assert.deepEqual(fs.readFileSync(`${subDbPath}-wal`), walContent);
    assert.deepEqual(fs.readFileSync(`${subDbPath}-shm`), shmContent);

    const listedAfter = quotaBridge.listArchiveBatches(appDataDir);
    assert.equal(listedAfter.batches[0].status, 'restored');
    assert.equal(listedAfter.batches[0].restorable, false);
  } finally {
    fs.rmSync(appDataDir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 9. GOMEMLIMIT Strict Whitelist & Debug Port Helpers
 * ========================================================================== */

test('GOMEMLIMIT enforces strict whitelist and uses safe reg.exe argv without shell execution', () => {
  const calls = [];
  let regStore = '';
  const mockRunReg = (args) => {
    calls.push(args);
    if (args[0] === 'query') {
      if (!regStore) return { status: 1, stdout: '', stderr: 'ERROR: unable to find the specified registry key or value.' };
      return { status: 0, stdout: `\r\nHKEY_CURRENT_USER\\Environment\r\n    GOMEMLIMIT    REG_SZ    ${regStore}\r\n`, stderr: '' };
    }
    if (args[0] === 'add') {
      regStore = args[args.indexOf('/d') + 1];
      return { status: 0, stdout: 'The operation completed successfully.', stderr: '' };
    }
    if (args[0] === 'delete') {
      regStore = '';
      return { status: 0, stdout: 'The operation completed successfully.', stderr: '' };
    }
    return { status: 1, stdout: '', stderr: 'unexpected' };
  };

  for (const invalid of ['1GiB', '8GiB', '2GiB & calc.exe', '3000MiB', 'auto', null, 4096]) {
    const res = quotaBridge.setGomemlimit(invalid, { platform: 'win32', runReg: mockRunReg });
    assert.equal(res.ok, false);
    assert.match(res.error, /白名单|非法/);
  }
  assert.equal(calls.length, 0); // invalid presets never invoke reg.exe

  for (const valid of ['2GiB', '2500MiB', '3GiB', '4GiB']) {
    const setRes = quotaBridge.setGomemlimit(valid, { platform: 'win32', runReg: mockRunReg });
    assert.equal(setRes.ok, true);
    assert.equal(setRes.value, valid);
    const status = quotaBridge.getGomemlimitStatus({ platform: 'win32', runReg: mockRunReg, env: {} });
    assert.equal(status.value, valid);
    assert.equal(status.inWhitelist, true);
    assert.equal(status.restartRequired, true);
  }

  const clearRes = quotaBridge.setGomemlimit('', { platform: 'win32', runReg: mockRunReg });
  assert.equal(clearRes.ok, true);
  assert.equal(clearRes.cleared, true);
  assert.equal(quotaBridge.getGomemlimitStatus({ platform: 'win32', runReg: mockRunReg, env: {} }).value, '');
});

test('getDebugPortStatus and ensureDebugPortShortcuts inspect port file and patch sandboxed launchers safely', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-debugport-'));
  try {
    const portFile = path.join(dir, 'DevToolsActivePort');
    fs.writeFileSync(portFile, '45678\n/devtools/browser/abc\n', 'utf8');

    // Linux sandboxed .desktop patching test
    const appsDir = path.join(dir, '.local', 'share', 'applications');
    fs.mkdirSync(appsDir, { recursive: true });
    const desktopFile = path.join(appsDir, 'antigravity.desktop');
    fs.writeFileSync(desktopFile, '[Desktop Entry]\nName=Antigravity\nExec=/usr/bin/antigravity %U\n', 'utf8');

    const before = await quotaBridge.getDebugPortStatus({
      platform: 'linux',
      home: dir,
      env: {},
      portFile,
      listTargets: async (p) => (p === 45678 ? [{ id: '1', type: 'page' }] : []),
    });
    assert.equal(before.ready, true);
    assert.equal(before.port, 45678);
    assert.equal(before.shortcuts.missing, 1);

    const fixed = quotaBridge.ensureDebugPortShortcuts({ platform: 'linux', home: dir, env: {}, sandbox: true });
    assert.equal(fixed.ok, true);
    assert.deepEqual(fixed.updated, [desktopFile]);
    assert.match(fs.readFileSync(desktopFile, 'utf8'), /Exec=\/usr\/bin\/antigravity --remote-debugging-port=0 %U/);

    const secondPass = quotaBridge.ensureDebugPortShortcuts({ platform: 'linux', home: dir, env: {}, sandbox: true });
    assert.equal(secondPass.updated.length, 0);
    assert.equal(secondPass.alreadyConfigured.length, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 10. Safe Git Diff (Boundary Checks, Binary Rejection, Anti-Injection, Truncation)
 * ========================================================================== */

test('getSafeGitDiff returns bounded unified diff, blocks binary/outside/injection inputs, and handles leading-dash filenames', () => {
  const rootTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-gitdiff-'));
  const repoDir = path.join(rootTmp, 'repo');
  const outsideFile = path.join(rootTmp, 'outside.txt');
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(outsideFile, 'not in git\n', 'utf8');

  const git = (args) => {
    const r = spawnSync('git', args, { cwd: repoDir, encoding: 'utf8', windowsHide: true });
    assert.equal(r.status, 0, `git ${args.join(' ')} failed: ${r.stderr}`);
  };

  try {
    git(['init']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);

    const tracked = path.join(repoDir, 'hello.js');
    const dashFile = path.join(repoDir, '-weird.txt');
    fs.writeFileSync(tracked, 'line1\nline2\nline3\n', 'utf8');
    fs.writeFileSync(dashFile, 'before\n', 'utf8');
    git(['add', '--', 'hello.js', './-weird.txt']);
    git(['commit', '-m', 'init']);

    // Modify tracked file & leading-dash file
    fs.writeFileSync(tracked, 'line1\nline2-edited\nline3\nline4-added\n', 'utf8');
    fs.writeFileSync(dashFile, 'after\n', 'utf8');

    const diffRes = quotaBridge.getSafeGitDiff(tracked);
    assert.equal(diffRes.ok, true);
    assert.equal(diffRes.inRepo, true);
    assert.equal(diffRes.isBinary, false);
    assert.equal(diffRes.hasChanges, true);
    assert.equal(diffRes.additions, 2);
    assert.equal(diffRes.deletions, 1);
    assert.match(diffRes.diff, /\+line2-edited/);
    assert.match(diffRes.diff, /\+line4-added/);

    // Leading-dash filename handled safely via --literal-pathspecs & -- ./-weird.txt
    const dashRes = quotaBridge.getSafeGitDiff(dashFile);
    assert.equal(dashRes.ok, true);
    assert.equal(dashRes.additions, 1);
    assert.equal(dashRes.deletions, 1);

    // Untracked file preview works and respects truncation limits
    const bigUntracked = path.join(repoDir, 'big.txt');
    fs.writeFileSync(bigUntracked, Array.from({ length: 120 }, (_, i) => `row-${i}`).join('\n') + '\n', 'utf8');
    const truncRes = quotaBridge.getSafeGitDiff(bigUntracked, { maxLines: 25 });
    assert.equal(truncRes.ok, true);
    assert.equal(truncRes.untracked, true);
    assert.equal(truncRes.truncated, true);
    assert.equal(truncRes.additions, 120);

    // Rejects binary extension and NUL-byte content
    const pngFile = path.join(repoDir, 'img.png');
    fs.writeFileSync(pngFile, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
    assert.equal(quotaBridge.getSafeGitDiff(pngFile).isBinary, true);

    const nulText = path.join(repoDir, 'fake.txt');
    fs.writeFileSync(nulText, Buffer.from([0x61, 0x62, 0x00, 0x63]));
    assert.equal(quotaBridge.getSafeGitDiff(nulText).isBinary, true);

    // Rejects file outside git repository
    const outRes = quotaBridge.getSafeGitDiff(outsideFile);
    assert.equal(outRes.ok, false);
    assert.equal(outRes.inRepo, false);

    // Rejects argument injection strings and NUL bytes
    assert.equal(quotaBridge.getSafeGitDiff('--output=/tmp/evil').ok, false);
    assert.equal(quotaBridge.getSafeGitDiff(`${tracked}\0--evil`).ok, false);
    assert.equal(quotaBridge.getSafeGitDiff(path.join(repoDir, 'missing.txt')).ok, false);
  } finally {
    fs.rmSync(rootTmp, { recursive: true, force: true });
  }
});
