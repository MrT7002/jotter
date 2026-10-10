"use strict";
// Task -> provider-neutral prompt. Providers only translate this into their own request format.

const BASE =
  "You are the AI assistant inside Universal AI Notebook, an app for notes, tasks, reminders and recordings. " +
  "Be clear, accurate and concise because the user reads on a phone. " +
  "Reply in the same language as the user. If you are not sure, say so instead of guessing. " +
  "Use simple Markdown when it helps: short headings, bullet lists, numbered lists, checklists (- [ ] item) and tables.";

const STYLE = {
  short: " Keep every answer very short: a few sentences at most.",
  detailed: " Give detailed, well-structured answers with steps or examples where useful.",
  balanced: "",
};

function build(task, { input, messages, options }) {
  const base = BASE + (STYLE[options && options.style] || "");
  switch (task) {
    case "chat":
      return { system: base, messages: messages || [{ role: "user", content: input }] };
    case "summarize":
      return {
        system:
          base +
          " Summarize the user's text. Keep key facts, names, numbers, dates and decisions. " +
          "Use a short paragraph or a few bullet points. If there are action items, list them at the end under 'Action items'.",
        messages: [{ role: "user", content: input }],
      };
    case "explain":
      return {
        system: base + " Explain the user's topic or text in simple terms. Add one short example when it helps.",
        messages: [{ role: "user", content: input }],
      };
    case "task_extraction":
      return {
        system:
          BASE +
          " Extract every action item or task from the user's text. Output ONLY a checklist, one task per line, " +
          "each line starting with '- [ ] ' and written as a short imperative sentence. " +
          "If there are no tasks, output exactly: NONE",
        messages: [{ role: "user", content: input }],
      };
    default:
      throw new Error("No prompt for task: " + task);
  }
}

module.exports = { build };
