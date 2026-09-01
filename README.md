# 古韵抽卡 · 一图一诗

> 随机一首古诗词，配一张贴题意象的美图，合成一张可保存的明信片。
> **v3.0** · 文艺清新 · 零依赖 · 零构建 · 可下载 · 可分享

打开页面即自动呈上一张「一图一诗」的明信片，按空格或点「换一张」再来一张。

## 功能

- 🖼️ **一进页面就出片**：自动取 1 首随机诗词 + 1 张配图，直接合成明信片，无需点击（默认走本地库，秒开）
- 🎨 **AI 意象配图**：从诗词提取意象生成 AI 提示词出图，配图贴着诗意；失败降级风景关键词图
- 📮 **明信片版式**：横排诗词居中、大留白、细线分隔、朱砂小印
- ⬇️ **导出 PNG**：Canvas 合成 **1080×1440**（3:4）竖版图，一键下载
- 🔗 **分享**：Web Share API 直接分享图片（移动端）；不支持则自动回退为「复制诗词文案」
- 🌙 **暗色模式**：自动 / 亮色 / 暗色 三态，跟随系统 + 手动切换 + 本地记忆
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

1. **Pollinations AI** — 根据诗词意象生成专属配图，最贴合诗意，`Access-Control-Allow-Origin: *`
2. **LoremFlickr** — 按风景关键词搜索，`Access-Control-Allow-Origin: *`
3. **Picsum** — seed 稳定随机风景图，带 `Origin` 请求时返回 CORS 头
4. **水墨渐变** — 纯 CSS 兜底，任何情况都有底

**图片规格**（移动端优先，显示与导出比例已统一为 3:4）：

| 环节 | 尺寸 | 说明 |
| --- | --- | --- |
| 图片请求 | 540 × 720 | `SCENE_IMG_W/H`（`images.js`），比原 600×800 少 19% 像素，AI 出图更快 |
| 页面显示 | 3:4（约 480 × 640 CSS px） | `.postcard-media` 的 `aspect-ratio`，竖屏手机观感更好 |
| 导出 PNG | 1080 × 1440 | `CARD_W/H`（`cards.js`），标准分享图尺寸，体积比 1200×1600 小约 30% |

> 显示与导出同为 3:4，导出时无需再做比例裁切，画面保真度更高。

> ⚠️ 已移除 **Unsplash Source**（`source.unsplash.com`）——该服务于 2024 年下线，是此前配图大面积 404 的原因。
>
> 💡 图源必须带 CORS 头，否则 Canvas 会被污染（tainted），`toDataURL()` 直接抛 `SecurityError`，导出功能将完全不可用。因此图片加载统一设 `crossOrigin='anonymous'`。

## 技术栈

- **零依赖**：原生 HTML + ES Modules + CSS，没有 npm、没有构建步骤
- **单页**：7 个源文件，约 1500 行

## 项目结构

```
poetry-cards/
├── index.html              单页入口（<script type="module">）
├── styles.css              文艺清新主题（亮/暗双套 CSS 变量 + v3.1 记忆面板样式）
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker（网络优先 + 离线回退）
├── assets/
│   └── icons/              favicon.svg/.ico/-32.png · apple-touch-icon.png · icon-192/512.png
├── scripts/
│   ├── serve.py            零依赖本地静态服务器（修正 .js/.webmanifest MIME，跨平台可用）
│   ├── make_favicon.py     纯标准库生成图标（struct+zlib 手写 PNG/ICO，输出至 assets/icons）
│   ├── test-store.mjs      store 单测（90 用例，纯 node 无依赖）
│   ├── test-storage-dialog.mjs  导入/导出 单测（27 用例）
│   └── check-modules.mjs   ESM 模块链路冒烟
├── docs/
│   ├── PLAN-archive.md     v2.x 规划归档
│   └── PLAN-v3.1.md        v3.1 个性化记忆规划
└── src/
    ├── main.js             主流程：一图一诗 · 请求纪律 · v3.1 记忆入口
    ├── images.js           意象提取 + 图片多源守护（extractThemes 已 export）
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
    └── ui/                 v3.1 UI
        ├── memory-panel.js 共享 modal(三个 tab + ESC/外部关闭)
        ├── renderers.js    三个 tab 的渲染器(纯函数,易测)
        └── storage-dialog.js 导出/导入 JSON(合并去重)
```

## 数据流

```
页面加载
  ├─ 经典诗词模式（默认开启）→ 直接取本地 70 首，0 请求
  └─ 关闭时：
       ├─ 请求 1  apiRequest('/api/poems/random')      ── 唯一一次
       │    └─ 失败 → 本地 70 首兜底 + 降级横幅
       └─ 请求 2  fetchSceneImage(poem)                ── 唯一一次
            ├─ 从诗词正文提取意象 → 英文提示词 / 风景关键词
            └─ Pollinations AI(540×720) → LoremFlickr → Picsum → CSS 渐变兜底
  ↓
渲染明信片（DOM，用于页面展示）
  ↓
点「下载」→ composeCard() 用同一张 CORS 图合成 Canvas → 1080×1440 PNG
点「分享」→ navigator.share({files}) → 失败则复制文案
```

> 默认开启「经典诗词」后，首屏不发任何远程诗词请求，只发 1 次配图请求。

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
# 浏览器打开 http://localhost:8080
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
  - 图片请求 `600×800` → `540×720`（`SCENE_IMG_W/H`），少 19% 像素，Pollinations 出图更快
  - 页面显示 `aspect-ratio: 3/2` → `3/4`，贴合手机竖屏
  - 导出 PNG `1200×1600` → `1080×1440`，体积约 -30%，且因与显示同比例，导出不再裁切

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

MIT · 诗词数据来自 [诗泉](https://poetry.palemoky.com/)，配图来自 Pollinations AI / LoremFlickr / Picsum。
