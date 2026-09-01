// =============================================================
// 古韵抽卡 v3.1 · storage-dialog 纯逻辑测试
//
// 运行:  node scripts/test-storage-dialog.mjs
//
// 覆盖:
//   - snapshotForExport:三键齐全 + app tag + 时间戳
//   - parseSnapshot:坏 JSON / 错 app / 错版本 / 缺字段
//   - mergeImport:favorites 去重(较新 favoritedAt 胜);history 追加;stats 覆盖
// =============================================================

import {
  snapshotForExport, parseSnapshot, mergeImport,
} from '../src/ui/storage-dialog.js';

// 注:downloadSnapshot / readFileAsText 走 Blob/FileReader,不在 node 测范围。

let passed = 0, failed = 0;
const failures = [];
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) { passed++; return; }
  failed++;
  failures.push({ label, actual: JSON.stringify(actual), expected: JSON.stringify(expected) });
}
function truthy(v, label) {
  if (v) { passed++; return; }
  failed++;
  failures.push({ label, actual: String(v), expected: 'truthy' });
}
function throws(fn, msg, label) {
  try { fn(); failed++; failures.push({ label, actual: 'no throw', expected: msg }); }
  catch (e) {
    if (e.message.includes(msg)) { passed++; return; }
    failed++;
    failures.push({ label, actual: e.message, expected: msg });
  }
}

function makeMemStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
  };
}

// ── 1. snapshotForExport ─────────────────────────────────
{
  const ls = makeMemStorage();
  ls.setItem('pc_v3_favorites', JSON.stringify({ version: 1, items: [{ id: 1, title: 'A', favoritedAt: 100 }] }));
  ls.setItem('pc_v3_history',   JSON.stringify({ version: 1, items: [{ id: 1, title: 'A', drawnAt: 200 }] }));
  ls.setItem('pc_v3_stats_meta', JSON.stringify({ version: 1, totalDraws: 5, todayDraws: 1, todayKey: '2026-09-01', dynastyCounter: {}, imageryCounter: {} }));

  const s = snapshotForExport(ls);
  eq(s.app, 'poetry-cards-v3.1-backup', 'snapshotForExport: app tag');
  eq(s.schemaVersion, 1, 'snapshotForExport: schemaVersion=1');
  truthy(typeof s.exportedAt === 'string' && s.exportedAt.length > 0, 'snapshotForExport: exportedAt 非空');
  eq(s.favorites.items.length, 1, 'snapshotForExport: favorites 1 条');
  eq(s.history.items.length,   1, 'snapshotForExport: history 1 条');
  eq(s.statsMeta.totalDraws,   5, 'snapshotForExport: stats 完整');

  // 缺某 key → 返回空 schema,不抛
  const ls2 = makeMemStorage();
  const s2 = snapshotForExport(ls2);
  eq(s2.favorites.items, [], 'snapshotForExport: 缺数据 → 默认空 schema');
  eq(s2.history.items,   [], 'snapshotForExport: 缺数据 → history 默认空');
}

// ── 2. parseSnapshot 校验 ────────────────────────────────
{
  throws(() => parseSnapshot(''), '合法 JSON', 'parseSnapshot: 空串');
  throws(() => parseSnapshot('not json'), '合法 JSON', 'parseSnapshot: 坏 JSON');
  throws(() => parseSnapshot('123'), '不是对象', 'parseSnapshot: 不是对象');
  throws(() => parseSnapshot('{}'), '古韵抽卡备份', 'parseSnapshot: 缺 app');
  throws(() => parseSnapshot('{"app":"other"}'), '古韵抽卡备份', 'parseSnapshot: 错 app');
  throws(() => parseSnapshot('{"app":"poetry-cards-v3.1-backup","schemaVersion":99}'), '不兼容', 'parseSnapshot: 版本错');
  throws(() => parseSnapshot('{"app":"poetry-cards-v3.1-backup","schemaVersion":1}'), '备份字段缺失', 'parseSnapshot: 缺 favorites');

  // 正常
  const ok = {
    app: 'poetry-cards-v3.1-backup', schemaVersion: 1,
    favorites: { version: 1, items: [] },
    history:   { version: 1, items: [] },
    statsMeta: { version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} },
  };
  const r = parseSnapshot(JSON.stringify(ok));
  eq(r.favorites, ok.favorites, 'parseSnapshot: 正常解析 favorites');
}

// ── 3. mergeImport:合并收藏(按 id,较新 favoritedAt 胜)──
{
  const ls = makeMemStorage();
  ls.setItem('pc_v3_favorites', JSON.stringify({
    version: 1,
    items: [
      { id: 1, title: 'A-old', favoritedAt: 100 },
      { id: 2, title: 'B',    favoritedAt: 200 },
    ],
  }));
  ls.setItem('pc_v3_history', JSON.stringify({ version: 1, items: [] }));
  ls.setItem('pc_v3_stats_meta', JSON.stringify({ version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} }));

  const snap = {
    app: 'poetry-cards-v3.1-backup', schemaVersion: 1,
    favorites: { version: 1, items: [
      { id: 1, title: 'A-new', favoritedAt: 500 },     // 较新 → 覆盖
      { id: 3, title: 'C-new', favoritedAt: 300 },     // 新增
    ] },
    history:   { version: 1, items: [{ id: 10, title: 'H', drawnAt: 1000 }] },
    statsMeta: { version: 1, totalDraws: 99, todayDraws: 5, todayKey: '2026-09-01', dynastyCounter: { '唐': 50 }, imageryCounter: {} },
  };

  const r = mergeImport(ls, snap);
  eq(r.addedFav, 2, 'mergeImport: addedFav=2(A 覆盖 + C 新增)');
  eq(r.addedHist, 1, 'mergeImport: addedHist=1');
  eq(r.statsReset, true, 'mergeImport: statsReset=true');

  const newFav = JSON.parse(ls.getItem('pc_v3_favorites'));
  // 期望 3 条(2 已有 + 1 新增);id=1 应是新版(A-new);按 favoritedAt 降序
  eq(newFav.items.length, 3, 'mergeImport: 收藏总数 3');
  eq(newFav.items[0].id, 1, 'mergeImport: 最新 favoritedAt 在前');
  eq(newFav.items[0].title, 'A-new', 'mergeImport: 较新 favoritedAt 胜');

  const newHist = JSON.parse(ls.getItem('pc_v3_history'));
  eq(newHist.items.length, 1, 'mergeImport: history 1 条');

  const newStats = JSON.parse(ls.getItem('pc_v3_stats_meta'));
  eq(newStats.totalDraws, 99, 'mergeImport: statsMeta totalDraws 覆盖');
}

// ── 4. mergeImport:较旧 favoritedAt 不覆盖 ─────────────
{
  const ls = makeMemStorage();
  ls.setItem('pc_v3_favorites', JSON.stringify({
    version: 1, items: [{ id: 1, title: 'A-new', favoritedAt: 500 }],
  }));
  ls.setItem('pc_v3_history', JSON.stringify({ version: 1, items: [] }));
  ls.setItem('pc_v3_stats_meta', JSON.stringify({ version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} }));

  const snap = {
    app: 'poetry-cards-v3.1-backup', schemaVersion: 1,
    favorites: { version: 1, items: [{ id: 1, title: 'A-stale', favoritedAt: 100 }] }, // 较旧
    history:   { version: 1, items: [] },
    statsMeta: { version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} },
  };
  mergeImport(ls, snap);
  const newFav = JSON.parse(ls.getItem('pc_v3_favorites'));
  eq(newFav.items[0].title, 'A-new', 'mergeImport: 较旧 favoritedAt 不覆盖');
}

// ── 5. mergeImport:history 同 id+同 drawnAt 视为重复 ───
{
  const ls = makeMemStorage();
  ls.setItem('pc_v3_favorites', JSON.stringify({ version: 1, items: [] }));
  ls.setItem('pc_v3_history', JSON.stringify({
    version: 1, items: [{ id: 10, title: 'H', drawnAt: 1000 }],
  }));
  ls.setItem('pc_v3_stats_meta', JSON.stringify({ version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} }));

  const snap = {
    app: 'poetry-cards-v3.1-backup', schemaVersion: 1,
    favorites: { version: 1, items: [] },
    history: { version: 1, items: [
      { id: 10, title: 'H', drawnAt: 1000 },   // 重复
      { id: 11, title: 'I', drawnAt: 1100 },   // 新增
    ] },
    statsMeta: { version: 1, totalDraws: 0, todayDraws: 0, todayKey: '', dynastyCounter: {}, imageryCounter: {} },
  };
  const r = mergeImport(ls, snap);
  eq(r.addedHist, 1, 'mergeImport: history 重复 id+时间戳不重复加');
  const newHist = JSON.parse(ls.getItem('pc_v3_history'));
  eq(newHist.items.length, 2, 'mergeImport: history 最终 2 条');
}

// ── 汇总 ────────────────────────────────────────────────
const total = passed + failed;
console.log(`\n[test-storage-dialog] ${passed}/${total} 通过`);
if (failed) {
  console.error(`\n[test-storage-dialog] ${failed} 失败:`);
  for (const f of failures) {
    console.error(`  ✗ ${f.label}`);
    console.error(`    实际: ${f.actual}`);
    console.error(`    期望: ${f.expected}`);
  }
  process.exit(1);
}
console.log('[test-storage-dialog] 全部通过 ✅');