# Universal AI Notebook: AI backend

The app never talks to Gemini or Groq directly. It talks only to this backend:

    App  ->  POST /api/ai  ->  AI router  ->  Gemini (primary)  ->  Groq (fallback)

The provider keys live only in this server's environment variables.

## Files

- `server.js`: HTTP server, CORS, `/health`.
- `routes/ai.js`: `POST /api/ai`: token check, rate limit, request validation, size limits.
- `ai/router.js`: picks ONE provider, tries a compatible fallback only after a failure.
- `ai/capabilities.js`: what each provider can do and the order they are tried in.
- `ai/prompts.js`: task prompts (chat, summarize, explain), provider-neutral.
- `ai/providers/gemini.js`, `groq.js`: the only places with provider-specific formats.
- `ai/providers/index.js`: provider registry (add OpenAI/DeepSeek here later).
- `ai/providers/shared.js`, `lib/http.js`: timeouts, errors, CORS, body limits, rate limiter.
- `test/run-tests.js`: 47 tests with fake providers (`npm test`). No real keys needed.

## Deploy from your phone (Render, free)

1. Get keys: Gemini at https://aistudio.google.com/ (Get API key), Groq at https://console.groq.com/keys
2. Push this `backend/` folder to your GitHub repo.
3. On https://render.com sign in with GitHub, then New > Web Service, pick the repo.
4. Set: Root Directory `backend`, Build Command `npm install`, Start Command `node server.js`, Instance Type Free.
5. Under Environment add `GEMINI_API_KEY`, `GROQ_API_KEY` and `APP_TOKEN` (any long random text you invent).
6. Deploy. Open `https://YOUR-SERVICE.onrender.com/health`. It should show both providers as true.
7. In the app: More > Profile > AI service. Paste the URL and the same APP_TOKEN, tap Test connection.

Free Render services sleep after 15 minutes without traffic, so the first request can take up to a minute.

## Request examples

    POST /api/ai   (header: x-app-token: YOUR_TOKEN)
    {"task":"chat","messages":[{"role":"user","content":"Explain concrete curing."}]}
    {"task":"summarize","input":"Text to summarize"}
    {"task":"explain","input":"Bearing capacity"}
    {"task":"chat","input":"Short answer please","options":{"fast":true}}   <- tries Groq first

Success: `{"success":true,"provider":"gemini","model":"...","text":"..."}`
Fallback: same plus `"fallback":true` and `"provider":"groq"`
Failure: `{"success":false,"error":"AI temporarily unavailable","retryable":true}`

## Changing models

Set `GEMINI_MODEL` or `GROQ_MODEL` in Render. No code change needed.

## Adding a provider later

Create `ai/providers/openai.js` with `isConfigured()` and `generate()`, add it to `ai/providers/index.js`,
then list its tasks in `ai/capabilities.js`. The router and API stay the same.

## Security notes

- `APP_TOKEN` is a gate, not a secret: it lives inside the app. It stops casual abuse, and the rate limiter protects your free quotas.
- Real user login can replace the `authenticate()` function in `routes/ai.js` later.
- Logs contain metadata only (task, provider, timing). Never keys or note content.
