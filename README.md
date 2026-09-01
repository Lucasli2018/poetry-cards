# 古韵抽卡 · 一图一诗

> 随机一首古诗词，配一张贴题意象的美图，合成一张可保存的明信片。
> **v3.0** · 文艺清新 · 零依赖 · 零构建 · 可下载 · 可分享

打开页面即自动呈上一张「一图一诗」的明信片，按空格或点「换一张」再来一张。

## 功能

- 🖼️ **一进页面就出片**：自动取 1 首随机诗词 + 1 张配图，直接合成明信片，无需点击
- 🎨 **意象配图**：从诗词正文提取意象（月 / 雪 / 山 / 江 / 春 / 秋…）映射为英文关键词去搜图，配图贴着诗意走
- 📮 **明信片版式**：横排诗词居中、大留白、细线分隔、朱砂小印
- ⬇️ **导出 PNG**：Canvas 合成 **1200×1600** 竖版高清图，一键下载
- 🔗 **分享**：Web Share API 直接分享图片（移动端）；不支持则自动回退为「复制诗词文案」
- 🌙 **暗色模式**：自动 / 亮色 / 暗色 三态，跟随系统 + 手动切换 + 本地记忆
- ⌨️ **空格换一张**：桌面端快捷键
- 📱 **PWA**：可安装到桌面 / 主屏，离线仍可读到上一次内容
- 🛡️ **降级兜底**：接口不可用时自动切本地 70 首诗词库，顶部横幅提示 + 「重试恢复」按钮

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

1. **LoremFlickr** — 支持关键词搜索，能贴合诗意，`Access-Control-Allow-Origin: *`
2. **Picsum** — seed 稳定随机，带 `Origin` 请求时返回 CORS 头
3. **水墨渐变** — 纯 CSS 兜底，任何情况都有底

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
├── styles.css              文艺清新主题（亮/暗双套 CSS 变量）
├── manifest.webmanifest    PWA 清单
├── sw.js                   Service Worker（网络优先 + 离线回退）
├── assets/
│   └── icons/              favicon.svg/.ico/-32.png · apple-touch-icon.png · icon-192/512.png
├── scripts/
│   └── make_favicon.py     纯标准库生成图标（struct+zlib 手写 PNG/ICO，输出至 assets/icons）
├── docs/
│   └── PLAN-archive.md     v2.x 规划归档
└── src/
    ├── main.js             主流程：一图一诗 · 请求纪律 · 事件
    ├── images.js           意象提取 + 图片多源守护
    ├── cards.js            Canvas 合成明信片 + 下载 + 分享
    ├── poems.local.json    本地兜底诗词库（70 首）
    └── net/                网络层（统一请求 + 限流 + 熔断）
        ├── api.js          统一请求层：令牌桶→退避(全抖动)→熔断→失败分类
        ├── rate-limit.js   令牌桶（含空桶死锁修复）
        └── circuit-breaker.js  熔断器
```

## 数据流

```
页面加载
  ├─ 请求 1  apiRequest('/api/poems/random')      ── 唯一一次
  │    └─ 失败 → 本地 70 首兜底 + 降级横幅
  └─ 请求 2  fetchSceneImage(poem)                ── 唯一一次
       ├─ 从诗词正文提取意象 → 英文关键词
       └─ LoremFlickr → Picsum → CSS 渐变兜底
  ↓
渲染明信片（DOM，用于页面展示）
  ↓
点「下载」→ composeCard() 用同一张 CORS 图合成 Canvas → 1200×1600 PNG
点「分享」→ navigator.share({files}) → 失败则复制文案
```

## 启动

项目使用原生 ES Modules，**必须经 http(s) 访问**（双击 `file://` 会因跨域加载不到模块）。

```bash
npx --yes http-server . -p 8080 -c-1
# 或
python -m http.server 8080
# 浏览器打开 http://localhost:8080
```

## 部署

托管在 **Gitee**（`gitee.com/li-luoqiang/poetry-cards`），**推送 Gitee 即自动同步到 GitHub**。

> 因此本项目**只需 `git push origin master`**，不需要单独操作 GitHub 远端或凭证。

## 更新日志

### v3.0.0 (2026-09-01) — 一图一诗 · 明信片重构

- 🎨 **全新文艺清新 UI**：暖白宣纸底 + 青瓷绿点缀，明信片版式，大留白细线风
- 🖼️ **意象配图**：从诗词提取意象关键词搜图，配图贴合诗意（修复「二月花」误判为月亮的 bug）
- 📮 **Canvas 导出**：1200×1600 竖版高清 PNG 一键下载
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

MIT · 诗词数据来自 [诗泉](https://poetry.palemoky.com/)，配图来自 LoremFlickr / Picsum。
