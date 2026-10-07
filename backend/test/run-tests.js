"use strict";
// Run with: npm test   (needs no API keys and no internet: Gemini and Groq are simulated locally)
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

const GEMINI_KEY = "test-gemini-secret-key";
const GROQ_KEY = "test-groq-secret-key";

// ---- fake providers ---------------------------------------------------------------------
const mock = {
  gemini: { mode: "ok", hits: 0, lastHeaders: null, lastBody: null, text: "Gemini says hi" },
  groq: { mode: "ok", hits: 0, lastHeaders: null, lastBody: null, text: "Groq says hi" },
};

function startMock(name, kind) {
  const s = http.createServer((req, res) => {
    const m = mock[name];
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      m.hits++;
      m.lastHeaders = req.headers;
      try { m.lastBody = JSON.parse(raw); } catch { m.lastBody = null; }
      const send = (status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };
      if (m.mode === "500") return send(500, { error: { message: "internal" } });
      if (m.mode === "429") return send(429, { error: { message: "quota exceeded" } });
      if (m.mode === "401") return send(401, { error: { message: "API key not valid" } });
      if (m.mode === "slow") return setTimeout(() => send(200, ok(kind, m.text)), 1500);
      if (m.mode === "empty") return send(200, kind === "gemini" ? { candidates: [] } : { choices: [{ message: { content: "" } }] });
      if (m.mode === "blocked") return send(200, { promptFeedback: { blockReason: "SAFETY" } });
      if (m.mode === "garbage") { res.writeHead(200); return res.end("<html>not json</html>"); }
      return send(200, ok(kind, m.text));
    });
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}
function ok(kind, text) {
  return kind === "gemini"
    ? { candidates: [{ content: { parts: [{ text }] } }] }
    : { choices: [{ message: { content: text } }] };
}

// ---- app under test ---------------------------------------------------------------------
let gServer, qServer, app, base;
const { resetRateLimits } = require("../lib/http");
const logs = [];
const origLog = console.log;

async function post(body, headers = {}, raw) {
  const res = await fetch(base + "/api/ai", {
    method: "POST",
    headers: Object.assign({ "content-type": "application/json" }, headers),
    body: raw !== undefined ? raw : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}

before(async () => {
  gServer = await startMock("gemini", "gemini");
  qServer = await startMock("groq", "groq");
  process.env.GEMINI_BASE_URL = "http://127.0.0.1:" + gServer.address().port + "/v1beta";
  process.env.GROQ_BASE_URL = "http://127.0.0.1:" + qServer.address().port + "/openai/v1";
  process.env.GEMINI_API_KEY = GEMINI_KEY;
  process.env.GROQ_API_KEY = GROQ_KEY;
  process.env.AI_TIMEOUT_MS = "400";
  process.env.RATE_LIMIT_PER_MIN = "1000";
  delete process.env.APP_TOKEN;
  console.log = (...a) => logs.push(a.join(" ")); // capture router logs to check them for leaks
  app = require("../server").createServer();
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.address().port;
});
after(() => {
  console.log = origLog;
  app.close(); gServer.close(); qServer.close();
});
beforeEach(() => {
  for (const k of ["gemini", "groq"]) Object.assign(mock[k], { mode: "ok", hits: 0 });
  process.env.GEMINI_API_KEY = GEMINI_KEY;
  process.env.GROQ_API_KEY = GROQ_KEY;
  delete process.env.APP_TOKEN;
  process.env.RATE_LIMIT_PER_MIN = "1000";
  process.env.AI_TIMEOUT_MS = "400";
  resetRateLimits();
});

const chat = { task: "chat", messages: [{ role: "user", content: "Hello, introduce yourself." }] };

// ---- routing: Gemini and Groq ------------------------------------------------------------
test("chat goes to Gemini first and only Gemini is called", async () => {
  const r = await post(chat);
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.success, r.json.provider, r.json.text], [true, "gemini", "Gemini says hi"]);
  assert.equal(r.json.fallback, undefined);
  assert.equal(mock.gemini.hits, 1);
  assert.equal(mock.groq.hits, 0);
});
test("Gemini request is built correctly (key in header, system prompt, user turn)", async () => {
  await post(chat);
  assert.equal(mock.gemini.lastHeaders["x-goog-api-key"], GEMINI_KEY);
  assert.equal(mock.gemini.lastBody.contents[0].role, "user");
  assert.match(mock.gemini.lastBody.systemInstruction.parts[0].text, /Universal AI Notebook/);
});
test("summarize goes to Gemini", async () => {
  const r = await post({ task: "summarize", input: "Concrete must be kept moist for seven days." });
  assert.equal(r.json.provider, "gemini");
  assert.equal(r.status, 200);
});
test("explain goes to Gemini", async () => {
  const r = await post({ task: "explain", input: "Concrete curing" });
  assert.equal(r.json.provider, "gemini");
});
test("chat with plain input works", async () => {
  const r = await post({ task: "chat", input: "Give me a short explanation of concrete curing." });
  assert.equal(r.status, 200);
  assert.equal(r.json.provider, "gemini");
});
test("fast hint sends the request to Groq first", async () => {
  const r = await post({ task: "chat", input: "quick one", options: { fast: true } });
  assert.deepEqual([r.json.provider, r.json.text], ["groq", "Groq says hi"]);
  assert.equal(mock.gemini.hits, 0);
  assert.equal(mock.groq.lastHeaders.authorization, "Bearer " + GROQ_KEY);
  assert.equal(mock.groq.lastBody.messages[0].role, "system");
});

// ---- fallback ----------------------------------------------------------------------------
for (const mode of ["500", "429", "401", "slow", "empty", "blocked", "garbage"]) {
  test("Gemini failure (" + mode + ") falls back to Groq", async () => {
    mock.gemini.mode = mode;
    const r = await post(chat);
    assert.equal(r.status, 200, r.text);
    assert.deepEqual([r.json.success, r.json.provider, r.json.fallback], [true, "groq", true]);
    assert.equal(mock.gemini.hits, 1);
    assert.equal(mock.groq.hits, 1);
  });
}
test("Groq failure falls back to Gemini (reverse direction)", async () => {
  mock.groq.mode = "500";
  const r = await post({ task: "chat", input: "quick", options: { fast: true } });
  assert.deepEqual([r.json.provider, r.json.fallback], ["gemini", true]);
});
test("both providers failing returns a clean retryable error", async () => {
  mock.gemini.mode = "500"; mock.groq.mode = "429";
  const r = await post(chat);
  assert.equal(r.status, 503);
  assert.deepEqual(r.json, { success: false, error: "AI temporarily unavailable", code: "all_providers_failed", retryable: true });
  assert.equal(mock.gemini.hits + mock.groq.hits, 2); // no endless retries
});
test("both providers timing out is handled without crashing", async () => {
  mock.gemini.mode = "slow"; mock.groq.mode = "slow";
  const r = await post(chat);
  assert.equal(r.status, 503);
  assert.equal(r.json.retryable, true);
});
test("both providers with bad keys is not retryable", async () => {
  mock.gemini.mode = "401"; mock.groq.mode = "401";
  const r = await post(chat);
  assert.equal(r.status, 503);
  assert.equal(r.json.retryable, false);
});

// ---- missing keys ------------------------------------------------------------------------
test("no keys at all: clear not-configured error", async () => {
  delete process.env.GEMINI_API_KEY; delete process.env.GROQ_API_KEY;
  const r = await post(chat);
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "no_provider");
  assert.equal(r.json.retryable, false);
});
test("only a Groq key: Groq answers, and it is not reported as a fallback", async () => {
  delete process.env.GEMINI_API_KEY;
  const r = await post(chat);
  assert.deepEqual([r.status, r.json.provider, r.json.fallback], [200, "groq", undefined]);
  assert.equal(mock.gemini.hits, 0);
});
test("only a Gemini key: failure returns the clean error (no Groq to fall back to)", async () => {
  delete process.env.GROQ_API_KEY; mock.gemini.mode = "500";
  const r = await post(chat);
  assert.equal(r.status, 503);
  assert.equal(r.json.error, "AI temporarily unavailable");
});
test("document/image tasks are not routed to Groq and are not available yet", async () => {
  const r = await post({ task: "image_analysis", input: "x" });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "unsupported_task");
  assert.equal(mock.groq.hits + mock.gemini.hits, 0);
});

// ---- validation --------------------------------------------------------------------------
const bad = [
  ["missing task", { input: "hi" }],
  ["unknown task", { task: "dance", input: "hi" }],
  ["chat without messages or input", { task: "chat" }],
  ["empty input", { task: "summarize", input: "   " }],
  ["input wrong type", { task: "summarize", input: 42 }],
  ["empty messages array", { task: "chat", messages: [] }],
  ["bad role", { task: "chat", messages: [{ role: "robot", content: "hi" }] }],
  ["empty content", { task: "chat", messages: [{ role: "user", content: "" }] }],
  ["last message from assistant", { task: "chat", messages: [{ role: "user", content: "a" }, { role: "assistant", content: "b" }] }],
  ["input too long", { task: "summarize", input: "x".repeat(30001) }],
  ["message too long", { task: "chat", messages: [{ role: "user", content: "x".repeat(8001) }] }],
  ["bad options", { task: "chat", input: "hi", options: { maxTokens: -5 } }],
  ["bad fast flag", { task: "chat", input: "hi", options: { fast: "yes" } }],
  ["array body", [1, 2]],
];
for (const [name, body] of bad) {
  test("validation: " + name + " -> 400 and no provider called", async () => {
    const r = await post(body);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json.success, false);
    assert.equal(r.json.retryable, false);
    assert.equal(typeof r.json.error, "string");
    assert.equal(mock.gemini.hits + mock.groq.hits, 0);
  });
}
test("validation: invalid JSON -> 400", async () => {
  const r = await post(null, {}, "{not json");
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "invalid_json");
});
test("validation: empty body -> 400", async () => {
  const r = await post(null, {}, "");
  assert.equal(r.status, 400);
});
test("validation: oversized body -> 413", async () => {
  const r = await post(null, {}, JSON.stringify({ task: "summarize", input: "x".repeat(1100000) }));
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "too_large");
});
test("a client-supplied model is ignored", async () => {
  await post({ task: "chat", input: "hi", model: "expensive-model-9000" });
  assert.equal(mock.gemini.lastBody && JSON.stringify(mock.gemini.lastBody).includes("expensive-model-9000"), false);
});
test("GET /api/ai is not allowed", async () => {
  const r = await fetch(base + "/api/ai");
  assert.equal(r.status, 405);
});
test("unknown route returns clean JSON 404", async () => {
  const r = await fetch(base + "/nope");
  assert.equal(r.status, 404);
  assert.equal((await r.json()).success, false);
});

// ---- security ----------------------------------------------------------------------------
test("APP_TOKEN: missing or wrong token is rejected, correct token works", async () => {
  process.env.APP_TOKEN = "s3cret-token";
  assert.equal((await post(chat)).status, 401);
  assert.equal((await post(chat, { "x-app-token": "wrong" })).status, 401);
  assert.equal((await post(chat, { "x-app-token": "s3cret-token" })).status, 200);
  assert.equal(mock.gemini.hits, 1);
});
test("rate limit returns 429 with Retry-After", async () => {
  process.env.RATE_LIMIT_PER_MIN = "3";
  for (let i = 0; i < 3; i++) assert.equal((await post(chat)).status, 200);
  const r = await post(chat);
  assert.equal(r.status, 429);
  assert.equal(r.json.retryable, true);
  assert.ok(Number(r.headers.get("retry-after")) >= 1);
});
test("CORS: Capacitor origin allowed, unknown origin not", async () => {
  const ok1 = await fetch(base + "/api/ai", { method: "OPTIONS", headers: { origin: "https://localhost", "access-control-request-method": "POST" } });
  assert.equal(ok1.status, 204);
  assert.equal(ok1.headers.get("access-control-allow-origin"), "https://localhost");
  const evil = await fetch(base + "/api/ai", { method: "OPTIONS", headers: { origin: "https://evil.example" } });
  assert.equal(evil.headers.get("access-control-allow-origin"), null);
});
test("API keys never appear in responses, /health or logs", async () => {
  mock.gemini.mode = "401";
  const a = await post(chat);
  const h = await (await fetch(base + "/health")).text();
  const bad401 = await post({ task: "chat" });
  const blob = [a.text, h, bad401.text, logs.join("\n")].join("\n");
  assert.equal(blob.includes(GEMINI_KEY), false);
  assert.equal(blob.includes(GROQ_KEY), false);
  assert.equal(blob.includes("Hello, introduce yourself."), false, "user content must not be logged");
  assert.equal(JSON.parse(h).providers.gemini, true);
});
test("router log lines contain metadata only", () => {
  const line = logs.find((l) => l.includes('"evt":"ai"'));
  assert.ok(line);
  assert.deepEqual(Object.keys(JSON.parse(line)).filter((k) => ["text", "input", "messages", "content"].includes(k)), []);
});
test("a new provider can be registered without changing the router", async () => {
  const { registerProvider, generate } = require("../ai/router");
  registerProvider("fake3", { name: "fake3", isConfigured: () => true, generate: async () => ({ text: "third", model: "m" }) }, { tasks: ["explain"], appendTo: ["explain"] });
  mock.gemini.mode = "500"; mock.groq.mode = "500";
  const r = await generate({ task: "explain", input: "x", options: {} });
  // MAX_ATTEMPTS is 2, so the third provider is never reached: no endless retries
  assert.equal(r.success, false);
  mock.gemini.mode = "ok";
  const ok2 = await generate({ task: "explain", input: "x", options: {} });
  assert.equal(ok2.provider, "gemini");
});
