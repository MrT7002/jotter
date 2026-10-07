"use strict";
// Groq (secondary and fallback). OpenAI-compatible chat API. Groq-specific details stay in this file.
const { ProviderError, postJson, num } = require("./shared");

const NAME = "groq";
const DEFAULT_BASE = "https://api.groq.com/openai/v1";
// Models change often. Override with the GROQ_MODEL environment variable, no code change needed.
const DEFAULT_MODEL = "openai/gpt-oss-20b";

function isConfigured() {
  return !!process.env.GROQ_API_KEY;
}

function defaultModel() {
  return process.env.GROQ_MODEL || DEFAULT_MODEL;
}

async function generate({ system, messages, model, options = {} }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new ProviderError(NAME, "Provider is not configured", { code: "not_configured" });

  const useModel = model || defaultModel();
  const base = (process.env.GROQ_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");

  const body = {
    model: useModel,
    messages: [{ role: "system", content: system }].concat(messages.map((m) => ({ role: m.role, content: m.content }))),
    max_completion_tokens: options.maxTokens || 1024,
  };
  if (typeof options.temperature === "number") body.temperature = options.temperature;
  // gpt-oss models "think" before answering; keep that short so the answer fits in the token budget.
  if (useModel.indexOf("gpt-oss") !== -1) body.reasoning_effort = "low";

  const data = await postJson(NAME, base + "/chat/completions", {
    headers: { authorization: "Bearer " + key },
    body,
    timeoutMs: num("AI_TIMEOUT_MS", 20000),
  });

  const choice = data && Array.isArray(data.choices) ? data.choices[0] : null;
  const text = choice && choice.message && typeof choice.message.content === "string" ? choice.message.content.trim() : "";
  if (!text) throw new ProviderError(NAME, "Provider returned no text", { code: "empty_response", retryable: false });
  return { text, model: useModel };
}

module.exports = { name: NAME, isConfigured, generate };
