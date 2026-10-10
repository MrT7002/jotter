"use strict";
// Helpers shared by provider modules: one error type and one HTTP call with a timeout.

class ProviderError extends Error {
  constructor(provider, message, { status = 0, code = "provider_error", retryable = false, detail = "" } = {}) {
    super(message);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.retryable = retryable;
    this.detail = detail; // for server logs only, never sent to the app
  }
}

function num(name, fallback) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
}

function classify(status) {
  if (status === 429) return { code: "rate_limited", retryable: true };
  if (status === 408 || status >= 500) return { code: "unavailable", retryable: true };
  if (status === 401 || status === 403) return { code: "auth", retryable: false };
  if (status === 404) return { code: "model_not_found", retryable: false };
  return { code: "bad_request", retryable: false };
}

async function postJson(provider, url, { headers = {}, body, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, headers),
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new ProviderError(provider, "Provider timed out", { code: "timeout", retryable: true });
      }
      throw new ProviderError(provider, "Could not reach provider", { code: "network", retryable: true });
    }
    let data = null;
    try {
      const text = await res.text();
      data = text ? JSON.parse(text) : null;
    } catch (err) {
      if (err && err.name === "AbortError") {
        throw new ProviderError(provider, "Provider timed out", { code: "timeout", retryable: true });
      }
      data = null;
    }
    if (!res.ok) {
      const c = classify(res.status);
      const detail = data && data.error && typeof data.error.message === "string" ? data.error.message.slice(0, 200) : "";
      throw new ProviderError(provider, "Provider returned HTTP " + res.status, {
        status: res.status,
        code: c.code,
        retryable: c.retryable,
        detail,
      });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { ProviderError, postJson, num, classify };
