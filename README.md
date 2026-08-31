# 古韵抽卡 (Poetry Cards)

> 单页 Web 应用，从精选古诗词随机抽卡，国风宣纸视觉。
> **v2.0** · 零外部依赖 · 数据在线 · 多源图片守护

## 数据源

[诗泉](https://poetry.palemoky.com/) 免费开源古诗词 API，提供 37 万+首古诗词、1.3 万+位诗人、11 个朝代、17 种体裁的在线随机检索。

## 功能

- 🎴 在线随机抽卡（来自诗泉 API，37 万+首）
- 🏷️ **体裁筛选**：不限 / 唐诗 / 五言绝句 / 七言绝句 / 五言律诗 / 七言律诗 / 五言古诗 / 七言古诗 / 乐府诗 / 宋词 / 五代词 / 元曲 / 蒙学 / 诗经 / 论语 / 楚辞 / 四书五经（共 17 类）
- 🏯 **朝代筛选**：不限 / 先秦 / 两汉 / 魏晋 / 南北朝 / 隋 / 唐 / 五代 / 宋 / 元 / 清 / 其他（共 11 朝）
- 🖼️ **卡片背景图**：Unsplash Source 在线图 + Picsum 兜底
- 🃏 卷轴卡片 + 朱砂印章
- 📖 详情弹窗：原文 + 作者 + 朝代 + 体裁
- ⭐ 收藏夹独立存储
- 📋 一键复制全文到剪贴板
- 🕘 抽取历史永久保留（localStorage），横向滚动画廊
- 🗑️ 清空历史带二次确认
- 📱 移动端响应式（≤480px 不破版）

## 启动

### 双击即玩

直接双击 `index.html`，现代浏览器（Chrome / Edge / Firefox / Safari）即可运行。

### 本地开发

```bash
npx --yes http-server . -p 8080 -c-1
# 浏览器访问 http://localhost:8080
```

## 技术栈

- **零依赖**：HTML + 原生 ES Modules + 原生 CSS，零运行时依赖，零 devDependencies
- 无 `package.json`、无 npm、无构建步骤
- 仅 3 个文件：`index.html` + `styles.css` + `src/main.js`

## 架构

```
poetry-cards/
├── index.html              # 单页入口
├── styles.css              # 国风宣纸样式（卡片背景图支持）
└── src/
    └── main.js             # 全部逻辑（约 380 行）
```

### 数据流

```
1. 加载元数据：GET /api/types、/api/dynasties  → 填充分类下拉
2. 抽卡：GET /api/poems/random（并发6）→ 客户端按 type/dynasty 过滤 → 内存池
3. 用户点 [抽一签] → 从池中随机 → 显示卡片
4. 后台图片：Unsplash Source → Picsum → 失败回退（宣纸底色）
```

### 关键策略

- **客户端过滤**：诗泉 API 无服务端过滤能力，先全库随机再按用户筛选条件过滤
- **池化抽卡**：首抽拉 40 首建立池子，抽中后从池中移除，后台静默补池
- **去重**：所有已抽过的 poem id 存入 `seenIds` Set，永远不会重复
- **图片多源**：Unsplash Source（4.5s 超时）→ Picsum（4.5s 超时）→ 纯色兜底

## 部署到 Gitee Pages

仓库：`https://gitee.com/li-luoqiang/poetry-cards`

1. Gitee 仓库页 → 服务 → Gitee Pages
2. 部署分支：`master`
3. 部署目录：`/`（根目录）
4. 启动

在线地址：`https://li-luoqiang.gitee.io/poetry-cards`

## 验收清单

- [x] 双击 `index.html` 在 Chrome/Edge 即玩
- [x] 零 npm 依赖，无 `package.json`
- [x] 首屏 < 30 KB（HTML + CSS + JS）
- [x] 在线随机抽卡（诗泉 API）
- [x] 17 分类 + 11 朝代双维筛选
- [x] 客户端过滤生效
- [x] 图片多源守护（Unsplash + Picsum + 兜底）
- [x] 抽卡翻牌动画流畅
- [x] 历史永久保留（localStorage）
- [x] 收藏夹独立面板
- [x] 复制全文到剪贴板
- [x] localStorage 异常内存兜底
- [x] 移动端 480px 不破版
- [ ] Gitee Pages 部署（待启用）

## 许可

MIT

数据来源：[诗泉](https://poetry.palemoky.com/)，公开免费 API。