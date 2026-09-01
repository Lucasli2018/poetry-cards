# 古韵抽卡 (Poetry Cards)

> 单页 Web 应用 · 古诗词随机抽卡 · 国风宣纸视觉
> **v2.1** · 零外部依赖 · 令牌桶主动限流 + 熔断 + 显式降级 · 数据在线 · 多源图片守护

## 数据源

[诗泉](https://poetry.palemoky.com/) 免费开源古诗词 API。

- 37 万+ 首古诗词
- 1.3 万+ 位诗人
- 11 个朝代
- 17 种体裁

## 预览

打开页面 → 选择体裁/朝代 → 点「抽一签」→ 卡片飞入，朱砂印章 + 卷轴样式 + 背景山水图。

点卡片可看详情、复制全文、加入收藏。

## 功能

- 🎴 在线随机抽卡（来自诗泉 API 全库 37 万+首）
- 🏷️ **体裁筛选**：唐诗 / 五言绝句 / 七言绝句 / 五言律诗 / 七言律诗 / 五言古诗 / 七言古诗 / 乐府诗 / 宋词 / 五代词 / 元曲 / 蒙学 / 诗经 / 论语 / 楚辞 / 四书五经（共 16 类，不含「其他」）
- 🏯 **朝代筛选**：先秦 / 两汉 / 魏晋 / 南北朝 / 隋 / 唐 / 五代 / 宋 / 元 / 清（共 10 朝）
- 🖼️ **卡片背景图**：Unsplash Source 在线国风山水 → Picsum 兜底
- 🃏 卷轴卡片 + 朱砂印章 + 翻牌动画
- 📖 详情弹窗：原文 + 作者 + 朝代 + 体裁
- ⭐ 收藏夹独立存储
- 📋 一键复制全文到剪贴板
- 🕘 抽取历史永久保留（localStorage 5000 条上限）
- 🗑️ 清空历史带二次确认
- 📱 移动端响应式（≤480px 不破版）

## 启动

> ⚠️ v2.1 起使用原生 ES Modules（`index.html` 以 `<script type="module">` 加载 `src/main.js`）。
> **必须经 http(s) 访问**：直接双击 `index.html`（`file://` 协议）会因模块跨域限制而无法加载。
> 本地预览请起一个静态服务器，或部署到 Gitee Pages / Cloudflare Pages 后访问。

### 本地服务（推荐）

```bash
npx --yes http-server . -p 8080 -c-1
# 或： python3 -m http.server 8080
# 浏览器访问 http://localhost:8080
```

### 部署

推到 Gitee 后开启 Pages（或 Cloudflare Pages）即可，无需构建步骤。

## 技术栈

- **零依赖**：HTML + 原生 ES Modules + 原生 CSS
- **零构建**：没有 `package.json`、没有 npm、没有 webpack/vite
- **模块**：`index.html` + `styles.css` + `src/main.js` + `src/api.js` + `src/rate-limit.js` + `src/circuit-breaker.js` + `src/poems.local.json`

## 架构

```
poetry-cards/
├── .gitignore
├── README.md               (本文档)
├── index.html              # 单页入口（<script type="module">）
├── styles.css              # 国风宣纸样式 + 骨架屏 + 降级横幅
└── src/
    ├── rate-limit.js        # 令牌桶：主动限速（容量6 / 3每秒 / 并发≤2）
    ├── circuit-breaker.js   # 熔断器：连续失败开路，冷却后半开探测
    ├── api.js               # 统一请求层：令牌桶→退避(全抖动)→熔断→失败分类
    ├── main.js              # 业务：抽卡池 / 状态机 / 降级横幅 / 骨架屏
    └── poems.local.json     # 本地兜底诗词库（70 首，API 限流/离线时启用）
```

### 数据流

```
1. 加载元数据
   apiRequest('/api/types') + apiRequest('/api/dynasties')
   （统一经令牌桶 + 熔断；失败则由本地目录兜底填下拉）

2. 用户点 [抽一签]
   ├─ 池空 → refillPool 每轮并发 {FETCH_BATCH}=3 个 randomPoem()
   │   randomPoem → apiRequest('/api/poems/random', {maxRetries:2})
   │     ├─ 令牌桶：同时在途≤2、稳态 3/s，从源头压住 429
   │     ├─ 命中 429/5xx/网络 → 指数退避(全抖动)+尊重 Retry-After 重试
   │     ├─ 连续失败达阈值 → 熔断开路，暂停请求，不再轰炸
   │     └─ 失败分类 ApiError(kind: rate_limit|network|http|circuit)
   │   → 连续 2 轮全失败（限流/离线）→ showDegradedBanner + 切本地库
   │   → 客户端按 type.id / dynasty.id 过滤后加入池
   ├─ 从池随机抽 1 首，从池移除（避免短期重复）
   └─ 后台继续补池（池 <20 时）；若中途恢复在线则自动隐藏横幅

3. 显示卡片（骨架屏 shimmer → 翻牌动画 → 背景图守护 → 详情弹窗）
```

### 关键策略

- **主动限流（令牌桶）**：在打到 429 之前就把出站速率压在阈值以下（容量 6 / 补充 3/s / 并发 ≤2）。令牌桶自带定时泵送，空桶排队者会在令牌补充后自动恢复，**不会死锁**。
- **熔断**：连续 5 次失败开路、冷却 10s 后半开探测；开路期间补池暂停，杜绝重试风暴。
- **退避 + 全抖动**：base 300ms ×2ⁿ（上限 8s），`wait = random(0, base·2ⁿ)` 避免多客户端同步重试惊群；优先用服务端 `Retry-After`。
- **失败显式提示**：抽卡失败 → Toast「请求失败，请稍后重试」+ 卡片区提示；限流/离线 → 顶部常驻横幅「已切换本地诗词库」+「重试恢复」按钮。
- **本地兜底库**：`src/poems.local.json` 内置 70 首精选诗词（ID 与 API 对齐）。API 限流 / 离线时自动顶上，抽卡永远可用；元数据接口不可用时下拉框也由本地目录兜底。
- **客户端过滤**：诗泉 API 不支持服务端按 type/dynasty 过滤，先全库随机再客户端筛。
- **池化抽卡**：首抽建立 40 首池子，抽取后从池移除，后台静默补池。
- **去重**：`seenIds` Set 保证同一首诗在本次会话内绝不重复。
- **多源图片守护**：Unsplash Source + Picsum + 纯色兜底，每源 4.5s 超时。
- **localStorage 兜底**：不可用时降级内存 Map。

## API 端点（诗泉）

| 接口 | URL | 用途 |
|---|---|---|
| 体裁 | `/api/types` | 17 种体裁元数据 |
| 朝代 | `/api/dynasties` | 11 个朝代元数据 |
| 随机 | `/api/poems/random` | 全库随机一首 |
| 列表 | `/api/poems?page=X&pageSize=Y` | 分页列表（按 id 升序） |
| 详情 | `/api/poems/{id}` | 单首详情 |
| 搜索 | `/api/search?q={诗题}` | 按诗题搜 |

## 仓库

Gitee：`https://gitee.com/li-luoqiang/poetry-cards`

## 更新日志

### v2.1.0 (2026-09-01) — 限流加固 + 显式降级
- ✨ **主动令牌桶限流** `src/rate-limit.js`：容量 6 / 3 每秒 / 并发 ≤2，从源头压住 429
- ✨ **熔断器** `src/circuit-breaker.js`：连续 5 次失败开路，冷却后半开探测恢复
- ✨ **统一请求层** `src/api.js`：令牌桶 → 指数退避(全抖动) → 熔断 → 失败分类 `ApiError`
- ✨ **显式失败提示**：抽卡失败 Toast「请求失败，请稍后重试」；限流/离线顶部常驻横幅 +「重试恢复」按钮
- ✨ **骨架屏 shimmer** 替代纯文本「正在寻诗」
- 🐛 **修复令牌桶死锁**：空桶且无在途请求时，排队者靠定时泵送自动恢复（此前会永久挂起）
- 📦 升级为原生 ES Modules（需经 http(s) 访问，详见「启动」）

### v2.0.0 (2026-09-01) — 在线数据 + 零依赖
- 🎉 **破坏性变更**：移除 v1.0 的内置 poetry.json + 全部 npm 依赖
- ✨ 数据源切换到诗泉 API（37 万+首）
- ✨ 17 体裁 + 11 朝代双维客户端筛选
- ✨ 多源图片守护（Unsplash + Picsum）
- ✨ 零依赖：3 文件 937 行 28.7 KB
- 22 文件变动，+849 / -4062 行

### v1.0.0 (2026-08-31) — 初版（已废弃）
- 内置 93 首精选诗词
- vitest 单测 28 个全绿
- 国风宣纸 + 朱砂印章 + 卷轴卡片

## 许可

MIT

数据来源：[诗泉](https://poetry.palemoky.com/)，公开免费 API。

> 💡 本项目不部署 Pages，纯代码仓库，按需 clone 到本地或自托管。