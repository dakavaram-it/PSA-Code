import React, { useState, useMemo, useEffect } from "react";
import {
  LayoutDashboard, Users, ClipboardList, Search, Plus, Sun, Moon,
  ChevronLeft, Eye, KeyRound, X, Check, ShieldCheck, MapPin, Layers,
  AlertTriangle, UserCheck, UserX, PackageOpen, FolderTree, Save, RotateCcw, Copy,
} from "lucide-react";
import { getMembers, getUserTypes, getUserLevels, getComponents, lookupCadre } from "./data/api.js";

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
*/

// ---------------------------------------------------------------------------
// DATA (inlined so this file runs standalone as an artifact).
// In the real project this lives in src/data/mockData.js and is replaced by API
// calls with the identical shape.
// ---------------------------------------------------------------------------
// Lookups now come from the live API at startup (bootstrap in AdminConsole).
// Module-scope `let` so every screen reads them without prop-drilling; they are
// populated once, before the first non-loading render.
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

// tdp_cadre MID lookup is now a live read via api.lookupCadre() (imported above).

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
// NOTE: real OTP must be generated, delivered and validated server-side with an
// expiry. "Unique" is not enforceable in a browser; this exists so the reset
// flow is demonstrable, not to be shipped as-is.
const generateOtp = () => String(Math.floor(100000 + Math.random() * 900000));

// Location option lists for the (mock) edit/create dropdowns. The live DB stores
// location_value as a bare int (constituency/parliament id), which the read-only
// table renders as-is; these name lists back the write-flow pickers only.
const CONSTITUENCIES = ["Tirupati", "Mangalagiri", "Guntur East", "Rajahmundry City", "Visakhapatnam North", "Kurnool", "Kadapa", "Anantapur Urban", "Nellore City", "Kakinada City", "Eluru", "Ongole", "Chittoor", "Machilipatnam"];
const PARLIAMENTS = ["Tirupati", "Guntur", "Rajahmundry", "Visakhapatnam", "Kurnool", "Nellore", "Anantapur"];

function computeStats(members) {
  const active = members.filter((m) => m.is_acitve === "Y");
  const inactive = members.filter((m) => m.is_acitve === "N");
  const withoutComponents = active.filter((m) => m.component_ids.length === 0);
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
    withoutComponents: withoutComponents.length, roleCounts, levelCounts, topComponents,
    onStandard, onStandardPct: active.length ? Math.round((onStandard / active.length) * 100) : 0,
  };
}

// ---------------------------------------------------------------------------
// THEME — ports the prototype's blueprint palette to inline CSS vars so the
// artifact needs no external stylesheet.
// ---------------------------------------------------------------------------
const THEMES = {
  dark: {
    bg: "#15181b", surface: "#1c2024", surface2: "#22272b", text: "#e6e8ea",
    subtle: "#9aa4ac", accent: "#8fb4d9", accent700: "#bcd4ea",
    divider: "rgba(230,232,234,0.14)", ok: "#7fc99a", warn: "#e0b062", bad: "#e08a8a",
  },
  light: {
    bg: "#f2f3f5", surface: "#ffffff", surface2: "#f7f8fa", text: "#1b2126",
    subtle: "#5b6670", accent: "#2f6f9f", accent700: "#22537a",
    divider: "rgba(27,33,38,0.12)", ok: "#2f8f57", warn: "#a5741f", bad: "#b64c4c",
  },
};
const HEAD = "'Space Grotesk','Segoe UI',system-ui,sans-serif";
const BODY = "'Inter','Segoe UI',system-ui,sans-serif";

const initials = (n) => (n || "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "—";
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "2-digit", month: "short", year: "numeric" }) : "—");
const fmtDateTime = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—");
const NO_NAME = "— unnamed —";

// ---------------------------------------------------------------------------
export default function AdminConsole() {
  const [dark, setDark] = useState(true);
  const t = dark ? THEMES.dark : THEMES.light;
  const [screen, setScreen] = useState("overview"); // overview | users | detail | audit
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

  // Commit an edited copy of one member (draft -> Save on the Detail screen).
  function saveMember(edited) {
    setMembers((ms) => ms.map((m) => m.activity_member_id === edited.activity_member_id ? edited : m));
    flash(`Changes saved for ${edited.member_name}`);
  }
  function openOtp(m) {
    setOtpModal({ member: m, code: generateOtp() });
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
    setShowCreate(false);
    flash(`Login created for ${payload.name}`);
    return nm;
  }

  const NAV = [
    { key: "overview", label: "Overview", icon: <LayoutDashboard size={18} /> },
    { key: "users", label: "Logins", icon: <Users size={18} />, badge: stats.active },
    { key: "groups", label: "Groups", icon: <FolderTree size={18} />, badge: groups.length },
    { key: "audit", label: "Activity", icon: <ClipboardList size={18} /> },
  ];
  const CRUMB = { overview: "Dashboard", users: "Access management", detail: "Access management", groups: "Reference", audit: "Records" };
  const TITLE = { overview: "Overview", users: "Login accounts", detail: activeUser?.member_name || "Login", groups: "Group catalogue", audit: "Recent changes" };

  if (loading || loadError) {
    return (
      <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: t.bg, color: loadError ? t.bad : t.subtle, fontFamily: BODY, fontSize: 14, padding: 24, textAlign: "center" }}>
        {loadError || "Loading live data…"}
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: t.bg, color: t.text, display: "flex", fontFamily: BODY }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&family=Space+Grotesk:wght@500;600;700&display=swap');
        *{box-sizing:border-box}
        ::-webkit-scrollbar{width:9px;height:9px}
        ::-webkit-scrollbar-thumb{background:${t.divider};border-radius:6px}
        .ac-nav:hover{background:${dark ? "rgba(255,255,255,.05)" : "rgba(0,0,0,.04)"}}
        .ac-row:hover{background:${dark ? "rgba(255,255,255,.03)" : "rgba(0,0,0,.025)"}}
        .ac-row:hover td:nth-child(2){color:${t.accent}}
        .ac-btn{cursor:pointer;border:none;font-family:${BODY};font-weight:500;transition:.12s}
        input:focus,select:focus{outline:2px solid ${t.accent};outline-offset:1px}
        @keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
        .fade{animation:fade .22s ease both}
      `}</style>

      {/* SIDEBAR */}
      <aside style={{ width: 232, flex: "none", borderRight: `1px solid ${t.divider}`, background: t.bg, position: "sticky", top: 0, height: "100vh", display: "flex", flexDirection: "column", padding: "18px 0" }}>
        <div style={{ padding: "0 18px 18px", display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ position: "relative", width: 34, height: 34, display: "grid", placeItems: "center", color: t.accent, border: `1px solid ${t.accent}`, borderRadius: 2 }}>
            <span style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 17 }}>B</span>
          </div>
          <div style={{ lineHeight: 1.05 }}>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 15, letterSpacing: "-.01em" }}>BharatBase</div>
            <div style={{ fontSize: 9.5, letterSpacing: ".16em", textTransform: "uppercase", color: t.accent }}>Admin Console</div>
          </div>
        </div>
        <div style={{ padding: "6px 14px 6px", fontSize: 9.5, letterSpacing: ".14em", textTransform: "uppercase", color: t.subtle }}>Manage</div>
        <nav style={{ display: "flex", flexDirection: "column", gap: 2, padding: "0 10px" }}>
          {NAV.map((it) => {
            const on = screen === it.key || (it.key === "users" && screen === "detail");
            return (
              <button key={it.key} className="ac-nav ac-btn" onClick={() => { setScreen(it.key); setActiveId(null); }}
                style={{ display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", borderRadius: 3, background: on ? (dark ? "rgba(143,180,217,.14)" : "rgba(47,111,159,.1)") : "transparent", color: on ? t.accent700 : t.text, fontSize: 13.5, textAlign: "left" }}>
                <span style={{ display: "flex", width: 18, flex: "none" }}>{it.icon}</span>
                <span style={{ flex: 1 }}>{it.label}</span>
                {it.badge != null && <span style={{ padding: "1px 7px", fontSize: 10, borderRadius: 10, background: dark ? "rgba(143,180,217,.22)" : "rgba(47,111,159,.14)", color: t.accent700 }}>{it.badge}</span>}
              </button>
            );
          })}
        </nav>
        <div style={{ marginTop: "auto", padding: "0 16px" }}>
          <div style={{ padding: "12px", border: `1px solid ${t.divider}`, borderRadius: 4, fontSize: 11, color: t.subtle, lineHeight: 1.5 }}>
            <AlertTriangle size={13} style={{ verticalAlign: "-2px", marginRight: 5, color: t.warn }} />
            Live data, read-only. Edits made here are not saved back to the database yet.
          </div>
        </div>
      </aside>

      {/* MAIN */}
      <main style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
        {/* TOPBAR */}
        <header style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 26px", borderBottom: `1px solid ${t.divider}`, position: "sticky", top: 0, background: t.bg, zIndex: 5 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 10.5, letterSpacing: ".12em", textTransform: "uppercase", color: t.accent }}>{CRUMB[screen]}</div>
            <h1 style={{ margin: 0, fontFamily: HEAD, fontSize: 22, lineHeight: 1.1, fontWeight: 600 }}>{TITLE[screen]}</h1>
          </div>
          <button className="ac-btn" onClick={() => setDark(!dark)} title="Toggle theme" style={{ width: 38, height: 38, display: "grid", placeItems: "center", border: `1px solid ${t.divider}`, borderRadius: 3, background: t.surface, color: t.text }}>
            {dark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <button className="ac-btn" onClick={() => setShowCreate(true)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 3, background: t.accent, color: dark ? t.bg : "#fff", fontWeight: 600, fontSize: 13, whiteSpace: "nowrap" }}>
            <Plus size={16} /> New login
          </button>
        </header>

        <div key={screen + (activeId || "")} className="fade" style={{ padding: "24px 26px 60px", flex: 1 }}>
          {screen === "overview" && <Overview t={t} dark={dark} stats={stats} />}
          {screen === "users" && (
            <UsersScreen t={t} dark={dark} rows={filtered} total={members.length} filters={filters} setFilters={setFilters}
              selected={selected} setSelected={setSelected} bulkSet={bulkSet} onOpen={(id) => { setActiveId(id); setScreen("detail"); }}
              onReset={openOtp} />
          )}
          {screen === "detail" && activeUser && (
            <DetailScreen key={activeUser.activity_member_id} t={t} dark={dark} u={activeUser} groups={groups}
              onBack={() => setScreen("users")} onSave={saveMember} onReset={() => openOtp(activeUser)} />
          )}
          {screen === "groups" && (
            <GroupsScreen t={t} dark={dark} groups={groups} members={members} activeGroupId={activeGroupId}
              setActiveGroupId={setActiveGroupId} onSaveGroup={saveGroup} onDeleteGroup={deleteGroup} onSetMemberGroup={setMemberGroup} />
          )}
          {screen === "audit" && <AuditScreen t={t} dark={dark} members={members} />}
        </div>
      </main>

      {showCreate && <CreateModal t={t} dark={dark} groups={groups} onClose={() => setShowCreate(false)} onCreate={createMember} onOtp={openOtp} />}
      {otpModal && <OtpModal t={t} dark={dark} data={otpModal} onRegenerate={() => setOtpModal({ ...otpModal, code: generateOtp() })} onClose={() => setOtpModal(null)} onSent={() => { flash(`OTP sent to ${otpModal.member.member_name}`); setOtpModal(null); }} />}
      {toast && (
        <div className="fade" style={{ position: "fixed", bottom: 22, left: "50%", transform: "translateX(-50%)", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 4, padding: "10px 16px", fontSize: 13, boxShadow: "0 10px 30px rgba(0,0,0,.35)", display: "flex", alignItems: "center", gap: 8, zIndex: 50 }}>
          <Check size={15} style={{ color: t.ok }} /> {toast}
        </div>
      )}
    </div>
  );
}

// --- shared bits -------------------------------------------------------------
function Card({ t, children, style }) {
  return <div style={{ background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 5, ...style }}>{children}</div>;
}
function StatusPill({ t, active }) {
  const c = active ? t.ok : t.subtle;
  return <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 9px", borderRadius: 10, fontSize: 11, fontWeight: 500, background: `${c}22`, color: c }}>
    <span style={{ width: 6, height: 6, borderRadius: 6, background: c }} />{active ? "Active" : "Inactive"}
  </span>;
}
function RoleBadge({ t, dark, label }) {
  return <span style={{ padding: "2px 8px", borderRadius: 3, fontSize: 10.5, fontWeight: 500, background: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.05)", color: t.text }}>{label}</span>;
}

// --- OVERVIEW ---------------------------------------------------------------
function Overview({ t, dark, stats }) {
  const kpis = [
    { label: "Total users", value: stats.total, icon: <Users size={16} />, note: "All login accounts" },
    { label: "Active", value: stats.active, icon: <UserCheck size={16} />, note: "Can sign in", color: t.ok },
    { label: "Inactive", value: stats.inactive, icon: <UserX size={16} />, note: "Deactivated", color: t.subtle },
    { label: "No dashboards", value: stats.withoutComponents, icon: <PackageOpen size={16} />, note: "No components assigned", color: stats.withoutComponents ? t.warn : t.ok },
  ];
  const roleRows = Object.entries(stats.roleCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxRole = Math.max(1, ...roleRows.map((r) => r[1]));
  const maxComp = Math.max(1, ...stats.topComponents.map((c) => c.count));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(190px,1fr))", gap: 14 }}>
        {kpis.map((k) => (
          <Card key={k.label} t={t} style={{ padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10.5, letterSpacing: ".05em", textTransform: "uppercase", color: t.subtle }}>{k.label}</span>
              <span style={{ color: k.color || t.accent, display: "flex" }}>{k.icon}</span>
            </div>
            <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 30, lineHeight: 1 }}>{k.value}</div>
            <div style={{ fontSize: 11, color: t.subtle, marginTop: 5 }}>{k.note}</div>
          </Card>
        ))}
      </div>

      {/* Standard bundle callout — the report's headline finding. [§4.2] */}
      <Card t={t} style={{ padding: 18, display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap" }}>
        <div style={{ display: "grid", placeItems: "center", width: 74, height: 74, borderRadius: "50%", border: `3px solid ${t.accent}`, color: t.accent, fontFamily: HEAD, fontWeight: 700, fontSize: 20, flex: "none" }}>
          {stats.onStandardPct}%
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontFamily: HEAD, fontWeight: 600, fontSize: 16 }}>{stats.onStandard} active logins share one component bundle</div>
          <div style={{ fontSize: 12.5, color: t.subtle, marginTop: 4, lineHeight: 1.5 }}>
            Membership Dashboard, Cubs-Committees, Committee Meetings, SIR Dashboard. Role and component set are largely decoupled — the "New login" flow offers this as a one-click preset.
          </div>
        </div>
      </Card>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <Card t={t} style={{ padding: 18 }}>
          <SectionTitle t={t} icon={<ShieldCheck size={14} />}>Logins by role</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
            {roleRows.map(([role, n]) => (
              <div key={role}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3 }}>
                  <span>{role}</span><span style={{ color: t.subtle }}>{n}</span>
                </div>
                <div style={{ height: 6, background: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)", borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(n / maxRole) * 100}%`, background: t.accent, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card t={t} style={{ padding: 18 }}>
          <SectionTitle t={t} icon={<Layers size={14} />}>Most-granted components</SectionTitle>
          <div style={{ display: "flex", flexDirection: "column", gap: 9, marginTop: 12 }}>
            {stats.topComponents.map((c) => (
              <div key={c.id}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 3, gap: 8 }}>
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.label}</span>
                  <span style={{ color: t.subtle, flex: "none" }}>{c.count}</span>
                </div>
                <div style={{ height: 6, background: dark ? "rgba(255,255,255,.08)" : "rgba(0,0,0,.06)", borderRadius: 4 }}>
                  <div style={{ height: "100%", width: `${(c.count / maxComp) * 100}%`, background: t.accent700, borderRadius: 4 }} />
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* Geographic scope — only 3 of 9 levels used. [§3.3] */}
      <Card t={t} style={{ padding: 18 }}>
        <SectionTitle t={t} icon={<MapPin size={14} />}>Geographic scope in use</SectionTitle>
        <div style={{ display: "flex", gap: 14, marginTop: 12, flexWrap: "wrap" }}>
          {USED_LEVEL_IDS.map((lid) => {
            const name = USER_LEVELS.find((l) => l.id === lid).name;
            const n = stats.levelCounts[name] || 0;
            return (
              <div key={lid} style={{ flex: 1, minWidth: 140, padding: 14, border: `1px solid ${t.divider}`, borderRadius: 4 }}>
                <div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 24 }}>{n}</div>
                <div style={{ fontSize: 11, letterSpacing: ".05em", textTransform: "uppercase", color: t.subtle, marginTop: 2 }}>{name}</div>
              </div>
            );
          })}
          <div style={{ flex: 1, minWidth: 140, padding: 14, border: `1px dashed ${t.divider}`, borderRadius: 4, color: t.subtle, fontSize: 12, display: "flex", alignItems: "center" }}>
            The other 6 levels (District, Mandal, Village…) have no members.
          </div>
        </div>
      </Card>
    </div>
  );
}
function SectionTitle({ t, icon, children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 10.5, letterSpacing: ".1em", textTransform: "uppercase", color: t.accent }}>
    <span style={{ display: "flex" }}>{icon}</span>{children}
  </div>;
}

// --- USERS ------------------------------------------------------------------
function UsersScreen({ t, dark, rows, total, filters, setFilters, selected, setSelected, bulkSet, onOpen, onReset }) {
  const allSel = rows.length > 0 && rows.every((r) => selected.has(r.activity_member_id));
  const toggleAll = () => {
    const next = new Set(selected);
    if (allSel) rows.forEach((r) => next.delete(r.activity_member_id));
    else rows.forEach((r) => next.add(r.activity_member_id));
    setSelected(next);
  };
  const toggleOne = (id) => { const n = new Set(selected); n.has(id) ? n.delete(id) : n.add(id); setSelected(n); };
  const inputStyle = { background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 3, color: t.text, padding: "8px 10px", fontSize: 13, fontFamily: BODY };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card t={t} style={{ padding: 14, display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ flex: 1, minWidth: 180, display: "flex", flexDirection: "column", gap: 5 }}>
          <span style={{ fontSize: 11, color: t.subtle }}>Search membership ID, name or mobile</span>
          <div style={{ position: "relative" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: t.subtle }} />
            <input value={filters.q} onChange={(e) => setFilters({ ...filters, q: e.target.value })} placeholder="e.g. 20481 or Priya"
              style={{ ...inputStyle, width: "100%", paddingLeft: 32 }} />
          </div>
        </label>
        <Field t={t} label="Status">
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })} style={inputStyle}>
            <option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option>
          </select>
        </Field>
        <Field t={t} label="Role">
          <select value={filters.role} onChange={(e) => setFilters({ ...filters, role: e.target.value })} style={inputStyle}>
            <option value="all">All roles</option>
            {USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}
          </select>
        </Field>
        <Field t={t} label="Level">
          <select value={filters.level} onChange={(e) => setFilters({ ...filters, level: e.target.value })} style={inputStyle}>
            <option value="all">All levels</option>
            {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}
          </select>
        </Field>
        <button className="ac-btn" onClick={() => setFilters({ q: "", status: "all", role: "all", level: "all" })}
          style={{ padding: "9px 14px", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface, color: t.text, fontSize: 13 }}>Reset</button>
      </Card>

      {selected.size > 0 && (
        <div className="fade" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", background: dark ? "rgba(143,180,217,.12)" : "rgba(47,111,159,.08)", border: `1px solid ${t.divider}`, borderRadius: 4, flexWrap: "wrap" }}>
          <strong style={{ fontSize: 13 }}>{selected.size} selected</strong>
          <button className="ac-btn" onClick={() => bulkSet("Y")} style={secBtn(t)}>Activate</button>
          <button className="ac-btn" onClick={() => bulkSet("N")} style={secBtn(t)}>Deactivate</button>
          <button className="ac-btn" onClick={() => setSelected(new Set())} style={{ ...secBtn(t), background: "transparent", border: "none", color: t.subtle }}>Clear</button>
        </div>
      )}

      <Card t={t} style={{ overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: t.surface2, color: t.subtle, fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em" }}>
                <th style={{ width: 34, padding: "10px 0 10px 14px", textAlign: "left" }}>
                  <input type="checkbox" checked={allSel} onChange={toggleAll} style={{ accentColor: t.accent, width: 15, height: 15 }} />
                </th>
                {["Membership ID", "Name", "Mobile", "Role", "Scope", "Status", "Created", ""].map((h, i) => (
                  <th key={i} style={{ textAlign: i === 7 ? "right" : "left", padding: i === 7 ? "10px 14px" : "10px 8px", fontWeight: 500, whiteSpace: "nowrap" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => (
                <tr key={u.activity_member_id} className="ac-row" style={{ borderTop: `1px solid ${t.divider}` }}>
                  <td style={{ padding: "0 0 0 14px" }}>
                    <input type="checkbox" checked={selected.has(u.activity_member_id)} onChange={() => toggleOne(u.activity_member_id)} style={{ accentColor: t.accent, width: 15, height: 15 }} />
                  </td>
                  <td onClick={() => onOpen(u.activity_member_id)} style={{ cursor: "pointer", fontFamily: HEAD, fontWeight: 600, padding: "10px 8px" }}>
                    {u.membership_id || <span style={{ color: t.warn, fontSize: 11 }}>— none —</span>}
                  </td>
                  <td onClick={() => onOpen(u.activity_member_id)} style={{ cursor: "pointer", padding: "10px 8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                      <span style={{ width: 26, height: 26, flex: "none", borderRadius: "50%", background: dark ? "rgba(143,180,217,.16)" : "rgba(47,111,159,.12)", color: t.accent, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, fontFamily: HEAD }}>{initials(u.member_name)}</span>
                      <span style={{ color: u.member_name ? t.text : t.subtle }}>{u.member_name || NO_NAME}</span>
                    </div>
                  </td>
                  <td style={{ padding: "10px 8px", color: u.mobile_no ? t.text : t.warn }}>{u.mobile_no || "missing"}</td>
                  <td style={{ padding: "10px 8px" }}>{u.role_name ? <RoleBadge t={t} dark={dark} label={u.role_name} /> : <span style={{ color: t.subtle, fontSize: 11 }}>—</span>}</td>
                  <td style={{ padding: "10px 8px", fontSize: 12, color: t.subtle }}>{u.level_name ? `${u.level_name} · ${u.location_value}` : "—"}</td>
                  <td style={{ padding: "10px 8px" }}><StatusPill t={t} active={u.is_acitve === "Y"} /></td>
                  <td style={{ padding: "10px 8px", fontSize: 12, color: t.subtle, whiteSpace: "nowrap" }}>{fmtDate(u.inserted_time)}</td>
                  <td style={{ padding: "8px 14px", textAlign: "right", whiteSpace: "nowrap" }}>
                    <button className="ac-btn" title="View" onClick={() => onOpen(u.activity_member_id)} style={iconBtn(t)}><Eye size={15} /></button>
                    <button className="ac-btn" title="Reset OTP login" onClick={() => onReset(u)} style={iconBtn(t)}><KeyRound size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length === 0 && <div style={{ padding: 34, textAlign: "center", color: t.subtle, fontSize: 13 }}>No logins match these filters.</div>}
        <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 14px", borderTop: `1px solid ${t.divider}`, fontSize: 12, color: t.subtle }}>
          <span>Showing {rows.length} of {total} logins</span>
          <span>Live data</span>
        </div>
      </Card>
    </div>
  );
}
function Field({ t, label, children }) {
  return <label style={{ display: "flex", flexDirection: "column", gap: 5, minWidth: 130 }}>
    <span style={{ fontSize: 11, color: t.subtle }}>{label}</span>{children}
  </label>;
}
const secBtn = (t) => ({ padding: "7px 12px", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface, color: t.text, fontSize: 12.5 });
const iconBtn = (t) => ({ width: 30, height: 30, borderRadius: 3, background: "transparent", color: t.subtle, display: "inline-grid", placeItems: "center", marginLeft: 2 });

// --- DETAIL (draft + Save) --------------------------------------------------
function DetailScreen({ t, dark, u, groups, onBack, onSave, onReset }) {
  // Local draft. Nothing propagates to the parent until Save is pressed.
  const [draft, setDraft] = useState(u);
  const dirty = JSON.stringify(draft) !== JSON.stringify(u);

  const grp = draft.group_id ? groups.find((g) => g.user_group_id === draft.group_id) : null;
  const inheritedIds = new Set(grp ? grp.component_ids : []);
  const effective = effectiveComponents(draft, groups);
  // Components the admin can still add personally = catalogue minus inherited minus personal.
  const addable = COMPONENTS.filter((c) => !inheritedIds.has(c.id) && !draft.component_ids.includes(c.id));
  const locList = draft.level_id === 5 ? CONSTITUENCIES : draft.level_id === 4 ? PARLIAMENTS : ["Andhra Pradesh"];

  const set = (patch) => setDraft((d) => ({ ...d, ...patch }));
  const setRole = (id) => { const r = USER_TYPES.find((x) => x.id === id); set({ role_id: id, role_name: r.type, role_short: r.short }); };
  const setLevel = (id) => { const l = USER_LEVELS.find((x) => x.id === id); set({ level_id: id, level_name: l.name, location_value: "" }); };
  const addPersonal = (id) => set({ component_ids: [...draft.component_ids, id].sort((a, b) => a - b) });
  const removePersonal = (id) => set({ component_ids: draft.component_ids.filter((x) => x !== id) });
  const input = { background: t.surface2, border: `1px solid ${t.divider}`, borderRadius: 3, color: t.text, padding: "7px 9px", fontSize: 13, fontFamily: BODY, width: "100%" };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button className="ac-btn" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: t.subtle, fontSize: 13 }}>
          <ChevronLeft size={16} /> Back to logins
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {dirty && <span style={{ fontSize: 12, color: t.warn, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={13} /> Unsaved changes</span>}
          <button className="ac-btn" disabled={!dirty} onClick={() => setDraft(u)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface, color: dirty ? t.text : t.subtle, fontSize: 13, opacity: dirty ? 1 : 0.5, cursor: dirty ? "pointer" : "default" }}>
            <RotateCcw size={14} /> Discard
          </button>
          <button className="ac-btn" disabled={!dirty} onClick={() => onSave(draft)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 3, border: "none", background: dirty ? t.accent : t.surface2, color: dirty ? (dark ? t.bg : "#fff") : t.subtle, fontWeight: 600, fontSize: 13, cursor: dirty ? "pointer" : "default" }}>
            <Save size={14} /> Save changes
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "320px 1fr", gap: 18, alignItems: "start" }}>
        {/* Identity + editable role/scope */}
        <Card t={t} style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
            <div style={{ width: 60, height: 60, flex: "none", borderRadius: "50%", background: t.accent, color: dark ? t.bg : "#fff", display: "grid", placeItems: "center", fontFamily: HEAD, fontWeight: 700, fontSize: 22 }}>{initials(draft.member_name)}</div>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ margin: 0, fontFamily: HEAD, fontSize: 17, lineHeight: 1.2 }}>{draft.member_name || NO_NAME}</h2>
              <div style={{ fontSize: 12, color: t.accent, marginTop: 2 }}>{draft.role_name || "No role"}</div>
            </div>
          </div>
          <StatusPill t={t} active={draft.is_acitve === "Y"} />

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 9, fontSize: 13 }}>
            <KV t={t} k="Membership ID" v={draft.membership_id || "— none —"} mono />
            <KV t={t} k="Cadre ID" v={draft.tdp_cadre_id ? `#${draft.tdp_cadre_id}` : "unresolved"} mono />
            <KV t={t} k="Login ID" v={`#${draft.activity_member_id}`} mono />
          </div>

          <div style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 11 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Mobile (OTP)</span>
              <input value={draft.mobile_no || ""} onChange={(e) => set({ mobile_no: e.target.value || null })} style={input} placeholder="9xxxxxxxxx" /></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Role</span>
              <select value={draft.role_id} onChange={(e) => setRole(+e.target.value)} style={input}>
                {USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}
              </select></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Scope level</span>
              <select value={draft.level_id} onChange={(e) => setLevel(+e.target.value)} style={input}>
                {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}
              </select></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Location</span>
              <select value={draft.location_value} onChange={(e) => set({ location_value: e.target.value })} style={input}>
                <option value="">Select…</option>
                {locList.map((l) => <option key={l} value={l}>{l}</option>)}
              </select></label>
            <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Group</span>
              <select value={draft.group_id || ""} onChange={(e) => set({ group_id: e.target.value ? +e.target.value : null })} style={input}>
                <option value="">No group</option>
                {groups.map((g) => <option key={g.user_group_id} value={g.user_group_id}>{g.notes}</option>)}
              </select></label>
          </div>

          <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
            <button className="ac-btn" onClick={() => set({ is_acitve: draft.is_acitve === "Y" ? "N" : "Y" })} style={{ flex: 1, padding: "9px 0", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface2, color: t.text, fontSize: 13 }}>
              {draft.is_acitve === "Y" ? "Deactivate" : "Activate"}
            </button>
            <button className="ac-btn" onClick={onReset} style={{ flex: 1, padding: "9px 0", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface2, color: t.text, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
              <KeyRound size={14} /> Reset OTP
            </button>
          </div>
        </Card>

        {/* Components */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card t={t} style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <SectionTitle t={t} icon={<Layers size={14} />}>Effective access ({effective.length})</SectionTitle>
              {grp && <span style={{ fontSize: 11, padding: "2px 9px", borderRadius: 10, background: `${t.accent}22`, color: t.accent700, display: "flex", alignItems: "center", gap: 5 }}><FolderTree size={11} /> {grp.notes}</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {effective.length === 0 && <span style={{ fontSize: 13, color: t.warn }}>No dashboards assigned — this account opens to an empty view.</span>}
              {effective.map(({ id, component, inherited, personal }) => {
                const lockedOnly = inherited && !personal; // from group, cannot remove here
                return (
                  <span key={id}
                    style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 3, fontSize: 12,
                      border: `1px solid ${lockedOnly ? t.divider : t.accent}`,
                      background: lockedOnly ? (dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)") : (dark ? "rgba(143,180,217,.12)" : "rgba(47,111,159,.08)"),
                      color: lockedOnly ? t.subtle : t.text }}>
                    {inherited
                      ? <span title="Inherited from group" style={{ fontSize: 9, letterSpacing: ".04em", padding: "1px 5px", borderRadius: 8, background: `${t.accent}22`, color: t.accent700 }}>GROUP</span>
                      : <Check size={13} style={{ color: t.accent }} />}
                    {componentLabel(component)}
                    {personal && !inherited && (
                      <button className="ac-btn" onClick={() => removePersonal(id)} title="Remove personal grant" style={{ background: "transparent", color: t.subtle, marginLeft: 2, display: "flex" }}><X size={12} /></button>
                    )}
                  </span>
                );
              })}
            </div>
            {grp && <div style={{ fontSize: 11, color: t.subtle, marginTop: 10 }}>Grey = inherited from group (change on the group, not here). Blue = personal, removable.</div>}
          </Card>

          <Card t={t} style={{ padding: 18 }}>
            <SectionTitle t={t} icon={<Plus size={14} />}>Add personal component</SectionTitle>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
              {addable.length === 0 && <span style={{ fontSize: 12.5, color: t.subtle }}>Nothing left to add — all components are already granted or inherited.</span>}
              {addable.map((c) => (
                <button key={c.id} className="ac-btn" onClick={() => addPersonal(c.id)} title="Grant to this user only"
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 3, border: `1px dashed ${t.divider}`, background: "transparent", color: t.subtle, fontSize: 12 }}>
                  <Plus size={13} /> {componentLabel(c)}
                </button>
              ))}
            </div>
          </Card>

          <Card t={t} style={{ padding: 18 }}>
            <SectionTitle t={t} icon={<ClipboardList size={14} />}>Record</SectionTitle>
            <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, fontSize: 13 }}>
              <KV t={t} k="Created" v={fmtDateTime(u.inserted_time)} />
              <KV t={t} k="Last updated by" v={u.updated_by ? `#${u.updated_by}` : "—"} mono />
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

// --- GROUPS (working mock CRUD: create groups, set components, add members) --
function GroupsScreen({ t, dark, groups, members, activeGroupId, setActiveGroupId, onSaveGroup, onDeleteGroup, onSetMemberGroup }) {
  const active = groups.find((g) => g.user_group_id === activeGroupId) || null;
  if (active) {
    return <GroupEditor t={t} dark={dark} group={active} members={members} groups={groups}
      onBack={() => setActiveGroupId(null)} onSave={onSaveGroup} onDelete={onDeleteGroup} onSetMemberGroup={onSetMemberGroup} />;
  }
  const nextId = () => (groups.reduce((m, g) => Math.max(m, g.user_group_id), 0) + 1);
  const count = (gid) => members.filter((m) => m.group_id === gid).length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Card t={t} style={{ padding: 14, display: "flex", gap: 11, alignItems: "flex-start", borderLeft: `3px solid ${t.warn}` }}>
        <AlertTriangle size={16} style={{ color: t.warn, flex: "none", marginTop: 1 }} />
        <div style={{ fontSize: 12.5, color: t.subtle, lineHeight: 1.55 }}>
          <strong style={{ color: t.text }}>Requires two new tables.</strong> Groups here assign components and members, but the current schema has no <code style={{ color: t.accent700 }}>user_group_member</code> or <code style={{ color: t.accent700 }}>user_group_component</code> table. This is a working mock — persistence needs those tables built first.
        </div>
      </Card>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button className="ac-btn" onClick={() => { onSaveGroup({ user_group_id: nextId(), notes: "NEW_GROUP", component_ids: [] }); setActiveGroupId(nextId()); }}
          style={{ display: "flex", alignItems: "center", gap: 7, padding: "9px 15px", borderRadius: 3, background: t.accent, color: dark ? t.bg : "#fff", fontWeight: 600, fontSize: 13 }}>
          <Plus size={16} /> Create group
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 14 }}>
        {groups.map((g) => (
          <Card key={g.user_group_id} t={t} style={{ padding: 16, cursor: "pointer" }}>
            <div onClick={() => setActiveGroupId(g.user_group_id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <span style={{ width: 32, height: 32, display: "grid", placeItems: "center", borderRadius: 3, border: `1px solid ${t.divider}`, color: t.accent }}><FolderTree size={16} /></span>
                <span style={{ fontSize: 10.5, color: t.subtle, fontFamily: "ui-monospace,monospace" }}>#{g.user_group_id}</span>
              </div>
              <div style={{ fontFamily: HEAD, fontWeight: 600, fontSize: 14, marginTop: 12, wordBreak: "break-word" }}>{g.notes}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 12 }}>
                <div><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>{count(g.user_group_id)}</div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: t.subtle }}>Members</div></div>
                <div><div style={{ fontFamily: HEAD, fontWeight: 700, fontSize: 18 }}>{g.component_ids.length}</div><div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: ".05em", color: t.subtle }}>Components</div></div>
              </div>
            </div>
            <button className="ac-btn" onClick={() => setActiveGroupId(g.user_group_id)} style={{ marginTop: 14, width: "100%", padding: "7px 0", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface2, color: t.text, fontSize: 12.5 }}>Manage</button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function GroupEditor({ t, dark, group, members, groups, onBack, onSave, onDelete, onSetMemberGroup }) {
  const [draft, setDraft] = useState(group);
  const dirty = JSON.stringify(draft) !== JSON.stringify(group);
  const [memberQuery, setMemberQuery] = useState("");
  const input = { background: t.surface2, border: `1px solid ${t.divider}`, borderRadius: 3, color: t.text, padding: "8px 10px", fontSize: 13, fontFamily: BODY };

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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, gap: 12, flexWrap: "wrap" }}>
        <button className="ac-btn" onClick={onBack} style={{ display: "flex", alignItems: "center", gap: 6, background: "transparent", color: t.subtle, fontSize: 13 }}>
          <ChevronLeft size={16} /> All groups
        </button>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button className="ac-btn" onClick={() => onDelete(group.user_group_id)} style={{ padding: "8px 13px", borderRadius: 3, border: `1px solid ${t.divider}`, background: "transparent", color: t.bad, fontSize: 13 }}>Delete group</button>
          {dirty && <span style={{ fontSize: 12, color: t.warn, display: "flex", alignItems: "center", gap: 5 }}><AlertTriangle size={13} /> Unsaved</span>}
          <button className="ac-btn" disabled={!dirty} onClick={() => onSave(draft)}
            style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 16px", borderRadius: 3, border: "none", background: dirty ? t.accent : t.surface2, color: dirty ? (dark ? t.bg : "#fff") : t.subtle, fontWeight: 600, fontSize: 13, cursor: dirty ? "pointer" : "default" }}>
            <Save size={14} /> Save group
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18, alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          <Card t={t} style={{ padding: 18 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <span style={lbl(t)}>Group name</span>
              <input value={draft.notes} onChange={(e) => setDraft({ ...draft, notes: e.target.value })} style={{ ...input, width: "100%", fontFamily: HEAD, fontWeight: 600 }} />
            </label>
          </Card>

          <Card t={t} style={{ padding: 18 }}>
            <SectionTitle t={t} icon={<Layers size={14} />}>What this group can view ({draft.component_ids.length})</SectionTitle>
            <div style={{ fontSize: 12, color: t.subtle, margin: "8px 0 12px" }}>Every member inherits these. They can still be given extra components individually.</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
              {COMPONENTS.map((c) => {
                const on = draft.component_ids.includes(c.id);
                return <button key={c.id} className="ac-btn" onClick={() => toggleComp(c.id)}
                  style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 3, fontSize: 11.5, border: `1px solid ${on ? t.accent : t.divider}`, background: on ? (dark ? "rgba(143,180,217,.14)" : "rgba(47,111,159,.08)") : "transparent", color: on ? t.text : t.subtle }}>
                  {on ? <Check size={12} style={{ color: t.accent }} /> : <Plus size={12} />} {componentLabel(c)}
                </button>;
              })}
            </div>
          </Card>
        </div>

        <Card t={t} style={{ padding: 18 }}>
          <SectionTitle t={t} icon={<Users size={14} />}>Members ({inGroup.length})</SectionTitle>
          <div style={{ position: "relative", margin: "12px 0" }}>
            <Search size={15} style={{ position: "absolute", left: 10, top: 10, color: t.subtle }} />
            <input value={memberQuery} onChange={(e) => setMemberQuery(e.target.value)} placeholder="Search a login to add…" style={{ ...input, width: "100%", paddingLeft: 32 }} />
          </div>
          {candidates.length > 0 && (
            <div style={{ border: `1px solid ${t.divider}`, borderRadius: 4, marginBottom: 12, overflow: "hidden" }}>
              {candidates.map((m) => (
                <div key={m.activity_member_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderBottom: `1px solid ${t.divider}` }}>
                  <span style={{ fontSize: 13 }}>{m.member_name} <span style={{ color: t.subtle, fontSize: 11 }}>{m.membership_id || "no MID"}{m.group_id ? " · in another group" : ""}</span></span>
                  <button className="ac-btn" onClick={() => { onSetMemberGroup(m.activity_member_id, group.user_group_id); setMemberQuery(""); }} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 3, border: `1px solid ${t.accent}`, background: "transparent", color: t.accent700 }}>Add</button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {inGroup.length === 0 && <span style={{ fontSize: 12.5, color: t.subtle }}>No members yet. Search above to add logins.</span>}
            {inGroup.map((m) => (
              <div key={m.activity_member_id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", borderRadius: 4, background: t.surface2 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <span style={{ width: 26, height: 26, borderRadius: "50%", background: dark ? "rgba(143,180,217,.16)" : "rgba(47,111,159,.12)", color: t.accent, display: "grid", placeItems: "center", fontSize: 10, fontWeight: 600, fontFamily: HEAD }}>{initials(m.member_name)}</span>
                  <span style={{ fontSize: 13 }}>{m.member_name}<span style={{ color: t.subtle, fontSize: 11 }}> · {m.role_name}</span></span>
                </div>
                <button className="ac-btn" onClick={() => onSetMemberGroup(m.activity_member_id, null)} title="Remove from group" style={{ background: "transparent", color: t.subtle, display: "flex" }}><X size={15} /></button>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

// --- OTP MODAL (mock 6-digit generator) -------------------------------------
function OtpModal({ t, dark, data, onRegenerate, onClose, onSent }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    try { navigator.clipboard?.writeText(data.code); } catch (e) { /* clipboard unavailable */ }
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", padding: 20, zIndex: 45 }}>
      <div onClick={(e) => e.stopPropagation()} className="fade" style={{ width: "min(400px,100%)", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${t.divider}` }}>
          <h3 style={{ margin: 0, fontFamily: HEAD, fontSize: 16 }}>One-time passcode</h3>
          <button className="ac-btn" onClick={onClose} style={{ background: "transparent", color: t.subtle }}><X size={18} /></button>
        </div>
        <div style={{ padding: 20 }}>
          <div style={{ fontSize: 13, color: t.subtle }}>{data.member.member_name}</div>
          <div style={{ fontSize: 12, color: t.subtle, marginBottom: 14 }}>
            Deliver to {data.member.mobile_no ? "••• " + data.member.mobile_no.slice(-4) : <span style={{ color: t.warn }}>no mobile on file</span>}
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 14 }}>
            {data.code.split("").map((d, i) => (
              <span key={i} style={{ width: 42, height: 52, display: "grid", placeItems: "center", borderRadius: 4, border: `1px solid ${t.divider}`, background: t.surface2, fontFamily: HEAD, fontWeight: 700, fontSize: 24 }}>{d}</span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="ac-btn" onClick={onRegenerate} style={{ flex: 1, padding: "8px 0", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface2, color: t.text, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><RotateCcw size={13} /> Regenerate</button>
            <button className="ac-btn" onClick={copy} style={{ flex: 1, padding: "8px 0", borderRadius: 3, border: `1px solid ${t.divider}`, background: t.surface2, color: t.text, fontSize: 12.5, display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}><Copy size={13} /> {copied ? "Copied" : "Copy"}</button>
          </div>
          <div style={{ marginTop: 14, padding: "9px 11px", background: dark ? "rgba(224,176,98,.1)" : "rgba(165,116,31,.08)", borderRadius: 3, fontSize: 11, color: t.warn, lineHeight: 1.5, display: "flex", gap: 7 }}>
            <AlertTriangle size={13} style={{ flex: "none", marginTop: 1 }} />
            Demo only. Real OTPs must be generated, delivered and expired server-side — never in the browser.
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, padding: "14px 20px", borderTop: `1px solid ${t.divider}` }}>
          <button className="ac-btn" onClick={onClose} style={{ padding: "9px 16px", borderRadius: 3, border: `1px solid ${t.divider}`, background: "transparent", color: t.text, fontSize: 13 }}>Close</button>
          <button className="ac-btn" onClick={onSent} style={{ padding: "9px 18px", borderRadius: 3, border: "none", background: t.accent, color: dark ? t.bg : "#fff", fontWeight: 600, fontSize: 13 }}>Mark as sent</button>
        </div>
      </div>
    </div>
  );
}
function KV({ t, k, v, mono }) {
  return <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
    <span style={{ color: t.subtle }}>{k}</span>
    <span style={{ textAlign: "right", wordBreak: "break-word", fontFamily: mono ? "ui-monospace,monospace" : BODY }}>{v}</span>
  </div>;
}

// --- AUDIT (honest: driven only by inserted_time / updated_by) [§5.4] -------
function AuditScreen({ t, dark, members }) {
  const events = [...members]
    .sort((a, b) => new Date(b.inserted_time) - new Date(a.inserted_time))
    .slice(0, 30);
  return (
    <Card t={t} style={{ padding: 0, overflow: "hidden" }}>
      <div style={{ padding: "14px 18px", borderBottom: `1px solid ${t.divider}`, fontSize: 12.5, color: t.subtle, lineHeight: 1.5 }}>
        Login accounts listed by when they were created. A full change-history log isn't available yet, so this shows creation activity only.
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <tbody>
          {events.map((u) => (
            <tr key={u.activity_member_id} style={{ borderTop: `1px solid ${t.divider}` }}>
              <td style={{ padding: "11px 18px", width: 30 }}>
                <span style={{ width: 26, height: 26, display: "grid", placeItems: "center", borderRadius: 3, background: dark ? "rgba(143,180,217,.12)" : "rgba(47,111,159,.08)", color: t.accent }}><UserCheck size={14} /></span>
              </td>
              <td style={{ padding: "11px 8px" }}>
                Login <strong>{u.member_name || NO_NAME}</strong> ({u.membership_id || "no ID"}) created{u.role_name ? <> as <RoleBadge t={t} dark={dark} label={u.role_name} /></> : ""}
              </td>
              <td style={{ padding: "11px 18px", textAlign: "right", fontSize: 12, color: t.subtle, whiteSpace: "nowrap" }}>{fmtDateTime(u.inserted_time)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

// --- CREATE MODAL: MID-first stepped flow -----------------------------------
// Step 1 lookup MID in tdp_cadre -> Step 2 details (prefilled or manual) ->
// Step 3 role/scope/group/components -> create -> Step 4 OTP.
function CreateModal({ t, dark, groups, onClose, onCreate, onOtp }) {
  const [step, setStep] = useState(1);
  const [mid, setMid] = useState("");
  const [cadre, setCadre] = useState(null);     // resolved cadre row or null
  const [notFound, setNotFound] = useState(false);
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [roleId, setRoleId] = useState(12);
  const [levelId, setLevelId] = useState(5);
  const [location, setLocation] = useState("");
  const [groupId, setGroupId] = useState(null);
  const [comps, setComps] = useState([...STANDARD_BUNDLE]);
  const [err, setErr] = useState("");

  const input = { background: t.surface2, border: `1px solid ${t.divider}`, borderRadius: 3, color: t.text, padding: "9px 11px", fontSize: 13, width: "100%", fontFamily: BODY };
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
    // Personal components exclude anything inherited from the group.
    const personal = comps.filter((id) => !inheritedIds.has(id));
    const created = onCreate({
      mid: mid.trim(), tdp_cadre_id: cadre ? cadre.tdp_cadre_id : null,
      name: name.trim(), mobile: mobile.trim() || null,
      role_id: roleId, level_id: levelId, location, group_id: groupId, components: personal,
    });
    if (created) onOtp(created); // hand straight to OTP generation
  }
  const toggle = (id) => setComps((c) => c.includes(id) ? c.filter((x) => x !== id) : [...c, id]);

  const Stepper = () => (
    <div style={{ display: "flex", gap: 6, marginBottom: 4 }}>
      {["Membership ID", "Details", "Access"].map((s, i) => {
        const n = i + 1, on = step >= n;
        return <div key={s} style={{ flex: 1, display: "flex", alignItems: "center", gap: 7 }}>
          <span style={{ width: 22, height: 22, flex: "none", borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 600, background: on ? t.accent : t.surface2, color: on ? (dark ? t.bg : "#fff") : t.subtle }}>{n}</span>
          <span style={{ fontSize: 11.5, color: on ? t.text : t.subtle }}>{s}</span>
        </div>;
      })}
    </div>
  );

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.55)", display: "grid", placeItems: "center", padding: 20, zIndex: 40 }}>
      <div onClick={(e) => e.stopPropagation()} className="fade" style={{ width: "min(580px,100%)", maxHeight: "90vh", overflow: "auto", background: t.surface, border: `1px solid ${t.divider}`, borderRadius: 6 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 20px", borderBottom: `1px solid ${t.divider}` }}>
          <h3 style={{ margin: 0, fontFamily: HEAD, fontSize: 17 }}>New login</h3>
          <button className="ac-btn" onClick={onClose} style={{ background: "transparent", color: t.subtle }}><X size={18} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 16 }}>
          <Stepper />

          {step === 1 && (
            <>
              <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span style={lbl(t)}>Membership ID</span>
                <input autoFocus value={mid} onChange={(e) => setMid(e.target.value)} onKeyDown={(e) => e.key === "Enter" && doLookup()} style={input} placeholder="e.g. 20481, 20482, 30017…" />
              </label>
              <div style={{ fontSize: 12, color: t.subtle, lineHeight: 1.5 }}>
                Enter a member's Membership ID to look them up. Try <strong>19457249</strong> for a match; an unknown ID lets you enter the details manually.
              </div>
              {err && <ErrLine t={t}>{err}</ErrLine>}
            </>
          )}

          {step === 2 && (
            <>
              {cadre ? (
                <Card t={t} style={{ padding: 14, borderLeft: `3px solid ${t.ok}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: t.ok, marginBottom: 10 }}><UserCheck size={15} /> Member found — cadre #{cadre.tdp_cadre_id}</div>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, fontSize: 13 }}>
                    <KV t={t} k="Name" v={`${cadre.first_name} ${cadre.last_name}`} />
                    <KV t={t} k="Mobile" v={cadre.mobile_no} />
                    <KV t={t} k="Gender" v={cadre.gender || "—"} />
                    <KV t={t} k="Constituency ID" v={cadre.constituency_id ?? "—"} />
                    <KV t={t} k="Payment" v={cadre.payment_status} />
                  </div>
                </Card>
              ) : (
                <Card t={t} style={{ padding: 14, borderLeft: `3px solid ${t.warn}` }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: t.warn }}><AlertTriangle size={15} /> No cadre found for MID {mid}. Enter the name manually — this login won't resolve to a cadre record.</div>
                </Card>
              )}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Name {cadre && <span style={{ color: t.subtle }}>(from cadre)</span>}</span>
                  <input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!cadre} style={{ ...input, opacity: cadre ? 0.7 : 1 }} placeholder="Full name" /></label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Mobile (OTP)</span>
                  <input value={mobile} onChange={(e) => setMobile(e.target.value)} style={input} placeholder="9xxxxxxxxx" /></label>
              </div>
              {err && <ErrLine t={t}>{err}</ErrLine>}
            </>
          )}

          {step === 3 && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Role</span>
                  <select value={roleId} onChange={(e) => setRoleId(+e.target.value)} style={input}>{USER_TYPES.map((r) => <option key={r.id} value={r.id}>{r.type}</option>)}</select></label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Group</span>
                  <select value={groupId || ""} onChange={(e) => setGroupId(e.target.value ? +e.target.value : null)} style={input}>
                    <option value="">No group</option>
                    {groups.map((g) => <option key={g.user_group_id} value={g.user_group_id}>{g.notes}</option>)}
                  </select></label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Scope level</span>
                  <select value={levelId} onChange={(e) => { setLevelId(+e.target.value); setLocation(""); }} style={input}>
                    {USED_LEVEL_IDS.map((lid) => { const l = USER_LEVELS.find((x) => x.id === lid); return <option key={lid} value={lid}>{l.name}</option>; })}</select></label>
                <label style={{ display: "flex", flexDirection: "column", gap: 5 }}><span style={lbl(t)}>Location</span>
                  <select value={location} onChange={(e) => setLocation(e.target.value)} style={input}>
                    <option value="">Select…</option>{locList.map((l) => <option key={l} value={l}>{l}</option>)}</select></label>
              </div>

              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={lbl(t)}>Components {grp && <span style={{ color: t.subtle }}>— grey are inherited from {grp.notes}</span>}</span>
                  <button className="ac-btn" onClick={() => setComps([...STANDARD_BUNDLE])} style={{ fontSize: 11, padding: "4px 9px", borderRadius: 10, border: `1px solid ${t.accent}`, background: "transparent", color: t.accent700 }}>Apply standard bundle</button>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                  {COMPONENTS.map((c) => {
                    const inh = inheritedIds.has(c.id);
                    const on = inh || comps.includes(c.id);
                    return <button key={c.id} className="ac-btn" onClick={() => !inh && toggle(c.id)} title={inh ? "Inherited from group" : ""}
                      style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 9px", borderRadius: 3, fontSize: 11.5, cursor: inh ? "default" : "pointer",
                        border: `1px solid ${inh ? t.divider : on ? t.accent : t.divider}`,
                        background: inh ? (dark ? "rgba(255,255,255,.04)" : "rgba(0,0,0,.03)") : on ? (dark ? "rgba(143,180,217,.14)" : "rgba(47,111,159,.08)") : "transparent",
                        color: inh ? t.subtle : on ? t.text : t.subtle }}>
                      {inh ? <span style={{ fontSize: 9, padding: "1px 4px", borderRadius: 6, background: `${t.accent}22`, color: t.accent700 }}>GROUP</span> : on ? <Check size={12} style={{ color: t.accent }} /> : <Plus size={12} />} {componentLabel(c)}
                    </button>;
                  })}
                </div>
              </div>
              {err && <ErrLine t={t}>{err}</ErrLine>}
            </>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "14px 20px", borderTop: `1px solid ${t.divider}` }}>
          <button className="ac-btn" onClick={step === 1 ? onClose : () => setStep(step - 1)} style={{ padding: "9px 16px", borderRadius: 3, border: `1px solid ${t.divider}`, background: "transparent", color: t.text, fontSize: 13 }}>{step === 1 ? "Cancel" : "Back"}</button>
          {step === 1 && <button className="ac-btn" onClick={doLookup} style={primaryBtn(t, dark)}>Look up cadre</button>}
          {step === 2 && <button className="ac-btn" onClick={() => { if (!name.trim()) return setErr("Name is required."); setErr(""); setStep(3); }} style={primaryBtn(t, dark)}>Next: access</button>}
          {step === 3 && <button className="ac-btn" onClick={submit} style={primaryBtn(t, dark)}>Create & generate OTP</button>}
        </div>
      </div>
    </div>
  );
}
function ErrLine({ t, children }) {
  return <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5, color: t.bad }}><AlertTriangle size={14} /> {children}</div>;
}
const primaryBtn = (t, dark) => ({ padding: "9px 18px", borderRadius: 3, border: "none", background: t.accent, color: dark ? t.bg : "#fff", fontWeight: 600, fontSize: 13 });
const lbl = (t) => ({ fontSize: 11, color: t.subtle });
