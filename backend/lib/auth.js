"use strict";
// Account checks for the AI API. No dependencies.
// If SUPABASE_URL and SUPABASE_ANON_KEY are set, every AI request must carry the signed-in user's
// access token (Authorization: Bearer ...). We ask Supabase "who is this?" and cache the answer briefly.
// Usage counters are kept in memory (they reset when the server restarts). Move them to a database later.
const crypto = require("crypto");

const cache = new Map(); // sha256(token) -> { user, exp }
const usage = new Map(); // userId -> { day, n }

function enabled() {
  return !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
}

function bearer(req) {
  const h = req.headers.authorization;
  if (typeof h !== "string") return null;
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

// -> { ok:true, user:{id,email} } | { ok:false, status, code }
async function verifyToken(token) {
  if (!token) return { ok: false, status: 401, code: "unauthorized" };
  const key = crypto.createHash("sha256").update(token).digest("hex");
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return { ok: true, user: hit.user };

  const base = String(process.env.SUPABASE_URL).replace(/\/+$/, "");
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(base + "/auth/v1/user", {
      headers: { apikey: process.env.SUPABASE_ANON_KEY, Authorization: "Bearer " + token },
      signal: ctl.signal,
    });
    if (r.status === 401 || r.status === 403) return { ok: false, status: 401, code: "unauthorized" };
    if (!r.ok) return { ok: false, status: 503, code: "auth_unavailable" };
    const j = await r.json();
    if (!j || typeof j.id !== "string") return { ok: false, status: 401, code: "unauthorized" };
    const user = { id: j.id, email: typeof j.email === "string" ? j.email : "" };
    cache.set(key, { user, exp: Date.now() + 60000 });
    if (cache.size > 2000) for (const k of cache.keys()) { cache.delete(k); if (cache.size < 1500) break; }
    return { ok: true, user };
  } catch (e) {
    return { ok: false, status: 503, code: "auth_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
function dailyLimit() {
  const n = Number(process.env.FREE_DAILY_AI_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 30;
}
function getUsage(userId) {
  const u = usage.get(userId);
  const used = u && u.day === today() ? u.n : 0;
  return { used, limit: dailyLimit(), plan: "free" };
}
function addUsage(userId) {
  const u = usage.get(userId);
  if (u && u.day === today()) u.n++;
  else usage.set(userId, { day: today(), n: 1 });
  if (usage.size > 5000) for (const k of usage.keys()) { usage.delete(k); if (usage.size < 4000) break; }
  return getUsage(userId);
}
function resetAuthState() {
  cache.clear();
  usage.clear();
}

module.exports = { enabled, bearer, verifyToken, getUsage, addUsage, resetAuthState };
