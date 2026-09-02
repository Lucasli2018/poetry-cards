// =============================================================
// 古韵抽卡 v4.0 · 节日贺卡屏 UI
//
// 职责:
//   ① 渲染贺卡屏(festivalScreen 容器)
//   ② 节日胶囊切换 / 换一首循环
//   ③ 4 个自定义字段(送给/落款/寄语/印章)双向绑定 + 实时预览
//   ④ debounce 保存草稿(500ms) — 经由 festival-draft.js
//   ⑤ 下载 / 分享 — 复用 cards.js
//   ⑥ 离开提示(dirty 时 confirm)
//
// 双入口(方案 C):与 .pc-main 互斥显示,不重叠。
// =============================================================

import { FESTIVALS, getFestivalById, getPoemById, isTodayFestival } from './festival-data.js';
import { createFestivalDraftStore } from './festival-draft.js';
import { composeCard, downloadCard, shareCard } from './cards.js';
import { fetchSceneImage } from './images.js';

const SEAL_OPTIONS = ['诗', '礼', '福', '安', '乐', '吉', '春', '祥'];
const FIELD_LIMITS = { sender: 12, recipient: 12, message: 30 };

// 贺卡图区 fallback(显式视觉,避免用户误以为"图不显示")
const FALLBACK_LOADING_HTML = '<div class="postcard-media-fallback postcard-media-fallback--loading" role="status" aria-label="意境加载中"><span class="postcard-media-fallback-icon" aria-hidden="true">🎐</span><span class="postcard-media-fallback-text">意境加载中</span></div>';
const FALLBACK_DONE_HTML    = '<div class="postcard-media-fallback" role="img" aria-label="水墨意境"><span class="postcard-media-fallback-icon" aria-hidden="true">🏔</span><span class="postcard-media-fallback-text">水墨意境</span></div>';

// 浏览器原生通知(用户首次下载时按需请求授权)
let _notifyPermissionAsked = false;
function trySysNotify(title, body) {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'granted') {
    try { new Notification(title, { body, icon: '/favicon.ico' }); } catch {}
  } else if (!_notifyPermissionAsked && Notification.permission !== 'denied') {
    _notifyPermissionAsked = true;
    Notification.requestPermission().then((p) => {
      if (p === 'granted') try { new Notification(title, { body, icon: '/favicon.ico' }); } catch {}
    });
  }
}

// 屏内 toast(轻量、不打断)
let _toastTimer = null;
function showToast(message, kind = 'info') {
  let host = document.getElementById('pc-toast-host');
  if (!host) {
    host = document.createElement('div');
    host.id = 'pc-toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  host.textContent = message;
  host.className = `pc-toast pc-toast--${kind} is-show`;
  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { host.classList.remove('is-show'); }, 2400);
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

export function mountFestivalUI(storage, els) {
  const draftStore = createFestivalDraftStore(storage, { debounceMs: 500 });

  // 内部状态
  let state = freshState();
  let lastSavedKey = null;

  function freshState() {
    return {
      festivalId: FESTIVALS[0]?.id || '',
      poemId: FESTIVALS[0]?.poems[0]?.id || '',
      sender: '',
      recipient: '',
      message: '',
      sealText: '诗',
      imageUrl: '',
      bgImg: null,
      dirty: false,
    };
  }

  function stripForSave(s) {
    return {
      festivalId: s.festivalId, poemId: s.poemId, imageUrl: s.imageUrl,
      sender: s.sender, recipient: s.recipient, message: s.message, sealText: s.sealText,
      savedAt: Date.now(),
    };
  }

  // ── 渲染 ──
  function render() {
    const screen = els.festivalScreen;
    if (!screen) return;
    const festival = getFestivalById(state.festivalId) || FESTIVALS[0];
    if (!festival) {
      screen.innerHTML = `<div class="pc-festival-empty">节日数据加载失败 · 请刷新页面</div>`;
      return;
    }
    const poemEntry = getPoemById(state.poemId);
    const poem = poemEntry?.poem || festival.poems[0];

    const chipsHtml = FESTIVALS.map(f => {
      const isToday = isTodayFestival(f.id, new Date());
      const cur = f.id === festival.id;
      return `
        <button type="button" class="pc-festival-chip${cur ? ' is-current' : ''}"
                data-festival-id="${escapeHtml(f.id)}"
                aria-pressed="${cur}">
          <span class="pc-festival-chip-icon" aria-hidden="true">${escapeHtml(f.icon)}</span>
          <span class="pc-festival-chip-name">${escapeHtml(f.name)}</span>
          ${isToday ? '<span class="pc-festival-chip-dot" title="今日" aria-label="今日">·今</span>' : ''}
        </button>`;
    }).join('');

    const mediaHtml = state.bgImg
      ? `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous">`
      : FALLBACK_LOADING_HTML;

    screen.innerHTML = `
      <header class="pc-festival-header">
        <button id="pc-festival-back" class="pc-btn pc-btn--ghost" type="button">← 抽卡</button>
        <h2 class="pc-festival-title">贺卡 · ${escapeHtml(festival.name)}</h2>
      </header>

      <section class="pc-festival-fields" aria-label="自定义字段(置顶区)">
        <div class="pc-festival-fields-row">
          <label class="pc-field">
            <span class="pc-field-label">收信人</span>
            <input id="pc-f-field-recipient" type="text" maxlength="${FIELD_LIMITS.recipient}" value="${escapeHtml(state.recipient)}" placeholder="小王">
          </label>
          <label class="pc-field">
            <span class="pc-field-label">落款</span>
            <input id="pc-f-field-sender" type="text" maxlength="${FIELD_LIMITS.sender}" value="${escapeHtml(state.sender)}" placeholder="老友 XXX">
          </label>
        </div>
        <label class="pc-field pc-field--wide">
          <span class="pc-field-label">寄语</span>
          <input id="pc-f-field-message" type="text" maxlength="${FIELD_LIMITS.message}" value="${escapeHtml(state.message)}" placeholder="${escapeHtml(festival.greeting || '')}">
        </label>
        <div class="pc-field pc-field--seals" role="radiogroup" aria-label="印章选择">
          <span class="pc-field-label">印章</span>
          <div class="pc-seal-grid">
            ${SEAL_OPTIONS.map(s => `
              <button type="button" class="pc-seal-chip${s === state.sealText ? ' is-current' : ''}" role="radio" aria-checked="${s === state.sealText}" data-seal="${s}">
                <span class="pc-seal-chip-text">${s}</span>
              </button>
            `).join('')}
          </div>
        </div>
      </section>

      <section class="pc-festival-card" aria-label="明信片预览">
        <div class="postcard">
          <div class="postcard-media">${mediaHtml}</div>
          <div class="postcard-body">
            <h3 class="postcard-title">《${escapeHtml(poem.title)}》</h3>
            <p class="postcard-meta">${[poem.dynasty, poem.author, poem.type].filter(Boolean).map(escapeHtml).join(' · ')}</p>
            <hr class="postcard-rule">
            <div class="postcard-content">
              ${poem.content.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            ${state.recipient ? `<p class="postcard-gift">送给 ${escapeHtml(state.recipient)}</p>` : ''}
            ${state.message ? `<p class="postcard-message">${escapeHtml(state.message)}</p>` : ''}
            <p class="postcard-foot">古韵抽卡 · 一图一诗</p>
            <span class="postcard-seal" aria-label="印章">${escapeHtml(state.sealText)}</span>
          </div>
        </div>
      </section>

      <div class="pc-festival-chips" role="group" aria-label="节日选择">
        <span class="pc-festival-chips-label">节令</span>
        <div class="pc-festival-chips-row">${chipsHtml}</div>
      </div>

      <div class="pc-festival-actions">
        <button id="pc-f-btn-next" class="pc-btn" type="button">换一首 ↻</button>
        <button id="pc-f-btn-download" class="pc-btn pc-btn--primary" type="button">下载 PNG</button>
        <button id="pc-f-btn-share" class="pc-btn" type="button">分享</button>
      </div>
    `;

    bindEvents(festival, poem);
  }

  function bindEvents(festival, poem) {
    els.festivalScreen.querySelector('#pc-festival-back')?.addEventListener('click', onBack);
    els.festivalScreen.querySelectorAll('.pc-festival-chip').forEach(btn => {
      btn.addEventListener('click', () => onFestivalChange(btn.dataset.festivalId));
    });
    els.festivalScreen.querySelector('#pc-f-btn-next')?.addEventListener('click', onNextPoem);
    els.festivalScreen.querySelector('#pc-f-btn-download')?.addEventListener('click', onDownload);
    els.festivalScreen.querySelector('#pc-f-btn-share')?.addEventListener('click', onShare);

    const recipient = els.festivalScreen.querySelector('#pc-f-field-recipient');
    const sender = els.festivalScreen.querySelector('#pc-f-field-sender');
    const message = els.festivalScreen.querySelector('#pc-f-field-message');

    recipient?.addEventListener('input', () => updateField('recipient', recipient.value));
    sender?.addEventListener('input', () => updateField('sender', sender.value));
    message?.addEventListener('input', () => updateField('message', message.value));

    // 印章选择:8 颗 button,radiogroup
    els.festivalScreen.querySelectorAll('.pc-seal-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const seal = btn.dataset.seal;
        updateField('sealText', seal);
        // 局部更新选中态,避免整屏 render 闪动
        els.festivalScreen.querySelectorAll('.pc-seal-chip').forEach(b => {
          const on = b.dataset.seal === seal;
          b.classList.toggle('is-current', on);
          b.setAttribute('aria-checked', on ? 'true' : 'false');
        });
        const sealEl = els.festivalScreen.querySelector('.postcard-seal');
        if (sealEl) sealEl.textContent = seal;
      });
    });
  }

  // ── 行为 ──
  function updateField(key, value) {
    state[key] = value;
    state.dirty = true;
    draftStore.save(stripForSave(state));
    // 局部更新预览(避免每次 input 都全量 render)
    if (key === 'recipient') updatePreviewRecipient(value);
    else if (key === 'message') updatePreviewMessage(value);
    else if (key === 'sealText') updatePreviewSeal(value);
  }

  function updatePreviewRecipient(v) {
    const card = els.festivalScreen.querySelector('.postcard-body');
    if (!card) return;
    let node = card.querySelector('.postcard-gift');
    if (v) {
      if (!node) {
        node = document.createElement('p');
        node.className = 'postcard-gift';
        const msg = card.querySelector('.postcard-message');
        (msg || card.querySelector('.postcard-content')).insertAdjacentElement('afterend', node);
      }
      node.textContent = `送给 ${v}`;
    } else if (node) node.remove();
  }

  function updatePreviewMessage(v) {
    const card = els.festivalScreen.querySelector('.postcard-body');
    if (!card) return;
    let node = card.querySelector('.postcard-message');
    if (v) {
      if (!node) {
        node = document.createElement('p');
        node.className = 'postcard-message';
        const foot = card.querySelector('.postcard-foot');
        foot.insertAdjacentElement('beforebegin', node);
      }
      node.textContent = v;
    } else if (node) node.remove();
  }

  function updatePreviewSeal(v) {
    const seal = els.festivalScreen.querySelector('.postcard-seal');
    if (seal) seal.textContent = v;
  }

  function onFestivalChange(festivalId) {
    const f = getFestivalById(festivalId);
    if (!f) return;
    state.festivalId = festivalId;
    state.poemId = f.poems[0].id;
    state.message = '';   // 切节日清空寄语
    state.bgImg = null;
    state.imageUrl = '';
    state.dirty = true;
    draftStore.save(stripForSave(state));
    render();
    loadImage();
  }

  function onNextPoem() {
    const f = getFestivalById(state.festivalId);
    if (!f || !f.poems.length) return;
    const idx = f.poems.findIndex(p => p.id === state.poemId);
    const next = f.poems[(idx + 1) % f.poems.length];
    state.poemId = next.id;
    state.bgImg = null;
    state.imageUrl = '';
    state.dirty = true;
    draftStore.save(stripForSave(state));
    render();
    loadImage();
  }

  async function loadImage() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const festival = getFestivalById(state.festivalId);
    const poemWithKeywords = {
      ...entry.poem,
      imageTags: festival?.themeKeywords || entry.festival.themeKeywords,
    };
    // v4.0.2:在线直接请求 — 多源轮询 + 短超时,保证 8s 内必出图
    const r = await fetchSceneImage(poemWithKeywords, { totalBudgetMs: 8000 });
    if (r && r.img) {
      state.bgImg = r.img;
      state.imageUrl = r.url || '';
      draftStore.save(stripForSave(state));
      updatePreviewImage();
    } else {
      // 三源全失败 —— 给用户明确提示,而不是永远 loading
      const media = els.festivalScreen.querySelector('.postcard-media');
      if (media) {
        media.innerHTML = '<div class="postcard-media-fallback postcard-media-fallback--error" role="img" aria-label="意境获取失败"><span class="postcard-media-fallback-icon" aria-hidden="true">⛅</span><span class="postcard-media-fallback-text">意境暂不可达,稍后重试</span></div>';
      }
    }
  }

  function updatePreviewImage() {
    const media = els.festivalScreen.querySelector('.postcard-media');
    if (!media) return;
    if (state.bgImg) {
      // 使用已 CORS 化的 bgImg 直接渲染(已是浏览器可绘制的对象),
      // 用 onerror 兜底:即便第二次加载失败,降级为水墨意境。
      const safeFallback = FALLBACK_DONE_HTML.replace(/'/g, "\\'");
      media.innerHTML = `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous" onerror="this.parentElement.innerHTML='${safeFallback}'">`;
    } else {
      media.innerHTML = FALLBACK_DONE_HTML;
    }
  }

  async function onDownload() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const host = els.festivalScreen.querySelector('.postcard');
    const cv = composeCard(entry.poem, state.bgImg, host, {
      sender: state.sender, recipient: state.recipient,
      message: state.message, sealText: state.sealText,
    });
    try {
      const name = await downloadCard(cv, entry.poem, host);
      state.dirty = false;
      showToast(`已保存为 ${name}`, 'success');
      trySysNotify('贺卡已生成', name);
    } catch (e) {
      console.error('[festival] download failed', e);
      showToast('生成失败,请重试', 'error');
    }
  }

  async function onShare() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const host = els.festivalScreen.querySelector('.postcard');
    const cv = composeCard(entry.poem, state.bgImg, host, {
      sender: state.sender, recipient: state.recipient,
      message: state.message, sealText: state.sealText,
    });
    try {
      await shareCard(cv, entry.poem);
      showToast('已复制到剪贴板', 'success');
    } catch (e) {
      showToast('分享失败,请改用下载', 'error');
    }
  }

  function onBack() {
    if (state.dirty) {
      if (!confirm('当前贺卡未下载,确定离开?')) return;
    }
    hide();
  }

  // ── 显示 / 隐藏 ──
  function show() {
    const draft = draftStore.get();
    if (draft && draft.festivalId && draft.poemId) {
      state = { ...freshState(), ...draft, bgImg: null };
      lastSavedKey = JSON.stringify(stripForSave(state));
    } else {
      state = freshState();
      lastSavedKey = null;
    }
    state.dirty = false;

    if (els.pcMain) els.pcMain.setAttribute('hidden', '');
    els.festivalScreen.removeAttribute('hidden');
    if (history.replaceState) history.replaceState(null, '', '#festival');
    render();
    loadImage();
  }

  function hide() {
    draftStore.flushNow();   // 离开前确保写盘
    els.festivalScreen.setAttribute('hidden', '');
    if (els.pcMain) els.pcMain.removeAttribute('hidden');
    if (history.replaceState) history.replaceState(null, '', location.pathname);
    state = freshState();
    lastSavedKey = null;
  }

  // ── 入口绑定 ──
  els.festivalOpen?.addEventListener('click', show);

  return { show, hide };
}