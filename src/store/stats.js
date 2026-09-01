// =============================================================
// 古韵抽卡 v3.2.7 · 双源 stats store
// 职责:4 个数字并存
//   - totalDraws / todayDraws  → 走 statsMeta(累加,localStorage 持久化)
//   - topDynasties / topImagery → 走 favorites 实时计算
//
// 数据源策略:
//   - 累计/今日 数字 必须「每次抽卡都 +1」,因为这是「使用频率」指标;
//     用过 v3.1 累加型 schema(statsMeta),自然持久,跨日靠 rolloverIfNeeded。
//   - 朝代/意象 必须是「用户主动喜欢」,所以从 favorites 实时聚合;
//     取消收藏立刻从统计消失。
//
// 与 main.js 的接口:
//   stats.onDraw(poem, themes)   // 累加 totalDraws / todayDraws(不入朝代/意象 counter)
//   stats.reset()                // 清零 statsMeta + 清空 favorites
//   stats.snapshot()             // 4 个数字一起返回
//
// 旧 favoritesStats(v3.2.5~v3.2.6)已废弃,本模块取代之。
// =============================================================

import {
  KEY, DEFAULTS, parseSafe, dump, rolloverIfNeeded, normalizePoem,
} from './schema.js';

/**
 * 工厂:接收 storage 适配器 + favoritesStore(都必填)。
 *  - storage:写 totalDraws / todayDraws(statsMeta)
//  - favoritesStore:读 list() 算朝代/意象 TOP
 */
export function createStatsStore(storage, favoritesStore) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('createStatsStore 需要一个 storage 适配器');
  }
  if (!favoritesStore || typeof favoritesStore.list !== 'function') {
    throw new TypeError('createStatsStore 需要一个 favoritesStore');
  }

  // ── 累计 / 今日 数字(persisted)──────────────────────────
  function load() {
    const raw = parseSafe(storage.getItem(KEY.statsMeta), DEFAULTS.statsMeta);
    // 兜底:老 schema 残留或脏数据 → 字段类型修正
    if (typeof raw.totalDraws !== 'number') raw.totalDraws = 0;
    if (typeof raw.todayDraws !== 'number') raw.todayDraws = 0;
    if (typeof raw.todayKey !== 'string')   raw.todayKey   = '';
    return raw;
  }

  function save(meta) {
    storage.setItem(KEY.statsMeta, dump(meta));
  }

  function summary() {
    const m = load();
    return {
      totalDraws: m.totalDraws,
      todayDraws: m.todayDraws,
      todayKey:   m.todayKey,
    };
  }

  /**
   * 记录一次成功抽卡(主流程唯一入口)。
   * 只累加 totalDraws / todayDraws;朝代/意象不在此写入(它们从 favorites 实时算)。
   * @param {object} poem   保留参数,目前未用(预留:以后想做「按抽卡来源拆」)
   * @param {string[]} themes 保留参数,目前未用
   */
  function onDraw(poem, themes = []) {
    const meta = load();
    rolloverIfNeeded(meta);
    meta.totalDraws += 1;
    meta.todayDraws += 1;
    save(meta);
    return summary();
  }

  // ── 朝代 / 意象:从 favorites 实时算 ────────────────────
  function tally(items) {
    const dynastyCounter = {};
    const imageryCounter = {};
    for (const it of items) {
      if (it.dynasty) {
        dynastyCounter[it.dynasty] = (dynastyCounter[it.dynasty] || 0) + 1;
      }
    }
    return { dynastyCounter, imageryCounter };
  }

  function topN(obj, n) {
    return Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));
  }

  function topDynasties(n = 5) {
    return topN(tally(favoritesStore.list()).dynastyCounter, n);
  }
  function topImagery(n = 5) {
    return topN(tally(favoritesStore.list()).imageryCounter, n);
  }

  // ── 整体快照(UI 渲染用) ───────────────────────────────
  function snapshot() {
    const s = summary();
    return {
      totalDraws: s.totalDraws,
      todayDraws: s.todayDraws,
      totalFavorites: favoritesStore.size(),  // v3.2.8:收藏总数,来自 favorites
      topDynasties: topDynasties(5),
      topImagery: topImagery(5),
    };
  }

  // ── 重置:清零 statsMeta + 清空 favorites ─────────────
  function reset() {
    save(DEFAULTS.statsMeta());
    favoritesStore.clear();
  }

  return {
    summary, onDraw,
    topDynasties, topImagery,
    snapshot, reset,
  };
}