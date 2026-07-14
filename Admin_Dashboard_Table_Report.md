# Admin Dashboard — Live Table Report

> Source: `dakavara_pa` on MySQL 8.0.42 (AWS RDS, **production**), inspected **14 Jul 2026**, read-only session
> (`SET SESSION TRANSACTION READ ONLY`). Row counts are exact `COUNT(*)` except `tdp_cadre`
> (information_schema estimate — a real count would be a 22.5M-row scan on prod).
>
> Scope: the 12 tables named in the admin-dashboard query set, what data each actually holds,
> and what the two analytical queries reveal.

---

## 0. Headline findings (read this first)

1. **`user_group` is EMPTY (0 rows).** The table with data is **`user_groups`** (212 rows). Your query set does `DESC user_groups` but `SELECT * FROM user_group` — the mismatch is real, and the `SELECT` returns nothing. Neither table is wired to `activity_member` in any case (see §3.12) — **groups are not part of this dashboard's access model.**
2. **The `user` table is effectively NOT part of this dashboard.** Only **20 of 553** active members resolve to a `user` row; 1,070 of 1,426 `activity_member` rows have `user_id = NULL`. `user` is a *separate legacy username/password system* (76,781 rows), not the OTP-based cadre login. Treating it as "the user's access type" would be wrong.
3. **Revocation-by-flag is documented but never used.** `activity_member_access_type` (626 rows) and `activity_member_component` (3,579 rows) contain **zero `N` rows** — every single row is `Y`. Access is apparently revoked by `DELETE`, or never revoked at all. Only `activity_member_access_level` has any `N` (43 of 1,729).
4. **Nobody has more than one role.** All 551 active members with a role have **exactly one** `user_type` — the "multi-role" capability the schema allows is unused in practice.
5. **74% of active users share one identical component bundle**: `{82, 94, 129, 131}` = *2024-26 Membership Dashboard, Cubs-Committees 2025, Committee Meetings, SIR Dashboard*. 410 of 553 active members have precisely this set, across 7 different roles. Roles and components are **almost entirely decoupled** — see §4.2.
6. **Only 3 of 9 access levels are in use**: STATE, PARLIAMENT, ASSEMBLY. No DISTRICT, MANDAL, MUNICIPALITY, VILLAGE, WARD, or COUNTRY member exists.
7. **⚠ `user.password` is stored in plaintext** (e.g. `dakaV@ram`). Pre-existing, out of scope for this dashboard, but it should be reported to whoever owns that system.

---

## 1. Table inventory

| Table | Rows | Role in the dashboard |
|---|---:|---|
| `tdp_cadre` | ~22,544,887 (est) | **Identity master.** The person. Name, membership ID, mobile, demographics. |
| `activity_member` | 1,426 | **The login.** One row = one dashboard account, pointing at a cadre. 553 active. |
| `activity_member_access_type` | 626 | Login → **role** (`user_type`). All rows `Y`. |
| `activity_member_access_level` | 1,729 | Login → **geographic scope** (level + location id). |
| `activity_member_component` | 3,579 | Login → **granted dashboard widgets**. All rows `Y`. |
| `activity_member_enrollment` | 2 | Enrollment period dimension. **Stale** (latest = "2016 - 2018"). |
| `user_type` | 17 | Role lookup (MLA, MP, OBSERVER…). |
| `user_level` | 9 | Geographic level lookup (COUNTRY…WARD). |
| `component` | 133 | Dashboard widget catalogue. |
| `user` | 76,781 | **Legacy** username/password system. Barely linked (20/553). |
| `user_groups` | 212 | Group name list. **Not linked to `activity_member`.** |
| `user_group` | **0** | **Empty.** Different shape (`registration_id`, `group_name`). Unused. |

---

## 2. How the tables connect

```
                       tdp_cadre  (22.5M — the person)
                           │ tdp_cadre_id
                           │  (553/553 active logins resolve cleanly ✅)
                           ▼
                    activity_member  (1,426 — the login; 553 active)
                     │        │        │            │
       activity_member_id ────┼────────┼────────────┤
                     ▼        ▼        ▼            ▼
            _access_type  _access_level  _component   _enrollment_id
              626 rows      1,729 rows    3,579 rows      (2 rows)
                 │              │              │
                 ▼              ▼              ▼
             user_type      user_level     component
             (17 rows)      (9 rows)       (133 rows)
                                │
                                └─ activity_location_value → geography (NO FK ⚠)

            activity_member.user_id ──✗──> user  (only 20/553 resolve — dead link)
            user_groups / user_group ──✗──  no relationship to activity_member at all
```

---

## 3. Table-by-table detail

### 3.1 `activity_member` — the login record (1,426 rows; **553 active / 873 inactive**)

| Column | Type | Notes |
|---|---|---|
| `activity_member_id` | bigint PK | The login id. Every junction table hangs off this. |
| `tdp_cadre_id` | bigint FK | → `tdp_cadre`. **156 rows NULL** overall, but **all 553 active rows resolve.** |
| `user_id` | bigint FK | → `user`. **1,070 NULL.** Only 20 active members resolve. Effectively dead. |
| `member_name` | varchar(200) | Display name. Denormalised — does *not* always match `tdp_cadre.first_name`. |
| `image_url` | varchar(450) | Relative path e.g. `152/AP1406574091.jpg`. 99 rows blank/NULL. |
| `inserted_time` | datetime | Creation timestamp. |
| `updated_by` | bigint | Audit — who last changed it. |
| `state_id` | bigint FK | **575 NULL** — unreliable, don't depend on it. |
| `activity_member_enrollment_id` | int FK | → `activity_member_enrollment`. |
| **`is_acitve`** | enum('Y','N') | **Misspelled in the DB — verified live. Use verbatim.** Default `Y`. |

**Provides:** the users list, the active/suspended stat cards, the display name and avatar.
**Indexes:** PK + FKs on `tdp_cadre_id`, `user_id`, `state_id`, `enrollment_id`. No index on `is_acitve` — fine at 1.4K rows.

### 3.2 `activity_member_access_type` — login → role (626 rows)

`activity_member_access_type_id` PK · `activity_member_id` · `user_type_id` · `is_active` enum('Y','N') default Y

**Provides:** the role badge ("MLA", "OBSERVER") on every user row.
**Reality check:** **626/626 rows are `is_active='Y'` — not a single `N`.** The documented "revoke by flipping the flag" pattern has never been exercised here.
Every active member has **exactly one** row (551 of 553 have one; 2 have none).

### 3.3 `activity_member_access_level` — login → geographic scope (1,729 rows)

`activity_member_access_level_id` PK · `activity_member_id` · `activity_member_level_id` (→ `user_level`) · `activity_location_value` (int, **no FK**) · `is_active` (1,686 `Y` / 43 `N`)

**Provides:** "which constituency / parliament / state can this user see".
**Distribution among active members** — only 3 of the 9 levels are ever used:

| Level (id) | Members | Distinct locations |
|---|---:|---:|
| ASSEMBLY (5) | 357 | 175 |
| PARLIAMENT (4) | 124 | 25 |
| STATE (2) | 71 | 1 |

**⚠ `activity_location_value` has no foreign key.** It is a bare int whose meaning depends on the level (constituency id when level=5, parliament id when level=4…). A wrong value inserts fine and silently yields an empty dashboard. This is the #1 silent-failure trap when writing the create-user flow.

### 3.4 `activity_member_component` — login → granted widgets (3,579 rows)

`activity_member_component_id` PK · `activity_member_id` · `component_id` · `is_valid` enum('N','Y') default Y

**Provides:** which of the 133 dashboard widgets the user sees.
**Reality check:** **3,579/3,579 rows are `is_valid='Y'`.** Again, zero revocations on record.
**⚠ Only a PRIMARY index — no index on `activity_member_id` or `component_id`.** Every join against this table is a full scan. Harmless at 3.5K rows, but it will not stay harmless.
548 of 553 active members have at least one component; **5 active users have none** (they log in to a blank dashboard).

### 3.5 `activity_member_enrollment` — enrollment period (2 rows)

| id | description | from_year | to_year | is_active |
|---|---|---|---|---|
| 1 | `2014 - 2016 ` | `0000-00-00` | `0000-00-00` | N |
| 2 | `2016 - 2018` | `0000-00-00` | `0000-00-00` | Y |

**This dimension is dead.** The "current" period is *2016–2018*, a decade stale, and the date columns are zero-dates. 1,094 members (552 of the 553 active) sit on id 2. It carries no usable information — treat as a legacy column, don't surface it in the UI.

### 3.6 `user_type` — role lookup (17 rows, ID gaps at 10 and 13)

| id | type | short_name | order_no | active members |
|---:|---|---|---:|---:|
| 12 | OBSERVER | OBSERVER | 11 | **171** |
| 7 | MLA | MLA | 4 | **120** |
| 16 | PROGRAM COMMITTEE | PROGRAM COMMITTEE | 8 | 62 |
| 8 | CONSTITUENCY | ACI | 5 | 47 |
| 11 | ECM_TEAM(RAJASHEKHAR) | … | 9 | 35 |
| 14 | PARLIAMENT PARTY PRESIDENT | … | 6 | 33 |
| 18 | OTHERS | `OTHERS ` | 13 | 27 |
| 3 | MINISTER | MINISTER | 2 | 19 |
| 6 | MP | MP | 3 | 15 |
| 9 | KEY | 1.KEY | 1 | 7 |
| 4 | TEST USER | TEST USER | 12 | 6 |
| 15 | ZONAL COORDINATOR | … | 7 | 6 |
| 5 | LN TEAM | LN TEAM | 10 | 2 |
| 19 | MYTDP APP TEAM | … | 14 | 1 |
| 1 | COUNTRY | COUNTRY | *null* | **0** |
| 2 | STATE | STATE | *null* | **0** |
| 17 | AC OBSERVER | AC OBSERVER | 11 | **0** |

Notes: `short_name` is dirty (`1.KEY`, `OTHERS ` with a trailing space, `PARLIAMENT PARTY PRESIDEN` truncated to 25 chars). `order_no` is not unique (11 appears twice) and is NULL for 2 rows — **do not sort by it alone.** 6 real people are tagged `TEST USER` in production.

### 3.7 `user_level` — geographic level lookup (9 rows)

`1=COUNTRY, 2=STATE, 3=DISTRICT, 4=PARLIAMENT, 5=ASSEMBLY, 6=MANDAL, 7=MUNICIPALITY, 8=VILLAGE, 9=WARD`

**There is no BOOTH level.** Only 2, 4 and 5 are actually used (§3.3). The frontend's hard-coded `levelOrder` (which ends in "Booth") has no DB counterpart.

### 3.8 `component` — dashboard widget catalogue (133 rows)

`component_id` PK · `name` (code name) · `actual_name` · `dashboard_display_name` · `order_no`

**Data-quality:** **89 of 133 have a NULL/empty `dashboard_display_name`**, and **124 of 133 have a NULL `order_no`**. So the field you'd naturally render is missing two-thirds of the time — the UI must fall back `dashboard_display_name → actual_name → name`. Some display names are Telugu (`సుపరిపాలనలో తొలి అడుగు`), so the UI must be UTF-8 clean.
**36 of the 133 components have never been granted to anyone.**

Most-granted components (active grants):

| id | name | dashboard_display_name | members |
|---:|---|---|---:|
| 131 | SIRDashboard | SIR DASHBOARD | 529 |
| 129 | CommitteeMeetingsNew | COMMITTEE MEETINGS | 523 |
| 82 | cadreDashboard2024 | 2024-26 MEMBERSHIP DASHBOARD | 512 |
| 94 | KSSDashboard | CUBS-COMMITTEES 2025 DASHBOARD | 512 |
| 103 | D2DCampaignHouseVisitNew | *(Telugu)* | 161 |
| 110 | D2DCampaignGSTHouseVisit | *(Telugu)* | 161 |
| 119 | TrainingProgramsAPP | TRAINING PROGRAMS (APP) | 88 |
| 113 | ProgramsDashboard | PROGRAMS DASHBOARD (APP) | 86 |
| 117 | APPUsers | APP COMMITTEE USERS & LOGIN STATUS | 86 |
| 45 | cadreSearch | CADRE SEARCH | 85 |

### 3.9 `tdp_cadre` — identity master (~22.5M rows, 60+ columns)

Key columns for this dashboard: `tdp_cadre_id` PK · `membership_id` (varchar(10), **indexed** — the OTP login key) · `membership_no` · `mobile_no` (**indexed** — OTP delivery) · `first_name` / `last_name` · `relative_name` / `relative_type` · `gender` enum('M','F') · `date_of_birth` / `age` · `voter_id` · `image` · `constituency_id` (int, not a name) · `payment_status` enum('PAID','NOT PAID','NR') · `is_deleted` · audit (`inserted_time`, `inserted_web_user_id`, `updated_by`).

**Health for the 553 active logins:** 553/553 resolve to a cadre, **0 missing `membership_id`**, only **1 missing a mobile number**. So OTP login is viable for essentially every active user.

**⚠ Performance:** at 22.5M rows this table is only safe via its indexes (`membership_id`, `mobile_no`, `voter_id`, `tdp_cadre_id`). Never `LIKE '%…%'` it, never drive the users list from it — drive from `activity_member` (1.4K) and join outward.
**Note:** `is_deleted` is *not* a boolean — it's `enum('Y','N','H','NA','AR','T','MD','O','A','I','P')`. Don't assume `= 'N'` means "alive" without confirming what the other 9 codes mean.

### 3.10 `user` — legacy auth system (76,781 rows) — **not this dashboard's user table**

44 columns: `username`, **`password` (plaintext varchar(50) ⚠)**, `passwd_hash_txt`, `Hash_Key`, `Salt_Key`, `access_type` (a *string*: STATE/MLA/MP/DISTRICT…), `access_value` (string id), `is_enabled`, `is_otp_required`, `tdp_cadre_id`, plus address/geo columns.

Its `access_type` is a **free-text string**, not an FK to `user_type` — and it's dirty:

| access_type | count |
|---|---:|
| STATE | 71,583 |
| MLA | 4,352 |
| MP | 494 |
| DISTRICT | 298 |
| *(null)* | 40 |
| ZONE | 10 |
| COUNTRY | 2 |
| `Acces Type` | 1 |
| `accessType` | 1 |

**Verdict:** this is a parallel, older permission system. Only **20 of 553** active members even have a `user` row, and only **2** of those are `is_enabled='Y'`, with **0** requiring OTP. **Do not join it into the admin dashboard.** The dashboard's identity chain is `activity_member → tdp_cadre`, full stop.

### 3.11 `user_groups` (212 rows) — `user_group_id` + `notes` only

Just a name list: `ADMIN_GROUP`, `TDP_PARTY`, `TDP_MLA-GROUP`, `DATA_ENTRY`, `Households_Survey_Group`, `MAHANADU_USER_GROUP`, `CASTE_SURVEY_CALL_CENTER`, … No columns link it to `activity_member`. **Not usable for this dashboard.**

### 3.12 `user_group` (**0 rows — empty**)

`user_group_id` · `registration_id` · `group_name`. Empty table, different shape from `user_groups`. Ignore it.

---

## 4. The two analytical queries

### 4.1 Query 1 — member × access type × component

Your join over 553 active members returns **3,045 rows — a 5.5× fan-out**, exactly as you predicted (one row per member × role × component). It's correct for export/audit, but it is *not* a shape the UI can render: `A VENKATA RAMANAMMA` alone occupies 8 rows.

For the dashboard, collapse it in SQL rather than in React:

```sql
SELECT AM.activity_member_id, AM.member_name,
       GROUP_CONCAT(DISTINCT UT.type ORDER BY UT.type)  AS access_types,
       GROUP_CONCAT(DISTINCT COALESCE(C.dashboard_display_name, C.actual_name, C.name)
                    ORDER BY C.component_id)            AS components,
       COUNT(DISTINCT AMC.component_id)                 AS component_count
FROM activity_member AM
LEFT JOIN activity_member_access_type AMAT
       ON AMAT.activity_member_id = AM.activity_member_id AND AMAT.is_active = 'Y'
LEFT JOIN user_type UT ON UT.user_type_id = AMAT.user_type_id
LEFT JOIN activity_member_component AMC
       ON AMC.activity_member_id = AM.activity_member_id AND AMC.is_valid = 'Y'
LEFT JOIN component C ON C.component_id = AMC.component_id
WHERE AM.is_acitve = 'Y'          -- misspelling is correct: DB column is is_acitve
GROUP BY AM.activity_member_id, AM.member_name;
```

(Watch `group_concat_max_len`, default 1,024 bytes — the 25-component power users will silently truncate. `SET SESSION group_concat_max_len = 8192;`)

### 4.2 Query 2 — identical access/component profiles

**43 distinct profile clusters** across 553 active members. The distribution is extremely top-heavy:

| Role (user_type_id) | Component signature | Members |
|---|---|---:|
| 12 OBSERVER | `82,94,129,131` | **171** |
| 7 MLA | `82,94,129,131` | **119** |
| 8 CONSTITUENCY | `82,94,129,131` | 47 |
| 11 ECM_TEAM | `45,82,94,113,117,119,120,129,131` | 35 |
| 14 PARLIAMENT PARTY PRESIDENT | `82,94,129,131` | 33 |
| 16 PROGRAM COMMITTEE | `129,131,133` | 25 |
| 16 PROGRAM COMMITTEE | `45,94,95,113,116,117,119,120,129,131,133` | 25 |
| 3 MINISTER | `82,94,129,131` | 19 |
| 6 MP | `82,94,129,131` | 15 |
| 18 OTHERS | `103,110` | 13 |
| 16 PROGRAM COMMITTEE | `17,19,45,47,…,131,133` (25 components) | 11 |
| 15 ZONAL COORDINATOR | `82,94,129,131` | 6 |
| 18 OTHERS | *(none)* | 3 |
| 18 OTHERS | `82` | 2 |

What this tells you:

- **One canonical bundle dominates.** `{82, 94, 129, 131}` is held by **410 of 553 members (74%)** spanning **7 different roles** (OBSERVER, MLA, CONSTITUENCY, PARLIAMENT PARTY PRESIDENT, MINISTER, MP, ZONAL COORDINATOR). Role and component set are **decoupled** — knowing someone is an MLA tells you nothing extra about their widgets.
- **`PROGRAM COMMITTEE` (16) is internally inconsistent** — its 62 members split across at least three different bundles (3, 11, and 25 components). Same nominal role, wildly different access. This is the clearest candidate for cleanup.
- **`OTHERS` (18) is a junk drawer** — 27 members across ≥3 signatures, including **3 members with no components at all**.
- **The data is begging for a "role template" concept.** Since 74% of users are one of a handful of bundles, the Add-Login flow should offer *"apply standard bundle"* presets rather than 133 checkboxes.

---

## 5. Consequences for the admin dashboard build

1. **Drive everything from `activity_member` (1,426 rows), never from `tdp_cadre` (22.5M).** Join outward to the cadre for name/mobile/membership.
2. **Use `is_acitve` (misspelled) on `activity_member`; `is_active` on the level/type junctions; `is_valid` on the component junction.** Three different names for the same idea, all real.
3. **Drop `user`, `user_groups`, `user_group` from the design entirely.** They are legacy/unlinked. If the console ever needs them, that's a separate decision with a separate schema conversation.
4. **Treat `activity_member_enrollment` as dead** — don't render "2016-2018" as if it were meaningful.
5. **Component labels need a 3-level fallback** (`dashboard_display_name → actual_name → name`) because 89/133 lack a display name, and the UI must handle Telugu text.
6. **Validate `activity_location_value` against the geography table for the chosen level before insert.** No FK protects you; a bad value = a silently empty dashboard.
7. **Never hard-code lookup IDs.** The frontend's 8 `roleDefs` match **none** of the 17 real `user_type` rows, and its `levelOrder` invents a BOOTH level that doesn't exist. These must be replaced by lookup endpoints before any write path is built.
8. **Add an index on `activity_member_component(activity_member_id)`** if that table is ever going to grow — it has only a PRIMARY key today. *(Schema change — needs owner approval; out of scope for the read-only console.)*

## 6. Security notes (pre-existing, not introduced here)

- The `.env` credentials are **`root` on the production cluster**. Get a least-privilege app user before go-live: SELECT on lookups/geography, SELECT/INSERT/UPDATE on the six write tables, no DDL, no DELETE.
- **`user.password` holds plaintext passwords** across 76,781 rows. Not this dashboard's table, but someone owns it and should know.
