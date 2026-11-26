'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const updater = require('../src/domain/plugin-updater.cjs');

/* ---------------- Minimal Stored-Mode PKZIP Builder for Real Zip-Slip Tests ---------------- */

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
  }
  return (c ^ 0xffffffff) >>> 0;
}

function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const { name, content } of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const dataBuf = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const crc = crc32(dataBuf);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // store
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBuf, dataBuf);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(dataBuf.length, 20);
    central.writeUInt32LE(dataBuf.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBuf);

    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const cdBuf = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, cdBuf, eocd]);
}

function makeResponse({ status = 200, json = null, buffer = null, headers = {} } = {}) {
  const hdrs = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v)]));
  const bodyBuf = buffer
    ? (Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
    : (json !== null ? Buffer.from(JSON.stringify(json), 'utf8') : Buffer.alloc(0));
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (k) => hdrs.get(String(k).toLowerCase()) ?? null },
    async json() {
      return JSON.parse(bodyBuf.toString('utf8'));
    },
    async arrayBuffer() {
      return bodyBuf.buffer.slice(bodyBuf.byteOffset, bodyBuf.byteOffset + bodyBuf.byteLength);
    },
    async text() {
      return bodyBuf.toString('utf8');
    },
  };
}

function seedInstalledPlugin(targetDir, version = '0.4.0') {
  fs.mkdirSync(path.join(targetDir, 'sidecars', 'star-suite'), { recursive: true });
  fs.writeFileSync(
    path.join(targetDir, 'plugin.json'),
    JSON.stringify({ name: 'antigravity-star-suite', version }),
    'utf8'
  );
  fs.writeFileSync(
    path.join(targetDir, 'sidecars', 'star-suite', 'main.mjs'),
    `// old version ${version}\n`,
    'utf8'
  );
}

/* ==========================================================================
 * 1. SemVer Comparison Tests
 * ========================================================================== */

test('compareSemver handles v-prefix, numeric ordering, prerelease precedence, and rejects invalid strings', () => {
  assert.equal(updater.compareSemver('v0.4.0', '0.4.0'), 0);
  assert.equal(updater.compareSemver('0.4.0', 'v0.4.1'), -1);
  assert.equal(updater.compareSemver('v0.10.0', 'v0.4.9'), 1);
  assert.equal(updater.compareSemver('1.0.0-alpha.1', '1.0.0'), -1);
  assert.equal(updater.compareSemver('1.0.0', '1.0.0-rc.1'), 1);
  assert.equal(updater.compareSemver('1.0.0-beta.2', '1.0.0-beta.10'), -1);
  assert.equal(updater.compareSemver('1.0.0-alpha', '1.0.0-alpha.1'), -1);
  assert.equal(updater.compareSemver('1.0.0-1', '1.0.0-alpha'), -1);
  assert.equal(updater.compareSemver('1.0.0+build.123', '1.0.0+build.456'), 0);
  assert.throws(() => updater.compareSemver('not-a-ver', '0.4.0'), /Invalid SemVer/);
});

/* ==========================================================================
 * 2. checkForPluginUpdate Tests
 * ========================================================================== */

test('checkForPluginUpdate selects plugin zip asset, respects cache TTL and force flag, and rejects invalid repos', async () => {
  updater.clearUpdateCheckCache();
  let calls = 0;
  let nowMs = 1_795_700_000_000;

  const mockFetch = async (url) => {
    calls++;
    assert.equal(url, 'https://api.github.com/repos/Fish-under-sea/Antigravity-maomao/releases/latest');
    return makeResponse({
      status: 200,
      json: {
        tag_name: 'v0.4.2',
        body: '## Highlights\n- In-plugin updater',
        html_url: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/tag/v0.4.2',
        published_at: '2026-11-26T10:00:00Z',
        assets: [
          { name: 'checksums.txt', size: 128, browser_download_url: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.2/checksums.txt' },
          { name: 'antigravity-maomao-plugin-v0.4.2.zip', size: 123456, browser_download_url: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.2/antigravity-maomao-plugin-v0.4.2.zip' },
        ],
      },
    });
  };

  const first = await updater.checkForPluginUpdate({
    currentVersion: '0.4.0',
    fetchImpl: mockFetch,
    now: () => nowMs,
  });
  assert.equal(first.currentVersion, '0.4.0');
  assert.equal(first.latestVersion, '0.4.2');
  assert.equal(first.hasUpdate, true);
  assert.equal(first.assetName, 'antigravity-maomao-plugin-v0.4.2.zip');
  assert.equal(first.assetSize, 123456);
  assert.match(first.downloadUrl, /^https:\/\/github\.com\//);
  assert.equal(calls, 1);

  // Cached within TTL
  nowMs += 60_000;
  const second = await updater.checkForPluginUpdate({
    currentVersion: '0.4.0',
    fetchImpl: mockFetch,
    now: () => nowMs,
  });
  assert.equal(second.latestVersion, '0.4.2');
  assert.equal(calls, 1);

  // Force bypasses cache
  await updater.checkForPluginUpdate({
    currentVersion: '0.4.0',
    fetchImpl: mockFetch,
    force: true,
    now: () => nowMs,
  });
  assert.equal(calls, 2);

  // Rejects path-injected repo
  await assert.rejects(
    updater.checkForPluginUpdate({ currentVersion: '0.4.0', repo: 'evil/repo/../other', fetchImpl: mockFetch }),
    /非法 GitHub 仓库标识/
  );
});

/* ==========================================================================
 * 3. Domain Whitelist, Redirect SSRF & Size-Cap Blocking Tests
 * ========================================================================== */

test('downloadAndInstallUpdate enforces strict HTTPS domain whitelist, redirect checks, and maxBytes cap', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-upd-sec-'));
  const targetDir = path.join(tmp, 'antigravity-star-suite');
  seedInstalledPlugin(targetDir, '0.4.0');

  try {
    const blockedUrls = [
      'http://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.1/plugin.zip',
      'https://evil.example.com/plugin.zip',
      'https://github.com.evil.com/plugin.zip',
      'https://127.0.0.1/plugin.zip',
      'https://localhost/plugin.zip',
      'https://user:pass@github.com/a/b.zip',
      'file:///C:/Windows/System32/cmd.exe',
    ];
    for (const badUrl of blockedUrls) {
      await assert.rejects(
        updater.downloadAndInstallUpdate({
          downloadUrl: badUrl,
          targetDir,
          tempRoot: tmp,
          fetchImpl: async () => { throw new Error('should not fetch'); },
        }),
        /仅允许 HTTPS|白名单|禁止|非法/
      );
    }

    // Redirect to non-whitelisted host must be blocked
    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.1/plugin.zip',
        targetDir,
        tempRoot: tmp,
        fetchImpl: async () => makeResponse({ status: 302, headers: { location: 'https://169.254.169.254/latest/meta-data/' } }),
      }),
      /禁止访问本地或 IP|白名单/
    );

    // Oversized download rejected
    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://objects.githubusercontent.com/pkg/plugin.zip',
        targetDir,
        tempRoot: tmp,
        maxBytes: 32,
        fetchImpl: async () => makeResponse({ status: 200, buffer: Buffer.alloc(64, 0x41) }),
      }),
      /超过安全上限/
    );

    // Existing installation remains completely untouched
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version, '0.4.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 4. Zip-Slip Rejection & Invalid Package Rollback Tests
 * ========================================================================== */

test('downloadAndInstallUpdate blocks Zip-Slip archives before extraction and keeps existing plugin intact', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-upd-slip-'));
  const targetDir = path.join(tmp, 'antigravity-star-suite');
  seedInstalledPlugin(targetDir, '0.4.0');

  try {
    const evilZip = createStoredZip([
      { name: '../../evil-escape.txt', content: 'pwned' },
      { name: 'plugin.json', content: JSON.stringify({ name: 'antigravity-star-suite', version: '0.4.5' }) },
    ]);

    let extractCalled = false;
    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://release-assets.githubusercontent.com/evil.zip',
        targetDir,
        tempRoot: tmp,
        fetchImpl: async () => makeResponse({ status: 200, buffer: evilZip }),
        extractZip: async () => { extractCalled = true; },
      }),
      /Zip-Slip/
    );
    assert.equal(extractCalled, false);
    assert.equal(fs.existsSync(path.join(tmp, 'evil-escape.txt')), false);
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version, '0.4.0');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('downloadAndInstallUpdate rejects invalid package manifest/entrypoint without damaging existing install', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-upd-invalid-'));
  const targetDir = path.join(tmp, 'antigravity-star-suite');
  seedInstalledPlugin(targetDir, '0.4.0');

  try {
    // Wrong plugin name
    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.1/wrong.zip',
        targetDir,
        tempRoot: tmp,
        fetchImpl: async () => makeResponse({ status: 200, buffer: Buffer.from('stub-zip') }),
        extractZip: async (_zip, dst) => {
          fs.writeFileSync(path.join(dst, 'plugin.json'), JSON.stringify({ name: 'other-plugin', version: '0.4.1' }));
        },
      }),
      /插件标识不匹配/
    );

    // Missing sidecars/star-suite/main.mjs
    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.1/incomplete.zip',
        targetDir,
        tempRoot: tmp,
        fetchImpl: async () => makeResponse({ status: 200, buffer: Buffer.from('stub-zip') }),
        extractZip: async (_zip, dst) => {
          fs.writeFileSync(path.join(dst, 'plugin.json'), JSON.stringify({ name: 'antigravity-star-suite', version: '0.4.1' }));
        },
      }),
      /缺少核心入口/
    );

    // Existing installation must still be v0.4.0 intact
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version, '0.4.0');
    assert.match(fs.readFileSync(path.join(targetDir, 'sidecars', 'star-suite', 'main.mjs'), 'utf8'), /old version 0\.4\.0/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 5. Full Real-ZIP Backup & Atomic Replacement Test (incl. Redirect)
 * ========================================================================== */

test('downloadAndInstallUpdate downloads real ZIP via whitelisted redirect, extracts, swaps atomically, and cleans up backup/temp', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-upd-ok-'));
  const targetDir = path.join(tmp, 'antigravity-star-suite');
  seedInstalledPlugin(targetDir, '0.4.0');

  try {
    const validZip = createStoredZip([
      {
        name: 'antigravity-maomao-plugin-v0.4.3/plugin.json',
        content: JSON.stringify({ name: 'antigravity-star-suite', display_name: '喵言喵语', version: '0.4.3' }),
      },
      {
        name: 'antigravity-maomao-plugin-v0.4.3/sidecars/star-suite/main.mjs',
        content: '// upgraded version 0.4.3\nexport const upgraded = true;\n',
      },
      {
        name: 'antigravity-maomao-plugin-v0.4.3/README.md',
        content: '# Upgraded 0.4.3\n',
      },
    ]);

    const seenUrls = [];
    const mockFetch = async (url) => {
      seenUrls.push(url);
      if (url.startsWith('https://github.com/')) {
        return makeResponse({
          status: 302,
          headers: { location: 'https://objects.githubusercontent.com/releases/antigravity-maomao-plugin-v0.4.3.zip' },
        });
      }
      return makeResponse({ status: 200, buffer: validZip });
    };

    const res = await updater.downloadAndInstallUpdate({
      downloadUrl: 'https://github.com/Fish-under-sea/Antigravity-maomao/releases/download/v0.4.3/antigravity-maomao-plugin-v0.4.3.zip',
      targetDir,
      tempRoot: tmp,
      fetchImpl: mockFetch,
    });

    assert.deepEqual(res, {
      ok: true,
      fromVersion: '0.4.0',
      toVersion: '0.4.3',
      targetDir,
    });
    assert.equal(seenUrls.length, 2);
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version, '0.4.3');
    assert.match(fs.readFileSync(path.join(targetDir, 'sidecars', 'star-suite', 'main.mjs'), 'utf8'), /upgraded version 0\.4\.3/);

    // Verify no leftover backup/stage/temp directories remain
    const leftovers = fs.readdirSync(tmp).filter((n) => n !== 'antigravity-star-suite');
    assert.deepEqual(leftovers, []);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('downloadAndInstallUpdate automatically rolls back backup if swap fails mid-install', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-upd-rollback-'));
  const targetDir = path.join(tmp, 'antigravity-star-suite');
  seedInstalledPlugin(targetDir, '0.4.0');

  try {
    const validZip = createStoredZip([
      { name: 'plugin.json', content: JSON.stringify({ name: 'antigravity-star-suite', version: '0.4.9' }) },
      { name: 'sidecars/star-suite/main.mjs', content: '// v0.4.9\n' },
    ]);

    await assert.rejects(
      updater.downloadAndInstallUpdate({
        downloadUrl: 'https://objects.githubusercontent.com/pkg/v0.4.9.zip',
        targetDir,
        tempRoot: tmp,
        fetchImpl: async () => makeResponse({ status: 200, buffer: validZip }),
        _afterBackupHook: async () => {
          throw new Error('simulated mid-swap IO failure');
        },
      }),
      /simulated mid-swap IO failure/
    );

    // Backup MUST have been automatically restored to v0.4.0
    assert.equal(JSON.parse(fs.readFileSync(path.join(targetDir, 'plugin.json'), 'utf8')).version, '0.4.0');
    assert.match(fs.readFileSync(path.join(targetDir, 'sidecars', 'star-suite', 'main.mjs'), 'utf8'), /old version 0\.4\.0/);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

/* ==========================================================================
 * 6. Local & Remote i18n Override Dict Loading & Model/Effort Red-Line Guard
 * ========================================================================== */

test('loadI18nOverrideDict and syncRemoteI18nDict filter protected model/effort terms, enforce whitelist, and degrade gracefully on 404/offline', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'maomao-i18n-ovr-'));
  const dictFile = path.join(tmp, 'i18n-override.json');

  try {
    // Missing file degrades cleanly to {}
    assert.deepEqual(updater.loadI18nOverrideDict(dictFile), {});

    // Corrupt JSON degrades cleanly to {}
    fs.writeFileSync(dictFile, '{broken-json', 'utf8');
    assert.deepEqual(updater.loadI18nOverrideDict(dictFile), {});

    // Local dictionary filters out protected model names, effort labels, oversized keys, and prototype keys
    fs.writeFileSync(
      dictFile,
      JSON.stringify({
        'New Feature Button': '新功能按钮',
        'Gemini 4 Neon': '绝不允许汉化',
        'Gemini 4 Neon (XHigh)': '绝不允许汉化',
        'Claude Sonnet 4.5': '绝不允许汉化',
        'Orchestrator': '绝不允许汉化',
        'Extra High': '绝不允许汉化',
        'High': '绝不允许汉化',
        'Medium': '绝不允许汉化',
        'Low': '绝不允许汉化',
        'Auto': '绝不允许汉化',
        ['k'.repeat(140)]: '超长键应过滤',
        'Valid Patch': '合法补丁',
      }),
      'utf8'
    );
    const loaded = updater.loadI18nOverrideDict(dictFile);
    assert.deepEqual(loaded, {
      'New Feature Button': '新功能按钮',
      'Valid Patch': '合法补丁',
    });

    // Reject non-whitelisted / non-HTTPS URLs strictly
    await assert.rejects(
      updater.syncRemoteI18nDict({
        url: 'http://raw.githubusercontent.com/Fish-under-sea/Antigravity-maomao/main/i18n.json',
        filePath: dictFile,
        fetchImpl: async () => makeResponse({ status: 200, json: {} }),
      }),
      /仅允许 HTTPS/
    );
    await assert.rejects(
      updater.syncRemoteI18nDict({
        url: 'https://evil.example.com/i18n.json',
        filePath: dictFile,
        fetchImpl: async () => makeResponse({ status: 200, json: {} }),
      }),
      /白名单/
    );

    // Graceful degradation on 404 returns existing local sanitized dict without throwing
    const degraded404 = await updater.syncRemoteI18nDict({
      url: 'https://raw.githubusercontent.com/Fish-under-sea/Antigravity-maomao/main/i18n-override.json',
      filePath: dictFile,
      fetchImpl: async () => makeResponse({ status: 404 }),
    });
    assert.equal(degraded404.ok, true);
    assert.equal(degraded404.degraded, true);
    assert.equal(degraded404.source, 'local');
    assert.deepEqual(degraded404.dict, loaded);

    // Graceful degradation on network error returns local dict without throwing
    const degradedNet = await updater.syncRemoteI18nDict({
      url: 'https://raw.githubusercontent.com/Fish-under-sea/Antigravity-maomao/main/i18n-override.json',
      filePath: dictFile,
      fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    });
    assert.equal(degradedNet.ok, true);
    assert.equal(degradedNet.degraded, true);
    assert.deepEqual(degradedNet.dict, loaded);

    // Successful remote sync filters protected terms and writes atomically to disk
    const synced = await updater.syncRemoteI18nDict({
      url: 'https://raw.githubusercontent.com/Fish-under-sea/Antigravity-maomao/main/i18n-override.json',
      filePath: dictFile,
      fetchImpl: async () => makeResponse({
        status: 200,
        json: {
          'Sync Now': '立即同步',
          'Gemini 4 Hydrogen': '禁止翻译',
          'Extra High': '禁止翻译',
          'Reload Interface': '重载界面',
        },
      }),
    });
    assert.equal(synced.ok, true);
    assert.equal(synced.degraded, false);
    assert.equal(synced.source, 'remote');
    assert.deepEqual(synced.dict, {
      'Sync Now': '立即同步',
      'Reload Interface': '重载界面',
    });
    assert.deepEqual(updater.loadI18nOverrideDict(dictFile), synced.dict);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
