"use strict";
// Google Gemini (primary). All Gemini-specific request/response formats stay in this file.
const { ProviderError, postJson, num } = require("./shared");

const NAME = "gemini";
const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
// Models change often. Override with the GEMINI_MODEL environment variable, no code change needed.
const DEFAULT_MODEL = "gemini-3.1-flash-lite";

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

function defaultModel() {
  return process.env.GEMINI_MODEL || DEFAULT_MODEL;
}

// Gemini wants alternating user/model turns that start with a user turn.
function toContents(messages) {
  const out = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const role = m.role === "assistant" ? "model" : "user";
    const last = out[out.length - 1];
    if (last && last.role === role) {
      last.parts[0].text += "\n\n" + m.content;
    } else {
      out.push({ role, parts: [{ text: m.content }] });
    }
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out;
}

async function generate({ system, messages, model, options = {} }) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new ProviderError(NAME, "Provider is not configured", { code: "not_configured" });

  const useModel = model || defaultModel();
  const base = (process.env.GEMINI_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const url = base + "/models/" + encodeURIComponent(useModel) + ":generateContent";

  const sys = [system].concat(messages.filter((m) => m.role === "system").map((m) => m.content)).filter(Boolean).join("\n\n");
  const generationConfig = { maxOutputTokens: options.maxTokens || 2048 };
  if (typeof options.temperature === "number") generationConfig.temperature = options.temperature;

  const body = { contents: toContents(messages), generationConfig };
  if (sys) body.systemInstruction = { parts: [{ text: sys }] };

  const data = await postJson(NAME, url, {
    headers: { "x-goog-api-key": key },
    body,
    timeoutMs: num("AI_TIMEOUT_MS", 20000),
  });

  const cand = data && Array.isArray(data.candidates) ? data.candidates[0] : null;
  const parts = cand && cand.content && Array.isArray(cand.content.parts) ? cand.content.parts : [];
  const text = parts.map((p) => (typeof p.text === "string" ? p.text : "")).join("").trim();
  if (!text) {
    const blocked = data && data.promptFeedback && data.promptFeedback.blockReason;
    throw new ProviderError(NAME, blocked ? "Request blocked by provider" : "Provider returned no text", {
      code: blocked ? "blocked" : "empty_response",
      retryable: false,
    });
  }
  return { text, model: useModel };
}

module.exports = { name: NAME, isConfigured, generate };
