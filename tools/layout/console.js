/* ==========================================================================
   Napell Coffee Chain OS · 运行控制台（总览版面实验）
   自包含数据层：每块面板只查自己需要的那张表 —— 面板与表的对应关系写在面板头上。
   沿用与 os.js 相同的 __SMART_PAGE__.database 契约，所以在资料库宿主与静态演示版下都能跑。
   ========================================================================== */
(function () {
  'use strict';

  /* ---------------- 数据接入 ----------------
     每张表一条 SDK 入口，且**每条 db.query / db.aggregate 调用体内都带字面量 databaseId**
     （静态校验要求，见 data-page-flow.md §1.5.5：调用处必须能直接看到 id，不能只靠变量）。
     表名 → id 的映射只在这里出现一次，避免十几处调用各自复制粘贴而走样。 */
  function rowsOf(res) { return (res && res.results) ? res.results : []; }
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

  var S = { agents: [], rail: {}, matrix: {}, stamps: [] };

  /* ---------------- 通用助手（与 os.js 同口径，保证视觉一致） ---------------- */
  function $(id) { return document.getElementById(id); }
  function setHTML(el, html) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    var range = document.createRange();
    range.selectNodeContents(el);
    el.appendChild(range.createContextualFragment(html));
  }
  function escapeHtml(v) {
    if (v === null || v === undefined) { return ''; }
    return String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var db = null;
  function SDK() { return window.__SMART_PAGE__ && window.__SMART_PAGE__.database; }
  function num(v) { return (v === null || v === undefined || v === '') ? null : Number(v); }
  function fmtInt(v) {
    var n = num(v);
    if (n === null || isNaN(n)) { return '—'; }
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtMoney(v) {
    var n = num(v);
    if (n === null || isNaN(n)) { return '¥—'; }
    var s = Math.abs(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))(?=\.)/g, ',');
    return (n < 0 ? '-¥' : '¥') + s;
  }
  function fmtTime(v) {
    if (!v) { return '—'; }
    var d = new Date(v);
    if (isNaN(d.getTime())) { return String(v); }
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }
  function fmtAgo(v) {
    if (!v) { return '—'; }
    var d = new Date(v);
    if (isNaN(d.getTime())) { return '—'; }
    var s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
    if (s < 60) { return s + ' 秒前'; }
    if (s < 3600) { return Math.round(s / 60) + ' 分钟前'; }
    if (s < 86400) { return Math.round(s / 3600) + ' 小时前'; }
    return Math.round(s / 86400) + ' 天前';
  }
  function stTag(v) {
    var k = String(v || ''), c = 'm';
    if (k === '已确认' || k === '已完成' || k === '在线' || k === '运行中') { c = 'g'; }
    else if (k === '已消费' || k === '执行中' || k === '忙碌') { c = 'b'; }
    else if (k === '重试中' || k === '待调度' || k === '中' || k === '高') { c = 'a'; }
    else if (k === '已失败' || k === '异常' || k === '紧急' || k === '降级') { c = 'r'; }
    return '<span class="st ' + c + '">' + escapeHtml(k || '—') + '</span>';
  }
  function pill(v) {
    var k = String(v || ''), cls = 'pill m';
    if (k.indexOf('在线') === 0) { cls = 'pill s-on'; }
    else if (k === '忙碌') { cls = 'pill s-busy'; }
    else if (k === '降级') { cls = 'pill s-deg'; }
    else if (k === '离线') { cls = 'pill s-off'; }
    return '<span class="' + cls + '"><span class="d"></span>' + escapeHtml(k || '—') + '</span>';
  }
  function empty(t) { return '<div class="empty">' + escapeHtml(t || '暂无数据') + '</div>'; }
  function errBox(host, msg) {
    setHTML(host, '<div class="errbox">数据加载失败：' + escapeHtml(msg || '请稍后重试') + '</div>');
  }
  function byName(rsp) {
    var out = {};
    ((rsp && rsp.results) || []).forEach(function (it) { out[it.name] = it.value; });
    return out;
  }
  function groupRows(arr, unit) {
    if (!arr || !arr.length) { return []; }
    return arr.map(function (g) {
      return { label: g.key, value: g.count, text: fmtInt(g.count) + ' ' + (unit || '条') };
    });
  }
  function bars(host, rows, opt) {
    opt = opt || {};
    if (!host) { return; }
    if (!rows.length) { setHTML(host, empty(opt.emptyText || '暂无数据')); return; }
    var max = 1;
    rows.forEach(function (r) { if (Math.abs(r.value) > max) { max = Math.abs(r.value); } });
    setHTML(host, '<div class="bars">' + rows.map(function (r) {
      var w = Math.max(2, Math.round(Math.abs(r.value) / max * 100));
      var cls = 'bar-fill' + (r.value < 0 ? ' neg' : (opt.pos ? ' pos' : ''));
      var txt = (r.text !== undefined) ? r.text : fmtInt(r.value);
      return '<div class="bar-row"><div class="bl" title="' + escapeHtml(r.label) + '">' + escapeHtml(r.label) + '</div>' +
        '<div class="bar-track"><div class="' + cls + '" style="width:' + w + '%"></div></div>' +
        '<div class="bv">' + escapeHtml(txt) + '</div></div>';
    }).join('') + '</div>');
  }
  function chips(host, rows) {
    if (!host) { return; }
    if (!rows.length) { setHTML(host, empty()); return; }
    setHTML(host, rows.map(function (r) {
      var txt = (r.text !== undefined) ? r.text : fmtInt(r.value);
      return '<span class="dchip">' + escapeHtml(r.label) + ' <b>' + escapeHtml(txt) + '</b></span>';
    }).join(''));
  }
  function meta(host, html) { if (host) { host.innerHTML = html; } }

  /* ---------------- 数据访问 ----------------
     具体 SDK 调用集中在文件顶部的 T 门面上（每条调用带字面量 databaseId）；
     这里只保留统一的错误兜底。 */
  function guard(hostId, work) {
    return work.catch(function (err) { errBox($(hostId), (err && err.message) || '请稍后重试'); });
  }

  /* ---------------- 渲染：01 业务板块矩阵 ---------------- */
  function renderMatrix() {
    var host = $('ckMatrix');
    if (!S.agents.length) { return; }
    var tk = (S.rail.tasks && S.rail.tasks.by_agent) || [];
    var ev = (S.rail.events && S.rail.events.by_src) || [];
    var tkMap = {}, evMap = {};
    tk.forEach(function (g) { tkMap[g.key] = g.count; });
    ev.forEach(function (g) { evMap[g.key] = g.count; });
    setHTML(host, S.agents.map(function (a) {
      var name = a['智能体名称'] || '';
      var href = 'sector.html?agent=' + encodeURIComponent(name);
      return '<a class="ck-cell" href="' + escapeHtml(href) + '">' +
        '<div class="t"><i>' + escapeHtml(a['图标'] || '🤖') + '</i>' + escapeHtml(name) + '</div>' +
        '<div class="k">' + escapeHtml(a['智能体编号'] || '') + ' · ' + escapeHtml(a['所属板块'] || '') + '</div>' +
        '<div class="rows">' +
        '<div><div class="mk">工单</div><div class="mv">' + fmtInt(tkMap[name] || 0) + '</div></div>' +
        '<div><div class="mk">事件</div><div class="mv">' + fmtInt(evMap[name] || 0) + '</div></div>' +
        '<div><div class="mk">信用分</div><div class="mv">' + fmtInt(a['信用积分']) + '</div></div>' +
        '</div></a>';
    }).join(''));
    meta($('ckMeta1'), '任务工单 ' + fmtInt((S.rail.tasks || {}).total) + ' 张 · 事件 ' + fmtInt((S.rail.events || {}).total) + ' 条 · 点格进板块页');
  }

  /* ---------------- 渲染：02 智能体舰队 ---------------- */
  function renderFleet() {
    var host = $('ckFleet');
    if (!S.agents.length) { setHTML(host, empty('暂无智能体数据')); return; }
    setHTML(host,
      '<table class="ck-tab"><thead><tr>' +
      '<th>智能体</th><th>状态</th><th class="num">调用</th><th class="num">收益</th><th>心跳</th><th></th>' +
      '</tr></thead><tbody>' + S.agents.map(function (a) {
        var name = a['智能体名称'] || '';
        return '<tr>' +
          '<td><span class="nm"><i>' + escapeHtml(a['图标'] || '🤖') + '</i>' + escapeHtml(name) + '</span>' +
          '<div class="path">' + escapeHtml(a['智能体编号'] || '') + ' · 能力 ' + escapeHtml(a['能力数'] || 0) + ' 项</div></td>' +
          '<td>' + pill(a['运行状态']) + '</td>' +
          '<td class="num">' + fmtInt(a['服务调用']) + '</td>' +
          '<td class="num">' + escapeHtml(fmtMoney(a['累计收益'])) + '</td>' +
          '<td class="path">' + escapeHtml(fmtAgo(a['最近心跳'])) + '</td>' +
          '<td class="go-col"><a href="' + escapeHtml('sector.html?agent=' + encodeURIComponent(name)) + '">板块页 →</a></td>' +
          '</tr>';
      }).join('') + '</tbody></table>');
    meta($('ckMeta2'), '智能体注册表 · ' + fmtInt(S.agents.length) + ' 体');
  }

  /* ---------------- 渲染：03 事件流 ---------------- */
  function renderEvents(rows) {
    var host = $('ckEvents');
    var st = (S.rail.events && S.rail.events.by_state) || [];
    if (!S.rail.events) { return; }
    if (rows) {
      if (!rows.length) {
        setHTML(host, empty('暂无事件'));
      } else {
        setHTML(host,
          '<table class="ck-tab"><thead><tr>' +
          '<th>事件主题</th><th>路径</th><th>状态</th><th class="num">耗时</th><th>时间</th></tr></thead><tbody>' +
          rows.map(function (r) {
            return '<tr>' +
              '<td><span class="nm" style="font-family:ui-monospace,Menlo,monospace;font-size:11px;color:var(--accent)">' + escapeHtml(r['事件主题']) + '</span></td>' +
              '<td class="path">' + escapeHtml(r['来源智能体']) + ' → ' + escapeHtml(r['目标智能体']) + '</td>' +
              '<td>' + stTag(r['处理状态']) + '</td>' +
              '<td class="num">' + fmtInt(r['耗时毫秒']) + ' ms</td>' +
              '<td class="path">' + escapeHtml(fmtTime(r['发生时间'])) + '</td>' +
              '</tr>';
          }).join('') + '</tbody></table>');
      }
    }
    chips($('ckEvChips'), groupRows(st, '条'));
    meta($('ckMeta3'), '事件总线 · 共 ' + fmtInt(S.rail.events.total) + ' 条 · 处理状态 ' + st.length + ' 种');
    stamp(rows && rows.length ? rows[0]['发生时间'] : null);
  }

  /* ---------------- 渲染：04 经济体（净收支 + 计量 + 计价角色） ---------------- */
  function renderEco() {
    var names = S.agents.map(function (a) { return a['智能体名称']; });
    var inMap = (S.rail.lgIn || {}), outMap = (S.rail.lgOut || {});

    /* 净收支：需要注册表 + 双向汇总同时在手 */
    if (names.length && S.rail.lgIn && S.rail.lgOut) {
      bars($('ckEcoNet'), names.map(function (n, i) {
        var v = (num(inMap['in_' + i]) || 0) - (num(outMap['out_' + i]) || 0);
        return { label: n, value: v, text: fmtMoney(v) };
      }).sort(function (a, b) { return b.value - a.value; }), { pos: true, emptyText: '暂无结算数据' });

      var totalIn = 0, totalOut = 0;
      names.forEach(function (n, i) {
        totalIn += (num(inMap['in_' + i]) || 0);
        totalOut += (num(outMap['out_' + i]) || 0);
      });
      meta($('ckMeta4'), '账本 ' + fmtInt((S.rail.meter || {}).total) + ' 笔 · 流入 ' +
        fmtMoney(totalIn) + ' / 流出 ' + fmtMoney(totalOut) + ' · 1 JBP = 0.1 CNY');
    }

    /* JEBI 计量口径：只需要账本汇总 */
    var m = S.rail.meter;
    if (m) {
      var jbp = Number(m.sum_jbp || 0), cost = Number(m.sum_cost || 0), goods = Number(m.sum_amount || 0);
      var fee = jbp / 10; /* 1 JBP = 0.1 CNY */
      setHTML($('ckMeter'), [
        ['结算笔数', fmtInt(m.total), '智能体账本'],
        ['计量成本', '¥' + cost.toFixed(2), '先计量后定价'],
        ['计费合计', fmtInt(jbp) + ' JBP', '≈ ¥' + fee.toFixed(2)],
        ['能力调用费率', (goods > 0 ? (fee / goods * 100).toFixed(2) : '0.00') + '%', '≠ 按交易额抽成']
      ].map(function (r) {
        return '<div class="c"><div class="k">' + escapeHtml(r[0]) + '</div>' +
          '<div class="v">' + escapeHtml(r[1]) + '</div>' +
          '<div class="ck-note" style="margin:3px 0 0">' + escapeHtml(r[2]) + '</div></div>';
      }).join(''));
    }
    chips($('ckRoles'), groupRows((S.rail.meterRole || []), '笔'));
  }

  /* ---------------- 渲染：05 结算流水 ---------------- */
  function renderLedger(rows) {
    var host = $('ckLedger');
    if (!rows || !rows.length) { setHTML(host, empty('暂无结算流水')); return; }
    setHTML(host,
      '<table class="ck-tab"><thead><tr>' +
      '<th>付款方 → 收款方</th><th>服务</th><th>角色</th><th class="num">金额</th><th class="num">计费JBP</th><th>时间</th>' +
      '</tr></thead><tbody>' + rows.map(function (r) {
        var jbp = Number(r['计费JBP'] || 0);
        return '<tr>' +
          '<td class="path" style="color:var(--text-dim)">' + escapeHtml(r['付款方']) + ' → ' + escapeHtml(r['收款方']) + '</td>' +
          '<td>' + escapeHtml(r['服务名称']) + '</td>' +
          '<td>' + stTag(r['计价角色']) + '</td>' +
          '<td class="num">' + escapeHtml(fmtMoney(r['金额'])) + '</td>' +
          '<td class="num">' + escapeHtml(jbp ? fmtInt(jbp) + ' JBP' : '0 JBP') + '</td>' +
          '<td class="path">' + escapeHtml(fmtTime(r['结算时间'])) + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>');
    meta($('ckMeta5'), '最近 ' + rows.length + ' 笔 / 共 ' + fmtInt((S.rail.meter || {}).total) + ' 笔');
    stamp(rows[0]['结算时间']);
  }

  /* ---------------- 渲染：06 24 小时时钟 ---------------- */
  function renderCycles(rows) {
    var list = (rows || []).slice().sort(function (a, b) {
      return new Date(a['开始时间'] || 0) - new Date(b['开始时间'] || 0);
    });
    var WINDOW = 24;
    if (list.length > WINDOW) { list = list.slice(list.length - WINDOW); }
    var max = 1;
    list.forEach(function (r) { var v = num(r['生豆产出kg']) || 0; if (v > max) { max = v; } });
    if (rows) {
      setHTML($('ckTimeline'), list.map(function (r) {
      var v = num(r['生豆产出kg']) || 0;
      var h = Math.max(5, Math.round(v / max * 100));
      var st = String(r['运行状态'] || '');
      var cls = 'tl-bar' + (st === '运行中' ? ' run' : (st === '异常' ? ' bad' : ''));
      var hr = String(r['开始时间'] || '');
      var hm = hr.indexOf('T') > -1 ? hr.split('T')[1].substring(0, 2) : '--';
      var tip = (r['周期编号'] || '') + ' · ' + fmtTime(r['开始时间']) + ' · 事件 ' + r['触发事件数'] +
        ' · 工单 ' + r['完成任务数'] + ' · 生豆 ' + v + 'kg · 碳减排 ' + r['碳减排kg'] + 'kg · ' + st;
      return '<div class="tl-col" title="' + escapeHtml(tip) + '"><div class="' + cls + '" style="height:' + h + '%"></div>' +
        '<div class="tl-lbl">' + escapeHtml(hm) + '</div></div>';
    }).join(''));
    setHTML($('ckAxis'), list.map(function () { return '<span>·</span>'; }).join(''));
    }

    var cy = S.rail.cy;
    if (cy) {
      setHTML($('ckCyStats'), [
        ['周期数', fmtInt(cy.total), '含人工触发'],
        ['周期内工单', fmtInt(cy.sum_tasks), '张'],
        ['周期内事件', fmtInt(cy.sum_events), '条'],
        ['生豆产出', (num(cy.sum_output) || 0).toFixed(1), 'kg（雾化水培）'],
        ['碳减排', (num(cy.sum_carbon) || 0).toFixed(1), 'kg CO₂e'],
        ['仓单融资', fmtMoney(cy.sum_finance), '（金融化）']
      ].map(function (r) {
        return '<div class="c"><div class="k">' + escapeHtml(r[0]) + '</div>' +
          '<div class="v">' + escapeHtml(r[1]) + '</div>' +
          '<div class="ck-note" style="margin:3px 0 0">' + escapeHtml(r[2]) + '</div></div>';
      }).join(''));
    }
    meta($('ckMeta6'), fmtInt(Math.min(list.length, WINDOW)) + ' 小时滚动窗口 · 全表 ' + fmtInt((S.rail.cy || {}).total) + ' 个周期');
    stamp(list.length ? list[list.length - 1]['开始时间'] : null);
  }

  /* ---------------- 渲染：页首仪表条 + 左轨 ---------------- */
  function renderStrip() {
    var r = S.rail;
    setHTML($('ckStrip'), [
      ['在册智能体', fmtInt(r.agents && r.agents.total), '覆盖九大板块'],
      ['全链事件', fmtInt(r.events && r.events.total), '条可追溯事件'],
      ['任务工单', fmtInt(r.tasks && r.tasks.total), '张（含人工）'],
      ['运行周期', fmtInt(r.cy && r.cy.total), '个时钟周期'],
      ['结算流水', fmtInt(r.meter && r.meter.total), '笔账本记录'],
      ['计费合计', fmtInt(r.meter && r.meter.sum_jbp) + ' JBP', '≈ ¥' + ((Number((r.meter || {}).sum_jbp) || 0) / 10).toFixed(2)]
    ].map(function (c) {
      return '<div class="c"><div class="ck-k">' + escapeHtml(c[0]) + '</div>' +
        '<div class="ck-v">' + escapeHtml(c[1]) + '</div>' +
        '<div class="ck-u">' + escapeHtml(c[2]) + '</div></div>';
    }).join(''));
  }

  function renderRail() {
    var r = S.rail;
    var st = r.agents && r.agents.by_status ? r.agents.by_status : [];
    var on = 0;
    st.forEach(function (g) { if (String(g.key).indexOf('在线') === 0) { on += g.count; } });
    var rows = [
      ['智能体', fmtInt(r.agents && r.agents.total), on ? ('在线 ' + on + ' 体') : ''],
      ['事件', fmtInt(r.events && r.events.total), ''],
      ['工单', fmtInt(r.tasks && r.tasks.total), ''],
      ['周期', fmtInt(r.cy && r.cy.total), ''],
      ['账本', fmtInt(r.meter && r.meter.total), ''],
      ['计费', fmtInt(r.meter && r.meter.sum_jbp) + ' JBP', '']
    ];
    setHTML($('ckRailKpi'), rows.map(function (x) {
      return '<div class="r"><span class="rk">' + escapeHtml(x[0]) + '</span>' +
        '<span class="rv">' + escapeHtml(x[1]) + '</span></div>' +
        (x[2] ? '<div class="r" style="padding:0 8px 4px"><span class="rv dim" style="margin-left:auto">' + escapeHtml(x[2]) + '</span></div>' : '');
    }).join(''));
    var counts = {
      ckNavC1: r.agents && r.agents.total,
      ckNavC2: r.agents && r.agents.total,
      ckNavC3: r.events && r.events.total,
      ckNavC4: r.meter && r.meter.total,
      ckNavC5: r.meter && r.meter.total,
      ckNavC6: r.cy && r.cy.total
    };
    Object.keys(counts).forEach(function (k) {
      var el = $(k);
      if (el && counts[k] !== undefined && counts[k] !== null) { el.textContent = fmtInt(counts[k]); }
    });
    renderStrip();
  }

  function stamp(t) {
    if (!t) { return; }
    var el = $('ckStamp');
    if (!el) { return; }
    var cur = el.getAttribute('data-ts');
    if (!cur || new Date(t) > new Date(cur)) {
      el.setAttribute('data-ts', t);
      el.innerHTML = '数据时间 <b style="color:var(--text-dim)">' + escapeHtml(fmtTime(t)) + '</b><br>' +
        escapeHtml(fmtAgo(t)) + ' · 自动任务每小时推进一个周期';
    }
  }

  /* ---------------- 左轨滚动联动 ---------------- */
  function spy() {
    var panels = [].slice.call(document.querySelectorAll('.ck-panel'));
    var links = [].slice.call(document.querySelectorAll('.ck-nav'));
    function update() {
      var line = window.scrollY + 140, active = panels.length ? panels[0].id : null;
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

    /* 1) 注册表 —— 舰队 / 矩阵 / 左轨 */
    guard('ckFleet', T.agents.query({ pageSize: 200, sorts: [{ property: '服务调用', direction: 'descending' }] })
      .then(function (rows) {
        S.agents = rows;
        renderFleet();
        renderMatrix();
        var names = rows.map(function (a) { return a['智能体名称']; });
        var inAgg = [{ name: 'total', type: 'count' }], outAgg = [];
        names.forEach(function (n, i) {
          inAgg.push({ name: 'in_' + i, type: 'sum', property: '金额', filter: { property: { property: '收款方', text: { equals: n } } } });
          outAgg.push({ name: 'out_' + i, type: 'sum', property: '金额', filter: { property: { property: '付款方', text: { equals: n } } } });
        });
        return Promise.all([T.ledger.agg(inAgg), T.ledger.agg(outAgg)]);
      })
      .then(function (r) {
        S.rail.lgIn = byName(r[0]);
        S.rail.lgOut = byName(r[1]);
        renderEco();
      }));

    /* 2) 注册表聚合（状态分布供左轨用） */
    guard('ckFleet', T.agents.agg([{ name: 'total', type: 'count' }, { name: 'by_status', type: 'count', groupBy: '运行状态' }])
      .then(function (rsp) { S.rail.agents = byName(rsp); renderRail(); }));

    /* 3) 任务工单 → 矩阵 / 页首 */
    guard('ckMatrix', T.tasks.agg([
      { name: 'total', type: 'count' },
      { name: 'by_state', type: 'count', groupBy: '任务状态' },
      { name: 'by_agent', type: 'count', groupBy: '执行智能体' }
    ]).then(function (rsp) { S.rail.tasks = byName(rsp); renderMatrix(); renderRail(); }));

    /* 4) 事件总线 → 分布 + 最近 8 条 */
    guard('ckEvents', T.events.agg([
      { name: 'total', type: 'count' },
      { name: 'by_state', type: 'count', groupBy: '处理状态' },
      { name: 'by_src', type: 'count', groupBy: '来源智能体' }
    ]).then(function (rsp) { S.rail.events = byName(rsp); renderEvents(null); renderMatrix(); renderRail(); }));

    guard('ckEvents', T.events.query({ pageSize: 8, sorts: [{ property: '发生时间', direction: 'descending' }] })
      .then(function (rows) { S.recentEvents = rows; renderEvents(rows); }));

    /* 5) 账本：计量汇总 + 计价角色 + 最近 6 笔 */
    guard('ckMeter', T.ledger.agg([
      { name: 'total', type: 'count' },
      { name: 'sum_amount', type: 'sum', property: '金额' },
      { name: 'sum_cost', type: 'sum', property: '计量成本' },
      { name: 'sum_jbp', type: 'sum', property: '计费JBP' }
    ]).then(function (rsp) { S.rail.meter = byName(rsp); renderEco(); renderRail(); }));

    guard('ckRoles', T.ledger.agg([
      { name: 'total', type: 'count' },
      { name: 'by_role', type: 'count', groupBy: '计价角色' }
    ]).then(function (rsp) { S.rail.meterRole = byName(rsp).by_role || []; renderEco(); }));

    guard('ckLedger', T.ledger.query({ pageSize: 6, sorts: [{ property: '结算时间', direction: 'descending' }] })
      .then(function (rows) { renderLedger(rows); }));

    /* 6) 运行周期：汇总 + 最近 24 个窗口 */
    guard('ckTimeline', T.cycles.agg([
      { name: 'total', type: 'count' },
      { name: 'sum_tasks', type: 'sum', property: '完成任务数' },
      { name: 'sum_events', type: 'sum', property: '触发事件数' },
      { name: 'sum_output', type: 'sum', property: '生豆产出kg' },
      { name: 'sum_carbon', type: 'sum', property: '碳减排kg' },
      { name: 'sum_receipt', type: 'sum', property: '仓单数' },
      { name: 'sum_finance', type: 'sum', property: '融资额' }
    ]).then(function (rsp) { S.rail.cy = byName(rsp); renderCycles(null); renderRail(); }));

    guard('ckTimeline', T.cycles.query({ pageSize: 24, sorts: [{ property: '开始时间', direction: 'descending' }] })
      .then(function (rows) { renderCycles(rows); }));

    if (!db) { errBox($('ckFleet'), '数据环境未就绪'); }
  }

  function boot() {
    var tries = 0;
    (function wait() {
      if (SDK()) { db = SDK(); run(); return; }
      if (++tries > 60) { errBox($('ckFleet'), '数据环境未就绪'); return; }
      setTimeout(wait, 200);
    })();
  }

  if (document.readyState === 'loading') { document.addEventListener('DOMContentLoaded', boot); }
  else { boot(); }
})();
