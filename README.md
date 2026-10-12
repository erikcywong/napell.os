# Napell Coffee Chain OS

**Napell 咖啡全产业链智能体运行控制系统** — 9 大智能体协同的咖啡产业链操作系统控制台：事件总线、任务调度、经济体结算与 24 小时时钟周期。

Interactive control plane for a 9-agent coffee supply-chain operating system: event bus, task dispatch, inter-agent settlement ledger, and a rolling 24-hour clock cycle.

**每个业务板块一个独立页面**（不再是单页滚动长页）：9 个页面 + 共享 `assets/`，纯静态、无构建步骤、无外部依赖。

---

## Live

| 形态 | 链接 | 说明 |
|---|---|---|
| 静态演示版（本仓库） | https://erikcywong.github.io/napell.os/ | 内嵌真实数据快照，全部交互在浏览器本地生效 |
| 在线协作版（WorkBuddy 资料库） | https://www.workbuddy.cn/space/d/znE2WbdN9A3HrogSzHliaR | 连真实数据库，写入会持久化到云端 |

> 两者的**页面代码同源**（同一份 `assets/js/os.js`）。资料库版使用宿主注入的 `__SMART_PAGE__.database` SDK；本仓库版在检测不到该 SDK 时，自动加载一份浏览器内实现（同形契约），因此静态站点上依然是**可读可写**的，而不是一张截图。

## Pages

| 页面 | 板块 | 能力 |
|---|---|---|
| `index.html` | 🧭 总览 | 4 张总览卡 + 17 张入口卡（8 个板块 + 9 个智能体）+ 环境配置表 |
| `fleet.html` | 🤖 智能体舰队 | 9 个智能体的状态 / 能力数 / 调用量 / 信用积分 / 累计收益，心跳显示为「x 分钟前」 |
| `dispatch.html` | 🎛️ 任务派发 | 下发工单 → 写入任务表并同步广播一条事件（含草稿本地缓存）+ 实时计量报价 |
| `bus.html` | 📡 事件总线 | 全链事件流 + 按处理状态 / 来源智能体分布，30 秒自动刷新 |
| `board.html` | 🗂️ 工单看板 | 工单看板，「标记完成」回执并补发事件，按执行智能体聚合统计 |
| `cycles.html` | 🕒 24 小时时钟 | 24 根逐小时柱（生豆产出 / 碳减排 / 融资 / IP / 门店收入），可下钻单周期详情 |
| `economy.html` | 💠 智能体经济体 | 收 / 支 / 净额 + 账本流水（分页）+ 结算类型分布 + **JEBI 计量引擎面板** |
| `kpi.html` | 📊 运行 KPI | 聚合驱动的产业链 KPI 卡片与飞轮条 |
| `sector.html?agent=<名>` | 🏭 板块运行视图 | **九个板块各自的独立页面**：档案 / 能力 / 工单 / 事件 / 结算流水 / 6 张统计卡，全部按该板块过滤 |

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

5 tables, 437 rows of seeded data (24 hours × 12 event topics).

| Table | Database ID | Rows | Role |
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

## Page scoping (how one shared script serves 9 pages)

`assets/js/os.js` is one file shared by all pages. Each page declares its own scope with
`<body data-page="fleet">`; the script then reads a `SCOPES` table mapping page → which queries to run and
which aggregate groups to fetch. Everything not in scope is skipped (its `getElementById` misses are
absorbed by a no-op sentinel element), so no page fetches data it doesn't render and no page errors on
missing DOM. `sector.html?agent=<名>` reads the `agent` query parameter and filters tasks / events / ledger
by that agent.

The same `os.js` also runs the original single-file mode unchanged when `data-page` is absent.

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

# 2. 生成 9 个页面 + assets/（直接写入仓库根目录）
python tools/build_site.py

#    资料库版（不注入浏览器数据层，走宿主真实 SDK）：
python tools/build_site.py --no-gh --out ../libsite
```

`tools/build_site.py` 从同一份源页面拆出 CSS / 数据层 / 各板块 DOM，再套上统一外壳与导航；
两个形态共用同一份 `os.js`，因此不会互相走偏。

## Stack

Multi-page static site. Shared `assets/css/style.css` + `assets/js/os.js`. Vanilla ES5
JavaScript, no framework, no bundler, no external requests.
Dark theme (`#000` background, `#1d9bf0` accent), dashboard-style data presentation.

## 视觉方案预览 · "Institutional"（西方商业化模板）

`/western/` 是同一套 9 页 + 同一份数据的**换肤预览**：纸面底色、墨色文字、深松绿 + 古铜双色、细 hairline 分隔、等宽小标签、直角几何。导航右上角可在纸面版 / 深色版之间切换（选择存在 localStorage）。样式完全独立于默认皮肤（`western/assets/css/western.css`），确认采用后可直接替换根目录 `assets/css/style.css`。

重建：`python tools/build_western.py --src . --out western --gh`（源脚本在工作区 `_build/build_western.py`）。

## 版面实验 · 运行控制台（`cockpit.html`）

同一个深色设计，总览页换成**控制台逻辑**而不是"读书"顺序：左侧常驻状态轨（系统状态 + 分区索引 + 动作）、页首仪表条、6 块带编号面板（01 板块矩阵 / 02 舰队 / 03 事件流 / 04 经济体 / 05 结算流水 / 06 24 小时周期）。每块面板只读一张表，头部标明来源表与条数，右上角进对应板块页。`assets/js/cockpit.js` 自带数据层（直接走 `__SMART_PAGE__.database`），不依赖 `os.js`。注意：根目录重建（`build_site.py`）会清空 `assets/`，重建后需重跑工作区的 `_build/build_cockpit.py`。
