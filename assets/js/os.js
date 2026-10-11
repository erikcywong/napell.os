(function () {
  'use strict';

  /* 本页绑定 5 张资料库数据表（每条 SDK 调用均带字面量 databaseId，便于静态校验） */
  var DB_AGENTS_ID = 'cFRjJqhyp5LDaCZHPp3XVm';
  var DB_EVENTS_ID = 'ND8kO27PEOFohwZHxm6WgV';
  var DB_TASKS_ID  = 'xQspxv5gupTBY8LeSHVv5L';
  var DB_LEDGER_ID = 'dmRghisDSmokozzg8GMuwv';
  var DB_CYCLES_ID = 'HZm1EBKdHUmqRMNIasCJfm';

  var CAPS = {
    '气雾栽培智能体': ['env_control', 'nutrient_optimize', 'disease_alert', 'carbon_account', 'tissue_culture'],
    '工艺大师智能体': ['process_recommend', 'micro_lot_archive', 'flavor_predict', 'process_carbon'],
    '曲线引擎智能体': ['generate_profile', 'match_profile', 'trade_profile', 'verify_reproduction'],
    '豆仓银行智能体': ['store', 'lease', 'trade', 'pledge', 'value'],
    '零碳商城智能体': ['footprint_display', 'carbon_settle', 'trace_experience', 'traffic_analysis'],
    '碳账本智能体': ['mint', 'match_trade', 'price', 'retire', 'trace'],
    '连锁领航智能体': ['site_select', 'truck_dispatch', 'smart_replenish', 'demand_signal', 'member_ops'],
    'REITs 建筑师智能体': ['bundle_assets', 'forecast_yield', 'match_investors', 'green_reit'],
    '中枢神经智能体': ['chip_register', 'tissue_culture_select', 'global_optimize', 'cross_dispatch', 'forecast', 'agent_economy']
  };

  /* ── JEBI 计量引擎 · 先计量后定价（与 _meter/jebi_meter.py 同口径） ── */
  var JBP_PER_CNY = 10;                                        /* 1 JBP = 0.1 CNY */
  var PRICES_CNY_PER_MTOK = { cache_hit: 0.5, input: 2.0, output: 8.0 };
  var ROLE_PRICING = [
    { role: 'B端加盟商', mult: 5, floor: 50, billable: true, note: 'cost × 5，下限 50 JBP（5 CNY）' },
    { role: 'C端订阅', mult: 0, floor: 0, billable: false, note: '0 JBP —— 成本已含在订阅费内' },
    { role: 'C端即用即付', mult: 3, floor: 10, billable: true, note: 'cost × 3，下限 10 JBP（1 CNY）' },
    { role: '平台内部', mult: 1, floor: 0, billable: true, note: '融合扩展：cost × 1，按成本价内部结算' }
  ];
  var SETTLE_TO_ROLE = {
    '服务调用': 'B端加盟商', '数据订阅': 'C端订阅',
    '资产授权': 'B端加盟商', '碳指标结算': '平台内部', '分红': '平台内部'
  };
  var METER_COST_BAND = {
    'B端加盟商': [0.9, 26], 'C端即用即付': [0.5, 9], 'C端订阅': [0.4, 7], '平台内部': [0.6, 18]
  };

  function roleSpec(role) {
    for (var i = 0; i < ROLE_PRICING.length; i++) {
      if (ROLE_PRICING[i].role === role) { return ROLE_PRICING[i]; }
    }
    return ROLE_PRICING[3];
  }
  function roleForSettlement(t) { return SETTLE_TO_ROLE[t] || '平台内部'; }

  /* 第 1 步 · 计量：按真实用量计出成本（CNY），cache 命中走折扣价 */
  function meteredCostCny(promptTokens, completionTokens, cachedTokens) {
    var p = PRICES_CNY_PER_MTOK;
    var cached = Math.max(0, Math.min(cachedTokens || 0, promptTokens || 0));
    var fresh = Math.max(0, (promptTokens || 0) - cached);
    var cost = cached * p.cache_hit / 1e6 + fresh * p.input / 1e6 + (completionTokens || 0) * p.output / 1e6;
    return Math.round(cost * 1e6) / 1e6;
  }
  /* 第 2 步 · 定价：按角色把成本换算成计费 JBP */
  function jebiQuote(role, promptTokens, completionTokens, cachedTokens) {
    return quoteByCost(role, meteredCostCny(promptTokens, completionTokens, cachedTokens));
  }
  function quoteByCost(role, costCny) {
    var spec = roleSpec(role);
    var jbp = spec.billable ? Math.ceil(Math.max(costCny * spec.mult, spec.floor)) : 0;
    return { role: role, cost_cny: costCny, mult: spec.mult, floor: spec.floor,
             billable: spec.billable, charged_jbp: jbp,
             amount_cny: Math.round(jbp / JBP_PER_CNY * 100) / 100 };
  }
  /* 按标题+能力做确定性抽样，让同一次派发永远得到同一个价 */
  function seedFrom(str) {
    var h = 2166136261, i;
    for (i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
    return h >>> 0;
  }
  function randFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), 1 | t) >>> 0;
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) >>> 0;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function sampleCost(role, seed) {
    var band = METER_COST_BAND[role] || METER_COST_BAND['平台内部'];
    var r = randFrom(seed)();
    return Math.round((band[0] + (band[1] - band[0]) * r) * 1e4) / 1e4;
  }

  var EV_PAGE = 18;
  var LG_PAGE = 20;
  var CY_PAGE = 20;
  var FORM_CACHE_KEY = 'napell_coffee_chain_os_dispatch_form';

  /* ── 多页版：<body data-page="…"> 声明当前板块 ──
     单文件版没有该属性，自动退化为「全量模式」，行为与拆分前完全一致。 */
  var PAGE = (document.body && document.body.getAttribute('data-page')) || '';
  var MULTI = !!PAGE;

  function qs(key) {
    var m = new RegExp('[?&]' + key + '=([^&]*)').exec(window.location.search);
    return m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
  }
  var AGENT_PARAM = qs('agent');

  /* 每个板块只读取自己需要的表与聚合，避免任意页面都拉全 5 张表 */
  var SCOPES = {
    index:    { q: [],                                      a: ['cycles', 'events', 'agents', 'tasks', 'ledger'] },
    fleet:    { q: ['agents'],                              a: ['agents'] },
    dispatch: { q: ['tasks', 'events'],                     a: [] },
    bus:      { q: ['events'],                              a: ['events'] },
    board:    { q: ['tasks'],                               a: ['tasks'] },
    economy:  { q: ['ledger', 'agents'],                    a: ['ledger', 'agents'] },
    cycles:   { q: ['cycles'],                              a: ['cycles'] },
    kpi:      { q: ['agents', 'tasks', 'cycles'],           a: ['cycles', 'events', 'agents', 'tasks', 'ledger'] },
    sector:   { q: ['agents', 'events', 'tasks', 'ledger'], a: [] }
  };
  function scope() {
    return SCOPES[PAGE] || {
      q: ['agents', 'events', 'tasks', 'ledger', 'cycles'],
      a: ['cycles', 'events', 'agents', 'tasks', 'ledger']
    };
  }
  function wants(kind, key) { return scope()[kind].indexOf(key) >= 0; }

  var S = {
    options: { tasks: {}, events: {} },
    agents: [], events: [], tasks: [], ledger: [], cycles: [],
    evQ: '', evStatus: '', evPage: 1, tkStatus: '', lgPage: 1, cyPage: 1,
    evTotal: 0, tkTotal: 0
  };
  var aggCache = {};

  var NOOP = function () {};
  /* 空元素占位：多页版里某个 id 只存在于别的板块。
     统一用一个安全的空对象兜底，各渲染函数无需到处写 null 判断。 */
  var VOID_EL = {
    nodeType: 0, firstChild: null, style: {}, dataset: {}, children: [],
    classList: { add: NOOP, remove: NOOP, toggle: NOOP, contains: function () { return false; } },
    textContent: '', value: '', className: '', disabled: false,
    appendChild: NOOP, removeChild: NOOP, addEventListener: NOOP, removeEventListener: NOOP,
    setAttribute: NOOP, removeAttribute: NOOP, getAttribute: function () { return null; },
    focus: NOOP, scrollIntoView: NOOP, click: NOOP,
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; }
  };
  function $(id) { return document.getElementById(id) || VOID_EL; }

  /* 安全的容器写入：先清空，再用 range 解析插入（不产生未转义的 innerHTML 赋值） */
  function setHTML(el, html) {
    if (!el || !el.nodeType) return;
    while (el.firstChild) { el.removeChild(el.firstChild); }
    var range = document.createRange();
    range.selectNodeContents(el);
    el.appendChild(range.createContextualFragment(html));
  }
  function SDK() { return window.__SMART_PAGE__ && window.__SMART_PAGE__.database; }
  function escapeHtml(v) {
    if (v === null || v === undefined) return '';
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function errMsg(err) { return (err && err.message) ? err.message : '请稍后重试'; }
  function num(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }
  function fmtInt(v) {
    var n = num(v);
    if (n === null || isNaN(n)) return '—';
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtMoney(v) {
    var n = num(v);
    if (n === null || isNaN(n)) return '¥—';
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))(?=\.)/g, ',');
    return (n < 0 ? '-¥' : '¥') + s;
  }
  function fmtTime(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtAgo(v) {
    if (!v) return '—';
    var d = new Date(v);
    if (isNaN(d.getTime())) return '—';
    var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) return s + ' 秒前';
    if (s < 3600) return Math.round(s / 60) + ' 分钟前';
    if (s < 86400) return Math.round(s / 3600) + ' 小时前';
    return Math.round(s / 86400) + ' 天前';
  }
  function nowISO() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
  function stTag(v) {
    var k = String(v || '');
    var c = 'm';
    if (k === '已确认' || k === '已完成' || k === '在线' || k === '运行中') c = 'g';
    else if (k === '已消费' || k === '执行中' || k === '忙碌') c = 'b';
    else if (k === '重试中' || k === '待调度' || k === '中' || k === '高') c = 'a';
    else if (k === '已失败' || k === '异常' || k === '紧急' || k === '降级') c = 'r';
    return '<span class="st ' + escapeHtml(c) + '">' + escapeHtml(k || '—') + '</span>';
  }
  function pill(v) {
    var k = String(v || '');
    var cls = 'pill m';
    if (k.indexOf('在线') === 0) cls = 'pill s-on';
    else if (k === '忙碌') cls = 'pill s-busy';
    else if (k === '降级') cls = 'pill s-deg';
    else if (k === '离线') cls = 'pill s-off';
    return '<span class="' + escapeHtml(cls) + '"><span class="d"></span>' + escapeHtml(k || '—') + '</span>';
  }
  function loading(t) { return '<div class="loading">' + escapeHtml(t || '加载中…') + '</div>'; }
  function empty(t) { return '<div class="empty">' + escapeHtml(t || '暂无数据') + '</div>'; }
  function errBox(host, msg) {
    if (!host) return;
    setHTML(host, '<div class="errbox">数据加载失败：' + escapeHtml(msg || '请稍后重试') + '</div>');
  }
  function cellsEmpty(cols, text) { return '<tr><td colspan="' + escapeHtml(String(cols)) + '">' + empty(text) + '</td></tr>'; }
  function byName(rsp) {
    var out = {};
    ((rsp && rsp.results) || []).forEach(function (it) { out[it.name] = it.value; });
    return out;
  }
  function bars(host, rows, opt) {
    opt = opt || {};
    if (!rows.length) { setHTML(host, empty(opt.emptyText || '暂无数据')); return; }
    var max = 1;
    rows.forEach(function (r) { if (Math.abs(r.value) > max) max = Math.abs(r.value); });
    var html = rows.map(function (r) {
      var w = Math.max(2, Math.round(Math.abs(r.value) / max * 100));
      var cls = 'bar-fill' + (r.value < 0 ? ' neg' : (opt.pos ? ' pos' : ''));
      var txt = (r.text !== undefined) ? r.text : fmtInt(r.value);
      return '<div class="bar-row"><div class="bl" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div>' +
        '<div class="bar-track"><div class="' + escapeHtml(cls) + '" style="width:' + escapeHtml(String(w)) + '%"></div></div>' +
        '<div class="bv">' + escapeHtml(txt) + '</div></div>';
    }).join('');
    setHTML(host, '<div class="bars">' + html + '</div>');
  }
  function chips(host, rows) {
    if (!rows.length) { setHTML(host, empty()); return; }
    setHTML(host, rows.map(function (r) {
      var txt = (r.text !== undefined) ? r.text : fmtInt(r.value);
      return '<span class="dchip">' + escapeHtml(r.label) + ' <b>' + escapeHtml(txt) + '</b></span>';
    }).join(''));
  }
  function fmtCost(v) {
    var n = Number(v || 0);
    return '¥' + (n !== 0 && Math.abs(n) < 1 ? n.toFixed(4) : n.toFixed(2));
  }
  function roleTag(v) {
    var k = String(v || '');
    var c = 'm';
    if (k === 'B端加盟商') c = 'g';
    else if (k === 'C端订阅') c = 'b';
    else if (k === 'C端即用即付') c = 'a';
    else if (k === '平台内部') c = 'r';
    return '<span class="st ' + escapeHtml(c) + '">' + escapeHtml(k || '—') + '</span>';
  }
  function statCard(k, v, u) {
    return '<div class="stat"><div class="k">' + escapeHtml(k) + '</div>' +
      '<div class="v">' + escapeHtml(v) + '</div>' +
      '<div class="u">' + escapeHtml(u) + '</div></div>';
  }
  function renderMeter() {
    var tracks = $('meterTracks');
    if (tracks) {
      setHTML(tracks, ROLE_PRICING.map(function (p) {
        return statCard(p.role, '×' + p.mult, p.note);
      }).join(''));
    }
    var host = $('meterStats');
    if (host) {
      var m = aggCache.meter;
      if (!m) {
        setHTML(host, '<div class="loading">计量汇总中…</div>');
      } else {
        var cost = Number(m.sum_cost || 0);
        var jbp = Number(m.sum_jbp || 0);
        var cnt = Number(m.total || 0);
        var feeCny = jbp / JBP_PER_CNY;
        var goods = Number(m.sum_amount || 0);
        var rate = goods > 0 ? (feeCny / goods * 100) : 0;
        setHTML(host,
          statCard('计量成本合计', '¥' + cost.toFixed(2), cnt + ' 次调用实测') +
          statCard('计费合计', fmtInt(jbp) + ' JBP', '≈ ¥' + feeCny.toFixed(2)) +
          statCard('服务业务额', fmtMoney(goods), '既有口径 · 不受计量影响') +
          statCard('能力调用费占比', rate.toFixed(2) + '%', '平台费 ÷ 服务业务额'));
      }
    }
    var roles = $('meterRoles');
    if (roles) {
      var byRole = groupRows(aggCache.meterRole, '笔');
      if (!byRole.length) { setHTML(roles, ''); } else { chips(roles, byRole); }
    }
    var note = $('meterNote');
    if (note) {
      var ex = jebiQuote('B端加盟商', 3200, 780, 1200);
      setHTML(note,
        '算例（B端）：3,200 prompt（含 1,200 命中缓存）+ 780 completion → 计量成本 ¥' +
        escapeHtml(ex.cost_cny.toFixed(6)) + ' → ×' + escapeHtml(String(ex.mult)) + ' = ' +
        escapeHtml((ex.cost_cny * ex.mult).toFixed(4)) + ' JBP，低于下限 ' + escapeHtml(String(ex.floor)) +
        ' JBP → 实收 <b>' + escapeHtml(fmtInt(ex.charged_jbp)) + ' JBP</b>（¥' +
        escapeHtml(ex.amount_cny.toFixed(2)) + '）。真实单价下下限必然生效 —— 这正是 JEBI 按次收费、' +
        '而非按推理成本收费的原因。');
    }
  }

  function groupRows(groupArr, unit) {
    if (!groupArr || !groupArr.length) return [];
    return groupArr.map(function (g) {
      return { label: g.key, value: g.count, text: fmtInt(g.count) + ' ' + (unit || '条') };
    });
  }
  function fillSelect(el, list, headText) {
    if (!el) return;
    var head = headText ? ('<option value="">' + escapeHtml(headText) + '</option>') : '<option value="">请选择…</option>';
    setHTML(el, head + list.map(function (o) {
      return '<option value="' + escapeHtml(o.id) + '">' + escapeHtml(o.text) + '</option>';
    }).join(''));
  }

  /* ================= 读取：每张表各自分页拉全量（hasMore + nextCursor 续翻） ================= */

  function loadAgents(cb) {
    var db = SDK();
    if (!db) { errBox($('agentErr'), '数据环境未就绪'); return; }
    var acc = [], seen = {};
    function step(cursor, guard) {
      if (guard > 200) { done(acc); return; }
      db.query({ databaseId: 'cFRjJqhyp5LDaCZHPp3XVm', pageSize: 200,
                 sorts: [{ property: '服务调用', direction: 'descending' }],
                 startCursor: cursor }).then(function (res) {
        var rows = (res && res.results) ? res.results : [];
        acc = acc.concat(rows);
        var next = res ? res.nextCursor : null;
        if (res && res.hasMore && next && next !== cursor && rows.length && !seen[next]) {
          seen[next] = 1; step(next, guard + 1);
        } else { done(acc); }
      }).catch(function (err) { errBox($('agentErr'), errMsg(err)); });
    }
    function done(rows) { S.agents = rows; renderAgents(); renderSector();
      if (cb) { cb(); }
      renderKPI2(); }
    step(undefined, 0);
  }

  function loadEvents() {
    var db = SDK();
    if (!db) { errBox($('evErr'), '数据环境未就绪'); return; }
    var acc = [], seen = {};
    function step(cursor, guard) {
      if (guard > 200) { done(acc); return; }
      db.query({ databaseId: 'ND8kO27PEOFohwZHxm6WgV', pageSize: 200,
                 sorts: [{ property: '发生时间', direction: 'descending' }],
                 startCursor: cursor }).then(function (res) {
        var rows = (res && res.results) ? res.results : [];
        acc = acc.concat(rows);
        var next = res ? res.nextCursor : null;
        if (res && res.hasMore && next && next !== cursor && rows.length && !seen[next]) {
          seen[next] = 1; step(next, guard + 1);
        } else { done(acc); }
      }).catch(function (err) { errBox($('evErr'), errMsg(err)); });
    }
    function done(rows) { S.events = rows; S.evTotal = rows.length; renderEvents(); renderSector(); renderKPI2(); }
    step(undefined, 0);
  }

  function loadTasks(flash) {
    var db = SDK();
    if (!db) { errBox($('tkBoardErr'), '数据环境未就绪'); return; }
    var acc = [], seen = {};
    function step(cursor, guard) {
      if (guard > 200) { done(acc); return; }
      db.query({ databaseId: 'xQspxv5gupTBY8LeSHVv5L', pageSize: 200,
                 sorts: [{ property: '创建时间', direction: 'descending' }],
                 startCursor: cursor }).then(function (res) {
        var rows = (res && res.results) ? res.results : [];
        acc = acc.concat(rows);
        var next = res ? res.nextCursor : null;
        if (res && res.hasMore && next && next !== cursor && rows.length && !seen[next]) {
          seen[next] = 1; step(next, guard + 1);
        } else { done(acc); }
      }).catch(function (err) { errBox($('tkBoardErr'), errMsg(err)); });
    }
    function done(rows) {
      S.tasks = rows; S.tkTotal = rows.length; renderTasks(); renderSector(); renderKPI2();
      if (flash) {
        setHTML($('tkBoardErr'), '<div class="msg ok" style="margin-top:10px">工单已更新，事件总线已记录一条回执事件。</div>');
      }
    }
    step(undefined, 0);
  }

  function loadLedger() {
    var db = SDK();
    if (!db) { errBox($('lgErr'), '数据环境未就绪'); return; }
    var acc = [], seen = {};
    function step(cursor, guard) {
      if (guard > 200) { done(acc); return; }
      db.query({ databaseId: 'dmRghisDSmokozzg8GMuwv', pageSize: 200,
                 sorts: [{ property: '结算时间', direction: 'descending' }],
                 startCursor: cursor }).then(function (res) {
        var rows = (res && res.results) ? res.results : [];
        acc = acc.concat(rows);
        var next = res ? res.nextCursor : null;
        if (res && res.hasMore && next && next !== cursor && rows.length && !seen[next]) {
          seen[next] = 1; step(next, guard + 1);
        } else { done(acc); }
      }).catch(function (err) { errBox($('lgErr'), errMsg(err)); });
    }
    function done(rows) { S.ledger = rows; renderLedger(); renderSector(); }
    step(undefined, 0);
  }

  function loadCycles() {
    var db = SDK();
    if (!db) { errBox($('cyErr'), '数据环境未就绪'); return; }
    var acc = [], seen = {};
    function step(cursor, guard) {
      if (guard > 200) { done(acc); return; }
      db.query({ databaseId: 'HZm1EBKdHUmqRMNIasCJfm', pageSize: 200,
                 sorts: [{ property: '开始时间', direction: 'descending' }],
                 startCursor: cursor }).then(function (res) {
        var rows = (res && res.results) ? res.results : [];
        acc = acc.concat(rows);
        var next = res ? res.nextCursor : null;
        if (res && res.hasMore && next && next !== cursor && rows.length && !seen[next]) {
          seen[next] = 1; step(next, guard + 1);
        } else { done(acc); }
      }).catch(function (err) { errBox($('cyErr'), errMsg(err)); });
    }
    function done(rows) { S.cycles = rows; renderCycles(); renderKPI2(); }
    step(undefined, 0);
  }

  /* ================= 聚合统计：由服务端计算，不在前端遍历全量 ================= */

  function loadAggregates(scopeList) {
    var db = SDK();
    if (!db) { return; }
    var list = scopeList || ['cycles', 'events', 'agents', 'tasks', 'ledger'];
    function want(k) { return list.indexOf(k) >= 0; }
    var names = S.agents.map(function (a) { return a['智能体名称']; });
    var i;

    if (want('cycles')) {
      db.aggregate({ databaseId: 'HZm1EBKdHUmqRMNIasCJfm', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'cy_events', type: 'sum', property: '触发事件数' },
        { name: 'cy_tasks', type: 'sum', property: '完成任务数' },
        { name: 'cy_output', type: 'sum', property: '生豆产出kg' },
        { name: 'cy_carbon', type: 'sum', property: '碳减排kg' },
        { name: 'cy_credit', type: 'sum', property: '碳指标数' },
        { name: 'cy_receipt', type: 'sum', property: '仓单数' },
        { name: 'cy_finance', type: 'sum', property: '融资额' },
        { name: 'cy_ip', type: 'sum', property: '曲线IP收入' },
        { name: 'cy_revenue', type: 'sum', property: '门店收入' }
      ] }).then(function (rsp) { aggCache.cy = byName(rsp); renderKPI2(); })
        .catch(function (err) { errBox($('kpiErr'), errMsg(err)); });

      db.aggregate({ databaseId: 'HZm1EBKdHUmqRMNIasCJfm', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'by_state', type: 'count', groupBy: '运行状态' }
      ] }).then(function (rsp) { aggCache.cyState = byName(rsp); renderKPI2(); })
        .catch(function (err) { errBox($('kpiErr'), errMsg(err)); });
    }

    if (want('agents')) {
      db.aggregate({ databaseId: 'cFRjJqhyp5LDaCZHPp3XVm', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'by_status', type: 'count', groupBy: '运行状态' },
        { name: 'sum_calls', type: 'sum', property: '服务调用' },
        { name: 'sum_credits', type: 'sum', property: '信用积分' }
      ] }).then(function (rsp) { aggCache.ag = byName(rsp); renderKPI2(); })
        .catch(function (err) { errBox($('agentErr'), errMsg(err)); });
    }

    if (want('events')) {
      db.aggregate({ databaseId: 'ND8kO27PEOFohwZHxm6WgV', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'by_state', type: 'count', groupBy: '处理状态' },
        { name: 'by_src', type: 'count', groupBy: '来源智能体' }
      ] }).then(function (rsp) {
        var m = byName(rsp); aggCache.ev = m; aggCache.evState = m; aggCache.evSrc = m; renderKPI2();
      }).catch(function (err) { errBox($('evErr'), errMsg(err)); });
    }

    if (want('tasks')) {
      db.aggregate({ databaseId: 'xQspxv5gupTBY8LeSHVv5L', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'by_state', type: 'count', groupBy: '任务状态' },
        { name: 'by_agent', type: 'count', groupBy: '执行智能体' },
        { name: 'by_prio', type: 'count', groupBy: '优先级' }
      ] }).then(function (rsp) {
        var m = byName(rsp); aggCache.tk = m; aggCache.tkAgent = m; renderKPI2();
      }).catch(function (err) { errBox($('tkBoardErr'), errMsg(err)); });
    }

    if (want('ledger')) {
      var inAgg = [{ name: 'total', type: 'count' }, { name: 'by_type', type: 'count', groupBy: '结算类型' }];
      var outAgg = [];
      for (i = 0; i < names.length; i++) {
        inAgg.push({ name: 'in_' + i, type: 'sum', property: '金额',
                     filter: { property: { property: '收款方', text: { equals: names[i] } } } });
        outAgg.push({ name: 'out_' + i, type: 'sum', property: '金额',
                      filter: { property: { property: '付款方', text: { equals: names[i] } } } });
      }
      if (names.length) {
        db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: inAgg })
          .then(function (rsp) { var m = byName(rsp); aggCache.lgIn = m; aggCache.lgType = m; renderKPI2(); })
          .catch(function (err) { errBox($('lgErr'), errMsg(err)); });
        db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: outAgg })
          .then(function (rsp) { aggCache.lgOut = byName(rsp); renderKPI2(); })
          .catch(function (err) { errBox($('lgErr'), errMsg(err)); });
      } else {
        db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: inAgg })
          .then(function (rsp) { var m = byName(rsp); aggCache.lgType = m; renderKPI2(); })
          .catch(function (err) { errBox($('lgErr'), errMsg(err)); });
      }

      /* JEBI 计量：成本 / 计费 / 业务额 三口径分开汇总 */
      db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'sum_amount', type: 'sum', property: '金额' },
        { name: 'sum_cost', type: 'sum', property: '计量成本' },
        { name: 'sum_jbp', type: 'sum', property: '计费JBP' }
      ] }).then(function (rsp) { aggCache.meter = byName(rsp); renderMeter(); })
        .catch(function (err) { errBox($('lgErr'), errMsg(err)); });

      db.aggregate({ databaseId: 'dmRghisDSmokozzg8GMuwv', aggregates: [
        { name: 'total', type: 'count' },
        { name: 'by_role', type: 'count', groupBy: '计价角色' }
      ] }).then(function (rsp) { aggCache.meterRole = byName(rsp).by_role || []; renderMeter(); })
        .catch(function (err) { errBox($('lgErr'), errMsg(err)); });
    }
  }

  /* ================= 渲染 ================= */

  function renderAgents() {
    var host = $('agentGrid');
    if (!S.agents.length) { setHTML(host, empty('暂无智能体数据')); return; }
    setHTML(host, S.agents.map(function (r) {
      var name = r['智能体名称'] || '';
      var st = r['运行状态'] || '离线';
      var caps = CAPS[name] || [];
      var capPrev = caps.length ? caps[0] : '';
      if (caps.length > 1) { capPrev += ' · ' + caps[1]; }
      if (caps.length > 2) { capPrev += ' · ' + caps[2]; }
      if (caps.length > 3) { capPrev += ' …'; }
      return '<div class="ag-card" data-agent="' + escapeHtml(name) + '" role="button" tabindex="0">' +
        '<div class="ag-top"><div class="ag-ico" data-display="ag_icon">' + escapeHtml(r['图标'] || '🤖') + '</div>' +
        '<div><div class="ag-name" data-display="ag_name">' + escapeHtml(name) + '</div>' +
        '<div class="ag-no"><span data-display="ag_id">' + escapeHtml(r['智能体编号'] || '') + '</span> · 能力 ' + escapeHtml(r['能力数'] || 0) + ' 项</div></div></div>' +
        '<div class="ag-domain" data-display="ag_domain">' + escapeHtml(r['所属板块'] || '') + '</div>' +
        '<div class="ag-metrics">' +
        '<div class="m"><div class="mk">服务调用</div><div class="mv" data-display="ag_calls">' + escapeHtml(fmtInt(r['服务调用'])) + '</div></div>' +
        '<div class="m"><div class="mk">信用积分</div><div class="mv" data-display="ag_credits">' + escapeHtml(fmtInt(r['信用积分'])) + '</div></div>' +
        '<div class="m"><div class="mk">累计收益</div><div class="mv" style="font-size:11.5px" data-display="ag_revenue">' + escapeHtml(fmtMoney(r['累计收益'])) + '</div></div>' +
        '</div>' +
        '<div class="ag-foot"><span class="' + escapeHtml('pill ' + (st.indexOf('在线') === 0 ? 's-on' : st === '忙碌' ? 's-busy' : st === '降级' ? 's-deg' : 's-off')) + '"><span class="d"></span><span data-display="ag_status">' + escapeHtml(st) + '</span></span>' +
        '<span class="ag-heart" data-display="ag_beat">心跳 ' + escapeHtml(fmtAgo(r['最近心跳'])) + '</span></div>' +
        '<div class="ag-heart" style="margin-top:8px" data-display="ag_caps">能力：' + escapeHtml(capPrev) + '</div>' +
        '</div>';
    }).join(''));
    var cards = host.querySelectorAll('.ag-card');
    for (var i = 0; i < cards.length; i++) {
      (function (el) {
        function pick() {
          var n = el.getAttribute('data-agent');
          if (MULTI) { window.location.href = 'sector.html?agent=' + encodeURIComponent(n || ''); return; }
          var sel = document.getElementById('tk_agent');
          if (sel) {
            var opts = S.options.tasks['执行智能体'] || [];
            for (var j = 0; j < opts.length; j++) {
              if (opts[j].text === n) { sel.value = opts[j].id; break; }
            }
          }
          syncCapList();
          $('dispatch').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
        el.addEventListener('click', pick);
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
        });
      })(cards[i]);
    }
  }

  function filteredEvents() {
    var q = S.evQ.trim().toLowerCase();
    return S.events.filter(function (r) {
      if (S.evStatus && String(r['处理状态'] || '') !== S.evStatus) return false;
      if (q && String(r['事件主题'] || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function renderEvents() {
    var host = $('evBody');
    var rows = filteredEvents();
    var pages = Math.max(1, Math.ceil(rows.length / EV_PAGE));
    if (S.evPage > pages) { S.evPage = pages; }
    var from = (S.evPage - 1) * EV_PAGE;
    var page = rows.slice(from, from + EV_PAGE);
    if (!page.length) {
      setHTML(host, cellsEmpty(7, '没有符合条件的事件'));
    } else {
      setHTML(host, page.map(function (r) {
        return '<tr><td class="mono" data-display="ev_topic">' + escapeHtml(r['事件主题']) + '</td>' +
          '<td style="font-size:11.5px;color:var(--text-dim)"><span data-display="ev_src">' + escapeHtml(r['来源智能体']) + '</span> → <span data-display="ev_dst">' + escapeHtml(r['目标智能体']) + '</span></td>' +
          '<td style="font-size:11.5px;color:var(--text-dim)" data-display="ev_payload">' + escapeHtml(r['载荷摘要']) + '</td>' +
          '<td data-display="ev_state">' + stTag(r['处理状态']) + '</td>' +
          '<td class="num" data-display="ev_ms">' + escapeHtml(fmtInt(r['耗时毫秒'])) + ' ms</td>' +
          '<td style="font-size:11.5px;white-space:nowrap" data-display="ev_time">' + escapeHtml(fmtTime(r['发生时间'])) + '</td>' +
          '<td style="font-size:11px;color:var(--text-mute)" data-display="ev_id">' + escapeHtml(r['事件编号']) + '</td></tr>';
      }).join(''));
    }
    $('evMeta').textContent = '共 ' + fmtInt(S.evTotal) + ' 条事件 · 当前筛选 ' + fmtInt(rows.length) + ' 条';
    $('evPageInfo').textContent = '第 ' + S.evPage + ' / ' + pages + ' 页 · 每页 ' + EV_PAGE + ' 条';
    $('evPrev').disabled = S.evPage <= 1;
    $('evNext').disabled = S.evPage >= pages;
  }

  function renderTasks() {
    var host = $('tkBody');
    var rows = S.tasks.filter(function (r) { return !S.tkStatus || String(r['任务状态'] || '') === S.tkStatus; });
    if (!rows.length) {
      setHTML(host, cellsEmpty(8, '没有符合条件的工单'));
      $('tkMeta').textContent = '无匹配工单';
      return;
    }
    setHTML(host, rows.map(function (r) {
      var st = String(r['任务状态'] || '');
      var act = (st === '待调度' || st === '执行中')
        ? '<button class="btn btn-sm" type="button" data-done="' + escapeHtml(r.record_id || r['工单号']) + '">标记完成</button>'
        : '<span style="font-size:11px;color:var(--text-mute)">—</span>';
      return '<tr><td style="font-weight:600" data-display="tk_title">' + escapeHtml(r['任务标题']) + '</td>' +
        '<td style="font-size:11.5px" data-display="tk_agent">' + escapeHtml(r['执行智能体']) + '</td>' +
        '<td class="mono" data-display="tk_cap">' + escapeHtml(r['调用能力']) + '</td>' +
        '<td data-display="tk_prio">' + stTag(r['优先级']) + '</td>' +
        '<td data-display="tk_state">' + stTag(st) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap" data-display="tk_created">' + escapeHtml(fmtTime(r['创建时间'])) + '</td>' +
        '<td style="font-size:11px;color:var(--text-mute)" data-display="tk_id">' + escapeHtml(r['工单号']) + '</td>' +
        '<td>' + act + '</td></tr>';
    }).join(''));
    $('tkMeta').textContent = '共 ' + fmtInt(S.tkTotal) + ' 张工单 · 当前筛选 ' + fmtInt(rows.length) + ' 张';
    var btns = host.querySelectorAll('[data-done]');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () { completeTask(this); });
    }
  }

  function renderLedger() {
    var host = $('lgBody');
    var all = S.ledger;
    var pages = Math.max(1, Math.ceil(all.length / LG_PAGE));
    if (S.lgPage > pages) { S.lgPage = pages; }
    var from = (S.lgPage - 1) * LG_PAGE;
    var rows = all.slice(from, from + LG_PAGE);
    if (!rows.length) {
      setHTML(host, cellsEmpty(10, '暂无结算流水'));
      $('lgPageInfo').textContent = '共 0 笔结算';
      $('lgPrev').disabled = true;
      $('lgNext').disabled = true;
      return;
    }
    setHTML(host, rows.map(function (r) {
      var jbp = Number(r['计费JBP'] || 0);
      return '<tr><td style="font-size:11.5px" data-display="lg_from">' + escapeHtml(r['付款方']) + '</td>' +
        '<td style="font-size:11.5px" data-display="lg_to">' + escapeHtml(r['收款方']) + '</td>' +
        '<td data-display="lg_service">' + escapeHtml(r['服务名称']) + '</td>' +
        '<td class="num" data-display="lg_amount">' + escapeHtml(fmtMoney(r['金额'])) + '</td>' +
        '<td class="num" style="font-size:11.5px" data-display="lg_cost">' + escapeHtml(fmtCost(r['计量成本'])) + '</td>' +
        '<td data-display="lg_role">' + roleTag(r['计价角色']) + '</td>' +
        '<td class="num" data-display="lg_jbp">' + escapeHtml(jbp ? fmtInt(jbp) + ' JBP' : '0 JBP') + '</td>' +
        '<td data-display="lg_type">' + stTag(r['结算类型']) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap" data-display="lg_time">' + escapeHtml(fmtTime(r['结算时间'])) + '</td>' +
        '<td style="font-size:11px;color:var(--text-mute)" data-display="lg_id">' + escapeHtml(r['流水号']) + '</td></tr>';
    }).join(''));
    $('lgPageInfo').textContent = '共 ' + fmtInt(all.length) + ' 笔结算 · 第 ' + S.lgPage + ' / ' + pages + ' 页';
    $('lgPrev').disabled = S.lgPage <= 1;
    $('lgNext').disabled = S.lgPage >= pages;
  }

  function renderCycles() {
    var host = $('tlBars'), axis = $('tlAxis'), body = $('cyBody');
    if (!S.cycles.length) {
      setHTML(host, empty('暂无周期数据'));
      setHTML(axis, '');
      setHTML(body, cellsEmpty(11, '暂无周期数据'));
      setHTML($('cyStats'), '');
      return;
    }
    var list = S.cycles.slice().sort(function (a, b) {
      return new Date(a['开始时间'] || 0) - new Date(b['开始时间'] || 0);
    });
    /* 表由每小时自动任务持续追加，只保留最近 24 个周期 —— 滚动 24 小时窗口，
       柱数恒定，与板块名一致，也不会随天数把图表挤坏。 */
    var WINDOW = 24;
    if (list.length > WINDOW) { list = list.slice(list.length - WINDOW); }
    var max = 1;
    list.forEach(function (r) { var v = num(r['生豆产出kg']) || 0; if (v > max) max = v; });
    setHTML(host, list.map(function (r) {
      var v = num(r['生豆产出kg']) || 0;
      var h = Math.max(5, Math.round(v / max * 100));
      var st = String(r['运行状态'] || '');
      var cls = 'tl-bar' + (st === '运行中' ? ' run' : (st === '异常' ? ' bad' : ''));
      var hr = String(r['开始时间'] || '');
      var hm = hr.indexOf('T') > -1 ? hr.split('T')[1].substring(0, 2) : '--';
      var tip = (r['周期编号'] || '') + ' · ' + fmtTime(r['开始时间']) + ' · 事件 ' + r['触发事件数'] +
        ' · 工单 ' + r['完成任务数'] + ' · 生豆 ' + v + 'kg · 碳减排 ' + r['碳减排kg'] + 'kg · ' + st;
      return '<div class="tl-col" title="' + escapeHtml(tip) + '"><div class="' + escapeHtml(cls) + '" style="height:' + escapeHtml(String(h)) + '%"></div><div class="tl-lbl">' + escapeHtml(hm) + '</div></div>';
    }).join(''));
    setHTML(axis, list.map(function () { return '<span>·</span>'; }).join(''));
    setHTML($('tlWindow'), fmtInt(Math.min(list.length, WINDOW)) + ' 小时滚动窗口 · 全表 ' +
      fmtInt(S.cycles.length) + ' 个周期（柱状图只画最近 ' + WINDOW + ' 个）');

    var ordered = S.cycles.slice().sort(function (a, b) {
      return new Date(b['开始时间'] || 0) - new Date(a['开始时间'] || 0);
    });
    var cyPages = Math.max(1, Math.ceil(ordered.length / CY_PAGE));
    if (S.cyPage > cyPages) { S.cyPage = cyPages; }
    var cyFrom = (S.cyPage - 1) * CY_PAGE;
    var recent = ordered.slice(cyFrom, cyFrom + CY_PAGE);
    $('cyPageInfo').textContent = '共 ' + fmtInt(ordered.length) + ' 个周期 · 第 ' + S.cyPage + ' / ' + cyPages + ' 页';
    $('cyPrev').disabled = S.cyPage <= 1;
    $('cyNext').disabled = S.cyPage >= cyPages;
    setHTML(body, recent.map(function (r) {
      return '<tr><td class="mono" data-display="cy_id">' + escapeHtml(r['周期编号']) + '</td>' +
        '<td data-display="cy_type">' + stTag(r['周期类型']) + '</td>' +
        '<td data-display="cy_state">' + stTag(r['运行状态']) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap" data-display="cy_start">' + escapeHtml(fmtTime(r['开始时间'])) + '</td>' +
        '<td class="num" data-display="cy_events">' + escapeHtml(fmtInt(r['触发事件数'])) + '</td>' +
        '<td class="num" data-display="cy_tasks">' + escapeHtml(fmtInt(r['完成任务数'])) + '</td>' +
        '<td class="num" data-display="cy_output">' + escapeHtml(r['生豆产出kg']) + '</td>' +
        '<td class="num" data-display="cy_carbon">' + escapeHtml(r['碳减排kg']) + '</td>' +
        '<td class="num" data-display="cy_receipts">' + escapeHtml(fmtInt(r['仓单数'])) + '</td>' +
        '<td class="num" data-display="cy_finance">' + escapeHtml(fmtMoney(r['融资额'])) + '</td>' +
        '<td style="font-size:11.5px;color:var(--text-dim)" data-display="cy_note">' + escapeHtml(r['备注']) + '</td></tr>';
    }).join(''));
  }

  function renderKPI() {
    var cy = aggCache.cy, ag = aggCache.ag, ev = aggCache.ev, tk = aggCache.tk;
    var lgIn = aggCache.lgIn, lgOut = aggCache.lgOut, lgType = aggCache.lgType;
    var evSrc = aggCache.evSrc, evState = aggCache.evState, tkAgent = aggCache.tkAgent;
    var cyState = aggCache.cyState;
    var names = S.agents.map(function (a) { return a['智能体名称']; });

    function stat(k, v, u) {
      return '<div class="stat"><div class="k">' + escapeHtml(k) + '</div>' +
        '<div class="v">' + escapeHtml(v) + '</div><div class="u">' + escapeHtml(u) + '</div></div>';
    }

    /* 总览页页首四张卡 */
    if (ag && ev && tk && cy) {
      $('kpiAgents').textContent = fmtInt(ag.total);
      $('kpiEvents').textContent = fmtInt(ev.total);
      $('kpiTasks').textContent = fmtInt(tk.total);
      $('kpiCycles').textContent = fmtInt(cy.total);
    }

    /* 周期 KPI —— 时钟板块 */
    if (cy && cyState) {
      setHTML($('cyStats'),
        stat('周期内完成工单', fmtInt(cy.cy_tasks), '张（全部周期合计）') +
        stat('运行周期', fmtInt(cy.total), '个（含人工触发）') +
        stat('周期内触发事件', fmtInt(cy.cy_events), '条') +
        stat('运行状态种数', fmtInt((cyState.by_state || []).length), '种（运行中 / 已完成 / 异常）'));
    }

    /* 飞轮 + 实测 KPI 卡 —— KPI 板块 */
    if (cy && ev) {
      var outKg = num(cy.cy_output) || 0;
      var carbon = num(cy.cy_carbon) || 0;
      bars($('fwBars'), [
        { label: '生豆产出', value: outKg, text: outKg.toFixed(1) + ' kg' },
        { label: '碳减排量', value: carbon, text: carbon.toFixed(1) + ' kg' },
        { label: '碳指标铸造', value: num(cy.cy_credit) || 0, text: fmtInt(cy.cy_credit) + ' 个' },
        { label: '仓单资产化', value: num(cy.cy_receipt) || 0, text: fmtInt(cy.cy_receipt) + ' 张' },
        { label: '仓单融资额', value: num(cy.cy_finance) || 0, text: fmtMoney(cy.cy_finance) },
        { label: '曲线 IP 收入', value: num(cy.cy_ip) || 0, text: fmtMoney(cy.cy_ip) },
        { label: '门店现金流', value: num(cy.cy_revenue) || 0, text: fmtMoney(cy.cy_revenue) },
        { label: '全链事件', value: num(ev.total) || 0, text: fmtInt(ev.total) + ' 条' }
      ], { pos: true });

      setHTML($('kpiStats'),
        stat('生豆总产量', outKg.toFixed(1), 'kg（雾化水培）') +
        stat('碳减排总量', carbon.toFixed(1), 'kg CO₂e') +
        stat('碳指标铸造', fmtInt(cy.cy_credit), '个（MRV 自动化）') +
        stat('仓单数量', fmtInt(cy.cy_receipt), '张（资产化）') +
        stat('仓单融资', fmtMoney(cy.cy_finance), '（金融化）') +
        stat('曲线 IP 收益', fmtMoney(cy.cy_ip), '（知识资产）') +
        stat('门店收入', fmtMoney(cy.cy_revenue), '（现金流）') +
        stat('全链事件', fmtInt(ev.total), '条可追溯事件'));
    }

    /* 智能体收支 —— 经济体 / KPI 板块 */
    if (lgIn && lgOut && names.length) {
      bars($('ecoIn'), names.map(function (n, i) {
        return { label: n, value: num(lgIn['in_' + i]) || 0, text: fmtMoney(lgIn['in_' + i]) };
      }).sort(function (a, b) { return b.value - a.value; }), { pos: true, emptyText: '暂无结算数据' });

      bars($('ecoOut'), names.map(function (n, i) {
        return { label: n, value: num(lgOut['out_' + i]) || 0, text: fmtMoney(lgOut['out_' + i]) };
      }).sort(function (a, b) { return b.value - a.value; }), { emptyText: '暂无结算数据' });

      bars($('ecoNet'), names.map(function (n, i) {
        var v = (num(lgIn['in_' + i]) || 0) - (num(lgOut['out_' + i]) || 0);
        return { label: n, value: v, text: fmtMoney(v) };
      }).sort(function (a, b) { return b.value - a.value; }), { pos: true, emptyText: '暂无结算数据' });
    }

    /* 分布图 —— 各自所属板块 */
    if (evSrc && evState) {
      bars($('evBySrc'), groupRows(evSrc.by_src, '条'), { pos: true, emptyText: '暂无来源分布' });
      chips($('evByState'), groupRows(evState.by_state, '条'));
    }
    if (tkAgent) {
      bars($('tkByAgent'), groupRows(tkAgent.by_agent, '张'), { pos: true, emptyText: '暂无工单分布' });
    }
    if (lgType) {
      chips($('ecoType'), groupRows(lgType.by_type, '笔'));
    }

    /* 数据表台账 —— 总览 / KPI 板块 */
    if (ag && ev && tk && cy && lgType) {
      setHTML($('tblBody'), [
        ['智能体注册表', '九体状态 / 能力 / 信用积分', ag.total],
        ['事件总线', '全链事件流与处理状态', ev.total],
        ['任务工单', '工单调度与人工回执', tk.total],
        ['智能体账本', '服务调用结算流水', lgType.total],
        ['运行周期', '每小时时钟推进记录', cy.total]
      ].map(function (t) {
        return '<tr><td style="font-weight:600">' + escapeHtml(t[0]) + '</td>' +
          '<td style="font-size:11.5px;color:var(--text-dim)">' + escapeHtml(t[1]) + '</td>' +
          '<td class="num">' + escapeHtml(fmtInt(t[2])) + '</td>' +
          '<td><span class="st g">已绑定</span></td></tr>';
      }).join(''));
    }
  }
  function renderKPI2() { renderKPI(); }

  /* ================= 交互：派发工单 / 标记完成 / 推进周期 ================= */

  function renderDispatchQuote(cap, agentText) {
    var host = $('dispatchQuote');
    if (!host) return;
    if (!agentText || !cap) {
      setHTML(host, '选择智能体与能力后，这里显示 JEBI 计量报价。');
      return;
    }
    var role = roleForSettlement('服务调用');
    var q = quoteByCost(role, sampleCost(role, seedFrom(cap + '|' + agentText)));
    setHTML(host,
      'JEBI 计量报价 · 计量成本 <b>¥' + escapeHtml(q.cost_cny.toFixed(4)) + '</b>' +
      ' → 角色 <b>' + escapeHtml(role) + '</b> ×' + escapeHtml(String(q.mult)) +
      '（下限 ' + escapeHtml(String(q.floor)) + ' JBP）' +
      ' → 计费 <b>' + escapeHtml(fmtInt(q.charged_jbp)) + ' JBP</b>（≈ ¥' + escapeHtml(q.amount_cny.toFixed(2)) + '）');
  }

  function syncCapList() {
    var sel = $('tk_agent');
    if (!sel) return;
    var opts = S.options.tasks['执行智能体'] || [];
    var text = '';
    for (var i = 0; i < opts.length; i++) { if (opts[i].id === sel.value) { text = opts[i].text; break; } }
    var caps = CAPS[text] || [];
    setHTML($('capList'), caps.map(function (c) {
      return '<option value="' + escapeHtml(c) + '"></option>';
    }).join(''));
    if (caps.length && !$('tk_cap').value) { $('tk_cap').value = caps[0]; }
    $('dispatchMeta').textContent = text
      ? ('目标智能体：' + text + ' · 能力 ' + caps.length + ' 项')
      : '写入目标：任务工单 + 事件总线 + 计量账本';
    renderDispatchQuote($('tk_cap').value, text);
    cacheForm();
  }
  function setMsg(el, cls, text) { el.className = 'msg ' + cls; el.textContent = text; }

  /* 表单本地缓存：只缓存真正会提交的字段 */
  function formFields() {
    return ['tk_title', 'tk_agent', 'tk_cap', 'tk_prio', 'tk_from', 'tk_result'];
  }
  function cacheForm() {
    if (!document.getElementById('tk_title')) { return; }
    try {
      var data = {};
      formFields().forEach(function (id) {
        var el = $(id);
        if (el) { data[id] = el.value; }
      });
      localStorage.setItem(FORM_CACHE_KEY, JSON.stringify(data));
    } catch (e) { /* 存储不可用时静默降级 */ }
  }
  function restoreForm() {
    if (!document.getElementById('tk_title')) { return; }
    try {
      var raw = localStorage.getItem(FORM_CACHE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      formFields().forEach(function (id) {
        var el = $(id);
        if (el && data[id] !== undefined && data[id] !== '') { el.value = data[id]; }
      });
    } catch (e) { /* 静默降级 */ }
  }
  function clearFormCache() {
    try { localStorage.removeItem(FORM_CACHE_KEY); } catch (e) { /* 静默降级 */ }
  }
  var cacheTimer = null;
  function bindFormCache() {
    formFields().forEach(function (id) {
      var el = $(id);
      if (!el) return;
      el.addEventListener('input', function () {
        if (cacheTimer) { clearTimeout(cacheTimer); }
        cacheTimer = setTimeout(cacheForm, 300);
      });
      el.addEventListener('change', function () {
        if (cacheTimer) { clearTimeout(cacheTimer); }
        cacheTimer = setTimeout(cacheForm, 300);
      });
    });
  }

  function submitTask(e) {
    if (e) { e.preventDefault(); }
    var db = SDK();
    var msg = $('tkMsg');
    var btn = $('tkSubmit');
    var title = $('tk_title').value.trim();
    var agentId = $('tk_agent').value;
    if (!title) { setMsg(msg, 'err', '请填写任务标题'); $('tk_title').focus(); return; }
    if (!agentId) { setMsg(msg, 'err', '请选择执行智能体'); return; }
    var opts = S.options.tasks['执行智能体'] || [];
    var agentText = '';
    for (var i = 0; i < opts.length; i++) { if (opts[i].id === agentId) { agentText = opts[i].text; break; } }
    var prio = $('tk_prio').value;
    if (!prio) { var pl = S.options.tasks['优先级'] || []; prio = pl.length ? pl[pl.length - 1].id : '中'; }
    var from = $('tk_from').value.trim() || '人工控制台';
    var cap = $('tk_cap').value.trim() || 'manual_dispatch';
    var note = $('tk_result').value.trim() || '已进入调度队列，等待智能体心跳';

    if (!db) { setMsg(msg, 'err', '数据环境未就绪，无法写入'); return; }
    btn.disabled = true;
    setMsg(msg, 'run', '正在写入工单…');

    db.addRecord({
      databaseId: 'xQspxv5gupTBY8LeSHVv5L',
      properties: {
        '任务标题': { text: title },
        '发起方': { text: from },
        '执行智能体': { select: agentId },
        '调用能力': { text: cap },
        '优先级': { select: prio },
        '任务状态': { select: '待调度' },
        '结果摘要': { text: note },
        '创建时间': { date: nowISO() },
        '工单号': { text: 'TK-' + Date.now().toString(36).toUpperCase() }
      }
    }).then(function () {
      setMsg(msg, 'run', '工单已写入，正在发布事件…');
      return db.addRecord({
        databaseId: 'ND8kO27PEOFohwZHxm6WgV',
        properties: {
          '事件主题': { text: 'console.task_dispatched' },
          '来源智能体': { text: from },
          '目标智能体': { text: agentText },
          '载荷摘要': { text: '【' + prio + '】' + title + '（能力 ' + cap + '）' },
          '处理状态': { select: '已投递' },
          '耗时毫秒': { number: Math.round(18 + Math.random() * 70) },
          '发生时间': { date: nowISO() },
          '事件编号': { text: 'EV-CONSOLE-' + Date.now().toString(36).toUpperCase() }
        }
      });
    }).then(function () {
      /* JEBI 计量：这次能力调用按「先计量后定价」计一次费，落账本
         种子与派发台实时报价一致（cap|agent），所以预览价 = 落账价 */
      var settleType = '服务调用';
      var meterRole = roleForSettlement(settleType);
      var q = quoteByCost(meterRole, sampleCost(meterRole, seedFrom(cap + '|' + agentText)));
      setMsg(msg, 'run', '正在按 JEBI 口径计量计费…');
      return db.addRecord({
        databaseId: 'dmRghisDSmokozzg8GMuwv',
        properties: {
          '付款方': { text: from },
          '收款方': { text: agentText },
          '服务名称': { text: cap },
          '金额': { currency: q.amount_cny },
          '结算类型': { select: settleType },
          '结算时间': { date: nowISO() },
          '流水号': { text: 'LG-METER-' + Date.now().toString(36).toUpperCase() },
          '计量成本': { currency: q.cost_cny },
          '计价角色': { select: meterRole },
          '计费JBP': { number: q.charged_jbp }
        }
      });
    }).then(function () {
      setMsg(msg, 'ok', '已下发：' + agentText + ' · 工单 + 事件总线 + 计量账本 三表已写入');
      $('tk_title').value = '';
      $('tk_result').value = '';
      clearFormCache();
      renderDispatchReceipt(agentText, cap);
      refreshAll();
    }).catch(function (err) {
      setMsg(msg, 'err', '写入失败：' + errMsg(err));
    }).finally(function () { btn.disabled = false; });
  }

  function completeTask(btn) {
    var rid = btn.getAttribute('data-done');
    var db = SDK();
    if (!db || !rid) { return; }
    btn.disabled = true;
    btn.textContent = '提交中…';
    db.updateRecord({
      databaseId: 'xQspxv5gupTBY8LeSHVv5L',
      recordId: rid,
      properties: {
        '任务状态': { select: '已完成' },
        '完成时间': { date: nowISO() },
        '结果摘要': { text: '控制台人工回执完成，事件链已闭合' }
      }
    }).then(function () {
      return db.addRecord({
        databaseId: 'ND8kO27PEOFohwZHxm6WgV',
        properties: {
          '事件主题': { text: 'console.task_completed' },
          '来源智能体': { text: '人工控制台' },
          '目标智能体': { text: '中枢神经智能体' },
          '载荷摘要': { text: '工单 ' + rid + ' 已人工回执完成，中枢更新调度队列' },
          '处理状态': { select: '已确认' },
          '耗时毫秒': { number: Math.round(20 + Math.random() * 60) },
          '发生时间': { date: nowISO() },
          '事件编号': { text: 'EV-CONSOLE-' + Date.now().toString(36).toUpperCase() }
        }
      });
    }).then(function () {
      loadTasks(true);
      if (wants('q', 'events')) { loadEvents(); }
      if (scope().a.length) { loadAggregates(scope().a); }
    }).catch(function (err) {
      btn.disabled = false;
      btn.textContent = '标记完成';
      errBox($('tkBoardErr'), errMsg(err));
    });
  }

  function tickCycle() {
    var db = SDK();
    var btn = $('tickBtn');
    var msg = $('tkMsg');
    if (!db) { setMsg(msg, 'err', '数据环境未就绪'); return; }
    btn.disabled = true;
    setMsg(msg, 'run', '正在推进模拟周期…');
    var now = new Date();
    var cn = 'CY-MAN-' + now.toISOString().substring(11, 16).replace(':', '');
    var plan = [
      ['nexus.cross_dispatch', '中枢神经智能体', '碳账本智能体', '人工触发：全链数据重算并刷新碳定价模型'],
      ['iot.carbon_measured', '气雾栽培智能体', '碳账本智能体', '人工触发：第 7 号舱减排量重新核算'],
      ['carbon.minted', '碳账本智能体', '零碳商城智能体', '人工触发：铸造碳指标并上链']
    ];
    db.addRecord({
      databaseId: 'HZm1EBKdHUmqRMNIasCJfm',
      properties: {
        '周期编号': { text: cn },
        '周期类型': { select: '人工触发' },
        '运行状态': { select: '已完成' },
        '开始时间': { date: nowISO() },
        '结束时间': { date: new Date(now.getTime() + 60000).toISOString().replace(/\.\d{3}Z$/, 'Z') },
        '触发事件数': { number: plan.length },
        '完成任务数': { number: 1 },
        '生豆产出kg': { number: 0 },
        '碳减排kg': { number: 0 },
        '碳指标数': { number: 1 },
        '仓单数': { number: 0 },
        '融资额': { currency: 0 },
        '曲线IP收入': { currency: 0 },
        '门店收入': { currency: 0 },
        '备注': { text: '控制台人工触发的一次时钟推进' }
      }
    }).then(function () {
      var chain = Promise.resolve();
      plan.forEach(function (row, idx) {
        chain = chain.then(function () {
          return db.addRecord({
            databaseId: 'ND8kO27PEOFohwZHxm6WgV',
            properties: {
              '事件主题': { text: row[0] },
              '来源智能体': { text: row[1] },
              '目标智能体': { text: row[2] },
              '载荷摘要': { text: row[3] },
              '处理状态': { select: '已确认' },
              '耗时毫秒': { number: 30 + idx * 17 },
              '发生时间': { date: new Date(now.getTime() + idx * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') },
              '事件编号': { text: 'EV-MAN-' + cn.substring(7) + '-' + (idx + 1) }
            }
          });
        });
      });
      return chain;
    }).then(function () {
      setMsg(msg, 'ok', '已推进一个周期：' + cn + '，并发布 ' + plan.length + ' 条事件');
      refreshAll();
    }).catch(function (err) {
      setMsg(msg, 'err', '推进失败：' + errMsg(err));
    }).finally(function () { btn.disabled = false; });
  }

  function fillExample() {
    var keys = Object.keys(CAPS);
    var n = keys[Math.floor(Math.random() * keys.length)];
    var caps = CAPS[n];
    var sel = $('tk_agent');
    var opts = S.options.tasks['执行智能体'] || [];
    for (var i = 0; i < opts.length; i++) { if (opts[i].text === n) { sel.value = opts[i].id; break; } }
    $('tk_title').value = '[' + n.replace('智能体', '') + '] ' + caps[Math.floor(Math.random() * caps.length)] + ' 自动巡检';
    syncCapList();
    if (caps.length) { $('tk_cap').value = caps[Math.floor(Math.random() * caps.length)]; }
    $('tk_result').value = '本周期内完成并回执事件链';
    cacheForm();
  }

  /* ================= 板块详情页（?agent=…） ================= */

  function renderDispatchReceipt(agentText, cap) {
    var host = $('receipt');
    if (!host.nodeType) { return; }
    host.className = 'receipt';
    host.removeAttribute('hidden');
    var role = roleForSettlement('服务调用');
    var q = quoteByCost(role, sampleCost(role, seedFrom(cap + '|' + agentText)));
    setHTML(host,
      '<h4>本页写入回执</h4>' +
      '<div class="row"><span class="rk">任务工单</span><span>已写入「任务工单」表 · 状态 待调度</span></div>' +
      '<div class="row"><span class="rk">事件总线</span><span>console.task_dispatched → ' + escapeHtml(agentText) + '</span></div>' +
      '<div class="row"><span class="rk">计量账本</span><span>' + escapeHtml(agentText) + ' · ' + escapeHtml(cap) +
        ' → ' + escapeHtml(role) + ' · ¥' + escapeHtml(q.amount_cny.toFixed(2)) +
        '（计量成本 ¥' + escapeHtml(q.cost_cny.toFixed(4)) + ' → ' + escapeHtml(fmtInt(q.charged_jbp)) + ' JBP）</span></div>');
  }

  function renderSector() {
    if (PAGE !== 'sector') { return; }
    var host = $('sectorBody');
    if (!host.nodeType) { return; }

    var name = AGENT_PARAM;
    var row = null, i;
    for (i = 0; i < S.agents.length; i++) {
      if (String(S.agents[i]['智能体名称'] || '') === name) { row = S.agents[i]; break; }
    }
    if (!row) {
      if (name && !S.agents.length) { return; }   /* 注册表还没回来，先别误报「未找到」 */
      var links = S.agents.map(function (a) {
        return '<a class="dchip" href="sector.html?agent=' + encodeURIComponent(a['智能体名称']) + '">' +
          escapeHtml(a['图标'] || '') + ' ' + escapeHtml(a['智能体名称']) + '</a>';
      }).join(' ');
      setHTML(host, empty(name ? ('未找到板块：' + name) : '请从「智能体舰队」选择一个板块'));
      setHTML($('secCaps'), links);
      return;
    }
    setHTML(host, '');

    var st = String(row['运行状态'] || '离线');
    var caps = CAPS[name] || [];
    setHTML($('secProfile'),
      '<div class="sec-hero">' +
      '<div class="ico" data-display="sec_icon">' + escapeHtml(row['图标'] || '🤖') + '</div>' +
      '<div style="flex:1;min-width:0">' +
      '<div class="nm" data-display="sec_name">' + escapeHtml(name) + '</div>' +
      '<div class="dm" data-display="sec_domain">' + escapeHtml(row['所属板块'] || '') + '</div>' +
      '<div class="kv">' +
      '<div><div class="k">运行状态</div><div class="v">' + stTag(st) + '</div></div>' +
      '<div><div class="k">智能体编号</div><div class="v" style="font-size:12.5px" data-display="sec_id">' + escapeHtml(row['智能体编号'] || '—') + '</div></div>' +
      '<div><div class="k">能力数</div><div class="v" data-display="sec_capn">' + escapeHtml(fmtInt(row['能力数'])) + '</div></div>' +
      '<div><div class="k">服务调用</div><div class="v" data-display="sec_calls">' + escapeHtml(fmtInt(row['服务调用'])) + '</div></div>' +
      '<div><div class="k">信用积分</div><div class="v" data-display="sec_credits">' + escapeHtml(fmtInt(row['信用积分'])) + '</div></div>' +
      '<div><div class="k">累计收益</div><div class="v" data-display="sec_revenue">' + escapeHtml(fmtMoney(row['累计收益'])) + '</div></div>' +
      '<div><div class="k">最近心跳</div><div class="v" style="font-size:12.5px" data-display="sec_beat">' + escapeHtml(fmtAgo(row['最近心跳'])) + '</div></div>' +
      '</div></div></div>');

    setHTML($('secActions'),
      '<a class="btn btn-primary" href="dispatch.html?agent=' + encodeURIComponent(name) + '">给该板块派发任务</a>' +
      '<a class="btn" href="cycles.html">查看 24 小时时钟</a>' +
      '<a class="btn" href="economy.html">查看经济体结算</a>');

    setHTML($('secCaps'), caps.length
      ? '<h3>可被调用的能力</h3><div style="margin-top:11px">' + caps.map(function (c) {
          return '<span class="dchip">' + escapeHtml(c) + '</span>';
        }).join(' ') + '</div>'
      : '<h3>可被调用的能力</h3>' + empty('该板块未登记能力'));

    /* 本板块的工单 */
    var tasks = S.tasks.filter(function (r) { return String(r['执行智能体'] || '') === name; });
    setHTML($('secTasks'), tasks.length ? tasks.map(function (r) {
      var s = String(r['任务状态'] || '');
      return '<tr><td data-display="sec_tk_title">' + escapeHtml(r['任务标题']) + '</td>' +
        '<td class="mono">' + escapeHtml(r['调用能力']) + '</td>' +
        '<td>' + stTag(r['优先级']) + '</td>' +
        '<td>' + stTag(s) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap">' + escapeHtml(fmtTime(r['创建时间'])) + '</td>' +
        '<td style="font-size:11px;color:var(--text-mute)">' + escapeHtml(r['工单号']) + '</td></tr>';
    }).join('') : cellsEmpty(6, '该板块暂无工单'));

    /* 本板块的事件（发出 + 接收） */
    var evs = S.events.filter(function (r) {
      return String(r['来源智能体'] || '') === name || String(r['目标智能体'] || '') === name;
    });
    setHTML($('secEvents'), evs.length ? evs.slice(0, 60).map(function (r) {
      var dir = String(r['来源智能体'] || '') === name ? '发出' : '接收';
      return '<tr><td class="mono">' + escapeHtml(r['事件主题']) + '</td>' +
        '<td><span class="st m">' + escapeHtml(dir) + '</span></td>' +
        '<td style="font-size:11.5px;color:var(--text-dim)">' + escapeHtml(r['载荷摘要']) + '</td>' +
        '<td>' + stTag(r['处理状态']) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap">' + escapeHtml(fmtTime(r['发生时间'])) + '</td></tr>';
    }).join('') : cellsEmpty(5, '该板块暂无事件'));

    /* 本板块的账本流水 */
    var lgs = S.ledger.filter(function (r) {
      return String(r['收款方'] || '') === name || String(r['付款方'] || '') === name;
    });
    setHTML($('secLedger'), lgs.length ? lgs.map(function (r) {
      var isIn = String(r['收款方'] || '') === name;
      return '<tr><td style="font-size:11.5px">' + escapeHtml(r['付款方']) + ' → ' + escapeHtml(r['收款方']) + '</td>' +
        '<td>' + escapeHtml(r['服务名称']) + '</td>' +
        '<td><span class="st ' + escapeHtml(isIn ? 'g' : 'r') + '">' + escapeHtml(isIn ? '收入' : '支出') + '</span></td>' +
        '<td class="num">' + escapeHtml(fmtMoney(r['金额'])) + '</td>' +
        '<td class="num">' + escapeHtml(fmtCost(r['计量成本'])) + '</td>' +
        '<td>' + roleTag(r['计价角色']) + '</td>' +
        '<td class="num">' + escapeHtml(fmtInt(r['计费JBP'])) + '</td>' +
        '<td style="font-size:11.5px;white-space:nowrap">' + escapeHtml(fmtTime(r['结算时间'])) + '</td></tr>';
    }).join('') : cellsEmpty(8, '该板块暂无结算流水'));

    /* 本板块实测汇总（客户端小计，用于自检数据一致性） */
    var sumJbp = 0, sumCost = 0, sumAmount = 0;
    for (i = 0; i < lgs.length; i++) {
      sumJbp += Number(lgs[i]['计费JBP']) || 0;
      sumCost += Number(lgs[i]['计量成本']) || 0;
      sumAmount += Number(lgs[i]['金额']) || 0;
    }
    setHTML($('secStats'),
      statCard('本板块工单', fmtInt(tasks.length), '张（表内实测）') +
      statCard('本板块事件', fmtInt(evs.length), '条（发出 + 接收）') +
      statCard('结算笔数', fmtInt(lgs.length), '笔（收 + 付）') +
      statCard('服务业务额', fmtMoney(sumAmount), '既有口径') +
      statCard('计量成本', '¥' + sumCost.toFixed(2), 'JEBI 先计量') +
      statCard('计费合计', fmtInt(sumJbp) + ' JBP', '≈ ¥' + (sumJbp / JBP_PER_CNY).toFixed(2)));
  }

  /* ================= 初始化 ================= */

  function staticFallback() {
    setHTML($('agentGrid'), empty('未检测到在线数据环境，页面以静态形态展示。'));
    setHTML($('evBody'), cellsEmpty(7, '未检测到在线数据环境'));
    setHTML($('tkBody'), cellsEmpty(8, '未检测到在线数据环境'));
    setHTML($('lgBody'), cellsEmpty(10, '未检测到在线数据环境'));
    setHTML($('cyBody'), cellsEmpty(11, '未检测到在线数据环境'));
    setHTML($('tlBars'), empty('未检测到在线数据环境'));
    setHTML($('tlAxis'), '');
    setHTML($('kpiStats'), empty('未检测到在线数据环境'));
    setHTML($('fwBars'), empty('未检测到在线数据环境'));
    setHTML($('ecoIn'), empty('未检测到在线数据环境'));
    setHTML($('ecoOut'), empty('未检测到在线数据环境'));
    setHTML($('ecoNet'), empty('未检测到在线数据环境'));
    setHTML($('tblBody'), cellsEmpty(4, '未检测到在线数据环境'));
    setHTML($('meterTracks'), ROLE_PRICING.map(function (p) { return statCard(p.role, '×' + p.mult, p.note); }).join(''));
    setHTML($('meterStats'), empty('未检测到在线数据环境'));
    setHTML($('meterRoles'), '');
    setHTML($('secProfile'), empty('未检测到在线数据环境'));
    setHTML($('secCaps'), '');
    setHTML($('secActions'), '');
    setHTML($('secStats'), empty('未检测到在线数据环境'));
    setHTML($('secTasks'), cellsEmpty(6, '未检测到在线数据环境'));
    setHTML($('secEvents'), cellsEmpty(5, '未检测到在线数据环境'));
    setHTML($('secLedger'), cellsEmpty(8, '未检测到在线数据环境'));
    var meterNoteEl = $('meterNote');
    if (meterNoteEl) {
      var ex = jebiQuote('B端加盟商', 3200, 780, 1200);
      setHTML(meterNoteEl,
        '算例（B端）：3,200 prompt（含 1,200 命中缓存）+ 780 completion → 计量成本 ¥' +
        escapeHtml(ex.cost_cny.toFixed(6)) + ' → ×' + escapeHtml(String(ex.mult)) + ' = ' +
        escapeHtml((ex.cost_cny * ex.mult).toFixed(4)) + ' JBP，低于下限 ' + escapeHtml(String(ex.floor)) +
        ' JBP → 实收 ' + escapeHtml(fmtInt(ex.charged_jbp)) + ' JBP（¥' + escapeHtml(ex.amount_cny.toFixed(2)) + '）。');
    }
  }

  function refreshAll() {
    var sc = scope();
    function afterAgents() { if (sc.a.length) { loadAggregates(sc.a); } }
    if (sc.q.indexOf('agents') >= 0) { loadAgents(afterAgents); } else { afterAgents(); }
    if (sc.q.indexOf('events') >= 0) { loadEvents(); }
    if (sc.q.indexOf('tasks') >= 0) { loadTasks(); }
    if (sc.q.indexOf('ledger') >= 0) { loadLedger(); }
    if (sc.q.indexOf('cycles') >= 0) { loadCycles(); }
  }

  function applyAgentParam() {
    if (!AGENT_PARAM) { return; }
    var sel = document.getElementById('tk_agent');
    var opts = S.options.tasks['执行智能体'] || [];
    var i;
    if (sel) {
      for (i = 0; i < opts.length; i++) {
        if (opts[i].text === AGENT_PARAM) { sel.value = opts[i].id; break; }
      }
    }
    var t = document.getElementById('tk_title');
    if (t && !t.value) { t.value = '[' + AGENT_PARAM.replace('智能体', '') + '] 本周期巡检'; }
  }

  function boot() {
    var db = SDK();
    if (!db) { staticFallback(); return; }

    var tkMsgEl = $('tkMsg');

    if (wants('q', 'tasks')) {
      db.getSchema({ databaseId: 'xQspxv5gupTBY8LeSHVv5L' }).then(function (schema) {
        (schema && schema.properties ? schema.properties : []).forEach(function (f) {
          if ((f.type === 'select' || f.type === 'multi_select') && f.config && f.config.options) {
            S.options.tasks[f.name] = f.config.options;
          }
        });
      }).catch(function (err) { console.error('[database] 任务工单表结构加载失败:', err); });
    }

    if (wants('q', 'events')) {
      db.getSchema({ databaseId: 'ND8kO27PEOFohwZHxm6WgV' }).then(function (schema) {
        (schema && schema.properties ? schema.properties : []).forEach(function (f) {
          if ((f.type === 'select' || f.type === 'multi_select') && f.config && f.config.options) {
            S.options.events[f.name] = f.config.options;
          }
        });
      }).catch(function (err) { console.error('[database] 事件总线表结构加载失败:', err); });
    }

    /* 等两份表结构就绪后再填充下拉与表单 */
    setTimeout(function () {
      fillSelect($('tk_agent'), S.options.tasks['执行智能体'] || []);
      fillSelect($('tk_prio'), S.options.tasks['优先级'] || []);
      var pl = S.options.tasks['优先级'] || [];
      for (var i = 0; i < pl.length; i++) { if (pl[i].text === '中') { $('tk_prio').value = pl[i].id; break; } }
      if (pl.length && !$('tk_prio').value) { $('tk_prio').value = pl[0].id; }
      fillSelect($('evStatus'), S.options.events['处理状态'] || [], '全部处理状态');
      fillSelect($('tkStatus'), S.options.tasks['任务状态'] || [], '全部任务状态');
      bindFormCache();
      restoreForm();
      applyAgentParam();
      syncCapList();
      refreshAll();
    }, 600);

    $('tk_agent').addEventListener('change', syncCapList);
    $('tk_cap').addEventListener('input', function () {
      var sel = $('tk_agent');
      var txt = '';
      var opts = S.options.tasks['执行智能体'] || [];
      for (var i = 0; i < opts.length; i++) { if (opts[i].id === sel.value) { txt = opts[i].text; break; } }
      renderDispatchQuote(this.value, txt);
    });
    $('dispatchForm').addEventListener('submit', submitTask);
    $('tickBtn').addEventListener('click', tickCycle);
    $('fillBtn').addEventListener('click', fillExample);
    $('evPrev').addEventListener('click', function () { if (S.evPage > 1) { S.evPage -= 1; renderEvents(); } });
    $('evNext').addEventListener('click', function () { S.evPage += 1; renderEvents(); });
    $('evQ').addEventListener('input', function () { S.evQ = this.value; S.evPage = 1; renderEvents(); });
    $('evStatus').addEventListener('change', function () { S.evStatus = this.value; S.evPage = 1; renderEvents(); });
    $('evReload').addEventListener('click', function () { loadEvents(); });
    $('lgPrev').addEventListener('click', function () { if (S.lgPage > 1) { S.lgPage -= 1; renderLedger(); } });
    $('lgNext').addEventListener('click', function () { S.lgPage += 1; renderLedger(); });
    $('cyPrev').addEventListener('click', function () { if (S.cyPage > 1) { S.cyPage -= 1; renderCycles(); } });
    $('cyNext').addEventListener('click', function () { S.cyPage += 1; renderCycles(); });
    $('tkStatus').addEventListener('change', function () { S.tkStatus = this.value; renderTasks(); });

    if (wants('q', 'events')) {
      setInterval(function () { loadEvents(); }, 30000);
    }
    if (tkMsgEl.nodeType) { tkMsgEl.textContent = '就绪 · 可下发任务或推进周期'; }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
