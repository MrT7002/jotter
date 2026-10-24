"use strict";
// Run with: npm run test:config   (no keys and no internet needed)
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");

let app, base;
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = (role) => b64({ alg: "HS256", typ: "JWT" }) + "." + b64({ role, iss: "supabase" }) + ".signature";
const ANON = jwt("anon"), SERVICE = jwt("service_role");

before(async () => {
  process.env.GEMINI_API_KEY = "gemini-secret-AAAA"; process.env.GROQ_API_KEY = "groq-secret-BBBB"; process.env.APP_TOKEN = "app-token-CCCC";
  process.env.ALLOWED_ORIGINS = "https://localhost";
  app = require("../server").createServer();
  await new Promise((r) => app.listen(0, "127.0.0.1", r));
  base = "http://127.0.0.1:" + app.address().port;
});
after(() => app.close());

async function get(path, opts) { const r = await fetch(base + (path || "/api/config"), opts); const t = await r.text(); return { r, t, j: JSON.parse(t) }; }
function setEnv(url, key) { if (url == null) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = url; if (key == null) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = key; }

test("no Supabase variables: accounts are off and nothing is exposed", async () => {
  setEnv(null, null);
  const { j } = await get();
  assert.equal(j.success, true); assert.equal(j.auth, null); assert.equal(j.authRequired, false);
});

test("anon key and URL are returned, and nothing else", async () => {
  setEnv("https://abcd.supabase.co/", ANON);
  const { j, t } = await get();
  assert.deepEqual(j.auth, { url: "https://abcd.supabase.co", key: ANON });
  assert.equal(j.authRequired, true);
  for (const secret of ["gemini-secret-AAAA", "groq-secret-BBBB", "app-token-CCCC"]) assert.ok(!t.includes(secret), "leaked " + secret);
  assert.deepEqual(Object.keys(j).sort(), ["auth", "authRequired", "success"]);
});

test("new-style publishable key is allowed", async () => {
  setEnv("https://abcd.supabase.co", "sb_publishable_abc123");
  const { j } = await get();
  assert.equal(j.auth.key, "sb_publishable_abc123");
});

test("a service-role key pasted by mistake is refused and never sent", async () => {
  setEnv("https://abcd.supabase.co", SERVICE);
  const { j, t } = await get();
  assert.equal(j.auth, null); assert.equal(j.notice, "auth_misconfigured"); assert.ok(!t.includes(SERVICE));
});

test("a sb_secret_ key is refused and never sent", async () => {
  setEnv("https://abcd.supabase.co", "sb_secret_topsecret");
  const { j, t } = await get();
  assert.equal(j.auth, null); assert.ok(!t.includes("topsecret"));
});

test("a non-https Supabase URL is refused (except localhost for testing)", async () => {
  setEnv("http://example.com", ANON);
  assert.equal((await get()).j.auth, null);
  setEnv("http://127.0.0.1:5555", ANON);
  assert.ok((await get()).j.auth);
});

test("only GET is allowed", async () => {
  setEnv("https://abcd.supabase.co", ANON);
  const r = await fetch(base + "/api/config", { method: "POST", body: "{}" });
  assert.equal(r.status, 405);
});

test("CORS: the Android app origin is allowed, a stranger's page is not", async () => {
  const ok = await fetch(base + "/api/config", { headers: { Origin: "https://localhost" } });
  assert.equal(ok.headers.get("access-control-allow-origin"), "https://localhost");
  const bad = await fetch(base + "/api/config", { headers: { Origin: "https://evil.example" } });
  assert.notEqual(bad.headers.get("access-control-allow-origin"), "https://evil.example");
});

test("the existing health check still works", async () => {
  const { j } = await get("/health");
  assert.equal(j.ok, true);
});
