/*
 * Universal AI Notebook: central, PUBLIC app configuration.
 *
 * Everything in this file ships inside the app and can be read by anyone.
 * NEVER put secret keys here: no Supabase service-role / secret key, no Gemini or Groq keys,
 * no Paystack secret key, no app token. Those live only in Render's Environment.
 */
window.JOTTER_CONFIG = {
  // The one thing the app must know: where your backend lives.
  apiUrl: "https://jotter-z4rx.onrender.com",

  // Supabase sign-in settings. Leave these EMPTY and the app asks your backend for them
  // (GET /api/config), which reads SUPABASE_URL and SUPABASE_ANON_KEY from Render.
  // Only fill them in if you want to fix them in the app instead. Use the public anon /
  // publishable key only.
  supabaseUrl: "",
  supabaseAnonKey: "",

  // false = ordinary users never see backend or Supabase settings. Set to true only to bring
  // back the old Developer section while debugging.
  showDeveloper: false
};
