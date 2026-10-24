"use strict";
// GET /api/config: the public, client-safe settings the app needs to sign people in.
//
// Returned: the Supabase project URL and the anon / publishable key. Both are made to live inside
// client apps; Row Level Security (not secrecy) is what protects data.
// NEVER returned: provider API keys, the service-role / secret key, the app token, or anything else.
// If a service-role or secret key was pasted into SUPABASE_ANON_KEY by mistake, it is refused here.
const { sendJson } = require("../lib/http");

function looksSecret(key) {
  if (/^sb_secret_/i.test(key)) return true;
  const parts = String(key).split(".");
  if (parts.length === 3) {
    try {
      const body = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
      const payload = JSON.parse(body);
      if (payload && String(payload.role).toLowerCase() === "service_role") return true;
    } catch (_) { /* not a readable token: treat as a normal public key */ }
  }
  return false;
}

function safeUrl(url) {
  return /^https:\/\/[^\s/]+/i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/i.test(url);
}

function publicConfig(env) {
  env = env || process.env;
  const url = String(env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(env.SUPABASE_ANON_KEY || "").trim();
  if (!url || !key) return { auth: null, authRequired: false };
  if (looksSecret(key) || !safeUrl(url)) {
    console.error(JSON.stringify({ t: new Date().toISOString(), evt: "config", problem: "SUPABASE_ANON_KEY or SUPABASE_URL is not safe to share with the app" }));
    return { auth: null, authRequired: true, notice: "auth_misconfigured" };
  }
  return { auth: { url, key }, authRequired: true };
}

async function handleConfig(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, error: "Use GET", code: "method_not_allowed", retryable: false }, { Allow: "GET, OPTIONS" });
  }
  const cfg = publicConfig();
  return sendJson(res, 200, Object.assign({ success: true }, cfg), { "Cache-Control": "public, max-age=300" });
}

module.exports = { handleConfig, publicConfig, looksSecret };
