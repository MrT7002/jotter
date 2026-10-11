"use strict";
// Two tiny web pages for the email links that Supabase sends:
//   GET /reset      : "choose a new password" page (password reset emails)
//   GET /  (HTML)   : friendly "all set" page (email confirmation links land on the Site URL)
// They only contain PUBLIC values (Supabase project URL and anon key). No secrets.
const auth = require("../lib/auth");

const STYLE =
  "body{font-family:system-ui,sans-serif;background:#F5F7FC;color:#0E1736;margin:0;display:grid;place-items:center;min-height:100vh;padding:20px}" +
  ".c{background:#fff;border-radius:20px;padding:26px;max-width:380px;width:100%;box-shadow:0 8px 30px rgba(20,35,90,.1)}" +
  "h1{font-size:1.3rem;margin:0 0 8px}p{color:#6A7597;margin:0 0 14px}input{width:100%;box-sizing:border-box;padding:13px;border:1px solid #E2E8F5;border-radius:12px;font-size:1rem;margin-bottom:10px}" +
  "button{width:100%;padding:14px;border:0;border-radius:14px;background:linear-gradient(135deg,#3B63F5,#7C4DFF);color:#fff;font-weight:700;font-size:1rem}" +
  ".e{color:#E5484D}.o{color:#12B76A}";

function page(title, body, script) {
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + title +
    "</title><style>" + STYLE + "</style></head><body><div class=\"c\">" + body + "</div>" + (script ? "<script>" + script + "</script>" : "") + "</body></html>";
}

function sendHtml(res, status, html) {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  res.end(html);
}

function donePage() {
  // Email confirmation links land here (Supabase Site URL). The link puts a token in the address
  // after the "#"; this page shows a friendly message and then removes the token from the address bar.
  const script =
    "var h=new URLSearchParams(location.hash.slice(1)),t=document.getElementById('t'),m=document.getElementById('m');" +
    "if(h.get('error_description')){t.textContent='Link problem';m.textContent=h.get('error_description').replace(/\\+/g,' ')+' Open the app and ask for a new link.';m.className='e';}" +
    "else if(h.get('access_token')){t.textContent='Email confirmed';m.textContent='Your email is confirmed. Open the Universal AI Notebook app and sign in.';m.className='o';}" +
    "history.replaceState(null,'',location.pathname);";
  return page("Universal AI Notebook", '<h1 id="t">Universal AI Notebook</h1><p id="m">The server is running.</p>', script);
}

function resetPage() {
  if (!auth.enabled()) return page("Not available", "<h1>Not available</h1><p>Accounts are not set up on this server yet.</p>");
  const cfg = JSON.stringify({ url: String(process.env.SUPABASE_URL).replace(/\/+$/, ""), key: process.env.SUPABASE_ANON_KEY }).replace(/</g, "\\u003c");
  const script =
    "var C=" + cfg + ";var h=new URLSearchParams(location.hash.slice(1)),t=h.get('access_token'),m=document.getElementById('m');" +
    "if(!t||h.get('type')!=='recovery'){document.getElementById('f').style.display='none';m.className='e';m.textContent=h.get('error_description')||'This reset link is not valid or has expired. Request a new one in the app.';}" +
    "document.getElementById('b').onclick=function(){var a=document.getElementById('p1').value,b=document.getElementById('p2').value;m.className='e';" +
    "if(a.length<6){m.textContent='Use at least 6 characters.';return}if(a!==b){m.textContent='The two passwords do not match.';return}" +
    "this.disabled=true;fetch(C.url+'/auth/v1/user',{method:'PUT',headers:{apikey:C.key,Authorization:'Bearer '+t,'Content-Type':'application/json'},body:JSON.stringify({password:a})})" +
    ".then(function(r){if(!r.ok)throw 0;document.getElementById('f').style.display='none';m.className='o';m.textContent='Password changed. Go back to the app and sign in.'})" +
    ".catch(function(){m.textContent='Could not change the password. Request a new link and try again.';document.getElementById('b').disabled=false})};";
  return page(
    "Choose a new password",
    "<h1>Choose a new password</h1><div id=\"f\"><p>Enter a new password for your Universal AI Notebook account.</p><input id=\"p1\" type=\"password\" placeholder=\"New password\" autocomplete=\"new-password\"><input id=\"p2\" type=\"password\" placeholder=\"Repeat password\" autocomplete=\"new-password\"><button id=\"b\">Change password</button></div><p id=\"m\"></p>",
    script
  );
}

module.exports = { sendHtml, donePage, resetPage };
