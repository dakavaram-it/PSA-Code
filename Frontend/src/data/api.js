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
