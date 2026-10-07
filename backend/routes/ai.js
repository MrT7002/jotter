"use strict";
// POST /api/ai : authenticate, rate limit, validate, then hand the normalized request to the router.
const router = require("../ai/router");
const { KNOWN_TASKS, IMPLEMENTED_TASKS } = require("../ai/capabilities");
const { sendJson, readJsonBody, safeEqual, clientIp, rateLimit, HttpError } = require("../lib/http");

const LIMITS = {
  maxBodyBytes: 1000000,
  maxInputChars: 30000,
  maxMessages: 40,
  maxMessageChars: 8000,
  maxTokens: 4096,
};

function fail(status, code, error) {
  return { ok: false, status, body: { success: false, error, code, retryable: false } };
}

// Authentication hook. Today: optional shared token. Later: replace with real user auth.
function authenticate(req) {
  const expected = process.env.APP_TOKEN;
  if (!expected) return { ok: true };
  const given = req.headers["x-app-token"];
  if (typeof given === "string" && safeEqual(given, expected)) return { ok: true };
  return { ok: false };
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function validateOptions(raw) {
  if (raw === undefined || raw === null) return { ok: true, options: {} };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "options must be an object" };
  const options = {};
  if (raw.maxTokens !== undefined) {
    if (!Number.isInteger(raw.maxTokens) || raw.maxTokens < 1 || raw.maxTokens > LIMITS.maxTokens) {
      return { ok: false, error: "options.maxTokens must be a whole number from 1 to " + LIMITS.maxTokens };
    }
    options.maxTokens = raw.maxTokens;
  }
  if (raw.temperature !== undefined) {
    if (typeof raw.temperature !== "number" || raw.temperature < 0 || raw.temperature > 2) {
      return { ok: false, error: "options.temperature must be a number from 0 to 2" };
    }
    options.temperature = raw.temperature;
  }
  if (raw.fast !== undefined) {
    if (typeof raw.fast !== "boolean") return { ok: false, error: "options.fast must be true or false" };
    options.fast = raw.fast;
  }
  return { ok: true, options };
}

// Returns { ok: true, request } or { ok: false, status, body }.
function validate(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail(400, "invalid_request", "Request body must be a JSON object");
  }
  const { task } = body;
  if (!isNonEmptyString(task)) return fail(400, "invalid_request", "task is required");
  if (!KNOWN_TASKS.includes(task)) return fail(400, "unknown_task", "Unknown task");
  if (!IMPLEMENTED_TASKS.includes(task)) return fail(400, "unsupported_task", "This task is not available yet");

  const opts = validateOptions(body.options);
  if (!opts.ok) return fail(400, "invalid_request", opts.error);

  const request = { task, options: opts.options }; // a client-supplied "model" is ignored on purpose

  if (task === "chat") {
    let messages = body.messages;
    if (messages === undefined && body.input !== undefined) {
      if (!isNonEmptyString(body.input)) return fail(400, "invalid_request", "input must be a non-empty string");
      messages = [{ role: "user", content: body.input }];
    }
    if (!Array.isArray(messages) || messages.length === 0) {
      return fail(400, "invalid_request", "chat needs messages or input");
    }
    if (messages.length > LIMITS.maxMessages) return fail(400, "too_large", "Too many messages");
    let total = 0;
    const clean = [];
    for (const m of messages) {
      if (!m || typeof m !== "object") return fail(400, "invalid_request", "Each message must be an object");
      if (!["user", "assistant", "system"].includes(m.role)) return fail(400, "invalid_request", "Message role must be user, assistant or system");
      if (!isNonEmptyString(m.content)) return fail(400, "invalid_request", "Message content must be a non-empty string");
      if (m.content.length > LIMITS.maxMessageChars) return fail(400, "too_large", "A message is too long");
      total += m.content.length;
      clean.push({ role: m.role, content: m.content.trim() });
    }
    if (total > LIMITS.maxInputChars) return fail(400, "too_large", "Conversation is too long");
    if (clean[clean.length - 1].role !== "user") return fail(400, "invalid_request", "The last message must be from the user");
    request.messages = clean;
    return { ok: true, request };
  }

  // summarize, explain
  if (!isNonEmptyString(body.input)) return fail(400, "invalid_request", "input is required");
  if (body.input.length > LIMITS.maxInputChars) return fail(400, "too_large", "input is too long");
  request.input = body.input.trim();
  return { ok: true, request };
}

async function handleAi(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { success: false, error: "Use POST", code: "method_not_allowed", retryable: false }, { Allow: "POST, OPTIONS" });
  }

  if (!authenticate(req).ok) {
    return sendJson(res, 401, { success: false, error: "Unauthorized", code: "unauthorized", retryable: false });
  }

  const max = Number(process.env.RATE_LIMIT_PER_MIN) > 0 ? Number(process.env.RATE_LIMIT_PER_MIN) : 30;
  const rl = rateLimit(clientIp(req), max, 60000);
  if (!rl.ok) {
    return sendJson(
      res,
      429,
      { success: false, error: "Too many requests. Please wait a moment.", code: "rate_limited", retryable: true },
      { "Retry-After": String(rl.retryAfterSec) }
    );
  }

  let body;
  try {
    body = await readJsonBody(req, LIMITS.maxBodyBytes);
  } catch (err) {
    if (err instanceof HttpError) {
      return sendJson(res, err.status, { success: false, error: err.message, code: err.code, retryable: false });
    }
    return sendJson(res, 400, { success: false, error: "Bad request", code: "bad_request", retryable: false });
  }

  const v = validate(body);
  if (!v.ok) return sendJson(res, v.status, v.body);

  const result = await router.generate(v.request);
  return sendJson(res, result.success ? 200 : 503, result);
}

module.exports = { handleAi, validate, LIMITS };
