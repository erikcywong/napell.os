#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""构建 Napell Coffee Chain OS 多页站点（控制台版面系统）。

版面语言（统一）：
  左侧常驻状态轨 + 页首仪表条 + 12 栏带编号面板
  每块面板只读一张表，头部标明来源与条数，右上角进对应板块页。

产出（默认写到仓库根目录）：
  index.html      运行控制台（总览：状态轨 + 6 块编号面板）
  boards.html     经典网格视图（原总览：17 张入口卡 + 数据表台账）
  fleet.html dispatch.html bus.html board.html cycles.html economy.html kpi.html
  sector.html     九个业务板块各自的运行视图（?agent=<名>）
  assets/css/style.css      原设计样式（抽取自源页面 <style>）
  assets/css/console.css    控制台版面系统
  assets/js/os.js           原数据层（抽取自源页面 <script>）
  assets/js/console.js      控制台总览的数据层
  assets/js/rail.js         板块页的状态轨 / 仪表条
  favicon.svg
  [--gh] assets/js/snapshot.js · assets/js/shim.js · snapshot.json · .nojekyll

用法（在仓库根目录执行）：
  python tools/build_site.py                       → 仓库根（GitHub 版，注入浏览器内数据层）
  python tools/build_site.py --no-gh --out /tmp/site
                                                   → 资料库版（走宿主真实 SDK）
  PAGE_SRC=/path/to/agent-os.html python tools/build_site.py

源文件定位：`PAGE_SRC` 环境变量优先；否则从仓库根向上最多 4 层查找 `_build/agent-os.html`。
版面资产固定在 `tools/layout/`，与仓库同版本。
"""
import argparse, io, json, os, re, shutil, sys
from urllib.parse import quote

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LAYOUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "layout")


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

# 面板抬头里的「来源表」→ 对应板块页
TBL = {
    "agents": ("智能体注册表", "fleet.html",   "舰队页"),
    "tasks":  ("任务工单",     "board.html",   "工单看板"),
    "events": ("事件总线",     "bus.html",     "事件总线"),
    "ledger": ("智能体账本",   "economy.html", "经济体"),
    "cycles": ("运行周期",     "cycles.html",  "时钟页"),
    "all":    ("五张数据表",   "boards.html",  "全部"),
}

# 资料库数据表 id（与控制台数据层 / 状态轨共用）
TABLE_ID = {
    "agents": "cFRjJqhyp5LDaCZHPp3XVm",
    "events": "ND8kO27PEOFohwZHxm6WgV",
    "tasks":  "xQspxv5gupTBY8LeSHVv5L",
    "ledger": "dmRghisDSmokozzg8GMuwv",
    "cycles": "HZm1EBKdHUmqRMNIasCJfm",
}

# ── 面板规划 ──────────────────────────────────────────────────────────────
# (编号, 标题, 来源表, 栅格跨度, 消费的顶层块下标, 生成内容, 入口覆盖)
#   消费下标 = None   → 面板体由脚本生成（gen 给出占位 DOM，运行时填数）
#   入口覆盖 = None   → 由来源表自动推导（表 → 板块页）
PANELS = {
    "fleet": [
        ("01", "九体状态 · 心跳与信用积分", "agents", 12, [4, 5], None, ("dispatch.html", "派发任务 →")),
        ("02", "板块归属 · 九格矩阵",       "agents", 12, None,
         '<div class="ck-matrix" id="ckMatrix"><div class="loading">板块矩阵加载中…</div></div>',
         ("boards.html", "板块矩阵 →")),
    ],
    "dispatch": [
        ("01", "智能体任务派发台", "tasks", 7, [4], None, None),
        ("02", "本次写入的目标表", "tasks", 5, None,
         '<div class="ck-note">提交一次派发会同时落到三张表，并在「智能体账本」按 JEBI 口径计量计费。</div>\n'
         '        <div class="ck-links" id="ckLinks"><div class="loading">目标表加载中…</div></div>',
         ("economy.html", "计量口径 →")),
    ],
    "bus": [
        ("01", "全链事件流",           "events", 12, [4, 5, 6, 7], None, ("cycles.html", "时钟页 →")),
        ("02", "事件分布 · 来源与状态", "events", 12, [8, 9, 10],   None, ("kpi.html", "运行 KPI →")),
    ],
    "board": [
        ("01", "工单看板 · 可人工回执", "tasks", 12, [4, 5, 6], None, ("dispatch.html", "派发任务 →")),
        ("02", "按智能体的工单分布",    "tasks", 12, [7, 8],    None, ("kpi.html", "运行 KPI →")),
    ],
    "cycles": [
        ("01", "24 小时时钟推进", "cycles", 7,  [4],         None, ("kpi.html", "运行 KPI →")),
        ("02", "周期汇总",        "cycles", 5,  [5],         None, ("economy.html", "经济体 →")),
        ("03", "周期明细",        "cycles", 12, [6, 7, 8, 9], None, ("kpi.html", "运行 KPI →")),
    ],
    "economy": [
        ("01", "服务收支 · 按智能体",     "ledger", 5,  [4, 5],              None, ("kpi.html", "运行 KPI →")),
        ("02", "计量引擎 · 先计量后定价", "ledger", 7,  [6, 7, 8, 9, 10, 11], None, ("dispatch.html", "派发报价 →")),
        ("03", "近期结算流水",            "ledger", 12, [12, 13, 14, 15],    None, ("board.html", "工单看板 →")),
    ],
    "kpi": [
        ("01", "实测指标",          "cycles", 12, [4, 5], None, None),
        ("02", "全链飞轮与净收支",  "ledger", 12, [6],    None, None),
        ("03", "数据表台账",        "all",    12, [7],    None, None),
    ],
    "sector": [
        ("01", "板块档案",       "agents", 12, [4, 5, 6], None, None),
        ("02", "关键指标与调用能力", "agents", 12, [7, 8], None, None),
        ("03", "本板块工单",     "tasks",  12, [9, 10],  None, None),
        ("04", "本板块事件流",   "events", 12, [11, 12], None, None),
        ("05", "本板块结算流水", "ledger", 12, [13, 14], None, ("economy.html", "全部流水 →")),
    ],
}

# ── 页面副标（原版 lead 描述的是单文件滚动页，这里按一板块一页重写）────────
SUBS = {
    "fleet": "点任意智能体卡进入它的板块运行视图；本页只读「智能体注册表」，共两栏：状态与归属。",
    "dispatch": "一次提交同时写入任务工单、事件总线与智能体账本 —— 三表联动，按 JEBI 口径计量计费。",
    "bus": "每条事件都是数据总线上的真实记录；支持按处理状态过滤与主题搜索，游标翻页不丢数据。",
    "board": "点「标记完成」直接更新该工单记录（状态 / 完成时间 / 结果摘要），随后刷新列表。",
    "cycles": "每小时自动推进一个周期：采数据、跑工艺、上链存证、撮合交易、回流金融。柱高为该小时生豆产出（kg）。",
    "economy": "每一次跨智能体调用都会沉淀一条结算流水，形成内部经济体；计费口径见 02 面板。",
    "kpi": "以下数字全部由服务端聚合（count / sum / groupBy）算出，不是前端自算的。",
    "sector": "该板块的档案、能力、工单、事件与结算流水，全部按该板块过滤。",
}

# ── 页首仪表条（6 格）─────────────────────────────────────────────────────
# (标签, 指标键, 数字格式, 说明)
STRIPS = {
    "fleet": [
        ("在册智能体", "agents", "int", "覆盖九大板块"),
        ("在线运行",   "online", "int", "状态含「在线…」"),
        ("板块覆盖",   "blocks", "int", "个业务板块"),
        ("任务工单",   "tasks",  "int", "张（含人工）"),
        ("全链事件",   "events", "int", "条可追溯事件"),
        ("账本流水",   "ledger", "int", "笔结算记录"),
    ],
    "dispatch": [
        ("任务工单",   "tasks",       "int",   "张当前库存"),
        ("事件总线",   "events",      "int",   "条可追溯"),
        ("智能体账本", "ledger",      "int",   "笔结算记录"),
        ("计量成本",   "ledger_cost", "money", "先计量后定价"),
        ("计费合计",   "ledger_jbp",  "int",   "JBP · 1 JBP = 0.1 CNY"),
        ("运行周期",   "cycles",      "int",   "个时钟周期"),
    ],
    "bus": [
        ("全链事件",   "events",      "int", "条可追溯事件"),
        ("平均耗时",   "events_avg",  "int", "毫秒 / 事件"),
        ("已消费",     "es:已消费",    "int", "条已完成投递"),
        ("事件源",     "agents",      "int", "个智能体在发事件"),
        ("任务工单",   "tasks",       "int", "张（含人工）"),
        ("运行周期",   "cycles",      "int", "个时钟周期"),
    ],
    "board": [
        ("任务工单",   "tasks",       "int", "张（含人工）"),
        ("已完成",     "ts:已完成",    "int", "张已回执"),
        ("未完成",     "tasks_open",  "int", "张待跟进"),
        ("执行智能体", "agents",      "int", "个承接方"),
        ("关联事件",   "events",      "int", "条可追溯"),
        ("运行周期",   "cycles",      "int", "个时钟周期"),
    ],
    "cycles": [
        ("运行周期",   "cycles",      "int",    "个时钟周期"),
        ("周期内工单", "cy_tasks",    "int",    "张完成"),
        ("周期内事件", "cy_events",   "int",    "条触发"),
        ("生豆产出",   "cy_output",   "fixed1", "kg · 雾化水培"),
        ("碳减排",     "cy_carbon",   "fixed1", "kg CO₂e"),
        ("仓单融资",   "cy_finance",  "money",  "产业链金融化"),
    ],
    "economy": [
        ("账本记录",   "ledger",      "int",   "笔结算流水"),
        ("服务金额",   "ledger_amt",  "money", "智能体间结算总额"),
        ("计量成本",   "ledger_cost", "money", "真实用量成本"),
        ("计费合计",   "ledger_jbp",  "int",   "JBP · 1 JBP = 0.1 CNY"),
        ("计价角色",   "roles",       "int",   "种定价角色口径"),
        ("运行周期",   "cycles",      "int",   "个时钟周期"),
    ],
    "kpi": [
        ("在册智能体", "agents",     "int", "覆盖九大板块"),
        ("全链事件",   "events",     "int", "条可追溯事件"),
        ("任务工单",   "tasks",      "int", "张（含人工）"),
        ("运行周期",   "cycles",     "int", "个时钟周期"),
        ("结算流水",   "ledger",     "int", "笔账本记录"),
        ("计费合计",   "ledger_jbp", "int", "JBP · 1 JBP = 0.1 CNY"),
    ],
    "sector": [
        ("服务调用",   "a:服务调用", "int",   "次累计调用"),
        ("累计收益",   "a:累计收益", "money", "内部经济体结算"),
        ("信用积分",   "a:信用积分", "int",   "分"),
        ("可调用能力", "a:能力数",   "int",   "项服务"),
        ("运行状态",   "a:运行状态", "raw",   "实时心跳判定"),
        ("最近心跳",   "a:最近心跳", "ago",   "距上一次上报"),
    ],
}

# 面板体内需要左右分栏的组合：页 → {面板编号: 容器类}
PANEL_WRAP = {"bus": {"02": "ck-split two"}}

# 左轨分区条数 = 该分区来源表的记录数；以下分区不是「一整张表」，故留空
NAV_METRIC = {
    "dispatch": {"02": None},                          # 本次写入的目标表（跨三张表）
    "kpi": {"03": None},                               # 五张表台账
    "sector": {"03": None, "04": None, "05": None},    # 分板块过滤后的条数以页内统计卡为准
}

# ── 左轨「动作」───────────────────────────────────────────────────────────
ACTIONS = {
    "fleet":    [("dispatch.html", "派发任务", 1), ("bus.html", "事件总线", 0), ("kpi.html", "运行 KPI", 0)],
    "dispatch": [("board.html", "工单看板", 1), ("bus.html", "事件总线", 0), ("economy.html", "经济体", 0)],
    "bus":      [("board.html", "工单看板", 1), ("cycles.html", "24 小时时钟", 0), ("kpi.html", "运行 KPI", 0)],
    "board":    [("dispatch.html", "派发任务", 1), ("bus.html", "事件总线", 0), ("economy.html", "经济体", 0)],
    "cycles":   [("kpi.html", "运行 KPI", 1), ("bus.html", "事件总线", 0), ("economy.html", "经济体", 0)],
    "economy":  [("kpi.html", "运行 KPI", 1), ("board.html", "工单看板", 0), ("cycles.html", "24 小时时钟", 0)],
    "kpi":      [("economy.html", "经济体", 1), ("cycles.html", "24 小时时钟", 0), ("boards.html", "经典网格", 0)],
    "sector":   [("boards.html", "板块矩阵", 1), ("board.html", "本板块工单", 0), ("economy.html", "本板块流水", 0)],
}

CTA = {"fleet": ("dispatch.html", "派发任务"), "dispatch": ("board.html", "工单看板"),
       "bus": ("cycles.html", "时钟页"), "board": ("dispatch.html", "派发任务"),
       "cycles": ("kpi.html", "运行 KPI"), "economy": ("kpi.html", "运行 KPI"),
       "kpi": ("economy.html", "经济体"), "sector": ("boards.html", "板块矩阵")}

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

# 板块运行视图的正文（?agent=<名>）
SECTOR_BODY = """<section class="wrap" id="sector">
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

SECTIONS["sector"] = SECTOR_BODY

assert "<section" in SECTIONS["fleet"] and "</section>" in SECTIONS["kpi"]
assert "kpiAgents" in HERO
assert "function boot()" in SCRIPT

LAYOUT_FILES = {}
for _n in ("console.css", "console.html", "console.js", "rail.js"):
    LAYOUT_FILES[_n] = io.open(os.path.join(LAYOUT, _n), encoding="utf-8", newline="").read()

# ══════════════════════════════════════════════════════════════════
# HTML 顶层块切分（把板块页正文拆成可分组的面板体）
# ══════════════════════════════════════════════════════════════════
VOID_TAGS = set("area base br col embed hr img input link meta param source track wbr".split())
_TAG_RE = re.compile(r"<(/?)([a-zA-Z][\w:-]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*?)(/?)>", re.S)


def top_chunks(body):
    """返回 [(start, end, opening_tag)]，覆盖 body 的全部顶层元素。"""
    out, depth, start, opening = [], 0, None, None
    for m in _TAG_RE.finditer(body):
        closing, name, selfclose = m.group(1), m.group(2).lower(), m.group(4)
        if name in VOID_TAGS or selfclose:
            if depth == 0 and start is None:
                out.append((m.start(), m.end(), m.group(0)))
            continue
        if not closing:
            if depth == 0:
                start, opening = m.start(), m.group(0)
            depth += 1
        else:
            depth -= 1
            if depth == 0 and start is not None:
                out.append((start, m.end(), opening))
                start, opening = None, None
        if depth < 0:
            depth = 0
    return out


def section_body(key, html):
    i = html.index('<section class="wrap first"') if '<section class="wrap first"' in html \
        else html.index('<section class="wrap"')
    inner = html[html.index(">", i) + 1:]
    inner = inner[:inner.rindex("</section>")]
    return inner.strip("\n")


def split_eyebrow(eb):
    """把 eyebrow 拆成（纯文本, 是否带实时徽章的原样 span）。"""
    inner = eb[eb.index(">") + 1: eb.rindex("</div>")]
    m = re.search(r'<span class="sec-live">', inner)
    if not m:
        return inner.strip(), ""
    subs = top_chunks(inner[m.start():])
    live = inner[m.start() + subs[0][0]: m.start() + subs[0][1]]
    return inner[:m.start()].strip(), live


def flatten(chunk):
    """把面板体内的「卡中卡」压平，并去掉与面板抬头重复的标题。"""
    c = chunk
    c = re.sub(r'^<div class="card"[^>]*>', '<div class="ck-flat">', c, count=1)
    c = re.sub(r'^<div class="panel">', '<div class="ck-flat">', c, count=1)
    c = re.sub(r'^(<div class="ck-flat">)\s*<h3[^>]*>.*?</h3>', r"\1", c, count=1, flags=re.S)
    if 'class="lead"' in c[:140] and "padding:" not in c[:240]:
        c = c.replace('class="lead"', 'class="ck-note"', 1)
    return c


def unwrap_panel(chunk):
    """派发台：外层 .panel 与 .panel-head 去掉，只留表单主体（抬头复用面板头）。"""
    i = chunk.index('<div class="panel-body">') + len('<div class="panel-body">')
    body = chunk[i:]
    body = body[:body.rindex("</div>")]
    body = body[:body.rindex("</div>")]
    return body.strip("\n")


def indent(text, pad):
    return "\n".join((pad + ln) if ln.strip() else ln for ln in text.split("\n"))


def dedent(text):
    """去掉块内公共缩进，便于重新按面板层级排布。"""
    lines = [ln for ln in text.split("\n") if ln.strip()]
    if not lines:
        return text.strip("\n")
    pad = min(len(ln) - len(ln.lstrip()) for ln in lines)
    return "\n".join(ln[pad:] if ln.strip() else "" for ln in text.split("\n")).strip("\n")


# ══════════════════════════════════════════════════════════════════
# 导航 / 页脚
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
    L.append('      <a class="nav-link%s" href="boards.html">业务板块 <span class="chev">▼</span></a>'
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
      <a href="boards.html">经典网格</a>
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


# ══════════════════════════════════════════════════════════════════
# 控制台版面：外壳
# ══════════════════════════════════════════════════════════════════
SHELL_CK = """<!DOCTYPE html>
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
<link rel="stylesheet" href="assets/css/console.css">
</head>
<body class="ck" data-page="%(page)s">

%(nav)s

%(shell)s

%(footer)s

<!--EXTRA_SCRIPTS-->
%(rail_js)s
%(own_js)s
</body>
</html>
"""


def rail_block(sections, actions):
    """左侧常驻状态轨：系统状态 + 本页分区 + 动作。

    sections = [(编号, 标题, 指标键或 None)]，指标键为 None 时该区不显示条数。
    """
    idx = "\n".join(
        '      <a class="ck-nav" href="#z%d" data-ck-nav="z%d"><span class="n">%s</span>%s'
        '<span class="c"%s>—</span></a>'
        % (i + 1, i + 1, n, t, (' data-ck-count="%s"' % m) if m else "")
        for i, (n, t, m) in enumerate(sections))
    act = "\n".join('        <a class="btn%s ck-btn" href="%s">%s</a>'
                    % (" btn-primary" if pri else "", href, text)
                    for href, text, pri in actions)
    return """  <aside class="ck-rail">
    <div class="ck-rail-block">
      <div class="ck-rail-h">系统状态 <span class="live"><i></i>LIVE</span></div>
      <div class="ck-mini" id="ckRailKpi"><div class="loading">状态同步中…</div></div>
      <div class="ck-stamp" id="ckStamp">数据时间 同步中…</div>
    </div>

    <div class="ck-rail-block">
      <div class="ck-rail-h">本页分区</div>
%s
    </div>

    <div class="ck-rail-block">
      <div class="ck-rail-h">动作</div>
      <div class="ck-actions">
%s
      </div>
    </div>
  </aside>""" % (idx, act)


def strip_block(cells):
    out = []
    for label, key, fmt, unit in cells:
        out.append('        <div class="c"><div class="ck-k">%s</div>'
                   '<div class="ck-v" data-m="%s" data-fmt="%s">—</div>'
                   '<div class="ck-u">%s</div></div>'
                   % (label, key, fmt, unit))
    return '<div class="ck-strip" id="ckStrip">\n%s\n      </div>' % "\n".join(out)


def panel_html(idx, num, title, tbl, span, body, go, sticky=False):
    if go is None:
        info = TBL[tbl]
        go_html = '<a class="go" href="%s">%s →</a>' % (info[1], info[2])
    else:
        go_html = '<a class="go" href="%s">%s</a>' % go
    src_html = '<span class="src" data-tbl="%s">%s</span>' % (tbl, TBL[tbl][0])
    # database 绑定标注：面板体渲染的就是这张表的数据（见 data-page-flow.md §1.5.5）
    bind = "" if tbl == "all" else ' data-sp-bindable="database" data-sp-database-id="%s"' % TABLE_ID[tbl]
    cls = "ck-panel ck-sticky" if sticky else "ck-panel"
    return ('      <article class="%s" id="z%d" style="--span:%d">\n'
            '        <div class="ck-ph"><span class="n">%s</span><h2>%s</h2>%s%s</div>\n'
            '        <div class="ck-body"%s>\n%s\n        </div>\n'
            '      </article>'
            % (cls, idx, span, num, title, src_html, go_html, bind, indent(dedent(body), "          ")))


def ck_shell(key, crumb, h1, tag, lead, strip, panels, meta):
    return ('<div class="ck-shell">\n\n%s\n\n  <main class="ck-main">\n\n'
            '    <div class="ck-head">\n      %s\n'
            '      <h1 class="ck-h1">%s <span>%s</span></h1>\n'
            '      <p class="ck-sub">%s</p>\n      %s\n'
            '    </div>\n\n    <div class="ck-grid">\n\n%s\n\n    </div>\n\n'
            '  </main>\n</div>'
            % (rail_block(meta, ACTIONS[key]), crumb, h1, tag, lead, strip,
               "\n\n".join(panels)))


def crumb(active):
    if active == "sector":
        return ('<div class="crumb"><a href="index.html">总览</a><span>·</span>'
                '<a href="boards.html">业务板块</a><span>·</span>'
                '<span style="color:var(--text-dim)">板块运行视图</span></div>')
    b = BY_KEY[active]
    g = [x for x in GROUPS if x["key"] == b["group"]][0]
    return ('<div class="crumb"><a href="index.html">总览</a><span>·</span>'
            '<a href="%s">%s</a><span>·</span>'
            '<span style="color:var(--text-dim)">%s</span></div>' % (g["file"], g["name"], b["title"]))


def board_page(key):
    """把板块页正文重排成「状态轨 + 仪表条 + 编号面板」。"""
    html = SECTIONS[key]
    if key == "dispatch":                       # 写入回执容器（原 board_main 注入）
        html = html.replace("</form>", '</form>\n      <div id="receipt" hidden></div>', 1)
        assert 'id="receipt"' in html
    body = crumb(key) + "\n  " + section_body(key, html)
    chunks = top_chunks(body)
    texts = [body[a:b] for a, b, _ in chunks]
    opens = [op for _, _, op in chunks]

    assert opens[0].startswith('<div class="crumb"'), opens[0]
    assert opens[1].startswith('<div class="eyebrow"'), opens[1]
    assert opens[2].startswith("<h2>"), opens[2]
    assert opens[3].startswith('<p class="lead"'), opens[3]

    crumb_html = texts[0]
    eb_text, eb_live = split_eyebrow(texts[1])
    h1 = re.sub(r"<[^>]+>", "", texts[2][4:-5]).strip()
    lead = SUBS[key]
    tag = eb_text + ((" " + eb_live) if eb_live else "")

    panels, meta = [], []
    for i, (num, title, tbl, span, take, gen, go) in enumerate(PANELS[key]):
        if take is None:
            inner = gen
        else:
            parts = []
            for j in take:
                assert j < len(texts), "%s 第 %d 块越界（共 %d 块）" % (key, j, len(texts))
                op = opens[j]
                if op.startswith("<h3"):
                    continue                      # 标题已升为面板抬头
                if op.startswith('<div class="panel">'):
                    parts.append(unwrap_panel(texts[j]))
                else:
                    parts.append(flatten(texts[j]))
            inner = "\n".join(parts)
            wrap = PANEL_WRAP.get(key, {}).get(num)
            if wrap:
                inner = '<div class="%s">\n%s\n          </div>' % (wrap, indent(inner, "  "))
        panels.append(panel_html(i + 1, num, title, tbl, span, inner, go))
        nav_m = NAV_METRIC.get(key, {}).get(num, tbl)
        meta.append((num, title, nav_m))

    used = set()
    for _, _, _, _, take, _, _ in PANELS[key]:
        if take:
            used.update(take)
    leftover = [i for i in range(4, len(texts)) if i not in used]
    assert not leftover, "%s 有未归入面板的块：%s" % (key, leftover)

    return ck_shell(key, crumb_html, h1, tag, lead, strip_block(STRIPS[key]), panels, meta)


# ══════════════════════════════════════════════════════════════════
# 经典网格视图（原总览，保留为 boards.html）
# ══════════════════════════════════════════════════════════════════
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
  <p class="lead">滚动长页已经拆开：每个板块有自己的地址、自己的数据读取范围。导航栏悬停即可跨板块跳转，浏览器前进后退也能正常工作。</p>
  <div class="board-grid" data-sp-bindable="database" data-sp-database-id="cFRjJqhyp5LDaCZHPp3XVm">
%s
  </div>

  <h3 style="margin-top:42px">九个业务板块 · 一个智能体一页</h3>
  <p class="lead">产业链上的九个板块各有一个智能体。点开任意板块，进入它自己的运行视图（档案 / 能力 / 工单 / 事件 / 结算）。</p>
  <div class="board-grid" data-sp-bindable="database" data-sp-database-id="cFRjJqhyp5LDaCZHPp3XVm">
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
    <div class="tw" data-sp-bindable="database" data-sp-database-id="cFRjJqhyp5LDaCZHPp3XVm">
      <table>
        <thead><tr><th>数据表</th><th>用途</th><th class="num">记录数</th><th>状态</th></tr></thead>
        <tbody id="tblBody"><tr><td colspan="4"><div class="loading">台账加载中…</div></td></tr></tbody>
      </table>
    </div>
  </div>
</section>""" % (cards, sects)


SHELL_PLAIN = """<!DOCTYPE html>
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
<body data-page="index">

%(nav)s

%(main)s

%(footer)s

<!--EXTRA_SCRIPTS-->
<script src="assets/js/os.js" defer></script>
</body>
</html>
"""

# ══════════════════════════════════════════════════════════════════
# GitHub 版：浏览器内数据层
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


def console_page():
    return LAYOUT_FILES["console.html"]


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
    if args.gh:
        snap = json.load(io.open(args.snapshot, encoding="utf-8"))
        snap_json = json.dumps(snap, ensure_ascii=False, separators=(",", ":"))

    stale_files = [b["file"] for b in BOARDS] + ["sector.html", "boards.html", "cockpit.html"]
    stale_dirs = ["assets", ".nojekyll", "snapshot.json"]
    if os.path.isdir(out):
        if os.path.isdir(os.path.join(out, ".git")):
            # 仓库工作副本：只清理本轮产物，保留 .git / tools/ / README.md / western/
            for name in stale_files:
                p = os.path.join(out, name)
                if os.path.isfile(p):
                    os.remove(p)
            for name in stale_dirs:
                p = os.path.join(out, name)
                if os.path.isdir(p):
                    shutil.rmtree(p)
                elif os.path.isfile(p):
                    os.remove(p)
        else:
            shutil.rmtree(out)

    write(os.path.join(out, "assets", "css", "style.css"), CSS + "\n")
    write(os.path.join(out, "assets", "css", "console.css"), LAYOUT_FILES["console.css"])
    write(os.path.join(out, "assets", "js", "os.js"), SCRIPT + "\n")
    write(os.path.join(out, "assets", "js", "console.js"), LAYOUT_FILES["console.js"])
    write(os.path.join(out, "assets", "js", "rail.js"), LAYOUT_FILES["rail.js"])
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

    # 1) 运行控制台（总览）
    page = SHELL_CK % dict(
        title="运行控制台 · Napell Coffee Chain OS",
        desc="Napell 咖啡全产业链智能体运行控制系统 · 运行控制台总览：板块矩阵、舰队状态、事件流、经济体与 24 小时周期，一屏一逻辑。",
        board="运行控制台",
        page="cockpit",
        nav=nav("index"),
        shell=console_page(),
        footer=FOOTER,
        rail_js='',
        own_js='<script src="assets/js/console.js" defer></script>',
    )
    page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
    write(os.path.join(out, "index.html"), page)
    made.append("index.html")

    # 2) 经典网格视图
    page = SHELL_PLAIN % dict(
        title="经典网格视图 · Napell Coffee Chain OS",
        desc="Napell 咖啡全产业链 9 大智能体运行控制系统的经典网格视图：17 张入口卡 + 数据表台账。",
        board="经典网格视图",
        nav=nav("index"),
        main=index_main(),
        footer=FOOTER,
    )
    page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
    write(os.path.join(out, "boards.html"), page)
    made.append("boards.html")

    # 3) 八个板块页（控制台版面）
    for b in BOARDS:
        key = b["key"]
        if key == "index":
            continue
        shell = board_page(key)
        page = SHELL_CK % dict(
            title="%s · Napell Coffee Chain OS" % b["title"],
            desc="Napell 咖啡全产业链 9 大智能体运行控制系统：%s。" % b["desc"],
            board=b["title"],
            page=key,
            nav=nav(key),
            shell=shell,
            footer=FOOTER,
        rail_js='<script src="assets/js/rail.js" defer></script>',
        own_js='<script src="assets/js/os.js" defer></script>',
        )
        page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
        write(os.path.join(out, b["file"]), page)
        made.append(b["file"])

    # 4) 板块运行视图（?agent=<名>）
    page = SHELL_CK % dict(
        title="板块运行视图 · Napell Coffee Chain OS",
        desc="Napell 咖啡全产业链九个业务板块，每个板块一页：档案、能力、工单、事件与结算流水。",
        board="板块运行视图",
        page="sector",
        nav=nav("sector"),
        shell=board_page("sector"),
        footer=FOOTER,
        rail_js='<script src="assets/js/rail.js" defer></script>',
        own_js='<script src="assets/js/os.js" defer></script>',
    )
    page = page.replace("<!--EXTRA_SCRIPTS-->", extra)
    write(os.path.join(out, "sector.html"), page)
    made.append("sector.html")

    print("out:", out, " gh =", args.gh)
    for f in made:
        print("   %-14s %6d bytes" % (f, os.path.getsize(os.path.join(out, f))))
    for f in ("css/style.css", "css/console.css", "js/os.js", "js/console.js", "js/rail.js"):
        print("   %-14s %6d bytes" % (f, os.path.getsize(os.path.join(out, "assets", f))))
    if args.gh:
        print("   %-14s %6d bytes" % ("js/snapshot.js",
                                      os.path.getsize(os.path.join(out, "assets/js/snapshot.js"))))


if __name__ == "__main__":
    main()
