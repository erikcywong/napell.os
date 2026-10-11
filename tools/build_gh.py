#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Rebuild index.html: splice an embedded-snapshot data layer into the single-file page.

Inputs (auto-detected, override with env vars):
  PAGE_SRC  the source single-file page (default: ./_build/agent-os.html next to the repo)
  SNAP      the data snapshot            (default: ./snapshot.json at the repo root)
Output:
  index.html at the repo root, plus favicon.svg

The injected layer implements the __SMART_PAGE__.database contract in the browser so the page
stays fully interactive on a static host; when the real WorkBuddy SDK is present it steps aside.
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

def _find_page():
    """向上最多 4 层找 _build/agent-os.html（仓库嵌在工作区里时也能定位）。"""
    base = ROOT
    for _ in range(4):
        cand = os.path.join(base, "_build", "agent-os.html")
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(base)
        if parent == base:
            break
        base = parent
    return None


CANDIDATES = [os.environ.get("PAGE_SRC") or "", _find_page() or ""]
SRC = next((c for c in CANDIDATES if c and os.path.isfile(c)), None)
if not SRC:
    sys.exit("找不到源页面，请用 PAGE_SRC 指定单文件页面路径")

SNAP = os.environ.get("SNAP") or os.path.join(ROOT, "snapshot.json")
OUT = os.path.join(ROOT, "index.html")

html = open(SRC, encoding="utf-8").read()
snap = json.load(open(SNAP, encoding="utf-8"))

snap_json = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))
# 防止快照文本里出现 </script 之类的序列提前闭合脚本标签
snap_json = snap_json.replace("<", "\\u003c").replace(">", "\\u003e").replace("&", "\\u0026")

SHIM = r"""<script>
/* ============================================================
   Napell Coffee Chain OS · 静态站点内嵌数据层
   在浏览器内实现 __SMART_PAGE__.database 契约（与 WorkBuddy 资料库同形），
   使本页在静态托管上依然可读可写；写入结果留在 localStorage。
   若运行在 WorkBuddy 资料库中，真实 SDK 存在，本层自动让位。
   ============================================================ */
(function () {
  if (window.__SMART_PAGE__ && window.__SMART_PAGE__.database) { return; }

  var SNAP = __SNAPSHOT__;
  var LS_KEY = 'napell_os_demo_v1';

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  var ID2KEY = {};
  var KEYS = [];
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
    var s = load();
    var key = ID2KEY[dbid];
    return key && s.rows[key] ? s.rows[key] : null;
  }

  function optionsOf(dbid, field) {
    var key = ID2KEY[dbid];
    var props = (SNAP.tables[key] || {}).schema ? SNAP.tables[key].schema.properties : [];
    for (var i = 0; i < props.length; i++) {
      if (props[i].name === field) {
        return (props[i].config && props[i].config.options) || [];
      }
    }
    return [];
  }

  function resolveValue(dbid, field, tv) {
    if (tv === null || tv === undefined) { return null; }
    if (typeof tv !== 'object') { return tv; }
    var keys = Object.keys(tv);
    if (!keys.length) { return null; }
    var kind = keys[0];
    var v = tv[kind];
    if (kind === 'select' || kind === 'multi_select') {
      var opts = optionsOf(dbid, field);
      for (var i = 0; i < opts.length; i++) { if (opts[i].id === v) { return opts[i].text; } }
      return v;  /* 也可能直接给的是选项文本 */
    }
    return v;
  }

  function applyFilter(rows, f) {
    if (!f || !f.property || !f.property.property) { return rows; }
    var prop = f.property.property;
    var want;
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
      setTimeout(function () {
        try { res(fn()); } catch (e) { rej(e); }
      }, 0);
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
        var base = rowsOf(p.databaseId) || [];
        var out = [];
        (p.aggregates || []).forEach(function (a) {
          var rows = a.filter ? applyFilter(base, a.filter) : base;
          if (a.groupBy) {
            var map = {}, order = [];
            rows.forEach(function (r) {
              var k = r[a.groupBy];
              if (k === undefined || k === null || k === '') { k = '未分类'; }
              if (!map[k]) { map[k] = { key: k, count: 0 }; order.push(k); }
              map[k].count += 1;
              if (a.type !== 'count' && a.property) {
                map[k].acc = (map[k].acc || 0) + (Number(r[a.property]) || 0);
              }
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
        var s = load();
        var rows = rowsOf(p.databaseId);
        if (!rows) { throw new Error('未知数据表: ' + p.databaseId); }
        s.seq += 1;
        var row = { record_id: 'local-' + s.seq };
        var props = p.properties || {};
        for (var f in props) {
          if (Object.prototype.hasOwnProperty.call(props, f)) {
            row[f] = resolveValue(p.databaseId, f, props[f]);
          }
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
        for (var i = 0; i < rows.length; i++) {
          if (rows[i].record_id === p.recordId) { hit = rows[i]; break; }
        }
        if (!hit) { throw new Error('记录不存在: ' + p.recordId); }
        var props = p.properties || {};
        for (var f in props) {
          if (Object.prototype.hasOwnProperty.call(props, f)) {
            hit[f] = resolveValue(p.databaseId, f, props[f]);
          }
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

  /* ---------- 演示态提示条 ---------- */
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
      '<span>静态演示版 · 内嵌 ' + total + ' 行真实快照数据（' + SNAP.generatedAt + '）· 交互在当前浏览器本地生效</span>' +
      '<button id="demoReset" type="button" style="cursor:pointer;border:1px solid #2a2f36;background:#16181c;color:#e7e9ea;border-radius:8px;padding:4px 9px;font:inherit">重置数据</button>';
    document.body.appendChild(bar);
    document.getElementById('demoReset').addEventListener('click', function () {
      window.__NAPELL_DEMO__.reset();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', banner);
  } else {
    banner();
  }
})();
</script>
""".replace("__SNAPSHOT__", snap_json)

marker = "<script>"
idx = html.find(marker)
assert idx != -1, "未找到主脚本标签"
html_out = html[:idx] + SHIM + html[idx:]

FAVICON = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
<rect width="64" height="64" rx="14" fill="#000000"/>
<circle cx="32" cy="32" r="13" fill="none" stroke="#1d9bf0" stroke-width="4"/>
<circle cx="32" cy="32" r="5" fill="#00ba7c"/>
<circle cx="32" cy="12" r="3.4" fill="#1d9bf0"/>
<circle cx="32" cy="52" r="3.4" fill="#1d9bf0"/>
<circle cx="12" cy="32" r="3.4" fill="#1d9bf0"/>
<circle cx="52" cy="32" r="3.4" fill="#1d9bf0"/>
</svg>
"""

html_out = html_out.replace(
    "<title>Napell Coffee Chain OS · 智能体运行控制系统</title>",
    "<title>Napell Coffee Chain OS · 智能体运行控制系统</title>\n"
    '<link rel="icon" type="image/svg+xml" href="favicon.svg">\n'
    '<meta name="description" content="Napell 咖啡全产业链 9 大智能体运行控制系统：事件总线、任务工单、经济结算与 24 小时时钟周期。">\n'
    '<meta name="theme-color" content="#000000">\n'
    '<meta property="og:title" content="Napell Coffee Chain OS">\n'
    '<meta property="og:description" content="9 智能体 · 事件总线 · 任务调度 · 经济体结算 · 24 小时周期">\n'
    '<meta property="og:type" content="website">'
)

with open(OUT, "w", encoding="utf-8") as f:
    f.write(html_out)
with open(os.path.join(ROOT, "favicon.svg"), "w", encoding="utf-8") as f:
    f.write(FAVICON)

print("src:", SRC)
print("snapshot:", SNAP, "at", snap.get("generatedAt"))
print("built:", OUT, os.path.getsize(OUT), "bytes")
print("rows:", {k: len(v["rows"]) for k, v in snap["tables"].items()})
