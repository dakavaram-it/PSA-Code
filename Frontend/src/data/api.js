// api.js — read-only client for the live data API (Backend/server.js).
// Every function returns the SAME shape the old mock generators produced,
// so the UI needs no other change. See Backend.md §7.
const BASE = import.meta.env.VITE_API_BASE || 'http://localhost:4000/api';

const json = (r) => r.json();

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
