// =============================================================
// 古韵抽卡 v3.1 · 三个 tab 的渲染器
// 纯函数:接收 snapshot,返回 HTMLElement 或 HTML 字符串
// 不依赖 store,只接收数据 → 易于单测
// =============================================================

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function ymdHm(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
         `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function relTime(ts, now = Date.now()) {
  const diff = Math.max(0, now - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return ymdHm(ts).slice(0, 10);
}

function emptyState(text) {
  const e = el('div', 'pc-empty-state', `<p>${escapeHtml(text)}</p>`);
  return e;
}

// ── 收藏 ────────────────────────────────────────────────
/**
 * @param {{favorites?:{items:Array}}} snapshot  期望顶层 {favorites:{items}, ...}
 * @param {{onRemove?:(id)=>void, onClear?:()=>void}} actions
 */
export function renderFavorites(snapshot, actions = {}) {
  const items = snapshot?.favorites?.items || snapshot?.items || [];
  if (!items.length) return emptyState('还没有收藏 · 抽到喜欢的诗,点 ★ 收下');

  const wrap = el('div', 'pc-fav-list');
  for (const it of items) {
    const card = el('div', 'pc-fav-card');
    const head = el('div', 'pc-fav-head');
    head.innerHTML = `
      <div class="pc-fav-title">${escapeHtml(it.title || '无题')}</div>
      <button class="pc-fav-del" type="button" aria-label="取消收藏" title="取消收藏">×</button>
    `;
    head.querySelector('.pc-fav-del').addEventListener('click', () => {
      actions.onRemove?.(it.id);
    });
    const meta = el('p', 'pc-fav-meta',
      [it.dynasty, it.author, it.type].filter(Boolean).map(escapeHtml).join(' · '));
    const verse = el('div', 'pc-fav-verse');
    if (Array.isArray(it.content)) {
      for (const line of it.content) {
        verse.appendChild(el('p', null, escapeHtml(line)));
      }
    }
    const foot = el('div', 'pc-fav-foot');
    foot.innerHTML = `
      <span class="pc-fav-time">收藏于 ${relTime(it.favoritedAt)}</span>
      <span class="pc-fav-source">${it.source === 'local' ? '本地' : '诗泉'}</span>
    `;
    card.append(head, meta, verse, foot);
    wrap.appendChild(card);
  }
  // 底部操作
  if (actions.onClear) {
    const bar = el('div', 'pc-fav-bar');
    const btn = el('button', 'pc-fav-clear', '清空收藏');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (confirm(`确定清空全部 ${items.length} 条收藏?`)) actions.onClear();
    });
    bar.appendChild(btn);
    wrap.appendChild(bar);
  }
  return wrap;
}

// ── 历史 ────────────────────────────────────────────────
/**
 * @param {{history?:{items:Array}}} snapshot
 * @param {{onClear?:()=>void}} actions
 */
export function renderHistory(snapshot, actions = {}) {
  const items = snapshot?.history?.items || snapshot?.items || [];
  if (!items.length) return emptyState('还没有抽卡记录 · 抽一张开始记录');

  const wrap = el('div', 'pc-hist-list');
  for (const it of items) {
    const row = el('div', 'pc-hist-row');
    row.innerHTML = `
      <div class="pc-hist-main">
        <div class="pc-hist-title">${escapeHtml(it.title || '无题')}</div>
        <div class="pc-hist-meta">${escapeHtml([it.dynasty, it.author].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="pc-hist-side">
        <div class="pc-hist-time">${escapeHtml(relTime(it.drawnAt))}</div>
        <div class="pc-hist-source">${it.source === 'local' ? '本地' : '诗泉'}</div>
      </div>
    `;
    wrap.appendChild(row);
  }
  if (actions.onClear) {
    const bar = el('div', 'pc-hist-bar');
    const btn = el('button', 'pc-hist-clear', '清空历史');
    btn.type = 'button';
    btn.addEventListener('click', () => {
      if (confirm(`确定清空全部 ${items.length} 条记录?`)) actions.onClear();
    });
    bar.appendChild(btn);
    wrap.appendChild(bar);
  }
  return wrap;
}

// ── 统计 ────────────────────────────────────────────────
const IMAGERY_LABELS = {
  moonlight: '月', winter: '雪', spring: '春', autumn: '秋',
  summer: '夏', bamboo: '竹', flower: '花', mountain: '山',
  river: '水', rain: '雨', cloud: '云', boat: '舟',
  bird: '鸟', sunset: '夕', night: '夜', temple: '寺',
  pavilion: '亭', wine: '酒', ink: '墨', wind: '风',
};

export function renderStats(snapshot, actions = {}) {
  const m = snapshot?.stats || snapshot || {};
  const totalDraws = m.totalDraws || 0;   // v3.2.7:累计抽卡(走 statsMeta,持久累加)
  const todayDraws = m.todayDraws || 0;   // v3.2.7:今日抽卡(statsMeta,跨日归零)
  // 兜底:把缺失 / "[object Object]" / 非字符串 的 key 替换成「佚名」占位符
  const PLACEHOLDER = '佚名';
  const clean = (arr) => (arr || [])
    .map((x) => ({
      key:   (typeof x.key === 'string' && x.key.trim() && x.key !== '[object Object]') ? x.key : PLACEHOLDER,
      count: Number(x.count) || 0,
    }))
    .filter((x) => x.count > 0);
  const dynasties = clean(m.topDynasties);
  const imagery   = clean(m.topImagery);

  const wrap = el('div', 'pc-stats');
  const totalFavorites = m.totalFavorites || 0;   // v3.2.8:收藏总数,来自 favorites

  // 计数卡(三列:累计抽卡 / 今日抽卡 / 收藏总数)
  const cards = el('div', 'pc-stats-cards');
  cards.innerHTML = `
    <div class="pc-stat-card">
      <div class="pc-stat-num">${totalDraws}</div>
      <div class="pc-stat-label">累计抽卡</div>
    </div>
    <div class="pc-stat-card">
      <div class="pc-stat-num">${todayDraws}</div>
      <div class="pc-stat-label">今日抽卡</div>
    </div>
    <div class="pc-stat-card">
      <div class="pc-stat-num">${totalFavorites}</div>
      <div class="pc-stat-label">收藏总数</div>
    </div>
  `;
  wrap.appendChild(cards);

  // 朝代 TOP(v3.2.7 走 favorites 实时计算)
  const dSec = el('div', 'pc-stats-section');
  dSec.innerHTML = `<h3>最爱朝代</h3>`;
  if (!dynasties.length) {
    dSec.appendChild(el('p', 'pc-stats-hint', '在喜欢的诗右下角点 ♡ 收藏,这里会按朝代累计'));
  } else {
    const max = dynasties[0].count || 1;
    const list = el('div', 'pc-bars');
    for (const { key, count } of dynasties) {
      const row = el('div', 'pc-bar');
      const w = Math.round((count / max) * 100);
      row.innerHTML = `
        <span class="pc-bar-label">${escapeHtml(key)}</span>
        <span class="pc-bar-track"><span class="pc-bar-fill" style="width:${w}%"></span></span>
        <span class="pc-bar-count">${count}</span>
      `;
      list.appendChild(row);
    }
    dSec.appendChild(list);
  }
  wrap.appendChild(dSec);

  // 意象 TOP(v3.2.5 统计收藏)
  const iSec = el('div', 'pc-stats-section');
  iSec.innerHTML = `<h3>最爱意象</h3>`;
  if (!imagery.length) {
    iSec.appendChild(el('p', 'pc-stats-hint', '收藏更多诗,意象慢慢就会浮出'));
  } else {
    const max = imagery[0].count || 1;
    const list = el('div', 'pc-bars');
    for (const { key, count } of imagery) {
      const row = el('div', 'pc-bar');
      const w = Math.round((count / max) * 100);
      const label = IMAGERY_LABELS[key] || key;
      row.innerHTML = `
        <span class="pc-bar-label pc-bar-label--cn">${escapeHtml(label)}</span>
        <span class="pc-bar-track"><span class="pc-bar-fill" style="width:${w}%"></span></span>
        <span class="pc-bar-count">${count}</span>
      `;
      list.appendChild(row);
    }
    iSec.appendChild(list);
  }
  wrap.appendChild(iSec);

  // 重置 + 数据迁移按钮
  if (actions.onReset || actions.onExport || actions.onImport) {
    const bar = el('div', 'pc-stats-bar');
    if (actions.onExport) {
      const b = el('button', 'pc-stats-export', '导出备份');
      b.type = 'button';
      b.title = '将收藏、历史、统计打包为 JSON 文件';
      b.addEventListener('click', () => actions.onExport());
      bar.appendChild(b);
    }
    if (actions.onImport) {
      const b = el('button', 'pc-stats-import', '导入备份');
      b.type = 'button';
      b.title = '从 JSON 文件恢复(合并写入,不覆盖)';
      b.addEventListener('click', () => actions.onImport());
      bar.appendChild(b);
    }
    if (actions.onReset) {
      const b = el('button', 'pc-stats-reset', '重置统计');
      b.type = 'button';
      b.title = '清零累计与今日计数;收藏与历史不受影响';
      b.addEventListener('click', () => {
        if (confirm('确定清零全部统计?收藏与历史不受影响')) actions.onReset();
      });
      bar.appendChild(b);
    }
    wrap.appendChild(bar);
  }
  return wrap;
}

// 导出供测试
export const __test__ = { relTime };