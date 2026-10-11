#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Refresh snapshot.json from the live WorkBuddy library tables.

Requires the WorkBuddy library skill (scripts that read the 5 tables) plus the table
registry produced when the database was created.

Env vars (all optional, auto-detected where possible):
  LIBRARY_SKILL_DIR  path to .../skills/library          (default: Windows install path)
  STATE              path to the table registry JSON     (default: <repo>/_build/state.json)
Output:
  snapshot.json at the repo root
"""
import datetime, json, os, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SKILL = os.environ.get("LIBRARY_SKILL_DIR") or (
    "C:/Users/wangx/AppData/Local/Programs/WorkBuddy/resources/app.asar.unpacked/"
    "resources/plugins/workbuddy-builtin/skills/library"
)
def _find_state():
    """先在仓库内找，再向上最多 4 层找 _build/state.json（仓库嵌在工作区里时也能定位）。"""
    base = ROOT
    for _ in range(4):
        cand = os.path.join(base, "_build", "state.json")
        if os.path.isfile(cand):
            return cand
        parent = os.path.dirname(base)
        if parent == base:
            break
        base = parent
    return None


STATE_PATH = os.environ.get("STATE") or _find_state()
OUT = os.path.join(ROOT, "snapshot.json")
KEYS = ["agents", "events", "tasks", "ledger", "cycles"]

if not STATE_PATH:
    sys.exit("找不到表注册文件 state.json，请用 STATE 环境变量指定")

STATE = json.load(open(STATE_PATH, encoding="utf-8"))
PY = sys.executable


def fetch_all(dbid):
    rows, cur, guard = [], "", 0
    while True:
        cmd = [PY, os.path.join(SKILL, "database", "query_database_record.py"),
               "--database-id", dbid, "--page-size", "200"]
        if cur:
            cmd += ["--start-cursor", cur]
        p = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8")
        d = json.loads(p.stdout)
        rows += d.get("results") or []
        if d.get("has_more") and d.get("next_cursor") and guard < 20:
            cur = d["next_cursor"]
            guard += 1
        else:
            break
    return rows


def build_schema(entry):
    props = []
    for fname, _dom, ftype, _cfg in entry["fields"]:
        prop = {"name": fname, "type": ftype}
        if ftype in ("select", "multi_select"):
            opts = (entry.get("options") or {}).get(fname) or []
            prop["config"] = {"options": [{"id": o["id"], "text": o["text"]} for o in opts]}
        props.append(prop)
    return {"properties": props}


snap = {"generatedAt": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "tables": {}}
for k in KEYS:
    entry = STATE["tables"][k]
    dbid = entry["database_id"]
    rows = fetch_all(dbid)
    snap["tables"][k] = {
        "databaseId": dbid,
        "title": entry["title"],
        "schema": build_schema(entry),
        "rows": rows,
    }
    print(f"{entry['title']:10s} {dbid}  rows={len(rows)}")

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(snap, f, ensure_ascii=False, separators=(",", ":"))
print("written:", OUT, os.path.getsize(OUT), "bytes")
