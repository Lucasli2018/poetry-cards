# 古韵抽卡 (Poetry Cards)

> 单页 Web 应用，从精选古诗词随机抽卡，国风宣纸视觉。

## 预览

抽一签，得一诗。原文 / 作者 / 朝代 / 译文 / 作者简介全在卡片内，可点击卡片查看详情、复制全文、加入收藏。

## 功能

- 🎴 随机抽卡，含「避免短期重复」策略
- 📜 六分类筛选：唐诗精选 / 宋词精选 / 小学 / 初中 / 高中 / 诗经
- 🖼️ 卷轴卡片 + 朱砂印章，国风宣纸视觉
- 📖 详情弹窗：原文 + 译文 + 作者简介
- ⭐ 收藏夹独立存储
- 📋 一键复制全文到剪贴板
- 🕘 抽取历史永久保留（localStorage），横向滚动画廊
- 🗑️ 清空历史带二次确认
- 📱 移动端响应式（≤375px 不破版）

## 启动

### 双击即玩

直接双击 `index.html`，现代浏览器（Chrome / Edge / Firefox / Safari）即可运行。

### 本地开发

```bash
npm install
npm run serve    # http://localhost:8080
npm test         # 28 个测试用例
npm run validate-data  # 校验 poetry.json
```

## 数据源

基于 https://gitee.com/li-luoqiang/chinese-poetry 公开数据集，内置精选 ~93 首（v1.0），按计划后续扩充至 ~500 首。

数据格式：

```json
{
  "meta": { "version": "1.0", "count": 93, "dynasty": ["先秦", "唐", "宋"] },
  "poems": [{
    "id": "tang-li-bai-jingyesi",
    "title": "静夜思",
    "author": "李白",
    "dynasty": "唐",
    "category": "小学古诗",
    "content": ["床前明月光", "..."],
    "translate": "...",
    "authorBio": "...",
    "tags": ["思乡"]
  }]
}
```

## 架构

```
poetry-cards/
├── index.html              # 单页入口
├── styles.css              # 国风样式
├── src/
│   ├── main.js             # 启动 + 事件装配
│   ├── data.js             # 加载 poetry.json
│   ├── store.js            # localStorage 封装
│   ├── filter.js           # 分类筛选
│   ├── draw.js             # 随机抽卡
│   ├── card.js             # 卡片组件
│   ├── render.js           # 画廊/详情渲染
│   ├── ui.js               # 弹窗/Toast/复制
│   └── utils.js            # 工具方法
├── data/poetry.json        # 精选数据
├── tests/                  # 28 测试
└── scripts/validate-data.js
```

零运行时依赖（仅 `vitest` + `jsdom` 作为 devDependency）。

## 部署到 Gitee Pages

```bash
# 初始化仓库后
git remote add origin git@gitee.com:li-luoqiang/poetry-cards.git
git push -u origin master
# Gitee 仓库页 → 服务 → Gitee Pages → 启动
```

入口即 `index.html`。

## 测试

```bash
npm test
```

输出：

```
 ✓ tests/utils.test.js (4 tests)
 ✓ tests/store.test.js (7 tests)
 ✓ tests/filter.test.js (6 tests)
 ✓ tests/draw.test.js (6 tests)
 ✓ tests/render.test.js (5 tests)

 Test Files  5 passed (5)
      Tests  28 passed (28)
```

## 验收清单

- [x] 双击 `index.html` 在 Chrome/Edge 即玩
- [x] 抽卡翻牌动画流畅
- [x] 历史永久保留（localStorage）
- [x] 分类筛选生效
- [x] 译文/简介可展开
- [x] 复制全文到剪贴板
- [x] 收藏夹独立面板
- [x] localStorage 异常内存兜底
- [x] 移动端 480px 不破版
- [x] vitest 28 用例全绿
- [ ] Gitee Pages 部署

## 许可

MIT

数据来源：[chinese-poetry](https://gitee.com/li-luoqiang/chinese-poetry)，公开数据集。