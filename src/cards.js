// =============================================================
// 明信片卡片合成 · 导出 PNG · 分享
//
// 输出规格：1080 × 1440 竖版（适合朋友圈/微博分享图、手机壁纸，
//         PNG 体积更小，比原 1200×1600 减少约 30%，但人眼难辨差异）
// 比例：3:4 竖版，与 DOM 显示的 postcard-media (3:4) 完全一致，
//       导出时无需做比例裁切，保真度更高
// 版式（横排明信片）：
//   ┌──────────────┐
//   │   背景图     │  ← cover 裁切铺满整卡
//   │  （诗意配图） │
//   │ ── 渐变遮罩 ──│  ← 下半部渐变为米白，保证文字可读
//   │   《诗题》    │
//   │   唐 · 李白   │
//   │  ──────────  │
//   │  诗文横排居中 │
//   │              │
//   │  古韵抽卡 ✦ 诗泉│
//   └──────────────┘
// =============================================================

const CARD_W = 1080;
const CARD_H = 1440;

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

/** 朱砂小印：圆角方块 + 「诗」字 */
function drawSeal(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = C.vermil;
  roundRect(ctx, x, y, size, size, size * 0.14);
  ctx.fill();
  ctx.fillStyle = '#fff7e6';
  ctx.font = `700 ${Math.round(size * 0.62)}px ${FONT_SERIF}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('诗', x + size / 2, y + size / 2 + size * 0.04);
  ctx.restore();
}

// ── 主绘制 ───────────────────────────────────────────────
/**
 * 把「诗 + 图」合成到一张 Canvas。
 * @param {object} poem  诗泉返回结构 {title, content[], author:{name}, dynasty:{name}, type:{name}}
 * @param {HTMLImageElement|null} bgImg  已带 CORS 的背景图；null 则用水墨渐变
 * @returns {HTMLCanvasElement}
 */
export function composeCard(poem, bgImg) {
  const cv = document.createElement('canvas');
  cv.width = CARD_W;
  cv.height = CARD_H;
  const ctx = cv.getContext('2d');

  // ① 底：米白纸
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // ② 背景图：cover 裁切，占据上方 62%
  const imgH = Math.round(CARD_H * 0.62);
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
  const fadeTop = imgH - 180;
  const grad = ctx.createLinearGradient(0, fadeTop, 0, imgH + 40);
  grad.addColorStop(0, 'rgba(253,252,249,0)');
  grad.addColorStop(0.55, 'rgba(253,252,249,0.82)');
  grad.addColorStop(1, C.paper);
  ctx.fillStyle = grad;
  ctx.fillRect(0, fadeTop, CARD_W, CARD_H - fadeTop);

  // ④ 内边框（细线，明信片感）
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 2;
  roundRect(ctx, 56, 56, CARD_W - 112, CARD_H - 112, 10);
  ctx.stroke();

  // ⑤ 文字区
  const padX = 130;
  const textW = CARD_W - padX * 2;
  const centerX = CARD_W / 2;
  let y = imgH + 40;

  // 标题
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.ink;
  ctx.font = `600 62px ${FONT_SERIF}`;
  const titleLines = wrapLines(ctx, poem.title || '无题', textW);
  for (const ln of titleLines) {
    y += 66;
    ctx.fillText(ln, centerX, y);
  }
  y += 26;

  // 作者 · 朝代 · 体裁
  const meta = [
    poem.dynasty?.name,
    poem.author?.name,
    poem.type?.name,
  ].filter(Boolean).join(' · ');
  if (meta) {
    ctx.fillStyle = C.sub;
    ctx.font = `400 34px ${FONT_SANS}`;
    y += 40;
    ctx.fillText(meta, centerX, y);
  }
  y += 44;

  // 细分隔线
  ctx.strokeStyle = C.line;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(centerX - 90, y);
  ctx.lineTo(centerX + 90, y);
  ctx.stroke();
  y += 62;

  // ⑥ 诗文正文（横排居中）
  const lines = [];
  for (const raw of (poem.content || [])) {
    lines.push(...wrapLines(ctx, raw, textW));
  }
  // 自适应字号：行数多则缩小
  let fontSize = 46;
  let lineGap = 78;
  if (lines.length > 12) { fontSize = 34; lineGap = 58; }
  else if (lines.length > 8) { fontSize = 39; lineGap = 66; }
  else if (lines.length > 6) { fontSize = 43; lineGap = 72; }

  ctx.fillStyle = C.ink;
  ctx.font = `400 ${fontSize}px ${FONT_SERIF}`;
  for (const ln of lines) {
    y += lineGap;
    ctx.fillText(ln, centerX, y);
  }

  // ⑦ 底部落款 + 朱砂印
  const footY = CARD_H - 118;
  ctx.fillStyle = C.sub;
  ctx.font = `400 27px ${FONT_SANS}`;
  ctx.textAlign = 'left';
  ctx.fillText('古韵抽卡 · 一图一诗', padX, footY);

  drawSeal(ctx, CARD_W - padX - 52, footY - 42, 52);

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
 * @returns {Promise<string>} 文件名
 */
export async function downloadCard(cv, poem) {
  const blob = await toBlob(cv);
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

export const CARD_SIZE = { w: CARD_W, h: CARD_H };
