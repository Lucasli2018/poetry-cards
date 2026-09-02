// =============================================================
// 明信片卡片合成 · 导出 PNG · 分享
//
// 输出规格：严格跟随 DOM 实际展示尺寸（导出与展示 1:1），
//   通过 hostEl.getBoundingClientRect() 拿真实 px；
//   然后按 dpr(devicePixelRatio) 锐化输出，
//   确保 retina 屏下导出的 PNG 清晰不糊。
// 比例：上图 1/3 + 下诗 2/3（与 styles.css .postcard-media 比例一致）。
// 版式（竖排明信片）：
//   ┌──────────────┐
//   │   背景图     │  ← cover 裁切，占卡片 1/3 高度
//   │  （诗意配图） │
//   ├──────────────┤
//   │   《诗题》    │
//   │   唐 · 李白   │
//   │  ──────────  │
//   │  诗文横排居中 │  ← 占卡片 2/3 高度
//   │              │
//   │  古韵抽卡 ✦ 诗│
//   └──────────────┘
// =============================================================

// 配图区固定高度(单一真相源,展示 / 骨架 / 导出 canvas 共用)
//   与 styles.css .postcard-media 和 .pc-skeleton-media 的 height: 210px 完全同步
//   改这里必须同步改 styles.css
export const POSTCARD_MEDIA_H = 210;

// dpr 上限:防止 4K 屏导出 PNG 巨大；2x 已足够清晰且控体积
const DPR_CAP = 2;

// 文艺清新配色
const C = {
  paper:   '#fdfcf9',   // 米白纸
  ink:     '#2d2a26',   // 墨黑（偏暖）
  sub:     '#8a8578',   // 灰褐（辅助文字）
  vermil:  '#a8321e',   // 朱砂（印章 / 强调）
  line:    'rgba(45,42,38,0.14)',  // 细分隔线
};

const FONT_SERIF = "'Songti SC','STSong','SimSun','Noto Serif CJK SC','Source Han Serif SC',serif";
const FONT_SANS  = "'PingFang SC','Hiragino Sans GB','Microsoft YaHei','Noto Sans CJK SC',sans-serif";

// ── 工具 ─────────────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 按最大宽度折行（中文按字断行即可） */
function wrapLines(ctx, text, maxWidth) {
  const out = [];
  for (const raw of String(text).split('\n')) {
    if (!raw) { out.push(''); continue; }
    let line = '';
    for (const ch of raw) {
      const test = line + ch;
      if (ctx.measureText(test).width > maxWidth && line) {
        out.push(line);
        line = ch;
      } else {
        line = test;
      }
    }
    if (line) out.push(line);
  }
  return out;
}

/** 朱砂小印：圆角方块 + 「诗」字(默认);v4.0 接受 char 参数切换印章文字 */
function drawSeal(ctx, x, y, size, char = '诗') {
  ctx.save();
  ctx.fillStyle = C.vermil;
  roundRect(ctx, x, y, size, size, size * 0.14);
  ctx.fill();
  ctx.fillStyle = '#fff7e6';
  ctx.font = `700 ${Math.round(size * 0.62)}px ${FONT_SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(char, x + size / 2, y + size / 2 + size * 0.04);
  ctx.restore();
}

/**
 * 计算导出尺寸：基础 px = DOM 真实尺寸；最终 px = 基础 × dpr（封顶 DPR_CAP）。
 * @param {HTMLElement} hostEl  明信片 host 元素
 * @returns {{W:number, H:number, dpr:number}}
 */
function measure(hostEl) {
  const r = hostEl.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
  return {
    // 导出 canvas 像素 = CSS 像素 × dpr(锐化)
    W: Math.round(r.width  * dpr),
    H: Math.round(r.height * dpr),
    // 字号锚:用 CSS 像素(未 dpr),保证字号与页面渲染一致
    cssW: Math.round(r.width),
    cssH: Math.round(r.height),
    dpr,
  };
}

// ── 主绘制 ───────────────────────────────────────────────
/**
 * 解析 options 为内部 normalized 状态。
 * 纯函数,可独立测试;不传 / 空 options → 与 v3.2.9 行为完全一致。
 * @param {object} options
 * @returns {{ hasOptions: boolean, sealChar: string, recipient: string, message: string }}
 */
export function _resolveOptions(options) {
  const o = (options && typeof options === 'object') ? options : {};
  const hasOptions = Object.keys(o).length > 0;
  return {
    hasOptions,
    sealChar: (hasOptions && o.sealText) ? String(o.sealText) : '诗',
    recipient: (hasOptions && o.recipient) ? String(o.recipient) : '',
    message: (hasOptions && o.message) ? String(o.message) : '',
    sender:   (hasOptions && o.sender)   ? String(o.sender)   : '',   // v4.1.2: 落款
  };
}

/**
 * 把「诗 + 图」合成到一张 Canvas。
 * 严格按 DOM 实际尺寸 + dpr 锐化，导出 = 展示 1:1。
 * @param {object} poem   诗泉返回结构 {title, content[], author:{name}, dynasty:{name}, type:{name}}
 * @param {HTMLImageElement|null} bgImg  已带 CORS 的背景图；null 则用水墨渐变
 * @param {HTMLElement} [hostEl]  明信片 DOM 节点（用于量尺寸；可选，向后兼容）
 * @param {object} [options]  v4.0 贺卡选项:{ sender?, recipient?, message?, sealText? }
 *   不传 options / 空对象:与 v3.2.9 像素级一致
 * @returns {HTMLCanvasElement}
 */
export function composeCard(poem, bgImg, hostEl, options = {}) {
  const m = hostEl
    ? measure(hostEl)
    : { W: 1080, H: 1440, cssW: 1080, cssH: 1440, dpr: 1 };   // 兜底:未传 host 时用 3:4 默认值
  const { W: CARD_W, H: CARD_H, dpr } = m;
  // 字号锚 = CSS 像素(未 dpr),与页面渲染 1:1
  const FONT_W = m.cssW;

  // v4.0 贺卡字段解析(纯函数分支;不传 options 时 hasOptions=false,后续跳过所有增量)
  const opt = _resolveOptions(options);

  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d');

  // ① 底：米白纸
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ② 背景图：cover 裁切，占据固定 210px(展示同步,不再按 CARD_H 比例)
  const imgH = Math.round(POSTCARD_MEDIA_H * dpr);
  if (bgImg && bgImg.width && bgImg.height) {
    const scale = Math.max(CARD_W / bgImg.width, imgH / bgImg.height);
    const dw = bgImg.width * scale;
    const dh = bgImg.height * scale;
    const dx = (CARD_W - dw) / 2;
    const dy = (imgH - dh) / 2;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, CARD_W, imgH);
    ctx.clip();
    ctx.drawImage(bgImg, dx, dy, dw, dh);
    ctx.restore();
  } else {
    // 无图兜底：低饱和水墨渐变
    const g = ctx.createLinearGradient(0, 0, CARD_W, imgH);
    g.addColorStop(0, '#e8e4d9');
    g.addColorStop(0.5, '#d5cfc0');
    g.addColorStop(1, '#c2bba9');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, CARD_W, imgH);
  }

  // ③ 渐变遮罩：图片下缘 → 米白，让文字区自然过渡
  const fadeTop = Math.max(imgH - Math.round(CARD_H * 0.06), imgH - 80);
  const grad = ctx.createLinearGradient(0, fadeTop, 0, imgH + 40);
  grad.addColorStop(0, 'rgba(253,252,249,0)');
  grad.addColorStop(0.55, 'rgba(253,252,249,0.82)');
  grad.addColorStop(1, C.paper);
  ctx.fillStyle = grad;
  ctx.fillRect(0, fadeTop, CARD_W, CARD_H - fadeTop);

  // ④ 内边框(细线,明信片感) — v3.2.9 用 FONT_W 锚定 CSS 像素,保证 dpr 缩放下视觉一致
  ctx.strokeStyle = C.line;
  ctx.lineWidth = Math.max(1.5, Math.round(FONT_W / 540));
  roundRect(ctx, Math.round(FONT_W * 0.052), Math.round(FONT_W * 0.052),
            CARD_W - Math.round(FONT_W * 0.104), CARD_H - Math.round(FONT_W * 0.104), 10);
  ctx.stroke();

  // ⑤ 文字区 — 字号用 FONT_W(CSS 像素),间距也跟着 CSS 像素;但坐标仍在 canvas 空间
  const padX = Math.round(FONT_W * 0.12);
  const textW = CARD_W - padX * 2;
  const centerX = CARD_W / 2;
  let y = imgH + Math.round(CARD_H * 0.035);

  // 标题字号按卡片宽度缩放(基于 1080 基准 62px)
  // v3.2.9:用 FONT_W(CSS 像素)而非 CARD_W(已 dpr 锐化),保证字号与页面渲染 1:1
  const titlePx = Math.max(28, Math.round(FONT_W * 0.057));
  const metaPx  = Math.max(16, Math.round(FONT_W * 0.031));
  const linePx  = Math.max(14, Math.round(FONT_W * 0.026));
  const footPx  = Math.max(12, Math.round(FONT_W * 0.025));

  // 标题
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `600 ${titlePx}px ${FONT_SERIF}`;
  const titleLines = wrapLines(ctx, poem.title || '无题', textW);
  for (const ln of titleLines) {
    y += titlePx + Math.round(titlePx * 0.07);
    ctx.fillText(ln, centerX, y);
  }
  y += Math.round(titlePx * 0.42);

  // 作者 · 朝代 · 体裁
  const meta = [
    poem.dynasty?.name,
    poem.author?.name,
    poem.type?.name,
  ].filter(Boolean).join(' · ');
  if (meta) {
    ctx.fillStyle = C.sub;
    ctx.font = `400 ${metaPx}px ${FONT_SANS}`;
    y += metaPx + Math.round(metaPx * 0.1);
    ctx.fillText(meta, centerX, y);
  }
  y += Math.round(metaPx * 0.85);

  // 细分隔线
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX - 90, y);
  ctx.lineTo(centerX + 90, y);
  ctx.stroke();
  y += Math.round(metaPx * 1.6);

  // ⑥ 诗文正文（横排居中）
  const lines = [];
  for (const raw of (poem.content || [])) {
    lines.push(...wrapLines(ctx, raw, textW));
  }
  // 自适应字号：行数多则缩小
  let fontSize = Math.max(linePx, Math.round(linePx * 1.4));
  let lineGap = Math.round(fontSize * 1.65);
  if (lines.length > 12) { fontSize = linePx; lineGap = Math.round(fontSize * 1.55); }
  else if (lines.length > 8) { fontSize = Math.round(linePx * 1.2); lineGap = Math.round(fontSize * 1.6); }
  else if (lines.length > 6) { fontSize = Math.round(linePx * 1.32); lineGap = Math.round(fontSize * 1.65); }

  ctx.fillStyle = C.ink;
  ctx.font = `400 ${fontSize}px ${FONT_SERIF}`;
  for (const ln of lines) {
    y += lineGap;
    ctx.fillText(ln, centerX, y);
  }

  // ── v4.0 增量:送给 / 寄语(opt.hasOptions 时才绘制) ──
  if (opt.hasOptions) {
    const giftPx = Math.max(14, Math.round(FONT_W * 0.026));
    if (opt.recipient) {
      y += giftPx + Math.round(giftPx * 0.4);
      ctx.fillStyle = C.sub;
      ctx.font = `400 ${giftPx}px ${FONT_SANS}`;
      ctx.fillText(`送给 ${opt.recipient}`, centerX, y);
    }
    if (opt.message) {
      y += giftPx + Math.round(giftPx * 0.6);
      ctx.fillStyle = C.vermil;
      ctx.font = `600 ${giftPx}px ${FONT_SERIF}`;
      ctx.fillText(opt.message, centerX, y);
    }
  }

  // ⑦ 底部落款 + 朱砂印(v4.0:印章文字按 opt.sealChar 切换,默认「诗」)
  const footY = CARD_H - Math.round(CARD_H * 0.082);
  ctx.fillStyle = C.sub;
  ctx.font = `400 ${footPx}px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('古韵抽卡 · 一图一诗', padX, footY);

  // v4.1.2: 落款(敬上)— 在页脚上方右侧对齐
  if (opt.hasOptions && opt.sender) {
    const senderPx = Math.max(13, Math.round(FONT_W * 0.024));
    ctx.fillStyle = C.sub;
    ctx.font = `italic 400 ${senderPx}px ${FONT_SERIF}`;
    ctx.textAlign = 'right';
    ctx.fillText(`— ${opt.sender} 敬上`, CARD_W - padX, footY - Math.round(senderPx * 2.4));
  }

  const sealSize = Math.max(36, Math.round(FONT_W * 0.048));
  drawSeal(ctx, CARD_W - padX - sealSize, footY - sealSize + Math.round(footPx * 0.5), sealSize, opt.sealChar);

  return cv;
}

// ── 导出 / 分享 ──────────────────────────────────────────
function safeName(poem) {
  const t = (poem?.title || 'poem').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
  return `古韵抽卡_${t}.png`;
}

/** canvas → Blob */
function toBlob(cv) {
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失败'))), 'image/png');
  });
}

/**
 * 下载卡片 PNG。
 * @param {HTMLCanvasElement} cv
 * @param {object} poem
 * @param {HTMLElement} [hostEl]  透传给 composeCard
 * @returns {Promise<string>} 文件名
 */
export async function downloadCard(cv, poem, hostEl) {
  // 若调用方传了 hostEl 而 cv 未生成,这里重新合成以保证尺寸
  const finalCv = hostEl && !cv ? composeCard(poem, null, hostEl) : cv;
  const blob = await toBlob(finalCv);
  const url = URL.createObjectURL(blob);
  const name = safeName(poem);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 交给浏览器发起下载后稍后释放
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return name;
}

/**
 * 分享卡片。
 * 优先 Web Share API（可直接分享图片文件到微信/相册等）；
 * 不支持则尝试复制诗词文案；再不行返回 'unsupported' 交给调用方提示。
 * @returns {Promise<'shared'|'copied'|'unsupported'|'cancelled'>}
 */
export async function shareCard(cv, poem) {
  const text = [
    `《${poem.title || '无题'}》`,
    [poem.dynasty?.name, poem.author?.name].filter(Boolean).join(' · '),
    '',
    ...(poem.content || []),
    '',
    '—— 古韵抽卡 · 一图一诗',
  ].join('\n');

  if (navigator.share) {
    try {
      const blob = await toBlob(cv);
      const file = new File([blob], safeName(poem), { type: 'image/png' });
      // 部分浏览器不支持分享文件，需先 canShare 探测
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: poem.title || '古韵抽卡', text });
        return 'shared';
      }
      await navigator.share({ title: poem.title || '古韵抽卡', text });
      return 'shared';
    } catch (e) {
      if (e && e.name === 'AbortError') return 'cancelled';
      // 分享失败 → 降级为复制文案
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'unsupported';
  }
}

export const CARD_SIZE = { w: 1080, h: 1440 };
// POSTCARD_MEDIA_H / DPR_CAP 已在文件顶部以 export const 形式导出