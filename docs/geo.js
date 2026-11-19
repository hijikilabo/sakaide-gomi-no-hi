(function (global) {
  'use strict';

  function addressKey(value) {
    return value.normalize('NFKC').replace(/\s+/gu, '')
      .replace(/^〒?\d{3}-?\d{4}(?=(?:香川県)?坂出市)/u, '')
      .replace(/^(?:香川県)?坂出市/u, '')
      .replace(/[‐‑‒–—−]/gu, '-');
  }

  function nameKey(value) {
    return value.normalize('NFKC').toLowerCase().replace(/[\s・‐‑‒–—−-]/gu, '')
      .replace(/[ァ-ヶ]/gu, kana => String.fromCharCode(kana.charCodeAt(0) - 0x60));
  }

  // Town coverage is explicitly declared by the reviewed source. Prefixes with
  // an unrecognized suffix are not eligible for automatic selection.
  function matchesAddress(rule, input) {
    const town = addressKey(rule.value);
    if (rule.kind === 'exact') return input === town;
    if (!input.startsWith(town)) return false;
    const suffix = input.slice(town.length);
    return !suffix || /^(?:[甲乙丙丁])?(?:\d+(?:(?:丁目|番地?|号|の|-)\d+)*(?:丁目|番地?|号)?|[一二三四五六七八九十]+丁目(?:\d+(?:(?:番地?|号|の|-)\d+)*(?:番地?|号)?)?)$/u.test(suffix);
  }

  function findAddress(data, value) {
    const query = addressKey(value);
    if (!data || !query) return {ids: [], exact: false};
    const matches = data.addresses.filter(rule => matchesAddress(rule, query));
    const exactRules = matches.filter(rule => rule.kind === 'exact' && rule.authoritative);
    const exactIds = [...new Set(exactRules.flatMap(rule => rule.areaIds))];
    if (exactIds.length === 1 && matches.every(rule => rule.areaIds.includes(exactIds[0]))) {
      return {ids: exactIds, exact: true};
    }
    const ids = [...new Set(matches.flatMap(rule => rule.areaIds))];
    return {ids, exact: ids.length === 1 && matches.some(rule => rule.authoritative)};
  }

  function findNames(data, value, allowed = null) {
    const query = nameKey(value);
    if (!data || !query) return [];
    return data.names.filter(name => (!allowed || allowed.includes(name.areaId))
      && [name.label, ...name.aliases].some(alias => nameKey(alias).includes(query)));
  }

  function ringContains(ring, [x, y]) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [ax, ay] = ring[j], [bx, by] = ring[i];
      if (ax === bx && ay === by) continue;
      const cross = (x - ax) * (by - ay) - (y - ay) * (bx - ax);
      if (Math.abs(cross) < 1e-12 && x >= Math.min(ax, bx) && x <= Math.max(ax, bx)
        && y >= Math.min(ay, by) && y <= Math.max(ay, by)) return 2;
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    }
    return inside ? 1 : 0;
  }

  function districtHints(data, point) {
    if (!data || !point) return [];
    return [...new Set(data.boundaries.filter(({rings}) => ringContains(rings[0], point)
      && !rings.slice(1).some(ring => ringContains(ring, point) === 1))
      .map(boundary => boundary.district))];
  }

  global.SakaideGeo = {addressKey, nameKey, findAddress, findNames, districtHints};
})(typeof window !== 'undefined' ? window : globalThis);
