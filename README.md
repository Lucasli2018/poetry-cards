# 古韵抽卡 (Poetry Cards)

> 单页 Web 应用 · 古诗词随机抽卡 · 国风宣纸视觉
> **v2.0** · 零外部依赖 · 数据在线 · 多源图片守护

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

### 双击即玩

直接双击 `index.html`，现代浏览器（Chrome / Edge / Firefox / Safari）即可运行。
无需任何依赖、无需任何构建步骤。

### 本地服务（可选）

```bash
npx --yes http-server . -p 8080 -c-1
# 浏览器访问 http://localhost:8080
```

## 技术栈

- **零依赖**：HTML + 原生 ES Modules + 原生 CSS
- **零构建**：没有 `package.json`、没有 npm、没有 webpack/vite
- **3 个文件**：`index.html` + `styles.css` + `src/main.js`（共约 937 行 / 28.7 KB）

## 架构

```
poetry-cards/
├── .gitignore
├── README.md               (本文档)
├── index.html              # 单页入口
├── styles.css              # 国风宣纸样式（含背景图支持）
└── src/
    ├── main.js             # 全部逻辑（限流感知 + 本地兜底）
    └── poems.local.json    # 本地兜底诗词库（70 首，API 限流时启用）
```

### 数据流

```
1. 加载元数据
   GET https://poetry.palemoky.com/api/types
   GET https://poetry.palemoky.com/api/dynasties
   → 填充分类下拉

2. 用户点 [抽一签]
   ├─ 池空 → 限流感知地拉 random（每轮 {FETCH_BATCH}=3 个、间隔 {MIN_GAP_MS}=160ms）
   │       → 命中 429 读 Retry-After 做指数退避，不立即重试
   │       → 连续 2 轮全失败（限流/离线）→ 切换本地内置库 src/poems.local.json
   │       → 客户端按 type.id / dynasty.id 过滤
   │       → 加入池
   ├─ 从池随机抽 1 首
   ├─ 从池移除（避免短期重复）
   └─ 后台继续补池（池 <20 时）

3. 显示卡片
   ├─ 翻牌动画（CSS rotateY 0.6s）
   ├─ 后台拉背景图
   │   ① Unsplash Source（4.5s 超时）
   │   ② Picsum（4.5s 超时）
   │   ③ 失败回退（纯色宣纸）
   └─ 点击卡片 → 详情弹窗
```

### 关键策略

- **客户端过滤**：诗泉 API 不支持服务端按 type/dynasty 过滤，必须先全库随机再客户端筛
- **池化抽卡**：首抽建立 40 首池子，抽取后从池移除，后台静默补池
- **限流感知**：`/api/poems/random` 有频率限制（429）。请求改为受限并发 + 间隔，命中 429 时读 `Retry-After` 做指数退避，杜绝「限流→立刻重试→再限流」死循环
- **本地兜底库**：`src/poems.local.json` 内置 70 首精选诗词（ID 与 API 对齐）。API 限流 / 离线时自动顶上，抽卡永远可用；元数据接口不可用时下拉框也由本地目录兜底
- **去重**：`seenIds` Set 保证同一首诗在本次会话内绝不重复
- **多源图片守护**：Unsplash Source + Picsum + 纯色兜底，每源 4.5s 超时
- **localStorage 兜底**：不可用时降级内存 Map

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