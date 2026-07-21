// api.js — client for the live data API (Backend/main.py).
// Almost everything here is a read. Two functions at the bottom (updateMemberRole,
// updateMemberActive) hit the backend's only two write endpoints — see CLAUDE.md.
const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

const json = (r) => r.json();
const jsonOrThrow = async (r) => {
  if (!r.ok) throw new Error(`API ${r.status}`);
  return r.json();
};

// status: 'all' | 'active' | 'inactive'
export const getMembers = (status = 'all') =>
  fetch(`${BASE}/members?status=${status}`).then(json);

export const getUserTypes = () => fetch(`${BASE}/lookups/user-types`).then(json);

// returns { levels: [...9], used_level_ids: [5,4,2] }
export const getUserLevels = () => fetch(`${BASE}/lookups/user-levels`).then(json);

export const getComponents = () => fetch(`${BASE}/lookups/components`).then(json);

// null when the MID has no cadre (HTTP 404)
export const lookupCadre = (mid) =>
  fetch(`${BASE}/cadre/${encodeURIComponent(mid)}`).then((r) => (r.ok ? r.json() : null));

// mobile_no isn't unique — returns every cadre sharing that number (possibly
// []). Column names come straight from the admin's reference query (CADREID,
// MEMBERNAME, MOBILENO, MID, IMAGE, AMID, LOCLEVEL, LOCVALUE, LOCATION, OTP,
// EXPDATE, TEAMNAME) rather than this file's usual snake_case — AMID set
// means an active login already exists (the query only joins is_acitve='Y'
// rows). LOCATION resolves LOCVALUE's untyped int to a name: 'AP' for level
// 2, else the matching constituency.name for level 4/5 (empty string
// otherwise — LOCVALUE has no mapping at level 2, and other levels aren't
// resolved by this query).
export const lookupCadreByMobile = (mobile) =>
  fetch(`${BASE}/cadre/by-mobile/${encodeURIComponent(mobile)}`).then(jsonOrThrow);

// Writes the member's live role grant; returns the updated member row.
export const updateMemberRole = (memberId, userTypeId) =>
  fetch(`${BASE}/members/${memberId}/role`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_type_id: userTypeId }),
  }).then(jsonOrThrow);

// Writes is_acitve ('Y' | 'N'); returns the updated member row.
export const updateMemberActive = (memberId, isActive) =>
  fetch(`${BASE}/members/${memberId}/active`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ is_active: isActive }),
  }).then(jsonOrThrow);

// Writes the member's live geographic scope; returns the updated member row.
export const updateMemberLevel = (memberId, userLevelId, locationValue) =>
  fetch(`${BASE}/members/${memberId}/level`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user_level_id: userLevelId, location_value: locationValue }),
  }).then(jsonOrThrow);

// Creates a login (+ role/level/component grants) for a cadre with no
// activity_member row yet. Throws (status 409) if one already exists.
export const createMember = (payload) =>
  fetch(`${BASE}/members`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tdp_cadre_id: payload.tdp_cadre_id,
      user_type_id: payload.role_id,
      user_level_id: payload.level_id,
      location_value: payload.location_value,
      component_ids: payload.components,
    }),
  }).then(jsonOrThrow);

// Soft-deletes a login: cascades is_active/is_valid='N' across every grant
// table, not just activity_member.is_acitve. Returns the now-deactivated row.
export const deleteMember = (memberId) =>
  fetch(`${BASE}/members/${memberId}`, { method: 'DELETE' }).then(jsonOrThrow);
