import { safeJSONParse } from './utils.js';

let ls = typeof localStorage !== 'undefined' ? localStorage : null;
const mem = new Map();
const memLs = {
  getItem: k => mem.has(k) ? mem.get(k) : null,
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: k => mem.delete(k),
};

export function _setLS(custom) { ls = custom; }

function safeSet(key, value) {
  try { ls.setItem(key, JSON.stringify(value)); }
  catch (e) { memLs.setItem(key, JSON.stringify(value)); }
}

function safeGet(key, fallback) {
  let raw = null;
  try { raw = ls ? ls.getItem(key) : null; } catch { raw = null; }
  if (raw == null) {
    const memRaw = memLs.getItem(key);
    return memRaw == null ? fallback : safeJSONParse(memRaw, fallback);
  }
  return safeJSONParse(raw, fallback);
}

export function loadHistory() { return safeGet('pc_history', []); }
export function saveHistory(history) { safeSet('pc_history', history); }

export function loadFavorites() { return new Set(safeGet('pc_favorites', [])); }
export function toggleFavorite(id) {
  const set = loadFavorites();
  let next;
  if (set.has(id)) { set.delete(id); next = false; }
  else { set.add(id); next = true; }
  safeSet('pc_favorites', [...set]);
  return next;
}

export function loadFilter() { return safeGet('pc_filter', 'all'); }
export function saveFilter(category) { safeSet('pc_filter', category); }

export function clearHistory() { safeSet('pc_history', []); }