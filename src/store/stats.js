// =============================================================
// 古韵抽卡 v3.1 · stats store
// 职责:累计抽卡 / 今日抽卡 / 朝代分布 / 意象分布
//
// 写入时机:drawNew 成功渲染明信片后,由 main.js 显式调用 onDraw(poem, themes)
// 跨日归零:rolloverIfNeeded 在每次 onDraw 内自动处理
//
// 依赖:仅 store/schema.js(避免环依赖)
// =============================================================

import {
  KEY, DEFAULTS, parseSafe, dump, rolloverIfNeeded, normalizePoem,
} from './schema.js';

/**
 * 工厂:接收一个 storage 适配器(ls-like:getItem/setItem),
 * 返回 stats 模块的 4 个方法 + 一个 get 函数。
 *
 * 这种「注入依赖」的写法让单测可以塞一个 Map 适配器,无须碰 localStorage。
 */
export function createStatsStore(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('createStatsStore 需要一个 storage 适配器');
  }

  function load() {
    const raw = parseSafe(storage.getItem(KEY.statsMeta), DEFAULTS.statsMeta);
    // 兜底:老 schema 残留或脏数据 → 字段类型修正(不丢整个对象)
    if (typeof raw.totalDraws !== 'number') raw.totalDraws = 0;
    if (typeof raw.todayDraws !== 'number') raw.todayDraws = 0;
    if (typeof raw.todayKey !== 'string')   raw.todayKey   = '';
    if (!raw.dynastyCounter || typeof raw.dynastyCounter !== 'object') raw.dynastyCounter = {};
    if (!raw.imageryCounter || typeof raw.imageryCounter !== 'object') raw.imageryCounter = {};
    // 脏 key 清洗:"[object Object]"(老 schema 把 {id,name} 整体 String 化)
    for (const k of Object.keys(raw.dynastyCounter)) {
      if (typeof raw.dynastyCounter[k] !== 'number' || k === '[object Object]' || !k.trim()) {
        delete raw.dynastyCounter[k];
      }
    }
    for (const k of Object.keys(raw.imageryCounter)) {
      if (typeof raw.imageryCounter[k] !== 'number' || k === '[object Object]' || !k.trim()) {
        delete raw.imageryCounter[k];
      }
    }
    return raw;
  }

  function save(meta) {
    storage.setItem(KEY.statsMeta, dump(meta));
  }

  return {
    /** 读取当前快照(返回深拷贝,避免外部改原对象) */
    get() {
      const m = load();
      return {
        ...m,
        dynastyCounter:  { ...m.dynastyCounter },
        imageryCounter:  { ...m.imageryCounter },
      };
    },

    /**
     * 记录一次成功抽卡(主流程唯一入口)。
     * 内部 normalizePoem 把 {id,name} → name 字符串,避免 [object Object] 写入 counter。
     * @param {object} poem
     * @param {string[]} themes  images.js#extractThemes 的输出(top 2 主题词)
     * @returns {object} 更新后的快照
     */
    onDraw(poem, themes = []) {
      const meta = load();
      rolloverIfNeeded(meta);                          // 跨日自动归零
      meta.totalDraws += 1;
      meta.todayDraws += 1;
      // ★ 关键修复:在写入前确保 dynasty 是字符串(本地诗是 {id,name} 对象)
      const norm = normalizePoem(poem) || {};
      if (norm.dynasty) {
        meta.dynastyCounter[norm.dynasty] =
          (meta.dynastyCounter[norm.dynasty] || 0) + 1;
      }
      for (const t of themes) {
        if (!t) continue;
        meta.imageryCounter[t] =
          (meta.imageryCounter[t] || 0) + 1;
      }
      save(meta);
      return this.get();
    },

    /** 累计 / 今日 计数(不返回分布) */
    summary() {
      const m = load();
      return {
        totalDraws: m.totalDraws,
        todayDraws: m.todayDraws,
        todayKey:   m.todayKey,
      };
    },

    /** 朝代 TOP N */
    topDynasties(n = 3) {
      const m = load();
      return topN(m.dynastyCounter, n);
    },

    /** 意象 TOP N */
    topImagery(n = 3) {
      const m = load();
      return topN(m.imageryCounter, n);
    },

    /** 清零全部(供「重置统计」按钮调用) */
    reset() {
      save(DEFAULTS.statsMeta());
    },
  };
}

// ── 内部工具 ────────────────────────────────────────────
function topN(obj, n) {
  return Object.entries(obj || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}