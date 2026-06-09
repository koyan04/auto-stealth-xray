import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import express from "express";

const execFileAsync = promisify(execFile);
const PORT = Number(process.env.PANEL_PORT || 2053);
const PANEL_TOKEN = process.env.PANEL_TOKEN || "";
const DOMAIN = process.env.DOMAIN || "";
const WS_PATH = process.env.WS_PATH || "/assets";
const XRAY_CONFIG_PATH = process.env.XRAY_CONFIG_PATH || "/usr/local/etc/xray/config.json";
const PANEL_DB_PATH = process.env.PANEL_DB_PATH || "/etc/xray-panel/users.json";
const XRAY_BIN = process.env.XRAY_BIN || "/usr/local/bin/xray";
const XRAY_ACCESS_LOG = process.env.XRAY_ACCESS_LOG || "/var/log/xray/access.log";
const XRAY_API_SERVER = process.env.XRAY_API_SERVER || "127.0.0.1:10085";

const app = express();
app.use(express.json({ limit: "1mb" }));

function requireAuth(req, res, next) {
  if (!PANEL_TOKEN) return next();
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (token === PANEL_TOKEN) return next();
  return res.status(401).json({ error: "Unauthorized" });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return fallback;
    throw error;
  }
}

async function writeJson(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
  await fs.rename(temp, file);
}

async function readDb() {
  const db = await readJson(PANEL_DB_PATH, { users: [], events: [] });
  return {
    users: Array.isArray(db.users) ? db.users : [],
    events: Array.isArray(db.events) ? db.events : []
  };
}

async function saveDb(db) {
  await writeJson(PANEL_DB_PATH, db);
}

function normalizeUser(input, existing = {}) {
  const now = new Date().toISOString();
  const dataLimitGb = Number(input.dataLimitGb ?? existing.dataLimitGb ?? 0);
  const ipLimit = Number(input.ipLimit ?? existing.ipLimit ?? 0);
  return {
    id: existing.id || crypto.randomUUID(),
    uuid: input.uuid || existing.uuid || crypto.randomUUID(),
    name: String(input.name ?? existing.name ?? "New user").trim(),
    enabled: Boolean(input.enabled ?? existing.enabled ?? true),
    dataLimitGb: Number.isFinite(dataLimitGb) && dataLimitGb > 0 ? dataLimitGb : 0,
    ipLimit: Number.isFinite(ipLimit) && ipLimit > 0 ? Math.floor(ipLimit) : 0,
    expiresAt: input.expiresAt === "" ? "" : String(input.expiresAt ?? existing.expiresAt ?? ""),
    note: String(input.note ?? existing.note ?? ""),
    usageOffsetBytes: Number(existing.usageOffsetBytes || 0),
    lastRuntimeBytes: Number(existing.lastRuntimeBytes || 0),
    usedBytes: Number(existing.usedBytes || 0),
    createdAt: existing.createdAt || now,
    updatedAt: now
  };
}

function userEmail(user) {
  return `${user.name.replace(/[^a-z0-9._-]/gi, "_")}__${user.id}`;
}

function isExpired(user) {
  return Boolean(user.expiresAt && Date.parse(user.expiresAt) <= Date.now());
}

function gbToBytes(gb) {
  return Math.round(gb * 1024 * 1024 * 1024);
}

async function readXrayConfig() {
  const fallback = {
    log: { access: XRAY_ACCESS_LOG, loglevel: "warning" },
    inbounds: [],
    outbounds: [{ protocol: "freedom" }]
  };
  const config = await readJson(XRAY_CONFIG_PATH, fallback);
  config.inbounds ||= [];
  config.outbounds ||= [{ protocol: "freedom" }];
  return config;
}

function ensureManagedConfig(config, activeUsers) {
  let inbound = config.inbounds.find((item) => item.protocol === "vless" && item.streamSettings?.network === "ws");
  if (!inbound) {
    inbound = { port: 10000, protocol: "vless", settings: {}, streamSettings: {} };
    config.inbounds.unshift(inbound);
  }

  inbound.port = 10000;
  inbound.protocol = "vless";
  inbound.settings = {
    clients: activeUsers.map((user) => ({ id: user.uuid, email: userEmail(user) })),
    decryption: "none"
  };
  inbound.streamSettings = { network: "ws", wsSettings: { path: WS_PATH } };

  config.log = { ...(config.log || {}), access: XRAY_ACCESS_LOG, loglevel: config.log?.loglevel || "warning" };
  config.stats = config.stats || {};
  config.policy = {
    ...(config.policy || {}),
    levels: {
      ...(config.policy?.levels || {}),
      "0": { ...(config.policy?.levels?.["0"] || {}), statsUserUplink: true, statsUserDownlink: true }
    },
    system: { ...(config.policy?.system || {}), statsInboundUplink: true, statsInboundDownlink: true }
  };

  const apiInbound = config.inbounds.find((item) => item.tag === "api");
  if (!apiInbound) {
    config.inbounds.push({
      tag: "api",
      listen: "127.0.0.1",
      port: 10085,
      protocol: "dokodemo-door",
      settings: { address: "127.0.0.1" }
    });
  }

  if (!config.outbounds.some((item) => item.tag === "api")) {
    config.outbounds.push({ protocol: "freedom", tag: "api" });
  }

  config.api = { tag: "api", services: ["StatsService"] };
  config.routing = config.routing || {};
  config.routing.rules = [
    ...(config.routing.rules || []).filter((rule) => rule.outboundTag !== "api"),
    { type: "field", inboundTag: ["api"], outboundTag: "api" }
  ];
  return config;
}

async function restartXray() {
  try {
    await execFileAsync("systemctl", ["restart", "xray"], { timeout: 15000 });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.stderr || error.message };
  }
}

async function syncXray(db) {
  const usage = await getUsage(db.users);
  const activeUsers = db.users.filter((user) => {
    const used = usage[user.id]?.total || 0;
    const ips = usage[user.id]?.ips || 0;
    const overData = user.dataLimitGb > 0 && used >= gbToBytes(user.dataLimitGb);
    const overIp = user.ipLimit > 0 && ips > user.ipLimit;
    return user.enabled && !isExpired(user) && !overData && !overIp;
  });
  const config = ensureManagedConfig(await readXrayConfig(), activeUsers);
  try {
    await fs.copyFile(XRAY_CONFIG_PATH, `${XRAY_CONFIG_PATH}.bak`);
  } catch {
    // First install may not have an existing config yet.
  }
  await writeJson(XRAY_CONFIG_PATH, config);
  return restartXray();
}

async function getUsage(users) {
  const usage = Object.fromEntries(users.map((user) => [user.id, { uplink: 0, downlink: 0, total: 0, ips: 0 }]));
  try {
    const { stdout } = await execFileAsync(XRAY_BIN, ["api", "statsquery", `--server=${XRAY_API_SERVER}`, "-pattern", "user>>>"], { timeout: 8000 });
    const pattern = /name:\s*"user>>>(.*?)>>>traffic>>>(uplink|downlink)"\s*value:\s*(\d+)/g;
    for (const match of stdout.matchAll(pattern)) {
      const user = users.find((item) => userEmail(item) === match[1]);
      if (!user) continue;
      usage[user.id][match[2]] += Number(match[3]);
    }
  } catch {
    // Stats are unavailable until Xray has started with the API scaffold.
  }

  const ipCounts = await getIpCounts(users);
  for (const user of users) {
    const runtimeTotal = usage[user.id].uplink + usage[user.id].downlink;
    if (runtimeTotal < Number(user.lastRuntimeBytes || 0)) {
      user.usageOffsetBytes = Number(user.usageOffsetBytes || 0) + Number(user.lastRuntimeBytes || 0);
    }
    user.lastRuntimeBytes = runtimeTotal;
    user.usedBytes = Number(user.usageOffsetBytes || 0) + runtimeTotal;
    usage[user.id].total = user.usedBytes;
    usage[user.id].ips = ipCounts[user.id] || 0;
  }
  return usage;
}

async function getIpCounts(users) {
  const counts = Object.fromEntries(users.map((user) => [user.id, new Set()]));
  let text = "";
  try {
    const handle = await fs.open(XRAY_ACCESS_LOG, "r");
    const stat = await handle.stat();
    const size = Math.min(stat.size, 1024 * 1024 * 4);
    const buffer = Buffer.alloc(size);
    await handle.read(buffer, 0, size, Math.max(0, stat.size - size));
    await handle.close();
    text = buffer.toString("utf8");
  } catch {
    return Object.fromEntries(Object.keys(counts).map((id) => [id, 0]));
  }

  for (const user of users) {
    const email = userEmail(user).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const linePattern = new RegExp(`^.*${email}.*$`, "gim");
    for (const lineMatch of text.matchAll(linePattern)) {
      const ip = lineMatch[0].match(/\b(?:\d{1,3}\.){3}\d{1,3}\b/)?.[0];
      if (ip) counts[user.id].add(ip);
    }
  }

  return Object.fromEntries(Object.entries(counts).map(([id, set]) => [id, set.size]));
}

async function serializeUsers() {
  const db = await readDb();
  const usage = await getUsage(db.users);
  await saveDb(db);
  return db.users.map((user) => {
    const used = usage[user.id] || { total: 0, ips: 0 };
    const overData = user.dataLimitGb > 0 && used.total >= gbToBytes(user.dataLimitGb);
    const overIp = user.ipLimit > 0 && used.ips > user.ipLimit;
    return {
      ...user,
      email: userEmail(user),
      link: DOMAIN ? buildVlessLink(user) : "",
      expired: isExpired(user),
      overData,
      overIp,
      onlineIps: used.ips,
      usedBytes: used.total,
      activeInXray: user.enabled && !isExpired(user) && !overData && !overIp
    };
  });
}

function buildVlessLink(user) {
  const params = new URLSearchParams({
    type: "ws",
    encryption: "none",
    security: "tls",
    path: WS_PATH,
    host: DOMAIN,
    sni: DOMAIN,
    fp: "chrome",
    alpn: "http/1.1"
  });
  return `vless://${user.uuid}@${DOMAIN}:443?${params.toString()}#${encodeURIComponent(user.name)}`;
}

app.get("/api/session", requireAuth, async (_req, res) => {
  res.json({ domain: DOMAIN, wsPath: WS_PATH, authenticated: true });
});

app.get("/api/users", requireAuth, async (_req, res) => {
  res.json({ users: await serializeUsers() });
});

app.post("/api/users", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = normalizeUser(req.body || {});
  db.users.push(user);
  db.events.unshift({ at: new Date().toISOString(), message: `Created ${user.name}` });
  const restart = await syncXray(db);
  await saveDb(db);
  res.status(201).json({ user: (await serializeUsers()).find((item) => item.id === user.id), restart });
});

app.put("/api/users/:id", requireAuth, async (req, res) => {
  const db = await readDb();
  const index = db.users.findIndex((user) => user.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "User not found" });
  db.users[index] = normalizeUser(req.body || {}, db.users[index]);
  db.events.unshift({ at: new Date().toISOString(), message: `Updated ${db.users[index].name}` });
  const restart = await syncXray(db);
  await saveDb(db);
  res.json({ user: (await serializeUsers()).find((item) => item.id === req.params.id), restart });
});

app.delete("/api/users/:id", requireAuth, async (req, res) => {
  const db = await readDb();
  const user = db.users.find((item) => item.id === req.params.id);
  db.users = db.users.filter((item) => item.id !== req.params.id);
  db.events.unshift({ at: new Date().toISOString(), message: `Deleted ${user?.name || req.params.id}` });
  const restart = await syncXray(db);
  await saveDb(db);
  res.json({ ok: true, restart });
});

app.post("/api/sync", requireAuth, async (_req, res) => {
  const db = await readDb();
  const restart = await syncXray(db);
  await saveDb(db);
  res.json({ ok: true, restart });
});

app.get("/api/status", requireAuth, async (_req, res) => {
  const db = await readDb();
  const users = await serializeUsers();
  res.json({
    domain: DOMAIN,
    wsPath: WS_PATH,
    xrayConfigPath: XRAY_CONFIG_PATH,
    totalUsers: db.users.length,
    activeUsers: users.filter((user) => user.activeInXray).length,
    limitedUsers: users.filter((user) => user.expired || user.overData || user.overIp).length
  });
});

const dist = path.resolve("dist");
app.use(express.static(dist));
app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));

setInterval(async () => {
  try {
    const db = await readDb();
    await syncXray(db);
    await saveDb(db);
  } catch {
    // Keep the web process alive; manual sync/status will surface configuration problems.
  }
}, 60_000);

app.listen(PORT, "127.0.0.1", () => {
  console.log(`Xray Server Manager listening on http://127.0.0.1:${PORT}`);
});
