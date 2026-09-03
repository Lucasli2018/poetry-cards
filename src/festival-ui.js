// =============================================================
// 古韵抽卡 v4.1.5 · 节日贺卡屏 UI
//
// 职责:
//   ① 渲染贺卡屏(festivalScreen 容器)
//   ② 节日胶囊切换 / 换一首循环
//   ③ 4 个自定义字段(送给/落款/寄语/印章)双向绑定 + 实时预览
//   ④ debounce 保存草稿(500ms) — 经由 festival-draft.js
//   ⑤ 下载 / 分享 — 复用 cards.js
//   ⑥ 离开提示(dirty 时 confirm)
//
// 图片 + 诗词加载逻辑(v4.1.5):与主页面 main.js 完全对齐
//   - 复用 fetchSceneImage(多源:Picsum → Pollinations → 兜底)
//   - 进入即 render 骨架占位 → fetchSceneImage → 整卡重渲染嵌入 <img>
//   - 加载失败:onerror 兜底为单色宣纸占位(保留 v4.1.4 体验)
// =============================================================

import { FESTIVALS, getFestivalById, getPoemById, isTodayFestival } from './festival-data.js';
import { createFestivalDraftStore } from './festival-draft.js';
import { composeCard, downloadCard, shareCard } from './cards.js';
import { fetchSceneImage } from './images.js';

const SEAL_OPTIONS = ['诗', '礼', '福', '安', '乐', '吉', '春', '祥'];
const FIELD_LIMITS = { sender: 12, recipient: 12, message: 30 };

// 骨架占位 — 与主页面 .pc-skeleton 同质:进入即有结构,等 fetchSceneImage 替换
//   v4.1.6: 同时承担 "正在加载" 的明确文案 + 视觉提示
function skeletonHtml() {
  return `
    <div class="pc-skeleton">
      <div class="pc-skeleton-media"><span class="pc-shimmer"></span></div>
      <div class="pc-skeleton-lines">
        <span class="pc-skeleton-line" style="width:38%"></span>
        <span class="pc-skeleton-line" style="width:22%"></span>
        <span class="pc-skeleton-line" style="width:78%"></span>
        <span class="pc-skeleton-line" style="width:70%"></span>
        <span class="pc-skeleton-line" style="width:74%"></span>
      </div>
      <div class="pc-skeleton-text">正在寻诗配图…</div>
    </div>`;
}

// 失败兜底 — fetchSceneImage 整体失败时用, 保留 v4.1.4 的"水墨意境"占位
//   比单纯保留骨架更友好: 明确告诉用户"图没出来", 而不是无止境的 loading
function fallbackHtml() {
  return `
    <div class="postcard-media-fallback" role="img" aria-label="意境暂不可用">
      <span class="postcard-media-fallback-icon" aria-hidden="true">🏔</span>
      <span class="postcard-media-fallback-text">意境暂不可用<br><small style="opacity:.7">稍后重试 · 或换一首</small></span>
    </div>`;
}

// 加载中片段 — v4.1.6: 在 fetchSceneImage 期间显示
//   <img> 同步嵌入让浏览器负责 loading 视觉, 自定义 spinner + 文案加强反馈
function loadingTipHtml() {
  return `<div class="postcard-media-loading-tip">
    <span class="postcard-media-loading-spinner" aria-hidden="true"></span>
    <span>意境加载中</span>
  </div>`;
}

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
      imageStatus: 'idle',  // v4.1.6: idle | loading | ok | error
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
    const festival = getFestivalById(state.festivalId) || FESTIVALS[0];
    if (!festival) {
      if (els.fields) els.fields.innerHTML = `<div class="pc-festival-empty">节日数据加载失败 · 请刷新页面</div>`;
      return;
    }
    const poemEntry = getPoemById(state.poemId);
    const poem = poemEntry?.poem || festival.poems[0];

    // 标题(动态)——回填当前节日名
    if (els.title) els.title.textContent = `贺卡 · ${festival.name}`;

    // ① 字段区
    if (els.fields) {
      els.fields.innerHTML = `
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
      `;
    }

    // ② 节令 + 印章 同行下拉
    if (els.selects) {
      const festivalOptions = FESTIVALS.map(f => {
        const isToday = isTodayFestival(f.id, new Date());
        const cur = f.id === festival.id;
        const label = `${f.icon} ${f.name}${isToday ? ' · 今日' : ''}`;
        return `<option value="${escapeHtml(f.id)}"${cur ? ' selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      const sealOptions = SEAL_OPTIONS.map(s =>
        `<option value="${s}"${s === state.sealText ? ' selected' : ''}>${s}</option>`
      ).join('');
      els.selects.innerHTML = `
        <div class="pc-festival-selects" role="group" aria-label="节令 + 印章">
          <label class="pc-field pc-field--select">
            <span class="pc-field-label">节令</span>
            <select id="pc-f-field-festival" class="pc-select pc-select--festival">${festivalOptions}</select>
          </label>
          <label class="pc-field pc-field--select">
            <span class="pc-field-label">印章</span>
            <select id="pc-f-field-seal" class="pc-select pc-select--seal">${sealOptions}</select>
          </label>
        </div>
      `;
    }

    // ③ 预览(明信片)
    if (els.card) {
      // v4.1.6: 与主页面 main.js#drawNew 走同一流程 — 进入即嵌 <img>
      //   - state.imageStatus='ok' + bgImg → 直接嵌 <img src>(已 CORS 化,导出可用)
      //   - state.imageStatus='loading' + imageUrl → 嵌 <img> + 加载中文案
      //   - state.imageStatus='error' → 嵌 fallbackHtml("意境暂不可用")
      //   - state.imageStatus='idle' → 嵌 skeletonHtml(进入即有结构)
      let mediaInner = '';
      if (state.imageStatus === 'ok' && state.bgImg) {
        mediaInner = `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer">`;
      } else if (state.imageStatus === 'loading' && state.imageUrl) {
        mediaInner = `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer" class="postcard-media-img--loading">${loadingTipHtml()}`;
      } else if (state.imageStatus === 'error') {
        mediaInner = fallbackHtml();
      }
      // idle / loading 但没 url(理论不应发生) → 走 skeletonHtml 兜底
      els.card.innerHTML = (state.imageStatus !== 'idle')
        ? `
        <div class="postcard" id="pc-festival-postcard">
          <div class="postcard-media">${mediaInner}</div>
          <div class="postcard-body">
            <h3 class="postcard-title">《${escapeHtml(poem.title)}》</h3>
            <p class="postcard-meta">${[poem.dynasty, poem.author, poem.type].filter(Boolean).map(escapeHtml).join(' · ')}</p>
            <hr class="postcard-rule">
            <div class="postcard-content">
              ${poem.content.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            ${state.recipient ? `<p class="postcard-gift">送给 ${escapeHtml(state.recipient)}</p>` : ''}
            ${state.message ? `<p class="postcard-message">${escapeHtml(state.message)}</p>` : ''}
            ${state.sender ? `<p class="postcard-sender">— ${escapeHtml(state.sender)} 敬上</p>` : ''}
            <p class="postcard-foot">古韵抽卡 · 一图一诗</p>
            <span class="postcard-seal" aria-label="印章">${escapeHtml(state.sealText)}</span>
          </div>
        </div>
      `
        : skeletonHtml();
    }

    // v4.1.9 修复: .postcard 默认 opacity: 0(主页面 renderPostcard 用 requestAnimationFrame 加 .is-in)
    //   贺卡页之前漏了这一步, 导致 postcard 永远 opacity:0 用户看不见任何内容
    //   必须每渲染一次就激活(状态机切换 / 换诗 / 输入字段 都会触发 render)
    if (els.card) {
      const card = document.getElementById('pc-festival-postcard');
      if (card) requestAnimationFrame(() => card.classList.add('is-in'));
    }

    // ④ 操作按钮
    if (els.actions) {
      els.actions.innerHTML = `
        <button id="pc-f-btn-next" class="pc-btn" type="button">换一首 ↻</button>
        <button id="pc-f-btn-download" class="pc-btn pc-btn--primary" type="button">下载 PNG</button>
        <button id="pc-f-btn-share" class="pc-btn" type="button">分享</button>
      `;
    }

    bindEvents(festival, poem);
  }

  function bindEvents(festival, poem) {
    // v4.1 独立页 — 直接 document 查询(整个 DOM 都是贺卡屏)
    document.getElementById('pc-festival-back')?.addEventListener('click', onBack);
    document.getElementById('pc-f-btn-next')?.addEventListener('click', onNextPoem);
    document.getElementById('pc-f-btn-download')?.addEventListener('click', onDownload);
    document.getElementById('pc-f-btn-share')?.addEventListener('click', onShare);

    const recipient = document.getElementById('pc-f-field-recipient');
    const sender = document.getElementById('pc-f-field-sender');
    const message = document.getElementById('pc-f-field-message');
    const festivalSel = document.getElementById('pc-f-field-festival');
    const sealSel = document.getElementById('pc-f-field-seal');

    recipient?.addEventListener('input', () => updateField('recipient', recipient.value));
    sender?.addEventListener('input', () => updateField('sender', sender.value));
    message?.addEventListener('input', () => updateField('message', message.value));

    // v4.0.3 节日 select 切换
    festivalSel?.addEventListener('change', () => onFestivalChange(festivalSel.value));

    // v4.0.3 印章 select 切换
    sealSel?.addEventListener('change', () => {
      const seal = sealSel.value;
      updateField('sealText', seal);
      const sealEl = document.querySelector('.postcard-seal');
      if (sealEl) sealEl.textContent = seal;
    });
  }

  // ── 行为 ──
  function updateField(key, value) {
    state[key] = value;
    state.dirty = true;
    draftStore.save(stripForSave(state));
    // 局部更新预览(避免每次 input 都全量 render)
    if (key === 'recipient') updatePreviewRecipient(value);
    else if (key === 'sender') updatePreviewSender(value);
    else if (key === 'message') updatePreviewMessage(value);
    else if (key === 'sealText') updatePreviewSeal(value);
  }

  function updatePreviewRecipient(v) {
    const card = document.querySelector('.postcard-body');
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

  // v4.1.2: 落款(sender)在卡片预览中显式渲染
  function updatePreviewSender(v) {
    const card = document.querySelector('.postcard-body');
    if (!card) return;
    let node = card.querySelector('.postcard-sender');
    if (v) {
      if (!node) {
        node = document.createElement('p');
        node.className = 'postcard-sender';
        const foot = card.querySelector('.postcard-foot');
        (foot || card).insertAdjacentElement('beforebegin', node);
      }
      node.textContent = `— ${v} 敬上`;
    } else if (node) node.remove();
  }

  function updatePreviewMessage(v) {
    const card = document.querySelector('.postcard-body');
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
    const seal = document.querySelector('.postcard-seal');
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
    state.imageStatus = 'idle';   // v4.1.6: 进入 idle, 由 loadImage 切到 loading
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
    state.imageStatus = 'idle';   // v4.1.6: 同上
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
    // v4.1.6: 与主页面 main.js#drawNew 同流程 — fetchSceneImage 拿到 url + img
    //   同步进入 loading 态(让用户看到 <img> 元素 + spinner)
    //   拿到后切换到 ok 态(<img> 显示完整图);失败 → error 态(fallback)
    state.imageStatus = 'loading';
    // 给一个临时 url 用于同步嵌 <img>(浏览器立刻开始加载, 显示 loading 视觉)
    //   真实 url 由 fetchSceneImage 拿到后用 bgImg + url 重渲染
    state.imageUrl = `https://picsum.photos/seed/poem${state.poemId}/720/450`;
    render();
    try {
      const r = await fetchSceneImage(poemWithKeywords, { totalBudgetMs: 6000 });
      if (r && r.img) {
        state.bgImg = r.img;
        state.imageUrl = r.url || state.imageUrl;
        state.imageStatus = 'ok';
        draftStore.save(stripForSave(state));
      } else {
        // fetchSceneImage 都失败: 进入 error 态,显示 fallback
        state.imageStatus = 'error';
      }
    } catch (e) {
      console.error('[festival] loadImage failed', e);
      state.imageStatus = 'error';
    }
    render();
  }

  async function onDownload() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const host = document.querySelector('.postcard');
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
    const host = document.querySelector('.postcard');
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

  function onBack(e) {
    // 草稿在每次 input 都已 debounce 写入 localStorage — 返回主页不会丢
    // dirty 标志是"已下载/分享过"位, 与草稿无关
    if (state.dirty && !confirm('当前贺卡未下载,确定离开?(草稿已自动保存,可在主页保留按钮回到此处继续)')) {
      e?.preventDefault?.();
      return;
    }
    // 让 <a> 自然跳转(默认行为)
    draftStore.flushNow();
  }

  // ── 启动(独立页 — 加载即渲染) ──
  function boot() {
    const draft = draftStore.get();
    if (draft && draft.festivalId && draft.poemId) {
      state = { ...freshState(), ...draft, bgImg: null, imageStatus: 'idle' };
      lastSavedKey = JSON.stringify(stripForSave(state));
    } else {
      state = freshState();
      lastSavedKey = null;
    }
    state.dirty = false;
    // v4.1.6: 同步进入 loading 态,跳过骨架过渡 — 用户一进来就看到 <img> + spinner
    state.imageStatus = 'loading';
    state.imageUrl = `https://picsum.photos/seed/poem${state.poemId}/720/450`;
    render();
    // 异步 fetchSceneImage(覆盖 url + 设置 bgImg 或 status=error)
    loadImage();
  }

  boot();
}