# Napell Coffee Chain OS

**Napell 咖啡全产业链智能体运行控制系统** — 9 大智能体协同的咖啡产业链操作系统控制台：事件总线、任务调度、经济体结算与 24 小时时钟周期。

Interactive control plane for a 9-agent coffee supply-chain operating system: event bus, task dispatch, inter-agent settlement ledger, and a rolling 24-hour clock cycle.

**每个业务板块一个独立页面**（不再是单页滚动长页）：**10 个页面** + 共享 `assets/`，纯静态、无构建步骤、无外部依赖。

**统一版面语言 —— 「状态轨 + 编号面板」**：总览页是一台**运行控制台**（左侧常驻状态轨 + 页首仪表条 + 6 块编号面板），其余每个板块页也用同一套骨架（常驻状态轨 / 带编号的面板 / 面板抬头标明来源表与条数、右上角直达对应板块页）。目的是**按逻辑分区**而不是像读书一样从上往下翻。

---

## Live

| 形态 | 链接 | 说明 |
|---|---|---|
| 静态演示版（本仓库） | https://erikcywong.github.io/napell.os/ | 内嵌真实数据快照，全部交互在浏览器本地生效 |
| 在线协作版（WorkBuddy 资料库） | https://www.workbuddy.cn/space/d/znE2WbdN9A3HrogSzHliaR | 连真实数据库，写入会持久化到云端 |

> 两者的**页面代码同源**（同一份 `assets/js/os.js`，版面层同 `console.js` / `rail.js`）。资料库版使用宿主注入的 `__SMART_PAGE__.database` SDK；本仓库版在检测不到该 SDK 时，自动加载一份浏览器内实现（同形契约），因此静态站点上依然是**可读可写**的，而不是一张截图。

## Pages

| 页面 | 板块 | 面板 | 能力 |
|---|---|---|---|
| `index.html` | 🧭 运行控制台 | 6 | **总览 = 控制台**：左轨系统状态 + 分区索引（滚动高亮）+ 动作；页首 6 格仪表条；`01 板块矩阵`（9 格，点格进板块页）/ `02 舰队` / `03 事件流` / `04 经济体` / `05 结算流水` / `06 24 小时周期` |
| `boards.html` | 🗂️ 经典网格视图 | — | 归档的总览形态：4 张总览卡 + 17 张入口卡（8 板块 + 9 智能体）+ 环境配置表 |
| `fleet.html` | 🤖 智能体舰队 | 2 | 9 个智能体的状态 / 能力数 / 调用量 / 信用积分 / 累计收益，心跳显示为「x 分钟前」 |
| `dispatch.html` | 🎛️ 任务派发 | 2 | 下发工单 → 写入任务表并同步广播一条事件（含草稿本地缓存）+ 实时计量报价 + 3 张目标表的实时计数 |
| `bus.html` | 📡 事件总线 | 2 | 全链事件流 + 按处理状态 / 来源智能体分布，30 秒自动刷新 |
| `board.html` | 🗂️ 工单看板 | 2 | 工单看板，「标记完成」回执并补发事件，按执行智能体聚合统计 |
| `cycles.html` | 🕒 24 小时时钟 | 3 | 24 根逐小时柱（生豆产出 / 碳减排 / 融资 / IP / 门店收入），可下钻单周期详情 |
| `economy.html` | 💠 智能体经济体 | 3 | 收 / 支 / 净额 + 账本流水（分页）+ 结算类型分布 + **JEBI 计量引擎面板** |
| `kpi.html` | 📊 运行 KPI | 3 | 聚合驱动的产业链 KPI 卡片与飞轮条，台账面板标注「5 张表合计 N 行」 |
| `sector.html?agent=<名>` | 🏭 板块运行视图 | 5 | **九个板块各自的独立页面**：档案 / 能力 / 工单 / 事件 / 结算流水 / 6 张统计卡，全部按该板块过滤 |

`fleet` 页点任意智能体卡、或导航「业务板块」下拉里的任意条目，都会进入 `sector.html?agent=…`。

## Metering engine (JEBI fusion)

Following **meter first, price second** — same spec as [coffeeos.space](https://www.coffeeos.space/architecture.html):

`计费JBP = ceil(max(计量成本 × 倍率, 下限))`, with `1 JBP = 0.1 CNY`.

| 计价角色 | 倍率 | 下限 | Source |
|---|---|---|---|
| B端加盟商 | ×5 | 50 JBP (¥5) | JEBI, verbatim |
| C端订阅 | ×0 | — | JEBI — cost sits inside the subscription |
| C端即用即付 | ×3 | 10 JBP (¥1) | JEBI, verbatim |
| 平台内部 | ×1 | 0 | fusion extension — internal calls settle at cost |

`智能体账本` carries `计量成本` (metered cost in CNY) / `计价角色` (pricing track) / `计费JBP` (charged points)
alongside the pre-existing `金额` (service settlement value in CNY). Dispatching a task from the console
meters it and writes one ledger entry, so the economy settles on every user action.

> **Two 口径, deliberately:** `金额` is the service's business settlement value; `计费JBP × 0.1` is the
> platform's per-call capability fee. JEBI charges **per call**, not a percentage of the transaction —
> which is why the two don't track each other.

The engine is implemented twice from one spec, and must stay in lockstep:
`_meter/jebi_meter.py` (Python, batch/backfill) and the inline `ROLE_PRICING` / `quoteByCost` block in the page
(browser, live quotes).

## Data model

5 tables. Seeded baselines below; the hourly task keeps growing them (the UI always reads live counts).

| Table | Database ID | 基线行数 | Role |
|---|---|---|---|
| 智能体注册表 | `cFRjJqhyp5LDaCZHPp3XVm` | 9 | agent registry, heartbeat, credits |
| 事件总线 | `ND8kO27PEOFohwZHxm6WgV` | 288 | inter-agent event log (12 topics/hour) |
| 任务工单 | `xQspxv5gupTBY8LeSHVv5L` | 61 | task tickets + completion |
| 智能体账本 | `dmRghisDSmokozzg8GMuwv` | 55 | service settlement ledger + **metering fields** |
| 运行周期 | `HZm1EBKdHUmqRMNIasCJfm` | 24 | hourly clock cycles + yield/carbon/finance |

Event topic vocabulary:

```
iot.carbon_measured   carbon.minted        carbon.retired      carbon.traded
chain.demand_signal   vault.stock_alert    aerogrow.planting_order
process.lot_ready     roastcurve.published roastcurve.licensed
reits.underwriting    nexus.sync
```

## 24-hour autonomy

A scheduled task advances the system once an hour: it appends
`运行周期 ×1`, `事件总线 ×12`, `任务工单 ×2–3`, `账本 ×2–3`, and refreshes all 9 agent heartbeats —
so the cockpit always reads live, growing data rather than a frozen snapshot.

## Page scoping (how one shared script serves 10 pages)

`assets/js/os.js` is one file shared by all pages. Each page declares its own scope with
`<body data-page="fleet">`; the script then reads a `SCOPES` table mapping page → which queries to run and
which aggregate groups to fetch. Everything not in scope is skipped (its `getElementById` misses are
absorbed by a no-op sentinel element), so no page fetches data it doesn't render and no page errors on
missing DOM. `sector.html?agent=<名>` reads the `agent` query parameter and filters tasks / events / ledger
by that agent.

The same `os.js` also runs the original single-file mode unchanged when `data-page` is absent.

### Two data layers, no overlap

| 文件 | 负责 | 覆盖面 |
|---|---|---|
| `assets/js/os.js` | 页面**业务内容**（表格、图表、表单、分页） | 所有板块页 + `boards.html` |
| `assets/js/console.js` | 总览控制台的状态轨 / 仪表条 / 6 块面板 | 仅 `index.html` |
| `assets/js/rail.js` | 板块页的状态轨 / 仪表条 / 矩阵 / 面板抬头计数 | 8 个板块页 + `sector.html` |

三者走同一个 `__SMART_PAGE__.database` 契约。`index.html` 只加载 `console.js`，其余页只加载
`rail.js`（+ `os.js`），两者都会写 `#ckRailKpi` / `#ckStamp`，所以**不能同时加载**。

## Static demo mode

On this repo, `assets/js/shim.js` installs an in-browser implementation of the same
`__SMART_PAGE__.database` contract (`query` with cursor pagination, `aggregate` with `groupBy` +
per-item `filter`, `addRecord`, `updateRecord`, `getSchema`) backed by `assets/js/snapshot.js`,
persisting writes to `localStorage`. It yields to the real SDK whenever one is present.

A bottom-left chip shows the snapshot timestamp and offers **重置数据** to restore the baseline.

## Rebuild

```bash
# 0. 前置：工作区里的 _build/agent-os.html 是多页构建的源文件
#    （可用 PAGE_SRC=/abs/path/agent-os.html 覆盖；否则从仓库根向上最多 4 层查找）

# 1. 从线上 5 张表刷新数据快照
python tools/fetch_snapshot.py

# 2. 生成 10 个页面 + assets/（直接写入仓库根目录）
python tools/build_site.py

#    资料库版（不注入浏览器数据层，走宿主真实 SDK）：
python tools/build_site.py --no-gh --out ../libsite
```

`tools/build_site.py` 从同一份源页面拆出 CSS / 数据层 / 各板块 DOM，再套上统一外壳与导航；
两个形态共用同一份 `os.js`，因此不会互相走偏。

版面系统的可调参数都在 `tools/build_site.py` 顶部：

| 名称 | 作用 |
|---|---|
| `PANELS[page]` | 每页面板分配表 `(编号, 标题, 来源表, 栅格跨度, 取哪几段, 占位 DOM, 入口链接)` |
| `NAV_METRIC` | 状态轨「本页分区」每项后面的实时计数取哪个指标 |
| `PANEL_WRAP` | 某块面板的正文是否再切成 `ck-split` 两栏 |
| `TABLE_ID` | 5 张资料库表的 id 字面量（面板抬头与绑定标注共用） |
| `SUBS` | 每页一句话副标题（替代长页时代的整段导语） |

共享版面文件在 `tools/layout/`：`console.css`（骨架样式）、`console.html`（总览 6 块面板的 DOM 片段）、
`console.js`（总览数据层）、`rail.js`（板块页状态轨）。样式变量仍沿用 `assets/css/style.css` 的深色体系。

## Stack

Multi-page static site. Shared `assets/css/style.css` + `assets/css/console.css` + `assets/js/os.js`
(+ `console.js` / `rail.js`). Vanilla ES5
JavaScript, no framework, no bundler, no external requests.
Dark theme (`#000` background, `#1d9bf0` accent), dashboard-style data presentation.

## 视觉方案预览 · "Institutional"（西方商业化模板）

`/western/` 是同一套 9 页 + 同一份数据的**换肤预览**：纸面底色、墨色文字、深松绿 + 古铜双色、细 hairline 分隔、等宽小标签、直角几何。导航右上角可在纸面版 / 深色版之间切换（选择存在 localStorage）。样式完全独立于默认皮肤（`western/assets/css/western.css`），确认采用后可直接替换根目录 `assets/css/style.css`。

重建：`python tools/build_western.py --src . --out western --gh`（源脚本在工作区 `_build/build_western.py`）。

## 版面系统 · 「状态轨 + 编号面板」（已采用）

同一个深色设计，但版面**按逻辑分区**而不是"读书"顺序：

- **左侧常驻状态轨**：系统状态（智能体 / 事件 / 工单 / 周期 / 账本笔数与 JBP 合计，带**数据时间**戳）+ 本页分区索引（滚动高亮）+ 动作区（含「经典网格视图」入口）。
- **页首仪表条**：6 格关键实时数，一屏看到全局口径。
- **编号面板**：每页正文拆成 `01…0N` 编号面板；面板抬头标明**来源表 + 条数**，右上角直达对应板块页；每块面板只读它自己需要的那张表。

`index.html` = 运行控制台（6 块面板）；`boards.html` 保留为归档的**经典网格视图**（总览卡 + 入口卡），
导航「总览」指向控制台、控制台动作区与页脚都指向经典网格视图，所以两种形态都没丢。

`cockpit.html` 是这套版面的**早期单页实验**，已由控制台总览取代并从仓库移除。

回归验证：`node _gh/verify_pages.cjs`（118 项断言，覆盖状态轨 / 仪表条 / 编号面板 / 跨页跳转 / 写入生效 / 无 JS 报错 / 窄屏）。
静态契约校验：`lint_database_sdk_usage.py`（10 页全 `MINDX_DBSDK_LINT_OK`）+ `lint_page_quality.py`（10 页全 `MINDX_PAGE_QUALITY_OK`）。

> 每张表的 SDK 入口集中在 `console.js` / `rail.js` 顶部的 `T` 门面，**每条 `db.query` / `db.aggregate` 调用体内都带字面量 `databaseId`**（静态校验要求，见 `data-page-flow.md` §1.5.5）。
