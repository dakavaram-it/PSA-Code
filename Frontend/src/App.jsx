import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  LayoutDashboard, Users, ClipboardList, Search, Plus,
  ChevronLeft, Eye, KeyRound, X, Check, ShieldCheck, MapPin, Layers,
  AlertTriangle, UserCheck, UserX, FolderTree, Save, RotateCcw, Copy, UserPlus,
  IdCard, Smartphone, Pencil,
} from "lucide-react";
import { getMembers, getUserTypes, getUserLevels, getComponents, getConstituencies, getParliaments, lookupCadre, lookupCadreByMobile, updateMemberRole, updateMemberActive } from "./data/api.js";
import { cn } from "./lib/utils.js";

/*
  User Admin Console — React (mock data, backend later).

  Ported from the "BharatBase / Admin Console" prototype, with every screen
  and field reconciled against Admin_Dashboard_Table_Report.md.

  Deliberately CUT from the prototype because the database does not support them
  (per the report):
    - Groups screen           -> user_groups/user_group are unlinked to
                                 activity_member. [§0.1, §3.11-3.12, §5.3]
    - Permissions matrix hero -> same reason; no group->permission model exists.
    - Growth / login / module KPI charts -> no backing table.
    - Invented roleDefs + BOOTH level -> replaced by the real lookups. [§5.7]

  What remains is driven entirely by activity_member -> tdp_cadre. [§0.2, §5.1]

  UI language: reskinned to the "Smart AI Interview / Jobseeker" design system —
  warm white background with a light yellow/amber/orange accent theme, rounded-2xl
  soft-shadow cards with hover-lift, category-colour icon tiles, pill CTAs,
  fade-in-up entrances. Built with Tailwind.
*/

// ---------------------------------------------------------------------------
// DATA — lookups come from the live API at startup (bootstrap in AdminConsole).
// Module-scope `let` so every screen reads them without prop-drilling; they are
// populated once, before the first non-loading render.
// ---------------------------------------------------------------------------
let USER_TYPES = [];
let USER_LEVELS = [];
let USED_LEVEL_IDS = [5, 4, 2];
let COMPONENTS = [];
// Live AP assembly (175) / parliamentary (25) constituencies, for the Access
// Scope location picker on the Detail screen. { id, name } pairs.
let LIVE_CONSTITUENCIES = [];
let LIVE_PARLIAMENTS = [];
const STANDARD_BUNDLE = [82, 94, 129, 131];
const componentLabel = (c) => c.display || c.actual || c.name;

// --- user_groups reimagined as a working (mock) permission model. -----------
// REQUIRES two tables that do NOT exist in the current schema [§3.11-3.12]:
//   user_group_member(user_group_id, activity_member_id)
//   user_group_component(user_group_id, component_id)
// Everything group-related below is front-end mock state until those exist.
const INITIAL_GROUPS = [
  { user_group_id: 1, notes: "ADMIN_GROUP", component_ids: [82, 94, 129, 131, 45, 117] },
  { user_group_id: 2, notes: "TDP_MLA-GROUP", component_ids: [82, 94, 129, 131] },
  { user_group_id: 3, notes: "OBSERVER_GROUP", component_ids: [82, 94, 129, 131] },
  { user_group_id: 4, notes: "PROGRAM_COMMITTEE_GROUP", component_ids: [129, 131, 133, 113, 116] },
  { user_group_id: 5, notes: "DATA_ENTRY", component_ids: [45, 103, 110] },
  { user_group_id: 6, notes: "FIELD_SURVEY_GROUP", component_ids: [103, 110, 45] },
];

// Effective components = group-inherited ∪ personal. Returns tagged list.
function effectiveComponents(member, groups) {
  const grp = member.group_id ? groups.find((g) => g.user_group_id === member.group_id) : null;
  const inherited = new Set(grp ? grp.component_ids : []);
  const personal = new Set(member.component_ids);
  const all = new Set([...inherited, ...personal]);
  return [...all].sort((a, b) => a - b).map((id) => ({
    id, component: COMPONENTS.find((c) => c.id === id),
    inherited: inherited.has(id), personal: personal.has(id),
  })).filter((x) => x.component);
}

// --- OTP: client-side 6-digit generator, mock only. -------------------------
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// Client-side 8-digit placeholder MID for the "not found" manual-entry path —
// cosmetic only, never checked against tdp_cadre.membership_id.
const generatePlaceholderMid = () => String(Math.floor(10000000 + Math.random() * 90000000));

const CONSTITUENCIES = ["Tirupati", "Mangalagiri", "Guntur East", "Rajahmundry City", "Visakhapatnam North", "Kurnool", "Kadapa", "Anantapur Urban", "Nellore City", "Kakinada City", "Eluru", "Ongole", "Chittoor", "Machilipatnam"];
const PARLIAMENTS = ["Tirupati", "Guntur", "Rajahmundry", "Visakhapatnam", "Kurnool", "Nellore", "Anantapur"];

function computeStats(members) {
  const active = members.filter((m) => m.is_acitve === "Y");
  const inactive = members.filter((m) => m.is_acitve === "N");
  const roleCounts = {}, levelCounts = {}, compCounts = {};
  active.forEach((m) => {
    roleCounts[m.role_short] = (roleCounts[m.role_short] || 0) + 1;
    levelCounts[m.level_name] = (levelCounts[m.level_name] || 0) + 1;
    m.component_ids.forEach((id) => { compCounts[id] = (compCounts[id] || 0) + 1; });
  });
  const topComponents = Object.entries(compCounts)
    .map(([id, count]) => { const c = COMPONENTS.find((x) => x.id === +id); return { id: +id, label: c ? componentLabel(c) : `#${id}`, count }; })
    .sort((a, b) => b.count - a.count).slice(0, 6);
  const bundleKey = [...STANDARD_BUNDLE].sort().join(",");
  const onStandard = active.filter((m) => [...m.component_ids].sort().join(",") === bundleKey).length;
  return {
    total: members.length, active: active.length, inactive: inactive.length,
    roleCounts, levelCounts, topComponents,
    onStandard, onStandardPct: active.length ? Math.round((onStandard / active.length) * 100) : 0,
  };
}

const initials = (n) => (n || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "—";
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const NO_NAME = "— unnamed —";

// ---------------------------------------------------------------------------
// Shared class recipes — lifted from the reference's real page classes.
// ---------------------------------------------------------------------------
const CARD = "rounded-2xl border border-gray-100 bg-white shadow-lg";
const CARD_HOVER = "transition-all duration-300 hover:-translate-y-1 hover:shadow-xl";
const INPUT = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-200 focus:border-yellow-400 transition";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-xl bg-yellow-400 px-4 py-2.5 text-sm font-semibold text-yellow-950 shadow transition-all hover:bg-yellow-500 hover:shadow-lg disabled:pointer-events-none disabled:opacity-50";
const SECONDARY = "inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-50";
const LABEL = "text-xs font-medium text-gray-500";
const SECTION = "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-yellow-700";

// Category colour scheme, mirroring the reference feature cards (-50 tile + -500 icon).
const CAT = {
  blue:   { tile: "bg-blue-50",     icon: "text-blue-500",   bar: "bg-blue-500" },
  yellow: { tile: "bg-yellow-50", icon: "text-yellow-700", bar: "bg-yellow-500" },
  orange: { tile: "bg-orange-50", icon: "text-orange-500", bar: "bg-orange-500" },
  green:  { tile: "bg-green-50",    icon: "text-green-500",  bar: "bg-green-500" },
  amber:  { tile: "bg-amber-50",   icon: "text-amber-500",  bar: "bg-amber-500" },
  gray:   { tile: "bg-gray-100",       icon: "text-gray-400",   bar: "bg-gray-400" },
};

// ---------------------------------------------------------------------------
export default function AdminConsole() {
  const [screen, setScreen] = useState("dashboard"); // dashboard | users | detail | groups | create
  const [members, setMembers] = useState([]);       // loaded live from the API
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [activeId, setActiveId] = useState(null);
  const [returnScreen, setReturnScreen] = useState("users"); // where Detail's Back button should go
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [filters, setFilters] = useState({ q: "", status: "all", role: "all", level: "all" });
  const [selected, setSelected] = useState(() => new Set());
  const [otpModal, setOtpModal] = useState(null); // { member, code }
  const [toast, setToast] = useState(null);

  const stats = useMemo(() => computeStats(members), [members]);
  const activeUser = members.find((m) => m.activity_member_id === activeId) || null;

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  // Load lookups + members from the live read-only API once, before first render.
  useEffect(() => {
    (async () => {
      try {
        const [uts, uls, comps, constituencies, parliaments, mems] = await Promise.all([
          getUserTypes(), getUserLevels(), getComponents(), getConstituencies(), getParliaments(), getMembers("all"),
        ]);
        USER_TYPES = uts;
        USER_LEVELS = uls.levels;
        USED_LEVEL_IDS = uls.used_level_ids;
        COMPONENTS = comps;
        LIVE_CONSTITUENCIES = constituencies.map((c) => ({ id: c.constituency_id, name: c.name }));
        LIVE_PARLIAMENTS = parliaments.map((p) => ({ id: p.constituency_id, name: p.name }));
        setMembers(mems);
      } catch (e) {
        setLoadError("Could not reach the API. Is the backend running on http://localhost:4000 ?");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return members.filter((m) => {
      if (filters.status === "active" && m.is_acitve !== "Y") return false;
      if (filters.status === "inactive" && m.is_acitve !== "N") return false;
      if (filters.role !== "all" && String(m.role_id) !== filters.role) return false;
      if (filters.level !== "all" && String(m.level_id) !== filters.level) return false;
      if (q) {
        const hay = `${m.member_name} ${m.membership_id || ""} ${m.mobile_no || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [members, filters]);

  function saveMember(edited) {
    setMembers((ms) => ms.map((m) => m.activity_member_id === edited.activity_member_id ? edited : m));
    flash(`Changes saved for ${edited.member_name}`);
  }
  function openOtp(m) { setOtpModal({ member: m, code: generateOtp() }); }
  function openDetail(id ,from = screen) { setActiveId(id); setReturnScreen(from); setScreen("detail"); }
  // The only two writes in this app that hit the real DB (Backend/main.py's
  // two PUT endpoints) — everything else here is client-side mock state.
  async function changeMemberRole(id, role) {
    const updated = await updateMemberRole(id, role.id);
    setMembers((ms) => ms.map((m) => m.activity_member_id === id ? updated : m));
    flash(`Role updated to ${role.type} for ${updated.member_name}`);
    return updated;
  }
  async function toggleMemberActive(id, nextActive) {
    const updated = await updateMemberActive(id, nextActive);
    setMembers((ms) => ms.map((m) => m.activity_member_id === id ? updated : m));
    flash(`${updated.member_name} ${nextActive === "Y" ? "activated" : "deactivated"}`);
    return updated;
  }
  // Location has no backend write endpoint yet — mock only, like the rest of the app.
  function changeMemberLocation(id, patch) {
    const updated = { ...members.find((m) => m.activity_member_id === id), ...patch };
    setMembers((ms) => ms.map((m) => m.activity_member_id === id ? updated : m));
    flash(`Location updated for ${updated.member_name} (not saved to the server)`);
    return updated;
  }
  function bulkSet(flag) {
    setMembers((ms) => ms.map((m) => selected.has(m.activity_member_id) ? { ...m, is_acitve: flag } : m));
    flash(`${selected.size} login${selected.size > 1 ? "s" : ""} ${flag === "Y" ? "activated" : "deactivated"}`);
    setSelected(new Set());
  }
  function saveGroup(g) {
    setGroups((gs) => {
      const exists = gs.some((x) => x.user_group_id === g.user_group_id);
      return exists ? gs.map((x) => x.user_group_id === g.user_group_id ? g : x) : [...gs, g];
    });
    flash(`Group "${g.notes}" saved`);
  }
  function deleteGroup(id) {
    setGroups((gs) => gs.filter((g) => g.user_group_id !== id));
    setMembers((ms) => ms.map((m) => m.group_id === id ? { ...m, group_id: null } : m));
    setActiveGroupId(null);
    flash("Group deleted");
  }
  function setMemberGroup(memberId, groupId) {
    setMembers((ms) => ms.map((m) => m.activity_member_id === memberId ? { ...m, group_id: groupId } : m));
  }
  function createMember(payload) {
    const role = USER_TYPES.find((r) => r.id === payload.role_id);
    const lvl = USER_LEVELS.find((l) => l.id === payload.level_id);
    const nm = {
      activity_member_id: Math.max(...members.map((m) => m.activity_member_id)) + 1,
      member_name: payload.name, tdp_cadre_id: payload.tdp_cadre_id ?? null,
      membership_id: payload.mid, mobile_no: payload.mobile, is_acitve: "Y",
      inserted_time: new Date().toISOString(), updated_by: 101,
      role_id: role.id, role_name: role.type, role_short: role.short,
      level_id: lvl.id, level_name: lvl.name, location_value: payload.location,
      component_ids: [...payload.components].sort((a, b) => a - b),
      group_id: payload.group_id || null,
    };
    setMembers((ms) => [nm, ...ms]);
    setScreen("users");
    flash(`Login created for ${payload.name}`);
    return nm;
  }

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
    { key: "groups", label: "Groups", icon: <FolderTree size={18} />, badge: groups.length },
  ];
  const CRUMB = { dashboard: "Console", users: "Access management", detail: "Access management", groups: "Reference", create: "Access management" };
  const TITLE = { dashboard: "Dashboard", users: "Login accounts", detail: activeUser?.member_name || "Login", groups: "Group catalogue", create: "New login" };

  if (loading || loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-100 p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          {!loadError && <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-yellow-200 border-t-yellow-600" />}
          <span className={cn("text-sm", loadError ? "text-red-500" : "text-gray-500")}>
            {loadError || "Loading live data…"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-amber-50 via-yellow-50 to-orange-100 font-sans text-gray-900">
      {/* SIDEBAR */}
      <aside className="sticky top-0 flex h-screen w-60 flex-none flex-col border-r border-white/60 bg-black py-5 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 pb-5">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-amber-600 to-yellow-700 font-head text-lg font-bold text-white shadow-md">U</div>
          <div className="leading-tight">
            <div className="font-head text-[15px] font-bold tracking-tight text-white">User</div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-yellow-700">Admin Console</div>
          </div>
        </div>
        <div className="px-5 py-1.5 text-[9.5px] uppercase tracking-[0.14em] text-gray/40">Manage</div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((it) => {
            const on = screen === it.key || (it.key === "users" && screen === "detail");
            return (
              <button key={it.key} onClick={() => { setScreen(it.key); setActiveId(null); }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all",
                  on
                    ? "bg-yellow-500 font-semibold"
                    : "font-medium text-gray-600 ",
                )}>
                <span className="flex w-[18px] flex-none">{it.icon}</span>
                <span className="flex-1 text-white">{it.label}</span>
                {it.badge != null && (
                  <span className="rounded-full bg-yellow-200/70 px-2 py-0.5 text-[10px] font-semibold text-yellow-700">{it.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-4">
          <div className="flex items-center gap-3 rounded-xl  ">
            <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-amber-600 to-yellow-700 font-head text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold text-gray-400">ADMIN</div>
              {/* <div className="text-[11px] text-gray-400">Administrator</div> */}
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* TOPBAR */}
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-white/60 bg-white/50 px-6 py-4 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <div className="text-[22 px] uppercase tracking-[0.12em] text-yellow-700 font-bold">{TITLE[screen]} </div>
            <h1 className="font-head text-[10.5px] font-semibold leading-tight">TDP User Management</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold">ADMIN</div>
              <div className="text-[11px] text-gray-400">Administrator</div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-amber-600 to-orange-700 font-head font-bold text-white shadow">A</div>
          </div>
        </header>

        <div key={screen + (activeId || "")} className="flex-1 animate-fade-in-up px-6 pb-16 pt-6">
          {screen === "dashboard" && (
            <Overview
              stats={stats}
              members={members}
              onCreate={() => setScreen("create")}
              onViewActive={() => { setFilters((f) => ({ ...f, status: "active" })); setScreen("users"); }}
              onViewInactive={() => { setFilters((f) => ({ ...f, status: "inactive" })); setScreen("users"); }}
              onOpenMember={(id) => openDetail(id, "dashboard")}
            />
          )}
          {screen === "users" && (
            <UsersScreen rows={filtered} total={members.length} filters={filters} setFilters={setFilters}
              selected={selected} setSelected={setSelected} bulkSet={bulkSet} onOpen={(id) => openDetail(id, "users")}
              onReset={openOtp} onBack={() => setScreen("dashboard")} />
          )}
          {screen === "detail" && activeUser && (
            <DetailScreen key={activeUser.activity_member_id} u={activeUser} groups={groups}
              // onBack={() => setScreen("users")} onSave={saveMember} onReset={() => openOtp(activeUser)} />
              onBack={() => setScreen(returnScreen)} onSave={saveMember} onReset={() => openOtp(activeUser)}
             backLabel={returnScreen === "dashboard" ? "Back to dashboard" : "Back to logins"} />
          )}
          {screen === "groups" && (
            <GroupsScreen groups={groups} members={members} activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId} onSaveGroup={saveGroup} onDeleteGroup={deleteGroup} onSetMemberGroup={setMemberGroup} />
          )}
          {screen === "create" && (
            <CreateScreen groups={groups} members={members}
              onBack={() => setScreen("dashboard")} onCreate={createMember} onOtp={openOtp}
              onChangeRole={changeMemberRole} onToggleActive={toggleMemberActive} onChangeLocation={changeMemberLocation} />
          )}
        </div>
      </main>

      {otpModal && <OtpModal data={otpModal} onRegenerate={() => setOtpModal({ ...otpModal, code: generateOtp() })} onClose={() => setOtpModal(null)} onSent={() => { flash(`OTP sent to ${otpModal.member.member_name}`); setOtpModal(null); }} />}
      {toast && (
        <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 animate-fade-in-up items-center gap-2 rounded-xl border border-gray-100 bg-white px-4 py-2.5 text-sm shadow-xl">
          <Check size={15} className="text-green-500" /> {toast}
        </div>
      )}
    </div>
  );
}

// --- shared bits -------------------------------------------------------------
function Card({ children, className, onClick }) {
  return <div className={cn(CARD, className)} onClick={onClick}>{children}</div>;
}
// Cadre photo when we have one and it loads; falls back to initials otherwise
// (no photo on file, or the S3 URL 404s/errors). `className` carries sizing +
// rounding + the fallback background/gradient; `textClassName` styles the initials.

function Avatar({ name, imageUrl, className, textClassName, zoomable = false }) {
  const [failed, setFailed] = useState(false);
  const [zoomed, setZoomed] = useState(false);
  const canZoom = zoomable && imageUrl && !failed;
  return (
    <>
      <div
        className={cn("relative grid flex-none place-items-center overflow-hidden", className, canZoom && "cursor-zoom-in")}
        onClick={canZoom ? () => setZoomed(true) : undefined}
        title={canZoom ? "Click to view photo" : undefined}
      >
        <span className={textClassName}>{initials(name)}</span>
        {imageUrl && !failed && (
          <img src={imageUrl} alt="" onError={() => setFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        )}
      </div>
      {zoomed && (
        <div onClick={() => setZoomed(false)} className="fixed inset-0 z-50 grid place-items-center bg-gray-900/80 p-6 backdrop-blur-sm">
          <button onClick={() => setZoomed(false)} className="absolute right-5 top-5 rounded-full bg-white/10 p-2 text-white transition-colors hover:bg-white/20">
            <X size={20} />
          </button>
          <img
            src={imageUrl}
            alt={name || ""}
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-[85vw] rounded-2xl object-contain shadow-2xl"
          />
        </div>
      )}
    </>
  );
}
function SectionTitle({ icon, children }) {
  return <div className={SECTION}><span className="flex">{icon}</span>{children}</div>;
}
function StatusPill({ active }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
      active ? "bg-green-100 text-green-700"
             : "bg-gray-100 text-gray-500",
    )}>
      <span className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-green-500" : "bg-gray-400")} />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
function RoleBadge({ label }) {
  return <span className="rounded-full bg-yellow-100 px-2.5 py-0.5 text-[10.5px] font-semibold text-yellow-700">{label}</span>;
}
function KV({ k, v, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{k}</span>
      <span className={cn("break-words text-right", mono && "font-mono")}>{v}</span>
    </div>
  );
}
// Inline "Label: value" pair, for details laid out horizontally rather than as a KV grid.
function HKV({ k, v }) {
  return <span className="text-gray-500">{k}: <span className="font-medium text-gray-800">{v}</span></span>;
}
function Field({ label, children }) {
  return <label className="flex min-w-[130px] flex-col gap-1.5"><span className={LABEL}>{label}</span>{children}</label>;
}
// Inline "Label: <control>" pair — a select/input sitting next to its label on one line.
function FieldInline({ label, children }) {
  return <label className="flex items-center gap-1.5 text-sm"><span className={LABEL}>{label}:</span>{children}</label>;
}
function ErrLine({ children }) {
  return <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={14} /> {children}</div>;
}

// SVG progress ring — the reference's CircularProgressBar, in yellow.
function Ring({ pct, size = 88, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-yellow-100" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} className="fill-none stroke-yellow-600 transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center font-head font-bold text-yellow-700" style={{ fontSize: size * 0.24 }}>{pct}%</div>
    </div>
  );
}

// --- OVERVIEW ---------------------------------------------------------------
function Overview({ stats, members, onCreate, onViewActive, onViewInactive, onOpenMember }) {
  const [expandedRole, setExpandedRole] = useState(null);
  const [componentsRole, setComponentsRole] = useState(null);
  const kpis = [
    { label: "Total Users", value: stats.total, icon: <Users size={20} />, note: "All login accounts", cat: "blue" },
    { label: "Active Users", value: stats.active, icon: <UserCheck size={20} />, note: "Can sign in", cat: "green", onClick: onViewActive },
    { label: "Inactive Users", value: stats.inactive, icon: <UserX size={20} />, note: "Deactivated", cat: "gray", onClick: onViewInactive },
  ];
  const HIDDEN_ROLES = new Set(["OTHERS", "LN TEAM", "TEST USER", "MYTDP APP", "null"]);
  const roleRows = Object.entries(stats.roleCounts)
    .filter(([role]) => !HIDDEN_ROLES.has(role) && !/^OTHERS?$|MYTDP/i.test(role))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8);
  const maxComp = Math.max(1, ...stats.topComponents.map((c) => c.count));
  const roleMembers = expandedRole ? members.filter((m) => m.is_acitve === "Y" && m.role_short === expandedRole) : [];
  const componentsRoleMembers = componentsRole ? members.filter((m) => m.is_acitve === "Y" && m.role_short === componentsRole) : [];
  const componentsRoleStats = (() => {
    const counts = {};
    componentsRoleMembers.forEach((m) => m.component_ids.forEach((id) => { counts[id] = (counts[id] || 0) + 1; }));
    return Object.entries(counts)
      .map(([id, count]) => { const c = COMPONENTS.find((x) => x.id === +id); return { id: +id, label: c ? componentLabel(c) : `#${id}`, count }; })
      .sort((a, b) => b.count - a.count);
  })();

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {kpis.map((k) => {
          const cat = CAT[k.cat];
          return (
            <Card key={k.label} className={cn(CARD_HOVER, "p-5", k.onClick && "cursor-pointer")} onClick={k.onClick}>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-[10.5px] font-medium uppercase tracking-wide text-gray-400">{k.label}</span>
                <span className={cn("grid h-10 w-10 place-items-center rounded-xl shadow-sm", cat.tile, cat.icon)}>{k.icon}</span>
              </div>
              <div className="font-head text-[30px] font-bold leading-none">{k.value}</div>
              <div className="mt-1.5 text-[11px] text-gray-500">{k.note}</div>
            </Card>
          );
        })}
        <button onClick={onCreate} className={cn(CARD_HOVER, "flex flex-col items-start justify-between rounded-2xl border border-yellow-300/60 bg-gradient-to-br from-amber-600 to-orange-700 p-5 text-left text-white shadow-lg")}>
          <div className="mb-4 flex w-full items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-white/70">Quick action</span>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20"><UserPlus size={20} /></span>
          </div>
          <div className="font-head text-lg font-bold leading-tight">Create New User</div>
          <div className="mt-1.5 text-[11px] text-white/80">Add a login account</div>
        </button>
      </div>

      {/* Standard bundle callout — the report's headline finding. [§4.2] */}
      {/*<Card className="flex flex-wrap items-center gap-5 p-6">
        <Ring pct={stats.onStandardPct} />
        <div className="min-w-[220px] flex-1">
          <div className="font-head text-base font-semibold">{stats.onStandard} active logins share one component bundle</div>
          <div className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">
            Membership Dashboard, Cubs-Committees, Committee Meetings, SIR Dashboard. Role and component set are largely decoupled — the "New login" flow offers this as a one-click preset.
          </div>
        </div>
      </Card>*/}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle icon={<ShieldCheck size={14} />}>Logins by role</SectionTitle>
          <div className="mt-4 flex flex-col gap-3.5">
            {roleRows.map(([role, n]) => {
              const share = stats.active ? (n / stats.active) * 100 : 0;
              const open = expandedRole === role;
              return (
                <div key={role} className="flex items-center gap-3">
                  <span className="w-28 flex-none truncate text-[13px] font-medium">{role}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-yellow-500 to-orange-500 transition-all duration-500" style={{ width: `${share}%` }} />
                  </div>
                  <span className="w-12 flex-none text-right font-mono text-[13px] font-semibold tabular-nums">{n}</span>
                  <span className="w-14 flex-none text-right font-mono text-[11px] tabular-nums text-yellow-700">{share.toFixed(1)}%</span>
                  <button onClick={() => setExpandedRole(open ? null : role)} title={`View ${role} logins`}
                    className={cn("flex-none rounded-lg p-1.5 transition-colors", open ? "bg-yellow-100 text-yellow-600" : "text-gray-400 hover:bg-yellow-50 hover:text-yellow-600")}>
                    <Eye size={14} />
                  </button>
                  <button onClick={() => setComponentsRole(role)} title={`View ${role} components`}
                    className={cn("flex-none rounded-lg p-1.5 transition-colors", componentsRole === role ? "bg-orange-100 text-orange-600" : "text-gray-400 hover:bg-orange-50 hover:text-orange-600")}>
                    <Layers size={14} />
                  </button>
                </div>
              );
            })}
          </div>
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<Layers size={14} />}>Most-granted components</SectionTitle>
          <div className="mt-4 flex flex-col gap-3">
            {stats.topComponents.map((c) => (
              <div key={c.id}>
                <div className="mb-1 flex justify-between gap-2 text-xs">
                  <span className="truncate">{c.label}</span>
                  <span className="flex-none text-gray-400">{c.count}</span>
                </div>
                <div className="h-1.5 rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-orange-500 transition-all duration-500" style={{ width: `${(c.count / maxComp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {expandedRole && (
        <Card className="overflow-hidden">
          <div className="flex items-center justify-between p-6 pb-0">
            <SectionTitle icon={<Eye size={14} />}>{expandedRole} — logins ({roleMembers.length})</SectionTitle>
            <button onClick={() => setExpandedRole(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <div className="mt-3.5 max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0">
                <tr className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-400">
                  {["Membership ID", "Name", "Mobile", "Role", "Scope", "Status", "Created", ""].map((h, i) => (
                    <th key={i} className={cn("whitespace-nowrap bg-gray-50/80 font-medium", i === 7 ? "px-4 py-2.5 text-right" : "px-2 py-2.5 text-left", i === 0 && "pl-6")}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {roleMembers.map((m) => (
                  <tr key={m.activity_member_id} className="border-t border-gray-100 transition-colors hover:bg-yellow-50/50">
                    <td onClick={() => onOpenMember(m.activity_member_id)} className="cursor-pointer py-2.5 pl-6 font-head font-semibold hover:text-yellow-600">
                      {m.membership_id || <span className="text-[11px] text-amber-600">— none —</span>}
                    </td>
                    <td onClick={() => onOpenMember(m.activity_member_id)} className="cursor-pointer px-2 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={m.member_name} imageUrl={m.image_url} className="h-7 w-7 rounded-full bg-yellow-100" textClassName="font-head text-[10px] font-semibold text-yellow-600" />
                        <span className={m.member_name ? "" : "text-gray-400"}>{m.member_name || NO_NAME}</span>
                      </div>
                    </td>
                    <td className={cn("px-2 py-2.5", m.mobile_no ? "" : "text-amber-600")}>{m.mobile_no || "missing"}</td>
                    <td className="px-2 py-2.5">{m.role_short ? <RoleBadge label={m.role_short} /> : <span className="text-[11px] text-gray-400">—</span>}</td>
                    <td className="px-2 py-2.5 text-xs text-gray-500">{m.level_name ? `${m.level_name}${m.location_name ? ` · ${m.location_name}` : m.location_value ? ` · ${m.location_value}` : ""}` : "—"}</td>
                    <td className="px-2 py-2.5"><StatusPill active={m.is_acitve === "Y"} /></td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-xs text-gray-500">{fmtDate(m.inserted_time)}</td>
                    <td className="whitespace-nowrap px-4 py-2 text-right">
                      <button title="View" onClick={() => onOpenMember(m.activity_member_id)} className="inline-grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-yellow-100 hover:text-yellow-600"><Eye size={15} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {roleMembers.length === 0 && <div className="p-9 text-center text-sm text-gray-400">No logins for this role.</div>}
          </div>
        </Card>
      )}

      {/* Geographic scope — only 3 of 9 levels used. [§3.3] */}
      {/*<Card className="p-6">
        <SectionTitle icon={<MapPin size={14} />}>Geographic scope in use</SectionTitle>
        <div className="mt-4 flex flex-wrap gap-4">
          {USED_LEVEL_IDS.map((lid) => {
            const name = USER_LEVELS.find((l) => l.id === lid).name;
            const n = stats.levelCounts[name] || 0;
            return (
              <div key={lid} className="min-w-[140px] flex-1 rounded-xl border border-gray-100 bg-gray-50/60 p-4">
                <div className="font-head text-2xl font-bold">{n}</div>
                <div className="mt-0.5 text-[11px] uppercase tracking-wide text-gray-400">{name}</div>
              </div>
            );
          })}
          <div className="flex min-w-[140px] flex-1 items-center rounded-xl border border-dashed border-gray-200 p-4 text-xs text-gray-400">
            The other 6 levels (District, Mandal, Village…) have no members.
          </div>
        </div>
      </Card>*/}

      {componentsRole && (
        <RoleComponentsModal
          role={componentsRole}
          components={componentsRoleStats}
          total={componentsRoleMembers.length}
          onClose={() => setComponentsRole(null)}
        />
      )}
    </div>
  );
}

function RoleComponentsModal({ role, components, total, onClose }) {
  return (
    <div onClick={onClose} className="fixed inset-0 z-40 grid place-items-center bg-gray-900/50 p-5 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="w-[min(420px,100%)] animate-fade-in-up overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <div>
            <h3 className="font-head text-base font-semibold">{role} — components</h3>
            <p className="mt-0.5 text-[11px] text-gray-400">Granted across {total} active login{total === 1 ? "" : "s"}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="max-h-[360px] overflow-auto p-5">
          {components.length === 0 && <div className="py-6 text-center text-sm text-gray-400">No components granted.</div>}
          <div className="flex flex-col gap-2.5">
            {components.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 rounded-xl border border-gray-100 bg-gray-50/60 px-3.5 py-2.5">
                <span className="text-[13px] font-medium">{c.label}</span>
                <span className="flex-none rounded-full bg-orange-100 px-2 py-0.5 font-mono text-[11px] font-semibold text-orange-700">{c.count}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end border-t border-gray-100 px-5 py-3.5">
          <button onClick={onClose} className={SECONDARY}>Close</button>
        </div>
      </div>
    </div>
  );
}

// --- USERS ------------------------------------------------------------------
function UsersScreen({ rows, total, filters, setFilters, selected, setSelected, bulkSet, onOpen, onReset, onBack }) {
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.activity_member_id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSel) rows.forEach((r) => next.delete(r.activity_member_id));
    else rows.forEach((r) => next.add(r.activity_member_id));
    setSelected(next);
  };
  const toggleOne = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };

  return (
    <div className="flex flex-col gap-4">
      <button onClick={onBack} className="flex items-center gap-1.5 self-start text-sm text-gray-500 transition-colors hover:text-yellow-600">
        <ChevronLeft size={16} /> Back to dashboard
      </button>

      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className={LABEL}>Search membership ID, name or mobile</span>
          <div className="group relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-yellow-700" />
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="e.g. 20481 or Priya"
              className={cn(INPUT, "pl-9")} />
          </div>
        </label>
        <Field label="Status">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} className={INPUT}>
            <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field label="Role">
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} className={INPUT}>
            <option value="all">All roles</option>
            {USER_TYPES.filter((r) => r.type !== "STATE" && r.type !== "COUNTRY").map((r) => (
              <option key={r.id} value={r.id}>{r.type === "CONSTITUENCY" ? "ACI" : r.type}</option>
            ))}
          </select>
        </Field>
        <Field label="Level">
          <select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })} className={INPUT}>
            <option value="all">All levels</option>
            {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}
          </select>
        </Field>
        <button onClick={() => setFilters({ q: "", status: "all", role: "all", level: "all" })} className={SECONDARY}>Reset</button>
      </Card>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-yellow-100 bg-yellow-50 px-4 py-2.5">
          <strong className="text-sm text-yellow-700">{selected.size} selected</strong>
          <button onClick={() => bulkSet("Y")} className={SECONDARY}>Activate</button>
          <button onClick={() => bulkSet("N")} className={SECONDARY}>Deactivate</button>
          <button onClick={() => setSelected(new Set())} className="text-sm font-medium text-gray-500 hover:text-gray-700">Clear</button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between p-6 pb-0">
          <SectionTitle icon={<Eye size={14} />}>
            {filters.status === "active" ? "Active" : filters.status === "inactive" ? "Inactive" : "All"} — logins ({rows.length})
          </SectionTitle>
        </div>
        <div className="mt-3.5 max-h-[420px] overflow-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="w-9 bg-gray-50/80 py-2.5 pl-6 text-left">
                  <input type="checkbox" checked={allSel} onChange={toggleAll} className="h-4 w-4 accent-yellow-600" />
                </th>
                {["Membership ID", "Name", "Mobile", "Role", "Scope", "Status", "Created", ""].map((h, i) => (
                  <th key={i} className={cn("whitespace-nowrap bg-gray-50/80 font-medium", i === 7 ? "px-4 py-2.5 text-right" : "px-2 py-2.5 text-left")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.activity_member_id} className="border-t border-gray-100 transition-colors hover:bg-yellow-50/50">
                  <td className="pl-6"><input type="checkbox" checked={selected.has(u.activity_member_id)} onChange={() => toggleOne(u.activity_member_id)} className="h-4 w-4 accent-yellow-600" /></td>
                  <td onClick={() => onOpen(u.activity_member_id)} className="cursor-pointer px-2 py-2.5 font-head font-semibold hover:text-yellow-600">
                    {u.membership_id || <span className="text-[11px] text-amber-600">— none —</span>}
                  </td>
                  <td onClick={() => onOpen(u.activity_member_id)} className="cursor-pointer px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={u.member_name} imageUrl={u.image_url} className="h-7 w-7 rounded-full bg-yellow-100" textClassName="font-head text-[10px] font-semibold text-yellow-600" />
                      <span className={u.member_name ? "" : "text-gray-400"}>{u.member_name || NO_NAME}</span>
                    </div>
                  </td>
                  <td className={cn("px-2 py-2.5", u.mobile_no ? "" : "text-amber-600")}>{u.mobile_no || "missing"}</td>
                  <td className="px-2 py-2.5">{u.role_short ? <RoleBadge label={u.role_short} /> : <span className="text-[11px] text-gray-400">—</span>}</td>
                  <td className="px-2 py-2.5 text-xs text-gray-500">{u.level_name ? `${u.level_name}${u.location_name ? ` · ${u.location_name}` : u.location_value ? ` · ${u.location_value}` : ""}` : "—"}</td>
                  <td className="px-2 py-2.5"><StatusPill active={u.is_acitve === "Y"} /></td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs text-gray-500">{fmtDate(u.inserted_time)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button title="View" onClick={() => onOpen(u.activity_member_id)} className="ml-0.5 inline-grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-yellow-100 hover:text-yellow-600"><Eye size={15} /></button>
                    <button title="Reset OTP login" onClick={() => onReset(u)} className="ml-0.5 inline-grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-yellow-100 hover:text-yellow-600"><KeyRound size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div className="p-9 text-center text-sm text-gray-400">No logins match these filters.</div>}
        <div className="flex justify-between border-t border-gray-100 px-4 py-2.5 text-xs text-gray-400">
          <span>Showing {rows.length} of {total} logins</span>
          <span>Live data</span>
        </div>
      </Card>
    </div>
  );
}

// --- DETAIL (draft + Save) --------------------------------------------------
function DetailScreen({ u, groups, onBack, onSave, onReset ,backLabel = "Back to logins"}) {
  const [draft, setDraft] = useState(u);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [accessOpen, setAccessOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [scopeEdit, setScopeEdit] = useState(false);
  const [locEdit, setLocEdit] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(u);

  const grp = draft.group_id ? groups.find((g) => g.user_group_id === draft.group_id) : null;
  const inheritedIds = new Set(grp ? grp.component_ids : []);
  const effective = effectiveComponents(draft, groups);
  const addable = COMPONENTS.filter((c) => !inheritedIds.has(c.id) && !draft.component_ids.includes(c.id));
  const locList = draft.level_id === 5 ? LIVE_CONSTITUENCIES : draft.level_id === 4 ? LIVE_PARLIAMENTS : [{ id: draft.location_value ?? "", name: "Andhra Pradesh" }];

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setRole = (id) => { const r = USER_TYPES.find((x) => x.id === id); set({ role_id: id, role_name: r.type, role_short: r.short }); setRoleMenuOpen(false); };
  const setLevel = (id) => {
    const l = USER_LEVELS.find((x) => x.id === id);
    set({ level_id: id, level_name: l.name, location_value: "", location_name: "", locations: [] });
  };
  // Local-only, staged multi-select: toggles a location in/out of draft.locations.
  // Not wired to a write endpoint yet — "Save changes" still only persists the
  // single location_value/location_name pair (mirrored from the first entry here).
  const toggleLocation = (loc) => {
    const current = draft.locations || [];
    const exists = current.some((x) => x.location_value === loc.id);
    const next = exists
      ? current.filter((x) => x.location_value !== loc.id)
      : [...current, { level_id: draft.level_id, level_name: draft.level_name, location_value: loc.id, location_name: loc.name }];
    set({ locations: next, location_value: next[0]?.location_value ?? "", location_name: next[0]?.location_name ?? "" });
  };
  const addPersonal = (id) => set({ component_ids: [...draft.component_ids, id].sort((a, b) => a - b) });
  const removePersonal = (id) => set({ component_ids: draft.component_ids.filter((x) => x !== id) });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-yellow-600">
          <ChevronLeft size={16} /> Back to logins
        </button>
        <div className="flex items-center gap-2.5">
          {dirty && <span className="flex items-center gap-1.5 text-xs text-amber-600"><AlertTriangle size={13} /> Unsaved changes</span>}
          <button disabled={!dirty} onClick={() => setDraft(u)} className={SECONDARY}><RotateCcw size={14} /> Discard</button>
          <button disabled={!dirty} onClick={() => onSave(draft)} className={PRIMARY}><Save size={14} /> Save changes</button>
        </div>
      </div>

      {/* Identity + every detail field, in one horizontal box. */}
      <Card className="p-7">
        <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="flex min-w-[220px] items-center gap-4">
            <Avatar name={draft.member_name} imageUrl={draft.image_url} className="h-14 w-14 rounded-full bg-gradient-to-br from-amber-600 to-orange-700 shadow-md" textClassName="font-head text-lg font-bold text-white" zoomable/>
            <div className="min-w-0">
              <div className="truncate font-head text-base font-semibold">{draft.member_name || NO_NAME}</div>
            </div>
          </div>

          <div className="flex flex-none flex-wrap items-center gap-2">
            <span className={LABEL}>Role:</span>
            <RoleBadge label={draft.role_name || "No role"} />
            <div className="relative">
              <button onClick={() => setRoleMenuOpen((v) => !v)} className={cn(SECONDARY, "px-3 py-1.5 text-[11.5px]")}><Plus size={12} /> Add role</button>
              {roleMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
                  {USER_TYPES.map((r) => (
                    <button key={r.id} onClick={() => setRole(r.id)} className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-yellow-50">{r.type}</button>
                  ))}
                </div>
              )}
            </div>
            <StatusPill active={draft.is_acitve === "Y"} />
            <button onClick={() => set({ is_acitve: draft.is_acitve === "Y" ? "N" : "Y" })} className={cn(SECONDARY, "px-3 py-1.5 text-[11.5px]")}>
              {draft.is_acitve === "Y" ? "Deactivate" : "Activate"}
            </button>
            <button onClick={onReset} className={cn(SECONDARY, "px-3 py-1.5 text-[11.5px]")}><KeyRound size={12} /> Reset OTP</button>
          </div>
        </div>

        {/* Every detail field, directly under the name. */}
        <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-3 border-t border-gray-100 pt-5">
          <HKV k="MID" v={draft.membership_id || "— none —"} />
          <FieldInline label="Mobile No">
            <input value={draft.mobile_no || ""} onChange={(e) => set({ mobile_no: e.target.value || null })}
              className="w-32 rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-200 focus:border-yellow-400" placeholder="9xxxxxxxxx" />
          </FieldInline>
          <FieldInline label="Access Scope">
            <span className="font-medium text-gray-800">{draft.level_name || "— none —"}</span>
            <div className="relative">
              <button onClick={() => setScopeEdit((v) => !v)} title="Edit access scope" className="text-gray-400 hover:text-yellow-600"><Pencil size={12} /></button>
              {scopeEdit && (
                <div className="absolute left-0 top-full z-10 mt-1 w-40 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
                  {USED_LEVEL_IDS.map((lid) => {
                    const l = USER_LEVELS.find((x) => x.id === lid);
                    return (
                      <button key={lid} onClick={() => { setLevel(lid); setScopeEdit(false); }}
                        className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-yellow-50">{l.name}</button>
                    );
                  })}
                </div>
              )}
            </div>
          </FieldInline>
          <FieldInline label="Location">
            <span className="font-medium text-gray-800">
              {draft.locations && draft.locations.length > 1
                ? `${draft.locations.length} locations`
                : (draft.location_name || draft.location_value || "— none —")}
            </span>
            <div className="relative">
              <button onClick={() => setLocEdit((v) => !v)} title="Edit location" className="text-gray-400 hover:text-yellow-600"><Pencil size={12} /></button>
              {locEdit && (
                <div className="absolute left-0 top-full z-10 mt-1 max-h-64 w-56 overflow-auto rounded-xl border border-gray-100 bg-white p-1 shadow-xl">
                  {locList.map((l) => {
                    const checked = (draft.locations || []).some((x) => x.location_value === l.id);
                    return (
                      <label key={l.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-xs text-gray-700 hover:bg-yellow-50">
                        <input type="checkbox" checked={checked} onChange={() => toggleLocation(l)} className="h-3.5 w-3.5 accent-yellow-600" />
                        {l.name}
                      </label>
                    );
                  })}
                  <button onClick={() => setLocEdit(false)} className="mt-1 w-full rounded-lg bg-yellow-50 px-2 py-1.5 text-center text-xs font-medium text-yellow-700 hover:bg-yellow-100">Done</button>
                </div>
              )}
            </div>
          </FieldInline>
          <FieldInline label="Group">
            <select value={draft.group_id || ""} onChange={(e) => set({ group_id: e.target.value ? +e.target.value : null })}
              className="rounded-lg border border-gray-200 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-200 focus:border-yellow-400">
              <option value="">No group</option>
              {groups.map((g) => <option key={g.user_group_id} value={g.user_group_id}>{g.notes}</option>)}
            </select>
          </FieldInline>
          <HKV k="Cadre ID" v={draft.tdp_cadre_id ? `#${draft.tdp_cadre_id}` : "unresolved"} />
          <HKV k="User ID" v={`#${draft.activity_member_id}`} />
        </div>
        {draft.locations && draft.locations.length > 1 && (
          <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-gray-100 pt-4">
            <span className={cn(LABEL, "pt-1")}>All locations ({draft.locations.length}):</span>
            <div className="flex flex-1 flex-wrap gap-1.5">
              {draft.locations.map((loc, i) => (
                <span key={i} className="rounded-full bg-yellow-50 px-2.5 py-1 text-[11px] font-medium text-yellow-700">
                  {loc.level_name} · {loc.location_name || loc.location_value}
                </span>
              ))}
            </div>
          </div>
        )}
        {dirty && <div className="mt-4 text-[11px] text-gray-400">Changes here are staged — click "Save changes" above to apply them.</div>}
      </Card>

      <div className="mt-5 flex flex-col gap-5">
        <Card className="p-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <SectionTitle icon={<Layers size={14} />}>Effective access</SectionTitle>
              {grp && <span className="flex items-center gap-1.5 rounded-full bg-yellow-100 px-2.5 py-0.5 text-[11px] font-medium text-yellow-700"><FolderTree size={11} /> {grp.notes}</span>}
            </div>
            <button onClick={() => setAccessOpen((v) => !v)} className={cn(SECONDARY, "px-3 py-1.5 text-[11.5px]")}>
              <Layers size={12} /> Access: {effective.length}
            </button>
          </div>
          {accessOpen && (
            <>
              <div className="mt-3.5 divide-y divide-gray-100">
                {effective.length === 0 && <div className="py-3 text-sm text-amber-600">No dashboards assigned — this account opens to an empty view.</div>}
                {effective.map(({ id, component, inherited, personal }) => {
                  const lockedOnly = inherited && !personal;
                  return (
                    <div key={id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="flex min-w-0 items-center gap-2.5">
                        {inherited
                          ? <span title="Inherited from group" className="flex-none rounded bg-yellow-100 px-1.5 py-px text-[9px] font-semibold tracking-wide text-yellow-700">GROUP</span>
                          : <Check size={14} className="flex-none text-yellow-700" />}
                        <span className={cn("truncate text-sm", lockedOnly ? "text-gray-500" : "text-gray-800")}>{componentLabel(component)}</span>
                      </div>
                      {personal && !inherited && (
                        <button onClick={() => removePersonal(id)} title="Remove personal grant" className="flex-none text-gray-400 hover:text-red-500"><X size={14} /></button>
                      )}
                    </div>
                  );
                })}
              </div>
              {grp && <div className="mt-2.5 text-[11px] text-gray-400">Grey = inherited from group (change on the group, not here). Purple = personal, removable.</div>}
            </>
          )}
        </Card>

        <Card className="p-6">
          <div className="flex items-center justify-between">
            <SectionTitle icon={<Plus size={14} />}>Add personal component</SectionTitle>
            <button onClick={() => setAddOpen((v) => !v)} className={cn(SECONDARY, "px-3 py-1.5 text-[11.5px]")}>
              <Plus size={12} /> {addOpen ? "Hide" : "Add component"}
            </button>
          </div>
          {addOpen && (
            <div className="mt-3.5 flex flex-wrap gap-2">
              {addable.length === 0 && <span className="text-[12.5px] text-gray-400">Nothing left to add — all components are already granted or inherited.</span>}
              {addable.map((c) => (
                <button key={c.id} onClick={() => addPersonal(c.id)} title="Grant to this user only"
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-yellow-400 hover:text-yellow-600">
                  <Plus size={13} /> {componentLabel(c)}
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-6">
          <SectionTitle icon={<ClipboardList size={14} />}>Record</SectionTitle>
          <div className="mt-3.5 grid grid-cols-2 gap-3 text-sm">
            <KV k="Created" v={fmtDateTime(u.inserted_time)} />
            <KV k="Last updated by" v={u.updated_by ? `#${u.updated_by}` : "—"} mono />
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- GROUPS (working mock CRUD) ---------------------------------------------
function GroupsScreen({ groups, members, activeGroupId, setActiveGroupId, onSaveGroup, onDeleteGroup, onSetMemberGroup }) {
  const active = groups.find((g) => g.user_group_id === activeGroupId) || null;
  if (active) {
    return <GroupEditor group={active} members={members} groups={groups}
      onBack={() => setActiveGroupId(null)} onSave={onSaveGroup} onDelete={onDeleteGroup} onSetMemberGroup={onSetMemberGroup} />;
  }
  const nextId = () => (groups.reduce((m, g) => Math.max(m, g.user_group_id), 0) + 1);
  const count = (gid) => members.filter((m) => m.group_id === gid).length;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-start gap-3 border-l-4 border-l-amber-400 p-4">
        <AlertTriangle size={16} className="mt-0.5 flex-none text-amber-500" />
        <div className="text-[12.5px] leading-relaxed text-gray-500">
          <strong className="text-gray-800">Requires two new tables.</strong> Groups here assign components and members, but the current schema has no <code className="text-yellow-600">user_group_member</code> or <code className="text-yellow-600">user_group_component</code> table. This is a working mock — persistence needs those tables built first.
        </div>
      </Card>

      <div className="flex justify-end">
        <button onClick={() => { onSaveGroup({ user_group_id: nextId(), notes: "NEW_GROUP", component_ids: [] }); setActiveGroupId(nextId()); }} className={PRIMARY}>
          <Plus size={16} /> Create group
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
        {groups.map((g) => (
          <Card key={g.user_group_id} className={cn(CARD_HOVER, "cursor-pointer p-5")}>
            <div onClick={() => setActiveGroupId(g.user_group_id)}>
              <div className="flex items-start justify-between">
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-yellow-50 text-yellow-700"><FolderTree size={16} /></span>
                <span className="font-mono text-[10.5px] text-gray-400">#{g.user_group_id}</span>
              </div>
              <div className="mt-3 break-words font-head text-sm font-semibold">{g.notes}</div>
              <div className="mt-3 flex gap-4">
                <div><div className="font-head text-lg font-bold">{count(g.user_group_id)}</div><div className="text-[10px] uppercase tracking-wide text-gray-400">Members</div></div>
                <div><div className="font-head text-lg font-bold">{g.component_ids.length}</div><div className="text-[10px] uppercase tracking-wide text-gray-400">Components</div></div>
              </div>
            </div>
            <button onClick={() => setActiveGroupId(g.user_group_id)} className={cn(SECONDARY, "mt-4 w-full")}>Manage</button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function GroupEditor({ group, members, groups, onBack, onSave, onDelete, onSetMemberGroup }) {
  const [draft, setDraft] = useState(group);
  const dirty = JSON.stringify(draft) !== JSON.stringify(group);
  const [memberQuery, setMemberQuery] = useState("");

  const inGroup = members.filter((m) => m.group_id === group.user_group_id);
  const q = memberQuery.trim().toLowerCase();
  const candidates = q
    ? members.filter((m) => m.group_id !== group.user_group_id &&
        `${m.member_name} ${m.membership_id || ""}`.toLowerCase().includes(q)).slice(0, 6)
    : [];
  const toggleComp = (id) => setDraft((d) => ({
    ...d, component_ids: d.component_ids.includes(id) ? d.component_ids.filter((x) => x !== id) : [...d.component_ids, id].sort((a, b) => a - b),
  }));

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-yellow-600">
          <ChevronLeft size={16} /> All groups
        </button>
        <div className="flex items-center gap-2.5">
          <button onClick={() => onDelete(group.user_group_id)} className="rounded-xl border border-red-200 px-3.5 py-2 text-sm font-medium text-red-600 transition-colors hover:bg-red-50">Delete group</button>
          {dirty && <span className="flex items-center gap-1.5 text-xs text-amber-600"><AlertTriangle size={13} /> Unsaved</span>}
          <button disabled={!dirty} onClick={() => onSave(draft)} className={PRIMARY}><Save size={14} /> Save group</button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-2">
        <div className="flex flex-col gap-5">
          <Card className="p-6">
            <label className="flex flex-col gap-1.5">
              <span className={LABEL}>Group name</span>
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} className={cn(INPUT, "font-head font-semibold")} />
            </label>
          </Card>

          <Card className="p-6">
            <SectionTitle icon={<Layers size={14} />}>What this group can view ({draft.component_ids.length})</SectionTitle>
            <div className="my-2.5 text-xs text-gray-500">Every member inherits these. They can still be given extra components individually.</div>
            <div className="flex flex-wrap gap-2">
              {COMPONENTS.map((c) => {
                const on = draft.component_ids.includes(c.id);
                return (
                  <button key={c.id} onClick={() => toggleComp(c.id)} className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-colors",
                    on ? "border-yellow-300 bg-yellow-50 text-gray-800"
                       : "border-gray-200 text-gray-500 hover:border-yellow-300",
                  )}>
                    {on ? <Check size={12} className="text-yellow-700" /> : <Plus size={12} />} {componentLabel(c)}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="p-6">
          <SectionTitle icon={<Users size={14} />}>Members ({inGroup.length})</SectionTitle>
          <div className="group relative my-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-yellow-700" />
            <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search a login to add…" className={cn(INPUT, "pl-9")} />
          </div>
          {candidates.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-gray-200">
              {candidates.map((m) => (
                <div key={m.activity_member_id} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 last:border-b-0">
                  <span className="text-sm">{m.member_name} <span className="text-[11px] text-gray-400">{m.membership_id || "no MID"}{m.group_id ? " · in another group" : ""}</span></span>
                  <button onClick={() => { onSetMemberGroup(m.activity_member_id, group.user_group_id); setMemberQuery(""); }} className="rounded-lg border border-yellow-300 px-2.5 py-1 text-xs font-medium text-yellow-600 transition-colors hover:bg-yellow-50">Add</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {inGroup.length === 0 && <span className="text-[12.5px] text-gray-400">No members yet. Search above to add logins.</span>}
            {inGroup.map((m) => (
              <div key={m.activity_member_id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <Avatar name={m.member_name} imageUrl={m.image_url} className="h-7 w-7 rounded-full bg-yellow-100" textClassName="font-head text-[10px] font-semibold text-yellow-600" />
                  <span className="text-sm">{m.member_name}<span className="text-[11px] text-gray-400"> · {m.role_name}</span></span>
                </div>
                <button onClick={() => onSetMemberGroup(m.activity_member_id, null)} title="Remove from group" className="flex text-gray-400 hover:text-red-500"><X size={15} /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- OTP MODAL (mock 6-digit generator) -------------------------------------
function OtpModal({ data, onRegenerate, onClose, onSent }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard?.writeText(data.code); } catch (e) { /* clipboard unavailable */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div onClick={onClose} className="fixed inset-0 z-40 grid place-items-center bg-gray-900/50 p-5 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="w-[min(400px,100%)] animate-fade-in-up overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="font-head text-base font-semibold">One-time passcode</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>
        <div className="p-5">
          <div className="text-sm text-gray-600">{data.member.member_name}</div>
          <div className="mb-3.5 text-xs text-gray-500">
            Deliver to {data.member.mobile_no ? "••• " + data.member.mobile_no.slice(-4) : <span className="text-amber-600">no mobile on file</span>}
          </div>
          <div className="mb-3.5 flex justify-center gap-2">
            {data.code.split("").map((d, i) => (
              <span key={i} className="grid w-10 place-items-center rounded-xl border border-yellow-200 bg-yellow-50 font-head text-2xl font-bold text-yellow-700" style={{ height: 52 }}>{d}</span>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={onRegenerate} className={cn(SECONDARY, "flex-1")}><RotateCcw size={13} /> Regenerate</button>
            <button onClick={copy} className={cn(SECONDARY, "flex-1")}><Copy size={13} /> {copied ? "Copied" : "Copy"}</button>
          </div>
          <div className="mt-3.5 flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] leading-relaxed text-amber-700">
            <AlertTriangle size={13} className="mt-0.5 flex-none" />
            Demo only. Real OTPs must be generated, delivered and expired server-side — never in the browser.
          </div>
        </div>
        <div className="flex justify-end gap-2.5 border-t border-gray-100 px-5 py-3.5">
          <button onClick={onClose} className={SECONDARY}>Close</button>
          <button onClick={onSent} className={PRIMARY}>Mark as sent</button>
        </div>
      </div>
    </div>
  );
}

// --- CREATE SCREEN: MID-first stepped flow, full page ------------------------
// If the entered membership ID or mobile number already has a login, we don't
// let a duplicate be created — the found-login panel below lets the admin
// change its role, activate/deactivate it and review its access inline.
function CreateScreen({ groups, members, onBack, onCreate, onOtp, onChangeRole, onToggleActive, onChangeLocation }) {
  const [step, setStep] = useState(1);
  const [lookupMode, setLookupMode] = useState(null); // null | "mid" | "mobile"
  const [mid, setMid] = useState("");
  const [lookupMobile, setLookupMobile] = useState("");
  const [cadre, setCadre] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [existingMember, setExistingMember] = useState(null);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [roleId, setRoleId] = useState(12);
  const [levelId, setLevelId] = useState(5);
  const [location, setLocation] = useState("");
  const [groupId, setGroupId] = useState(null);
  const [comps, setComps] = useState([...STANDARD_BUNDLE]);
  const [err, setErr] = useState("");
  const [looking, setLooking] = useState(false);
  const [roleMenuOpen, setRoleMenuOpen] = useState(false);
  const [locationMenuOpen, setLocationMenuOpen] = useState(false);
  const [pendingLevelId, setPendingLevelId] = useState(5);
  const [pendingLocation, setPendingLocation] = useState("");
  const [savingRole, setSavingRole] = useState(false);
  const [savingActive, setSavingActive] = useState(false);
  const [mobileCandidates, setMobileCandidates] = useState([]);
  const lookedUpRef = useRef("");

  const locList = levelId === 5 ? CONSTITUENCIES : levelId === 4 ? PARLIAMENTS : ["Andhra Pradesh"];
  const pendingLocList = pendingLevelId === 5 ? CONSTITUENCIES : pendingLevelId === 4 ? PARLIAMENTS : ["Andhra Pradesh"];
  const grp = groupId ? groups.find((g) => g.user_group_id === groupId) : null;
  const inheritedIds = new Set(grp ? grp.component_ids : []);

  function switchMode(mode) {
    setLookupMode(mode); setErr(""); setMobileCandidates([]); lookedUpRef.current = "";
  }

  // "Create Membership ID" skips lookup entirely and drops straight into the
  // step-2 manual-entry form — same path the "not found" case already uses,
  // just without having searched for anything first.
  function startManualCreate() {
    setLookupMode("manual"); setCadre(null); setNotFound(true);
    setName(""); setMobile(""); setMid(""); setOtp(""); setMobileCandidates([]);
    setErr(""); lookedUpRef.current = "";
    setStep(2);
  }

  // A found cadre already has a login (AMID set — the by-mobile query only
  // joins active logins, so AMID present always means an active one) → open
  // the existing-login panel. Otherwise the by-mobile query only returns a
  // display subset (no gender/constituency_id/last_name), so re-fetch the
  // full cadre record by its MID to give step 2 the same shape the
  // MID-search path already produces. c.IMAGE carries the photo either way,
  // as a fallback if the re-fetch doesn't turn one up.
  async function selectMobileCandidate(c) {
    if (c.AMID) {
      const existing = members.find((m) => m.activity_member_id === c.AMID);
      setExistingMember(existing || {
        activity_member_id: c.AMID, member_name: c.MEMBERNAME,
        membership_id: c.MID, mobile_no: c.MOBILENO, is_acitve: "Y",
        // TEAMNAME is UT.short_name (the by-mobile query never selects UT.type),
        // so role_short carries it correctly; role_name reuses it too since a
        // short name is the only role data this endpoint has to offer.
        role_name: c.TEAMNAME, role_short: c.TEAMNAME,
        level_name: c.LOCLEVEL, location_value: c.LOCVALUE,
        location_name: c.LOCATION, image_url: c.IMAGE,
      });
      setCadre(null); setNotFound(false);
      setStep(2);
      return;
    }

    const rawMid = c.MID ? c.MID.replace(/^#/, "") : "";
    setLooking(true);
    const full = rawMid ? await lookupCadre(rawMid) : null;
    setLooking(false);
    const found = full || {
      tdp_cadre_id: c.CADREID, membership_id: rawMid || null,
      first_name: c.MEMBERNAME, last_name: "", mobile_no: c.MOBILENO,
      gender: null, constituency_id: null, image_url: c.IMAGE,
    };
    if (!found.image_url) found.image_url = c.IMAGE;
    setCadre(found); setNotFound(false);
    setName(`${found.first_name || ""} ${found.last_name || ""}`.trim());
    setMobile(found.mobile_no || "");
    setStep(2);
  }

  async function doLookup(modeArg, valueArg) {
    const mode = modeArg ?? lookupMode;
    const raw = valueArg ?? (mode === "mid" ? mid : lookupMobile);
    const q = raw.trim();
    setErr("");
    if (!q) return setErr(mode === "mid" ? "Enter a membership ID first." : "Enter a mobile number first.");
    if (mode === "mid" && q.length !== 8) return setErr("Incorrect Membership ID — it must be 8 digits.");

    if (mode === "mid") {
      // Existing logins are already loaded client-side (~1.4k rows) — cheap to check
      // before touching the backend. membership_id comes back "#12345678" from the
      // backend, so strip the "#" before comparing to the raw digits typed.
      const existing = members.find((m) => (m.membership_id || "").replace(/^#/, "") === q);
      if (existing) {
        setExistingMember(existing); setCadre(null); setNotFound(false);
        setStep(2);
        return;
      }
      setLooking(true);
      const found = await lookupCadre(q);
      setLooking(false);
      if (found) {
        setCadre(found); setNotFound(false);
        setName(`${found.first_name || ""} ${found.last_name || ""}`.trim());
        setMobile(found.mobile_no || "");
      } else {
        setCadre(null); setNotFound(true); setName(""); setMobile("");
      }
      setStep(2);
      return;
    }

    // mobile_no isn't unique — pull every cadre sharing this number (some may
    // already have a login, some not) so nothing is silently hidden behind a
    // single match.
    setLooking(true);
    let candidates;
    try {
      candidates = await lookupCadreByMobile(q);
    } catch {
      setLooking(false);
      setErr("Could not look up that mobile number — check the backend is reachable and try again.");
      return;
    }
    setLooking(false);
    if (candidates.length === 0) {
      setCadre(null); setNotFound(true); setName(""); setMobile(q); setMobileCandidates([]);
      setStep(2);
      return;
    }
    if (candidates.length === 1) {
      selectMobileCandidate(candidates[0]);
      return;
    }
    setMobileCandidates(candidates);
  }

  // Auto-lookup once a full membership ID (8 digits) or mobile number (10 digits) is typed.
  // The explicit "Look up cadre" button covers the same action for anyone who doesn't want to wait.
  // A membership ID that stops one digit short (7) gets an immediate "incorrect"
  // hint instead of silently doing nothing, since 7 is the easiest typo to make.
  useEffect(() => {
    if (step !== 1 || !lookupMode) return;
    const q = (lookupMode === "mid" ? mid : lookupMobile).trim();
    const targetLen = lookupMode === "mid" ? 8 : 10;
    if (q.length === targetLen && q !== lookedUpRef.current) {
      lookedUpRef.current = q;
      doLookup(lookupMode, q);
    } else if (lookupMode === "mid" && q.length === 7 && q !== lookedUpRef.current) {
      lookedUpRef.current = q;
      setErr("Incorrect Membership ID — it must be 8 digits.");
    }
  }, [mid, lookupMobile, lookupMode, step]);

  function resetLookup() {
    setExistingMember(null); setCadre(null); setNotFound(false); setMobileCandidates([]);
    setMid(""); setLookupMobile(""); setName(""); setMobile("");
    setRoleMenuOpen(false); setLocationMenuOpen(false); setErr("");
    lookedUpRef.current = ""; setStep(1); setLookupMode(null);
  }

  function toggleLocationMenu() {
    if (!locationMenuOpen) {
      setPendingLevelId(existingMember.level_id || 5);
      setPendingLocation(existingMember.location_value || "");
    }
    setLocationMenuOpen((v) => !v);
  }
  function applyExistingLocation() {
    const l = USER_LEVELS.find((x) => x.id === pendingLevelId);
    const updated = onChangeLocation(existingMember.activity_member_id,
      { level_id: pendingLevelId, level_name: l.name, location_value: pendingLocation });
    setExistingMember(updated);
    setLocationMenuOpen(false);
  }

  async function changeExistingRole(r) {
    setRoleMenuOpen(false);
    setSavingRole(true);
    setErr("");
    try {
      const updated = await onChangeRole(existingMember.activity_member_id, r);
      setExistingMember(updated);
    } catch {
      setErr("Could not update the role — check the backend is reachable and try again.");
    } finally {
      setSavingRole(false);
    }
  }
  async function toggleExistingActive() {
    const next = existingMember.is_acitve === "Y" ? "N" : "Y";
    setSavingActive(true);
    setErr("");
    try {
      const updated = await onToggleActive(existingMember.activity_member_id, next);
      setExistingMember(updated);
    } catch {
      setErr("Could not update the status — check the backend is reachable and try again.");
    } finally {
      setSavingActive(false);
    }
  }

  function submit() {
    setErr("");
    if (!name.trim()) return setErr("Name is required.");
    if (!location) return setErr("Pick a location. A missing scope value silently yields an empty dashboard.");
    const personal = comps.filter((id) => !inheritedIds.has(id));
    const created = onCreate({
      mid: mid.trim(), tdp_cadre_id: cadre ? cadre.tdp_cadre_id : null,
      name: name.trim(), mobile: mobile.trim() || null,
      role_id: roleId, level_id: levelId, location, group_id: groupId, components: personal,
    });
    if (created) onOtp(created);
  }
  const toggle = (id) => setComps((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);

  const Stepper = () => (
    <div className="mb-1 flex gap-1.5">
      {["Membership ID", "Details", "Access"].map((s, i) => {
        const n = i + 1, on = step >= n;
        return (
          <div key={s} className="flex flex-1 items-center gap-2">
            <span className={cn(
              "grid h-6 w-6 flex-none place-items-center rounded-full text-[11px] font-semibold",
              on ? "bg-amber-600 text-white" : "bg-gray-100 text-gray-400",
            )}>{n}</span>
            <span className={cn("text-[11.5px]", on ? "text-gray-800" : "text-gray-400")}>{s}</span>
          </div>
        );
      })}
    </div>
  );

  // A mobile search that turned up more than one person left mobileCandidates
  // populated; once you've drilled into one of them (existingMember panel, or
  // step 2+ of the wizard with a cadre picked from that list), the top-left
  // back link should return you to that picker instead of leaving the create
  // flow entirely. At step 1 with the picker already on screen, it still just
  // exits — there's nothing to "go back to" yet.
  const showBackToResults = mobileCandidates.length > 0 && (!!existingMember || step > 1);
  function backToResults() {
    setExistingMember(null);
    setStep(1);
  }
  // At step 1, once one of the three lookup options has been picked, "back"
  // should land on the options page first — only exits to the dashboard once
  // no option is selected.
  const atStep1Options = step === 1 && !!lookupMode;
  function backFromStep1() {
    if (atStep1Options) switchMode(null);
    else onBack();
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={showBackToResults ? backToResults : backFromStep1} className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-yellow-600">
          <ChevronLeft size={16} /> {showBackToResults ? "Back to results" : atStep1Options ? "Back to options" : "Back to logins"}
        </button>
      </div>

      {existingMember ? (
        // Compact, centered card — deliberately not the full-width wizard below.
        <div className="flex justify-center pt-6">
          <div className="flex w-full max-w-10xl flex-col items-center gap-5">
            <Card className="w-full p-12">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-5">
                  <Avatar name={existingMember.member_name} imageUrl={existingMember.image_url} className="h-40 w-40 rounded-full bg-gradient-to-br from-amber-600 to-orange-700" textClassName="font-head text-2xl font-bold text-white" zoomable />
                  <div className="min-w-0 text-lg">
                    <div className="text-gray-500">Name: <span className="font-head font-semibold text-gray-900">{existingMember.member_name || NO_NAME}</span></div>
                    <div className="mt-1 text-gray-500">MID: <span className="font-medium text-gray-800">{existingMember.membership_id || "— none —"}</span></div>
                    <div className="mt-1 text-gray-500">Mobile No: <span className="font-medium text-gray-800">{existingMember.mobile_no || "— none —"}</span></div>
                  </div>
                </div>
                <div className="flex-none text-right text-base">
                  <span className={LABEL}>Status:</span> <StatusPill active={existingMember.is_acitve === "Y"} />
                </div>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-x-10 gap-y-2 border-t border-gray-100 pt-6 text-lg">
                <div className="text-gray-500">Location: <span className="font-medium text-gray-800">{existingMember.level_name ? `${existingMember.level_name}${existingMember.location_name ? ` · ${existingMember.location_name}` : existingMember.location_value ? ` · ${existingMember.location_value}` : ""}` : "— none —"}</span></div>
                <div className="flex items-center gap-2 text-gray-500">Role: <RoleBadge label={existingMember.role_name || "No role"} /></div>
              </div>

              {err && <div className="mt-4"><ErrLine>{err}</ErrLine></div>}

              <div className="mt-7 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div className="relative">
                  <button onClick={toggleLocationMenu} className={cn(SECONDARY, "w-full py-3.5 text-base")}><MapPin size={16} /> Change Location</button>
                  {locationMenuOpen && (
                    <div className="absolute left-0 top-full z-10 mt-1 w-60 rounded-xl border border-gray-100 bg-white p-3 shadow-xl">
                      <label className="flex flex-col gap-1"><span className={LABEL}>Level</span>
                        <select value={pendingLevelId} onChange={(e) => { setPendingLevelId(+e.target.value); setPendingLocation(""); }} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                          {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}
                        </select>
                      </label>
                      <label className="mt-2 flex flex-col gap-1"><span className={LABEL}>Location</span>
                        <select value={pendingLocation} onChange={(e) => setPendingLocation(e.target.value)} className="rounded-lg border border-gray-200 px-2 py-1.5 text-xs">
                          <option value="">Select…</option>
                          {pendingLocList.map((l) => <option key={l} value={l}>{l}</option>)}
                        </select>
                      </label>
                      <button onClick={applyExistingLocation} className={cn(PRIMARY, "mt-3 w-full py-1.5 text-xs")}>Apply</button>
                    </div>
                  )}
                </div>

                <div className="relative">
                  <button onClick={() => setRoleMenuOpen((v) => !v)} disabled={savingRole} className={cn(SECONDARY, "w-full py-3.5 text-base")}>
                    {savingRole ? "Saving…" : "Change role"}
                  </button>
                  {roleMenuOpen && (
                    <div className="absolute right-0 top-full z-10 mt-1 w-44 overflow-hidden rounded-xl border border-gray-100 bg-white py-1 shadow-xl">
                      {USER_TYPES.map((r) => (
                        <button key={r.id} onClick={() => changeExistingRole(r)} className="block w-full px-3 py-1.5 text-left text-xs text-gray-700 hover:bg-yellow-50">{r.type}</button>
                      ))}
                    </div>
                  )}
                </div>

                <button onClick={() => onOtp(existingMember)} className={cn(SECONDARY, "w-full py-3.5 text-base")}><KeyRound size={16} /> Reset OTP</button>
                <button onClick={toggleExistingActive} disabled={savingActive} className={cn(SECONDARY, "w-full py-3.5 text-base")}>
                  {savingActive ? "Saving…" : existingMember.is_acitve === "Y" ? "Deactivate" : "Activate"}
                </button>
              </div>
            </Card>
            <div className="text-center text-xs leading-relaxed text-gray-500">This login already exists. Role and active-status changes are written directly to the live database; location changes here are local only.</div>
            <button onClick={resetLookup} className={SECONDARY}>Look up another</button>
          </div>
        </div>
      ) : (
      <Card className="min-h-[360px] p-8">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="font-head text-xl font-semibold">New login</h3>
        </div>
        <div className="mb-6 text-sm text-gray-500">Look up a membership ID or mobile number to pull the member's details, role and current access.</div>

        <div className="flex flex-col gap-5">
          <Stepper />

          {step === 1 && (
            <>
              {!lookupMode ? (
                <div className="flex flex-col items-center gap-5 py-8">
                  <div className="text-sm text-gray-500">How do you want to look up this member?</div>
                  <div className="flex flex-wrap justify-center gap-4">
                    <button type="button" onClick={() => switchMode("mid")}
                      className="flex w-44 flex-col items-center gap-2.5 rounded-2xl border-2 border-gray-200 p-6 text-center transition-colors hover:border-yellow-400 hover:bg-yellow-50">
                      <IdCard size={26} className="text-yellow-700" />
                      <span className="font-head text-sm font-semibold">Membership ID</span>
                    </button>
                    <button type="button" onClick={() => switchMode("mobile")}
                      className="flex w-44 flex-col items-center gap-2.5 rounded-2xl border-2 border-gray-200 p-6 text-center transition-colors hover:border-yellow-400 hover:bg-yellow-50">
                      <Smartphone size={26} className="text-yellow-700" />
                      <span className="font-head text-sm font-semibold">Mobile No</span>
                    </button>
                    <button type="button" onClick={startManualCreate}
                      className="flex w-44 flex-col items-center gap-2.5 rounded-2xl border-2 border-gray-200 p-6 text-center transition-colors hover:border-yellow-400 hover:bg-yellow-50">
                      <UserPlus size={26} className="text-yellow-700" />
                      <span className="font-head text-sm font-semibold">Create Membership ID</span>
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <button type="button" onClick={() => switchMode(null)} className="flex w-fit items-center gap-1 text-xs text-gray-400 transition-colors hover:text-yellow-600">
                    <ChevronLeft size={13} /> Change lookup method
                  </button>

                  {lookupMode === "mid" ? (
                    <label className="flex flex-col gap-1.5">
                      <span className={LABEL}>Membership ID</span>
                      <input autoFocus value={mid} onChange={(e) => setMid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} className={INPUT} placeholder="e.g. 20481, 20482, 30017…" />
                    </label>
                  ) : (
                    <label className="flex flex-col gap-1.5">
                      <span className={LABEL}>Mobile number</span>
                      <input autoFocus value={lookupMobile} onChange={(e) => setLookupMobile(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} className={INPUT} placeholder="e.g. 9448005893" />
                    </label>
                  )}

                  <div className="text-xs leading-relaxed text-gray-500">
                    {looking
                      ? "Looking up…"
                      : lookupMode === "mid"
                        ? <>Type a member's 8-digit Membership ID, or click "Look up cadre" below. Try <strong>19457249</strong> for a match; an unknown ID lets you enter the details manually.</>
                        : <>Type a 10-digit mobile number, or click "Look up cadre" below. A mobile number isn't unique — if more than one member shares it, you'll get to pick which one.</>}
                  </div>
                  {err && <ErrLine>{err}</ErrLine>}

                  {mobileCandidates.length > 0 && (
                    <div className="flex flex-col gap-2">
                      <div className="text-xs text-gray-500">{mobileCandidates.length} members share this mobile number — pick one:</div>
                      <div className="overflow-hidden rounded-xl border border-gray-200">
                        {mobileCandidates.map((c) => (
                          <button key={c.CADREID} type="button" onClick={() => selectMobileCandidate(c)}
                            className="flex w-full items-center justify-between gap-3 border-b border-gray-100 px-3.5 py-2.5 text-left last:border-b-0 hover:bg-yellow-50">
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium text-gray-800">{c.MEMBERNAME || NO_NAME}</div>
                              <div className="text-[11px] text-gray-400">MID {c.MID || "— none —"} · cadre #{c.CADREID}</div>
                            </div>
                            {c.AMID
                              ? <span className="flex-none rounded-full bg-yellow-100 px-2.5 py-0.5 text-[11px] font-medium text-yellow-700">Has login · {c.TEAMNAME || "no role"}{c.LOCATION ? ` · ${c.LOCATION}` : ""}</span>
                              : <span className="flex-none rounded-full bg-gray-100 px-2.5 py-0.5 text-[11px] font-medium text-gray-500">No login yet</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {step === 2 && (
            <>
              {cadre ? (
                <Card className="border-l-4 border-l-green-400 p-6">
                  <div className="mb-3 flex items-center gap-2 text-[12.5px] text-green-600"><UserCheck size={15} /> Member found — cadre #{cadre.tdp_cadre_id}</div>
                  <div className="flex flex-wrap items-center gap-x-8 gap-y-3 text-sm">
                    <Avatar name={`${cadre.first_name || ""} ${cadre.last_name || ""}`.trim()} imageUrl={cadre.image_url} className="h-12 w-12 rounded-full bg-gradient-to-br from-amber-600 to-orange-700" textClassName="font-head text-sm font-bold text-white" />
                    <HKV k="Name" v={`${cadre.first_name} ${cadre.last_name || ""}`.trim()} />
                    <HKV k="Mobile" v={cadre.mobile_no} />
                    <HKV k="Gender" v={cadre.gender || "—"} />
                    <HKV k="Constituency ID" v={cadre.constituency_id ?? "—"} />
                  </div>
                </Card>
              ) : lookupMode === "manual" ? (
                <Card className="border-l-4 border-l-blue-400 p-6">
                  <div className="flex items-center gap-2 text-[12.5px] text-blue-600">
                    <UserPlus size={15} />
                    Creating a new membership. Enter the member's details below — generate a placeholder Membership ID or leave it blank if you don't have one yet.
                  </div>
                </Card>
              ) : (
                <Card className="border-l-4 border-l-amber-400 p-6">
                  <div className="flex items-center gap-2 text-[12.5px] text-amber-600">
                    <AlertTriangle size={15} />
                    {lookupMode === "mid"
                      ? `Membership ID ${mid} not found.`
                      : `No existing login or cadre match for mobile ${lookupMobile}.`} You can create a new login by entering the details manually below — it just won't resolve to a cadre record unless you supply a valid Membership ID.
                  </div>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Name * {cadre && <span className="text-gray-400">(from cadre)</span>}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!cadre} className={cn(INPUT, cadre && "opacity-70")} placeholder="Full name" /></label>
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Mobile *</span>
                  <div className="flex gap-2">
                    <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={cn(INPUT, "flex-1")} placeholder="9xxxxxxxxx" />
                    <button type="button" onClick={() => setOtp(generateOtp())} className={cn(SECONDARY, "whitespace-nowrap px-3")}>Generate OTP</button>
                  </div>
                </label>
                {!cadre && (
                  <label className="flex flex-col gap-1.5"><span className={LABEL}>Membership ID *</span>
                    <div className="flex gap-2">
                      <input value={mid} onChange={(e) => setMid(e.target.value)} className={cn(INPUT, "flex-1")} placeholder="e.g. 12345678" />
                      <button type="button" onClick={() => setMid(generatePlaceholderMid())} className={cn(SECONDARY, "whitespace-nowrap px-3")}>Generate MID</button>
                    </div>
                  </label>
                )}
                {otp && (
                  <label className="flex flex-col gap-1.5"><span className={LABEL}>Generated OTP</span>
                    <input value={otp} readOnly className={cn(INPUT, "opacity-70")} /></label>
                )}
              </div>
              {err && <ErrLine>{err}</ErrLine>}
            </>
          )}

          {step === 3 && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Role</span>
                  <select value={roleId} onChange={(e) => setRoleId(+e.target.value)} className={INPUT}>{USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}</select></label>
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Group</span>
                  <select value={groupId || ""} onChange={(e) => setGroupId(e.target.value ? +e.target.value : null)} className={INPUT}>
                    <option value="">No group</option>
                    {groups.map((g) => <option key={g.user_group_id} value={g.user_group_id}>{g.notes}</option>)}
                  </select></label>
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Scope level</span>
                  <select value={levelId} onChange={(e) => { setLevelId(+e.target.value); setLocation(""); }} className={INPUT}>
                    {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}</select></label>
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Location</span>
                  <select value={location} onChange={(e) => setLocation(e.target.value)} className={INPUT}>
                    <option value="">Select…</option>{locList.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
              </div>

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className={LABEL}>Components {grp && <span className="text-gray-400">— grey are inherited from {grp.notes}</span>}</span>
                  <button onClick={() => setComps([...STANDARD_BUNDLE])} className="rounded-full border border-yellow-300 px-2.5 py-1 text-[11px] font-medium text-yellow-600 transition-colors hover:bg-yellow-50">Apply standard bundle</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COMPONENTS.map((c) => {
                    const inh = inheritedIds.has(c.id);
                    const on = inh || comps.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => !inh && toggle(c.id)} title={inh ? "Inherited from group" : ""} className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px]",
                        inh ? "cursor-default border-gray-200 bg-gray-50 text-gray-400"
                            : on ? "border-yellow-300 bg-yellow-50 text-gray-800"
                                 : "border-gray-200 text-gray-500 hover:border-yellow-300",
                      )}>
                        {inh ? <span className="rounded bg-yellow-200/70 px-1 py-px text-[9px] text-yellow-700">GROUP</span> : on ? <Check size={12} className="text-yellow-700" /> : <Plus size={12} />} {componentLabel(c)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {err && <ErrLine>{err}</ErrLine>}
            </>
          )}
        </div>

        <div className="mt-5 flex justify-between gap-2.5 border-t border-gray-100 pt-4">
          <button
            onClick={step === 1 ? backFromStep1 : () => { if (step === 2 && lookupMode === "manual") setLookupMode(null); setStep(step - 1); }}
            className={step === 1 ? "bg-yellow-500 hover:bg-yellow-600 text-white px-4 py-2 rounded-md" : SECONDARY}>
            {step === 1 ? (atStep1Options ? "Back" : "Cancel") : "Back"}
          </button>
          {step === 1 && lookupMode && <button onClick={() => doLookup()} disabled={looking} className={PRIMARY}>{looking ? "Looking up…" : "Look up cadre"}</button>}
          {step === 2 && <button onClick={() => {
            if (!name.trim()) return setErr("Name is required.");
            if (!mobile.trim()) return setErr("Mobile number is required.");
            if (!cadre && !mid.trim()) return setErr("Membership ID is required.");
            setErr(""); setStep(3);
          }} className={PRIMARY}>Next: access</button>}
          {step === 3 && <button onClick={submit} className={PRIMARY}>Create &amp; generate OTP</button>}
        </div>
      </Card>
      )}
    </div>
  );
}
