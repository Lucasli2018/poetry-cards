# 古韵抽卡 · 一图一诗

> 随机一首古诗词，配一张贴题意象的美图，合成一张可保存的明信片。
> **v4.1.9** · 文艺清新 · 零依赖 · 零构建 · 可下载 · 可分享 · **节日贺卡**

打开页面即自动呈上一张「一图一诗」的明信片，按空格或点「换一张」再来一张；
或在首页点「🎴 贺卡」进入节日贺卡编辑器，自定义收信人/落款/寄语/印章，做一张专属贺卡 PNG。

## 功能

- 🖼️ **一进页面就出片**：自动取 1 首随机诗词 + 1 张配图，直接合成明信片，无需点击（默认走本地库，秒开）
- 🎨 **AI 意象配图**：从诗词提取意象生成 AI 提示词出图，配图贴着诗意；失败降级风景关键词图
- 📮 **明信片版式**：横排诗词居中、大留白、细线分隔、朱砂小印
- ⬇️ **导出 PNG**：Canvas 合成 **1080×1440**（3:4）竖版图，一键下载
- 🔗 **分享**：Web Share API 直接分享图片（移动端）；不支持则自动回退为「复制诗词文案」
- 🌙 **暗色模式**：自动 / 亮色 / 暗色 三态切换，跟随系统 + 手动切换 + 本地记忆；按钮为 SVG 图标（自动屏+系统圆 / 太阳 / 月牙）
- 🎴 **节日贺卡**（首页 🎴 入口 → `festival.html`）：5 个节日（春节/端午/中秋/重阳/生日）× 31 首精选诗；4 个自定义字段（收信人/落款/寄语/印章）；草稿自动保存；下载/分享复用 `composeCard`
- ⌨️ **空格换一张**：桌面端快捷键
- 📱 **PWA**：可安装到桌面 / 主屏，离线仍可读到上一次内容
- 🛡️ **降级兜底**：接口不可用时自动切本地 70 首诗词库，顶部横幅提示 + 「重试恢复」按钮
- 📚 **经典诗词**（默认开启）：默认只从本地 70 首经典诗词库抽取，完全离线、不发远程请求；关闭则切回诗泉全网随机，状态本地记忆
- 📖 **按钮说明**：底部常驻说明区，一行讲清「经典诗词 / 换一张 / 下载卡片 / 分享」各自的用途

## 请求纪律（关键）

每次「换一张」**严格只发 2 个请求**：1 次 `/api/poems/random` + 1 次图片请求。四重保障：

| 机制 | 作用 |
| --- | --- |
| `_busy` 同步锁 | 连击 / 空格 / 触摸二次触发，一律在入口处丢弃 |
| `_lastClickAt` 250ms 防抖 | 防移动端 tap×2 |
| `AbortController` | 取消在途旧请求，避免旧响应覆盖新结果 |
| 令牌桶 + 熔断（`api.js`） | 容量 6 / 3 每秒 / 并发 ≤2；连续 5 次失败开路，冷却 10s 后半开探测 |

> 历史包袱：v2.0 曾用「池化预加载」（一次并发 6 个 random），会瞬间触发诗泉 API 的 429 限流，已于 v2.2 起彻底移除。

## 数据源

**诗词** · [诗泉](https://poetry.palemoky.com/) 免费开源 API（37 万+ 首 / 1.3 万+ 诗人）

**配图** · 多源守护，按优先级：

1. **Picsum**（v4.1.3 起作主源）— seed 稳定随机风景图，秒出稳定，`Access-Control-Allow-Origin: *`
2. **Pollinations AI** — 根据诗词意象生成专属配图，主题贴合；`Access-Control-Allow-Origin: *`，实际 3-5s 出图
3. **水墨渐变 / 静态兜底** — 纯 CSS 兜底，任何情况都有底

> v4.1.3 把主源从 Pollinations 切到 Picsum（秒出稳定，用户等不及），Pollinations 仍作主题贴合的备源；LoremFlickr 保留代码但未在调用链中使用。

> ⚠️ **Unsplash Source**（`source.unsplash.com`）已于 2024 年下线，已全面移除。

### 图片规格

| 环节 | 尺寸 / 比例 | 说明 |
| --- | --- | --- |
| 图片请求 | 720 × 450（约 16:10） | `SCENE_IMG_W/H`（`images.js`），体积小，AI 出图快 |
| 页面图区高度 | 210px（宽度自适应容器） | `.postcard-media`，`object-fit: cover` 裁切 |
| 导出 PNG | 1080 × 1440（3:4） | `CARD_SIZE`（`cards.js`），`composeCard` 按 dpr 锐化 |
>
> 💡 图源必须带 CORS 头，否则 Canvas 会被污染（tainted），`toDataURL()` 直接抛 `SecurityError`，导出功能将完全不可用。因此图片加载统一设 `crossOrigin='anonymous'`。

### 图片超时分配（v4.1.8 起）

每源不再硬 cap，超时按总预算比例分配：

| 调用方 | 总预算 `totalBudgetMs` | Picsum | Pollinations |
| --- | --- | --- | --- |
| `drawNew` 首屏（默认） | 4000 | ≤2000ms | 3000-8000ms |
| 贺卡页 `loadImage` | 6000 | ≤2000ms | 4800ms |
| 用户主动 `swapImage` ↻ | **10000** | ≤2000ms | **8000ms** |

主动操作值得等 AI 出图，不秒出 fallback。

## 技术栈

- **零依赖**：原生 HTML + ES Modules + CSS，没有 npm、没有构建步骤
- **双页**：`index.html`（主页抽卡）+ `festival.html`（节日贺卡），各自独立入口
- **7 + 4 ≈ 11 个源文件**，约 2200 行

## 项目结构

```
poetry-cards/
├── index.html              主页入口（抽卡屏）
├── festival.html           贺卡页入口（节日贺卡编辑器，v4.1）
├── styles.css              文艺清新主题（亮/暗双套 CSS 变量 + 贺卡样式）
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker（网络优先 + 离线回退）
├── assets/
│   └── icons/              favicon.svg/.ico/-32.png · apple-touch-icon.png · icon-192/512.png
├── scripts/
│   ├── serve.py            零依赖本地静态服务器（修正 .js/.webmanifest MIME，跨平台可用）
│   ├── make_favicon.py     纯标准库生成图标（struct+zlib 手写 PNG/ICO，输出至 assets/icons）
│   ├── test-store.mjs      store 单测（90 用例，纯 node 无依赖）
│   ├── test-storage-dialog.mjs  导入/导出 单测（27 用例）
│   ├── test-festival.mjs   festival 单测（108 用例）
│   └── check-modules.mjs   ESM 模块链路冒烟
└── src/
    ├── main.js             主流程：一图一诗 · 请求纪律 · 主题切换 · v3.1 记忆入口
    ├── images.js           意象提取 + 图片多源守护（extractThemes 已 export，超时按预算分配）
    ├── cards.js            Canvas 合成明信片 + 下载 + 分享
    ├── poems.local.json    本地兜底诗词库（70 首）
    ├── net/                网络层（统一请求 + 限流 + 熔断）
    │   ├── api.js          统一请求层：令牌桶→退避(全抖动)→熔断→失败分类
    │   ├── rate-limit.js   令牌桶（含空桶死锁修复）
    │   └── circuit-breaker.js  熔断器
    ├── store/              v3.1 个性化记忆
    │   ├── schema.js       schema 常量 + 容错解析 + 容量守卫
    │   ├── favorites.js    收藏 store(按 poem.id 去重,200 上限)
    │   ├── history.js      抽卡历史(滚动队列,200 上限)
    │   └── stats.js        累计 / 今日 / 朝代 / 意象统计
    ├── ui/                 v3.1 UI
    │   ├── memory-panel.js 共享 modal(三个 tab + ESC/外部关闭)
    │   ├── renderers.js    三个 tab 的渲染器(纯函数,易测)
    │   ├── dom-to-canvas.js DOM-to-canvas 1:1 还原路径（保留，备用）
    │   └── storage-dialog.js 导出/导入 JSON(合并去重)
    ├── festival-data.js    节日加载 + 查询 + 节日日判定（公历映射 2026）
    ├── festival-draft.js   草稿 store（debounce + parseSafe + 5KB 截断）
    ├── festival-ui.js      贺卡页 DOM/状态/输入绑定/加载状态机(v4.1.6)/opacity 修复(v4.1.9)
    ├── festival-main.js    贺卡页入口
    └── festivals.json      5 节日 × 31 首精选诗
```

## 数据流

### 主页抽卡屏

```
页面加载
  ├─ 经典诗词模式（默认开启）→ 直接取本地 70 首，0 请求
  └─ 关闭时：
       ├─ 请求 1  apiRequest('/api/poems/random')      ── 唯一一次
       │    └─ 失败 → 本地 70 首兜底 + 降级横幅
       └─ 请求 2  fetchSceneImage(poem)                ── 唯一一次
            ├─ 从诗词正文提取意象 → 英文提示词 / 风景关键词
            └─ Picsum(秒出) → Pollinations(主题) → CSS 兜底
  ↓
渲染明信片（DOM .is-in 激活显示）
  ↓
点「下载」→ composeCard() 用同一张 CORS 图合成 Canvas → 1080×1440 PNG
点「分享」→ navigator.share({files}) → 失败则复制文案
点「↻」→ swapImage(10000ms) 仅重取图片
```

> 默认开启「经典诗词」后，首屏不发任何远程诗词请求，只发 1 次配图请求。

### 贺卡屏（v4.1 festival.html）

```
页面加载
  ├─ boot() 同步 state.imageStatus='loading' + 临时 picsum URL
  └─ render() 嵌 <img>+spinner (浏览器开始加载)
  └─ loadImage() 异步 fetchSceneImage(6000ms)
       ├─ 成功 → state.imageStatus='ok' → 整卡重渲染 → .is-in 激活
       ├─ 失败 → state.imageStatus='error' → fallback "意境暂不可用"
       └─ 异常 → catch 块也保护 → error 态
  ↓
用户输入收信人/落款/寄语 → debounce 500ms 写入 pc_v3_festival_draft
  ↓
点「下载 PNG」→ composeCard(poem, bgImg, host, {recipient, sender, message, sealText})
              → Canvas 1080×1440 PNG
```

## 启动（本地预览）

项目使用原生 ES Modules，**必须经 http(s) 访问**——双击 `index.html` 用 `file://` 打开会因跨域加载不到模块，页面会空白。

### ✅ 推荐：项目内置零依赖服务器（跨平台通用）

已附带 `scripts/serve.py`（纯标准库，无需联网、且显式修正 `.js` / `.webmanifest` 的 MIME，
避免 Windows 上 `python -m http.server` 把 `.js` 当 `application/octet-stream` 导致模块加载失败）。

```bash
# 在项目根目录执行
python scripts/serve.py
# 自定义端口
python scripts/serve.py 8080
# 浏览器打开
#   http://localhost:8080/         # 主页抽卡
#   http://localhost:8080/festival.html  # 节日贺卡
```

> 若装的是 Windows 应用商店版 Python，命令用 `py scripts/serve.py`。

### 其他可用方式（任选其一，均需先进入项目根目录）

- **Python 标准库（需显式修正 MIME）**
  Windows 上 `python -m http.server` 常把 `.js` 识别成 `application/octet-stream`，浏览器会拒绝加载模块脚本。
  用下面这行强制正确 MIME 后再访问 `http://localhost:8080`：
  ```bash
  python -c "import http.server,mimetypes; mimetypes.add_type('text/javascript','.js'); mimetypes.add_type('application/manifest+json','.webmanifest'); http.server.test()"
  ```
- **Node（首次需联网拉包，较慢）**
  ```bash
  npx --yes serve .
  # 或 npx --yes http-server . -p 8080 -c-1
  ```

> 🔧 排错：页面空白先按 F12 看 Console。若报 `Failed to load module script … MIME type …`，
> 说明 `.js` 被当成非 JS 类型——请改用上面的 `scripts/serve.py` 或带 MIME 修正的 Python 命令。

### 已部署（无需本地启动）

主站在 **Cloudflare Pages**，推送即自动部署；同时同步到 GitHub Pages。直接访问任一地址即可：

- 🚀 **Cloudflare Pages**（主）: <https://poetry-cards.pages.dev/>
  - 主页：<https://poetry-cards.pages.dev/>
  - 贺卡：<https://poetry-cards.pages.dev/festival.html>
- 🐙 **GitHub Pages**（镜像）: <https://lucasli2018.github.io/poetry-cards/>

> 历史地址:曾托管在 `https://li-luoqiang.gitee.io/poetry-cards/`,现已迁移到 Cloudflare Pages,
> 旧链接不再保证可用,请以上面两个为准。

## 部署

项目**多端自动同步**,只需 `git push origin master`,三端同步生效:

| 平台 | 仓库 | 自动部署 |
| --- | --- | --- |
| 🚀 **Cloudflare Pages**(主) | `li-luoqiang/poetry-cards` (Gitee) → Cloudflare 自动构建 | Cloudflare Pages 监听 Gitee 仓库,推送即部署到 <https://poetry-cards.pages.dev/> |
| 🐙 **GitHub Pages**(镜像) | `lucasli2018/poetry-cards` | 由 GitHub Actions / Pages 自动构建,镜像到 <https://lucasli2018.github.io/poetry-cards/> |
| 📦 **Gitee 仓库**(源) | `gitee.com/li-luoqiang/poetry-cards` | 作为唯一上游仓库,标签 `v*` 在此归档 |

> 因此日常开发**只需 `git push origin master`**,Cloudflare Pages + GitHub Pages 会自动跟随更新。

## 更新日志

### v4.1.9 (2026-09-03) — 修贺卡页 postcard 永远 opacity:0 致命 bug

**这就是改了几次没修好的根因。** styles.css `.postcard` 默认 `opacity:0` + `transform: translateY(14px)`，必须 `.is-in` class 才显示；主页 `renderPostcard` 在 `requestAnimationFrame` 中加了 `.is-in`，贺卡页 `render()` 完全漏了这一步。

后果：贺卡页 `.postcard` 永远 `opacity:0`，用户在页面上看不到图片、诗词、字段；只有点「下载 PNG」— `composeCard` 直接用 Canvas2D 画图，不受 CSS opacity 影响 — 出来的 PNG 有内容，所以"点下载才能看到"。

修复：`festival-ui.js#render()` 末尾 postcard 分支加 `requestAnimationFrame(() => card.classList.add('is-in'))`。

### v4.1.8 (2026-09-03) — 换图按钮给更长超时

根因：`fetchSceneImage` 对 Picsum 硬 cap 1.5s / Pollinations 硬 cap 2s，调用方给再大的 `totalBudgetMs` 也被每源独立 cap 截断浪费；Pollinations AI 实际 3-5s 出图，2s 就放弃 → 换图失败。

修复：
- `images.js#fetchSceneImage`：移除硬 cap，按 `totalBudgetMs` 比例分配 — Picsum ≤2000ms，Pollinations = `max(3000, min(8000, floor(remain * 0.8)))`
- `main.js#swapImage`：显式 `totalBudgetMs: 10000` — Pollinations 可等 8000ms（4 倍提升）
- `drawNew` 保持默认 4000ms（首屏要快），贺卡页 `loadImage` 6000ms 不变（已受益）

### v4.1.7 (2026-09-03) — 主题切换按钮改为纯图标

`index.html` 用 3 个内嵌 SVG 替换「自动/暗色/亮色」文字：
- **自动** = 屏幕（矩形）+ 系统圆 + 连接线，视觉暗示"屏幕追随系统"
- **太阳** = 圆 + 8 条光芒（lucide 风格）
- **月亮** = 月牙路径

`main.js#applyTheme` 改用 `setAttribute('data-theme-mode', mode)` 控制图标显隐，`title` / `aria-label` 保留完整语义。`styles.css .pc-btn--icon` 圆形 34×34，3 个 SVG 同位堆叠，`opacity` + `scale` 过渡 `.25s ease`，切换时 fade + 缩放。

### v4.1.6 (2026-09-03) — 首页贺卡按钮下划线兜底 + 贺卡页加载状态机化

- **首页贺卡按钮下划线**：`styles.css .pc-btn` 加 `text-decoration: none` 兜底（全局 `a { text-decoration: none }` 之外再加一层）
- **贺卡页加载状态机**：新增 `state.imageStatus = idle | loading | ok | error`：
  - boot 同步进 loading：嵌 `<img>` + spinner，用户一进来就看到加载反馈
  - fetchSceneImage 成功 → `ok`（纯净 `<img>`）
  - fetchSceneImage 失败/异常 → `error`（`fallbackHtml` "意境暂不可用"）
  - `onFestivalChange` / `onNextPoem` 重置 `idle` 再切 loading
- 新增 `.postcard-media-loading-tip` 绝对定位在图区底部，米白半透背景 + 朱砂 spinner + "意境加载中" 文案；`.postcard-media-img--loading` 透明度 0.4 加强反馈

### v4.1.5 (2026-09-03) — 贺卡页加载逻辑与主页面统一 + 全局 a 标签去掉下划线

- 贺卡页图区：单色背景占位 → 主页面同款 `.pc-skeleton` 骨架占位
- `loadImage` 完成：`updatePreviewImage` 局部替换 → 整卡 `render()` 重渲染，与主页面 `main.js#drawNew` 流程对齐
- 删除 v4.1.4 临时函数：`solidFallbackHtml` / `FALLBACK_LOADING_HTML` / `FALLBACK_DONE_HTML` / `escapeAttr` / `updatePreviewImage`
- `<img>` 加 `referrerpolicy="no-referrer"` 与主页面一致
- `styles.css`：全局 `a { text-decoration: none }` 兜底

### v4.1.4 (2026-09-03) — 单色背景占位（v4.1.3 诗意渐变简化）

进入页面即显示单色宣纸米色（`#d8cfc0`）背景 + loading spinner + "意境加载中"文案，0 网络请求；异步 AI 图加载完成后被 `<img>` 覆盖；加载失败保留单色占位。删 v4.1.3 的 6 主题诗意渐变（山/水/月/春/秋/冬/夏）。

### v4.1.3 (2026-09-03) — 进入页面立即显示图片（诗意渐变占位 + Picsum 主源）

- 进入页面立即显示诗意渐变占位（6 主题：山/水/月/春/秋/冬/夏），0 网络请求
- 加载失败保留占位
- `fetchSceneImage` 主源切换：Picsum 1.5s（秒出稳定）→ Pollinations 2s（主题贴合）；LoremFlickr 移除
- 实测新 2 个 e2e 断言：1.5s 后页面诗词+图同时可见

### v4.1.2 — 贺卡页三大显示修复

修复贺卡页字段渲染、占位、布局问题。

### v4.1.1 — 贺卡页顶栏布局调整

抽卡按钮缩短到 61px 只包"「← 抽卡」四字"；节令+印章下拉区从字段下方移到贺卡页最顶部（紧跟 header 下方）；移除 spacer 元素，标题靠 `flex:1` 自然居中。

### v4.1.0 — 贺卡页迁出到独立页（festival.html）

贺卡屏从 `.pc-main` 互斥显示改为独立 HTML 入口（`festival.html`），与主屏 0 依赖复用 `src/*` 模块；新建 `festival-main.js` 入口，`main.js` 不再 mount FestivalUI。

### v4.0.3 — 入口按钮从 header 移到主屏 .pc-actions

### v4.0.2 — UI 重排"信匣"主题

字段区置顶 + 节日/操作按钮沉底，印章 8 chip 选中态朱砂+描金+✓，图片加载加 `totalBudgetMs=8s` 总预算（实测 2-5s 出图），完成通知双轨（屏内 toast + 浏览器 Notification API）。

### v4.0.0 (2026-09-02) — 节日贺卡模板

详细规划见 [`docs/superpowers/specs/2026-09-02-v4-festival-greeting-card-design.md`](./docs/superpowers/specs/2026-09-02-v4-festival-greeting-card-design.md)。
实施计划见 [`docs/superpowers/plans/2026-09-02-v4-festival-greeting-card.md`](./docs/superpowers/plans/2026-09-02-v4-festival-greeting-card.md)。

- 🎋 **双入口贺卡屏**：header 新增 🎋 按钮，点击进入独立贺卡屏（`#pc-festival-screen`），与主页抽卡屏互斥显示
- 🌸 **5 个节日**：春节 / 端午 / 中秋 / 重阳 / 生日，每节日 5~10 首精选诗（合计 31 首内置，零网络依赖）
- ✏️ **4 个定制字段**：送给（≤12）/ 落款（≤12）/ 寄语（≤30）/ 印章（8 个预设值：诗/礼/福/安/乐/吉/春/祥）
- 💾 **草稿自动保存**：所有字段改动 debounce 500ms 写入 `pc_v3_festival_draft`，刷新 / 离开再回来可继续编辑
- 📤 **导出 / 分享复用**：`composeCard` 加可选第 4 参数 `options` 扩展；**不传 options 时与 v3.2.9 像素级一致**（`_resolveOptions` 派生不变量）
- 📦 **新增 `src/festivals.json`**：31 首精选诗静态资源，与抽卡屏的 `poems.local.json`（70 首）独立
- 🔒 **零侵入**：抽卡屏代码完全未动；`composeCard` v3.2.9 调用路径字节级一致
- 🧪 **测试**：108（v3.1 store 回归）+ 108（v4.0 festival 单测）+ 19（静态 smoke）+ 12（headless Chrome 交互）= **247 个验证点全绿**

**新增文件**：
- `src/festivals.json` · 5 节日 × 31 首精选诗
- `src/festival-data.js` · 加载/查询/节日日判定（公历映射 2026）
- `src/festival-draft.js` · 草稿 store（debounce + parseSafe + 5KB 截断）
- `src/festival-ui.js` · 贺卡屏 DOM/状态/输入绑定
- `scripts/test-festival.mjs` · 单测
- `scripts/test-festival-smoke.mjs` · 静态资源 smoke
- `scripts/test-festival-headless.mjs` · headless Chrome 交互验证

**验证命令**：
```bash
node scripts/test-festival.mjs                  # 108 断言
python scripts/serve.py 8080                    # 起 server
node scripts/test-festival-smoke.mjs http://localhost:8080/    # 19 静态
node scripts/test-festival-headless.mjs http://localhost:8080/ # 12 headless
```

### v3.1.0 (2026-09-01) — 个性化记忆

详细规划见 [`docs/PLAN-v3.1.md`](./docs/PLAN-v3.1.md)。

- ⭐ **收藏夹**:明信片右上角 ★ 收藏;容量上限 200 首;按 `poem.id` 去重,新收藏置顶
- 📜 **抽卡历史**:自动记录最近 200 首,时间线视图(刚刚 / N 分钟前 / N 天前),一键清空
- 📊 **小统计**:累计 / 今日 / 最爱朝代 TOP5 / 最爱意象 TOP5(横向进度条 + 中文标签)
- 💾 **导出 / 导入 JSON**:打包为 `*.pcb.json` 备份;导入按 `poem.id` 合并去重(较新时间戳胜),统计覆盖
- 🗄️ **存储**:全部 localStorage,延续「打开即用、零依赖」架构;严格 200 上限防撑爆
- 🪟 **共享 modal**:三个 tab 共用一个抽屉,ESC / 点击外部关闭,暗色模式全适配
- ✅ **测试**:90 + 27 = 117 个单测全绿,ESM 模块链路冒烟通过

### v3.0.1 (2026-09-01) — 经典诗词默认开启 · 界面瘦身 · 图片压缩

- 📚 **「本地优先」→「经典诗词」**，且**默认开启**：进入页面即只走本地 70 首经典诗词库，不发远程诗词请求，首屏秒开；关闭才切回诗泉全网随机（状态本地记忆）
  - 切换 toast 与按钮 `title` 同步改为「经典诗词 / 全网诗词」语境
- 🧹 **界面瘦身**：移除底部「诗 · 诗泉 API · 图 · LoremFlickr」页脚，移除卡片下「配图 · Pollinations/LoremFlickr/Picsum」图源标注（仅在无图兜底时提示）
- 📖 **新增按钮说明区**：底部常驻虚线说明框，讲清「经典诗词 / 换一张 / 下载卡片 / 分享」四个按钮的用途
- 🖼️ **图片压缩 + 比例统一为 3:4**：
  - 图片请求 `600×800` → `540×720`（`SCENE_IMG_W/H`，后续又调整为 `720×450`，见图片规格表）
  - 页面显示 `aspect-ratio: 3/2` → `3/4`，贴合手机竖屏（后续 v3.2.6 又改为 `.postcard-media` 固定 210px 高度 + 宽度自适应 + `object-fit:cover`）
  - 导出 PNG `1200×1600` → `1080×1440`，体积约 -30%

### v3.0.0 (2026-09-01) — 一图一诗 · 明信片重构

- 🎨 **全新文艺清新 UI**：暖白宣纸底 + 青瓷绿点缀，明信片版式，大留白细线风
- 🖼️ **AI 意象配图**：从诗词提取意象生成 AI 提示词，配图更贴合诗意；失败则降级到风景关键词搜图
- 📮 **Canvas 导出**：1200×1600 竖版高清 PNG 一键下载（v3.0.1 起改为 1080×1440）
- 🔗 **分享**：Web Share API 分享图片，不支持则复制文案
- ✨ **精简聚焦**：移除体裁/朝代筛选、搜索、历史、收藏、统计，专注「一图一诗」
- 🔒 **请求纪律加固**：`_busy` 同步锁 + 250ms 防抖 + AbortController，连击也只发 1 次请求
- 🎯 **真实图标**：生成 favicon.ico / SVG / 180 / 192 / 512 全套（纯标准库手写 PNG+ICO）
- 🔄 **SW 缓存策略**：改 cacheFirst → networkFirst，避免用户拿到旧版 UI
- ⚠️ 移除已下线的 Unsplash Source 图源

### v2.2.0 — 单次 random + UI 增强 + 搜索统计 + PWA

- 抽卡改为单次 `/api/poems/random`，移除池化预加载，根绝并发 429
- 胶囊筛选、暗色模式、搜索、统计、空格快捷键、PWA

### v2.1.0 — 限流加固 + 显式降级

- 令牌桶主动限流 + 熔断器 + 统一请求层 `api.js`
- 修复令牌桶空桶死锁；失败显式提示 + 降级横幅 + 重试恢复

### v2.0.0 — 在线数据 + 零依赖

- 数据源切换到诗泉 API，移除全部 npm 依赖

## 许可

MIT · 诗词数据来自 [诗泉](https://poetry.palemoky.com/)，配图来自 Pollinations AI / Picsum。