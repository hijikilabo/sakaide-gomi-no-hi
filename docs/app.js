(function () {
  'use strict';
  const S = window.SakaideSchedule;
  const Geo = window.SakaideGeo;
  const Release = window.SakaideRelease;
  const PROFILE = 'sakaide-gominohi:profile:v2';
  const SIZE = 'sakaide-gominohi:text-size:v1';
  const CACHE_DB = 'sakaide-gominohi-releases';
  const CACHE_STORE = 'approved';
  const CACHE_KEY = 'current';
  const TYPES = [
    {id: 'burnable', name: '燃えるごみ', short: '燃', icon: 'fire'},
    {id: 'paper', name: '紙類', short: '紙', icon: 'paper'},
    {id: 'other', name: '不燃・資源ごみ', short: '資', icon: 'other'}
  ];
  const METHODS = ['address', 'map', 'name', 'block'];
  const $ = id => document.getElementById(id);
  const text = (id, value) => { $(id).textContent = value; };
  const show = (id, visible) => $(id).classList.toggle('hidden', !visible);
  const read = key => {
    try { return JSON.parse(localStorage.getItem(key)); } catch { return null; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
  };
  const option = (label, value) => new Option(label, value);
  const clockNow = () => S.japanClock(new Date());

  let profile = read(PROFILE), data = null, stored = null, revokedThrough = 0;
  let method = 'address', draft = null, map = null, month = '', selectedDate = '', browsingMonth = false;
  let cacheAvailable = false, database;
  let checking = true, transport = '', viewingSetup = true, userEditing = false, refreshing, lastClock = '';
  let allowedAreaIds = null;
  const areaFor = id => data?.areas.find(area => area.id === id);
  const profileArea = () => {
    const area = areaFor(profile?.id);
    return area && area.district === profile.district && area.block === profile.block
      && area.paper === profile.paper ? area : null;
  };
  const areaLabel = area => `${area.district}地区 ／ ブロック ${area.block}${area.paper ? ` ／ 紙類：${area.paper}` : ''}`;
  const usableData = () => data && clockNow().date <= data.scope_end;
  const statusLabel = () => {
    if (checking && !data) return '収集日データを確認しています。';
    if (!data) return transport === 'unavailable'
      ? '未確認：収集日データを取得できません。坂出市の公式資料をご確認ください。'
      : '未確認：配信を承認した収集日データはありません。坂出市の公式資料をご確認ください。';
    return `データ ${data.version} ／ ${data.scope_start} ～ ${data.scope_end}${transport === 'unavailable' ? (cacheAvailable ? '（端末に保存済み）' : '（更新の確認ができません）') : ''}`;
  };

  function setSize(size) {
    const value = ['standard', 'large', 'xlarge'].includes(size) ? size : 'standard';
    document.documentElement.dataset.textSize = value;
    document.querySelectorAll('[data-size]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.size === value)));
    try { localStorage.setItem(SIZE, value); } catch { /* Session-only setting. */ }
  }

  function settings(open) {
    show('settings', open);
    $('settingsBtn').setAttribute('aria-expanded', String(open));
    $(open ? 'closeSettings' : 'settingsBtn').focus();
  }

  function confirm(area, focus = false) {
    draft = usableData() ? area : null;
    show('confirm', Boolean(draft));
    if (!draft) return;
    text('confirmMessage', areaLabel(draft));
    if (focus) {
      $('confirmHeading').focus();
      $('confirm').scrollIntoView({block: 'nearest'});
    }
  }

  function addChoice(parent, label, action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'outline-button wide';
    button.textContent = label;
    button.addEventListener('click', action);
    parent.append(button);
  }

  function addNames(parent, matches) {
    for (const result of matches) {
      const area = areaFor(result.areaId);
      addChoice(parent, `${result.label} ／ ${areaLabel(area)}`, () => confirm(area, true));
    }
  }

  function findAddress(event) {
    event.preventDefault();
    confirm(null);
    const choices = $('addressChoices');
    choices.replaceChildren();
    const input = $('addressInput').value.trim();
    if (!input) { text('lookupStatus', '坂出市の住所を入力してください。'); return; }
    const result = Geo.findAddress(usableData() ? data : null, input);
    if (!result.ids.length) {
      text('lookupStatus', '未確認：この住所からは地区・収集区分を確認できません。自治会・マンション名、または公式のブロック番号でお試しください。');
      return;
    }
    if (result.exact) {
      text('lookupStatus', '住所から収集区分が見つかりました。');
      confirm(areaFor(result.ids[0]), true);
      return;
    }
    text('lookupStatus', '住所だけでは収集区分を確定できません。お住まいの自治会・マンション名、または公式のブロック番号をご確認ください。');
    const label = document.createElement('label');
    label.htmlFor = 'addressName';
    label.textContent = '自治会・マンション名';
    const name = document.createElement('input');
    name.id = 'addressName';
    name.type = 'search';
    name.autocomplete = 'off';
    name.maxLength = 120;
    const named = document.createElement('div');
    named.className = 'choice-list';
    name.addEventListener('input', () => {
      confirm(null);
      named.replaceChildren();
      const matches = Geo.findNames(data, name.value, result.ids);
      addNames(named, matches);
      text('lookupStatus', matches.length ? `${matches.length}件の候補からお住まいを選んでください。` : '該当する確認済みの名称が見つかりません。');
    });
    const manual = document.createElement('div');
    manual.className = 'choice-list';
    addChoice(manual, '公式の地区・ブロック番号を指定', () => {
      setMethod('block');
      allowedAreaIds = result.ids;
      const districts = [...new Set(result.ids.map(id => areaFor(id).district))];
      fillDistricts(districts);
      $('district').focus();
    });
    choices.append(label, name, named, manual);
    name.focus();
  }

  function findName() {
    confirm(null);
    const choices = $('nameChoices');
    choices.replaceChildren();
    const input = $('areaSearch').value.trim();
    const matches = Geo.findNames(usableData() ? data : null, input);
    addNames(choices, matches);
    text('lookupStatus', !input ? '' : matches.length
      ? `${matches.length}件の候補からお住まいを選んでください。`
      : '未確認：該当する確認済みの名称が見つかりません。');
  }

  function fillDistricts(districts = data?.districts ?? []) {
    const el = $('district');
    el.replaceChildren(option('地区を選択', ''));
    if (usableData()) districts.forEach(d => el.add(option(`${d}地区`, d)));
    el.disabled = el.options.length === 1;
    fillBlocks();
  }

  function candidateAreas() {
    return data?.areas.filter(area => !allowedAreaIds || allowedAreaIds.includes(area.id)) ?? [];
  }

  function fillBlocks() {
    const blocks = [...new Set(candidateAreas().filter(area => area.district === $('district').value)
      .map(area => area.block))].sort((a, b) => a.localeCompare(b, 'ja', {numeric: true}));
    const el = $('manualBlock');
    el.replaceChildren(option('ブロックを選択', ''));
    blocks.forEach(block => el.add(option(`ブロック ${block}`, block)));
    el.disabled = !blocks.length;
    fillPaper();
  }

  function fillPaper() {
    const options = candidateAreas().filter(area =>
      area.district === $('district').value && area.block === $('manualBlock').value);
    show('paperWrap', options.length > 1);
    const el = $('paperWeek');
    el.replaceChildren(option('収集区分を選択', ''));
    if (options.length > 1) {
      options.filter(area => area.paper).forEach(area => el.add(option(area.paper, area.id)));
      text('lookupStatus', 'この地区・ブロックには複数の収集区分があります。紙類の区分を確認してください。');
    } else text('lookupStatus', '');
    confirm(options.length === 1 ? options[0] : null);
  }

  function pinChanged(point) {
    confirm(null);
    const choices = $('mapChoices');
    choices.replaceChildren();
    const districts = Geo.districtHints(data, point);
    text('lookupStatus', districts.length
      ? 'ピンの位置から地区候補を表示しました。利用する収集ブロックは公式資料でお確かめください。'
      : '未確認：この地点の地区を判定できません。');
    for (const district of districts) {
      addChoice(choices, `${district}地区のブロックを確認`, () => {
        setMethod('block');
        fillDistricts(districts);
        $('district').value = district;
        fillBlocks();
        $('manualBlock').focus();
      });
    }
  }

  function setMethod(next) {
    method = next;
    allowedAreaIds = null;
    METHODS.forEach(key => show(key + 'Route', method === key));
    document.querySelectorAll('[data-method]').forEach(button =>
      button.setAttribute('aria-pressed', String(button.dataset.method === method)));
    map?.destroy();
    map = null;
    $('addressInput').value = '';
    $('areaSearch').value = '';
    for (const id of ['addressChoices', 'nameChoices', 'mapChoices']) $(id).replaceChildren();
    text('lookupStatus', '');
    confirm(null);
    if (method === 'block') fillDistricts();
    if (method === 'map') {
      const hasMap = Boolean(usableData() && data.boundaries.length);
      show('mapArea', hasMap);
      text('mapMessage', hasMap ? '位置情報は端末内で照合します。'
        : '未確認：照合できる地区境界データがありません。ほかの設定方法をお試しください。');
      if (hasMap) map = window.createBoundaryMap($('map'), data.boundaries, pinChanged);
    }
  }

  function setup(focus = false) {
    viewingSetup = true;
    if (focus) userEditing = true;
    show('setup', true);
    show('dashboard', false);
    show('settings', false);
    $('settingsBtn').setAttribute('aria-expanded', 'false');
    show('cancelBtn', Boolean(profileArea()));
    text('setupStatus', data && !usableData() ? '収集日データの適用期間を過ぎています。最新の公式資料をご確認ください。'
      : profile && !profileArea() && data ? '保存済みの収集区分を確認できません。設定し直してください。' : statusLabel());
    show('setupStatus', !data || !usableData() || Boolean(profile && !profileArea()));
    setMethod(method);
    if (focus) $('setupHeading').focus();
  }

  function save() {
    if (!usableData()) { setup(true); return; }
    if (!draft || areaFor(draft.id) !== draft) return;
    const {id, district, block, paper} = draft;
    profile = {id, district, block, paper};
    browsingMonth = false;
    selectedDate = '';
    const persisted = write(PROFILE, profile);
    home(true);
    if (!persisted) {
      text('configNotice', '端末に保存できなかったため、この設定は画面を閉じるまで有効です。');
      show('configNotice', true);
    }
  }

  const countdown = (date, clock) => {
    const days = S.daysUntil(date, clock);
    return days === 0 ? '今日' : days === 1 ? '明日' : `あと${days}日`;
  };
  function typeIcon(t){
    const icon=document.createElement('span');icon.className=`type-icon ${t.id==='burnable'?'':t.id}`;
    icon.setAttribute('aria-hidden','true');
    // Symbols are deliberately functional rather than decorative artwork.
    const paths={fire:'<path d="M12 2C13 6 8 8 10 12c-4-1-3-5-3-5C2 14 6 22 12 22c5 0 9-5 7-10-1-3-4-5-4-5 .5 5-2 6-3 7 0-4 2-7 0-12Z"/>',paper:'<rect x="5" y="3" width="12" height="16" rx="1"/><path d="M8 8h6M8 12h6M8 16h4M17 6h2v15H8"/>',other:'<path d="M9 4h6l1 4v12H8V8l1-4ZM8 9h8M11 3V1h2v2M5 16h2M17 16h2"/>'};
    icon.innerHTML=`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[t.icon]}</svg>`;
    return icon;
  }

  function nextDates(clock, area) {
    const rows = $('nextDates');
    rows.replaceChildren();
    const futures = [];
    for (const type of TYPES) {
      const row = document.createElement('div');
      row.className = 'date-row';
      const left = document.createElement('div');
      left.className = 'date-name';
      const title = document.createElement('strong');
      title.textContent = type.name;
      left.append(typeIcon(type), title);
      const right = document.createElement('div');
      right.className = 'right';
      const next = S.nextFor(type.id, area, data, clock);
      if (next) {
        right.textContent = S.dateLabel(next, next.slice(0, 4) !== clock.date.slice(0, 4));
        const count = document.createElement('span');
        count.className = 'countdown';
        count.textContent = countdown(next, clock);
        right.append(count);
        futures.push({...type, date: next});
      } else {
        const unknown = area.dates[type.id] === null || clock.date > data.scope_end;
        right.textContent = unknown ? '未確認' : '適用期間内の残りの予定なし';
        row.classList.toggle('unset', unknown);
      }
      row.append(left, right);
      rows.append(row);
    }
    return futures.sort((a, b) => a.date.localeCompare(b.date));
  }

  function calendar(clock, area, restoreFocus = false) {
    const [year, mon] = month.split('-').map(Number);
    text('calendarTitle', `${year}年${mon}月`);
    $('prevMonth').disabled = month <= data.scope_start.slice(0, 7);
    $('nextMonth').disabled = month >= data.scope_end.slice(0, 7);
    const grid = $('calendar');
    grid.replaceChildren();
    const offset = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
    for (let i = 0; i < offset; i++) {
      const blank = document.createElement('span');
      blank.className = 'cal-gap';
      grid.append(blank);
    }
    const seeDay = key => {
      const types = S.eventsOn(key, area, data).map(id => TYPES.find(t => t.id === id).name);
      const dayStatus = !S.inScope(key, data) ? 'この日は適用期間外です'
        : types.length ? types.join('・') : '確認済みの収集予定なし';
      text('selectedInfo', `${S.dateLabel(key)}：${dayStatus}`);
    };
    const end = new Date(Date.UTC(year, mon, 0)).getUTCDate();
    for (let i = 1; i <= end; i++) {
      const key = `${month}-${String(i).padStart(2, '0')}`;
      const events = S.eventsOn(key, area, data);
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cal-day';
      if (key === clock.date) button.setAttribute('aria-current', 'date');
      button.setAttribute('aria-pressed', String(key === selectedDate));
      button.setAttribute('aria-label', `${S.dateLabel(key)}：${!S.inScope(key, data) ? '適用期間外'
        : events.map(id => TYPES.find(t => t.id === id).name).join('、') || '確認済みの収集予定なし'}`);
      const num = document.createElement('span');
      num.textContent = i;
      const marks = document.createElement('span');
      marks.className = 'cal-marks';
      marks.setAttribute('aria-hidden', 'true');
      for (const type of TYPES.filter(t => events.includes(t.id))) {
        const mark = document.createElement('span');
        mark.className = 'dot ' + type.id;
        mark.textContent = type.short;
        marks.append(mark);
      }
      button.append(num, marks);
      button.addEventListener('click', () => {
        selectedDate = key;
        calendar(clockNow(), area, true);
      });
      grid.append(button);
      if (restoreFocus && key === selectedDate) button.focus({preventScroll: true});
    }
    seeDay(selectedDate || (clock.date.startsWith(month) ? clock.date : month + '-01'));
  }

  function home(focus = false) {
    const area = profileArea();
    if (!area) { setup(focus); return; }
    viewingSetup = false;
    userEditing = false;
    map?.destroy();
    map = null;
    $('addressInput').value = '';
    $('areaSearch').value = '';
    for (const id of ['addressChoices', 'nameChoices', 'mapChoices']) $(id).replaceChildren();
    confirm(null);
    show('dashboard', true);
    show('setup', false);
    const clock = clockNow();
    lastClock = clock.date + S.isAfterDeadline(clock);
    text('dataStatus', statusLabel());
    text('todayText', '今日：' + S.dateLabel(clock.date, true));
    text('districtLabel', `${area.district}地区 · ブロック ${area.block}`);
    const expired = clock.date > data.scope_end;
    const incomplete = TYPES.some(type => area.dates[type.id] === null);
    const warning = expired ? '収集日データの適用期間を過ぎています。最新の公式資料をご確認ください。'
      : clock.date < data.scope_start ? 'このデータはまだ適用期間前です。適用開始前の収集日は市の公式資料をご確認ください。'
        : incomplete ? '一部のごみの収集日は未確認です。' : '';
    show('configNotice', Boolean(warning));
    text('configNotice', warning);
    const futures = nextDates(clock, area);
    const first = futures[0]?.date;
    text('heroHeading', incomplete ? '確認できている次の収集日' : '次に出せるごみ');
    text('heroDate', first ? S.dateLabel(first, first.slice(0, 4) !== clock.date.slice(0, 4))
      : expired ? '公式日程の更新待ち' : '次の収集日は未確認');
    text('heroType', futures.filter(item => item.date === first).map(item => item.name).join('・'));
    text('heroNote', first ? countdown(first, clock) : '');
    const min = data.scope_start.slice(0, 7), max = data.scope_end.slice(0, 7);
    const current = [min, clock.date.slice(0, 7), max].sort()[1];
    if ((!browsingMonth && month !== current) || !month || month < min || month > max) {
      month = current;
      selectedDate = '';
    }
    calendar(clock, area);
    if (focus) { $('heroDate').focus(); window.scrollTo(0, 0); }
  }

  function shiftMonth(delta) {
    browsingMonth = true;
    const [year, current] = month.split('-').map(Number);
    month = S.keyOf(new Date(Date.UTC(year, current - 1 + delta, 1))).slice(0, 7);
    selectedDate = '';
    calendar(clockNow(), profileArea());
  }

  async function jsonRequest(path) {
    const response = await fetch(path, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(8000)});
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.text();
  }

  function releaseDatabase() {
    database ??= new Promise((resolve, reject) => {
      const open = indexedDB.open(CACHE_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(CACHE_STORE);
      open.onsuccess = () => {
        open.result.onversionchange = () => open.result.close();
        resolve(open.result);
      };
      open.onerror = () => reject(open.error);
      open.onblocked = () => reject(new Error('release cache is locked'));
    });
    return database;
  }

  async function cacheRelease(record) {
    try {
      const db = await releaseDatabase();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction(CACHE_STORE, 'readwrite');
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error);
        transaction.objectStore(CACHE_STORE).put(record, CACHE_KEY);
      });
      cacheAvailable = Boolean(record.raw);
    } catch {
      cacheAvailable = false;
    }
  }

  async function restore() {
    const db = await releaseDatabase();
    const saved = await new Promise((resolve, reject) => {
      const request = db.transaction(CACHE_STORE).objectStore(CACHE_STORE).get(CACHE_KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (!Release.validManifest(saved?.manifest)) return;
    revokedThrough = saved.manifest.revokedThrough;
    if (saved.manifest.release) {
      const previous = await Release.readDataset(saved.manifest.release, saved.raw);
      if (previous) {
        stored = saved;
        data = previous;
        transport = 'unavailable';
        cacheAvailable = true;
      }
    }
  }

  function refresh() {
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const previous = data;
      try {
        const manifest = JSON.parse(await jsonRequest('./data/current.json'));
        if (!Release.validManifest(manifest) || manifest.revokedThrough < revokedThrough) throw new Error('manifest');
        revokedThrough = manifest.revokedThrough;
        if (!data || data.sequence <= revokedThrough) {
          stored = null;
          data = null;
          await cacheRelease({manifest: {...manifest, release: null}});
        } else if (stored.manifest.revokedThrough !== revokedThrough) {
          stored.manifest.revokedThrough = revokedThrough;
          await cacheRelease(stored);
        }
        const pin = manifest.release;
        if (pin && (!data || pin.sequence > data.sequence)) {
          const raw = await jsonRequest(`./data/${pin.version}.json`);
          const verified = await Release.readDataset(pin, raw);
          if (!verified) throw new Error('release');
          stored = {manifest, raw};
          data = verified;
          await cacheRelease(stored);
        } else if (pin && data && (pin.sequence !== data.sequence || pin.sha256 !== stored.manifest.release.sha256)) {
          throw new Error('stale or altered pin');
        }
        transport = 'online';
      } catch {
        transport = 'unavailable';
      } finally {
        checking = false;
        if (!viewingSetup) home();
        else if (data !== previous) {
          if (!userEditing && profileArea()) home();
          else setup();
        } else text('setupStatus', data && !usableData()
          ? '収集日データの適用期間を過ぎています。最新の公式資料をご確認ください。' : statusLabel());
      }
    })().finally(() => { refreshing = null; });
    return refreshing;
  }

  async function init() {
    try {
      setSize(localStorage.getItem(SIZE));
      // V3 could persist a building/association name and cached provisional schedules.
      localStorage.removeItem('sakaide-gominohi:profile:v1');
      localStorage.removeItem('sakaide-gominohi:last-verified-data:v1');
    } catch { setSize('standard'); }
    document.querySelectorAll('[data-size]').forEach(button =>
      button.addEventListener('click', () => setSize(button.dataset.size)));
    document.querySelectorAll('[data-method]').forEach(button =>
      button.addEventListener('click', () => setMethod(button.dataset.method)));
    $('settingsBtn').addEventListener('click', () => settings($('settings').classList.contains('hidden')));
    $('closeSettings').addEventListener('click', () => settings(false));
    for (const id of ['editAreaFromSettings', 'changeDistrict']) $(id).addEventListener('click', () => setup(true));
    $('addressForm').addEventListener('submit', findAddress);
    $('addressInput').addEventListener('input', () => {
      $('addressChoices').replaceChildren();
      text('lookupStatus', '');
      confirm(null);
    });
    $('areaSearch').addEventListener('input', findName);
    $('district').addEventListener('change', fillBlocks);
    $('manualBlock').addEventListener('change', fillPaper);
    $('paperWeek').addEventListener('change', () => confirm(areaFor($('paperWeek').value)));
    $('zoomIn').addEventListener('click', () => map?.zoom(2));
    $('zoomOut').addEventListener('click', () => map?.zoom(.5));
    $('gpsBtn').addEventListener('click', () => {
      if (!map || !navigator.geolocation) { text('lookupStatus', 'この端末では現在地を利用できません。'); return; }
      const activeMap = map;
      text('lookupStatus', '現在地の利用許可を確認しています。');
      navigator.geolocation.getCurrentPosition(({coords}) => {
        if (map === activeMap) map.locate([coords.longitude, coords.latitude]);
      }, () => {
        if (map === activeMap) text('lookupStatus', '現在地を取得できませんでした。地図で指定してください。');
      }, {timeout: 12000});
    });
    $('saveBtn').addEventListener('click', save);
    $('cancelBtn').addEventListener('click', () => home(true));
    $('prevMonth').addEventListener('click', () => shiftMonth(-1));
    $('nextMonth').addEventListener('click', () => shiftMonth(1));
    try { await restore(); } catch { /* Invalid stored data cannot initialize the app. */ }
    if (profileArea()) home();
    else setup();
    refresh();
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
    window.addEventListener('online', refresh);
    setInterval(() => {
      const clock = clockNow();
      if (!viewingSetup && lastClock !== clock.date + S.isAfterDeadline(clock)) home();
    }, 15000);
    if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  init();
})();
