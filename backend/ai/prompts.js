"use strict";
// Task -> provider-neutral prompt. Providers only translate this into their own request format.

const BASE =
  "You are the AI assistant inside Universal AI Notebook, an app for notes, tasks, reminders and recordings. " +
  "Be clear, accurate and concise because the user reads on a phone. " +
  "Reply in the same language as the user. If you are not sure, say so instead of guessing.";

function build(task, { input, messages }) {
  switch (task) {
    case "chat":
      return { system: BASE, messages: messages || [{ role: "user", content: input }] };
    case "summarize":
      return {
        system:
          BASE +
          " Summarize the user's text. Keep key facts, names, numbers, dates and decisions. " +
          "Use a short paragraph or a few bullet points. If there are action items, list them at the end under 'Action items'.",
        messages: [{ role: "user", content: input }],
      };
    case "explain":
      return {
        system: BASE + " Explain the user's topic or text in simple terms. Add one short example when it helps.",
        messages: [{ role: "user", content: input }],
      };
    default:
      throw new Error("No prompt for task: " + task);
  }
}

module.exports = { build };
