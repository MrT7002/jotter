"use strict";
// GET /api/usage : how much AI the signed-in user has used today.
const auth = require("../lib/auth");
const { sendJson } = require("../lib/http");

async function handleUsage(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { success: false, error: "Use GET", code: "method_not_allowed", retryable: false }, { Allow: "GET, OPTIONS" });
  }
  if (!auth.enabled()) {
    return sendJson(res, 200, { success: true, accounts: false, plan: "free", used: 0, limit: null });
  }
  const v = await auth.verifyToken(auth.bearer(req));
  if (!v.ok) {
    return sendJson(res, v.status, { success: false, error: v.status === 503 ? "Sign-in service unavailable. Try again." : "Please sign in", code: v.code, retryable: v.status === 503 });
  }
  return sendJson(res, 200, Object.assign({ success: true, accounts: true }, auth.getUsage(v.user.id)));
}

module.exports = { handleUsage };
