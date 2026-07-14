# Backend — Read-Only Live Data Layer

> **Purpose:** wire the existing React admin console (`Frontend/`) to the **live** `dakavara_pa`
> database so it displays real data instead of `mockData.js`.
> **Scope of this document:** **READ-ONLY.** GET / display only. No INSERT / UPDATE / DELETE.
> The 6-step user-creation write path (`Dakavara_PA_Dashboard_User_Creation_Reference.md`) is
> deliberately **out of scope** here — the create/OTP/edit buttons stay as front-end mocks until a
> separate write API is signed off.
>
> **Verified live** against `dakavara_pa` on MySQL **8.0.42** (AWS RDS **production**), read-only
> session, **14 Jul 2026**. Every count and sample below is real output, not from the reports.

---

## 0. TL;DR — what to build

A tiny Python + FastAPI service exposing **6 read-only endpoints** that return the **exact JSON shape**
`Frontend/src/data/mockData.js` already produces. Swapping the backend in is then a drop-in: replace
the mock generators with `fetch()` calls, no UI redesign. Full runnable server is in §6.

| # | Endpoint | Replaces (mock) | Powers screen |
|---|---|---|---|
| 1 | `GET /api/members` | `MEMBERS` / `INITIAL_MEMBERS` | Logins table, Overview stats, Audit |
| 2 | `GET /api/members/:id` | one row of `MEMBERS` | Detail |
| 3 | `GET /api/lookups/user-types` | `USER_TYPES` | Role dropdowns / badges |
| 4 | `GET /api/lookups/user-levels` | `USER_LEVELS` + `USED_LEVEL_IDS` | Scope dropdowns |
| 5 | `GET /api/lookups/components` | `COMPONENTS` | Component chips / catalogue |
| 6 | `GET /api/cadre/:mid` | `lookupCadre()` / `CADRE_BY_MID` | Create-modal MID lookup (read part) |

Groups (`user_groups`) are **not** wired — the schema has no member↔group or group↔component link
(`Admin_Dashboard_Table_Report.md` §0.1, §3.11–3.12). The Groups screen stays mock-only.

---

## 1. Database connection

Credentials come from the project `.env` (already present at repo root):

```
DB_HOST=db-projectk-prod.cluster-cxksnp5k9yp8.us-east-1.rds.amazonaws.com
DB_PORT=3306
DB_USER=root
DB_PASSWORD=w4rT1k5+1arAuFVXEBKR
DB_NAME=dakavara_pa
```

**Connectivity confirmed** from this machine:

```
version   db           server_time
8.0.42    dakavara_pa  2026-07-14 10:38:03
```

> ⚠ **Two production-safety notes carried over from the reports — act on these before go-live:**
> 1. These are **`root` on the production cluster.** Create a least-privilege read user for this app:
>    `GRANT SELECT ON dakavara_pa.* TO 'ua_dashboard_ro'@'%';` — no INSERT/UPDATE/DELETE, no DDL.
>    Then point `.env` at that user. (`Admin_Dashboard_Table_Report.md` §6)
> 2. Enforce read-only at the session level as belt-and-braces: run
>    `SET SESSION TRANSACTION READ ONLY;` on each connection (the `connect()` helper in §6 does this).

Recommended connection settings (in §6 code): `charset='utf8mb4'` (component display names include
Telugu, e.g. `సుపరిపాలనలో తొలి అడుగు` — the whole path must be UTF-8 clean), plus a per-request
connection with `connect_timeout`/`read_timeout`.

---

## 2. Data model (the only chain that matters)

```
tdp_cadre (22.5M — the person; NEVER scanned, point-lookup by membership_id only)
   │ tdp_cadre_id
   ▼
activity_member (1,426 rows; 553 active)  ← THE LOGIN. Drive everything from here.
   ├── activity_member_access_type  → user_type   (role: MLA, OBSERVER…)
   ├── activity_member_access_level → user_level   (geographic scope + location int)
   └── activity_member_component    → component    (granted dashboard widgets)
```

**Three status flags, three spellings — all real, do not "fix" them:**

| Table | Column | Meaning | Filter used |
|---|---|---|---|
| `activity_member` | **`is_acitve`** (misspelled, verbatim) | account active | `= 'Y'` |
| `activity_member_access_type` | `is_active` | role grant active | `= 'Y'` |
| `activity_member_access_level` | `is_active` | scope grant active | `= 'Y'` |
| `activity_member_component` | `is_valid` | component grant valid | `= 'Y'` |

Ignore `user`, `user_groups`, `user_group`, `activity_member_enrollment` for this dashboard — legacy /
unlinked / dead. (`Admin_Dashboard_Table_Report.md` §0.1–0.2, §3.5, §5.3)

---

## 3. Live schema (verified 14 Jul 2026)

Only the columns this dashboard reads. Types are exact from `DESC`.

**`activity_member`** — `activity_member_id` bigint PK · `tdp_cadre_id` bigint · `member_name`
varchar(200) · `image_url` varchar(450) · `inserted_time` datetime · `updated_by` bigint ·
`is_acitve` enum('Y','N') default 'Y'.

**`activity_member_access_type`** — `activity_member_id` · `user_type_id` int · `is_active` enum('Y','N').

**`activity_member_access_level`** — `activity_member_id` · `activity_member_level_id` int (→ `user_level`) ·
`activity_location_value` int (**no FK** — meaning depends on the level) · `is_active` enum('Y','N').

**`activity_member_component`** — `activity_member_id` · `component_id` int · `is_valid` enum('N','Y').

**`user_type`** — `user_type_id` int PK · `type` varchar(45) · `short_name` varchar(25) · `order_no` int.

**`user_level`** — `user_level_id` int PK · `level` varchar(50).

**`component`** — `component_id` int PK · `name` varchar(60) · `actual_name` varchar(60) ·
`dashboard_display_name` varchar(60) · `order_no` int.

**`tdp_cadre`** (key cols) — `tdp_cadre_id` bigint PK · `membership_id` varchar(10) **(indexed)** ·
`mobile_no` varchar(15) (indexed) · `first_name`/`last_name` varchar(200) · `gender` enum('M','F') ·
`constituency_id` int · `payment_status` enum('PAID','NOT PAID','NR') ·
`is_deleted` enum('Y','N','H','NA','AR','T','MD','O','A','I','P') default 'N'.

---

## 4. The frontend data contract

This is the shape `mockData.js`/`App.jsx` build per member. **The API must return this verbatim**
so the UI needs zero changes. Field → source column:

```jsonc
{
  "activity_member_id": 1591,          // activity_member.activity_member_id
  "member_name": "SURYANARAYANA REDDY MANCHOORI", // activity_member.member_name
  "tdp_cadre_id": 1234567,             // activity_member.tdp_cadre_id (may be null)
  "membership_id": "19457249",         // tdp_cadre.membership_id (null if cadre unresolved)
  "mobile_no": "9448005893",           // tdp_cadre.mobile_no (null if missing)
  "is_acitve": "Y",                    // activity_member.is_acitve  (NOTE spelling)
  "inserted_time": "2026-...T...Z",    // activity_member.inserted_time (ISO)
  "updated_by": 101,                   // activity_member.updated_by
  "role_id": 8,                        // access_type.user_type_id  (is_active='Y')
  "role_name": "CONSTITUENCY",         // user_type.type
  "role_short": "ACI",                 // user_type.short_name
  "level_id": 5,                       // access_level.activity_member_level_id (is_active='Y')
  "level_name": "ASSEMBLY",            // user_level.level
  "location_value": 242,               // access_level.activity_location_value (bare int)
  "component_ids": [82, 94, 129, 131]  // access_level.component_id[] (is_valid='Y'), ASC
}
```

**Reality that shapes the query** (all verified live):
- Every active member has **exactly one** role and **exactly one** active level → collapse with
  `MAX()`, safe. A member with no role/level returns `null` for those fields (see member 1564 below).
- `component_ids` is the only true one-to-many → `GROUP_CONCAT(DISTINCT … ORDER BY … )`, then split
  to an int array in the API layer.
- 5 active members have **zero** components → `component_ids: []` (blank dashboard, by design).

---

## 5. The read-only queries

### 5.1 `GET /api/members` — collapsed login list (verified)

One row per login. This is the single most important query — it feeds the table, the Overview KPIs,
and the Audit list. Collapses the 5.5× member×role×component fan-out in SQL, not React
(`Admin_Dashboard_Table_Report.md` §4.1).

```sql
SET SESSION group_concat_max_len = 8192;   -- default 1024 truncates 25-component power users

SELECT
  AM.activity_member_id,
  AM.member_name,
  AM.tdp_cadre_id,
  AM.inserted_time,
  AM.updated_by,
  AM.is_acitve,
  TC.membership_id,
  TC.mobile_no,
  MAX(AMAT.user_type_id)              AS role_id,
  MAX(UT.type)                        AS role_name,
  MAX(UT.short_name)                  AS role_short,
  MAX(AMAL.activity_member_level_id)  AS level_id,
  MAX(UL.level)                       AS level_name,
  MAX(AMAL.activity_location_value)   AS location_value,
  GROUP_CONCAT(DISTINCT AMC.component_id ORDER BY AMC.component_id) AS component_ids
FROM activity_member AM
LEFT JOIN tdp_cadre TC
       ON TC.tdp_cadre_id = AM.tdp_cadre_id
LEFT JOIN activity_member_access_type AMAT
       ON AMAT.activity_member_id = AM.activity_member_id AND AMAT.is_active = 'Y'
LEFT JOIN user_type UT
       ON UT.user_type_id = AMAT.user_type_id
LEFT JOIN activity_member_access_level AMAL
       ON AMAL.activity_member_id = AM.activity_member_id AND AMAL.is_active = 'Y'
LEFT JOIN user_level UL
       ON UL.user_level_id = AMAL.activity_member_level_id
LEFT JOIN activity_member_component AMC
       ON AMC.activity_member_id = AM.activity_member_id AND AMC.is_valid = 'Y'
WHERE AM.is_acitve = 'Y'          -- misspelling is correct; remove this line to show inactive too
GROUP BY AM.activity_member_id, AM.member_name, AM.tdp_cadre_id,
         AM.inserted_time, AM.updated_by, AM.is_acitve, TC.membership_id, TC.mobile_no
ORDER BY AM.inserted_time DESC;
```

**Live sample (5 rows):**

```
activity_member_id  member_name                    is_acitve  membership_id  mobile_no    role_id  role_name      level_id  level_name  location_value  component_ids
1591                SURYANARAYANA REDDY MANCHOORI   Y          19457249       9448005893   8        CONSTITUENCY   5         ASSEMBLY    242             82,94,129,131
1590                ANANTALAKSHMI PILLI             Y          18521767       9949668877   8        CONSTITUENCY   5         ASSEMBLY    307             82,94,129,131
1565                SRINIVASA PRASAD MANNEM         Y          21089796       9849033310   8        CONSTITUENCY   5         ASSEMBLY    291             82,94,129,131
1564                RAJYA LACHAMI KASHIREDDY        Y          99579219       8978509461   NULL     NULL           NULL      NULL        NULL            NULL
1560                BRAHMA RAJU YADDANAPUDI         Y          09411004       9440724666   12       OBSERVER       5         ASSEMBLY    177             82,94,129,131
```

Member **1564** is real proof the `LEFT JOIN`s are right: an active login with no role/level/components
still returns its base row (role/level `null`, `component_ids: []` after the API split).

**API-layer transform** (the only massaging needed):
```js
component_ids: row.component_ids ? row.component_ids.split(',').map(Number) : []
```
Everything else maps 1:1. `is_acitve` stays `'Y'`/`'N'` (the UI compares to `'Y'`).

> To show inactive logins too (the table's Status filter offers "Inactive"), drop the
> `WHERE AM.is_acitve='Y'` line and return all 1,426. The UI filters client-side on `is_acitve`.

### 5.2 `GET /api/members/:id` — one login (Detail screen)

Same query as 5.1 with `WHERE AM.activity_member_id = ?` (drop the `is_acitve` filter so an
admin can open a deactivated login). Returns a single object.

### 5.3 `GET /api/lookups/user-types` — 17 rows (verified)

```sql
SELECT user_type_id AS id, type, short_name AS short, order_no
FROM user_type ORDER BY user_type_id;
```
Live: 17 rows, ids `1-9,11,12,14-19` (gaps at 10 & 13). `order_no` is `NULL` for COUNTRY/STATE and
not unique (11 appears twice) — **do not sort by it alone.** `short_name` is dirty: `1.KEY`,
`PARLIAMENT PARTY PRESIDEN` (truncated to 25 chars), trailing spaces on `OTHERS `. Render as-is.

### 5.4 `GET /api/lookups/user-levels` — 9 rows (verified)

```sql
SELECT user_level_id AS id, level AS name FROM user_level ORDER BY user_level_id;
```
`1 COUNTRY, 2 STATE, 3 DISTRICT, 4 PARLIAMENT, 5 ASSEMBLY, 6 MANDAL, 7 MUNICIPALITY, 8 VILLAGE, 9 WARD`.
Only **2, 4, 5** carry members (the UI's `USED_LEVEL_IDS = [5,4,2]`). Return the used set alongside:
```json
{ "levels": [ ...9 rows... ], "used_level_ids": [5, 4, 2] }
```

### 5.5 `GET /api/lookups/components` — 133 rows

```sql
SELECT component_id AS id, name, actual_name AS actual, dashboard_display_name AS display, order_no
FROM component ORDER BY component_id;
```
**89 of 133 have a null/empty `display`, 124 of 133 have null `order_no`.** The UI already handles
this with a 3-level fallback — keep it. Do **not** coalesce in SQL; return the raw three fields so
the front-end `componentLabel(c)` logic (`display || actual || name`) still works unchanged.

### 5.6 `GET /api/cadre/:mid` — MID lookup (read part of Create flow)

Point-lookup on the indexed `membership_id`. Never `LIKE '%…%'` this 22.5M-row table.

```sql
SELECT tdp_cadre_id, membership_id, first_name, last_name, mobile_no,
       gender, constituency_id, payment_status
FROM tdp_cadre
WHERE membership_id = ? AND is_deleted = 'N'
LIMIT 1;
```
Returns the cadre object (or `404`/`null`) — matches the shape `CADRE_BY_MID` mocks in `App.jsx`.
This is the only `tdp_cadre` read; it powers step 1 of the create modal. The actual *insert* is a
future write endpoint, not this document.

### 5.7 Overview stats — compute client-side, no new endpoint

`computeStats(members)` in the front-end already derives every KPI (active/inactive/no-components,
role & level counts, top components, standard-bundle %) from the `/api/members` array. Keep it that
way — no separate `/api/stats` needed. (If you ever want it server-side, the distribution queries
used to verify this doc are below in §7.)

---

## 6. Reference server (drop-in, read-only)

Minimal **Python + FastAPI + PyMySQL** service in `Backend/`.

```
Backend/
  requirements.txt  →  fastapi · uvicorn · pymysql · python-dotenv
  main.py           →  below
```
`pip install -r requirements.txt` then `python main.py` (or `uvicorn main:app --port 4000`).
Reads the repo-root `.env`. Serves `http://localhost:4000`.

```python
# Backend/main.py — READ-ONLY live data layer for the UA admin console.
import os
import pymysql
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

load_dotenv(dotenv_path="../.env")                 # repo-root .env

DB = dict(
    host=os.environ["DB_HOST"], port=int(os.environ["DB_PORT"]),
    user=os.environ["DB_USER"], password=os.environ["DB_PASSWORD"],
    database=os.environ["DB_NAME"],
    charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor,
    connect_timeout=15, read_timeout=30,
)

def connect():
    # Belt-and-braces read-only + widen group_concat, per connection.
    conn = pymysql.connect(**DB)
    with conn.cursor() as cur:
        cur.execute("SET SESSION TRANSACTION READ ONLY")
        cur.execute("SET SESSION group_concat_max_len = 8192")
    return conn

def run(sql, args=None, one=False):
    conn = connect()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
            rows = cur.fetchall()
    finally:
        conn.close()
    return (rows[0] if rows else None) if one else rows

def shape(r):                                       # component_ids: comma str -> int list
    ids = r.get("component_ids")
    r["component_ids"] = [int(x) for x in ids.split(",")] if ids else []
    return r

MEMBER_SELECT = """
  SELECT AM.activity_member_id, AM.member_name, AM.tdp_cadre_id, AM.inserted_time,
         AM.updated_by, AM.is_acitve, TC.membership_id, TC.mobile_no,
         MAX(AMAT.user_type_id) AS role_id, MAX(UT.type) AS role_name, MAX(UT.short_name) AS role_short,
         MAX(AMAL.activity_member_level_id) AS level_id, MAX(UL.level) AS level_name,
         MAX(AMAL.activity_location_value) AS location_value,
         GROUP_CONCAT(DISTINCT AMC.component_id ORDER BY AMC.component_id) AS component_ids
  FROM activity_member AM
  LEFT JOIN tdp_cadre TC ON TC.tdp_cadre_id = AM.tdp_cadre_id
  LEFT JOIN activity_member_access_type AMAT ON AMAT.activity_member_id = AM.activity_member_id AND AMAT.is_active='Y'
  LEFT JOIN user_type UT ON UT.user_type_id = AMAT.user_type_id
  LEFT JOIN activity_member_access_level AMAL ON AMAL.activity_member_id = AM.activity_member_id AND AMAL.is_active='Y'
  LEFT JOIN user_level UL ON UL.user_level_id = AMAL.activity_member_level_id
  LEFT JOIN activity_member_component AMC ON AMC.activity_member_id = AM.activity_member_id AND AMC.is_valid='Y'
"""
GROUP_BY = """ GROUP BY AM.activity_member_id, AM.member_name, AM.tdp_cadre_id,
  AM.inserted_time, AM.updated_by, AM.is_acitve, TC.membership_id, TC.mobile_no"""

app = FastAPI(title="UA read-only API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"], allow_headers=["*"])

# 1) member list  (?status=all|active|inactive, default active)
@app.get("/api/members")
def members(status: str = "active"):
    where = "" if status == "all" else f" WHERE AM.is_acitve = '{'N' if status == 'inactive' else 'Y'}'"
    return [shape(r) for r in run(MEMBER_SELECT + where + GROUP_BY + " ORDER BY AM.inserted_time DESC")]

# 2) single member (any status)
@app.get("/api/members/{member_id}")
def member(member_id: int):
    row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    return shape(row)

# 3) lookups
@app.get("/api/lookups/user-types")
def user_types():
    return run("SELECT user_type_id AS id, type, short_name AS short, order_no FROM user_type ORDER BY user_type_id")

@app.get("/api/lookups/user-levels")
def user_levels():
    levels = run("SELECT user_level_id AS id, level AS name FROM user_level ORDER BY user_level_id")
    return {"levels": levels, "used_level_ids": [5, 4, 2]}

@app.get("/api/lookups/components")
def components():
    return run("SELECT component_id AS id, name, actual_name AS actual, "
               "dashboard_display_name AS display, order_no FROM component ORDER BY component_id")

# 4) cadre MID lookup (create-flow step 1, read-only)
@app.get("/api/cadre/{mid}")
def cadre(mid: str):
    row = run("SELECT tdp_cadre_id, membership_id, first_name, last_name, mobile_no, "
              "gender, constituency_id, payment_status "
              "FROM tdp_cadre WHERE membership_id = %s AND is_deleted = 'N' LIMIT 1", (mid,), one=True)
    if not row:
        raise HTTPException(status_code=404, detail="no cadre for that MID")
    return row

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4000)
```

---

## 7. Wiring the front-end

Replace the mock generators in `Frontend/src/data/mockData.js` (and the inlined copies in
`App.jsx`) with fetches that return the **same shape** — the components need no other change.

```js
const API = 'http://localhost:4000/api';
export const getMembers   = () => fetch(`${API}/members?status=all`).then(r => r.json());
export const getUserTypes = () => fetch(`${API}/lookups/user-types`).then(r => r.json());
export const getLevels    = () => fetch(`${API}/lookups/user-levels`).then(r => r.json()); // {levels, used_level_ids}
export const getComponents= () => fetch(`${API}/lookups/components`).then(r => r.json());
export const lookupCadre  = (mid) => fetch(`${API}/cadre/${mid}`).then(r => r.ok ? r.json() : null);
```
Load them once (e.g. `useEffect` → `useState`) and feed `MEMBERS`/`USER_TYPES`/`USER_LEVELS`/
`COMPONENTS` from state instead of the module constants. `componentLabel`, `computeStats`, filters,
and every screen keep working unchanged because the field names are identical.

Leave the **write** actions (create, save edits, activate/deactivate, OTP) as mocks for now — this
layer is read-only. They become a second, authenticated write API later (see the 6-step flow in
`Dakavara_PA_Dashboard_User_Creation_Reference.md`).

---

## 8. Verification snapshot (live, 14 Jul 2026)

Real output proving the queries above — use these as regression baselines.

| Metric | Value |
|---|---|
| `activity_member` total / active / inactive | **1,426 / 553 / 873** |
| `user_type` rows | 17 |
| `user_level` rows | 9 |
| `component` rows | 133 |
| Active members with **zero** components | **5** (blank dashboards) |

**Active members by level** (only 3 of 9 levels used):

| level_id | level | members |
|---:|---|---:|
| 5 | ASSEMBLY | 357 |
| 4 | PARLIAMENT | 124 |
| 2 | STATE | 71 |

**Active members by role** (top of 14 in-use roles):

| user_type_id | type | members |
|---:|---|---:|
| 12 | OBSERVER | 171 |
| 7 | MLA | 120 |
| 16 | PROGRAM COMMITTEE | 62 |
| 8 | CONSTITUENCY | 47 |
| 11 | ECM_TEAM(RAJASHEKHAR) | 35 |
| 14 | PARLIAMENT PARTY PRESIDENT | 33 |
| 18 | OTHERS | 27 |
| 3 | MINISTER | 19 |
| 6 | MP | 15 |

**Most-granted components** (active members):

| id | label | members |
|---:|---|---:|
| 131 | SIR DASHBOARD | 519 |
| 129 | COMMITTEE MEETINGS | 517 |
| 94 | CUBS-COMMITTEES 2025 DASHBOARD | 495 |
| 82 | 2024-26 MEMBERSHIP DASHBOARD | 472 |
| 119 | TRAINING PROGRAMS (APP) | 83 |
| 117 | APP COMMITTEE USERS & LOGIN STATUS | 82 |
| 113 | PROGRAMS DASHBOARD (APP) | 82 |
| 45 | CADRE SEARCH | 81 |
| 120 | Door To Door Campaign-2026(Beneficiaries) | 80 |
| 133 | EVENTS - CADRE MEETINGS | 68 |

> The canonical bundle `{82, 94, 129, 131}` still dominates (the four top components above), matching
> `Admin_Dashboard_Table_Report.md` §4.2. Note the labels for 120 & 133 have since changed in the DB
> ("Door To Door…", "EVENTS - CADRE MEETINGS") — another reason to read component labels live, not
> hard-code them.

---

## 9. Gotchas (read before you ship)

1. **`is_acitve` is misspelled on `activity_member`** — junctions use `is_active`, components use
   `is_valid`. Mixing them is a silent bug.
2. **`SET SESSION group_concat_max_len = 8192`** — without it, 25-component power users silently
   truncate in `component_ids`. The `connect()` helper does this per connection.
3. **`activity_location_value` is a bare int with no FK** — its meaning depends on the level. Read-only
   here so it's harmless, but never *write* it without validating against geography for the chosen level.
4. **Never scan `tdp_cadre`** (22.5M rows). Only the indexed point-lookup in §5.6. Drive the list from
   `activity_member` (1.4K) and join outward.
5. **UTF-8 end to end** — component display names include Telugu. `charset:'utf8mb4'` + the DB is fine.
6. **Least-privilege user before production** (§1). Root-on-prod in `.env` is for this read-only spike
   only.
7. **Groups / OTP / create stay mock** — out of scope for a read-only layer, and Groups has no schema
   backing at all.
