# Backend/main.py — data layer for the UA admin console.
# Python + FastAPI + PyMySQL. Powers the frontend with real dakavara_pa data.
# Most endpoints are SELECT-only. The write endpoints below cover full CRUD
# for a login (activity_member + its access_type/access_level/component
# grants): POST /api/members creates a login (and grants) for a cadre that
# doesn't have one yet, PUT .../role, .../level and .../active update an
# existing login's role, geographic scope and active flag, and DELETE
# /api/members/{id} soft-deletes a login by cascading is_active/is_valid='N'
# across every grant table (distinct from deactivate, which only flips
# activity_member.is_acitve and leaves grants intact for a later reactivate).
# There is still no authentication in front of this API — anyone who can
# reach it can call these write endpoints. Put this behind auth before it's
# exposed outside a trusted network.
# See Backend.md for the read contract and query rationale.
#
# Run:  pip install -r requirements.txt
#       python main.py            (or: uvicorn main:app --port 4000)
import os
from typing import List, Optional

import pymysql
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv(dotenv_path="../.env")  # repo-root .env (git-ignored)

DB = dict(
    host=os.environ["DB_HOST"],
    port=int(os.environ["DB_PORT"]),
    user=os.environ["DB_USER"],
    password=os.environ["DB_PASSWORD"],
    database=os.environ["DB_NAME"],
    charset="utf8mb4",              # component labels include Telugu
    cursorclass=pymysql.cursors.DictCursor,
    connect_timeout=15,
    read_timeout=30,
)


def connect():
    """Fresh read-only connection per request (thread-safe under uvicorn's pool)."""
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


def connect_write():
    """Read-write connection — used ONLY by the two mutation endpoints below.
    Every other endpoint in this file uses connect(), which is forced
    read-only at the session level; this one deliberately is not."""
    conn = pymysql.connect(**DB)
    with conn.cursor() as cur:
        cur.execute("SET SESSION group_concat_max_len = 8192")
    return conn


def run_write(sql, args=None):
    conn = connect_write()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args)
        conn.commit()
    finally:
        conn.close()


def run_write_tx(fn):
    """Run fn(cursor) as one committed transaction; rolls back on error.
    Used where several statements must land atomically (create, cascading delete)."""
    conn = connect_write()
    try:
        with conn.cursor() as cur:
            result = fn(cur)
        conn.commit()
        return result
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


# component_ids comes back as a comma string; the UI wants an int array.
def shape(r):
    ids = r.get("component_ids")
    r["component_ids"] = [int(x) for x in ids.split(",")] if ids else []
    return r


# S3 bucket cadre photos are stored under — tdp_cadre.image holds just the
# relative key (e.g. "152/AP1406574091.jpg"), NULL for the ~99 cadre with no photo on file.
CADRE_IMAGE_BASE = "https://imagesearch-projectkv.s3.amazonaws.com/cadre_images/"

# One row per login. Collapses the member×role×component fan-out in SQL. [Backend.md §5.1]
# location_name resolves location_value (untyped int) to a human name, same CASE logic as
# CADRE_BY_MOBILE_SELECT below: 'AP' for level 2 (state-wide), else the matching
# constituency.name for level 4/5 (empty string otherwise). Wrapped in MAX() like the other
# aggregated fields since this is a GROUP BY query — safe because a login has at most one
# active access_level grant, same assumption role_name/level_name already rely on.
MEMBER_SELECT = f"""
  SELECT AM.activity_member_id, AM.member_name, AM.tdp_cadre_id, AM.inserted_time,
         AM.updated_by, AM.is_acitve, TC.membership_id, TC.mobile_no,
         CONCAT("{CADRE_IMAGE_BASE}", TC.image) AS image_url,
         MAX(AMAT.user_type_id) AS role_id, MAX(UT.type) AS role_name, MAX(UT.short_name) AS role_short,
         MAX(AMAL.activity_member_level_id) AS level_id, MAX(UL.level) AS level_name,
         MAX(AMAL.activity_location_value) AS location_value,
         MAX(CASE WHEN AMAL.activity_member_level_id = 2 THEN 'AP'
                  WHEN AMAL.activity_member_level_id = 4 THEN PC.name
                  WHEN AMAL.activity_member_level_id = 5 THEN AC.name ELSE '' END) AS location_name,
         GROUP_CONCAT(DISTINCT AMC.component_id ORDER BY AMC.component_id) AS component_ids
  FROM activity_member AM
  LEFT JOIN tdp_cadre TC ON TC.tdp_cadre_id = AM.tdp_cadre_id
  LEFT JOIN activity_member_access_type AMAT ON AMAT.activity_member_id = AM.activity_member_id AND AMAT.is_active='Y'
  LEFT JOIN user_type UT ON UT.user_type_id = AMAT.user_type_id
  LEFT JOIN activity_member_access_level AMAL ON AMAL.activity_member_id = AM.activity_member_id AND AMAL.is_active='Y'
  LEFT JOIN user_level UL ON UL.user_level_id = AMAL.activity_member_level_id
  LEFT JOIN constituency PC ON AMAL.activity_location_value = PC.constituency_id AND AMAL.activity_member_level_id = 4
  LEFT JOIN constituency AC ON AMAL.activity_location_value = AC.constituency_id AND AMAL.activity_member_level_id = 5
  LEFT JOIN activity_member_component AMC ON AMC.activity_member_id = AM.activity_member_id AND AMC.is_valid='Y'
"""
GROUP_BY = """ GROUP BY AM.activity_member_id, AM.member_name, AM.tdp_cadre_id,
  AM.inserted_time, AM.updated_by, AM.is_acitve, TC.membership_id, TC.mobile_no, TC.image"""

# A login can actually hold more than one active access_level grant at once (e.g. an
# ASSEMBLY seat plus a PARLIAMENT seat). MEMBER_SELECT/MEMBERS_QUERY above still collapse
# that to a single MAX()'d level/location for backward compat, but the Detail screen wants
# every active location, so this fetches them separately and gets attached as `locations`.
MEMBER_LOCATIONS_QUERY = """
  SELECT AMAL.activity_member_id,
         AMAL.activity_member_level_id AS level_id, UL.level AS level_name,
         AMAL.activity_location_value AS location_value,
         CASE WHEN AMAL.activity_member_level_id = 2 THEN 'AP'
              WHEN AMAL.activity_member_level_id = 4 THEN PC.name
              WHEN AMAL.activity_member_level_id = 5 THEN AC.name ELSE '' END AS location_name
  FROM activity_member_access_level AMAL
  LEFT JOIN user_level UL ON UL.user_level_id = AMAL.activity_member_level_id
  LEFT JOIN constituency PC ON AMAL.activity_location_value = PC.constituency_id AND AMAL.activity_member_level_id = 4
  LEFT JOIN constituency AC ON AMAL.activity_location_value = AC.constituency_id AND AMAL.activity_member_level_id = 5
  WHERE AMAL.is_active = 'Y'
"""


def attach_locations(members_by_id):
    """members_by_id: {activity_member_id: member_dict}. Adds a `locations` list to each, in place."""
    ids = list(members_by_id.keys())
    for m in members_by_id.values():
        m["locations"] = []
    if not ids:
        return
    placeholders = ",".join(["%s"] * len(ids))
    rows = run(MEMBER_LOCATIONS_QUERY + f" AND AMAL.activity_member_id IN ({placeholders})", ids)
    for r in rows:
        members_by_id[r["activity_member_id"]]["locations"].append({
            "level_id": r["level_id"], "level_name": r["level_name"],
            "location_value": r["location_value"], "location_name": r["location_name"],
        })

app = FastAPI(title="UA admin API")
# PUT/POST/DELETE listed here too so re-enabling the commented-out write
# endpoints below doesn't also require remembering to update this line.
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "PUT", "POST", "DELETE"], allow_headers=["*"])


class RoleUpdate(BaseModel):
    user_type_id: int


class ActiveUpdate(BaseModel):
    is_active: str  # 'Y' or 'N'


class LevelUpdate(BaseModel):
    user_level_id: int
    location_value: Optional[int] = None


class MemberCreate(BaseModel):
    tdp_cadre_id: int
    user_type_id: int
    user_level_id: int
    location_value: Optional[int] = None
    component_ids: List[int] = []


# 1) member list  (?status=all|active|inactive, default active)
# Built on top of the member x cadre x component join originally supplied for
# this endpoint, extended with AM.is_acitve (so active/inactive can be told
# apart at all) and a role join (activity_member_access_type -> user_type, for
# "logins by role"). The component and role joins are LEFT JOINs rather than
# the original's inner joins — with inner joins, any login with zero granted
# components, or no active role, would vanish from the Active/Inactive counts
# entirely instead of just showing an empty role/component list, which would
# quietly undercount both KPIs. Same reasoning for TC: LEFT JOIN so a login
# whose tdp_cadre_id doesn't resolve still counts instead of disappearing.
# Query returns one row per login x component (or one row per login if it has
# no components); ROLLUP_MEMBERS below collapses that back into one object per
# login with a component_ids array, matching what the frontend expects.
MEMBERS_QUERY = f"""
  SELECT
    AM.activity_member_id, TC.tdp_cadre_id, CONCAT("#", TC.membership_id) AS membership_id,
    AM.member_name, TC.mobile_no, AM.is_acitve, AM.inserted_time, AM.updated_by,
    CONCAT("{CADRE_IMAGE_BASE}", TC.image) AS image_url,
    UT.user_type_id AS role_id, UT.type AS role_name, UT.short_name AS role_short,
    AMAL.activity_member_level_id AS level_id, UL.level AS level_name,
    AMAL.activity_location_value AS location_value,
    CASE WHEN AMAL.activity_member_level_id = 2 THEN 'AP'
         WHEN AMAL.activity_member_level_id = 4 THEN PC.name
         WHEN AMAL.activity_member_level_id = 5 THEN AC.name ELSE '' END AS location_name,
    AMC.component_id, C.actual_name
  FROM activity_member AM
  LEFT JOIN tdp_cadre TC ON AM.tdp_cadre_id = TC.tdp_cadre_id
  LEFT JOIN activity_member_access_type AMAT ON AMAT.activity_member_id = AM.activity_member_id AND AMAT.is_active = 'Y'
  LEFT JOIN user_type UT ON UT.user_type_id = AMAT.user_type_id
  LEFT JOIN activity_member_access_level AMAL ON AMAL.activity_member_id = AM.activity_member_id AND AMAL.is_active = 'Y'
  LEFT JOIN user_level UL ON UL.user_level_id = AMAL.activity_member_level_id
  LEFT JOIN constituency PC ON AMAL.activity_location_value = PC.constituency_id AND AMAL.activity_member_level_id = 4
  LEFT JOIN constituency AC ON AMAL.activity_location_value = AC.constituency_id AND AMAL.activity_member_level_id = 5
  LEFT JOIN activity_member_component AMC ON AMC.activity_member_id = AM.activity_member_id AND AMC.is_valid = 'Y'
  LEFT JOIN component C ON C.component_id = AMC.component_id
  ORDER BY AM.activity_member_id, C.component_id
"""


def rollup_members(rows):
    """Collapse the login x component fan-out into one dict per login."""
    by_id = {}
    for r in rows:
        mid = r["activity_member_id"]
        m = by_id.get(mid)
        if m is None:
            m = {k: r[k] for k in (
                "activity_member_id", "tdp_cadre_id", "membership_id", "member_name",
                "mobile_no", "is_acitve", "inserted_time", "updated_by", "image_url", "role_id", "role_name", "role_short",
                "level_id", "level_name", "location_value", "location_name",
            )}
            m["component_ids"] = []
            by_id[mid] = m
        if r["component_id"] is not None:
            m["component_ids"].append(r["component_id"])
    return list(by_id.values())


@app.get("/api/members")
def members(status: str = "active"):
    result = rollup_members(run(MEMBERS_QUERY))
    if status == "active":
        result = [m for m in result if m["is_acitve"] == "Y"]
    elif status == "inactive":
        result = [m for m in result if m["is_acitve"] == "N"]
    attach_locations({m["activity_member_id"]: m for m in result})
    return result


# 2) single member (any status, so a deactivated login can still be opened)
@app.get("/api/members/{member_id}")
def member(member_id: int):
    row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
    if not row:
        raise HTTPException(status_code=404, detail="not found")
    row = shape(row)
    attach_locations({row["activity_member_id"]: row})
    return row


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
    return run(
        "SELECT component_id AS id, name, actual_name AS actual, dashboard_display_name AS display, order_no "
        "FROM component ORDER BY component_id"
    )


@app.get("/api/lookups/constituencies")
def constituencies():
    return run(
        "SELECT * FROM constituency "
        "WHERE state_id = 1 AND deform_date IS NULL AND election_scope_id = 2 "
        "GROUP BY constituency_id"
    )


@app.get("/api/lookups/parliaments")
def parliaments():
    return run(
        "SELECT C.constituency_id, C.name, C.election_scope_id "
        "FROM constituency C "
        "JOIN election E ON E.election_scope_id = C.election_scope_id "
        "WHERE C.election_scope_id = 1 AND C.state_id = 1 "
        "AND E.election_year = 2024 AND C.deform_date IS NULL"
    )


# 4) cadre MID lookup (create-flow step 1, read-only)
@app.get("/api/cadre/{mid}")
def cadre(mid: str):
    row = run(
        f"SELECT tdp_cadre_id, membership_id, first_name, last_name, mobile_no, "
        f"gender, constituency_id, CONCAT('{CADRE_IMAGE_BASE}', image) AS image_url "
        f"FROM tdp_cadre WHERE membership_id = %s AND is_deleted = 'N' LIMIT 1",
        (mid,), one=True,
    )
    if not row:
        raise HTTPException(status_code=404, detail="no cadre for that MID")
    return row


# 4b) cadre lookup by mobile number (create-flow step 1, read-only).
# mobile_no is indexed but NOT unique — multiple cadre (e.g. family members
# sharing one phone) can share a number, so this returns every match
# (possibly []). Column aliases are kept as given by the admin's reference
# queries (not this file's usual snake_case) so the response stays
# recognisable against the source SQL. Base FROM/LEFT JOIN shape (starting at
# tdp_cadre, not activity_member) and the mobile_no filter are preserved from
# the original version of this query on purpose — see the two gotchas below —
# with LOCATION folded in from a second reference query that otherwise
# INNER JOINed from activity_member and had no mobile_no filter at all, which
# would have dropped the "cadre has no login yet" case this endpoint exists
# for. Things worth knowing:
#   - AM only joins on is_acitve='Y', so a *deactivated* login reads
#     identical to "no login yet" here (AMID/LOCLEVEL/TEAMNAME all null) —
#     unlike create_member's duplicate check below, which still counts a
#     deactivated activity_member row as "already exists" and refuses to
#     create a second one.
#   - No GROUP BY: a cadre with more than one active role or access-level
#     grant at once (rare in this data) fans out into multiple rows.
#   - LOCATION resolves LOCVALUE (an untyped int) to a human name: 'AP' for
#     level 2 (state-wide), else a LEFT JOIN to `constituency` keyed off
#     activity_location_value for level 4/5, empty string for anything else.
#     PC/AC are two separate joins to the same table (one per level) so the
#     CASE can pick the right one without ambiguity.
# is_deleted='N' was added (not in the source query) so a deleted cadre
# record can't show up here and then 404 when picked for creation.
CADRE_BY_MOBILE_SELECT = f"""
  SELECT
      CR.tdp_cadre_id AS CADREID,
      UPPER(CR.first_name) AS MEMBERNAME,
      CR.mobile_no AS MOBILENO,
      CONCAT('#', CR.membership_id) AS MID,
      CONCAT("{CADRE_IMAGE_BASE}", CR.image) AS IMAGE,
      AM.activity_member_id AS AMID,
      UL.level AS LOCLEVEL,
      AMAL.activity_location_value AS LOCVALUE,
      CASE WHEN AMAL.activity_member_level_id = 2 THEN 'AP'
           WHEN AMAL.activity_member_level_id = 4 THEN PC.name
           WHEN AMAL.activity_member_level_id = 5 THEN AC.name ELSE '' END AS LOCATION,
      CONCAT('#', LOD.otp) AS OTP,
      CONCAT('#', DATE(LOD.generated_time)) AS EXPDATE,
      UT.short_name AS TEAMNAME
  FROM tdp_cadre CR
  LEFT JOIN activity_member AM ON CR.tdp_cadre_id = AM.tdp_cadre_id AND AM.is_acitve = 'Y' AND AM.activity_member_id <> 581
  LEFT JOIN activity_member_access_level AMAL ON AM.activity_member_id = AMAL.activity_member_id AND AMAL.is_active = 'Y'
  LEFT JOIN user_level UL ON AMAL.activity_member_level_id = UL.user_level_id
  LEFT JOIN constituency PC ON AMAL.activity_location_value = PC.constituency_id AND AMAL.activity_member_level_id = 4
  LEFT JOIN constituency AC ON AMAL.activity_location_value = AC.constituency_id AND AMAL.activity_member_level_id = 5
  LEFT JOIN activity_member_access_type AMAT ON AM.activity_member_id = AMAT.activity_member_id AND AMAT.is_active = 'Y'
  LEFT JOIN user_type UT ON AMAT.user_type_id = UT.user_type_id
  LEFT JOIN login_otp_details LOD ON CR.tdp_cadre_id = LOD.tdp_cadre_id AND LOD.is_valid = 'Y'
  WHERE CR.mobile_no = %s AND CR.is_deleted = 'N'
  ORDER BY CR.tdp_cadre_id, UL.user_level_id, UT.order_no
"""


@app.get("/api/cadre/by-mobile/{mobile}")
def cadre_by_mobile(mobile: str):
    return run(CADRE_BY_MOBILE_SELECT, (mobile,))


# 4c) access-type grant count for a MID (read-only, standalone check — NOT used
# by MEMBER_SELECT/MEMBERS_QUERY above). Those two collapse
# activity_member_access_type with MAX()/no GROUP BY on the assumption a login
# has at most one active role grant at a time (see comments at MEMBER_SELECT
# and CADRE_BY_MOBILE_SELECT). This exists purely to check that assumption for
# a given MID by listing every access_type row (active or not) tied to it,
# instead of trusting the aggregated columns.
ACCESS_TYPES_BY_MID_SELECT = """
  SELECT AMAT.activity_member_access_type_id, AMAT.activity_member_id,
         AMAT.user_type_id, UT.type AS role_name, UT.short_name AS role_short,
         AMAT.is_active
  FROM tdp_cadre TC
  JOIN activity_member AM ON AM.tdp_cadre_id = TC.tdp_cadre_id
  JOIN activity_member_access_type AMAT ON AMAT.activity_member_id = AM.activity_member_id
  LEFT JOIN user_type UT ON UT.user_type_id = AMAT.user_type_id
  WHERE TC.membership_id = %s
  ORDER BY AM.activity_member_id, AMAT.is_active DESC, AMAT.user_type_id
"""


@app.get("/api/cadre/{mid}/access-types")
def cadre_access_types(mid: str):
    rows = run(ACCESS_TYPES_BY_MID_SELECT, (mid,))
    active = [r for r in rows if r["is_active"] == "Y"]
    return {
        "membership_id": mid,
        "total_grants": len(rows),
        "active_grants": len(active),
        "grants": rows,
    }


# --- WRITE ACCESS DISABLED FOR NOW -----------------------------------------
# Every write endpoint (create/role/active/level/delete) is commented out
# below, pending auth in front of this API — see the module docstring at the
# top of this file. The code is kept in place, unchanged, so it can be
# re-enabled later by uncommenting; nothing here should be treated as deleted.
# The backend is GET-only while this block is commented out.
#
# # 5) create a login (New login → cadre found, no activity_member yet).
# # A cadre only gets dashboard access once it has an activity_member row plus
# # its three grant rows (role/level/components) — mirrors the reference doc's
# # 6-step workflow, steps 3-6. Refuses to create a second login for a cadre
# # that already has one (activity_member_id 581 is a reserved/placeholder
# # record and is ignored for this check, per the source query this was built
# # from) — use the role/level/active endpoints to change an existing login
# # instead of creating a duplicate.
# @app.post("/api/members", status_code=201)
# def create_member(body: MemberCreate):
#     cadre_row = run(
#         "SELECT tdp_cadre_id, first_name, last_name FROM tdp_cadre "
#         "WHERE tdp_cadre_id=%s AND is_deleted='N'",
#         (body.tdp_cadre_id,), one=True,
#     )
#     if not cadre_row:
#         raise HTTPException(status_code=404, detail="no cadre for that id")
#
#     existing = run(
#         "SELECT activity_member_id FROM activity_member "
#         "WHERE tdp_cadre_id=%s AND activity_member_id <> 581",
#         (body.tdp_cadre_id,), one=True,
#     )
#     if existing:
#         raise HTTPException(status_code=409, detail="a login already exists for this cadre")
#
#     member_name = f"{cadre_row['first_name'] or ''} {cadre_row['last_name'] or ''}".strip() or None
#
#     def _create(cur):
#         cur.execute(
#             "INSERT INTO activity_member (tdp_cadre_id, member_name, is_acitve, inserted_time) "
#             "VALUES (%s, %s, 'Y', NOW())",
#             (body.tdp_cadre_id, member_name),
#         )
#         new_id = cur.lastrowid
#         cur.execute(
#             "INSERT INTO activity_member_access_type (activity_member_id, user_type_id, is_active) "
#             "VALUES (%s, %s, 'Y')",
#             (new_id, body.user_type_id),
#         )
#         cur.execute(
#             "INSERT INTO activity_member_access_level "
#             "(activity_member_id, activity_member_level_id, activity_location_value, is_active) "
#             "VALUES (%s, %s, %s, 'Y')",
#             (new_id, body.user_level_id, body.location_value),
#         )
#         for component_id in body.component_ids:
#             cur.execute(
#                 "INSERT INTO activity_member_component (activity_member_id, component_id, is_valid) "
#                 "VALUES (%s, %s, 'Y')",
#                 (new_id, component_id),
#             )
#         return new_id
#
#     member_id = run_write_tx(_create)
#     row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
#     return shape(row)
#
#
# # 6) change a login's role (New login → existing-login panel).
# # Deactivates any currently-active role grant(s), then reactivates a matching
# # prior grant or inserts a fresh one — mirrors the reference doc's step 6.
# @app.put("/api/members/{member_id}/role")
# def update_role(member_id: int, body: RoleUpdate):
#     if not run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True):
#         raise HTTPException(status_code=404, detail="not found")
#
#     run_write(
#         "UPDATE activity_member_access_type SET is_active='N' "
#         "WHERE activity_member_id=%s AND is_active='Y'",
#         (member_id,),
#     )
#     existing = run(
#         "SELECT activity_member_access_type_id FROM activity_member_access_type "
#         "WHERE activity_member_id=%s AND user_type_id=%s LIMIT 1",
#         (member_id, body.user_type_id), one=True,
#     )
#     if existing:
#         run_write(
#             "UPDATE activity_member_access_type SET is_active='Y' WHERE activity_member_access_type_id=%s",
#             (existing["activity_member_access_type_id"],),
#         )
#     else:
#         run_write(
#             "INSERT INTO activity_member_access_type (activity_member_id, user_type_id, is_active) "
#             "VALUES (%s, %s, 'Y')",
#             (member_id, body.user_type_id),
#         )
#     row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
#     return shape(row)
#
#
# # 7) activate / deactivate a login (New login → existing-login panel).
# # Deactivating also kills any live OTPs, mirroring Backend.md's reference flow.
# @app.put("/api/members/{member_id}/active")
# def update_active(member_id: int, body: ActiveUpdate):
#     if body.is_active not in ("Y", "N"):
#         raise HTTPException(status_code=400, detail="is_active must be 'Y' or 'N'")
#
#     member_row = run("SELECT tdp_cadre_id FROM activity_member WHERE activity_member_id=%s", (member_id,), one=True)
#     if not member_row:
#         raise HTTPException(status_code=404, detail="not found")
#
#     run_write("UPDATE activity_member SET is_acitve=%s WHERE activity_member_id=%s", (body.is_active, member_id))
#     if body.is_active == "N" and member_row["tdp_cadre_id"]:
#         run_write(
#             "UPDATE login_otp_details SET is_valid='N', updated_time=NOW() "
#             "WHERE tdp_cadre_id=%s AND is_valid='Y'",
#             (member_row["tdp_cadre_id"],),
#         )
#     row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
#     return shape(row)
#
#
# # 8) change a login's geographic scope (Detail screen). Same
# # deactivate-then-reactivate-or-insert pattern as the role endpoint above.
# # location_value is compared with <=> (NULL-safe equals) since a level like
# # STATE may legitimately carry no location_value.
# @app.put("/api/members/{member_id}/level")
# def update_level(member_id: int, body: LevelUpdate):
#     if not run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True):
#         raise HTTPException(status_code=404, detail="not found")
#
#     run_write(
#         "UPDATE activity_member_access_level SET is_active='N' "
#         "WHERE activity_member_id=%s AND is_active='Y'",
#         (member_id,),
#     )
#     existing = run(
#         "SELECT activity_member_access_level_id FROM activity_member_access_level "
#         "WHERE activity_member_id=%s AND activity_member_level_id=%s AND activity_location_value <=> %s LIMIT 1",
#         (member_id, body.user_level_id, body.location_value), one=True,
#     )
#     if existing:
#         run_write(
#             "UPDATE activity_member_access_level SET is_active='Y' WHERE activity_member_access_level_id=%s",
#             (existing["activity_member_access_level_id"],),
#         )
#     else:
#         run_write(
#             "INSERT INTO activity_member_access_level "
#             "(activity_member_id, activity_member_level_id, activity_location_value, is_active) "
#             "VALUES (%s, %s, %s, 'Y')",
#             (member_id, body.user_level_id, body.location_value),
#         )
#     row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
#     return shape(row)
#
#
# # 9) soft-delete a login (Detail screen). Distinct from deactivate: cascades
# # is_active/is_valid='N' across every grant table (role, level, components),
# # not just activity_member.is_acitve, so a later reactivate comes back with
# # no stale grants rather than silently restoring the old access set.
# @app.delete("/api/members/{member_id}")
# def delete_member(member_id: int):
#     member_row = run("SELECT tdp_cadre_id FROM activity_member WHERE activity_member_id=%s", (member_id,), one=True)
#     if not member_row:
#         raise HTTPException(status_code=404, detail="not found")
#
#     def _delete(cur):
#         cur.execute("UPDATE activity_member SET is_acitve='N' WHERE activity_member_id=%s", (member_id,))
#         cur.execute(
#             "UPDATE activity_member_access_type SET is_active='N' WHERE activity_member_id=%s AND is_active='Y'",
#             (member_id,),
#         )
#         cur.execute(
#             "UPDATE activity_member_access_level SET is_active='N' WHERE activity_member_id=%s AND is_active='Y'",
#             (member_id,),
#         )
#         cur.execute(
#             "UPDATE activity_member_component SET is_valid='N' WHERE activity_member_id=%s AND is_valid='Y'",
#             (member_id,),
#         )
#         if member_row["tdp_cadre_id"]:
#             cur.execute(
#                 "UPDATE login_otp_details SET is_valid='N', updated_time=NOW() "
#                 "WHERE tdp_cadre_id=%s AND is_valid='Y'",
#                 (member_row["tdp_cadre_id"],),
#             )
#
#     run_write_tx(_delete)
#     row = run(MEMBER_SELECT + " WHERE AM.activity_member_id = %s" + GROUP_BY, (member_id,), one=True)
#     return shape(row)
# --- END WRITE ACCESS BLOCK --------------------------------------------------


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4000)