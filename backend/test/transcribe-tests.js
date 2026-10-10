"use strict";
// Run with: node test/transcribe-tests.js   (no keys, no internet: Groq is simulated locally)
const { test, before, after, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const http = require("http");

let groq, app, base, groqMode = "ok", seen = null;
function listen(handler) { const s = http.createServer(handler); return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s))); }

before(async () => {
  groq = await listen((req, res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks);
      seen = { url: req.url, auth: req.headers.authorization, type: req.headers["content-type"], text: body.toString("latin1") };
      if (groqMode === "fail") { res.writeHead(503, { "content-type": "application/json" }); return res.end("{}"); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ text: "  Today we discuss the drainage design.  " }));
    });
  });
  process.env.GROQ_BASE_URL = "http://127.0.0.1:" + groq.address().port + "/openai/v1";
  process.env.GROQ_API_KEY = "test-groq-key";
  process.env.APP_TOKEN = "tok123";
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  process.env.RATE_LIMIT_PER_MIN = "1000";
  app = require("../server").createServer();
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.address().port;
});
after(() => { app.close(); groq.close(); });
beforeEach(() => { groqMode = "ok"; seen = null; process.env.GROQ_API_KEY = "test-groq-key"; delete process.env.TRANSCRIBE_MAX_MB; delete process.env.TRANSCRIBE_RATE_PER_MIN; require("../lib/http").resetRateLimits(); });

const audio = Buffer.from("fake-webm-audio-bytes");
async function up(opts = {}) {
  const headers = Object.assign({ "content-type": "audio/webm;codecs=opus", "x-app-token": "tok123" }, opts.headers || {});
  const r = await fetch(base + (opts.path || "/api/transcribe"), { method: opts.method || "POST", headers, body: opts.method === "GET" ? undefined : (opts.body === undefined ? audio : opts.body) });
  return { status: r.status, json: await r.json().catch(() => null) };
}

test("audio is sent to Groq Whisper as multipart and the text comes back trimmed", async () => {
  const r = await up();
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.provider, "groq");
  assert.equal(r.json.text, "Today we discuss the drainage design.");
  assert.match(seen.url, /audio\/transcriptions$/);
  assert.equal(seen.auth, "Bearer test-groq-key");
  assert.match(seen.type, /^multipart\/form-data/);
  assert.match(seen.text, /whisper-large-v3-turbo/);
  assert.match(seen.text, /fake-webm-audio-bytes/);
});
test("the Groq key never appears in the response", async () => {
  const r = await up();
  assert.ok(!JSON.stringify(r.json).includes("test-groq-key"));
});
test("missing or wrong token -> 401 and Groq is not called", async () => {
  const r = await up({ headers: { "x-app-token": "nope" } });
  assert.equal(r.status, 401);
  assert.equal(seen, null);
});
test("a non-audio content type is refused with 415", async () => {
  const r = await up({ headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(r.status, 415);
  assert.equal(seen, null);
});
test("an empty recording -> 400", async () => {
  const r = await up({ body: Buffer.alloc(0) });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "invalid_request");
});
test("an upload over the size limit -> 413", async () => {
  process.env.TRANSCRIBE_MAX_MB = "0.00001";
  const r = await up({ body: Buffer.alloc(5000) });
  assert.equal(r.status, 413);
  assert.equal(seen, null);
});
test("GET is not allowed", async () => {
  const r = await up({ method: "GET", body: undefined });
  assert.equal(r.status, 405);
});
test("Groq down -> clean retryable 503, no crash", async () => {
  groqMode = "fail";
  const r = await up();
  assert.equal(r.status, 503);
  assert.equal(r.json.success, false);
  assert.equal(r.json.retryable, true);
  assert.equal(r.json.error, "Transcription temporarily unavailable");
});
test("no Groq key on the server -> clear, non-retryable message", async () => {
  delete process.env.GROQ_API_KEY;
  const r = await up();
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "not_configured");
  assert.equal(r.json.retryable, false);
});
test("too many uploads in a minute -> 429", async () => {
  process.env.TRANSCRIBE_RATE_PER_MIN = "2";
  assert.equal((await up()).status, 200);
  assert.equal((await up()).status, 200);
  const r = await up();
  assert.equal(r.status, 429);
  assert.equal(r.json.code, "rate_limited");
});
test("a language hint is passed through", async () => {
  const r = await up({ path: "/api/transcribe?lang=en" });
  assert.equal(r.status, 200);
  assert.match(seen.text, /name="language"[\s\S]*en/);
});
