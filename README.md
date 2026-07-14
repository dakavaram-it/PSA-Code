# User Admin Console

React admin console for the `activity_member` login system, backed by a **read-only**
API over the live `dakavara_pa` database. The table, overview stats, detail view, audit
list, and the create-flow MID lookup all show **real data**. Create / edit / OTP / Groups
remain client-side mocks (see *What's live vs mock* below).

## Repo layout

```
.
├── .env                 # LIVE DB credentials — git-ignored, never commit
├── .env.example         # template; copy to .env and fill in
├── Backend/             # read-only FastAPI + PyMySQL API (port 4000)
│   ├── main.py
│   └── requirements.txt
├── Frontend/            # Vite + React app (port 5173)
│   ├── index.html
│   ├── src/App.jsx      # the console (reads live data via src/data/api.js)
│   ├── src/data/api.js  # fetch client for the API
│   └── src/data/mockData.js  # legacy mock (superseded by api.js; unused)
├── Backend.md           # full backend/data-layer reference + query rationale
├── Admin_Dashboard_Table_Report.md          # live table inspection report
└── Dakavara_PA_Dashboard_User_Creation_Reference.md  # write-flow reference (future)
```

## Run

Two terminals. Backend first (the frontend fetches from it on load):

```
# 1. Backend  — reads ../.env, serves http://localhost:4000
cd Backend
python -m venv .venv && .venv\Scripts\activate   # Windows (macOS/Linux: source .venv/bin/activate)
pip install -r requirements.txt
python main.py                                   # or: uvicorn main:app --port 4000

# 2. Frontend — http://localhost:5173
cd Frontend
npm install
npm run dev
```

Open http://localhost:5173. If the API is down you'll see a "Could not reach the API" screen.

The frontend defaults to `http://localhost:4000/api`; override with a `VITE_API_BASE` env var.

## ⚠ Before you push / go to production

- **`.env` holds live production credentials and is git-ignored.** After `git init`, run
  `git status` and confirm `.env` is **not** listed before your first commit. Share config via
  `.env.example` only.
- **Use a least-privilege read-only DB user**, not `root`. The console never writes:
  `GRANT SELECT ON dakavara_pa.* TO 'ua_dashboard_ro'@'%';` then point `.env` at it. [Backend.md §1]

## What's live vs mock

| Area | Status | Source |
|---|---|---|
| Logins table, filters, Overview KPIs, Audit | **Live** | `GET /api/members` |
| Detail view (identity, role, scope, components) | **Live (read)** | `GET /api/members/:id` |
| Role / level / component lookups | **Live** | `GET /api/lookups/*` |
| Create-flow MID lookup (step 1) | **Live (read)** | `GET /api/cadre/:mid` |
| Create / edit / activate / OTP | **Mock** | client state only — no write API yet |
| **Groups** | **Mock** | left for now — no schema link exists [report §3.11–3.12] |

The write path (creating users, OTP) is documented in
`Dakavara_PA_Dashboard_User_Creation_Reference.md` and is a separate, authenticated API
for later — this layer is read-only.

## The three status flags (all real, all spelled differently)

| Flag | Table | Meaning |
|---|---|---|
| `is_acitve` (misspelled, verbatim) | activity_member | account active |
| `is_active` | access_type / access_level | role/scope grant active |
| `is_valid` | activity_member_component | component grant valid |

## More

`Backend.md` has the full data contract, every read query with live samples, the field-by-field
mapping to the UI, and gotchas (the `is_acitve` typo, `group_concat_max_len`, the untyped
`activity_location_value`, UTF-8/Telugu labels).
