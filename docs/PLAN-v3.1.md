# 古韵抽卡 v3.1 升级规划 · 个性化记忆

> 立项日期: 2026-09-01
> 立项背景: v3.0 已稳定(本地优先 + AI 配图 + 明信片导出 + PWA,HEAD `b18970f`),
> 领主拍板下一站 = **个性化记忆**,继续坚守**零依赖 + 单 HTML + 原生 ESM** 架构约束。
> 存储载体: **localStorage(默认,5MB 额度足够历史与收藏)**;不引 IndexedDB / npm。

---

## 1. 目标

把 v3.0 的「一次相遇」升级为「可回看的私人诗集」:

- 抽到喜欢的诗能 **★ 收藏**,日后随时重看 / 导出 / 取消收藏
- 自动记录 **抽卡历史**,可点进去回忆「上一次抽到的是哪首」
- 在角落展示 **小统计**:累计 / 今日 / 最爱朝代 TOP3 / 最爱意象 TOP3
- 支持 **导出与导入 JSON** 备份,换设备 / 换浏览器一键迁移

> 一切仍是「打开即用,无需登录、无需联网、无需构建」。

---

## 2. 设计原则(继承 + 新增)

| 原则 | 落地 |
| --- | --- |
| **零依赖** | 仍只用原生 ESM + DOM + Canvas,JSON 编解码用 `JSON.stringify/parse` |
| **请求纪律不松动** | 新增的收藏/历史读写全是 localStorage 同步操作,完全不影响网络请求数 |
| **文艺清新视觉** | 收藏页与统计面板沿用明信片版式,米白纸 + 暖灰字 + 朱砂强调色 |
| **隐私优先** | 数据只存本地,不上传任何服务器;导出 JSON 由用户主动触发 |
| **零崩溃** | localStorage 不可用时已在 `main.js` 有内存降级(`mem` Map);新功能复用同一兜底 |
| **可演进** | 存储 schema 带 `version` 字段,便于未来迁移到 IndexedDB 时做版本升级 |

---

## 3. 数据模型(localStorage)

> 全部以「前缀 `pc_v3_` + JSON 序列化字符串」落盘,与 v3.0 现有 `pc_v3_theme` / `pc_v3_local_first` 共用命名空间。

### 3.1 存储键清单

| Key | 类型 | 说明 |
| --- | --- | --- |
| `pc_v3_favorites` | `FavoritesSchema` | 收藏夹(去重,以 poem.id 为主键) |
| `pc_v3_history` | `HistorySchema` | 抽卡历史(滚动队列,上限 200 条) |
| `pc_v3_stats_meta` | `StatsMetaSchema` | 累计 / 今日计数与最后清零日期 |

> **不做**:不存明信片缩略图(Base64 太占额度);历史页只显示诗题 + 作者 + 朝代 + 时间。

### 3.2 FavoritesSchema

```jsonc
{
  "version": 1,
  "items": [
    {
      "id": 12345,                    // 诗泉 poem.id 或本地诗 fake id
      "title": "静夜思",
      "author": "李白",
      "dynasty": "唐",
      "type": "五言绝句",
      "content": ["床前明月光", "疑是地上霜", "举头望明月", "低头思故乡"],
      "source": "remote" | "local",   // 来自诗泉 API 还是本地库
      "favoritedAt": 1725148800000    // ms 时间戳
    }
    // …更多
  ]
}
```

- 容量上限 **200 首**,超限拒绝并 toast 提示,引导用户先取消旧收藏
- `poem.id` 唯一:重复收藏走更新路径(覆盖 `favoritedAt`)

### 3.3 HistorySchema

```jsonc
{
  "version": 1,
  "items": [
    {
      "id": 12345,                    // poem.id(同 favorites)
      "title": "静夜思",
      "author": "李白",
      "dynasty": "唐",
      "type": "五言绝句",
      "source": "remote" | "local",
      "drawnAt": 1725148800000        // ms 时间戳,精确到秒
    }
    // …按 drawnAt 倒序,最多 200 条;超过则弹出最旧
  ]
}
```

- 仅在 **成功渲染明信片** 时记录(失败 / 取消 / 网络中断不写)
- 同首诗连抽不算去重,允许重复,以便统计「偏爱」

### 3.4 StatsMetaSchema

```jsonc
{
  "version": 1,
  "totalDraws": 132,         // 累计抽卡(成功渲染次数,不含失败)
  "todayDraws": 7,           // 今日抽卡
  "todayKey": "2026-09-01",  // 用于跨日自动归零
  "dynastyCounter": {        // 朝代分布
    "唐": 80,
    "宋": 35,
    "汉": 4
  },
  "imageryCounter": {        // 意象分布(top 10,见 §6)
    "moonlight": 12,
    "autumn": 9,
    "mountain": 7
  }
}
```

- 朝代键值缺失时按 0 计,统计读取时再做 TOP N
- `imageryCounter` 只在 `images.js#extractThemes` 命中的主题词上累加(已实现)

---

## 4. 模块划分

> 不引 npm、不拆页;全部沿用 `src/main.js` 入口,**新增 1 个 store 模块 + 3 个 UI 模块**:

```
src/
├── main.js               ← 主流程(接入 store 写入点)
├── images.js             ← 不动(imageryCounter 沿用其 extractThemes)
├── cards.js              ← 不动
├── poems.local.json      ← 不动
├── net/
│   ├── api.js            ← 不动
│   ├── rate-limit.js     ← 不动
│   └── circuit-breaker.js← 不动
├── store/                ← 【新增】
│   ├── schema.js         ← 4 个 schema 常量 + 版本号 + JSON 安全解析
│   ├── favorites.js      ← add/remove/list/has/export/import
│   ├── history.js        ← push/list/clear/export/import
│   └── stats.js          ← onDraw(poem, themes)/resetDay/getSnapshot
└── ui/                   ← 【新增】(纯函数,DOM 由调用方挂载)
    ├── favorites-panel.js    ← 收藏列表(明信片版式缩略)+ 空态
    ├── history-panel.js      ← 时间线列表 + 清空按钮
    ├── stats-panel.js        ← 累计 / 今日 / 朝代 TOP3 / 意象 TOP3
    └── storage-dialog.js     ← 导出 / 导入 JSON(同 modal 复用)
```

- `ui/` 模块全部为纯函数:接收 host element + 数据,返回 mount/unmount 句柄
- 数据来源统一从 `store/*.js` 读,UI 不直接碰 localStorage
- 主流程在 `drawNew()` 渲染成功后调用 `recordDraw(poem, themes)`

---

## 5. 主流程接入点

> 最小侵入:只在 3 处打点,**不改 drawNew 的请求纪律**。

| 位置 | 代码片段 | 作用 |
| --- | --- | --- |
| `main.js` 顶部 import | `+ import { addFavorite, removeFavorite, hasFavorite } from './store/favorites.js';` 等 4 行 | 引入 4 个 store 模块 |
| `main.js#drawNew` 成功渲染后 | `+ stats.onDraw(poem, extractThemes(poem)); history.push(poem);` | 写入 stats 与 history |
| `main.js#init` 末尾 | `+ mountFavoritesPanel(host)` / `mountHistoryPanel` / `mountStatsPanel` / `mountStorageDialog` | 挂载 4 个 UI 入口 |

- 收藏触发:明信片右上角新增「★ 收藏」按钮(同「换图」按钮位),按下后切换 `is-favorited` 样式
- UI 入口位置:页面顶部 header 在「经典诗词」按钮旁新增「★」(下拉显示收藏/历史/统计三个面板),移动端折叠为底部 sheet

---

## 6. 关键算法

### 6.1 意象命中(`extractThemes`)

**已实现**:`images.js` 现已返回 `themes: string[]`(top 2),`stats.onDraw` 直接接收,无需重复计算正则。

### 6.2 TOP N

朝代 / 意象 TOP N 都是 `Object.entries(obj).sort((a,b)=>b[1]-a[1]).slice(0, N)`,无外部依赖。

### 6.3 跨日归零

```text
onDraw(now):
  todayKey = ymd(now)
  if meta.todayKey !== todayKey:
    meta.todayKey = todayKey
    meta.todayDraws = 0
  meta.todayDraws++
  meta.totalDraws++
  dynastyCounter[poem.dynasty]++
  for theme in themes: imageryCounter[theme]++
```

- 失败 / 取消不进入 `onDraw`,与 history 写入同一前置条件(`seq === _seq` 且 `curPoem` 已渲染)

### 6.4 导入冲突

- 导入 JSON 时,以 **「导入版本」+ 「用户确认」** 为门:
  - 检测 schema.version;若缺失或 >1,提示「不支持的版本」拒绝
  - 合并策略:按 `poem.id` 去重,**导入的 `favoritedAt` 与 `drawnAt` 较新者胜**
  - 导入前先做一次「快照」备份到 `pc_v3_imported_backup_{ts}`,7 天内可一键还原(进阶,放 v3.2)

---

## 7. 视觉规范

| 区域 | 配色 | 间距 |
| --- | --- | --- |
| 面板背景 | `var(--pc-paper, #fdfcf9)` | 24px 内边距 |
| 标题 | 墨黑 `#2d2a26`,serif | 与明信片标题同字号 |
| 收藏 ★ | 朱砂 `#a8321e`(已收藏),浅灰描边(未收藏) | 28×28 |
| 空态 | 灰褐 `#8a8578`,居中一行诗 | 64px 上下 |
| 进度数字 | 衬线 600,大号 | — |

- 暗色模式沿用 v3.0 现有 `pc-dark` class,所有变量走 `--pc-*` token,新增模块不引入硬编码颜色

---

## 8. 任务切片(M0 → M4)

> 每个 M 都是一个独立可合并的最小单元,每 M 跑完单测 + 浏览器手工冒烟再推。

### M0 · store 基础设施(0.5d)

- [ ] 新建 `src/store/schema.js`,导出 4 个 schema 常量 + `parseSafe()` 容错
- [ ] 写本地 `scripts/test-store.mjs`(用 node 跑纯函数,验证序列化 / 反序列化 / 容量上限)
- [ ] 验证:无 UI 改动,所有现有功能不受影响

### M1 · stats + history 自动记录(0.5d)

- [ ] 新建 `src/store/stats.js`、`src/store/history.js`
- [ ] 在 `drawNew` 成功路径调用 `stats.onDraw(...)` + `history.push(...)`
- [ ] 手工冒烟:连抽 5 次,F12 看 localStorage 三键;跨日归零改系统时间验证
- [ ] **不引入 UI**,只为 M2 准备数据

### M2 · 收藏 + 明信片 ★ 按钮(1d)

- [ ] 新建 `src/store/favorites.js`
- [ ] `main.js` 在明信片渲染后插入「★」按钮,与「换图」并排
- [ ] 重复点击切换收藏 / 取消收藏,按钮态实时反馈
- [ ] 容量上限(200)toast 兜底

### M3 · 三个面板 UI(1d)

- [ ] 新建 `src/ui/favorites-panel.js`、`history-panel.js`、`stats-panel.js`
- [ ] header 新增「★」按钮,下拉 / 抽屉三选一
- [ ] 三个面板共用 modal 容器,ESC + 点击外部关闭
- [ ] 收藏面板可重看 / 取消收藏;历史面板可清空;统计面板只读

### M4 · 导出 / 导入 JSON + 备份(0.5d)

- [ ] 新建 `src/ui/storage-dialog.js`
- [ ] 导出:打包 favorites + history + stats 为 JSON,`URL.createObjectURL` 触发下载
- [ ] 导入:文件选择 → 解析 → 弹确认 → 合并写入 → toast 结果
- [ ] README 增加「数据备份与迁移」段落

---

## 9. 测试与验收

### 9.1 单元测试(纯函数)

新增 `scripts/test-store.mjs`(node 直接跑,无需测试框架),覆盖:

- `favorites.add` / `remove` / `has` / 容量上限 / 重复 id
- `history.push` / 上限 200 / 自动弹出最旧
- `stats.onDraw` / 跨日归零 / TOP N
- `parseSafe` 容错(null / 非 JSON / 缺 version / 错 version)
- export/import 往返一致

### 9.2 浏览器冒烟(本地)

- [ ] 默认页打开 → 看到一张明信片
- [ ] 连抽 5 次 → F12 localStorage 三键齐备
- [ ] 点 ★ 收藏 → 收藏面板出现该诗;再点取消
- [ ] 收藏达 200 后再点收藏 → toast 提示
- [ ] 统计面板数字与 history 长度一致
- [ ] 导出 JSON → 清缓存 → 导入 JSON → 收藏/历史/统计全部回来
- [ ] 暗色模式三面板样式不破
- [ ] 移动端宽度三面板可读、按钮可点
- [ ] 本地优先模式:数据全部来自 `poems.local.json` 时,统计与历史仍正确记录

### 9.3 回归

- v3.0 全部功能不受影响(请求纪律、明信片导出、分享、PWA、主题切换、键盘空格)
- 无任何新增外部请求

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
| --- | --- | --- |
| localStorage 5MB 触顶 | 历史 / 收藏写失败 | `parseSafe` 抛 → toast 提示 + 自动降级内存 + 引导导出备份 |
| 用户清缓存丢数据 | 全部记忆消失 | 主动在面板顶部常驻「导出备份」入口,加首次进入 24h 后轻提示一次 |
| schema 演进 | 旧数据读不出 | `version` 字段必填;未来升 v2 时写迁移函数 |
| 性能(频繁写入) | 抽卡频繁抖动 | stats 写入用 `requestIdleCallback` + 合并(同一秒内多次抽卡合并为 1 次写入) |
| 隐私顾虑 | 部分用户不希望留痕 | 增加「隐身模式」开关(写入空 schema,UI 仍然可见但不入盘);放 v3.2 候选 |

---

## 11. 不做 / 延后

- ❌ 多设备云同步(需要账号体系,与「零依赖、打开即用」冲突)
- ❌ IndexedDB / 离线明信片缩略图(放 v3.2)
- ❌ 分享到具体平台(微信 / 微博 / X)(已有 Web Share API 通用方案,够用)
- ❌ 推荐算法 / 协同过滤(数据不足,且偏离项目定位)
- ❌ 全文搜索收藏夹(v3.2 候选,数据量不到搜索必要规模)
- ❌ 朗读(TTS)(待评估浏览器兼容与版权)

---

## 12. 时间线与版本号

- 2026-09-01:本文档立稿
- 2026-09-02~05:实施 M0~M4,每个 M 一个小 commit
- 2026-09-06 验收,打 **v3.1.0** tag + 推 Gitee + 同步 GitHub
- README 更新日志追加 v3.1.0 段落
- 反思沉淀到 `.dsh-memory/reflections/2026-09-06.md`

---

## 13. 验收签字

- [ ] 领主大人过目
- [ ] 仓库工作树干净,4 个 commit 等距
- [ ] tag v3.1.0 推送 Gitee
- [ ] README 更新日志到位