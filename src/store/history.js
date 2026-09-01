// =============================================================
// 古韵抽卡 v3.1 · history store
// 职责:抽卡历史(滚动队列,上限 200)
//
// 写入时机:drawNew 成功渲染后,由 main.js 调用 push(poem)
// 不去重:同首诗连抽允许重复,便于统计「偏爱」
// 排序:items 按 drawnAt 降序(最新在前)
// =============================================================

import {
  KEY, DEFAULTS, parseSafe, dump, assertCapacity, LIMITS,
  normalizePoem,
} from './schema.js';

export function createHistoryStore(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('createHistoryStore 需要一个 storage 适配器');
  }

  function load() {
    const raw = parseSafe(storage.getItem(KEY.history), DEFAULTS.history);
    // 历史记录不需要逐项 normalize(只读字段),但保证是数组
    if (!Array.isArray(raw.items)) raw.items = [];
    return raw;
  }

  function save(h) { storage.setItem(KEY.history, dump(h)); }

  return {
    /** 全部条目(深拷贝 + 倒序最新在前) */
    list() {
      const h = load();
      return [...h.items].sort((a, b) => b.drawnAt - a.drawnAt);
    },

    /**
     * 记录一次抽卡(主流程唯一入口)。
     * 容量超限:弹出最旧的一条(滚动队列语义),不抛错。
     * @param {object} poem
     * @returns {object|null} 新写入的条目;容量异常时返回 null
     */
    push(poem) {
      const norm = normalizePoem(poem);
      if (!norm) return null;
      const h = load();
      const entry = {
        id: norm.id,
        title: norm.title,
        author: norm.author,
        dynasty: norm.dynasty,
        type: norm.type,
        source: norm.source,
        drawnAt: Date.now(),
      };
      h.items.push(entry);
      // 滚动队列:超过上限弹出最旧
      while (h.items.length > LIMITS.history) h.items.shift();
      save(h);
      return entry;
    },

    /** 当前条数 */
    size() {
      return load().items.length;
    },

    /** 清空全部(供「清空历史」按钮调用) */
    clear() {
      save(DEFAULTS.history());
    },
  };
}