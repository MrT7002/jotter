"use strict";
// Groq (secondary and fallback). OpenAI-compatible chat API. Groq-specific details stay in this file.
const { ProviderError, postJson, num, classify } = require("./shared");

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

// Speech to text with Whisper on Groq. Audio goes in as a Buffer; the text comes back normalized.
const STT_DEFAULT = "whisper-large-v3-turbo";
async function transcribe({ buffer, mime, language, model }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new ProviderError(NAME, "Provider is not configured", { code: "not_configured" });
  const useModel = model || process.env.GROQ_STT_MODEL || STT_DEFAULT;
  const base = (process.env.GROQ_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  const m = String(mime || "audio/webm").toLowerCase();
  const ext = /mp4|m4a|aac/.test(m) ? "m4a" : /ogg/.test(m) ? "ogg" : /wav/.test(m) ? "wav" : /mpeg|mp3/.test(m) ? "mp3" : "webm";
  const form = new FormData();
  form.append("file", new Blob([buffer], { type: m.split(";")[0] }), "audio." + ext);
  form.append("model", useModel);
  form.append("response_format", "json");
  if (language) form.append("language", language);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), num("TRANSCRIBE_TIMEOUT_MS", 90000));
  try {
    let res;
    try {
      res = await fetch(base + "/audio/transcriptions", { method: "POST", headers: { authorization: "Bearer " + key }, body: form, signal: controller.signal });
    } catch (err) {
      if (err && err.name === "AbortError") throw new ProviderError(NAME, "Provider timed out", { code: "timeout", retryable: true });
      throw new ProviderError(NAME, "Could not reach provider", { code: "network", retryable: true });
    }
    let data = null;
    try { data = JSON.parse(await res.text()); } catch { data = null; }
    if (!res.ok) {
      const c = classify(res.status);
      throw new ProviderError(NAME, "Provider returned HTTP " + res.status, { status: res.status, code: c.code, retryable: c.retryable });
    }
    const text = data && typeof data.text === "string" ? data.text.trim() : "";
    return { text, model: useModel };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { name: NAME, isConfigured, generate, transcribe };
