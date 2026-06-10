import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  ArrowUpDown,
  Ban,
  Check,
  Clock3,
  Copy,
  Database,
  Edit3,
  Filter,
  Info,
  Plus,
  RefreshCw,
  Save,
  Search,
  Shield,
  ToggleLeft,
  ToggleRight,
  Trash2,
  Wifi
} from "lucide-react";
import "./styles.css";

const emptyForm = {
  name: "",
  uuid: "",
  enabled: true,
  dataLimitGb: 0,
  ipLimit: 0,
  expiresAt: "",
  note: ""
};

const statusFilters = [
  { label: "All", value: "all" },
  { label: "Online", value: "online" },
  { label: "Offline", value: "offline" },
  { label: "Disabled", value: "disabled" },
  { label: "Limited", value: "limited" },
  { label: "Unlimited", value: "unlimited" }
];

const sortOptions = [
  { label: "Name", value: "name" },
  { label: "Status", value: "status" },
  { label: "Usage", value: "usage" },
  { label: "Devices", value: "devices" },
  { label: "Expiry", value: "expiry" },
  { label: "Last online", value: "lastSeenAt" }
];

function authHeaders() {
  const token = localStorage.getItem("panelToken") || "";
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function api(path, options = {}) {
  const base = import.meta.env.BASE_URL || "/";
  const response = await fetch(`${base}api${path}`.replace(/\/{2,}/g, "/"), {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(options.headers || {})
    }
  });
  if (response.status === 401) throw new Error("Unauthorized");
  if (!response.ok) throw new Error((await response.json()).error || "Request failed");
  return response.json();
}

function formatBytes(value) {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function toInputDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function nowInputValue() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

function isUnlimited(user) {
  return Number(user.dataLimitGb || 0) === 0 && Number(user.ipLimit || 0) === 0;
}

function userState(user) {
  if (!user.enabled) return "Disabled";
  if (user.expired) return "Expired";
  return user.online ? "Online" : "Offline";
}

function stateTone(state) {
  if (state === "Online") return "success";
  if (state === "Disabled" || state === "Expired") return "danger";
  return "muted";
}

function Stat({ icon: Icon, label, value, hint }) {
  return (
    <div className="statCard">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
        {hint ? <small>{hint}</small> : null}
      </div>
    </div>
  );
}

function ToastStack({ toasts, onDismiss }) {
  return (
    <div className="toastStack" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast ${toast.kind}`}>
          <span>{toast.message}</span>
          <button type="button" className="toastClose" onClick={() => onDismiss(toast.id)}>
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ user }) {
  const state = userState(user);
  const tone = stateTone(state);
  const icon = state === "Online" ? <Check size={14} /> : state === "Disabled" ? <Ban size={14} /> : state === "Expired" ? <Clock3 size={14} /> : <Wifi size={14} />;
  return (
    <span className={`pill ${tone}`}>
      {icon}
      {state}
    </span>
  );
}

function UsageBar({ usedBytes, limitGb }) {
  const unlimited = !limitGb;
  const limitBytes = limitGb * 1024 * 1024 * 1024;
  const ratio = unlimited ? 100 : Math.min(100, (usedBytes / Math.max(limitBytes, 1)) * 100);
  return (
    <div className="usageCell">
      <div className="usageHeader">
        <strong>
          {formatBytes(usedBytes)} / {unlimited ? "∞" : formatBytes(limitBytes)}
        </strong>
        <span>{unlimited ? "Unlimited" : `${ratio.toFixed(0)}% used`}</span>
      </div>
      <div className={`progressTrack ${unlimited ? "progressUnlimited" : ""}`}>
        <span style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function UserForm({ initial, onClose, onSave, onToast }) {
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    ...initial,
    expiresAt: toInputDateTime(initial?.expiresAt)
  }));
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        uuid: form.uuid.trim(),
        enabled: Boolean(form.enabled),
        dataLimitGb: Number(form.dataLimitGb),
        ipLimit: Number(form.ipLimit),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : "",
        note: form.note.trim()
      };
      await onSave(payload);
      onToast(initial?.id ? "User updated" : "User created", "success");
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="presentation">
      <form className="modal" onSubmit={submit}>
        <div className="modalHeader">
          <div>
            <h2>{initial?.id ? "Edit user" : "Add user"}</h2>
            <p>VLESS ws+tls client settings</p>
          </div>
          <button className="ghostButton" type="button" onClick={onClose}>Close</button>
        </div>

        <label>
          Name
          <input value={form.name} onChange={(event) => update("name", event.target.value)} required />
        </label>

        <label>
          UUID
          <input value={form.uuid} onChange={(event) => update("uuid", event.target.value)} placeholder="Auto generated when empty" />
        </label>

        <label>
          Note
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} rows="3" placeholder="Shown in the user list" />
        </label>

        <div className="formGrid">
          <label>
            Data limit (GB)
            <input type="number" min="0" step="0.1" value={form.dataLimitGb} onChange={(event) => update("dataLimitGb", event.target.value)} />
          </label>
          <label>
            IP limit
            <input type="number" min="0" step="1" value={form.ipLimit} onChange={(event) => update("ipLimit", event.target.value)} />
          </label>
        </div>

        <label>
          Expiry
          <div className="inlineActionRow">
            <input type="datetime-local" value={form.expiresAt} onChange={(event) => update("expiresAt", event.target.value)} />
            <button type="button" className="ghostButton" onClick={() => { update("expiresAt", nowInputValue()); onToast("Expiry set to current time", "info"); }}>Now</button>
          </div>
        </label>

        <label className="checkRow">
          <input type="checkbox" checked={form.enabled} onChange={(event) => update("enabled", event.target.checked)} />
          Enabled in Xray
        </label>

        <div className="modalActions">
          <button className="ghostButton" type="button" onClick={onClose}>Cancel</button>
          <button className="primaryButton" type="submit" disabled={saving}>
            <Save size={16} /> {saving ? "Saving" : "Save"}
          </button>
        </div>
      </form>
    </div>
  );
}

function DevicesModal({ user, onClose }) {
  return (
    <div className="modalBackdrop" role="presentation">
      <div className="modal deviceModal">
        <div className="modalHeader">
          <div>
            <h2>{user.name} devices</h2>
            <p>{user.onlineDevices || 0} live device{user.onlineDevices === 1 ? "" : "s"}</p>
          </div>
          <button className="ghostButton" type="button" onClick={onClose}>Close</button>
        </div>

        <div className="deviceSummary">
          <div>
            <span>Last online</span>
            <strong>{user.lastSeenAt ? formatDateTime(user.lastSeenAt) : "No recent activity"}</strong>
          </div>
          <div>
            <span>Connected IPs</span>
            <strong>{user.connectedIps?.length || 0}</strong>
          </div>
        </div>

        <div className="deviceList">
          {user.connectedIps?.length ? (
            user.connectedIps.map((ip) => (
              <div key={ip} className="deviceRow">
                <strong>{ip}</strong>
                <span>Connected now</span>
              </div>
            ))
          ) : (
            <div className="emptyState">No active devices detected.</div>
          )}
        </div>
      </div>
    </div>
  );
}

function App() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deviceUser, setDeviceUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState(localStorage.getItem("panelToken") || "");
  const [toasts, setToasts] = useState([]);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortBy, setSortBy] = useState("name");
  const [sortDirection, setSortDirection] = useState("asc");

  function pushToast(message, kind = "success") {
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((current) => [...current, { id, message, kind }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3000);
  }

  const summary = useMemo(() => {
    const used = users.reduce((sum, user) => sum + (user.usedBytes || 0), 0);
    return {
      used,
      online: users.filter((user) => user.online).length,
      unlimited: users.filter((user) => isUnlimited(user)).length,
      disabled: users.filter((user) => !user.enabled).length
    };
  }, [users]);

  const visibleUsers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = users.filter((user) => {
      const searchable = [user.name, user.note, user.email, user.connectedIps?.join(" "), user.knownIps?.join(" ")]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;

      const state = userState(user).toLowerCase();
      if (statusFilter === "online") return state === "online";
      if (statusFilter === "offline") return state === "offline";
      if (statusFilter === "disabled") return state === "disabled";
      if (statusFilter === "limited") return !isUnlimited(user);
      if (statusFilter === "unlimited") return isUnlimited(user);
      return true;
    });

    const direction = sortDirection === "asc" ? 1 : -1;
    return [...filtered].sort((left, right) => {
      let comparison = 0;
      switch (sortBy) {
        case "status":
          comparison = userState(left).localeCompare(userState(right));
          break;
        case "usage":
          comparison = (left.usedBytes || 0) - (right.usedBytes || 0);
          break;
        case "devices":
          comparison = (left.onlineDevices || 0) - (right.onlineDevices || 0);
          break;
        case "expiry":
          comparison = (left.expiresAt ? new Date(left.expiresAt).getTime() : Number.MAX_SAFE_INTEGER) - (right.expiresAt ? new Date(right.expiresAt).getTime() : Number.MAX_SAFE_INTEGER);
          break;
        case "lastSeenAt":
          comparison = (left.lastSeenAt ? new Date(left.lastSeenAt).getTime() : 0) - (right.lastSeenAt ? new Date(right.lastSeenAt).getTime() : 0);
          break;
        case "name":
        default:
          comparison = left.name.localeCompare(right.name);
          break;
      }
      if (comparison === 0) comparison = left.name.localeCompare(right.name);
      return comparison * direction;
    });
  }, [query, statusFilter, sortBy, sortDirection, users]);

  async function load({ silent = false } = {}) {
    if (!silent) setLoading(true);
    try {
      const [usersResponse, statusResponse] = await Promise.all([api("/users"), api("/status")]);
      setUsers(usersResponse.users || []);
      setStatus(statusResponse);
      setError("");
    } catch (err) {
      setError(err.message);
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!token) return undefined;
    const timer = window.setInterval(() => load({ silent: true }), 15000);
    return () => window.clearInterval(timer);
  }, [token]);

  async function unlock(event) {
    event.preventDefault();
    localStorage.setItem("panelToken", token);
    pushToast("Panel unlocked", "success");
    await load();
  }

  async function saveUser(payload) {
    if (editing?.id) {
      await api(`/users/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/users", { method: "POST", body: JSON.stringify(payload) });
    }
    await load();
  }

  async function removeUser(user) {
    if (!confirm(`Delete ${user.name}?`)) return;
    await api(`/users/${user.id}`, { method: "DELETE" });
    pushToast(`Deleted ${user.name}`, "success");
    await load();
  }

  async function toggleUser(user) {
    await api(`/users/${user.id}`, {
      method: "PUT",
      body: JSON.stringify({
        name: user.name,
        uuid: user.uuid,
        enabled: !user.enabled,
        dataLimitGb: user.dataLimitGb,
        ipLimit: user.ipLimit,
        expiresAt: user.expiresAt || "",
        note: user.note || ""
      })
    });
    pushToast(`${user.enabled ? "Disabled" : "Enabled"} ${user.name}`, "success");
    await load();
  }

  async function copyLink(user) {
    if (!user.link) {
      pushToast("No VLESS link available yet", "warning");
      return;
    }
    await navigator.clipboard.writeText(user.link);
    pushToast(`Copied link for ${user.name}`, "success");
  }

  function openEditor(user) {
    setEditing(user);
    pushToast(user?.id ? `Editing ${user.name}` : "Add user form opened", "info");
  }

  function clearFilters() {
    setQuery("");
    setStatusFilter("all");
    setSortBy("name");
    setSortDirection("asc");
    pushToast("Filters cleared", "info");
  }

  function openDevices(user) {
    setDeviceUser(user);
    pushToast(`Showing devices for ${user.name}`, "info");
  }

  return (
    <main>
      <ToastStack toasts={toasts} onDismiss={(id) => setToasts((current) => current.filter((toast) => toast.id !== id))} />

      <aside className="sidebar">
        <div className="brand">
          <Shield size={28} />
          <div>
            <strong>Xray Manager</strong>
            <span>ws+tls only</span>
          </div>
        </div>

        <nav>
          <a className="active" aria-current="page"><Activity size={18} /> Users</a>
        </nav>

        <div className="sidebarNote">Inbound and limit sections are intentionally hidden.</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>VLESS WebSocket panel</h1>
            <p>{status?.domain || "Domain not configured"} / path {status?.wsPath || "/assets"}</p>
          </div>
          <div className="actions">
            <button className="secondaryButton" onClick={async () => { pushToast("Refreshing dashboard", "info"); await load(); }}>
              <RefreshCw size={16} /> Refresh
            </button>
            <button className="primaryButton" onClick={() => openEditor({})}>
              <Plus size={16} /> Add user
            </button>
          </div>
        </header>

        {error === "Unauthorized" && (
          <form className="tokenBox" onSubmit={unlock}>
            <label>
              Panel token
              <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste install token" />
            </label>
            <button className="primaryButton" type="submit">Unlock</button>
          </form>
        )}

        {error && error !== "Unauthorized" && <div className="errorBox">{error}</div>}

        <div className="statsGrid">
          <Stat icon={Shield} label="Total users" value={status?.totalUsers ?? users.length} hint="All configured accounts" />
          <Stat icon={Wifi} label="Online users" value={status?.onlineUsers ?? summary.online} hint="Live in the last poll window" />
          <Stat icon={Database} label="Unlimited users" value={status?.unlimitedUsers ?? summary.unlimited} hint="No data or IP limits" />
          <Stat icon={Ban} label="Disabled users" value={status?.disabledUsers ?? summary.disabled} hint="Temporarily switched off" />
        </div>

        <section className="tablePanel">
          <div className="panelHeader">
            <div>
              <h2>Users</h2>
              <p>VLESS ws+tls clients</p>
            </div>
            <button className="ghostButton" type="button" onClick={clearFilters}><Filter size={16} /> Clear filters</button>
          </div>

          <div className="toolbar">
            <label className="searchBox">
              <Search size={16} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, note, IP, or email" />
            </label>

            <label className="selectBox">
              <span>Status</span>
              <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
                {statusFilters.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            <label className="selectBox">
              <span>Sort by</span>
              <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                {sortOptions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
              </select>
            </label>

            <button className="ghostButton sortToggle" type="button" onClick={() => { setSortDirection((current) => (current === "asc" ? "desc" : "asc")); pushToast(`Sort ${sortDirection === "asc" ? "descending" : "ascending"}`, "info"); }}>
              <ArrowUpDown size={16} /> {sortDirection === "asc" ? "Ascending" : "Descending"}
            </button>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Data</th>
                  <th>Devices</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan="6" className="empty">Loading users</td></tr>}
                {!loading && visibleUsers.length === 0 && <tr><td colSpan="6" className="empty">No users match the current filters</td></tr>}

                {visibleUsers.map((user) => {
                  const state = userState(user);
                  const limitBytes = Number(user.dataLimitGb || 0) * 1024 * 1024 * 1024;
                  const progress = limitBytes ? Math.min(100, ((user.usedBytes || 0) / limitBytes) * 100) : 100;
                  return (
                    <tr key={user.id}>
                      <td>
                        <strong>{user.name}</strong>
                        <span className="subtle">{user.note || "No note"}</span>
                      </td>
                      <td>
                        <StatusBadge user={user} />
                        <span className="subtle">
                          {state === "Offline" && user.lastSeenAt
                            ? `Last online ${formatDateTime(user.lastSeenAt)}`
                            : state === "Offline"
                              ? "No recent activity"
                              : user.onlineDevices
                                ? `${user.onlineDevices} live device${user.onlineDevices === 1 ? "" : "s"}`
                                : "No live devices"}
                        </span>
                      </td>
                      <td>
                        <UsageBar usedBytes={user.usedBytes || 0} limitGb={user.dataLimitGb || 0} />
                      </td>
                      <td>
                        <div className="deviceCell">
                          <div className="deviceCountRow">
                            <strong>{user.onlineDevices || 0}</strong>
                            <button type="button" className="iconButton" title="View connected IPs" onClick={() => openDevices(user)}>
                              <Info size={16} />
                            </button>
                          </div>
                          <span className="subtle">{user.ipLimit > 0 ? `${user.ipLimit} limit` : "∞"}</span>
                        </div>
                      </td>
                      <td>{user.expiresAt ? formatDateTime(user.expiresAt) : "Never"}</td>
                      <td>
                        <div className="rowActions">
                          <button className="switchButton" type="button" title={user.enabled ? "Disable user" : "Enable user"} onClick={() => toggleUser(user)}>
                            {user.enabled ? <ToggleRight size={20} /> : <ToggleLeft size={20} />}
                          </button>
                          <button className="iconButton" type="button" title="Copy link" onClick={() => copyLink(user)} disabled={!user.link}><Copy size={16} /></button>
                          <button className="iconButton" type="button" title="Edit user" onClick={() => openEditor(user)}><Edit3 size={16} /></button>
                          <button className="iconButton dangerIcon" type="button" title="Delete user" onClick={() => removeUser(user)}><Trash2 size={16} /></button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {editing && <UserForm initial={editing} onClose={() => setEditing(null)} onSave={saveUser} onToast={pushToast} />}
      {deviceUser && <DevicesModal user={deviceUser} onClose={() => setDeviceUser(null)} />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);