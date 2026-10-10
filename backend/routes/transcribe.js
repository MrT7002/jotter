"use strict";
// POST /api/transcribe : raw audio in, text out (Groq Whisper). Same sign-in and limits as /api/ai.
const groq = require("../ai/providers/groq");
const { authenticate } = require("./ai");
const { sendJson, readRawBody, clientIp, rateLimit, HttpError } = require("../lib/http");
const auth = require("../lib/auth");

function maxBytes() {
  const mb = Number(process.env.TRANSCRIBE_MAX_MB);
  return Math.floor((Number.isFinite(mb) && mb > 0 ? mb : 24) * 1048576);
}

function typeOk(ct) {
  const t = String(ct || "").toLowerCase();
  return t.startsWith("audio/") || t.startsWith("video/webm") || t.startsWith("video/mp4") || t.startsWith("application/octet-stream");
}

async function handleTranscribe(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Use POST", code: "method_not_allowed", retryable: false }, { Allow: "POST, OPTIONS" });
  }
  const who = await authenticate(req);
  if (!who.ok) {
    const down = who.status === 503;
    return sendJson(res, who.status || 401, { success: false, error: down ? "Sign-in service unavailable. Try again." : "Please sign in", code: who.code || "unauthorized", retryable: down });
  }
  const perMin = Number(process.env.TRANSCRIBE_RATE_PER_MIN) > 0 ? Number(process.env.TRANSCRIBE_RATE_PER_MIN) : 6;
  const rl = rateLimit("tr:" + (who.user ? who.user.id : clientIp(req)), perMin, 60000);
  if (!rl.ok) {
    return sendJson(res, 429, { success: false, error: "Too many requests. Please wait a moment.", code: "rate_limited", retryable: true }, { "Retry-After": String(rl.retryAfterSec) });
  }
  if (!typeOk(req.headers["content-type"])) {
    req.resume();
    return sendJson(res, 415, { success: false, error: "Send an audio file", code: "unsupported_type", retryable: false });
  }
  if (who.user) {
    const u = auth.getUsage(who.user.id);
    if (u.used >= u.limit) {
      req.resume();
      return sendJson(res, 429, { success: false, error: "You have used today's free AI limit. It resets tomorrow.", code: "daily_limit", retryable: false, usage: u });
    }
  }
  let buffer;
  try {
    buffer = await readRawBody(req, maxBytes());
  } catch (err) {
    if (err instanceof HttpError) return sendJson(res, err.status, { success: false, error: err.message, code: err.code, retryable: false });
    return sendJson(res, 400, { success: false, error: "Bad request", code: "bad_request", retryable: false });
  }
  if (!buffer.length) return sendJson(res, 400, { success: false, error: "The recording is empty", code: "invalid_request", retryable: false });

  const url = new URL(req.url, "http://x");
  const lang = (url.searchParams.get("lang") || "").slice(0, 8);
  const language = /^[a-z]{2,3}$/i.test(lang) ? lang.toLowerCase() : "";
  const started = Date.now();
  try {
    const out = await groq.transcribe({ buffer, mime: req.headers["content-type"], language });
    console.log(JSON.stringify({ t: new Date().toISOString(), evt: "transcribe", provider: "groq", bytes: buffer.length, ms: Date.now() - started, ok: true }));
    if (!out.text) return sendJson(res, 200, { success: true, provider: "groq", model: out.model, text: "", empty: true });
    const result = { success: true, provider: "groq", model: out.model, text: out.text };
    if (who.user) result.usage = auth.addUsage(who.user.id);
    return sendJson(res, 200, result);
  } catch (err) {
    console.log(JSON.stringify({ t: new Date().toISOString(), evt: "transcribe", provider: "groq", bytes: buffer.length, ms: Date.now() - started, ok: false, code: err && err.code }));
    if (err && err.code === "not_configured") {
      return sendJson(res, 503, { success: false, error: "Transcription is not set up on the server", code: "not_configured", retryable: false });
    }
    return sendJson(res, 503, { success: false, error: "Transcription temporarily unavailable", code: "unavailable", retryable: true });
  }
}

module.exports = { handleTranscribe };
