# Napell Coffee Chain OS

**Napell 咖啡全产业链智能体运行控制系统** — 9 大智能体协同的咖啡产业链操作系统控制台：事件总线、任务调度、经济体结算与 24 小时时钟周期。

Interactive control plane for a 9-agent coffee supply-chain operating system: event bus, task dispatch, inter-agent settlement ledger, and a rolling 24-hour clock cycle.

---

## Live

| 形态 | 链接 | 说明 |
|---|---|---|
| 静态演示版（本仓库） | GitHub Pages | 内嵌真实数据快照，全部交互在浏览器本地生效 |
| 在线协作版（WorkBuddy 资料库） | https://www.workbuddy.cn/space/d/znE2WbdN9A3HrogSzHliaR | 连真实数据库，写入会持久化到云端 |

> 两者的页面代码同源。资料库版使用宿主注入的 `__SMART_PAGE__.database` SDK；本仓库版在检测不到该 SDK 时，自动注入一份浏览器内实现（同形契约），因此静态站点上依然是**可读可写**的，而不是一张截图。

---

## What's in the cockpit

| 板块 | 能力 |
|---|---|
| `#fleet` 智能体舱 | 9 个智能体的状态 / 能力数 / 调用量 / 信用积分 / 累计收益，心跳实时显示为「x 分钟前」 |
| `#dispatch` 派发台 | 下发工单 → 写入任务表并同步广播一条事件到总线（含草稿本地缓存） |
| `#bus` 事件总线 | 12 类链上事件流 + 按处理状态 / 来源智能体分布，30 秒自动刷新 |
| `#board` 任务工单 | 工单看板，「标记完成」回执并补发事件，按执行智能体聚合统计 |
| `#economy` 经济体 | 收 / 支 / 净额 + 账本流水（分页）+ 结算类型分布 |
| `#cycles` 24 小时时钟 | 24 根逐小时柱（生豆产出 / 碳减排 / 融资 / IP / 门店收入），可下钻单周期详情 |
| `#kpi` 飞轮 KPI | 聚合驱动的产业链 KPI 卡片与飞轮条 |

## Data model

5 tables, 437 rows of seeded data (24 hours × 12 event topics).

| Table | Database ID | Rows | Role |
|---|---|---|---|
| 智能体注册表 | `cFRjJqhyp5LDaCZHPp3XVm` | 9 | agent registry, heartbeat, credits |
| 事件总线 | `ND8kO27PEOFohwZHxm6WgV` | 288 | inter-agent event log (12 topics/hour) |
| 任务工单 | `xQspxv5gupTBY8LeSHVv5L` | 61 | task tickets + completion |
| 智能体账本 | `dmRghisDSmokozzg8GMuwv` | 55 | service settlement ledger |
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

## Static demo mode

`index.html` is self-contained (no build step, no external requests). If `__SMART_PAGE__.database`
is absent it installs an in-browser implementation of the same contract
(`query` with cursor pagination, `aggregate` with `groupBy` + per-item `filter`, `addRecord`,
`updateRecord`, `getSchema`) backed by an embedded snapshot, persisting writes to `localStorage`.

A bottom-left chip shows the snapshot timestamp and offers **重置数据** to restore the baseline.

## Rebuild

```bash
# 1. refresh the snapshot from the live tables
python tools/fetch_snapshot.py

# 2. rebuild index.html
python tools/build_gh.py
```

`tools/build_gh.py` splices an embedded-snapshot data layer into the same single-file page used by
the WorkBuddy library version, so the two stay in sync.

## Stack

Single-file HTML/CSS/ES5 JavaScript. No framework, no bundler, no dependencies.
Dark theme (`#000` background, `#1d9bf0` accent), dashboard-style data presentation.
