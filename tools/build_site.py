#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""把单文件滚动长页 `_build/agent-os.html` 拆成一页一板块的多页站点。

产出（默认写到仓库根目录，即本脚本的上一级）：
  index.html fleet.html dispatch.html bus.html board.html economy.html
  cycles.html kpi.html sector.html          九个页面
  assets/css/style.css                      共享样式（抽取自源页面 <style>）
  assets/js/os.js                           共享数据层（抽取自源页面 <script>）
  favicon.svg

用法（在仓库根目录执行）：
  python tools/build_site.py                  → 仓库根（GitHub 版，注入浏览器内数据层）
  python tools/build_site.py --no-gh --out /tmp/site
                                              → 资料库版（走宿主真实 SDK）
  PAGE_SRC=/path/to/agent-os.html python tools/build_site.py

源文件定位：`PAGE_SRC` 环境变量优先；否则从仓库根向上最多 4 层查找 `_build/agent-os.html`。
"""
import argparse, io, json, os, shutil, sys
from urllib.parse import quote

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _find_source():
    env = os.environ.get("PAGE_SRC")
    if env and os.path.isfile(env):
        return env
    base = REPO_ROOT
    for _ in range(4):
        cand = os.path.join(base, "_build", "agent-os.html")
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(base)
        if parent == base:
            break
        base = parent
    return None


SRC = _find_source() or os.path.join("_build", "agent-os.html")

BOARDS = [
    dict(key="index",    file="index.html",    icon="🧭", title="总览",        desc="九智能体运行控制台 · 板块入口",       group="home", num="BOARD 00"),
    dict(key="fleet",    file="fleet.html",    icon="🤖", title="智能体舰队",   desc="九体状态、心跳与信用积分",            group="run",  num="BOARD 01"),
    dict(key="dispatch", file="dispatch.html", icon="🎛️", title="任务派发",     desc="下发工单，工单 / 事件 / 账本三表联动", group="run",  num="BOARD 02"),
    dict(key="bus",      file="bus.html",      icon="📡", title="事件总线",     desc="全链事件流与处理状态分布",            group="data", num="BOARD 03"),
    dict(key="board",    file="board.html",    icon="🗂️", title="工单看板",     desc="调度中工单可人工回执完成",            group="data", num="BOARD 04"),
    dict(key="cycles",   file="cycles.html",   icon="🕒", title="24 小时时钟",  desc="每小时自动推进一个周期",              group="data", num="BOARD 05"),
    dict(key="economy",  file="economy.html",  icon="💠", title="智能体经济体", desc="服务付费、JEBI 计量引擎与结算流水",  group="econ", num="BOARD 06"),
    dict(key="kpi",      file="kpi.html",      icon="📊", title="运行 KPI",     desc="全周期实测产出汇总",                  group="econ", num="BOARD 07"),
]
BY_KEY = {b["key"]: b for b in BOARDS}

GROUPS = [
    dict(key="run",  name="运行", file="fleet.html"),
    dict(key="data", name="数据", file="bus.html"),
    dict(key="econ", name="经济", file="economy.html"),
]
GROUP_NAME = {g["key"]: g["name"] for g in GROUPS}

SECTORS = [
    ("🌱", "气雾栽培智能体",   "板块① 雾化种植基地"),
    ("⚗️", "工艺大师智能体",   "板块② 加工处理"),
    ("📈", "曲线引擎智能体",   "板块③ 烘焙与烘焙曲线交易"),
    ("🏦", "豆仓银行智能体",   "板块④ 咖啡豆储存银行"),
    ("🏬", "零碳商城智能体",   "板块⑤ 零碳购物中心"),
    ("🌍", "碳账本智能体",     "板块⑥ 碳指标交易市场"),
    ("🚚", "连锁领航智能体",   "板块⑦ 咖啡连锁（门店 + 移动车）"),
    ("📜", "REITs 建筑师智能体", "板块⑧ 产业链 REITs 中心"),
    ("🧠", "中枢神经智能体",   "板块⑨ 咖啡 AI Agent（芯片 + 组培）"),
]

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

# ══════════════════════════════════════════════════════════════════
# 抽取源页面的共享部分
# ══════════════════════════════════════════════════════════════════
src = io.open(SRC, encoding="utf-8", newline="").read().replace("\r\n", "\n")


def between(t, a, b):
    i = t.index(a) + len(a)
    return t[i:t.index(b, i)]


def block(t, a, b):
    i = t.index(a)
    return t[i:t.index(b, i) + len(b)]


CSS = between(src, "<style>", "</style>").strip()
HERO = block(src, '<header class="hero">', "</header>")
SCRIPT = between(src, "<script>", "</script>").strip()
SECTIONS = {b["key"]: block(src, '<section class="wrap" id="%s">' % b["key"], "</section>")
            for b in BOARDS if b["key"] != "index"}

assert "<section" in SECTIONS["fleet"] and "</section>" in SECTIONS["kpi"]
assert "kpiAgents" in HERO
assert "function boot()" in SCRIPT

# ══════════════════════════════════════════════════════════════════
# 导航 / 页脚 / 各页正文
# ══════════════════════════════════════════════════════════════════

def nav(active):
    L = ['<nav class="nav">']
    L.append('  <a class="nav-logo" href="index.html" style="text-decoration:none">'
             '<span class="dot"></span>NAPELL '
             '<span style="color:var(--text-mute);font-weight:500">Coffee Chain OS</span></a>')
    L.append('  <div class="nav-menu">')
    L.append('    <a class="nav-link%s" href="index.html">总览</a>' % (" on" if active == "index" else ""))
    for g in GROUPS:
        items = [b for b in BOARDS if b["group"] == g["key"]]
        gon = " on" if active in [b["key"] for b in items] else ""
        L.append('    <div class="nav-item">')
        L.append('      <a class="nav-link%s" href="%s">%s <span class="chev">▼</span></a>'
                 % (gon, g["file"], g["name"]))
        L.append('      <div class="dropdown">')
        for b in items:
            L.append('        <a class="dd-item%s" href="%s"><div class="dd-icon">%s</div>'
                     '<div><div class="dd-title">%s</div><div class="dd-desc">%s</div></div></a>'
                     % (" on" if active == b["key"] else "", b["file"], b["icon"], b["title"], b["desc"]))
        L.append('      </div>')
        L.append('    </div>')
    L.append('    <div class="nav-item">')
    L.append('      <a class="nav-link%s" href="fleet.html">业务板块 <span class="chev">▼</span></a>'
             % (" on" if active == "sector" else ""))
    L.append('      <div class="dropdown" style="min-width:306px">')
    for icon, name, domain in SECTORS:
        L.append('        <a class="dd-item" href="sector.html?agent=%s"><div class="dd-icon">%s</div>'
                 '<div><div class="dd-title">%s</div><div class="dd-desc">%s</div></div></a>'
                 % (quote(name), icon, name, domain))
    L.append('      </div>')
    L.append('    </div>')
    L.append('  </div>')
    L.append('  <div class="nav-cta">')
    L.append('    <a class="btn" href="bus.html">事件总线</a>')
    L.append('    <a class="btn btn-primary" href="dispatch.html">派发任务</a>')
    L.append('  </div>')
    L.append('</nav>')
    return "\n".join(L)


FOOTER = """<footer class="footer">
  <div class="wrap">
    <div class="fl">
      <a href="index.html">总览</a>
      <a href="fleet.html">智能体舰队</a>
      <a href="dispatch.html">任务派发</a>
      <a href="bus.html">事件总线</a>
      <a href="board.html">工单看板</a>
      <a href="economy.html">经济体</a>
      <a href="cycles.html">24 小时周期</a>
      <a href="kpi.html">运行 KPI</a>
    </div>
    <div class="cp">
      Napell Coffee Chain OS · 咖啡全产业链智能体生态系统（可交互运行版）<br>
      数据存储于资料库在线数据表 · 每小时自动推进一个时钟周期 · 数据与 dashboard 展示口径一致
    </div>
  </div>
</footer>"""


def crumb(active):
    b = BY_KEY[active]
    g = [x for x in GROUPS if x["key"] == b["group"]][0]
    return ('<div class="crumb"><a href="index.html">总览</a><span>·</span>'
            '<a href="%s">%s</a><span>·</span>'
            '<span style="color:var(--text-dim)">%s</span></div>' % (g["file"], g["name"], b["title"]))


def board_main(active):
    sec = SECTIONS[active]
    sec = sec.replace('<section class="wrap" id="%s">' % active,
                      '<section class="wrap first" id="%s">\n  %s' % (active, crumb(active)), 1)
    if active == "dispatch":
        sec = sec.replace("</form>", '</form>\n      <div id="receipt" hidden></div>', 1)
    return sec


SECTOR_MAIN = """<section class="wrap first" id="sector">
  <div class="crumb"><a href="index.html">总览</a><span>·</span><a href="fleet.html">智能体舰队</a><span>·</span><span style="color:var(--text-dim)">板块运行视图</span></div>
  <div class="eyebrow">业务板块 · Sector View</div>
  <h2>每个板块，自己的一页</h2>
  <p class="lead">产业链九个板块各有一个智能体。这一页把该板块的档案、能力、工单、事件与结算流水单独收拢，全部按该板块过滤。</p>
  <div id="sectorBody"><div class="loading">板块档案加载中…</div></div>
  <div id="secProfile"></div>
  <div id="secActions" style="display:flex;gap:9px;flex-wrap:wrap;margin-top:15px"></div>
  <div class="stats" id="secStats" style="margin-top:24px"></div>
  <div id="secCaps" style="margin-top:32px"></div>

  <h3 style="margin-top:36px">本板块工单</h3>
  <div class="tw">
    <table>
      <thead><tr><th>任务标题</th><th>调用能力</th><th>优先级</th><th>状态</th><th>创建时间</th><th>工单号</th></tr></thead>
      <tbody id="secTasks"><tr><td colspan="6"><div class="loading">工单加载中…</div></td></tr></tbody>
    </table>
  </div>

  <h3 style="margin-top:36px">本板块事件流</h3>
  <div class="tw">
    <table>
      <thead><tr><th>事件主题</th><th>方向</th><th>载荷摘要</th><th>状态</th><th>发生时间</th></tr></thead>
      <tbody id="secEvents"><tr><td colspan="5"><div class="loading">事件加载中…</div></td></tr></tbody>
    </table>
  </div>

  <h3 style="margin-top:36px">本板块结算流水</h3>
  <div class="tw">
    <table>
      <thead><tr><th>付款方 → 收款方</th><th>服务名称</th><th>方向</th><th class="num">金额</th><th class="num">计量成本</th><th>计价角色</th><th class="num">计费JBP</th><th>结算时间</th></tr></thead>
      <tbody id="secLedger"><tr><td colspan="8"><div class="loading">流水加载中…</div></td></tr></tbody>
    </table>
  </div>
</section>"""


def index_main():
    cards = "\n".join(
        '      <a class="board-card" href="%s"><div class="bi">%s</div><div><div class="bn">%s</div>'
        '<div class="bt">%s</div><div class="bd">%s</div></div></a>'
        % (b["file"], b["icon"], b["num"], b["title"], b["desc"]) for b in BOARDS)
    sects = "\n".join(
        '      <a class="board-card" href="sector.html?agent=%s"><div class="bi">%s</div><div>'
        '<div class="bn">SECTOR %02d</div><div class="bt">%s</div><div class="bd">%s</div></div></a>'
        % (quote(n), i, idx + 1, n, d) for idx, (i, n, d) in enumerate(SECTORS))
    return HERO + """

<section class="wrap" id="boards">
  <div class="eyebrow">板块导航 · Boards</div>
  <h2>八个板块，各占一页</h2>
  <p class="lead">原来的滚动长页已经拆开：每个板块有自己的地址、自己的数据读取范围。导航栏悬停即可跨板块跳转，浏览器前进后退也能正常工作。</p>
  <div class="board-grid">
%s
  </div>

  <h3 style="margin-top:42px">九个业务板块 · 一个智能体一页</h3>
  <p class="lead">产业链上的九个板块各有一个智能体。点开任意板块，进入它自己的运行视图（档案 / 能力 / 工单 / 事件 / 结算）。</p>
  <div class="board-grid">
%s
  </div>
</section>

<section class="wrap" id="tables">
  <div class="eyebrow">数据底座 · Data Tables</div>
  <h2>五张表，一处台账</h2>
  <p class="lead">页面上每一个数字都来自这 5 张资料库数据表 —— 没有本地 mock，也没有前端自算的假数。</p>
  <div class="card" style="margin-top:26px">
    <h3>📊 数据表台账</h3>
    <p style="font-size:12.5px;color:var(--text-dim);margin-bottom:12px">本系统共绑定 5 张资料库数据表，各板块页面按需读取。</p>
    <div class="tw">
      <table>
        <thead><tr><th>数据表</th><th>用途</th><th class="num">记录数</th><th>状态</th></tr></thead>
        <tbody id="tblBody"><tr><td colspan="4"><div class="loading">台账加载中…</div></td></tr></tbody>
      </table>
    </div>
  </div>
</section>""" % (cards, sects)


SHELL = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>%(title)s</title>
<meta name="description" content="%(desc)s">
<meta name="theme-color" content="#000000">
<meta property="og:title" content="Napell Coffee Chain OS · %(board)s">
<meta property="og:description" content="9 智能体 · 事件总线 · 任务调度 · 经济体结算 · 24 小时周期">
<meta property="og:type" content="website">
<link rel="icon" type="image/svg+xml" href="favicon.svg">
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body data-page="%(page)s">

%(nav)s

%(main)s

%(footer)s

<!--EXTRA_SCRIPTS-->
<script src="assets/js/os.js" defer></script>
</body>
</html>
"""

# ══════════════════════════════════════════════════════════════════
# GitHub 版：浏览器内数据层（同形实现 __SMART_PAGE__.database）
# ══════════════════════════════════════════════════════════════════
SHIM_JS = r"""/* ============================================================
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
"""

GH_SCRIPTS = ('<script src="assets/js/snapshot.js" defer></script>\n'
              '<script src="assets/js/shim.js" defer></script>')


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    io.open(path, "w", encoding="utf-8", newline="\n").write(text)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=REPO_ROOT, help="输出目录（默认仓库根目录）")
    ap.add_argument("--gh", dest="gh", action="store_true", default=True,
                    help="注入浏览器内数据层（静态托管版，默认开启）")
    ap.add_argument("--no-gh", dest="gh", action="store_false",
                    help="不注入数据层：产出走宿主真实 SDK 的资料库版")
    ap.add_argument("--snapshot", default=os.path.join(REPO_ROOT, "snapshot.json"))
    args = ap.parse_args()
    out = args.out

    # snapshot.json 既是产物也是输入（仓库根目录构建时会被清理），必须先读进内存
    snap = None
    snap_json = None
    if args.gh:
        snap = json.load(io.open(args.snapshot, encoding="utf-8"))
        snap_json = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))

    if os.path.isdir(out):
        if os.path.isdir(os.path.join(out, ".git")):
            # 仓库工作副本：只清理本轮产物，保留 .git / tools/ / README.md
            stale = [b["file"] for b in BOARDS] + ["sector.html"]
            for name in stale:
                p = os.path.join(out, name)
                if os.path.isfile(p):
                    os.remove(p)
            for name in ("assets", ".nojekyll", "snapshot.json"):
                p = os.path.join(out, name)
                if os.path.isdir(p):
                    shutil.rmtree(p)
                elif os.path.isfile(p):
                    os.remove(p)
        else:
            shutil.rmtree(out)

    write(os.path.join(out, "assets", "css", "style.css"), CSS + "\n")
    write(os.path.join(out, "assets", "js", "os.js"), SCRIPT + "\n")
    write(os.path.join(out, "favicon.svg"), FAVICON)

    extra = ""
    if args.gh:
        write(os.path.join(out, "assets", "js", "snapshot.js"),
              "window.__NAPELL_SNAPSHOT__ = " + snap_json + ";\n")
        write(os.path.join(out, "assets", "js", "shim.js"), SHIM_JS)
        write(os.path.join(out, ".nojekyll"), "")
        write(os.path.join(out, "snapshot.json"),
              json.dumps(snap, ensure_ascii=False, separators=(",", ":")))
        extra = GH_SCRIPTS

    made = []
    for b in BOARDS:
        key = b["key"]
        main_html = index_main() if key == "index" else board_main(key)
        page = SHELL % dict(
            title=("Napell Coffee Chain OS · 智能体运行控制系统" if key == "index"
                   else "%s · Napell Coffee Chain OS" % b["title"]),
            desc=("Napell 咖啡全产业链 9 大智能体运行控制系统：%s。" % b["desc"]),
            board=b["title"],
            page=key,
            nav=nav(key),
            main=main_html,
            footer=FOOTER,
        )
        page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
        write(os.path.join(out, b["file"]), page)
        made.append(b["file"])

    page = SHELL % dict(
        title="板块运行视图 · Napell Coffee Chain OS",
        desc="Napell 咖啡全产业链九个业务板块，每个板块一页：档案、能力、工单、事件与结算流水。",
        board="板块运行视图",
        page="sector",
        nav=nav("sector"),
        main=SECTOR_MAIN,
        footer=FOOTER,
    )
    page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
    write(os.path.join(out, "sector.html"), page)
    made.append("sector.html")

    print("out:", out, " gh =", args.gh)
    for f in made:
        print("   %-14s %6d bytes" % (f, os.path.getsize(os.path.join(out, f))))
    print("   %-14s %6d bytes" % ("style.css", os.path.getsize(os.path.join(out, "assets/css/style.css"))))
    print("   %-14s %6d bytes" % ("os.js", os.path.getsize(os.path.join(out, "assets/js/os.js"))))
    if args.gh:
        print("   %-14s %6d bytes" % ("snapshot.js", os.path.getsize(os.path.join(out, "assets/js/snapshot.js"))))


if __name__ == "__main__":
    main()
