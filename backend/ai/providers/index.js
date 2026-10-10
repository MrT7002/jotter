"use strict";
// Provider registry. To add a provider (OpenAI, DeepSeek, ...): create its module here,
// require it below, and list its tasks in ../capabilities.js. Nothing else changes.
module.exports = {
  gemini: require("./gemini"),
  groq: require("./groq"),
};
