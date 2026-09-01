// =============================================================
// 古韵抽卡 v3.2 · DOM → Canvas 截图(零依赖)
//
// 把当前 DOM 节点原样导出为 PNG,完全 1:1 复刻页面展示。
// 原理:序列化 DOM → 嵌入 SVG <foreignObject> → 转为 dataURL
//       → <img> 加载 → 画到 canvas → toBlob('PNG
//
// 限制:
//   1) 必须同源(整页就是同源,无问题)
//   2) 外部图片必须已带 CORS 头(Pollinations/LoremFlickr/Picsum 均满足)
//   3) <img> 加载 dataURL 时,canvas 不会被污染(同源规则)
//   4) 内嵌的 web font 需浏览器已加载(已在页面中渲染 → 已加载)
//
// 参考:https://stackoverflow.com/a/62224755(html-to-image 思路)
// =============================================================

/**
 * 克隆 DOM 节点,把图片 src 同步成已加载的 dataURL,避免 foreignObject
 * 加载时再触发网络请求(网络图跨域 / 时序不可控)。
 */
async function inlineImages(root) {
  const imgs = [...root.querySelectorAll('img')];
  await Promise.all(imgs.map(async (img) => {
    try {
      if (!img.complete || img.naturalWidth === 0) {
        await new Promise((res) => {
          img.onload = res;
          img.onerror = res;     // 失败也继续,不影响整体导出
          setTimeout(res, 2000); // 兜底超时
        });
      }
      // 用 canvas 中转 → dataURL,这样 SVG 里引用就是同源
      const cv = document.createElement('canvas');
      cv.width = img.naturalWidth || img.width || 100;
      cv.height = img.naturalHeight || img.height || 100;
      const ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      img.src = cv.toDataURL('image/png');
    } catch {
      // 单图失败不影响其他
    }
  }));
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * DOM 节点 → HTMLCanvasElement (dpr 锐化)
 * @param {HTMLElement} el  要截图的 DOM 节点
 * @param {number} [scale=2] 锐化倍率(导出像素 = 实际尺寸 × scale)
 * @returns {Promise<HTMLCanvasElement>}
 */
export async function domToCanvas(el, scale = 2) {
  if (!el) throw new Error('domToCanvas: el 不能为空');

  // ① 把 <img> 都内联成 dataURL(同源 + 同步加载,SVG 才能正确嵌入)
  await inlineImages(el);

  // ② 测尺寸
  const r = el.getBoundingClientRect();
  const W = r.width, H = r.height;

  // ③ 序列化 DOM + 内嵌到 SVG
  const xml = new XMLSerializer().serializeToString(el);
  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <foreignObject width="100%" height="100%" style="background:${getComputedStyle(el).backgroundColor || 'transparent'}">
    <div xmlns="http://www.w3.org/1999/xhtml" style="width:${W}px;height:${H}px;">
      ${xml}
    </div>
  </foreignObject>
</svg>`;
  const svgBlob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const svgUrl = URL.createObjectURL(svgBlob);

  // ④ 把 SVG 加载成 <img> → 画到 canvas(锐化)
  const out = document.createElement('canvas');
  out.width = Math.round(W * scale);
  out.height = Math.round(H * scale);
  const ctx = out.getContext('2d');
  ctx.scale(scale, scale);

  await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0, W, H);
      URL.revokeObjectURL(svgUrl);
      resolve();
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(svgUrl);
      reject(new Error('SVG → IMG 加载失败:' + (e?.message || 'unknown')));
    };
    img.src = svgUrl;
  });

  return out;
}