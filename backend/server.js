"use strict";
// Jotter AI backend. Zero dependencies: only Node's built-in modules (Node 20 or newer).
const http = require("http");
const { handleAi } = require("./routes/ai");
const { handleUsage } = require("./routes/usage");
const { handleTranscribe } = require("./routes/transcribe");
const pages = require("./routes/pages");
const { applyCors, sendJson } = require("./lib/http");
const providers = require("./ai/providers");

function createServer() {
  const server = http.createServer(async (req, res) => {
    try {
      applyCors(req, res);
      if (req.method === "OPTIONS") {
        res.writeHead(204);
        return res.end();
      }
      const path = (req.url || "/").split("?")[0];

      if (path === "/api/ai") return await handleAi(req, res);
      if (path === "/api/usage") return await handleUsage(req, res);
      if (path === "/api/transcribe") return await handleTranscribe(req, res);

      if (path === "/reset") return pages.sendHtml(res, 200, pages.resetPage());
      if (path === "/" && String(req.headers.accept || "").includes("text/html")) return pages.sendHtml(res, 200, pages.donePage());

      if (path === "/health" || path === "/") {
        const configured = {};
        for (const name of Object.keys(providers)) configured[name] = providers[name].isConfigured();
        return sendJson(res, 200, { ok: true, service: "jotter-ai-backend", providers: configured });
      }

      return sendJson(res, 404, { success: false, error: "Not found", code: "not_found", retryable: false });
    } catch (err) {
      console.error(JSON.stringify({ t: new Date().toISOString(), evt: "error", message: String(err && err.message).slice(0, 200) }));
      if (!res.headersSent) {
        return sendJson(res, 500, { success: false, error: "Server error", code: "server_error", retryable: true });
      }
      res.end();
    }
  });
  server.requestTimeout = 120000; // allows a long audio upload on a slow phone connection
  return server;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createServer().listen(port, "0.0.0.0", () => {
    const configured = Object.keys(providers).filter((n) => providers[n].isConfigured());
    console.log("Jotter AI backend listening on " + port + ". Providers configured: " + (configured.join(", ") || "none"));
  });
  process.on("unhandledRejection", (e) => console.error("unhandledRejection", String(e && e.message).slice(0, 200)));
}

module.exports = { createServer };
