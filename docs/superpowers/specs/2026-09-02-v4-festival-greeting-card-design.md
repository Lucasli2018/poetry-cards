# 古韵抽卡 v4.0 升级规划 · 节日贺卡模板

> 立项日期: 2026-09-02
> 立项背景: v3.2.x 个性化记忆已稳定(收藏 / 历史 / 统计 / 分享 / 导出导入 / 视觉打磨),
> HEAD `b18970f` 后多个 micro-release 已推 master。
> 领主拍板下一站 = **节日贺卡模板**:
> 把现有「一图一诗明信片」扩展为「节日送礼场景海报」,
> 继续坚守**零依赖 + 单 HTML + 原生 ESM + localStorage 同步**架构约束。
> 存储载体: 沿用 v3.0/v3.1 既有命名空间;**新加 `pc_v3_festival_draft`** 单键存草稿。

---

## 1. 目标

把 v3.x 的「一次相遇 · 个人欣赏」升级为「节日送礼 · 私人定制海报」:

- 用户在主页 header 点击 🎋 按钮 → 进入**独立贺卡屏**(双入口方案 C)
- 贺卡屏内可挑选 5 个节日之一(春节 / 端午 / 中秋 / 重阳 / 生日),每节日 5~10 首精选诗
- 4 个自定义字段(送给 / 落款 / 寄语 / 印章文字)实时显示在明信片版式上
- 复用现有 Canvas 导出 + Web Share 分享,生成可发送的节日海报
- 草稿自动保存到 `pc_v3_festival_draft`,刷新 / 离开再回来仍可继续编辑

> 一切仍是「打开即用,无需登录、无需联网、无需构建」。

---

## 2. 设计原则(继承 + 新增)

| 原则 | 落地 |
|---|---|
| **零依赖** | 仍只用原生 ESM + DOM + Canvas,JSON 编解码用 `JSON.stringify/parse` |
| **请求纪律不松动** | 贺卡屏**不依赖诗泉 API**,只走静态 `festivals.json`(本地)+ 现有 AI 配图(走诗泉/不诗泉无关)+ 现有 Canvas 合成 |
| **文艺清新视觉** | 贺卡屏沿用明信片版式 + 朱砂印章 + 米白纸 + 衬线字体,新字段(送给/落款/寄语/印章)只增不改色板 |
| **隐私优先** | 草稿只存本地,不上传任何服务器;导出 PNG 由用户主动触发 |
| **零崩溃** | localStorage 不可用时复用 main.js 既有内存降级;festivals.json 加载失败时贺卡屏降级为「加载失败」占位,不阻塞抽卡屏 |
| **可演进** | festivals.json / draft schema 带 `version` 字段,便于未来加节日 / 迁移字段 |
| **零侵入** | `composeCard` 通过可选第 4 参数 `options` 扩展,**不传 options 时与 v3.2.9 输出像素级一致** |

---

## 3. 数据模型

### 3.1 FestivalsJSON(新增 `src/festivals.json`)

> 静态资源;5 个节日 × 5~10 首精选诗,合计 **25~50 首**。
> 数据精度优于 v3.1 local JSON:每首都是节日高关联度(春节 = 元日/爆竹/桃符; 中秋 = 水调歌头/月/婵娟; 等)。

```jsonc
{
  "version": 1,
  "festivals": [
    {
      "id": "spring",                       // 唯一 ID,用于路由 / 草稿 / 高亮
      "name": "春节",
      "icon": "🌸",
      "dateRule": "lunar-01-01",            // 节日日判定规则(展示「今天」小角标)
      "themeKeywords": ["spring festival","lantern","red plum blossom","firecracker"],
      // 配图 AI 提示词扩展(拼接在 poemPrompt 之后)
      "greeting": "新春快乐 · 万事如意",     // 切到此节日时的默认寄语
      "poems": [
        {
          "id": "f-spring-1",
          "title": "元日",
          "author": "王安石",
          "dynasty": "宋",
          "type": "七言绝句",
          "content": [
            "爆竹声中一岁除，春风送暖入屠苏。",
            "千门万户曈曈日，总把新桃换旧符。"
          ]
        }
        // ... 每个节日 5~10 首
      ]
    }
    // ... 共 5 个节日
  ]
}
```

**5 个节日清单**:

| ID | 名称 | 图标 | dateRule | 节日诗风格 |
| --- | --- | --- | --- | --- |
| `spring` | 春节 | 🌸 | lunar-01-01 | 元日 / 爆竹 / 桃符 / 新春 |
| `dragon` | 端午 | 🎋 | lunar-05-05 | 屈原 / 楚辞 / 粽子 / 龙舟 |
| `midautumn` | 中秋 | 🌕 | lunar-08-15 | 月 / 婵娟 / 思乡 / 团圆 |
| `chongyang` | 重阳 | 🍂 | lunar-09-09 | 登高 / 茱萸 / 菊花 / 敬老 |
| `birthday` | 生日 | 🎂 | today | 寿词 / 祝寿 / 自寿(单独节日,题材放宽) |

### 3.2 FestivalDraftSchema(新增 localStorage 键 `pc_v3_festival_draft`)

```jsonc
{
  "version": 1,
  "festivalId": "spring",            // 当前选中的节日
  "poemId": "f-spring-1",            // 当前选中的诗
  "imageUrl": "https://image.pollinations.ai/...",  // 已加载的背景图 URL(供刷新后还原)
  "sender": "老友 XXX",              // 落款
  "recipient": "小王",                // 送给
  "message": "新春大吉",              // 寄语
  "sealText": "福",                   // 印章文字(诗/礼/福/安/乐/吉/春/祥)
  "savedAt": 1725148800000           // ms 时间戳
}
```

**容量上限**:单条草稿,无需容量守卫;但**超过 5KB 强制截断** `imageUrl`(避免 5MB localStorage 触顶)。

### 3.3 存储键清单

| Key | 类型 | 来源 | 说明 |
| --- | --- | --- | --- |
| `pc_v3_festival_draft` | `FestivalDraftSchema` | **本版本新增** | 贺卡草稿(单条) |
| `pc_v3_favorites` / `pc_v3_history` / `pc_v3_stats_meta` | 不动 | v3.1 已存在 | 抽卡屏使用 |
| `pc_v3_theme` / `pc_v3_local_first` | 不动 | v3.0 已存在 | 主题 + 诗源开关 |

---

## 4. 模块划分

> 不引 npm、不拆页;**抽卡屏代码完全不动**,贺卡屏作为独立屏挂载。

```
src/
├── cards.js              ← 【扩展】composeCard 新增可选 options 参数
├── images.js             ← 不动(贺卡屏复用 fetchSceneImage)
├── main.js               ← 不动(只加 1 行 import:启动贺卡屏入口)
├── festivals.json        ← 【新增】5 节日 × 5~10 首精选诗
├── festival-data.js      ← 【新增】 festivals.json 加载 + 节日日判定 + 节日列表查询
├── festival-draft.js     ← 【新增】 草稿 store(CRUD + debounce + parseSafe + schema 常量)
└── festival-ui.js        ← 【新增】 贺卡屏 DOM 生成 + 状态管理 + 输入绑定
```

**对 main.js 的改动**(最小):

- 第 22 行 import 区: `+ import { mountFestivalUI } from './festival-ui.js';`
- 第 50 行 els: `+ festivalOpenBtn: $('pc-festival-open'),`
- `init()` 末尾: `+ mountFestivalUI(ls, els.festivalOpenBtn, ...);` 

**对 cards.js 的改动**(向后兼容):

```js
// 现有签名
export function composeCard(poem, bgImg, hostEl) { ... }

// 扩展为:
export function composeCard(poem, bgImg, hostEl, options = {}) {
  // options = { sender, recipient, message, sealText }
 // 不传 options 时:行为完全等同于 v3.2.9,所有现有调用方零回归
  // 传 options 时:底部加「送给 [recipient]」一行 + 诗文下加寄语一行 + 印章文字换为 sealText
}
```

---

## 5. 主流程接入点

> 最小侵入:main.js 只改 3 处,**不动 drawNew 的请求纪律**。

| 位置 | 代码片段 | 作用 |
|---|---|---|
| `index.html` header actions | `+ <button id="pc-festival-open" class="pc-btn pc-btn--header" title="贺卡模式">🎋</button>` | 新增入口 |
| `index.html` 末尾 `</main>` 后 | `+ <section id="pc-festival-screen" class="pc-festival-screen" hidden></section>` | 贺卡屏挂载点 |
| `main.js` `init()` 末尾 | `+ mountFestivalUI(...)` | 启动贺卡屏 + 绑定入口按钮 |

**贺卡屏进入流程**:

```
点击 🎋 → mountFestivalUI 触发 show() →
  隐藏 .pc-main / 显示 .pc-festival-screen / URL 加 #festival
  读取 pc_v3_festival_draft 还原 → 默认选第一个节日 / 第一首诗
点击「← 抽卡」→ 触发 hide() → 还原 .pc-main / 移除 #festival
  未保存时弹「当前贺卡未保存,确定离开?」确认
```

---

## 6. 关键算法

### 6.1 节日日判定

```text
isTodayFestival(festival, now):
  rule = festival.dateRule
  if rule == 'today':
    return true   // 生日 = 每天都算「今天」
  if rule.startsWith('lunar-'):
    // 农历转换复杂度高:v4.0 用 2026 年映射表(写死 5 个节日 5 行)
    return lunar_date(now) == rule.substr(6)
```

**简化策略**:v4.0 用 `lunar-01-01 → '01-29'`(春节公历日期近似映射,精度 ±1 天),
在 `festival-data.js` 顶部维护一个**2026 年公历映射表**:

```js
// 公历 2026 年节日映射(每年更新;非闰年通用)
const LUNAR_TO_SOLAR_2026 = {
  'lunar-01-01': '2026-02-17',  // 春节
  'lunar-05-05': '2026-06-19',  // 端午
  'lunar-08-15': '2026-09-25',  // 中秋
  'lunar-09-09': '2026-10-19',  // 重阳
};
```

> **不做**:v4.0 不引入农历转换库;按公历近似映射展示「今天」角标。
> 后续 v4.x 可考虑引入纯 JS 农历算法,但保持零依赖底线。

### 6.2 草稿 debounce 保存

```text
onInput(field, value):
  state[field] = value
  clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    ls.setItem('pc_v3_festival_draft', JSON.stringify(state))
    updateTimestamp()
  }, 500)   // 500ms 防抖:输入频繁时不抖动
```

### 6.3 composeCard options 字段渲染

```text
composeCard(poem, bgImg, hostEl, options):
  // 不传 options:行为完全等同 v3.2.9,执行原代码
  if (!options || Object.keys(options).length === 0) return 原有逻辑
  
  // 传 options:在原有绘制流中插入 3 个增量
  1. 在诗文正文绘制后、底部落款前:
     if (options.recipient) drawText(`送给 ${options.recipient}`)
  2. 在底部落款后(印章前):
     if (options.message) drawText(options.message)   // 寄语一行
  3. 印章文字替换:
     drawSeal(sealText = options.sealText || '诗')
```

### 6.4 离开提示

```text
hide() → 检查 state.dirty:
  if dirty: confirm('当前贺卡未下载,确定离开?')
    on ok: 执行 hide
    on cancel: 中止
  else: 直接 hide
```

`dirty` 判定:state 中任一字段与上次成功保存的草稿不一致 → dirty。

---

## 7. UI 规范

### 7.1 入口按钮

- 位置: `.pc-header-actions` 内,与「记忆」按钮同行
- 样式:沿用 `.pc-btn--header`(与主题切换按钮同高)
- title: 「贺卡模式」

### 7.2 贺卡屏容器

- 默认 `hidden`,通过 JS 切换
- 桌面端最大宽 **720px** 居中(沿用 `.pc-page` 容器风格)
- 移动端:贴边,水平 padding 16px
- 暗色模式:沿用 `.pc-dark` 全适配

### 7.3 节日胶囊(`.pc-festival-chip`)

- 默认态:米白底 + 灰褐描边 + 节日名(12px)
- 选中态:朱砂实心 + 反白文字
- 节日日(春节、中秋、重阳、端午 = 今天 / 生日 = 永远):右上角小圆点「今天」
- 横向滚动(超 5 个时) 或 flex-wrap

### 7.4 字段输入(`.pc-festival-input`)

- 「送给 / 落款」:maxlength=12,占位「小王」「老友 XXX」
- 「寄语」:maxlength=30,占位「新春快乐」
- 「印章」:`<select>` 选项:诗(默认)/ 礼 / 福 / 安 / 乐 / 吉 / 春 / 祥

### 7.5 操作按钮

- 「换一首」:沿用 `.pc-btn` 样式
- 「下载 PNG」/「分享」:沿用主页同名按钮样式
- 「← 抽卡」:左上角,`.pc-btn--ghost`(透明底 + 灰褐字)

---

## 8. 任务切片(M0 → M4)

> 每个 M 都是独立可合并的最小单元;每 M 跑完单测 + 浏览器手工冒烟再推。

### M0 · festivals.json + festival-data.js (0.5d)

- [ ] 编写 `src/festivals.json`(5 节日 × 5~10 首精选诗,**人工逐首挑选**)
- [ ] 新建 `src/festival-data.js`:加载 festivals.json + 节日日判定 + 节日列表查询
- [ ] 单测:文件存在 + JSON 合法 + 5 节日齐全 + 每节日 ≥5 首 + 字段齐全 + 节日日判定
- [ ] **不引入 UI**,仅为 M1 准备数据

### M1 · festival-draft.js + schema 集成 (0.5d)

- [ ] 新建 `src/festival-draft.js`:草稿 store(CRUD + debounce 500ms + parseSafe + 5KB 截断)
- [ ] 在 `src/store/schema.js` 扩展 `KEY.festivalDraft = 'pc_v3_festival_draft'` 与 `DEFAULTS.festivalDraft`
- [ ] 单测:草稿读/写/更新/debounce/parseSafe 坏数据/size 截断
- [ ] **不引入 UI**,验证 store 可独立测试

### M2 · cards.js options 扩展 (0.5d)

- [ ] 修改 `composeCard(poem, bgImg, hostEl, options = {})`:不传 options 时与 v3.2.9 输出像素级一致
- [ ] 传 options 时:加「送给」「寄语」行 + 印章文字替换
- [ ] 单测:不传 options 输出 bufferHash 等于 v3.2.9 基准;传 options 时字段在 canvas 像素中可识别

### M3 · festival-ui.js + 入口集成 (1.5d)

- [ ] 新建 `src/festival-ui.js`:贺卡屏 DOM 生成 + 状态管理 + 输入绑定
- [ ] `index.html` header 新增 🎋 按钮 + 新增 `<section id="pc-festival-screen" hidden>`
- [ ] `main.js` 接入 mountFestivalUI(ls, btn, els...)
- [ ] 节日胶囊渲染(高亮当前 + 「今天」角标)
- [ ] 「换一首」循环(节日内首尾相连)
- [ ] 字段双向绑定 + debounce 保存草稿
- [ ] 「下载 PNG」/「分享」复用 `cards.js#downloadCard/shareCard`
- [ ] 「← 抽卡」触发离开提示
- [ ] 浏览器冒烟:13 项清单(见 §9.2)

### M4 · 视觉测试 + 部署 (0.5d)

- [ ] 新增 `scripts/test-festival.mjs`(30 用例,纯 node)
- [ ] 视觉测试脚本 + 浏览器冒烟 + README 更新日志追加 v4.0.0 段落
- [ ] `git commit` + `git push origin master` + `git tag v4.0.0`
- [ ] 反思沉淀到 `.dsh-memory/reflections/2026-09-XX.md`

---

## 9. 测试与验收

### 9.1 单元测试(纯函数)

新增 `scripts/test-festival.mjs`,覆盖:

| 模块 | 用例 |
|---|---|
| `festival-data.js` | 5 节日齐全 / 每节日 ≥5 首 / 字段非空 / 节日日判定 / 公历映射表覆盖 |
| `festival-draft.js` | 读 / 写 / 更新 / debounce / parseSafe / size 截断 / 字段校验 |
| `cards.js#composeCard` | 不传 options 输出 hash 等于 v3.2.9 / 传 options 字段识别 / sealText 替换 |
| `festival-ui.js` | 状态机(节日切换 / 换一首循环 / 字段绑定 / dirty 判定) |

合计新增 **30 用例**。

### 9.2 浏览器冒烟(本地)

- [ ] 默认页打开 → 看到抽卡明信片;header 新增 🎋 按钮
- [ ] 点击 🎋 → 切换到贺卡屏,默认选中「春节」+《元日》
- [ ] 节日胶囊切换 → 明信片切到该节日对应诗
- [ ] 「换一首」循环 → 当前节日内首尾相连
- [ ] 改「送给 / 落款 / 寄语」 → input 实时绑定
- [ ] 「下载 PNG」 → 1080×1440 PNG 含送给/落款/寄语/印章
- [ ] 「分享」 → Web Share API(移动端);降级文案含送给 XXX
- [ ] 刷新页面 → 草稿从 `pc_v3_festival_draft` 还原
- [ ] 点击「← 抽卡」未保存 → 弹确认框
- [ ] 暗色模式 → 贺卡屏全适配
- [ ] 移动端宽度 → 贺卡屏可读、按钮可点、节日胶囊换行优雅
- [ ] festivals.json 故意删除 → 5 胶囊变「加载失败」,抽卡屏不受影响
- [ ] 切断网络进入贺卡屏 → festivals.json 本地加载;配图降级水墨渐变

### 9.3 回归

- v3.0/v3.1/v3.2 全部功能不受影响(抽卡、收藏、历史、统计、导出导入、分享、PWA、主题、键盘)
- composeCard 不传 options 时与 v3.2.9 输出1:1 一致(像素级 hash)
- 现有 164 个单测全绿

---

## 10. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| festivals.json 人工挑选成本 | 25~50 首 × 5 节日 = 高人力成本 | M0 阶段一次性集中编写;后续如扩节日复用同模式 |
| 公历映射每年失效 | 「今天」角标不再正确 | M0 顶部维护 2026 年映射;v4.x 加自动农历(复杂度高,放 v5 候选) |
| composeCard options 改变既有行为 | v3.2.x 现有 canvas 输出回归 | 单测用像素级 hash 锁定基线;**任何 hash 变更即视为回归** |
| 草稿频繁 debounce 写盘 | 性能/电量损耗 | 500ms 防抖足够;只在 input 结束时写 |
| 用户改「送给/落款」超长 | 版式错位 | maxlength + 失焦 toast 兜底 |
| 节日诗少导致「换一首」循环太短 | 用户体验差 | 每个节日至少 5 首;后续按需扩 |
| 印章文字 8 个不够 | 用户要自定义 | v4.0 限定 8 个预设;v4.x 可开放 input |

---

## 11. 不做 / 延后

- ❌ 农历自动转换(纯 JS 农历算法复杂度高,放 v5 候选)
- ❌ 用户自定义印章文字(超 1 字风险高;放 v4.x)
- ❌ 用户自定义节日(每个节日需要诗库,管理成本高)
- ❌ 节日历史记录(复用 favorites 已涵盖,避免污染抽卡统计)
- ❌ 多节日同贺卡(超出 v4.0 范围)
- ❌ 朗读诗词(放 v4.x 候选;依赖 Web Speech API 兼容性)
- ❌ 模板布局(横版 / 方版明信片)(放 v4.x)

---

## 12. 时间线与版本号

- 2026-09-02:本文档立稿
- 2026-09-03~05:实施 M0~M3
- 2026-09-06 验收,打 **v4.0.0** tag + 推 Gitee + 同步 GitHub
- README 更新日志追加 v4.0.0 段落
- 反思沉淀到 `.dsh-memory/reflections/`

---

## 13. 验收签字

- [ ] 领主过目
- [ ] 164 + 30 = 194 个单测全绿
- [ ] 浏览器冒烟清单 13 项全过
- [ ] tag v4.0.0 推送 Gitee + 同步 GitHub- [ ] README 更新日志到位
- [ ] 反思沉淀