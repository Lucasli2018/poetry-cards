// =============================================================
// 古韵抽卡 v3.1 · 导出 / 导入 JSON
//
// 设计:
//   - 导出:打包 favorites + history + stats 为 JSON,触发浏览器下载
//   - 导入:<input type=file> 选 JSON → 解析 → 校验 → 确认 → 合并写入
//   - 合并策略:按 poem.id 去重,导入的 favoritedAt / drawnAt 较新者胜
//   - 失败一律 toast 提示,不破坏现有数据
//
// 零依赖:纯 DOM + Blob + URL.createObjectURL + FileReader
// =============================================================

import { KEY, SCHEMA_VERSION, parseSafe, DEFAULTS } from '../store/schema.js';

const APP_TAG = 'poetry-cards-v3.1-backup';
const FILE_EXT = '.pcb.json';

/** 从 ls 适配器导出三块数据的快照(供主流程塞给 download()) */
export function snapshotForExport(storage) {
  return {
    app: APP_TAG,
    exportedAt: new Date().toISOString(),
    schemaVersion: SCHEMA_VERSION,
    favorites: parseSafe(storage.getItem(KEY.favorites), DEFAULTS.favorites),
    history:   parseSafe(storage.getItem(KEY.history),   DEFAULTS.history),
    statsMeta: parseSafe(storage.getItem(KEY.statsMeta), DEFAULTS.statsMeta),
  };
}

/** 触发浏览器下载(JSON 文件) */
export function downloadSnapshot(snapshot) {
  const json = JSON.stringify(snapshot, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const ts = (snapshot.exportedAt || new Date().toISOString())
    .replace(/[:.]/g, '-').replace(/T/, '_').slice(0, 19);
  const a = document.createElement('a');
  a.href = url;
  a.download = `poetry-cards-backup_${ts}${FILE_EXT}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 解析上传的 JSON;失败抛 Error */
export function parseSnapshot(text) {
  let obj;
  try { obj = JSON.parse(text); }
  catch { throw new Error('文件不是合法 JSON'); }
  if (!obj || typeof obj !== 'object') throw new Error('文件内容不是对象');
  if (obj.app !== APP_TAG) throw new Error('文件不是古韵抽卡备份');
  if (obj.schemaVersion !== SCHEMA_VERSION) throw new Error('备份版本不兼容');
  if (!obj.favorites || !obj.history || !obj.statsMeta) throw new Error('备份字段缺失');
  return obj;
}

/**
 * 合并导入:favorites 按 id 去重(新 favoritedAt 胜);history 追加去重(同 id+同 drawnAt 视为重复);
 * statsMeta 用导入值覆盖(用户已确认重置)。
 * @returns {{addedFav:number, addedHist:number, statsReset:boolean}}
 */
export function mergeImport(storage, snapshot) {
  // favorites
  const curFav = parseSafe(storage.getItem(KEY.favorites), DEFAULTS.favorites);
  const curMap = new Map(curFav.items.map((x) => [x.id, x]));
  let addedFav = 0;
  for (const it of (snapshot.favorites.items || [])) {
    if (!it.id) continue;
    const old = curMap.get(it.id);
    if (!old || (it.favoritedAt || 0) > (old.favoritedAt || 0)) {
      curMap.set(it.id, it);
      addedFav++;
    }
  }
  const newFavItems = Array.from(curMap.values())
    .sort((a, b) => (b.favoritedAt || 0) - (a.favoritedAt || 0))
    .slice(0, 200);
  storage.setItem(KEY.favorites, JSON.stringify({ version: SCHEMA_VERSION, items: newFavItems }));

  // history
  const curHist = parseSafe(storage.getItem(KEY.history), DEFAULTS.history);
  const seen = new Set(curHist.items.map((x) => `${x.id}-${x.drawnAt}`));
  let addedHist = 0;
  for (const it of (snapshot.history.items || [])) {
    const k = `${it.id}-${it.drawnAt}`;
    if (seen.has(k)) continue;
    curHist.items.push(it);
    seen.add(k);
    addedHist++;
  }
  // 按 drawnAt 降序,截断 200
  curHist.items.sort((a, b) => (b.drawnAt || 0) - (a.drawnAt || 0));
  curHist.items = curHist.items.slice(0, 200);
  storage.setItem(KEY.history, JSON.stringify({ version: SCHEMA_VERSION, items: curHist.items }));

  // stats 直接覆盖(用户已确认重置)
  storage.setItem(KEY.statsMeta, JSON.stringify(snapshot.statsMeta));
  return { addedFav, addedHist, statsReset: true };
}

/** 读取用户选择的 JSON 文件(parseSnapshot → 抛错给上层捕获) */
export function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('文件读取失败'));
    r.readAsText(file);
  });
}