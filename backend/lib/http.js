"use strict";
// Small HTTP helpers shared by the server and routes. No dependencies.
const crypto = require("crypto");

const DEFAULT_ORIGINS = [
  "https://localhost", // Capacitor Android WebView
  "http://localhost",
  "capacitor://localhost",
  "ionic://localhost",
];

function allowedOrigins() {
  const extra = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return DEFAULT_ORIGINS.concat(extra);
}

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (!origin) return; // native apps and curl send no Origin
  res.setHeader("Vary", "Origin");
  if (allowedOrigins().includes(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
    res.setHeader("Access-Control-Max-Age", "600");
  }
}

function sendJson(res, status, payload, extraHeaders) {
  const body = JSON.stringify(payload);
  res.writeHead(status, Object.assign({
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  }, extraHeaders || {}));
  res.end(body);
}

class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Reads a JSON body with a hard size limit. Throws HttpError on problems.
function readJsonBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers["content-length"] || 0);
    if (declared > maxBytes) {
      req.resume();
      return reject(new HttpError(413, "too_large", "Request is too large"));
    }
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) {
        done = true;
        req.resume();
        return reject(new HttpError(413, "too_large", "Request is too large"));
      }
      chunks.push(c);
    });
    req.on("end", () => {
      if (done) return;
      done = true;
      try {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!text.trim()) return reject(new HttpError(400, "invalid_json", "Request body is empty"));
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, "invalid_json", "Request body must be valid JSON"));
      }
    });
    req.on("error", () => {
      if (done) return;
      done = true;
      reject(new HttpError(400, "bad_request", "Could not read the request"));
    });
  });
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function clientIp(req) {
  const fwd = req.headers["x-forwarded-for"];
  if (fwd) return String(fwd).split(",")[0].trim();
  return (req.socket && req.socket.remoteAddress) || "unknown";
}

// Simple in-memory sliding-window limiter, per key (IP). Enough to protect free provider quotas.
const hits = new Map();
function rateLimit(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) {
    hits.set(key, list);
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((windowMs - (now - list[0])) / 1000)) };
  }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  }
  return { ok: true };
}
function resetRateLimits() { hits.clear(); }

module.exports = { applyCors, sendJson, readJsonBody, safeEqual, clientIp, rateLimit, resetRateLimits, HttpError };
