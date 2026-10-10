"use strict";
// AI router: picks ONE provider first, falls back to the next compatible one only after a failure.
// It never calls two providers at the same time and never retries more than MAX_ATTEMPTS times.
const providers = require("./providers");
const capabilities = require("./capabilities");
const prompts = require("./prompts");

const MAX_ATTEMPTS = 2;

function log(event) {
  // Metadata only: never keys, never user content.
  console.log(JSON.stringify(Object.assign({ t: new Date().toISOString(), evt: "ai" }, event)));
}

// Optional runtime registration: registerProvider("openai", module, { tasks: [...], appendTo: ["chat"] })
function registerProvider(name, mod, { tasks = [], appendTo = [] } = {}) {
  providers[name] = mod;
  capabilities.PROVIDER_CAPABILITIES[name] = { tasks };
  for (const task of appendTo) {
    (capabilities.ROUTES[task] = capabilities.ROUTES[task] || []).push(name);
  }
}

async function generate(request) {
  const { task, input, messages, model, options = {} } = request;

  const names = capabilities
    .candidates(task, options)
    .filter((n) => providers[n] && providers[n].isConfigured());

  if (names.length === 0) {
    log({ task, ok: false, code: "no_provider" });
    return { success: false, error: "AI is not configured for this request", code: "no_provider", retryable: false };
  }

  const built = prompts.build(task, { input, messages, options });
  const errors = [];

  for (const name of names.slice(0, MAX_ATTEMPTS)) {
    const started = Date.now();
    try {
      const out = await providers[name].generate({
        task,
        system: built.system,
        messages: built.messages,
        model,
        options,
      });
      log({ task, provider: name, ok: true, fallback: errors.length > 0, ms: Date.now() - started });
      const result = { success: true, provider: name, model: out.model, text: out.text };
      if (errors.length > 0) result.fallback = true;
      return result;
    } catch (err) {
      const retryable = err && err.retryable !== undefined ? !!err.retryable : true;
      errors.push({ provider: name, code: (err && err.code) || "error", retryable });
      log({
        task,
        provider: name,
        ok: false,
        code: (err && err.code) || "error",
        status: (err && err.status) || 0,
        detail: (err && err.detail) || undefined,
        ms: Date.now() - started,
      });
    }
  }

  return {
    success: false,
    error: "AI temporarily unavailable",
    code: "all_providers_failed",
    retryable: errors.some((e) => e.retryable),
  };
}

module.exports = { generate, registerProvider };
