// =============================================================
// 古韵抽卡 v4.0 · 贺卡草稿 store
//
// 职责:
//   ① 草稿 CRUD(读取 / 保存 / 清除)
//   ② debounce 500ms(防止 input 抖动写盘)
//   ③ parseSafe 坏数据 → 返回 null(不抛)
//   ④ imageUrl 超 5KB 截断(避免 localStorage 5MB 触顶)
//
// 沿用 v3.1 store 模式:createXxxStore(storage, opts) → { get, save, clear }
// storage 接口:{getItem, setItem, removeItem}
//   - main.js 注入了 localStorage 适配(不可用时降级为内存 Map)
//
// 调用方:
//   - festival-ui.js(主,save 调用)
//   - test-festival.mjs(测试)
// =============================================================

import { parseSafe, dump, DEFAULTS, KEY, SCHEMA_VERSION, LIMITS } from './store/schema.js';

const REQUIRED = ['festivalId', 'poemId'];

function validate(d) {
  if (!d || typeof d !== 'object') return false;
  for (const k of REQUIRED) if (!d[k]) return false;
  return true;
}

function trimDraft(d) {
  // imageUrl 超 5KB 截断(避免 localStorage 5MB 触顶)
  if (d.imageUrl && d.imageUrl.length > LIMITS.festivalDraftBytes) {
    d.imageUrl = d.imageUrl.slice(0, LIMITS.festivalDraftBytes);
  }
  return d;
}

/**
 * 创建贺卡草稿 store。
 * @param {{getItem:(k:string)=>string|null,setItem:(k:string,v:string)=>void,removeItem:(k:string)=>void}} storage
 * @param {{debounceMs?:number}} [opts]
 */
export function createFestivalDraftStore(storage, { debounceMs = 500 } = {}) {
  let cache = null;
  let loaded = false;
  let timer = null;

  function read() {
    if (loaded) return cache;
    loaded = true;
    const raw = storage.getItem(KEY.festivalDraft);
    const parsed = parseSafe(raw, DEFAULTS.festivalDraft);
    cache = validate(parsed) ? parsed : null;
    return cache;
  }

  function flush(draft) {
    cache = trimDraft({ ...draft, version: SCHEMA_VERSION, savedAt: Date.now() });
    storage.setItem(KEY.festivalDraft, dump(cache));
  }

  function save(draft) {
    if (!validate(draft)) {
      throw new TypeError(`festival draft 缺少必填字段: ${REQUIRED.join(',')}`);
    }
    // 立即更新内存缓存(用于下次 get),延迟写盘
    cache = trimDraft({ ...draft, version: SCHEMA_VERSION, savedAt: Date.now() });
    loaded = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      storage.setItem(KEY.festivalDraft, dump(cache));
      timer = null;
    }, debounceMs);
  }

  function flushNow() {
    // 立即写盘(用于离开提示 / 卸载前)
    if (timer) { clearTimeout(timer); timer = null; }
    if (cache) storage.setItem(KEY.festivalDraft, dump(cache));
  }

  function clear() {
    cache = null;
    loaded = true;
    if (timer) { clearTimeout(timer); timer = null; }
    storage.removeItem(KEY.festivalDraft);
  }

  return { get: read, save, clear, flushNow };
}