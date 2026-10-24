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
- `routes/usage.js`, `lib/auth.js`: sign-in check (Supabase) and the daily AI limit per user.
- `routes/transcribe.js`: `POST /api/transcribe`, audio in and text out (Groq Whisper).
- `routes/pages.js`: small web pages for email confirmation and password reset links.
- `test/`: 70 tests with fake providers and a fake Supabase (`npm test`). No real keys needed.

## Deploy from your phone (Render, free)

1. Get keys: Gemini at https://aistudio.google.com/ (Get API key), Groq at https://console.groq.com/keys
2. Push this `backend/` folder to your GitHub repo.
3. On https://render.com sign in with GitHub, then New > Web Service, pick the repo.
4. Set: Root Directory `backend`, Build Command `npm install`, Start Command `node server.js`, Instance Type Free.
5. Under Environment add `GEMINI_API_KEY` and `GROQ_API_KEY`. (`APP_TOKEN` is only for testing without accounts; see below.)
6. Deploy. Open `https://YOUR-SERVICE.onrender.com/health`. It should show both providers as true.
7. Put your Render address in `www/config.js` (`apiUrl`). Users never type it. In the app, More > Settings shows a Connection status with a Retry button.

## Accounts (Supabase, free)

Without this the app works with a shared token. With it, every person signs in and gets their own daily AI limit.

1. Create a project at https://supabase.com (free). Wait until it is ready.
2. Project Settings > API: copy the Project URL and the `anon public` key. The anon key is public, not a secret.
3. Authentication > Sign In / Providers: Email is on by default. While testing you may turn off "Confirm email".
4. Authentication > URL Configuration: set Site URL to your Render address.
5. In Render > Environment add `SUPABASE_URL` and `SUPABASE_ANON_KEY` (optional: `FREE_DAILY_AI_LIMIT`, default 30). Redeploy.
6. Open `https://YOUR-SERVICE.onrender.com/api/config`. It must show `"success":true` and your Supabase URL and anon key. The app reads these automatically, so nothing is typed in the app and no Supabase key is stored in the app's code. Use only the public anon / publishable key, never the service_role or secret key. The backend refuses to share a secret key if one is pasted by mistake.

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

- `APP_TOKEN` is not used by the app any more. Anything shipped inside an app can be read by anyone, so it can never be a real secret. With Supabase configured, every AI request needs a signed-in user instead. You can delete `APP_TOKEN` from Render.
- `GET /api/config` returns only the Supabase URL and the public anon key. The app never calls the database directly; it only uses Supabase sign-in. Keep Row Level Security on for any table you add (Supabase > Advisors shows tables that are missing it).
- Real user login can replace the `authenticate()` function in `routes/ai.js` later.
- Logs contain metadata only (task, provider, timing). Never keys or note content.
