/* ============================================================
   Napell Coffee Chain OS · 静态站点内嵌数据层
   在浏览器内实现 __SMART_PAGE__.database 契约（与 WorkBuddy 资料库同形），
   使多页站点在静态托管上依然可读可写；写入结果留在 localStorage。
   若运行在 WorkBuddy 资料库中，真实 SDK 存在，本层自动让位。
   ============================================================ */
(function () {
  if (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) { return; }

  var SNAP = window.__NAPELL_SNAPSHOT__;
  if (!SNAP) { return; }
  var LS_KEY = 'napell_os_demo_v1';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ID2KEY = {}, KEYS = [];
  for (var k in SNAP.tables) {
    if (Object.prototype.hasOwnProperty.call(SNAP.tables, k)) {
      ID2KEY[SNAP.tables[k].databaseId] = k;
      KEYS.push(k);
    }
  }

  function freshRows() {
    var m = {};
    for (var i = 0; i < KEYS.length; i++) { m[KEYS[i]] = clone(SNAP.tables[KEYS[i]].rows); }
    return m;
  }

  var store = null;
  function load() {
    if (store) { return store; }
    var raw = null;
    try { raw = window.localStorage.getItem(LS_KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        var parsed = JSON.parse(raw);
        if (parsed && parsed.rows && parsed.seq) { store = parsed; return store; }
      } catch (e) { /* 落回快照 */ }
    }
    store = { rows: freshRows(), seq: 0 };
    return store;
  }
  function save() {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(store)); } catch (e) { /* 隐私模式忽略 */ }
  }
  function rowsOf(dbid) {
    var s = load(), key = ID2KEY[dbid];
    return key && s.rows[key] ? s.rows[key] : null;
  }
  function optionsOf(dbid, field) {
    var key = ID2KEY[dbid];
    var props = (SNAP.tables[key] || {}).schema ? SNAP.tables[key].schema.properties : [];
    for (var i = 0; i < props.length; i++) {
      if (props[i].name === field) { return (props[i].config && props[i].config.options) || []; }
    }
    return [];
  }
  function resolveValue(dbid, field, tv) {
    if (tv === null || tv === undefined) { return null; }
    if (typeof tv !== 'object') { return tv; }
    var keys = Object.keys(tv);
    if (!keys.length) { return null; }
    var kind = keys[0], v = tv[kind];
    if (kind === 'select' || kind === 'multi_select') {
      var opts = optionsOf(dbid, field);
      for (var i = 0; i < opts.length; i++) { if (opts[i].id === v) { return opts[i].text; } }
      return v;
    }
    return v;
  }
  function applyFilter(rows, f) {
    if (!f || !f.property || !f.property.property) { return rows; }
    var prop = f.property.property, want;
    if (f.property.text && f.property.text.equals !== undefined) { want = f.property.text.equals; }
    else { return rows; }
    return rows.filter(function (r) { return r[prop] === want; });
  }
  function sortRows(rows, sorts) {
    var out = rows.slice();
    out.sort(function (a, b) {
      for (var i = 0; i < sorts.length; i++) {
        var f = sorts[i].property;
        var dir = sorts[i].direction === 'ascending' ? 1 : -1;
        var x = a[f], y = b[f];
        if (x === y) { continue; }
        if (x === undefined || x === null) { return 1; }
        if (y === undefined || y === null) { return -1; }
        if (typeof x === 'number' && typeof y === 'number') { return (x - y) * dir; }
        return (String(x) < String(y) ? -1 : 1) * dir;
      }
      return 0;
    });
    return out;
  }
  function P(fn) {
    return new Promise(function (res, rej) {
      setTimeout(function () { try { res(fn()); } catch (e) { rej(e); } }, 0);
    });
  }

  var database = {
    query: function (p) {
      return P(function () {
        var rows = rowsOf(p.databaseId) || [];
        rows = applyFilter(rows, p.filter);
        if (p.sorts && p.sorts.length) { rows = sortRows(rows, p.sorts); }
        var size = p.pageSize || 50;
        var start = p.startCursor ? parseInt(p.startCursor, 10) : 0;
        if (isNaN(start) || start < 0) { start = 0; }
        var slice = rows.slice(start, start + size);
        var next = start + size;
        var more = next < rows.length;
        return { results: slice, nextCursor: more ? String(next) : null, hasMore: more };
      });
    },
    aggregate: function (p) {
      return P(function () {
        var base = rowsOf(p.databaseId) || [], out = [];
        (p.aggregates || []).forEach(function (a) {
          var rows = a.filter ? applyFilter(base, a.filter) : base;
          if (a.groupBy) {
            var map = {}, order = [];
            rows.forEach(function (r) {
              var k = r[a.groupBy];
              if (k === undefined || k === null || k === '') { k = '未分类'; }
              if (!map[k]) { map[k] = { key: k, count: 0 }; order.push(k); }
              map[k].count += 1;
              if (a.type !== 'count' && a.property) { map[k].acc = (map[k].acc || 0) + (Number(r[a.property]) || 0); }
            });
            var arr = order.map(function (k) {
              var g = map[k];
              if (a.type !== 'count') { g.count = g.acc || 0; }
              delete g.acc;
              return g;
            });
            arr.sort(function (x, y) { return y.count - x.count; });
            out.push({ name: a.name, value: arr });
          } else {
            var v = 0;
            if (a.type === 'count') { v = rows.length; }
            else if (a.type === 'sum' || a.type === 'avg') {
              var s = 0;
              rows.forEach(function (r) { s += Number(r[a.property]) || 0; });
              v = a.type === 'avg' ? (rows.length ? s / rows.length : 0) : s;
            } else if (a.type === 'max' || a.type === 'min') {
              var vals = rows.map(function (r) { return Number(r[a.property]) || 0; });
              v = vals.length ? (a.type === 'max' ? Math.max.apply(null, vals) : Math.min.apply(null, vals)) : 0;
            }
            out.push({ name: a.name, value: v });
          }
        });
        return { results: out };
      });
    },
    getSchema: function (p) {
      return P(function () {
        var key = ID2KEY[p.databaseId];
        return { properties: clone((SNAP.tables[key] || {}).schema ? SNAP.tables[key].schema.properties : []) };
      });
    },
    addRecord: function (p) {
      return P(function () {
        var s = load(), rows = rowsOf(p.databaseId);
        if (!rows) { throw new Error('未知数据表: ' + p.databaseId); }
        s.seq += 1;
        var row = { record_id: 'local-' + s.seq }, props = p.properties || {};
        for (var f in props) {
          if (Object.prototype.hasOwnProperty.call(props, f)) { row[f] = resolveValue(p.databaseId, f, props[f]); }
        }
        rows.unshift(row);
        save();
        return { record_id: row.record_id };
      });
    },
    updateRecord: function (p) {
      return P(function () {
        var rows = rowsOf(p.databaseId);
        if (!rows) { throw new Error('未知数据表: ' + p.databaseId); }
        var hit = null;
        for (var i = 0; i < rows.length; i++) { if (rows[i].record_id === p.recordId) { hit = rows[i]; break; } }
        if (!hit) { throw new Error('记录不存在: ' + p.recordId); }
        var props = p.properties || {};
        for (var f in props) {
          if (Object.prototype.hasOwnProperty.call(props, f)) { hit[f] = resolveValue(p.databaseId, f, props[f]); }
        }
        save();
        return { record_id: hit.record_id };
      });
    },
    onUpdated: function () { /* 静态版无需实时订阅 */ }
  };

  window.__SMART_PAGE__ = { database: database };
  window.__NAPELL_DEMO__ = {
    snapshotAt: SNAP.generatedAt,
    reset: function () {
      try { window.localStorage.removeItem(LS_KEY); } catch (e) { /* noop */ }
      window.location.reload();
    }
  };

  function banner() {
    if (document.getElementById('demoBar')) { return; }
    var total = 0;
    for (var i = 0; i < KEYS.length; i++) { total += (load().rows[KEYS[i]] || []).length; }
    var bar = document.createElement('div');
    bar.id = 'demoBar';
    bar.setAttribute('style', [
      'position:fixed', 'z-index:9999', 'left:16px', 'bottom:16px', 'right:auto',
      'max-width:calc(100vw - 32px)',
      'display:flex', 'align-items:center', 'gap:10px', 'flex-wrap:wrap',
      'padding:9px 12px', 'border-radius:12px',
      'background:rgba(10,10,10,.92)', 'border:1px solid #2a2f36',
      'backdrop-filter:blur(10px)', 'color:#8b98a5',
      'font:500 11.5px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"PingFang SC","Microsoft YaHei",sans-serif'
    ].join(';'));
    bar.innerHTML =
      '<span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#1d9bf0;box-shadow:0 0 8px #1d9bf0"></span>' +
      '<span>静态演示版 · 内嵌 ' + total + ' 行真实快照（' + SNAP.generatedAt + '）· 交互在当前浏览器本地生效</span>' +
      '<button id="demoReset" type="button" style="cursor:pointer;border:1px solid #2a2f36;background:#16181c;color:#e7e9ea;border-radius:8px;padding:4px 9px;font:inherit">重置数据</button>';
    document.body.appendChild(bar);
    document.getElementById('demoReset').addEventListener('click', function () {
      window.__NAPELL_DEMO__.reset();
    });
  }
  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', banner); }
  else { banner(); }
})();
