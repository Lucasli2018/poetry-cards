// =============================================================
// 古韵抽卡 v3.1 · store 公共层
// 职责:
//   ① 4 个 localStorage schema 的「权威形状」声明(SCHEMA 常量)
//   ② 安全解析(parseSafe):坏数据不抛,降级为 schema 默认值
//   ③ 容量守卫(assertCapacity):写满前给出明确错误,引导用户清理
//   ④ 时间工具:跨日判定 + ymd key
//
// 约定:
//   - 所有 schema 必须含 'version' 字段,parseSafe 校验失败一律降级
//   - ls.getItem/setItem 由 main.js 注入的 storage 适配器提供,
//     本模块不直接碰 localStorage,便于测试时换内存存储
// =============================================================

export const SCHEMA_VERSION = 1;

// 各模块的「容量上限」,集中维护,便于文档对齐
export const LIMITS = Object.freeze({
  favorites: 200,        // 收藏夹最大条目
  history:   200,        // 抽卡历史最大条目(滚动队列)
  festivalDraftBytes: 5 * 1024,  // v4.0 贺卡草稿 imageUrl 截断阈值(避免 localStorage 5MB 触顶)
});

// localStorage 键名(与 v3.0 命名空间一致:pc_v3_ 前缀)
export const KEY = Object.freeze({
  favorites: 'pc_v3_favorites',
  history:   'pc_v3_history',
  statsMeta: 'pc_v3_stats_meta',
  festivalDraft: 'pc_v3_festival_draft',  // v4.0 贺卡草稿
});

// 「出厂默认」:localStorage 中无任何记录时,首次读取返回什么
export const DEFAULTS = Object.freeze({
  favorites: () => ({ version: SCHEMA_VERSION, items: [] }),
  history:   () => ({ version: SCHEMA_VERSION, items: [] }),
  statsMeta: () => ({
    version: SCHEMA_VERSION,
    totalDraws: 0,
    todayDraws: 0,
    todayKey: '',
    dynastyCounter: {},
    imageryCounter: {},
  }),
  festivalDraft: () => ({  // v4.0 贺卡草稿
    version: SCHEMA_VERSION,
    festivalId: '',
    poemId: '',
    imageUrl: '',
    sender: '',
    recipient: '',
    message: '',
    sealText: '诗',
    savedAt: 0,
  }),
});

// ── 容错解析 ─────────────────────────────────────────────
/**
 * 从字符串安全反序列化一个 schema。
 * - null/undefined/非 string:返回 defaultValue(不抛)
 * - 解析失败(throw SyntaxError):返回 defaultValue
 * - 缺 version 或 version 不匹配:返回 defaultValue
 * - 字段类型不符(如 items 不是数组):尽力修复,实在不行用 defaultValue
 *
 * @template T
 * @param {string|null|undefined} raw   localStorage.getItem 返回值
 * @param {() => T} makeDefault          生成默认值的工厂
 * @returns {T}
 */
export function parseSafe(raw, makeDefault) {
  if (raw == null || typeof raw !== 'string') return makeDefault();
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return makeDefault();
  }
  if (!parsed || typeof parsed !== 'object') return makeDefault();
  if (parsed.version !== SCHEMA_VERSION) return makeDefault();
  return parsed;
}

// ── 序列化(供 store/* 调用,统一走这里便于将来加版本迁移)──
export function dump(obj) {
  return JSON.stringify(obj);
}

// ── 容量守卫 ─────────────────────────────────────────────
export class CapacityError extends Error {
  constructor(kind, limit, current) {
    super(`容量已满: ${kind} 上限 ${limit},当前 ${current}`);
    this.name = 'CapacityError';
    this.kind = kind;
    this.limit = limit;
    this.current = current;
  }
}

/** 写入前判定:items 长度 + 1 是否越限 */
export function assertCapacity(kind, currentLength) {
  const limit = LIMITS[kind];
  if (limit == null) return;   // 未知 kind 不做限制
  if (currentLength >= limit) {
    throw new CapacityError(kind, limit, currentLength);
  }
}

// ── 时间工具 ─────────────────────────────────────────────
/** 本地日期 key:YYYY-MM-DD,跨日归零判定用 */
export function ymdKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** 检测 todayKey 是否需要滚动到新一天(同时返回下一日的 key) */
export function rolloverIfNeeded(meta, now = new Date()) {
  const today = ymdKey(now);
  if (meta.todayKey !== today) {
    meta.todayKey = today;
    meta.todayDraws = 0;
  }
  return meta;
}

// ── PoemShape 校验 ──────────────────────────────────────
// 诗泉 / 本地诗最小字段集;favorite/history 共用此结构
const REQUIRED_POEM_KEYS = ['title'];

export function normalizePoem(p) {
  if (!p || typeof p !== 'object') return null;
  // content 可能是数组或字符串,统一为字符串数组
  let content;
  if (Array.isArray(p.content)) content = p.content.map(String);
  else if (typeof p.content === 'string') content = p.content.split(/\r?\n/);
  else content = [];

  return {
    id: typeof p.id === 'number' || typeof p.id === 'string' ? p.id : null,
    title: String(p.title || '无题'),
    author: p.author?.name ? String(p.author.name) : (p.author ? String(p.author) : ''),
    dynasty: p.dynasty?.name ? String(p.dynasty.name) : (p.dynasty ? String(p.dynasty) : ''),
    type: p.type?.name ? String(p.type.name) : (p.type ? String(p.type) : ''),
    content,
    source: p.source === 'local' ? 'local' : 'remote',
  };
}

/** 浅校验:title 是必须的,其他字段尽力 normalize */
export function assertPoemShape(p) {
  if (!p || typeof p !== 'object') {
    throw new TypeError('poem 必须是对象');
  }
  if (!REQUIRED_POEM_KEYS.every((k) => k in p)) {
    throw new TypeError(`poem 缺少必填字段: ${REQUIRED_POEM_KEYS.join(',')}`);
  }
  return normalizePoem(p);
}