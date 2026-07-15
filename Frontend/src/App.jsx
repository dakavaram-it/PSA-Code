import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Users, ClipboardList, Search, Plus,
  ChevronLeft, Eye, KeyRound, X, Check, ShieldCheck, MapPin, Layers,
  AlertTriangle, UserCheck, UserX, FolderTree, Save, RotateCcw, Copy, UserPlus,
} from "lucide-react";
import { getMembers, getUserTypes, getUserLevels, getComponents, lookupCadre } from "./data/api.js";
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
  purple/indigo gradient theme, rounded-2xl soft-shadow cards with hover-lift,
  category-colour icon tiles, pill CTAs, fade-in-up entrances. Built with Tailwind.
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

const CONSTITUENCIES = ["Tirupati", "Mangalagiri", "Guntur East", "Rajahmundry City", "Visakhapatnam North", "Kurnool", "Kadapa", "Anantapur Urban", "Nellore City", "Kakinada City", "Eluru", "Ongole", "Chittoor", "Machilipatnam"];
const PARLIAMENTS = ["Tirupati", "Guntur", "Rajahmundry", "Visakhapatnam", "Kurnool", "Nellore", "Anantapur"];

function computeStats(members) {
  const active = members.filter((m) => m.is_acitve === "Y");
  const inactive = members.filter((m) => m.is_acitve === "N");
  const roleCounts = {}, levelCounts = {}, compCounts = {};
  active.forEach((m) => {
    roleCounts[m.role_name] = (roleCounts[m.role_name] || 0) + 1;
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
const INPUT = "w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-200 focus:border-purple-400 transition";
const PRIMARY = "inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white shadow transition-all hover:bg-purple-700 hover:shadow-lg disabled:pointer-events-none disabled:opacity-50";
const SECONDARY = "inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-sm font-medium text-gray-700 transition-all hover:bg-gray-50 disabled:opacity-50";
const LABEL = "text-xs font-medium text-gray-500";
const SECTION = "flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-purple-600";

// Category colour scheme, mirroring the reference feature cards (-50 tile + -500 icon).
const CAT = {
  blue:   { tile: "bg-blue-50",     icon: "text-blue-500",   bar: "bg-blue-500" },
  purple: { tile: "bg-purple-50", icon: "text-purple-500", bar: "bg-purple-500" },
  indigo: { tile: "bg-indigo-50", icon: "text-indigo-500", bar: "bg-indigo-500" },
  green:  { tile: "bg-green-50",    icon: "text-green-500",  bar: "bg-green-500" },
  amber:  { tile: "bg-amber-50",   icon: "text-amber-500",  bar: "bg-amber-500" },
  gray:   { tile: "bg-gray-100",       icon: "text-gray-400",   bar: "bg-gray-400" },
};

// ---------------------------------------------------------------------------
export default function AdminConsole() {
  const [screen, setScreen] = useState("dashboard"); // dashboard | users | detail | groups
  const [members, setMembers] = useState([]);       // loaded live from the API
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [groups, setGroups] = useState(INITIAL_GROUPS);
  const [activeId, setActiveId] = useState(null);
  const [activeGroupId, setActiveGroupId] = useState(null);
  const [filters, setFilters] = useState({ q: "", status: "all", role: "all", level: "all" });
  const [selected, setSelected] = useState(() => new Set());
  const [showCreate, setShowCreate] = useState(false);
  const [otpModal, setOtpModal] = useState(null); // { member, code }
  const [toast, setToast] = useState(null);

  const stats = useMemo(() => computeStats(members), [members]);
  const activeUser = members.find((m) => m.activity_member_id === activeId) || null;

  const flash = (msg) => { setToast(msg); setTimeout(() => setToast(null), 2600); };

  // Load lookups + members from the live read-only API once, before first render.
  useEffect(() => {
    (async () => {
      try {
        const [uts, uls, comps, mems] = await Promise.all([
          getUserTypes(), getUserLevels(), getComponents(), getMembers("all"),
        ]);
        USER_TYPES = uts;
        USER_LEVELS = uls.levels;
        USED_LEVEL_IDS = uls.used_level_ids;
        COMPONENTS = comps;
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
    setShowCreate(false);
    flash(`Login created for ${payload.name}`);
    return nm;
  }

  const NAV = [
    { key: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
    { key: "groups", label: "Groups", icon: <FolderTree size={18} />, badge: groups.length },
  ];
  const CRUMB = { dashboard: "Console", users: "Access management", detail: "Access management", groups: "Reference" };
  const TITLE = { dashboard: "Dashboard", users: "Login accounts", detail: activeUser?.member_name || "Login", groups: "Group catalogue" };

  if (loading || loadError) {
    return (
      <div className="grid min-h-screen place-items-center bg-gradient-to-br from-blue-50 via-purple-50 to-indigo-100 p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          {!loadError && <div className="h-9 w-9 animate-spin rounded-full border-[3px] border-purple-200 border-t-purple-600" />}
          <span className={cn("text-sm", loadError ? "text-red-500" : "text-gray-500")}>
            {loadError || "Loading live data…"}
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-gradient-to-br from-blue-50 via-purple-50 to-indigo-100 font-sans text-gray-900">
      {/* SIDEBAR */}
      <aside className="sticky top-0 flex h-screen w-60 flex-none flex-col border-r border-white/60 bg-white/70 py-5 backdrop-blur-xl">
        <div className="flex items-center gap-3 px-5 pb-5">
          <div className="grid h-10 w-10 flex-none place-items-center rounded-xl bg-gradient-to-br from-purple-500 to-indigo-600 font-head text-lg font-bold text-white shadow-md">U</div>
          <div className="leading-tight">
            <div className="font-head text-[15px] font-bold tracking-tight">User</div>
            <div className="text-[9.5px] uppercase tracking-[0.16em] text-purple-500">Admin Console</div>
          </div>
        </div>
        <div className="px-5 py-1.5 text-[9.5px] uppercase tracking-[0.14em] text-gray-400">Manage</div>
        <nav className="flex flex-col gap-1 px-3">
          {NAV.map((it) => {
            const on = screen === it.key || (it.key === "users" && screen === "detail");
            return (
              <button key={it.key} onClick={() => { setScreen(it.key); setActiveId(null); }}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all",
                  on
                    ? "bg-purple-100 font-semibold text-purple-700 shadow-sm"
                    : "font-medium text-gray-600 hover:bg-purple-50",
                )}>
                <span className="flex w-[18px] flex-none">{it.icon}</span>
                <span className="flex-1">{it.label}</span>
                {it.badge != null && (
                  <span className="rounded-full bg-purple-200/70 px-2 py-0.5 text-[10px] font-semibold text-purple-700">{it.badge}</span>
                )}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-4">
          <div className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white/70 p-3 shadow-sm">
            <div className="grid h-9 w-9 flex-none place-items-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 font-head text-sm font-bold text-white">A</div>
            <div className="leading-tight">
              <div className="text-sm font-semibold">ADMIN</div>
              <div className="text-[11px] text-gray-400">Administrator</div>
            </div>
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main className="flex min-w-0 flex-1 flex-col">
        {/* TOPBAR */}
        <header className="sticky top-0 z-10 flex items-center gap-4 border-b border-white/60 bg-white/50 px-6 py-4 backdrop-blur-xl">
          <div className="min-w-0 flex-1">
            <div className="text-[10.5px] uppercase tracking-[0.12em] text-purple-500">{CRUMB[screen]}</div>
            <h1 className="font-head text-[22px] font-semibold leading-tight">{TITLE[screen]}</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden text-right leading-tight sm:block">
              <div className="text-sm font-semibold">ADMIN</div>
              <div className="text-[11px] text-gray-400">Administrator</div>
            </div>
            <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 font-head font-bold text-white shadow">A</div>
          </div>
        </header>

        <div key={screen + (activeId || "")} className="flex-1 animate-fade-in-up px-6 pb-16 pt-6">
          {screen === "dashboard" && (
            <Overview
              stats={stats}
              onCreate={() => setShowCreate(true)}
              onViewActive={() => { setFilters((f) => ({ ...f, status: "active" })); setScreen("users"); }}
            />
          )}
          {screen === "users" && (
            <UsersScreen rows={filtered} total={members.length} filters={filters} setFilters={setFilters}
              selected={selected} setSelected={setSelected} bulkSet={bulkSet} onOpen={(id) => { setActiveId(id); setScreen("detail"); }}
              onReset={openOtp} />
          )}
          {screen === "detail" && activeUser && (
            <DetailScreen key={activeUser.activity_member_id} u={activeUser} groups={groups}
              onBack={() => setScreen("users")} onSave={saveMember} onReset={() => openOtp(activeUser)} />
          )}
          {screen === "groups" && (
            <GroupsScreen groups={groups} members={members} activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId} onSaveGroup={saveGroup} onDeleteGroup={deleteGroup} onSetMemberGroup={setMemberGroup} />
          )}
        </div>
      </main>

      {showCreate && <CreateModal groups={groups} onClose={() => setShowCreate(false)} onCreate={createMember} onOtp={openOtp} />}
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
  return <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10.5px] font-semibold text-purple-700">{label}</span>;
}
function KV({ k, v, mono }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{k}</span>
      <span className={cn("break-words text-right", mono && "font-mono")}>{v}</span>
    </div>
  );
}
function Field({ label, children }) {
  return <label className="flex min-w-[130px] flex-col gap-1.5"><span className={LABEL}>{label}</span>{children}</label>;
}
function ErrLine({ children }) {
  return <div className="flex items-center gap-2 text-sm text-red-600"><AlertTriangle size={14} /> {children}</div>;
}

// SVG progress ring — the reference's CircularProgressBar, in purple.
function Ring({ pct, size = 88, stroke = 9 }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <div className="relative flex-none" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} className="fill-none stroke-purple-100" />
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={off} className="fill-none stroke-purple-600 transition-all duration-700" />
      </svg>
      <div className="absolute inset-0 grid place-items-center font-head font-bold text-purple-700" style={{ fontSize: size * 0.24 }}>{pct}%</div>
    </div>
  );
}

// --- OVERVIEW ---------------------------------------------------------------
function Overview({ stats, onCreate, onViewActive }) {
  const kpis = [
    { label: "Total Users", value: stats.total, icon: <Users size={20} />, note: "All login accounts", cat: "blue" },
    { label: "Active Users", value: stats.active, icon: <UserCheck size={20} />, note: "Can sign in", cat: "green", onClick: onViewActive },
    { label: "Inactive Users", value: stats.inactive, icon: <UserX size={20} />, note: "Deactivated", cat: "gray" },
  ];
  const roleRows = Object.entries(stats.roleCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxComp = Math.max(1, ...stats.topComponents.map((c) => c.count));

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
        <button onClick={onCreate} className={cn(CARD_HOVER, "flex flex-col items-start justify-between rounded-2xl border border-purple-300/60 bg-gradient-to-br from-purple-600 to-indigo-600 p-5 text-left text-white shadow-lg")}>
          <div className="mb-4 flex w-full items-center justify-between">
            <span className="text-[10.5px] font-medium uppercase tracking-wide text-white/70">Quick action</span>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/20"><UserPlus size={20} /></span>
          </div>
          <div className="font-head text-lg font-bold leading-tight">Create New User</div>
          <div className="mt-1.5 text-[11px] text-white/80">Add a login account</div>
        </button>
      </div>

      {/* Standard bundle callout — the report's headline finding. [§4.2] */}
      <Card className="flex flex-wrap items-center gap-5 p-6">
        <Ring pct={stats.onStandardPct} />
        <div className="min-w-[220px] flex-1">
          <div className="font-head text-base font-semibold">{stats.onStandard} active logins share one component bundle</div>
          <div className="mt-1.5 text-[12.5px] leading-relaxed text-gray-500">
            Membership Dashboard, Cubs-Committees, Committee Meetings, SIR Dashboard. Role and component set are largely decoupled — the "New login" flow offers this as a one-click preset.
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card className="p-6">
          <SectionTitle icon={<ShieldCheck size={14} />}>Logins by role</SectionTitle>
          <div className="mt-4 flex flex-col gap-3.5">
            {roleRows.map(([role, n]) => {
              const share = stats.active ? (n / stats.active) * 100 : 0;
              return (
                <div key={role} className="flex items-center gap-3">
                  <span className="w-28 flex-none truncate text-[13px] font-medium">{role}</span>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className="h-full rounded-full bg-gradient-to-r from-purple-500 to-indigo-500 transition-all duration-500" style={{ width: `${share}%` }} />
                  </div>
                  <span className="w-12 flex-none text-right font-mono text-[13px] font-semibold tabular-nums">{n}</span>
                  <span className="w-14 flex-none text-right font-mono text-[11px] tabular-nums text-purple-500">{share.toFixed(1)}%</span>
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
                  <div className="h-full rounded-full bg-indigo-500 transition-all duration-500" style={{ width: `${(c.count / maxComp) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Geographic scope — only 3 of 9 levels used. [§3.3] */}
      <Card className="p-6">
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
      </Card>
    </div>
  );
}

// --- USERS ------------------------------------------------------------------
function UsersScreen({ rows, total, filters, setFilters, selected, setSelected, bulkSet, onOpen, onReset }) {
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
      <Card className="flex flex-wrap items-end gap-3 p-4">
        <label className="flex min-w-[180px] flex-1 flex-col gap-1.5">
          <span className={LABEL}>Search membership ID, name or mobile</span>
          <div className="group relative">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-purple-500" />
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
            {USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}
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
        <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-purple-100 bg-purple-50 px-4 py-2.5">
          <strong className="text-sm text-purple-700">{selected.size} selected</strong>
          <button onClick={() => bulkSet("Y")} className={SECONDARY}>Activate</button>
          <button onClick={() => bulkSet("N")} className={SECONDARY}>Deactivate</button>
          <button onClick={() => setSelected(new Set())} className="text-sm font-medium text-gray-500 hover:text-gray-700">Clear</button>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50/80 text-[11px] uppercase tracking-wide text-gray-400">
                <th className="w-9 py-2.5 pl-4 text-left">
                  <input type="checkbox" checked={allSel} onChange={toggleAll} className="h-4 w-4 accent-purple-600" />
                </th>
                {["Membership ID", "Name", "Mobile", "Role", "Scope", "Status", "Created", ""].map((h, i) => (
                  <th key={i} className={cn("whitespace-nowrap font-medium", i === 7 ? "px-4 py-2.5 text-right" : "px-2 py-2.5 text-left")}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.activity_member_id} className="border-t border-gray-100 transition-colors hover:bg-purple-50/50">
                  <td className="pl-4"><input type="checkbox" checked={selected.has(u.activity_member_id)} onChange={() => toggleOne(u.activity_member_id)} className="h-4 w-4 accent-purple-600" /></td>
                  <td onClick={() => onOpen(u.activity_member_id)} className="cursor-pointer px-2 py-2.5 font-head font-semibold hover:text-purple-600">
                    {u.membership_id || <span className="text-[11px] text-amber-600">— none —</span>}
                  </td>
                  <td onClick={() => onOpen(u.activity_member_id)} className="cursor-pointer px-2 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-7 w-7 flex-none place-items-center rounded-full bg-purple-100 font-head text-[10px] font-semibold text-purple-600">{initials(u.member_name)}</span>
                      <span className={u.member_name ? "" : "text-gray-400"}>{u.member_name || NO_NAME}</span>
                    </div>
                  </td>
                  <td className={cn("px-2 py-2.5", u.mobile_no ? "" : "text-amber-600")}>{u.mobile_no || "missing"}</td>
                  <td className="px-2 py-2.5">{u.role_name ? <RoleBadge label={u.role_name} /> : <span className="text-[11px] text-gray-400">—</span>}</td>
                  <td className="px-2 py-2.5 text-xs text-gray-500">{u.level_name ? `${u.level_name} · ${u.location_value}` : "—"}</td>
                  <td className="px-2 py-2.5"><StatusPill active={u.is_acitve === "Y"} /></td>
                  <td className="whitespace-nowrap px-2 py-2.5 text-xs text-gray-500">{fmtDate(u.inserted_time)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    <button title="View" onClick={() => onOpen(u.activity_member_id)} className="ml-0.5 inline-grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-purple-100 hover:text-purple-600"><Eye size={15} /></button>
                    <button title="Reset OTP login" onClick={() => onReset(u)} className="ml-0.5 inline-grid h-8 w-8 place-items-center rounded-lg text-gray-400 transition-colors hover:bg-purple-100 hover:text-purple-600"><KeyRound size={15} /></button>
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
function DetailScreen({ u, groups, onBack, onSave, onReset }) {
  const [draft, setDraft] = useState(u);
  const dirty = JSON.stringify(draft) !== JSON.stringify(u);

  const grp = draft.group_id ? groups.find((g) => g.user_group_id === draft.group_id) : null;
  const inheritedIds = new Set(grp ? grp.component_ids : []);
  const effective = effectiveComponents(draft, groups);
  const addable = COMPONENTS.filter((c) => !inheritedIds.has(c.id) && !draft.component_ids.includes(c.id));
  const locList = draft.level_id === 5 ? CONSTITUENCIES : draft.level_id === 4 ? PARLIAMENTS : ["Andhra Pradesh"];

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setRole = (id) => { const r = USER_TYPES.find((x) => x.id === id); set({ role_id: id, role_name: r.type, role_short: r.short }); };
  const setLevel = (id) => { const l = USER_LEVELS.find((x) => x.id === id); set({ level_id: id, level_name: l.name, location_value: "" }); };
  const addPersonal = (id) => set({ component_ids: [...draft.component_ids, id].sort((a, b) => a - b) });
  const removePersonal = (id) => set({ component_ids: draft.component_ids.filter((x) => x !== id) });

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-purple-600">
          <ChevronLeft size={16} /> Back to logins
        </button>
        <div className="flex items-center gap-2.5">
          {dirty && <span className="flex items-center gap-1.5 text-xs text-amber-600"><AlertTriangle size={13} /> Unsaved changes</span>}
          <button disabled={!dirty} onClick={() => setDraft(u)} className={SECONDARY}><RotateCcw size={14} /> Discard</button>
          <button disabled={!dirty} onClick={() => onSave(draft)} className={PRIMARY}><Save size={14} /> Save changes</button>
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[320px_1fr]">
        {/* Identity + editable role/scope */}
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-3">
            <div className="grid h-16 w-16 flex-none place-items-center rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 font-head text-[22px] font-bold text-white shadow-md">{initials(draft.member_name)}</div>
            <div className="min-w-0">
              <h2 className="font-head text-[17px] font-semibold leading-tight">{draft.member_name || NO_NAME}</h2>
              <div className="mt-0.5 text-xs text-purple-600">{draft.role_name || "No role"}</div>
            </div>
          </div>
          <StatusPill active={draft.is_acitve === "Y"} />

          <div className="mt-4 flex flex-col gap-2.5 text-sm">
            <KV k="Membership ID" v={draft.membership_id || "— none —"} mono />
            <KV k="Cadre ID" v={draft.tdp_cadre_id ? `#${draft.tdp_cadre_id}` : "unresolved"} mono />
            <KV k="Login ID" v={`#${draft.activity_member_id}`} mono />
          </div>

          <div className="mt-4 flex flex-col gap-3">
            <label className="flex flex-col gap-1.5"><span className={LABEL}>Mobile (OTP)</span>
              <input value={draft.mobile_no || ""} onChange={(e) => set({ mobile_no: e.target.value || null })} className={INPUT} placeholder="9xxxxxxxxx" /></label>
            <label className="flex flex-col gap-1.5"><span className={LABEL}>Role</span>
              <select value={draft.role_id} onChange={(e) => setRole(+e.target.value)} className={INPUT}>
                {USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}
              </select></label>
            <label className="flex flex-col gap-1.5"><span className={LABEL}>Scope level</span>
              <select value={draft.level_id} onChange={(e) => setLevel(+e.target.value)} className={INPUT}>
                {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}
              </select></label>
            <label className="flex flex-col gap-1.5"><span className={LABEL}>Location</span>
              <select value={draft.location_value} onChange={(e) => set({ location_value: e.target.value })} className={INPUT}>
                <option value="">Select…</option>
                {locList.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></label>
            <label className="flex flex-col gap-1.5"><span className={LABEL}>Group</span>
              <select value={draft.group_id || ""} onChange={(e) => set({ group_id: e.target.value ? +e.target.value : null })} className={INPUT}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g.user_group_id} value={g.user_group_id}>{g.notes}</option>)}
              </select></label>
          </div>

          <div className="mt-5 flex gap-2">
            <button onClick={() => set({ is_acitve: draft.is_acitve === "Y" ? "N" : "Y" })} className={cn(SECONDARY, "flex-1")}>
              {draft.is_acitve === "Y" ? "Deactivate" : "Activate"}
            </button>
            <button onClick={onReset} className={cn(SECONDARY, "flex-1")}><KeyRound size={14} /> Reset OTP</button>
          </div>
        </Card>

        {/* Components */}
        <div className="flex flex-col gap-5">
          <Card className="p-6">
            <div className="flex items-center justify-between">
              <SectionTitle icon={<Layers size={14} />}>Effective access ({effective.length})</SectionTitle>
              {grp && <span className="flex items-center gap-1.5 rounded-full bg-purple-100 px-2.5 py-0.5 text-[11px] font-medium text-purple-700"><FolderTree size={11} /> {grp.notes}</span>}
            </div>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {effective.length === 0 && <span className="text-sm text-amber-600">No dashboards assigned — this account opens to an empty view.</span>}
              {effective.map(({ id, component, inherited, personal }) => {
                const lockedOnly = inherited && !personal;
                return (
                  <span key={id} className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs",
                    lockedOnly
                      ? "border-gray-200 bg-gray-50 text-gray-500"
                      : "border-purple-300 bg-purple-50 text-gray-800",
                  )}>
                    {inherited
                      ? <span title="Inherited from group" className="rounded bg-purple-200/70 px-1.5 py-px text-[9px] tracking-wide text-purple-700">GROUP</span>
                      : <Check size={13} className="text-purple-500" />}
                    {componentLabel(component)}
                    {personal && !inherited && (
                      <button onClick={() => removePersonal(id)} title="Remove personal grant" className="ml-0.5 flex text-gray-400 hover:text-red-500"><X size={12} /></button>
                    )}
                  </span>
                );
              })}
            </div>
            {grp && <div className="mt-2.5 text-[11px] text-gray-400">Grey = inherited from group (change on the group, not here). Purple = personal, removable.</div>}
          </Card>

          <Card className="p-6">
            <SectionTitle icon={<Plus size={14} />}>Add personal component</SectionTitle>
            <div className="mt-3.5 flex flex-wrap gap-2">
              {addable.length === 0 && <span className="text-[12.5px] text-gray-400">Nothing left to add — all components are already granted or inherited.</span>}
              {addable.map((c) => (
                <button key={c.id} onClick={() => addPersonal(c.id)} title="Grant to this user only"
                  className="flex items-center gap-1.5 rounded-lg border border-dashed border-gray-300 px-2.5 py-1.5 text-xs text-gray-500 transition-colors hover:border-purple-400 hover:text-purple-600">
                  <Plus size={13} /> {componentLabel(c)}
                </button>
              ))}
            </div>
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
          <strong className="text-gray-800">Requires two new tables.</strong> Groups here assign components and members, but the current schema has no <code className="text-purple-600">user_group_member</code> or <code className="text-purple-600">user_group_component</code> table. This is a working mock — persistence needs those tables built first.
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
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-purple-50 text-purple-500"><FolderTree size={16} /></span>
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
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-500 transition-colors hover:text-purple-600">
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
                    on ? "border-purple-300 bg-purple-50 text-gray-800"
                       : "border-gray-200 text-gray-500 hover:border-purple-300",
                  )}>
                    {on ? <Check size={12} className="text-purple-500" /> : <Plus size={12} />} {componentLabel(c)}
                  </button>
                );
              })}
            </div>
          </Card>
        </div>

        <Card className="p-6">
          <SectionTitle icon={<Users size={14} />}>Members ({inGroup.length})</SectionTitle>
          <div className="group relative my-3">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 transition-colors group-focus-within:text-purple-500" />
            <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search a login to add…" className={cn(INPUT, "pl-9")} />
          </div>
          {candidates.length > 0 && (
            <div className="mb-3 overflow-hidden rounded-xl border border-gray-200">
              {candidates.map((m) => (
                <div key={m.activity_member_id} className="flex items-center justify-between border-b border-gray-100 px-3 py-2 last:border-b-0">
                  <span className="text-sm">{m.member_name} <span className="text-[11px] text-gray-400">{m.membership_id || "no MID"}{m.group_id ? " · in another group" : ""}</span></span>
                  <button onClick={() => { onSetMemberGroup(m.activity_member_id, group.user_group_id); setMemberQuery(""); }} className="rounded-lg border border-purple-300 px-2.5 py-1 text-xs font-medium text-purple-600 transition-colors hover:bg-purple-50">Add</button>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            {inGroup.length === 0 && <span className="text-[12.5px] text-gray-400">No members yet. Search above to add logins.</span>}
            {inGroup.map((m) => (
              <div key={m.activity_member_id} className="flex items-center justify-between rounded-xl bg-gray-50 px-3 py-2">
                <div className="flex items-center gap-2.5">
                  <span className="grid h-7 w-7 place-items-center rounded-full bg-purple-100 font-head text-[10px] font-semibold text-purple-600">{initials(m.member_name)}</span>
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
              <span key={i} className="grid w-10 place-items-center rounded-xl border border-purple-200 bg-purple-50 font-head text-2xl font-bold text-purple-700" style={{ height: 52 }}>{d}</span>
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

// --- CREATE MODAL: MID-first stepped flow -----------------------------------
function CreateModal({ groups, onClose, onCreate, onOtp }) {
  const [step, setStep] = useState(1);
  const [mid, setMid] = useState("");
  const [cadre, setCadre] = useState(null);
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [roleId, setRoleId] = useState(12);
  const [levelId, setLevelId] = useState(5);
  const [location, setLocation] = useState("");
  const [groupId, setGroupId] = useState(null);
  const [comps, setComps] = useState([...STANDARD_BUNDLE]);
  const [err, setErr] = useState("");

  const locList = levelId === 5 ? CONSTITUENCIES : levelId === 4 ? PARLIAMENTS : ["Andhra Pradesh"];
  const grp = groupId ? groups.find((g) => g.user_group_id === groupId) : null;
  const inheritedIds = new Set(grp ? grp.component_ids : []);

  async function doLookup() {
    setErr("");
    if (!mid.trim()) return setErr("Enter a membership ID first.");
    const found = await lookupCadre(mid.trim());
    if (found) {
      setCadre(found); setNotFound(false);
      setName(`${found.first_name || ""} ${found.last_name || ""}`.trim());
      setMobile(found.mobile_no || "");
    } else {
      setCadre(null); setNotFound(true); setName(""); setMobile("");
    }
    setStep(2);
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
              on ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-400",
            )}>{n}</span>
            <span className={cn("text-[11.5px]", on ? "text-gray-800" : "text-gray-400")}>{s}</span>
          </div>
        );
      })}
    </div>
  );

  return (
    <div onClick={onClose} className="fixed inset-0 z-40 grid place-items-center bg-gray-900/50 p-5 backdrop-blur-sm">
      <div onClick={(e) => e.stopPropagation()} className="max-h-[90vh] w-[min(580px,100%)] animate-fade-in-up overflow-auto rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h3 className="font-head text-[17px] font-semibold">New login</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <Stepper />

          {step === 1 && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className={LABEL}>Membership ID</span>
                <input autoFocus value={mid} onChange={(e) => setMid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} className={INPUT} placeholder="e.g. 20481, 20482, 30017…" />
              </label>
              <div className="text-xs leading-relaxed text-gray-500">
                Enter a member's Membership ID to look them up. Try <strong>19457249</strong> for a match; an unknown ID lets you enter the details manually.
              </div>
              {err && <ErrLine>{err}</ErrLine>}
            </>
          )}

          {step === 2 && (
            <>
              {cadre ? (
                <Card className="border-l-4 border-l-green-400 p-4">
                  <div className="mb-2.5 flex items-center gap-2 text-[12.5px] text-green-600"><UserCheck size={15} /> Member found — cadre #{cadre.tdp_cadre_id}</div>
                  <div className="grid grid-cols-2 gap-2.5 text-sm">
                    <KV k="Name" v={`${cadre.first_name} ${cadre.last_name}`} />
                    <KV k="Mobile" v={cadre.mobile_no} />
                    <KV k="Gender" v={cadre.gender || "—"} />
                    <KV k="Constituency ID" v={cadre.constituency_id ?? "—"} />
                    <KV k="Payment" v={cadre.payment_status} />
                  </div>
                </Card>
              ) : (
                <Card className="border-l-4 border-l-amber-400 p-4">
                  <div className="flex items-center gap-2 text-[12.5px] text-amber-600"><AlertTriangle size={15} /> No cadre found for MID {mid}. Enter the name manually — this login won't resolve to a cadre record.</div>
                </Card>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Name {cadre && <span className="text-gray-400">(from cadre)</span>}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!cadre} className={cn(INPUT, cadre && "opacity-70")} placeholder="Full name" /></label>
                <label className="flex flex-col gap-1.5"><span className={LABEL}>Mobile (OTP)</span>
                  <input value={mobile} onChange={(e) => setMobile(e.target.value)} className={INPUT} placeholder="9xxxxxxxxx" /></label>
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
                  <button onClick={() => setComps([...STANDARD_BUNDLE])} className="rounded-full border border-purple-300 px-2.5 py-1 text-[11px] font-medium text-purple-600 transition-colors hover:bg-purple-50">Apply standard bundle</button>
                </div>
                <div className="flex flex-wrap gap-2">
                  {COMPONENTS.map((c) => {
                    const inh = inheritedIds.has(c.id);
                    const on = inh || comps.includes(c.id);
                    return (
                      <button key={c.id} onClick={() => !inh && toggle(c.id)} title={inh ? "Inherited from group" : ""} className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px]",
                        inh ? "cursor-default border-gray-200 bg-gray-50 text-gray-400"
                            : on ? "border-purple-300 bg-purple-50 text-gray-800"
                                 : "border-gray-200 text-gray-500 hover:border-purple-300",
                      )}>
                        {inh ? <span className="rounded bg-purple-200/70 px-1 py-px text-[9px] text-purple-700">GROUP</span> : on ? <Check size={12} className="text-purple-500" /> : <Plus size={12} />} {componentLabel(c)}
                      </button>
                    );
                  })}
                </div>
              </div>
              {err && <ErrLine>{err}</ErrLine>}
            </>
          )}
        </div>

        <div className="flex justify-between gap-2.5 border-t border-gray-100 px-5 py-3.5">
          <button onClick={step === 1 ? onClose : () => setStep(step - 1)} className={SECONDARY}>{step === 1 ? "Cancel" : "Back"}</button>
          {step === 1 && <button onClick={doLookup} className={PRIMARY}>Look up cadre</button>}
          {step === 2 && <button onClick={() => { if (!name.trim()) return setErr("Name is required."); setErr(""); setStep(3); }} className={PRIMARY}>Next: access</button>}
          {step === 3 && <button onClick={submit} className={PRIMARY}>Create &amp; generate OTP</button>}
        </div>
      </div>
    </div>
  );
}
