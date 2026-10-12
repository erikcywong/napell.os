/* ==========================================================================
   Napell Coffee Chain OS · 板块页的常驻状态轨 + 页首仪表条
   只读聚合：5 张表各一次 aggregate，供左轨 / 仪表条 / 分区块引用。
   与 os.js 并存且互不干涉 —— 本文件只写 ck* 元素，页面业务渲染仍由 os.js 负责。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 数据接入 ----------------
     每张表一条 SDK 入口，且**每条 db.query / db.aggregate 调用体内都带字面量 databaseId**
     （静态校验要求，见 data-page-flow.md §1.5.5）。表名 → id 的映射只在这里出现一次。 */
  function rowsOf(r) { return (r && r.results) ? r.results : []; }
  var T = {
    agents: {
      query: function (o) { return db.query(Object.assign({ databaseId: 'cFRjJqhyp5LDaCZHPp3XVm' }, o || {})).then(rowsOf); },
      agg: function (a) { return db.aggregate({ databaseId: 'cFRjJqhyp5LDaCZHPp3XVm', aggregates: a }); }
    },
    events: {
      query: function (o) { return db.query(Object.assign({ databaseId: 'ND8kO27PEOFohwZHxm6WgV' }, o || {})).then(rowsOf); },
      agg: function (a) { return db.aggregate({ databaseId: 'ND8kO27PEOFohwZHxm6WgV', aggregates: a }); }
    },
    tasks: {
      query: function (o) { return db.query(Object.assign({ databaseId: 'xQspxv5gupTBY8LeSHVv5L' }, o || {})).then(rowsOf); },
      agg: function (a) { return db.aggregate({ databaseId: 'xQspxv5gupTBY8LeSHVv5L', aggregates: a }); }
    },
    ledger: {
      query: function (o) { return db.query(Object.assign({ databaseId: 'dmRghisDSmokozzg8GMuwv' }, o || {})).then(rowsOf); },
      agg: function (a) { return db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: a }); }
    },
    cycles: {
      query: function (o) { return db.query(Object.assign({ databaseId: 'HZm1EBKdHUmqRMNIasCJfm' }, o || {})).then(rowsOf); },
      agg: function (a) { return db.aggregate({ databaseId: 'HZm1EBKdHUmqRMNIasCJfm', aggregates: a }); }
    }
  };

  /* 面板头部「来源表」→ 板块页 */
  var TBL = {
    agents: ['智能体注册表', 'fleet.html', '舰队页'],
    tasks:  ['任务工单',     'board.html', '工单看板'],
    events: ['事件总线',     'bus.html',   '事件总线'],
    ledger: ['智能体账本',   'economy.html', '经济体'],
    cycles: ['运行周期',     'cycles.html', '时钟页']
  };

  var M = { groups: {} };

  function $(id) { return document.getElementById(id); }
  function all(sel) { return [].slice.call(document.querySelectorAll(sel)); }
  var db = null;
  function SDK() { return window.__SMART_PAGE__ && window.__SMART_PAGE__.database; }
  function num(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }
  function fmt(v, kind) {
    if (kind === 'raw') { return v === null || v === undefined ? '—' : String(v); }
    if (kind === 'ago') { return agoOf(v); }
    var n = num(v);
    if (n === null || isNaN(n)) { return '—'; }
    if (kind === 'money') {
      return (n < 0 ? '-¥' : '¥') + Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))(?=\.)/g, ',');
    }
    if (kind === 'fixed1') { return n.toFixed(1); }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function agoOf(v) {
    if (!v) { return '—'; }
    var d = new Date(v);
    if (isNaN(d.getTime())) { return String(v); }
    var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) { return s + ' 秒前'; }
    if (s < 3600) { return Math.round(s / 60) + ' 分钟前'; }
    if (s < 86400) { return Math.round(s / 3600) + ' 小时前'; }
    return Math.round(s / 86400) + ' 天前';
  }
  function stampOf(v) {
    if (!v) { return '—'; }
    var d = new Date(v);
    if (isNaN(d.getTime())) { return String(v); }
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function byName(rsp) {
    var out = {};
    ((rsp && rsp.results) || []).forEach(function (it) { out[it.name] = it.value; });
    return out;
  }
  function groupCount(list, key) {
    var hit = 0;
    (list || []).forEach(function (g) { if (String(g.key) === key) { hit += g.count; } });
    return hit;
  }
  function groupPrefix(list, pre) {
    var hit = 0;
    (list || []).forEach(function (g) { if (String(g.key).indexOf(pre) === 0) { hit += g.count; } });
    return hit;
  }
  function escapeHtml(v) {
    if (v === null || v === undefined) { return ''; }
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function setHTML(el, html) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    var r = document.createRange();
    r.selectNodeContents(el);
    el.appendChild(r.createContextualFragment(html));
  }

  /* ---------------- 数据访问 ----------------
     具体 SDK 调用集中在文件顶部的 T 门面上（每条调用带字面量 databaseId）。 */

  /* ---------------- 指标字典 ---------------- */
  function metric(key) {
    if (!key) { return null; }
    if (key.indexOf('a:') === 0) { return M.agent ? M.agent[key.slice(2)] : null; }
    if (key.indexOf('ts:') === 0) { return groupCount(M.groups.tasksState, key.slice(3)); }
    if (key.indexOf('es:') === 0) { return groupCount(M.groups.eventsState, key.slice(3)); }
    return M[key];
  }

  /* ---------------- 页首仪表条 / 左轨数字 / 面板来源 ---------------- */
  function paint() {
    M.rows = (M.agents || 0) + (M.events || 0) + (M.tasks || 0) + (M.ledger || 0) + (M.cycles || 0);
    all('#ckStrip [data-m]').forEach(function (el) {
      el.textContent = fmt(metric(el.getAttribute('data-m')), el.getAttribute('data-fmt') || 'int');
    });
    all('[data-ck-count]').forEach(function (el) {
      el.textContent = fmt(metric(el.getAttribute('data-ck-count')));
    });
    all('.ck-ph .src[data-tbl]').forEach(function (el) {
      var t = el.getAttribute('data-tbl');
      if (t === 'all') { el.textContent = '5 张表合计 ' + fmt(M.rows) + ' 行'; return; }
      var n = metric(t);
      el.textContent = (TBL[t] ? TBL[t][0] : t) + (n === null || n === undefined ? '' : ' · ' + fmt(n) + ' 条');
    });
    renderRail();
    renderLinks();
  }

  function renderRail() {
    var rows = [
      ['智能体', fmt(M.agents), M.online ? ('在线 ' + M.online + ' 体') : ''],
      ['事件', fmt(M.events), ''],
      ['工单', fmt(M.tasks), ''],
      ['周期', fmt(M.cycles), ''],
      ['账本', fmt(M.ledger), ''],
      ['计费', fmt(M.ledger_jbp) + ' JBP', '']
    ];
    setHTML($('ckRailKpi'), rows.map(function (x) {
      return '<div class="r"><span class="rk">' + escapeHtml(x[0]) + '</span>' +
        '<span class="rv">' + escapeHtml(x[1]) + '</span></div>' +
        (x[2] ? '<div class="r" style="padding:0 8px 4px"><span class="rv dim" style="margin-left:auto">'
          + escapeHtml(x[2]) + '</span></div>' : '');
    }).join(''));
    var st = $('ckStamp');
    if (st && M.latest) {
      st.innerHTML = '数据时间 <b style="color:var(--text-dim)">' + escapeHtml(stampOf(M.latest)) + '</b><br>' +
        escapeHtml(agoOf(M.latest)) + ' · 自动任务每小时推进一个周期';
    }
  }

  /* 派发页：本次写入的三张目标表 */
  function renderLinks() {
    var host = $('ckLinks');
    if (!host) { return; }
    var spec = [
      ['📋', 'tasks', '任务工单 · 任务标题 / 能力 / 优先级', 'board.html'],
      ['📡', 'events', '事件总线 · 派发事件与回执', 'bus.html'],
      ['💠', 'ledger', '智能体账本 · JEBI 计量与计费流水', 'economy.html']
    ];
    setHTML(host, spec.map(function (s) {
      var t = s[1], n = metric(t), info = TBL[t];
      return '<a href="' + s[3] + '"><span class="ico">' + s[0] + '</span>' +
        '<span><span class="nm">' + escapeHtml(info[0]) + '</span>' +
        '<span class="ds" style="display:block">' + escapeHtml(s[2]) + '</span></span>' +
        '<span class="cv">' + (n === null || n === undefined ? '—' : fmt(n)) + '</span>' +
        '<span class="ar">→</span></a>';
    }).join(''));
  }

  /* 舰队页：板块归属矩阵（9 格） */
  function renderMatrix() {
    var host = $('ckMatrix');
    if (!host || !M.agents_rows) { return; }
    var tkMap = {}, evMap = {};
    (M.groups.tasksAgent || []).forEach(function (g) { tkMap[g.key] = g.count; });
    (M.groups.eventsSrc || []).forEach(function (g) { evMap[g.key] = g.count; });
    setHTML(host, M.agents_rows.map(function (a) {
      var name = a['智能体名称'] || '';
      return '<a class="ck-cell" href="sector.html?agent=' + encodeURIComponent(name) + '">' +
        '<div class="t"><i>' + escapeHtml(a['图标'] || '🤖') + '</i>' + escapeHtml(name) + '</div>' +
        '<div class="k">' + escapeHtml(a['智能体编号'] || '') + ' · ' + escapeHtml(a['所属板块'] || '') + '</div>' +
        '<div class="rows">' +
        '<div><div class="mk">工单</div><div class="mv">' + fmt(tkMap[name] || 0) + '</div></div>' +
        '<div><div class="mk">事件</div><div class="mv">' + fmt(evMap[name] || 0) + '</div></div>' +
        '<div><div class="mk">信用分</div><div class="mv">' + fmt(a['信用积分']) + '</div></div>' +
        '</div></a>';
    }).join(''));
  }

  /* 板块页：本板块智能体那一行（仪表条与 [data-a] 元素都从它取数） */
  function renderAgent() {
    if (!M.agent) { return; }
    paint();
    all('[data-a]').forEach(function (el) {
      var f = el.getAttribute('data-fmt') || 'int';
      var v = M.agent[el.getAttribute('data-a')];
      el.textContent = (f === 'ago') ? agoOf(v) : fmt(v, f);
    });
  }

  /* ---------------- 左轨滚动联动 ---------------- */
  function spy() {
    var panels = all('.ck-panel');
    if (!panels.length) { return; }
    var links = all('.ck-nav');
    function update() {
      var line = window.scrollY + 140, active = panels[0].id;
      panels.forEach(function (p) { if (p.offsetTop <= line) { active = p.id; } });
      links.forEach(function (a) {
        if (a.getAttribute('data-ck-nav') === active) { a.classList.add('on'); }
        else { a.classList.remove('on'); }
      });
    }
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    update();
  }

  /* ---------------- 启动 ---------------- */
  function run() {
    spy();

    /* 1) 智能体注册表 */
    T.agents.agg([
      { name: 'total', type: 'count' },
      { name: 'by_status', type: 'count', groupBy: '运行状态' },
      { name: 'by_block', type: 'count', groupBy: '所属板块' }
    ]).then(function (r) {
      var m = byName(r);
      M.agents = m.total;
      M.groups.agentsStatus = m.by_status || [];
      M.online = groupPrefix(M.groups.agentsStatus, '在线');
      M.blocks = (m.by_block || []).length;
      paint();
    }).catch(function () { });

    /* 2) 任务工单 */
    T.tasks.agg([
      { name: 'total', type: 'count' },
      { name: 'by_state', type: 'count', groupBy: '任务状态' },
      { name: 'by_agent', type: 'count', groupBy: '执行智能体' }
    ]).then(function (r) {
      var m = byName(r);
      M.tasks = m.total;
      M.groups.tasksState = m.by_state || [];
      M.groups.tasksAgent = m.by_agent || [];
      M.tasks_done = groupCount(M.groups.tasksState, '已完成');
      M.tasks_open = Math.max(0, (M.tasks || 0) - M.tasks_done);
      paint(); renderMatrix();
    }).catch(function () { });

    /* 3) 事件总线 */
    T.events.agg([
      { name: 'total', type: 'count' },
      { name: 'sum_ms', type: 'sum', property: '耗时毫秒' },
      { name: 'by_state', type: 'count', groupBy: '处理状态' },
      { name: 'by_src', type: 'count', groupBy: '来源智能体' }
    ]).then(function (r) {
      var m = byName(r);
      M.events = m.total;
      M.events_ms = m.sum_ms;
      M.groups.eventsState = m.by_state || [];
      M.groups.eventsSrc = m.by_src || [];
      M.events_avg = (M.events ? Math.round((num(m.sum_ms) || 0) / M.events) : 0);
      M.events_done = groupCount(M.groups.eventsState, '已消费');
      paint(); renderMatrix();
    }).catch(function () { });

    /* 4) 智能体账本 */
    T.ledger.agg([
      { name: 'total', type: 'count' },
      { name: 'sum_amount', type: 'sum', property: '金额' },
      { name: 'sum_cost', type: 'sum', property: '计量成本' },
      { name: 'sum_jbp', type: 'sum', property: '计费JBP' },
      { name: 'by_role', type: 'count', groupBy: '计价角色' }
    ]).then(function (r) {
      var m = byName(r);
      M.ledger = m.total;
      M.ledger_amt = m.sum_amount;
      M.ledger_cost = m.sum_cost;
      M.ledger_jbp = m.sum_jbp;
      M.groups.roles = m.by_role || [];
      M.roles = M.groups.roles.length;
      paint();
    }).catch(function () { });

    /* 5) 运行周期 */
    T.cycles.agg([
      { name: 'total', type: 'count' },
      { name: 'sum_tasks', type: 'sum', property: '完成任务数' },
      { name: 'sum_events', type: 'sum', property: '触发事件数' },
      { name: 'sum_output', type: 'sum', property: '生豆产出kg' },
      { name: 'sum_carbon', type: 'sum', property: '碳减排kg' },
      { name: 'sum_receipt', type: 'sum', property: '仓单数' },
      { name: 'sum_finance', type: 'sum', property: '融资额' }
    ]).then(function (r) {
      var m = byName(r);
      M.cycles = m.total;
      M.cy_tasks = m.sum_tasks;
      M.cy_events = m.sum_events;
      M.cy_output = m.sum_output;
      M.cy_carbon = m.sum_carbon;
      M.cy_receipt = m.sum_receipt;
      M.cy_finance = m.sum_finance;
      paint();
    }).catch(function () { });

    /* 6) 舰队页：板块矩阵需要注册表明细 */
    if ($('ckMatrix')) {
      T.agents.query({ pageSize: 200, sorts: [{ property: '服务调用', direction: 'descending' }] })
        .then(function (rows) { M.agents_rows = rows; renderMatrix(); }).catch(function () { });
    }

    /* 7) 板块页：本板块智能体那一行 */
    var name = (function () {
      var m = /[?&]agent=([^&]*)/.exec(window.location.search);
      try { return m ? decodeURIComponent(m[1]) : ''; } catch (e) { return ''; }
    })();
    if (name) {
      T.agents.query({
        pageSize: 5,
        filter: { property: { property: '智能体名称', text: { equals: name } } }
      }).then(function (rows) {
        M.agent = rows[0] || null;
        renderAgent();
      }).catch(function () { });
    }

    /* 8) 首页/其它：最新时间戳 */
    T.events.query({ pageSize: 1, sorts: [{ property: '发生时间', direction: 'descending' }] })
      .then(function (rows) { if (rows[0]) { M.latest = rows[0]['发生时间']; renderRail(); } })
      .catch(function () { });
  }

  function boot() {
    var tries = 0;
    (function wait() {
      if (SDK()) { db = SDK(); run(); return; }
      if (++tries > 60) { return; }
      setTimeout(wait, 200);
    })();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); }
  else { boot(); }
})();
