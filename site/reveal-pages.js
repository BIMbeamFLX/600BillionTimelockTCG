(function (root) {
  "use strict";

  const BOOSTER_PAGE_LIMIT = 15;
  const STARTER_PAGE_CAPACITY = 11;

  /* A booster is already designed as one 3x5 reveal. Larger products are split
   * into the fewest pages that never exceed eleven cards, then balanced so the
   * last page is not a lonely remainder. Eight pages therefore hold an 82-card
   * starter set as 11, 11, then six pages of 10. */
  function split(ids, fresh) {
    const cards = Array.isArray(ids) ? ids.slice() : [];
    const flags = cards.map((_, index) => Boolean(Array.isArray(fresh) && fresh[index]));
    if (cards.length <= BOOSTER_PAGE_LIMIT) return [{ ids: cards, fresh: flags }];
    const count = Math.ceil(cards.length / STARTER_PAGE_CAPACITY);
    const base = Math.floor(cards.length / count);
    const extra = cards.length % count;
    const pages = [];
    let offset = 0;
    for (let index = 0; index < count; index += 1) {
      const size = base + (index < extra ? 1 : 0);
      pages.push({
        ids: cards.slice(offset, offset + size),
        fresh: flags.slice(offset, offset + size),
      });
      offset += size;
    }
    return pages;
  }

  root.E1RevealPages = Object.freeze({ split, BOOSTER_PAGE_LIMIT, STARTER_PAGE_CAPACITY });
  if (typeof module === "object" && module.exports) module.exports = root.E1RevealPages;
})(globalThis);
