// =============================================================
// 古韵抽卡 v3.1 · 共享 modal/drawer 容器
// 职责:
//   - 提供 mount(host) / open(tab) / close() / unmount() 句柄
//   - 三个 tab(收藏 / 历史 / 统计)共用同一容器,切换 tab 不重渲染
//   - ESC + 点击背景关闭;关闭时保留数据,下次 open 直接显示最新
//
// 设计:零依赖,纯 DOM 拼装;UI 模块只接收数据快照,不碰 store。
// =============================================================

export function createMemoryPanel() {
  let host = null;
  let backdrop = null;
  let modal = null;
  let titleEl = null;
  let bodyEl = null;
  let tabButtons = [];
  let currentTab = 'favorites';
  let lastSnapshot = null;     // 上一次拿到的数据快照(供 open 时复用)
  const renderers = {};        // tab key → 渲染函数(由调用方注入)

  function build() {
    backdrop = document.createElement('div');
    backdrop.className = 'pc-modal-backdrop';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');

    modal = document.createElement('div');
    modal.className = 'pc-modal';

    const head = document.createElement('div');
    head.className = 'pc-modal-head';
    titleEl = document.createElement('h2');
    titleEl.className = 'pc-modal-title';
    titleEl.textContent = '记忆';
    const closeBtn = document.createElement('button');
    closeBtn.className = 'pc-modal-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', '关闭');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', close);
    head.append(titleEl, closeBtn);

    const tabs = document.createElement('div');
    tabs.className = 'pc-modal-tabs';
    tabs.setAttribute('role', 'tablist');
    for (const t of [
      { key: 'favorites', label: '收藏' },
      { key: 'history',   label: '历史' },
      { key: 'stats',     label: '统计' },
    ]) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pc-modal-tab';
      b.dataset.tab = t.key;
      b.textContent = t.label;
      b.setAttribute('role', 'tab');
      b.addEventListener('click', () => switchTo(t.key));
      tabs.appendChild(b);
      tabButtons.push(b);
    }

    bodyEl = document.createElement('div');
    bodyEl.className = 'pc-modal-body';

    modal.append(head, tabs, bodyEl);
    backdrop.appendChild(modal);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop.classList.contains('is-open')) close();
    });

    document.body.appendChild(backdrop);
  }

  function switchTo(key) {
    currentTab = key;
    for (const b of tabButtons) {
      const on = b.dataset.tab === key;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    if (lastSnapshot) renderBody();
  }

  function renderBody() {
    if (!bodyEl) return;
    const fn = renderers[currentTab];
    bodyEl.innerHTML = '';
    if (!fn) {
      bodyEl.textContent = '（未配置）';
      return;
    }
    const node = fn(lastSnapshot);
    if (node instanceof Node) bodyEl.appendChild(node);
    else if (typeof node === 'string') bodyEl.innerHTML = node;
  }

  function open(tab) {
    if (!backdrop) return;
    if (tab && tab !== currentTab) switchTo(tab);
    backdrop.classList.add('is-open');
    if (lastSnapshot) renderBody();
  }

  function close() {
    if (!backdrop) return;
    backdrop.classList.remove('is-open');
  }

  function update(snapshot) {
    lastSnapshot = snapshot;
    if (backdrop && backdrop.classList.contains('is-open')) renderBody();
  }

  return {
    mount(mountHost) {
      host = mountHost || document.body;
      build();
    },
    registerRenderer(tabKey, fn) {
      renderers[tabKey] = fn;
    },
    open,
    close,
    update,
    get currentTab() { return currentTab; },
    unmount() {
      backdrop?.remove();
      backdrop = null; modal = null; titleEl = null; bodyEl = null;
      tabButtons = [];
    },
  };
}