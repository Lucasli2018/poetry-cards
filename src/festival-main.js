// =============================================================
// 古韵抽卡 v4.1 · 贺卡模式独立页入口
//
// 职责:
//   ① 加载 localStorage(降级内存)包装器
//   ② 收集 4 个静态容器引用
//   ③ 调用 mountFestivalUI 让 UI 接管渲染/事件/草稿
//   ④ 处理 URL hash 自动恢复草稿(show 流程在 mountFestivalUI 内)
//
// 与主 main.js 完全独立:不引抽卡屏任何代码(0 依赖复用 src/* ESM 模块)。
// =============================================================

import { mountFestivalUI } from './festival-ui.js';

// ── localStorage 包装(降级内存) ──
const mem = new Map();
const ls = (() => {
  try {
    const t = '__pc_v3_festival__';
    localStorage.setItem(t, '1');
    localStorage.removeItem(t);
    return localStorage;
  } catch {
    return {
      getItem: (k) => (mem.has(k) ? mem.get(k) : null),
      setItem: (k, v) => { mem.set(k, String(v == null ? '' : v)); },
      removeItem: (k) => { mem.delete(k); },
    };
  }
})();

// ── DOM 容器 ──
const els = {
  title:     document.getElementById('pc-festival-title'),
  back:      document.getElementById('pc-festival-back'),
  fields:    document.getElementById('pc-festival-fields'),
  card:      document.getElementById('pc-festival-card'),
  selects:   document.getElementById('pc-festival-selects-wrap'),
  actions:   document.getElementById('pc-festival-actions'),
};

if (!els.fields || !els.card || !els.actions) {
  // 容器缺失时给个用户可见的兜底
  const empty = document.createElement('div');
  empty.className = 'pc-festival-empty';
  empty.textContent = '页面加载失败 · 请返回主页重试';
  document.querySelector('.pc-festival-main')?.appendChild(empty);
} else {
  // 接管 UI
  mountFestivalUI(ls, els);
}
