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
//   - 复用 fetchSceneImage(双源:LoremFlickr → Picsum 兜底)
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
      // v4.5.0: 与主页面 main.js#drawNew 走同一流程 — 进入即嵌 <img>
      //   - state.imageStatus='ok' + bgImg → 直接嵌 <img src>(已 CORS 化,导出可用)
      //   - state.imageStatus='error' → 嵌 fallbackHtml("意境暂不可用")
      //   - state.imageStatus='loading' / 'idle' → 嵌 <img> 占位(等 fetchSceneImage 回调替换)
      //   v4.5.0 起去掉 loading-tip spinner — 与主页一致, 仅按钮 .is-busy 旋转反馈
      let mediaInner = '';
      if (state.imageStatus === 'ok' && state.bgImg) {
        mediaInner = `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer">`;
      } else if (state.imageStatus === 'error') {
        mediaInner = fallbackHtml();
      } else if (state.imageUrl) {
        // loading / idle 状态: 嵌临时 <img>, 等 fetchSceneImage 回调 updatePostcardImage 替换
        mediaInner = `<img src="${escapeHtml(state.imageUrl)}" alt="" crossorigin="anonymous" referrerpolicy="no-referrer">`;
      }
      // idle / loading 但没 url(理论不应发生) → 走 skeletonHtml 兜底
      els.card.innerHTML = (state.imageStatus !== 'idle')
        ? `
        <div class="postcard" id="pc-festival-postcard">
          <div class="postcard-media">${mediaInner}
            <button class="pc-swap-img" type="button" title="换一张配图（保留诗词）" aria-label="换一张配图">
              <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
                <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46A7.93 7.93 0 0 0 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74A7.93 7.93 0 0 0 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
              </svg>
            </button>
          </div>
          <div class="postcard-body">
            <h3 class="postcard-title">《${escapeHtml(poem.title)}》</h3>
            <p class="postcard-meta">${[poem.dynasty, poem.author, poem.type].filter(Boolean).map(escapeHtml).join(' · ')}</p>
            <hr class="postcard-rule">
            <div class="postcard-content">
              ${poem.content.map(line => `<p>${escapeHtml(line)}</p>`).join('')}
            </div>
            ${(state.recipient || state.message || state.sender) ? `
            <hr class="postcard-rule postcard-rule--fields">
            <div class="postcard-user-fields">
              ${state.recipient ? `<p class="postcard-gift">送给 ${escapeHtml(state.recipient)}</p>` : ''}
              ${state.message ? `<p class="postcard-message">${escapeHtml(state.message)}</p>` : ''}
              ${state.sender ? `<p class="postcard-sender">— ${escapeHtml(state.sender)} 敬上</p>` : ''}
            </div>` : ''}
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
    // v4.3.0: 贺卡图区「换图」按钮(参考主页面 .pc-swap-img) — 复用当前诗词, 只换图
    document.getElementById('pc-festival-postcard')?.querySelector('.pc-swap-img')?.addEventListener('click', onSwapImage);

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

  // v4.6: 图源优先级(高→低), 用于「不降级」保护
  const SCENE_RANK = { none: 0, Picsum: 1, LoremFlickr: 2 };

  // v4.7.0: 与主页面 main.js#drawNew 同策略 — 双源并发(LoremFlickr 优先 + Picsum 兜底)
  //   boot 时卡片骨架已渲染(诗词+字段完整);本函数:
  //     - 立即 fetchSceneImage 同时发起双源
  //     - onLoremFlickr: 主源, 主题贴合, 4s 超时
  //     - onPicsum: LoremFlickr 失败 → 用 Picsum(稳定兜底)
  //     - 失败/超时: 已有图则静默保留, 无图才显示 fallback
  async function loadImage() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const festival = getFestivalById(state.festivalId);
    const poemWithKeywords = {
      ...entry.poem,
      imageTags: festival?.themeKeywords || entry.festival.themeKeywords,
    };
    // 同步进入 loading 态 — boot() 已写过 render(), 这里只更新 imageStatus
    //   v4.5.0 起去掉 loading-tip spinner;卡片显示临时 picsum URL 的 <img>,
    //   等 fetchSceneImage 回调 updatePostcardImage 替换
    state.imageStatus = 'loading';
    state.imageUrl = `https://picsum.photos/seed/poem${state.poemId}/720/450`;
    const hadImg = !!state.bgImg;     // 首屏通常是 false; 切节日若上次图还在则为 true
    const prevBgImg = state.bgImg;    // v4.5.1: 备份原图, 全失败时回填
    const prevImageUrl = state.imageUrl;
    try {
      let committedRank = 0;
      const commit = (r) => {
        if (state.poemId !== entry.poem.id) return;
        if ((SCENE_RANK[r.source] || 0) < committedRank) return;
        committedRank = SCENE_RANK[r.source] || 0;
        state.bgImg = r.img;
        state.imageUrl = r.url;
        state.imageStatus = 'ok';
        updatePostcardImage(r.url, r.source, r.img);
        draftStore.save(stripForSave(state));
      };
      const final = await fetchSceneImage(poemWithKeywords, {
        onPicsum: commit,
        onLoremFlickr: commit,
      });
      if (state.poemId !== entry.poem.id) return;
      // v4.5.1: 全失败 — 已有图则静默回填保留(不动 DOM), 无图才显示 fallback
      if (!final || !final.img) {
        if (hadImg && prevBgImg) {
          // 已有图保留 — 恢复 bgImg / imageUrl(回调中可能已改为 Picsum 但不准确)
          state.bgImg = prevBgImg;
          state.imageUrl = prevImageUrl;
          state.imageStatus = 'ok';
        } else {
          state.imageStatus = 'error';
          render();
        }
      } else if (state.imageStatus !== 'ok' && !hadImg) {
        // 兜底 — 理论上不会到这里
        state.imageStatus = 'error';
        render();
      }
    } catch (e) {
      console.error('[festival] loadImage failed', e);
      if (state.poemId === entry.poem.id) {
        if (hadImg && prevBgImg) {
          // 已有图保留
          state.bgImg = prevBgImg;
          state.imageUrl = prevImageUrl;
          state.imageStatus = 'ok';
        } else {
          state.imageStatus = 'error';
          render();
        }
      }
    }
  }

  // v4.5.0: 复用主页 main.js#swapImage 模式 — 双源并发渐进增强 + 失败保留原图
  //   与主页语义对齐:
  //     · 复用 fetchSceneImage 的 onPicsum/onLoremFlickr 回调, 谁先到谁先替换
  //     · 全失败时若原本就有图(state.bgImg), 静默保留原图 + toast 提示
  //     · 全失败且原本无图, 才显示 fallbackHtml("意境暂不可用")
  //   不再显示加载中 spinner / 文案 — 按钮 .is-busy 旋转反馈即可
  //   不再 render() 全卡重建 — updatePostcardImage 局部替换 <img src>
  let _busy = false;
  let _swapSeq = 0;
  async function onSwapImage() {
    if (_busy) return;
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const festival = getFestivalById(state.festivalId);
    const btn = document.querySelector('#pc-festival-postcard .pc-swap-img');
    btn?.classList.add('is-busy');
    _busy = true;
    const seq = ++_swapSeq;
    const hadImg = !!state.bgImg;   // 换图前是否已有图 — 决定失败行为
    const prevBgImg = state.bgImg;  // v4.5.1: 备份原图, 全失败时保留显示
    const prevImageUrl = state.imageUrl;
    try {
      const poemWithKeywords = {
        ...entry.poem,
        imageTags: festival?.themeKeywords || entry.festival.themeKeywords,
      };
      let picsumShown = false;
      let loremShown = false;
      let committedRank = 0;
      const commit = (r) => {
        if (seq !== _swapSeq) return;
        if ((SCENE_RANK[r.source] || 0) < committedRank) return;
        committedRank = SCENE_RANK[r.source] || 0;
        if (r.source === 'Picsum') picsumShown = true;
        else if (r.source === 'LoremFlickr') loremShown = true;
        state.bgImg = r.img;
        state.imageUrl = r.url;
        state.imageStatus = 'ok';
        updatePostcardImage(r.url, r.source, r.img);
        draftStore.save(stripForSave(state));
      };
      const finalResult = await fetchSceneImage(poemWithKeywords, {
        seed: Date.now() + Math.floor(Math.random() * 1e6),
        onPicsum: commit,
        onLoremFlickr: commit,
      });
      if (seq !== _swapSeq) return;

      // v4.7.0: 反馈 — LoremFlickr=意境图 / Picsum=配图; 全失败保留原图
      if (loremShown) showToast('已换意境图', 'success');
      else if (picsumShown) showToast('已换一张配图', 'success');
      else if (hadImg && prevBgImg) showToast('配图暂不可用，已保留原图', 'error');
      else {
        // 原本无图 — 走 fallback "意境暂不可用"
        state.imageStatus = 'error';
        render();
        showToast('配图暂不可用，请稍后重试', 'error');
      }
    } catch (e) {
      console.error('[festival] swapImage failed', e);
      // v4.5.1: 异常 — 同样保留原图(若有);state.bgImg/imageUrl 已不变
      if (hadImg) {
        showToast('换图失败，已保留原图', 'error');
      } else {
        state.imageStatus = 'error';
        render();
        showToast('换图失败，请稍后重试', 'error');
      }
    } finally {
      _busy = false;
      btn?.classList.remove('is-busy');
    }
  }

  // v4.3.1: 局部更新贺卡 .postcard-media 的 <img src> (与主页面 updateImageOnly 对齐)
  //   v4.5.0: 移除 loading-tip 清理(loading-tip 已废弃);保留 fallback 清理(全失败时 fallback 不该保留)
  //   v4.5.1: 接受可选 readyImg(已 CORS 加载完成的 HTMLImageElement);
  //     关键修复 — 新图节点插入后才移除老图, 杜绝 "换图反而无图" 闪屏
  function updatePostcardImage(url, source, readyImg) {
    const media = document.querySelector('#pc-festival-postcard .postcard-media');
    if (!media) { render(); return; }
    // 移除 error fallback(全失败时 fallback 不该保留)
    const fallback = media.querySelector('.postcard-media-fallback');
    if (fallback) fallback.remove();
    const old = media.querySelector('img');
    // v4.5.1: 先插入新节点再移除老节点 — 保证视觉上始终有一张图
    let appended = false;
    if (readyImg) {
      // 已 loaded 的 img, 设同 src 浏览器命中缓存
      const ni = document.createElement('img');
      ni.alt = '诗意配图';
      ni.crossOrigin = 'anonymous';
      ni.referrerPolicy = 'no-referrer';
      ni.src = readyImg.src;
      const swapBtn = media.querySelector('.pc-swap-img');
      if (swapBtn) media.insertBefore(ni, swapBtn);
      else media.appendChild(ni);
      appended = true;
    } else if (url) {
      const ni = document.createElement('img');
      ni.alt = '诗意配图';
      ni.crossOrigin = 'anonymous';
      ni.referrerPolicy = 'no-referrer';
      ni.src = url;
      const swapBtn = media.querySelector('.pc-swap-img');
      if (swapBtn) media.insertBefore(ni, swapBtn);
      else media.appendChild(ni);
      appended = true;
    }
    // 新节点就位后才清老图
    if (appended && old) old.remove();
  }

  async function onDownload() {
    const entry = getPoemById(state.poemId);
    if (!entry) return;
    const host = document.querySelector('.postcard');
    // v4.2.0: 与主页 main.js#onDownload 完全对齐 — downloadCard 不再传 hostEl
    //   同时显式 exportSize={w:1080,h:1440} 强制标准分享图大小(无论 host 实际多大)
    //   主页在 hostEl 路径下,桌面 dpr=1 实际只导出 ~520×~490,远小于 README 描述的 1080×1440
    //   用户报"贺卡下载大小不对"——对齐主页实现 + 修正导出尺寸,导出标准 1080×1440 PNG
    const cv = composeCard(entry.poem, state.bgImg, host, {
      sender: state.sender, recipient: state.recipient,
      message: state.message, sealText: state.sealText,
      exportSize: { w: 1080, h: 1440 },
    });
    try {
      const name = await downloadCard(cv, entry.poem);
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
    // v4.2.0: 与 onDownload 一致 — 显式 exportSize={w:1080,h:1440}
    const cv = composeCard(entry.poem, state.bgImg, host, {
      sender: state.sender, recipient: state.recipient,
      message: state.message, sealText: state.sealText,
      exportSize: { w: 1080, h: 1440 },
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