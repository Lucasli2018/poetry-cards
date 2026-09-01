// =============================================================
// 古韵抽卡 v3.2.5 · favoritesStats store
// 职责:从 favorites 收藏夹实时计算「最爱朝代」「最爱意象」「收藏总数」
//
// 数据源:createFavoritesStore().list() — 不再单独写 statsMeta
//   这是 v3.2.5 的语义变更:
//     旧(v3.1~3.2.4):统计「抽卡历史」全部数据(累计/今日/朝代/意象)
//     新(v3.2.5)    :统计「收藏夹」 — 用户主动 ★ 的诗才计入
//
// 这样:
//   1) 朝代/意象是用户真正喜欢的内容,而非「所有抽到过」的内容
//   2) 取消收藏立刻从统计消失(实时一致)
//   3) 不需要写入数据,减少 localStorage 写入次数
//
// 旧 statsMeta 数据保留在 localStorage(不影响),但新逻辑不再读它。
// 重置 = 清空 favorites。
// =============================================================

/**
 * 工厂:接收一个 favoritesStore(由 createFavoritesStore 创建),
 * 返回 favoritesStats 模块的 5 个方法。
 */
export function createFavoritesStatsStore(favoritesStore) {
  if (!favoritesStore || typeof favoritesStore.list !== 'function') {
    throw new TypeError('createFavoritesStatsStore 需要一个 favoritesStore');
  }

  // ── 内部计算 ──────────────────────────────────────────
  function tally(items) {
    const dynastyCounter = {};
    const imageryCounter = {};
    // items 已由 normalizePoem 归一化过(dynasty 是字符串)
    for (const it of items) {
      if (it.dynasty) {
        dynastyCounter[it.dynasty] = (dynastyCounter[it.dynasty] || 0) + 1;
      }
      // 意象:本地诗 / 收藏时没有 imageTags → 不计入,避免假数据
      // (诗泉 API 没有 imageTags 字段,收藏时不存,故 imageryCounter 大概率空)
    }
    return { dynastyCounter, imageryCounter };
  }

  function topN(obj, n) {
    return Object.entries(obj || {})
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([key, count]) => ({ key, count }));
  }

  return {
    /** 收藏总数 */
    totalCount() {
      return favoritesStore.size();
    },

    /** 当前快照(给 UI 渲染用) */
    snapshot() {
      const items = favoritesStore.list();
      const { dynastyCounter, imageryCounter } = tally(items);
      return {
        totalFavorites: items.length,
        dynastyCounter,
        imageryCounter,
        topDynasties: topN(dynastyCounter, 5),
        topImagery:   topN(imageryCounter, 5),
      };
    },

    /** 朝代 TOP N */
    topDynasties(n = 3) {
      const items = favoritesStore.list();
      return topN(tally(items).dynastyCounter, n);
    },

    /** 意象 TOP N */
    topImagery(n = 3) {
      const items = favoritesStore.list();
      return topN(tally(items).imageryCounter, n);
    },

    /** 「重置统计」按钮:清空收藏(语义=重置所有统计) */
    reset() {
      favoritesStore.clear();
    },
  };
}