// =============================================================
// 古韵抽卡 v3.1 · favorites store
// 职责:收藏夹(以 poem.id 为主键,容量 200)
//
// 语义:
//   - add(poem):已存在则更新 favoritedAt 并「置顶」(移到列表最前)
//   - remove(id):删除条目;不存在静默成功
//   - has(id):判断是否已收藏
//   - toggle(poem):add/remove 一步完成,返回 {favorited, count}
//   - 容量上限:超限抛 CapacityError,引导用户清理(不自动覆盖旧收藏)
// =============================================================

import {
  KEY, DEFAULTS, parseSafe, dump, assertCapacity, LIMITS,
  normalizePoem,
} from './schema.js';

export function createFavoritesStore(storage) {
  if (!storage || typeof storage.getItem !== 'function') {
    throw new TypeError('createFavoritesStore 需要一个 storage 适配器');
  }

  function load() {
    const raw = parseSafe(storage.getItem(KEY.favorites), DEFAULTS.favorites);
    if (!Array.isArray(raw.items)) raw.items = [];
    return raw;
  }

  function save(f) { storage.setItem(KEY.favorites, dump(f)); }

  function getId(poem) {
    if (poem == null) return null;
    if (typeof poem.id === 'number' || typeof poem.id === 'string') return poem.id;
    return null;
  }

  return {
    /** 全部条目(深拷贝 + favoritedAt 降序,最新在前) */
    list() {
      const f = load();
      return [...f.items].sort((a, b) => b.favoritedAt - a.favoritedAt);
    },

    /** 条数 */
    size() { return load().items.length; },

    /** 是否已收藏(id 为 null 时恒返回 false) */
    has(id) {
      if (id == null) return false;
      return load().items.some((x) => x.id === id);
    },

    /**
     * 添加 / 更新收藏。
     * - 已存在:更新 favoritedAt 并置顶
     * - 不存在:抛 CapacityError(满) / 写入(未满)
     * @returns {object} 收藏后的条目
     */
    add(poem) {
      const norm = normalizePoem(poem);
      if (!norm || norm.id == null) {
        throw new TypeError('favorites.add: 缺少 poem.id,无法唯一标识');
      }
      const f = load();
      const idx = f.items.findIndex((x) => x.id === norm.id);
      const entry = {
        id: norm.id,
        title: norm.title,
        author: norm.author,
        dynasty: norm.dynasty,
        type: norm.type,
        content: norm.content,
        source: norm.source,
        favoritedAt: Date.now(),
      };
      if (idx >= 0) {
        // 更新路径:替换原条目(保证 content 也跟上),置顶
        f.items.splice(idx, 1);
        f.items.unshift(entry);
      } else {
        // 新增路径:容量守卫
        assertCapacity('favorites', f.items.length);
        f.items.unshift(entry);
      }
      save(f);
      return entry;
    },

    /**
     * 删除收藏。
     * @returns {boolean} 是否真的删了一条
     */
    remove(id) {
      if (id == null) return false;
      const f = load();
      const before = f.items.length;
      f.items = f.items.filter((x) => x.id !== id);
      const removed = f.items.length !== before;
      if (removed) save(f);
      return removed;
    },

    /**
     * 切换收藏(已收藏→删除,未收藏→添加)。
     * @returns {{favorited: boolean, count: number, error?: string}}
     */
    toggle(poem) {
      const norm = normalizePoem(poem);
      if (!norm || norm.id == null) {
        return { favorited: false, count: this.size(), error: '缺少 poem.id' };
      }
      if (this.has(norm.id)) {
        this.remove(norm.id);
        return { favorited: false, count: this.size() };
      }
      try {
        this.add(poem);
        return { favorited: true, count: this.size() };
      } catch (e) {
        if (e?.name === 'CapacityError') {
          return { favorited: false, count: this.size(), error: e.message };
        }
        throw e;
      }
    },

    /** 清空全部 */
    clear() { save(DEFAULTS.favorites()); },
  };
}