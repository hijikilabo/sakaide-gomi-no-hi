(function (global) {
  'use strict';
  const TYPES = ['burnable', 'paper', 'other'];
  const ID = /^[a-z0-9][a-z0-9_-]{0,63}$/u;
  const BLOCK = /^\d{1,2}(?:-\([12]\))?$/u;
  const validText = value => typeof value === 'string' && value.trim().length > 0;
  const validSequence = value => Number.isSafeInteger(value) && value >= 0;
  const unique = values => new Set(values).size === values.length;

  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
    const d = new Date(value + 'T00:00:00Z');
    return !Number.isNaN(d.valueOf()) && d.toISOString().slice(0, 10) === value;
  }

  function officialURL(value) {
    if (!validText(value)) return false;
    try {
      const url = new URL(value);
      return url.protocol === 'https:' && url.hostname === 'www.city.sakaide.lg.jp'
        && !url.username && !url.password && !url.port;
    } catch {
      return false;
    }
  }

  function validManifest(manifest) {
    if (manifest?.schema !== 1 || !validSequence(manifest.revokedThrough)) return false;
    const r = manifest.release;
    return r === null || (r && validText(r.version) && ID.test(r.version) && validSequence(r.sequence)
      && r.sequence > manifest.revokedThrough && typeof r.sha256 === 'string'
      && /^[a-f0-9]{64}$/u.test(r.sha256));
  }

  function validDataset(data, pin) {
    if (data?.schema !== 1 || data.review_status !== 'verified'
      || data.version !== pin.version || data.sequence !== pin.sequence
      || !Number.isInteger(data.fiscalYear) || data.fiscalYear < 2000 || data.fiscalYear > 9998 || !validDate(data.scope_start) || !validDate(data.scope_end)
      || data.scope_start < `${data.fiscalYear}-04-01` || data.scope_end > `${data.fiscalYear + 1}-03-31`
      || data.scope_start > data.scope_end || !validDate(data.verifiedOn)
      || !Array.isArray(data.sources) || !data.sources.length
      || !Array.isArray(data.districts) || data.districts.length !== 12
      || !data.districts.every(validText) || !unique(data.districts)
      || !Array.isArray(data.areas) || !Array.isArray(data.addresses)
      || !Array.isArray(data.names) || !Array.isArray(data.boundaries)) return false;

    if (!data.sources.every(s => s && validText(s.id) && officialURL(s.url)
      && validDate(s.retrievedOn) && s.retrievedOn <= data.verifiedOn)
      || !unique(data.sources.map(s => s.id))) return false;
    const citesSources = ids => Array.isArray(ids) && ids.length > 0
      && ids.every(id => data.sources.some(s => s.id === id));
    if (!data.areas.every(area => area && validText(area.id) && ID.test(area.id)
      && data.districts.includes(area.district) && typeof area.block === 'string' && BLOCK.test(area.block)
      && (area.paper === null || validText(area.paper)) && citesSources(area.sources)
      && area.dates && Object.keys(area.dates).length === TYPES.length
      && TYPES.every(type => {
        const dates = area.dates?.[type];
        return dates === null || (Array.isArray(dates) && dates.every((day, i) => validDate(day)
          && day >= data.scope_start && day <= data.scope_end && (!i || day > dates[i - 1])));
      }))
      || !unique(data.areas.map(area => area.id))
      || !unique(data.areas.map(({district, block, paper}) => JSON.stringify([district, block, paper])))
      || data.areas.some(area => area.paper === null && data.areas.some(other => other !== area
        && other.district === area.district && other.block === area.block))) return false;
    if (!data.districts.every(district => data.areas.some(area => area.district === district))) return false;
    const areaIds = new Set(data.areas.map(area => area.id));
    return data.addresses.every(rule => rule && validText(rule.value) && ['exact', 'town'].includes(rule.kind)
      && typeof rule.authoritative === 'boolean' && citesSources(rule.sources)
      && Array.isArray(rule.areaIds) && rule.areaIds.length && rule.areaIds.every(id => areaIds.has(id)))
      && data.names.every(n => n && validText(n.label) && areaIds.has(n.areaId) && citesSources(n.sources)
        && ['association', 'building', 'area'].includes(n.kind) && Array.isArray(n.aliases) && n.aliases.every(validText))
      && data.boundaries.every(boundary => boundary && data.districts.includes(boundary.district)
        && citesSources(boundary.sources) && Array.isArray(boundary.rings) && boundary.rings.length
        && boundary.rings.every(ring => Array.isArray(ring) && ring.length >= 4
          && ring.every(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
            && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90)
          && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]));
  }

  async function sha256(raw) {
    const bytes = new TextEncoder().encode(raw);
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
  }

  async function readDataset(pin, raw) {
    if (!pin || typeof raw !== 'string' || await sha256(raw) !== pin.sha256) return null;
    try {
      const data = JSON.parse(raw);
      return validDataset(data, pin) ? data : null;
    } catch {
      return null;
    }
  }

  global.SakaideRelease = {TYPES, validManifest, validDataset, sha256, readDataset};
})(typeof window !== 'undefined' ? window : globalThis);
