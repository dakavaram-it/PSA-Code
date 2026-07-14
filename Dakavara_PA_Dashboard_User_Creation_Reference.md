# Dakavara PA — Dashboard User Creation
## Complete Technical Reference: Database Schema, Tables, Connections & Usage

> Source: *Dakavara PA — Dashboard User Creation, Technical Reference (Generated 27 June 2026)*
> Status: Confidential — Internal Use Only
> This document captures every table, every column, every foreign-key connection, and the full creation/verification/maintenance workflow described in the source PDF, plus the dependency logic that makes the pieces fit together.

---

## 1. The Big Picture

Dashboard user creation is a **6-step insert process** touching **9 tables** organised into **two parallel tracks**.

| Track | Purpose | Tables |
|-------|---------|--------|
| **Track 1** | Identity & Authentication | `tdp_cadre`, `login_otp_details` |
| **Track 2** | Dashboard Access & Permissions | `activity_member`, `activity_member_component`, `activity_member_access_level`, `activity_member_access_type` |
| **Lookups** (shared, read-only during creation) | Master data queried before assignment | `component`, `user_level`, `user_type` |

**Critical rule:** All 6 core insert steps are required. Miss any one and the user either **cannot log in** or logs into a **blank/inaccessible dashboard**.

### 9 tables = 6 written + 3 read

A common misread of the source: it says "9 tables" and "6 steps". These reconcile as follows — the 3 lookup tables (`component`, `user_level`, `user_type`) are **never inserted into** during user creation. They are queried to obtain valid IDs, then those IDs are written into the junction tables. So:

- **6 tables receive INSERTs**: `tdp_cadre`, `login_otp_details`, `activity_member`, `activity_member_component`, `activity_member_access_level`, `activity_member_access_type`
- **3 tables are read-only lookups**: `component`, `user_level`, `user_type`

---

## 2. Connection Map (How the tables wire together)

```
                          ┌─────────────────────┐
                          │      tdp_cadre       │  ← identity root
                          │  PK tdp_cadre_id     │
                          └──────────┬──────────┘
                                     │ tdp_cadre_id (FK)
                 ┌───────────────────┼────────────────────┐
                 │                                          │
        ┌────────▼─────────┐                     ┌─────────▼──────────┐
        │ login_otp_details│                     │  activity_member   │  ← dashboard profile
        │ FK tdp_cadre_id  │                     │  PK activity_member_id
        └──────────────────┘                     │  FK tdp_cadre_id   │
        (Track 1: auth)                           │  FK user_id (opt)  │
                                                  │  FK state_id       │
                                                  └─────────┬──────────┘
                                                            │ activity_member_id (FK)
                    ┌───────────────────────────────────────┼───────────────────────────────┐
                    │                                        │                               │
      ┌─────────────▼──────────────┐   ┌────────────────────▼───────────┐   ┌────────────────▼────────────────┐
      │ activity_member_component  │   │ activity_member_access_level   │   │ activity_member_access_type      │
      │ FK activity_member_id      │   │ FK activity_member_id          │   │ FK activity_member_id            │
      │ FK component_id ───────────┼─┐ │ FK activity_member_level_id ─┐ │   │ FK user_type_id ───────────────┐ │
      └────────────────────────────┘ │ │ activity_location_value       │ │   └──────────────────────────────┼─┘
                                     │ └───────────────────────────────┘ │                                  │
                          component_id (FK)                  user_level_id (FK)                    user_type_id (FK)
                                     │                                    │                                  │
                          ┌──────────▼──────────┐          ┌──────────────▼─────────┐        ┌───────────────▼────────┐
                          │   component (lookup) │          │   user_level (lookup)  │        │   user_type (lookup)   │
                          │   132 entries        │          │   up to 9 levels       │        │   16 types             │
                          └─────────────────────┘          └────────────────────────┘        └────────────────────────┘
```

### Every foreign-key relationship, listed

| From table | FK column | → To table | → PK column | Meaning |
|------------|-----------|-----------|-------------|---------|
| `tdp_cadre` | `inserted_web_user_id` | `user` | (user PK) | Admin who created the cadre record |
| `login_otp_details` | `tdp_cadre_id` | `tdp_cadre` | `tdp_cadre_id` | The member requesting login |
| `activity_member` | `tdp_cadre_id` | `tdp_cadre` | `tdp_cadre_id` | Identity behind the dashboard account |
| `activity_member` | `user_id` | `user` | (user PK) | Optional — only for web dashboard login |
| `activity_member` | `state_id` | (state table) | (state PK) | Base state scope for the member's data view |
| `activity_member_component` | `activity_member_id` | `activity_member` | `activity_member_id` | Which user the grant belongs to |
| `activity_member_component` | `component_id` | `component` | `component_id` | Which widget/tab is granted |
| `activity_member_access_level` | `activity_member_id` | `activity_member` | `activity_member_id` | Which user the scope belongs to |
| `activity_member_access_level` | `activity_member_level_id` | `user_level` | `user_level_id` | Which hierarchy level |
| `activity_member_access_type` | `activity_member_id` | `activity_member` | `activity_member_id` | Which user the role belongs to |
| `activity_member_access_type` | `user_type_id` | `user_type` | `user_type_id` | Which role type is assigned |

Note: `activity_location_value` in `activity_member_access_level` is **not a declared FK**. It's a raw integer whose meaning depends on `activity_member_level_id` (e.g. if level = CONSTITUENCY, the value is a `constituency_id`). This is a polymorphic reference — the DB won't enforce its integrity, so a mismatch silently produces an empty dashboard.

---

## 3. Table-by-Table Reference

### 3.1 `tdp_cadre` — Central identity record

Every TDP member. `membership_id` is the login key; `mobile_no` is the OTP delivery channel.

| Column | Type | Description |
|--------|------|-------------|
| `tdp_cadre_id` (PK) | bigint | Auto-increment primary key |
| `membership_id` | varchar(10) | Short login key — the **MID** entered at login (must be unique) |
| `membership_no` | varchar(45) | Full membership number (longer format) |
| `first_name` / `last_name` | varchar(200) | Member's full name |
| `mobile_no` | varchar(15) | Mobile number — **OTP is sent here** |
| `gender` | enum('M','F') | Gender of cadre member |
| `date_of_birth` / `age` | date / int | DOB and computed age |
| `constituency_id` | int | Constituency where member is enrolled |
| `is_deleted` | enum | `N` = active. `Y/H/NA/AR/T/MD/O/A/I/P` = inactive states |
| `payment_status` | enum | `PAID` / `NOT PAID` / `NR` |
| `data_source_type` | enum | `WEB / TAB / ONLINE / ANDROID / IOS / WA / TBot / MTAPP` |
| `inserted_web_user_id` (FK) | bigint | FK to `user` — admin who created this record |

### 3.2 `login_otp_details` — OTP store for login flow

One row per OTP request. `is_valid` tracks whether the OTP is still usable.

| Column | Type | Description |
|--------|------|-------------|
| `otp_details_id` (PK) | bigint | Auto-increment primary key |
| `tdp_cadre_id` (FK) | bigint | FK to `tdp_cadre` — the member requesting login |
| `membership_id` | varchar(15) | **Denormalised** MID for fast lookup without join |
| `mobile_no` | varchar(15) | Mobile number the OTP was sent to |
| `otp` | varchar(45) | The 6-digit generated OTP |
| `generated_time` | datetime | When OTP created — enforces 10-min expiry |
| `updated_time` | datetime | When `is_valid` was last changed |
| `is_valid` | enum('Y','N') | `Y` = active. `N` = used or expired |

### 3.3 `activity_member` — Dashboard user profile

Links a `tdp_cadre` record to the dashboard system. **This row is what makes someone a dashboard user.**

| Column | Type | Description |
|--------|------|-------------|
| `activity_member_id` (PK) | bigint | Auto-increment primary key |
| `tdp_cadre_id` (FK) | bigint | FK to `tdp_cadre` — the identity behind this account |
| `user_id` (FK) | bigint | FK to `user` — **optional**, only for web dashboard login |
| `member_name` | varchar(200) | Display name shown in dashboard UI |
| `image_url` | varchar(450) | Profile photo URL (optional) |
| `state_id` (FK) | bigint | Base state scope for this member's data view |
| `is_acitve` | enum('Y','N') | `Y` = active. `N` = deactivated. **⚠ Column name typo (`is_acitve`) is intentional in the DB — must be used verbatim in all queries.** |

### 3.4 `component` — Lookup (132 entries)

Master list of all dashboard widgets, tabs, and UI components. **Query before assigning.**

| Column | Type | Description |
|--------|------|-------------|
| `component_id` (PK) | int | Auto-increment PK (up to 132) |
| `name` | varchar(60) | Internal component name |
| `actual_name` | varchar(60) | Technical name used in code |
| `dashboard_display_name` | varchar(60) | Label shown to users in dashboard UI |
| `order_no` | int | Display order in dashboard menu |

### 3.5 `activity_member_component` — Junction (11,477+ rows)

Grants a dashboard component to an `activity_member`. One row per component per user.

| Column | Type | Description |
|--------|------|-------------|
| `activity_member_component_id` (PK) | int | Auto-increment PK |
| `activity_member_id` (FK) | bigint | FK to `activity_member` |
| `component_id` (FK) | int | FK to `component` — which widget is granted |
| `is_valid` | enum('Y','N') | `Y` = enabled. `N` = revoked |

### 3.6 `user_level` — Lookup (up to 9 levels)

Geographic hierarchy levels for access scoping.

| Column | Type | Description |
|--------|------|-------------|
| `user_level_id` (PK) | int | Auto-increment PK (up to 9) |
| `level` | varchar(50) | Level name — e.g. STATE, DISTRICT, CONSTITUENCY, MANDAL, BOOTH |

### 3.7 `activity_member_access_level` — Junction (1,848+ rows)

Geographic data scope for a dashboard user. Combines a level with the specific location ID at that level.

| Column | Type | Description |
|--------|------|-------------|
| `activity_member_access_level_id` (PK) | bigint | Auto-increment PK |
| `activity_member_id` (FK) | bigint | FK to `activity_member` |
| `activity_member_level_id` (FK) | int | FK to `user_level` — the hierarchy level |
| `activity_location_value` | int | The actual ID at that level (e.g. `constituency_id` = 42). **Not a declared FK — meaning depends on the level.** |
| `is_active` | enum('Y','N') | `Y` = active scope. `N` = revoked |

### 3.8 `user_type` — Lookup (16 types)

Defines user types (e.g. ADMIN, ANALYST, FIELD, VIEWER). Controls available actions and data views.

| Column | Type | Description |
|--------|------|-------------|
| `user_type_id` (PK) | int | Auto-increment PK (up to 16) |
| `type` | varchar(45) | Full type name — e.g. ADMIN, ANALYST, FIELD, VIEWER |
| `short_name` | varchar(25) | Abbreviated name used in code |
| `order_no` | int | Display order in dropdowns |

### 3.9 `activity_member_access_type` — Junction (1,373+ rows)

Assigns one or more `user_type`s to an `activity_member`. Controls role-level behaviour.

| Column | Type | Description |
|--------|------|-------------|
| `activity_member_access_type_id` (PK) | bigint | Auto-increment PK |
| `activity_member_id` (FK) | bigint | FK to `activity_member` |
| `user_type_id` (FK) | int | FK to `user_type` — the assigned role type |
| `is_active` | enum('Y','N') | `Y` = active. `N` = revoked |

---

## 4. The 6-Step Creation Workflow

Each step uses an `@variable` set by `LAST_INSERT_ID()` from the previous step. **Order is mandatory** because each junction row needs the `activity_member_id` produced in Step 3, which itself needs the `tdp_cadre_id` from Step 1.

### Dependency chain
```
Step 1 (tdp_cadre)  ──► @cadre_id
        │
        ├─► Step 2 (login_otp_details)   uses @cadre_id
        │
        └─► Step 3 (activity_member)     uses @cadre_id ──► @member_id
                    │
                    ├─► Step 4 (activity_member_component)      uses @member_id + component_id
                    ├─► Step 5 (activity_member_access_level)   uses @member_id + user_level_id
                    └─► Step 6 (activity_member_access_type)    uses @member_id + user_type_id
```

### Step 1 — Create `tdp_cadre` record [REQUIRED]
`membership_id` and `mobile_no` are the login credentials.

```sql
INSERT INTO tdp_cadre (
  membership_id,          -- short login key e.g. 'MID10042'
  membership_no,          -- full number e.g. 'TDPMEM20240010042'
  first_name, last_name,
  relative_name, relative_type,   -- 'S' = son of
  mobile_no,              -- OTP sent here
  gender,                 -- 'M' or 'F'
  date_of_birth, age,
  constituency_id,
  enrollment_year, party_member_since,
  is_deleted,             -- 'N' = active
  payment_status,         -- 'PAID'
  data_source_type,       -- 'WEB'
  inserted_time, update_time,
  inserted_web_user_id    -- admin user_id doing this insert
)
VALUES (
  'MID10042', 'TDPMEM20240010042',
  'Ravi', 'Kumar', 'Suresh Kumar', 'S',
  '9876543210', 'M', '1985-06-15', 39,
  42, 2024, '2010-01-01',
  'N', 'PAID', 'WEB',
  NOW(), NOW(), 101
);
SET @cadre_id = LAST_INSERT_ID();
```
> `membership_id` must be **unique**. `mobile_no` must be valid — OTP delivery depends on it.

### Step 2 — Generate OTP for first login [REQUIRED]
The app looks up `mobile_no` from `tdp_cadre`, generates an OTP, sends it via SMS, and stores it here.

```sql
-- Always invalidate any existing OTP first
UPDATE login_otp_details
SET is_valid = 'N', updated_time = NOW()
WHERE tdp_cadre_id = @cadre_id AND is_valid = 'Y';

-- Insert newly generated OTP
INSERT INTO login_otp_details (
  tdp_cadre_id, membership_id, mobile_no,
  otp, generated_time, updated_time, is_valid
)
VALUES (
  @cadre_id, 'MID10042', '9876543210',
  '738291',               -- 6-digit OTP generated in app layer
  NOW(), NOW(), 'Y'
);
```
> OTP expiry (typically 10 min) is enforced in **app logic** using `generated_time`. Always invalidate old OTPs before inserting a new one.

### Step 3 — Enroll as `activity_member` [REQUIRED]
Without this row, the user has **no dashboard access** regardless of `tdp_cadre` status.

```sql
INSERT INTO activity_member (
  tdp_cadre_id,
  user_id,        -- NULL for mobile-only; set for web login
  member_name,    -- display name in dashboard UI
  image_url,      -- profile photo URL (optional)
  state_id,       -- base state scope (e.g. 1 = Andhra Pradesh)
  inserted_time, is_acitve
)
VALUES (
  @cadre_id, NULL, 'Ravi Kumar',
  NULL, 1, NOW(), 'Y'
);
SET @member_id = LAST_INSERT_ID();
```
> `user_id` is NULL for mobile-only users. Set it only when the member also needs web dashboard login via the `user` table.

### Step 4 — Assign dashboard components [REQUIRED]
One row per component. Query `component` (132 entries) first.

```sql
-- Query available components first
SELECT component_id, dashboard_display_name, order_no
FROM component ORDER BY order_no;

-- Grant components to the member
INSERT INTO activity_member_component
  (activity_member_id, component_id, is_valid)
VALUES
  (@member_id, 1, 'Y'),
  (@member_id, 5, 'Y'),
  (@member_id, 12, 'Y'),
  (@member_id, 23, 'Y');

-- To revoke a component later:
UPDATE activity_member_component SET is_valid = 'N'
WHERE activity_member_id = @member_id AND component_id = 5;
```
> Most users get **5–15 components**. Always check `component` before assigning IDs.

### Step 5 — Set geographic access level [REQUIRED]
Query `user_level` first to find correct level IDs.

```sql
-- Query available levels first
SELECT user_level_id, level FROM user_level;
-- e.g. 1=STATE, 2=DISTRICT, 3=CONSTITUENCY, 4=MANDAL, 5=BOOTH

-- Set constituency-level access
INSERT INTO activity_member_access_level (
  activity_member_id,
  activity_member_level_id,   -- FK to user_level
  activity_location_value,    -- actual ID at that level
  is_active
)
VALUES (@member_id, 3, 42, 'Y');
-- level 3 = CONSTITUENCY, 42 = Vijayawada East constituency_id

-- For district-level user:
INSERT INTO activity_member_access_level
  (activity_member_id, activity_member_level_id, activity_location_value, is_active)
VALUES (@member_id, 2, 7, 'Y');
-- level 2 = DISTRICT, 7 = Krishna district_id
```
> `activity_location_value` **must** match a real geographic ID for the chosen level. Mismatch = **empty dashboard** (no error thrown).

### Step 6 — Set user type access [REQUIRED]
Query `user_type` (16 types) first.

```sql
-- Query available user types first
SELECT user_type_id, type, short_name FROM user_type ORDER BY order_no;

-- Assign type(s) to the member
INSERT INTO activity_member_access_type
  (activity_member_id, user_type_id, is_active)
VALUES
  (@member_id, 3, 'Y');   -- e.g. ANALYST

-- Multiple types:
INSERT INTO activity_member_access_type
  (activity_member_id, user_type_id, is_active)
VALUES
  (@member_id, 5, 'Y'),   -- FIELD
  (@member_id, 7, 'Y');   -- REPORT_VIEWER

-- Deactivate a type later:
UPDATE activity_member_access_type SET is_active = 'N'
WHERE activity_member_id = @member_id AND user_type_id = 5;
```
> `user_type` has 16 entries. Verify names in the DB before assigning — they drive permission behaviour in the app.

---

## 5. OTP Verification Flow (every login, new or existing)

### Step A — Look up mobile from MID
```sql
SELECT tdp_cadre_id, mobile_no
FROM tdp_cadre
WHERE membership_id = 'MID10042'
  AND is_deleted = 'N';
```

### Step B — Validate submitted OTP
```sql
SELECT otp_details_id, tdp_cadre_id
FROM login_otp_details
WHERE membership_id = 'MID10042'
  AND otp = '738291'
  AND is_valid = 'Y'
  AND generated_time >= DATE_SUB(NOW(), INTERVAL 10 MINUTE);

-- If row returned -> OTP valid -> mark consumed
UPDATE login_otp_details
SET is_valid = 'N', updated_time = NOW()
WHERE otp_details_id = @verified_otp_id;
```
> No rows returned = OTP wrong, expired, or already used. **Do NOT log in.** Enforce retry limits in app logic.

### Step C — Load `activity_member` profile for session
```sql
SELECT
  am.activity_member_id, am.member_name,
  am.state_id, am.is_acitve,
  tc.membership_id, tc.first_name, tc.last_name
FROM activity_member am
JOIN tdp_cadre tc ON tc.tdp_cadre_id = am.tdp_cadre_id
WHERE tc.membership_id = 'MID10042'
  AND am.is_acitve = 'Y'
  AND tc.is_deleted = 'N';
```

---

## 6. Reference & Maintenance Queries

### List all active dashboard users
```sql
SELECT
  tc.membership_id, tc.first_name, tc.last_name,
  tc.mobile_no, am.member_name, am.is_acitve,
  am.state_id, am.inserted_time
FROM activity_member am
JOIN tdp_cadre tc ON tc.tdp_cadre_id = am.tdp_cadre_id
WHERE am.is_acitve = 'Y'
  AND tc.is_deleted = 'N'
ORDER BY am.inserted_time DESC;
```

### Get full profile of a dashboard user
```sql
SELECT
  tc.membership_id, tc.first_name, tc.last_name,
  tc.mobile_no, am.member_name, am.is_acitve,
  ul.level AS access_level,
  amal.activity_location_value AS location_id,
  ut.type AS user_type,
  c.dashboard_display_name AS component
FROM activity_member am
JOIN tdp_cadre tc ON tc.tdp_cadre_id = am.tdp_cadre_id
LEFT JOIN activity_member_access_level amal
  ON amal.activity_member_id = am.activity_member_id AND amal.is_active = 'Y'
LEFT JOIN user_level ul ON ul.user_level_id = amal.activity_member_level_id
LEFT JOIN activity_member_access_type amat
  ON amat.activity_member_id = am.activity_member_id AND amat.is_active = 'Y'
LEFT JOIN user_type ut ON ut.user_type_id = amat.user_type_id
LEFT JOIN activity_member_component amc
  ON amc.activity_member_id = am.activity_member_id AND amc.is_valid = 'Y'
LEFT JOIN component c ON c.component_id = amc.component_id
WHERE tc.membership_id = 'MID10042';
```
> This uses `LEFT JOIN`s deliberately: a user with no components/levels/types still returns their base row. Note it produces a **Cartesian fan-out** — one row per (component × level × type) combination — so a user with 10 components, 2 levels, and 3 types returns 60 rows. De-duplicate in the app or aggregate with `GROUP_CONCAT`.

### Deactivate a dashboard user
```sql
-- Disable activity_member
UPDATE activity_member SET is_acitve = 'N'
WHERE tdp_cadre_id = @cadre_id;

-- Invalidate all active OTPs
UPDATE login_otp_details
SET is_valid = 'N', updated_time = NOW()
WHERE tdp_cadre_id = @cadre_id AND is_valid = 'Y';
```
> Deactivation flips `is_acitve` and kills live OTPs but leaves component/level/type grants intact — they're gated behind the inactive `activity_member`, so no separate cleanup is required to block access.

---

## 7. Traps & Gotchas (things that will bite you)

1. **`is_acitve` is misspelled on purpose.** Every query against `activity_member` must use `is_acitve`, not `is_active`. The *junction* tables (`..._access_level`, `..._access_type`) correctly use `is_active` — so the same conceptual flag has two spellings depending on the table. Mixing them up is a silent bug.

2. **`activity_location_value` has no referential integrity.** It's an untyped int whose meaning is set by `activity_member_level_id`. A valid-looking number at the wrong level yields an **empty dashboard with no error**.

3. **Insert order is not optional.** Steps 4–6 all depend on `@member_id` from Step 3, which depends on `@cadre_id` from Step 1. Run out of order and the FKs point at nothing.

4. **Lookup-before-insert is mandatory for Steps 4, 5, 6.** IDs in `component`, `user_level`, `user_type` are environment-specific. Hard-coding IDs from this document (or another environment) can grant the wrong widgets/scope/role.

5. **OTP expiry lives in app logic, not the DB.** The 10-minute window is enforced by the `generated_time >= DATE_SUB(NOW(), INTERVAL 10 MINUTE)` predicate at query time, not by any DB job. If the app forgets that predicate, expired OTPs validate.

6. **`membership_id` type mismatch across tables.** It's `varchar(10)` in `tdp_cadre` but `varchar(15)` in `login_otp_details` (denormalised copy). Values fit, but be aware they're independent columns kept in sync by the app, not by an FK.

7. **All 6 steps required for a working user.** Skipping Step 3 → no dashboard. Skipping 4 → blank dashboard. Skipping 5 → empty (unscoped) data. Skipping 6 → no role behaviour. Skipping 2 → can't complete first login.

---

## 8. One-Glance Summary

| # | Step | Table written | Depends on | Lookup first? |
|---|------|---------------|------------|---------------|
| 1 | Create identity | `tdp_cadre` | — | No |
| 2 | Generate OTP | `login_otp_details` | @cadre_id | No |
| 3 | Create dashboard profile | `activity_member` | @cadre_id | No |
| 4 | Grant components | `activity_member_component` | @member_id | `component` |
| 5 | Set geo scope | `activity_member_access_level` | @member_id | `user_level` |
| 6 | Assign role types | `activity_member_access_type` | @member_id | `user_type` |

**Track 1 (auth):** `tdp_cadre` → `login_otp_details`
**Track 2 (access):** `activity_member` → {`_component`, `_access_level`, `_access_type`} → {`component`, `user_level`, `user_type`}
