# Backend/main.py — READ-ONLY live data layer for the UA admin console.
# Python + FastAPI + PyMySQL. Powers the frontend with real dakavara_pa data.
# No INSERT/UPDATE/DELETE. See Backend.md for the contract and query rationale.
#
# Run:  pip install -r requirements.txt
#       python main.py            (or: uvicorn main:app --port 4000)
import os

import pymysql
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

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


# component_ids comes back as a comma string; the UI wants an int array.
def shape(r):
    ids = r.get("component_ids")
    r["component_ids"] = [int(x) for x in ids.split(",")] if ids else []
    return r


# One row per login. Collapses the member×role×component fan-out in SQL. [Backend.md §5.1]
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
    rows = run(MEMBER_SELECT + where + GROUP_BY + " ORDER BY AM.inserted_time DESC")
    return [shape(r) for r in rows]


# 2) single member (any status, so a deactivated login can still be opened)
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
    return run(
        "SELECT component_id AS id, name, actual_name AS actual, dashboard_display_name AS display, order_no "
        "FROM component ORDER BY component_id"
    )


# 4) cadre MID lookup (create-flow step 1, read-only)
@app.get("/api/cadre/{mid}")
def cadre(mid: str):
    row = run(
        "SELECT tdp_cadre_id, membership_id, first_name, last_name, mobile_no, "
        "gender, constituency_id, payment_status "
        "FROM tdp_cadre WHERE membership_id = %s AND is_deleted = 'N' LIMIT 1",
        (mid,), one=True,
    )
    if not row:
        raise HTTPException(status_code=404, detail="no cadre for that MID")
    return row


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=4000)
