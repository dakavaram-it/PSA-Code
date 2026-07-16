# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A **mostly read-only** admin console for the `activity_member` login system in the live `dakavara_pa`
production database (AWS RDS, MySQL 8.0.42). It has two parts:

- `Backend/` — FastAPI + PyMySQL, 6 GET-only endpoints plus 2 narrow PUT (write) endpoints, port 4000.
- `Frontend/` — Vite + React (JS, not TS), port 5173, Tailwind for styling.

GET endpoints use `connect()`, which issues `SET SESSION TRANSACTION READ ONLY` on every connection
and only ever runs `SELECT`. Two endpoints are a deliberate, narrow exception — `PUT
/api/members/{id}/role` and `PUT /api/members/{id}/active` — added to back the "New login"
existing-login panel's role-change and activate/deactivate controls. They use a separate
`connect_write()` (no read-only pragma) and are the *only* place in this codebase that writes to the
DB. **Do not widen this** — no other INSERT/UPDATE/DELETE/DDL, and no new write endpoints, without
being asked. Everything else that looks like a write in the UI (bulk activate/deactivate on the
Users screen, the role/mobile/level/location edits on the Detail screen, full account creation) is
still an intentionally client-side mock with no write API behind it (see
`Dakavara_PA_Dashboard_User_Creation_Reference.md` for the planned full write path, still out of
scope). **There is no authentication in front of the backend** — anyone who can reach it can call
the two write endpoints; treat this as a real gap, not a formality, before this is ever exposed
outside a trusted network. The Groups screen is also fully mock — `user_groups`/`user_group` tables
exist but have no FK link to `activity_member`, so there is nothing real to wire up.

## Run / dev commands

Two terminals, backend first (frontend fetches from it on load):

```
# Backend — reads ../.env, serves http://localhost:4000
cd Backend
python -m venv .venv && .venv\Scripts\activate   # Windows
pip install -r requirements.txt
python main.py                                    # or: uvicorn main:app --port 4000 --reload

# Frontend — http://localhost:5173
cd Frontend
npm install
npm run dev
```

Other frontend scripts: `npm run build` (vite build), `npm run preview`.

There is no test suite and no linter configured in this repo currently.

The frontend defaults to `VITE_API_BASE=http://localhost:4000/api`; override via env var if needed.
If the backend is down, the UI shows a "Could not reach the API" screen instead of crashing.

## Environment / credentials

- `.env` at the repo root holds **live production DB credentials** and is git-ignored. Copy
  `.env.example` to create it. Never put real credentials in tracked files.
- `Backend/main.py` loads `../.env` relative to itself — it must be run with `Backend/` as the
  working directory (or via `python Backend/main.py` from root only if the relative path still
  resolves — the documented way is `cd Backend && python main.py`).
- Vars: `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`.
- Use a least-privilege read-only DB user in production (`GRANT SELECT ON dakavara_pa.*`), not
  `root`.

## Architecture

### Data model (the only chain the dashboard cares about)

```
tdp_cadre (22.5M rows — the person; NEVER scanned, point-lookup by membership_id only)
   │ tdp_cadre_id
   ▼
activity_member (~1.4k rows)  ← THE LOGIN. Everything is driven from here.
   ├── activity_member_access_type  → user_type   (role: MLA, OBSERVER, …)
   ├── activity_member_access_level → user_level  (geographic scope + untyped location int)
   └── activity_member_component    → component   (granted dashboard widgets)
```

`user`, `user_groups`, `user_group`, `activity_member_enrollment` are legacy/unlinked/dead — ignore
them. Full schema, live samples, and query rationale are in `Backend.md`.

### The three status flags — real, and deliberately spelled differently. Do not "fix" the typo

| Table | Column | Meaning |
|---|---|---|
| `activity_member` | `is_acitve` (misspelled, verbatim in the DB) | account active |
| `activity_member_access_type` / `activity_member_access_level` | `is_active` | role/scope grant active |
| `activity_member_component` | `is_valid` | component grant valid |

### Backend (`Backend/main.py`)

Single file, no ORM. `MEMBER_SELECT` is the one query that matters — it joins
`activity_member → tdp_cadre → access_type/access_level/component` and `GROUP_CONCAT`s
component ids into a comma string per login, collapsing the member×role×component fan-out into one
row per login. `shape()` turns that comma string into an `int[]` before returning JSON. Every GET
endpoint opens a fresh per-request connection (`connect()`) — thread-safe under uvicorn's pool, and
each connection is forced read-only at the session level as belt-and-braces. The two PUT endpoints
use `connect_write()` instead (no read-only pragma, explicit `commit()`), and re-run `MEMBER_SELECT`
after writing so the response always reflects the post-write row.

Endpoints: `GET /api/members` (`?status=all|active|inactive`), `GET /api/members/{id}`,
`GET /api/lookups/user-types`, `GET /api/lookups/user-levels`, `GET /api/lookups/components`,
`GET /api/cadre/{mid}`, `PUT /api/members/{id}/role` (`{user_type_id}`), `PUT /api/members/{id}/active`
(`{is_active: "Y"|"N"}`).

### Frontend

- Entry point is `Frontend/src/main.jsx` → renders `AdminConsole` from `Frontend/src/App.jsx`. This
  is the live app.
- **`Frontend/AdminConsole.jsx` (root-level, outside `src/`) is a standalone earlier prototype/artifact
  version with inlined mock data — it is not part of the Vite build and is not imported by anything.**
  Don't edit it expecting it to affect the running app; treat `Frontend/src/App.jsx` as the source of
  truth.
- `Frontend/src/data/api.js` is the only place that talks to the backend; every function returns the
  same shape the old mock generators produced, so `App.jsx` doesn't know or care that data is live.
  `Frontend/src/data/mockData.js` is legacy and unused, superseded by `api.js`.
- `App.jsx` is a single large file containing the whole console: lookups are fetched once at startup
  into module-scope `let USER_TYPES/USER_LEVELS/COMPONENTS` (avoids prop-drilling), then screens are
  plain functions switched on a `screen` state string inside `AdminConsole()` — `Overview`,
  `UsersScreen`, `DetailScreen`, `GroupsScreen`/`GroupEditor` (mock), plus `OtpModal` and
  `CreateScreen` (mostly mock — its existing-login panel calls the two real PUT endpoints above).
  Small shared UI atoms (`Card`, `StatusPill`, `RoleBadge`, `Field`, `Ring`, etc.) live at the top of
  the same file.
- `Frontend/src/lib/utils.js` exports `cn()` (clsx + tailwind-merge) — use it whenever composing
  conditional Tailwind classes, matching the "Smart AI Interview / Jobseeker" design system already
  used throughout (warm white background, yellow/amber/orange gradients, rounded-2xl cards, pill CTAs).
- Groups (`GroupsScreen`, `INITIAL_GROUPS`, `effectiveComponents()`) are entirely frontend mock state
  — the schema has no member↔group or group↔component link. Don't try to wire this to the backend
  without a schema change.

## Reference docs (read before touching data-layer or write-flow code)

- `README.md` — repo layout and what's live vs. mock.
- `Backend.md` — full data contract: every read query with live samples, field-by-field mapping to
  the UI, and gotchas (the `is_acitve` typo, `group_concat_max_len`, the untyped
  `activity_location_value`, UTF-8/Telugu component labels).
- `Admin_Dashboard_Table_Report.md` — live table inspection report backing the "what's real vs
  invented" decisions in `App.jsx`'s header comment.
- `Dakavara_PA_Dashboard_User_Creation_Reference.md` — reference for the future authenticated write
  API (user creation, OTP); not implemented in this codebase.
