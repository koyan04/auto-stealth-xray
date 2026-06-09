import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  Ban,
  Check,
  Copy,
  Database,
  Edit3,
  Plus,
  RefreshCw,
  Save,
  Shield,
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

function dateForInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 16);
}

function Stat({ icon: Icon, label, value }) {
  return (
    <div className="stat">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function StatusPill({ user }) {
  if (!user.enabled) return <span className="pill muted"><Ban size={14} /> Disabled</span>;
  if (user.expired) return <span className="pill danger"><Ban size={14} /> Expired</span>;
  if (user.overData) return <span className="pill danger"><Database size={14} /> Data limit</span>;
  if (user.overIp) return <span className="pill danger"><Wifi size={14} /> IP limit</span>;
  return <span className="pill success"><Check size={14} /> Active</span>;
}

function UserForm({ initial, onClose, onSave }) {
  const [form, setForm] = useState(() => ({ ...emptyForm, ...initial, expiresAt: dateForInput(initial?.expiresAt) }));
  const [saving, setSaving] = useState(false);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        ...form,
        dataLimitGb: Number(form.dataLimitGb),
        ipLimit: Number(form.ipLimit),
        expiresAt: form.expiresAt ? new Date(form.expiresAt).toISOString() : ""
      };
      await onSave(payload);
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
          <input type="datetime-local" value={form.expiresAt} onChange={(event) => update("expiresAt", event.target.value)} />
        </label>

        <label>
          Note
          <textarea value={form.note} onChange={(event) => update("note", event.target.value)} rows="3" />
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

function App() {
  const [users, setUsers] = useState([]);
  const [status, setStatus] = useState(null);
  const [editing, setEditing] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [token, setToken] = useState(localStorage.getItem("panelToken") || "");

  const totals = useMemo(() => {
    const used = users.reduce((sum, user) => sum + (user.usedBytes || 0), 0);
    return { used };
  }, [users]);

  async function load() {
    setError("");
    setLoading(true);
    try {
      const [usersResponse, statusResponse] = await Promise.all([api("/users"), api("/status")]);
      setUsers(usersResponse.users);
      setStatus(statusResponse);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  function saveToken(event) {
    event.preventDefault();
    localStorage.setItem("panelToken", token);
    load();
  }

  async function saveUser(payload) {
    if (editing?.id) {
      await api(`/users/${editing.id}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      await api("/users", { method: "POST", body: JSON.stringify(payload) });
    }
    setEditing(null);
    await load();
  }

  async function removeUser(user) {
    if (!confirm(`Delete ${user.name}?`)) return;
    await api(`/users/${user.id}`, { method: "DELETE" });
    await load();
  }

  async function copyLink(user) {
    if (!user.link) return;
    await navigator.clipboard.writeText(user.link);
  }

  return (
    <main>
      <aside className="sidebar">
        <div className="brand">
          <Shield size={28} />
          <div>
            <strong>Xray Manager</strong>
            <span>ws+tls only</span>
          </div>
        </div>
        <nav>
          <a className="active"><Activity size={18} /> Users</a>
          <a><Wifi size={18} /> Inbound</a>
          <a><Database size={18} /> Limits</a>
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>VLESS WebSocket panel</h1>
            <p>{status?.domain || "Domain not configured"} / path {status?.wsPath || "/assets"}</p>
          </div>
          <div className="actions">
            <button className="secondaryButton" onClick={load}><RefreshCw size={16} /> Refresh</button>
            <button className="primaryButton" onClick={() => setEditing({})}><Plus size={16} /> Add user</button>
          </div>
        </header>

        {error === "Unauthorized" && (
          <form className="tokenBox" onSubmit={saveToken}>
            <label>
              Panel token
              <input value={token} onChange={(event) => setToken(event.target.value)} placeholder="Paste install token" />
            </label>
            <button className="primaryButton" type="submit">Unlock</button>
          </form>
        )}

        {error && error !== "Unauthorized" && <div className="errorBox">{error}</div>}

        <div className="statsGrid">
          <Stat icon={Shield} label="Active users" value={status?.activeUsers ?? "-"} />
          <Stat icon={Ban} label="Limited users" value={status?.limitedUsers ?? "-"} />
          <Stat icon={Database} label="Total usage" value={formatBytes(totals.used)} />
          <Stat icon={Wifi} label="Inbound" value="10000 / ws" />
        </div>

        <section className="tablePanel">
          <div className="panelHeader">
            <div>
              <h2>Users</h2>
              <p>VLESS ws+tls clients</p>
            </div>
          </div>

          <div className="tableWrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Status</th>
                  <th>Used</th>
                  <th>IP</th>
                  <th>Expiry</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr><td colSpan="6" className="empty">Loading users</td></tr>
                )}
                {!loading && users.length === 0 && (
                  <tr><td colSpan="6" className="empty">No users yet</td></tr>
                )}
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>
                      <strong>{user.name}</strong>
                      <span className="subtle">{user.uuid}</span>
                    </td>
                    <td><StatusPill user={user} /></td>
                    <td>
                      {formatBytes(user.usedBytes)}
                      <span className="subtle">{user.dataLimitGb ? `${user.dataLimitGb} GB limit` : "No data limit"}</span>
                    </td>
                    <td>
                      {user.onlineIps}
                      <span className="subtle">{user.ipLimit ? `${user.ipLimit} max` : "No IP limit"}</span>
                    </td>
                    <td>{user.expiresAt ? new Date(user.expiresAt).toLocaleString() : "Never"}</td>
                    <td>
                      <div className="rowActions">
                        <button className="iconButton" title="Copy link" onClick={() => copyLink(user)} disabled={!user.link}><Copy size={16} /></button>
                        <button className="iconButton" title="Edit user" onClick={() => setEditing(user)}><Edit3 size={16} /></button>
                        <button className="iconButton dangerIcon" title="Delete user" onClick={() => removeUser(user)}><Trash2 size={16} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </section>

      {editing && <UserForm initial={editing} onClose={() => setEditing(null)} onSave={saveUser} />}
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
