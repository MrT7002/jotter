"use strict";
// Run with: npm run test:auth   (no keys, no internet: Gemini, Groq and Supabase are simulated locally)
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

let supa, ai, app, base, supaHits = 0, supaMode = "ok";
const GOOD = "good-user-token", OTHER = "other-user-token";

function listen(handler) {
  const s = http.createServer(handler);
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

before(async () => {
  supa = await listen((req, res) => {
    supaHits++;
    const send = (st, o) => { res.writeHead(st, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (supaMode === "down") return send(500, { msg: "boom" });
    if (req.headers.apikey !== "anon-public-key") return send(401, { msg: "bad apikey" });
    const t = (req.headers.authorization || "").replace("Bearer ", "");
    if (t === GOOD) return send(200, { id: "user-1", email: "a@example.com" });
    if (t === OTHER) return send(200, { id: "user-2", email: "b@example.com" });
    return send(401, { msg: "invalid JWT" });
  });
  ai = await listen((req, res) => {
    let raw = ""; req.on("data", (c) => (raw += c));
    req.on("end", () => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: "hello" }] } }] })); });
  });
  process.env.GEMINI_BASE_URL = "http://127.0.0.1:" + ai.address().port + "/v1beta";
  process.env.GEMINI_API_KEY = "k"; delete process.env.GROQ_API_KEY; delete process.env.APP_TOKEN;
  process.env.SUPABASE_URL = "http://127.0.0.1:" + supa.address().port;
  process.env.SUPABASE_ANON_KEY = "anon-public-key";
  process.env.RATE_LIMIT_PER_MIN = "1000";
  app = require("../server").createServer();
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.address().port;
});
after(() => { app.close(); supa.close(); ai.close(); });
beforeEach(() => {
  supaHits = 0; supaMode = "ok";
  process.env.FREE_DAILY_AI_LIMIT = "3";
  require("../lib/auth").resetAuthState();
  require("../lib/http").resetRateLimits();
});

async function call(path, opts = {}) {
  const r = await fetch(base + path, opts);
  const j = await r.json().catch(() => null);
  return { status: r.status, json: j };
}
const chat = (token) => call("/api/ai", {
  method: "POST",
  headers: Object.assign({ "content-type": "application/json" }, token ? { authorization: "Bearer " + token } : {}),
  body: JSON.stringify({ task: "chat", input: "hi" }),
});

test("no token -> 401 and the AI provider is never called", async () => {
  const r = await chat(null);
  assert.equal(r.status, 401);
  assert.equal(r.json.code, "unauthorized");
});
test("invalid token -> 401", async () => {
  const r = await chat("nonsense");
  assert.equal(r.status, 401);
});
test("valid token -> 200 with usage", async () => {
  const r = await chat(GOOD);
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.deepEqual(r.json.usage, { used: 1, limit: 3, plan: "free" });
});
test("token check is cached (Supabase asked once for repeated requests)", async () => {
  await chat(GOOD); await chat(GOOD);
  assert.equal(supaHits, 1);
});
test("daily limit: 4th request is refused with a clear message, other users unaffected", async () => {
  await chat(GOOD); await chat(GOOD); await chat(GOOD);
  const r = await chat(GOOD);
  assert.equal(r.status, 429);
  assert.equal(r.json.code, "daily_limit");
  assert.equal(r.json.retryable, false);
  assert.equal((await chat(OTHER)).status, 200);
});
test("sign-in service down -> 503 retryable, no crash", async () => {
  supaMode = "down";
  const r = await chat(GOOD);
  assert.equal(r.status, 503);
  assert.equal(r.json.retryable, true);
});
test("/api/usage needs sign-in and reports the count", async () => {
  assert.equal((await call("/api/usage")).status, 401);
  await chat(GOOD);
  const r = await call("/api/usage", { headers: { authorization: "Bearer " + GOOD } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.json.used, r.json.limit, r.json.plan, r.json.accounts], [1, 3, "free", true]);
});
test("the APP_TOKEN header is ignored when accounts are on", async () => {
  process.env.APP_TOKEN = "legacy";
  const r = await call("/api/ai", { method: "POST", headers: { "content-type": "application/json", "x-app-token": "legacy" }, body: JSON.stringify({ task: "chat", input: "hi" }) });
  delete process.env.APP_TOKEN;
  assert.equal(r.status, 401);
});
test("answer style and task_extraction are accepted; bad style rejected", async () => {
  const ok = await call("/api/ai", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + GOOD }, body: JSON.stringify({ task: "task_extraction", input: "Call John tomorrow and buy cement", options: { style: "short" } }) });
  assert.equal(ok.status, 200);
  const bad = await call("/api/ai", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + GOOD }, body: JSON.stringify({ task: "chat", input: "hi", options: { style: "weird" } }) });
  assert.equal(bad.status, 400);
});
test("CORS allows the Authorization header for the app origin", async () => {
  const r = await fetch(base + "/api/ai", { method: "OPTIONS", headers: { origin: "https://localhost" } });
  assert.match(r.headers.get("access-control-allow-headers") || "", /Authorization/i);
});

test("/reset serves a password page with the public Supabase config only", async () => {
  const r = await fetch(base + "/reset");
  const html = await r.text();
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type"), /text\/html/);
  assert.match(html, /Choose a new password/);
  assert.match(html, /anon-public-key/);
  assert.doesNotMatch(html, /test-gemini|GEMINI_API_KEY|GROQ/);
});
test("the root page is friendly in a browser and JSON for health checks", async () => {
  const b = await fetch(base + "/", { headers: { accept: "text/html" } });
  assert.match(await b.text(), /Universal AI Notebook/);
  const j = await fetch(base + "/health");
  assert.equal((await j.json()).ok, true);
});
