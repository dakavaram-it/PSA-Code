// mockData.js
// ---------------------------------------------------------------------------
// Mock data for the User Admin Console.
// Every shape and every distribution here is derived from
// Admin_Dashboard_Table_Report.md so that swapping in the real API later is a
// drop-in replacement, not a redesign.
//
// KEY MODELING DECISIONS (report section in brackets):
//  - Identity chain is activity_member -> tdp_cadre ONLY. No `user`,
//    `user_groups`, `user_group`. [§0.2, §5.3]
//  - The member "active" flag is `is_acitve` (misspelled in the real DB,
//    kept verbatim on purpose). Junction flags are is_active / is_valid. [§5.2]
//  - Roles come from the real 17 user_type rows. [§3.6]
//  - Only 3 of 9 levels are ever used: STATE, PARLIAMENT, ASSEMBLY. No
//    BOOTH level exists. [§3.7]
//  - Component labels fall back dashboard_display_name -> actual_name -> name,
//    and may be Telugu (UTF-8). [§3.8]
//  - 74% of members share the bundle {82,94,129,131}. [§4.2]
// ---------------------------------------------------------------------------

// --- user_type lookup (17 rows, real ids incl. gaps at 10 & 13) [§3.6] -------
export const USER_TYPES = [
  { id: 9,  type: 'KEY',                        short: 'KEY' },
  { id: 3,  type: 'MINISTER',                   short: 'MINISTER' },
  { id: 6,  type: 'MP',                         short: 'MP' },
  { id: 7,  type: 'MLA',                        short: 'MLA' },
  { id: 8,  type: 'CONSTITUENCY',               short: 'ACI' },
  { id: 14, type: 'PARLIAMENT PARTY PRESIDENT', short: 'PPP' },
  { id: 15, type: 'ZONAL COORDINATOR',          short: 'ZONAL' },
  { id: 16, type: 'PROGRAM COMMITTEE',          short: 'PROG CMTE' },
  { id: 11, type: 'ECM_TEAM(RAJASHEKHAR)',      short: 'ECM' },
  { id: 12, type: 'OBSERVER',                   short: 'OBSERVER' },
  { id: 5,  type: 'LN TEAM',                    short: 'LN TEAM' },
  { id: 4,  type: 'TEST USER',                  short: 'TEST USER' },
  { id: 18, type: 'OTHERS',                     short: 'OTHERS' },
  { id: 19, type: 'MYTDP APP TEAM',             short: 'MYTDP APP' },
  { id: 1,  type: 'COUNTRY',                    short: 'COUNTRY' },
  { id: 2,  type: 'STATE',                      short: 'STATE' },
  { id: 17, type: 'AC OBSERVER',                short: 'AC OBSERVER' },
];

// --- user_level lookup (9 rows). Only 2/4/5 are used in practice. [§3.7] -----
export const USER_LEVELS = [
  { id: 1, name: 'COUNTRY' },
  { id: 2, name: 'STATE' },
  { id: 3, name: 'DISTRICT' },
  { id: 4, name: 'PARLIAMENT' },
  { id: 5, name: 'ASSEMBLY' },
  { id: 6, name: 'MANDAL' },
  { id: 7, name: 'MUNICIPALITY' },
  { id: 8, name: 'VILLAGE' },
  { id: 9, name: 'WARD' },
];
// Levels that actually carry members, in the order the report reports them.
export const USED_LEVEL_IDS = [5, 4, 2]; // ASSEMBLY, PARLIAMENT, STATE

// --- component catalogue (subset of the real 133). display -> actual -> name.
// Some display names are NULL in the real data, so `display: null` is genuine
// and the UI must fall back. One Telugu entry is included on purpose. [§3.8]
export const COMPONENTS = [
  { id: 82,  name: 'cadreDashboard2024',         actual: '2024-26 Membership Dashboard', display: '2024-26 MEMBERSHIP DASHBOARD' },
  { id: 94,  name: 'KSSDashboard',               actual: 'Cubs-Committees 2025',         display: 'CUBS-COMMITTEES 2025 DASHBOARD' },
  { id: 129, name: 'CommitteeMeetingsNew',       actual: 'Committee Meetings',           display: 'COMMITTEE MEETINGS' },
  { id: 131, name: 'SIRDashboard',               actual: 'SIR Dashboard',                display: 'SIR DASHBOARD' },
  { id: 45,  name: 'cadreSearch',                actual: 'Cadre Search',                 display: 'CADRE SEARCH' },
  { id: 113, name: 'ProgramsDashboard',          actual: 'Programs Dashboard (App)',     display: 'PROGRAMS DASHBOARD (APP)' },
  { id: 117, name: 'APPUsers',                   actual: 'App Committee Users & Login',   display: 'APP COMMITTEE USERS & LOGIN STATUS' },
  { id: 119, name: 'TrainingProgramsAPP',        actual: 'Training Programs (App)',      display: 'TRAINING PROGRAMS (APP)' },
  { id: 120, name: 'programsDayWise',            actual: 'Programs Day-wise',            display: null }, // display genuinely NULL -> falls back to actual
  { id: 133, name: 'suparipalana',               actual: 'Su-Governance First Step',     display: 'సుపరిపాలనలో తొలి అడుగు' }, // Telugu display
  { id: 103, name: 'D2DCampaignHouseVisitNew',   actual: null,                           display: null }, // both NULL -> falls back to name
  { id: 110, name: 'D2DCampaignGSTHouseVisit',   actual: null,                           display: null },
  { id: 95,  name: 'committeeReport',            actual: 'Committee Report',             display: null },
  { id: 116, name: 'programsSummary',            actual: 'Programs Summary',             display: 'PROGRAMS SUMMARY' },
];

// The canonical bundle that 74% of members share. [§4.2]
export const STANDARD_BUNDLE = [82, 94, 129, 131];

// --- helpers -----------------------------------------------------------------
export function componentLabel(c) {
  // 3-level fallback exactly as the report prescribes. [§3.8, §5.5]
  return c.display || c.actual || c.name;
}

const FIRST = ['A VENKATA', 'RAVI', 'PRIYA', 'SURESH', 'LAKSHMI', 'NARESH', 'DIVYA',
  'KIRAN', 'ANITHA', 'MOHAN', 'SRINIVAS', 'PADMA', 'RAJESH', 'SWAPNA', 'VENKAT',
  'GEETHA', 'HARI', 'SANDHYA', 'PRASAD', 'MEENA', 'ARUN', 'BHAVANI', 'CHANDRA', 'DEEPAK'];
const LAST = ['RAMANAMMA', 'REDDY', 'NAIDU', 'RAO', 'KUMAR', 'PRASAD', 'SHARMA',
  'VARMA', 'CHOWDARY', 'GUPTA', 'BABU', 'MURTHY', 'SASTRY', 'PATNAIK'];
const CONSTITUENCIES = ['Tirupati', 'Mangalagiri', 'Guntur East', 'Rajahmundry City',
  'Visakhapatnam North', 'Kurnool', 'Kadapa', 'Anantapur Urban', 'Nellore City',
  'Kakinada City', 'Eluru', 'Ongole', 'Chittoor', 'Machilipatnam'];
const PARLIAMENTS = ['Tirupati', 'Guntur', 'Rajahmundry', 'Visakhapatnam', 'Kurnool',
  'Nellore', 'Anantapur'];

// Deterministic PRNG so the mock set is stable across reloads.
function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20260714);
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

// Role popularity roughly follows the report's active-member counts. [§3.6]
const ROLE_WEIGHTS = [
  [12, 171], [7, 120], [16, 62], [8, 47], [11, 35], [14, 33], [18, 27],
  [3, 19], [6, 15], [9, 7], [4, 6], [15, 6], [5, 2], [19, 1],
];
function weightedRole() {
  const total = ROLE_WEIGHTS.reduce((s, [, w]) => s + w, 0);
  let r = rnd() * total;
  for (const [id, w] of ROLE_WEIGHTS) { if ((r -= w) <= 0) return id; }
  return 12;
}

// Component-bundle popularity: dominated by the standard bundle. [§4.2]
function weightedBundle() {
  const r = rnd();
  if (r < 0.74) return [...STANDARD_BUNDLE];                              // 74%
  if (r < 0.80) return [45, 82, 94, 113, 117, 119, 120, 129, 131];       // ECM-ish
  if (r < 0.85) return [129, 131, 133];                                   // small prog cmte
  if (r < 0.90) return [45, 94, 95, 113, 116, 117, 119, 120, 129, 131, 133];
  if (r < 0.93) return [103, 110];                                        // OTHERS junk
  if (r < 0.95) return [];                                                // blank dashboard (5 real users). [§3.4]
  if (r < 0.97) return [82];
  return [...STANDARD_BUNDLE, 45, 113, 117, 119];
}

function makeMember(i) {
  const first = pick(FIRST);
  const last = pick(LAST);
  const name = `${first} ${last}`;
  const roleId = weightedRole();
  const role = USER_TYPES.find((t) => t.id === roleId);

  // Geographic scope: choose one used level, then a matching location string.
  const levelId = (() => {
    const r = rnd();
    if (r < 0.645) return 5; // ASSEMBLY (357/553)
    if (r < 0.87) return 4;  // PARLIAMENT (124/553)
    return 2;                // STATE (71/553)
  })();
  const location =
    levelId === 5 ? pick(CONSTITUENCIES)
    : levelId === 4 ? pick(PARLIAMENTS)
    : 'Andhra Pradesh';

  const components = weightedBundle();

  // ~39% active overall in the real table (553 active / 1426 total). [§3.1]
  const isAcitve = rnd() < 0.9 ? 'Y' : 'N'; // bias the *visible* mock toward active

  // 156/1426 members have NULL cadre overall, but ALL active resolve. [§3.1]
  const hasCadre = isAcitve === 'Y' ? true : rnd() > 0.11;

  const mid = String(20000 + Math.floor(rnd() * 79999));
  const mobile = hasCadre
    ? `9${Math.floor(100000000 + rnd() * 899999999)}`
    : null; // 1 active member is missing a mobile in real data. [§3.9]

  const inserted = new Date(2023, Math.floor(rnd() * 24) % 12,
    1 + Math.floor(rnd() * 27), Math.floor(rnd() * 24), Math.floor(rnd() * 60));

  return {
    activity_member_id: 1000 + i,
    member_name: name,
    tdp_cadre_id: hasCadre ? 500000 + i : null,
    membership_id: hasCadre ? mid : null,
    mobile_no: mobile,
    is_acitve: isAcitve,                 // verbatim misspelling. [§5.2]
    inserted_time: inserted.toISOString(),
    updated_by: 100 + Math.floor(rnd() * 20),
    // access_type junction (one row per member; 551/553 have exactly one). [§3.2]
    role_id: roleId,
    role_name: role.type,
    role_short: role.short,
    // access_level junction. [§3.3]
    level_id: levelId,
    level_name: USER_LEVELS.find((l) => l.id === levelId).name,
    location_value: location,            // real col is a bare int w/ no FK. [§3.3]
    // component junction (is_valid = 'Y' for all real rows). [§3.4]
    component_ids: components,
  };
}

export const MEMBERS = Array.from({ length: 120 }, (_, i) => makeMember(i));

// --- derived stats for the Overview screen (all from the same MEMBERS set) ---
export function computeStats(members) {
  const active = members.filter((m) => m.is_acitve === 'Y');
  const inactive = members.filter((m) => m.is_acitve === 'N');
  const withoutComponents = active.filter((m) => m.component_ids.length === 0);
  const roleCounts = {};
  active.forEach((m) => { roleCounts[m.role_name] = (roleCounts[m.role_name] || 0) + 1; });
  const levelCounts = {};
  active.forEach((m) => { levelCounts[m.level_name] = (levelCounts[m.level_name] || 0) + 1; });

  // Component popularity across active members.
  const compCounts = {};
  active.forEach((m) => m.component_ids.forEach((id) => {
    compCounts[id] = (compCounts[id] || 0) + 1;
  }));
  const topComponents = Object.entries(compCounts)
    .map(([id, count]) => {
      const c = COMPONENTS.find((x) => x.id === Number(id));
      return { id: Number(id), label: c ? componentLabel(c) : `#${id}`, count };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  // Standard-bundle adoption. [§4.2]
  const bundleKey = [...STANDARD_BUNDLE].sort().join(',');
  const onStandard = active.filter(
    (m) => [...m.component_ids].sort().join(',') === bundleKey
  ).length;

  return {
    total: members.length,
    active: active.length,
    inactive: inactive.length,
    withoutComponents: withoutComponents.length,
    roleCounts,
    levelCounts,
    topComponents,
    onStandard,
    onStandardPct: active.length ? Math.round((onStandard / active.length) * 100) : 0,
  };
}
