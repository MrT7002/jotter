"use strict";
// What each provider can do, and which provider is preferred for each task.
// To add a provider later: create ai/providers/<name>.js, list it in ai/providers/index.js,
// then add its tasks below and put it into the ROUTES lists where it should be tried.

const KNOWN_TASKS = [
  "chat",
  "summarize",
  "explain",
  "document_analysis",
  "image_analysis",
  "transcription",
  "task_extraction",
  "search",
];

// Tasks the API accepts today. Add a task here once its prompt/handling exists.
const IMPLEMENTED_TASKS = ["chat", "summarize", "explain"];

// Plain text tasks that a "fast" hint may send to Groq first.
const TEXT_TASKS = new Set(["chat", "summarize", "explain", "task_extraction", "search"]);

const PROVIDER_CAPABILITIES = {
  gemini: { tasks: ["chat", "summarize", "explain", "document_analysis", "image_analysis", "task_extraction", "search"] },
  groq: { tasks: ["chat", "summarize", "explain", "task_extraction", "transcription"] },
};

// First entry is tried first. The next compatible entry is the fallback.
const ROUTES = {
  chat: ["gemini", "groq"],
  summarize: ["gemini", "groq"],
  explain: ["gemini", "groq"],
  document_analysis: ["gemini"],
  image_analysis: ["gemini"],
  transcription: ["groq"],
  task_extraction: ["gemini", "groq"],
  search: ["gemini", "groq"],
};

function supports(provider, task) {
  const cap = PROVIDER_CAPABILITIES[provider];
  return !!cap && cap.tasks.includes(task);
}

// Ordered list of providers that can handle this task, honoring the "fast" hint.
function candidates(task, options) {
  let order = (ROUTES[task] || []).slice();
  if (options && options.fast === true && TEXT_TASKS.has(task)) {
    order = ["groq", ...order.filter((p) => p !== "groq")];
  }
  return order.filter((p) => supports(p, task));
}

module.exports = { KNOWN_TASKS, IMPLEMENTED_TASKS, TEXT_TASKS, PROVIDER_CAPABILITIES, ROUTES, supports, candidates };
