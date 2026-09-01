// =============================================================
// 古韵抽卡 v3.2.5 · DOM → Canvas/Blob(基于 html-to-image)
//
// 把当前 DOM 节点原样导出为 PNG,完全 1:1 复刻页面展示。
//
// 原理:序列化 DOM → 内联 <img> 为 dataURL → 内联 webfont →
//       嵌入 SVG → <img> 加载 SVG → canvas.drawImage → toBlob。
//
// 依赖:html-to-image(v1.11.13, vendored 到 src/vendor/html-to-image/)
//   体积 ≈ 32KB(全部 .js 文件合计),MIT 协议。
//
// 为什么不用自己实现:SVG <foreignObject> 在 macOS Safari / 部分移动端浏览器
// 对 webfont / 跨域图片支持有坑,html-to-image 的 clone-node + embed
// 已经处理了 4 万 star 积累的所有边缘情况。
//
// 与 cards.js 的关系:
//   composeCard() 仍保留,作为「离线/无依赖」路径的兜底;
//   本模块(vendor)作为「首选路径」,失败时降级到 composeCard。
// =============================================================

import * as htmlToImage from '../vendor/html-to-image/index.js';

const DEFAULTS = Object.freeze({
  pixelRatio: 2,                 // 锐化倍率(与 v3.2 保持一致)
  backgroundColor: '#fdfcf9',    // 米白纸色,避免透明背景 PNG 在某些看图器里变黑
  cacheBust: true,               // 强制重新加载图片,避免拿到缓存中的旧图
});

/**
 * DOM 节点 → HTMLCanvasElement (dpr 锐化)
 * @param {HTMLElement} el  要截图的 DOM 节点
 * @param {object} [opts]   透传 html-to-image 选项(覆盖默认)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function domToCanvas(el, opts = {}) {
  if (!el) throw new Error('domToCanvas: el 不能为空');
  const options = { ...DEFAULTS, ...opts };

  // html-to-image 1.11.13 在超大尺寸 + 慢机器上偶尔抛 "Maximum canvas size exceeded"
  // 原因:大尺寸 SVG 转 <img> 时 canvas 像素超 16384 / 16777216 上限。
  // 防护:缩放 pixelRatio 到不超过浏览器安全上限。
  const r = el.getBoundingClientRect();
  const ratio = Math.min(options.pixelRatio, 16384 / Math.max(r.width, 1), 16384 / Math.max(r.height, 1));
  if (ratio < options.pixelRatio) options.pixelRatio = Math.floor(ratio) || 1;

  return htmlToImage.toCanvas(el, options);
}

/**
 * DOM 节点 → PNG Blob(一步到位)
 * @param {HTMLElement} el
 * @param {object} [opts]
 * @returns {Promise<Blob>}
 */
export async function domToBlob(el, opts = {}) {
  const cv = await domToCanvas(el, opts);
  return new Promise((resolve, reject) => {
    cv.toBlob((b) => (b ? resolve(b) : reject(new Error('canvas.toBlob 失败'))), 'image/png');
  });
}