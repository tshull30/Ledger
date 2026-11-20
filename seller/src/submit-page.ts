// Web pages for submitting research.
//  - loginPage:  you enter the ingest key once; your browser stays logged in for 30 days.
//  - submitPage: the report form. When logged in, it does NOT ask for the key,
//                so Grok Bot can fill it in and submit from your browser.

const style = `<style>
  body{font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px;color:#111}
  label{display:block;margin-top:14px;font-weight:600}
  input,textarea{width:100%;padding:8px;font:inherit;box-sizing:border-box}
  textarea{min-height:120px}
  small{color:#666;font-weight:400}
  button{margin-top:20px;padding:10px 18px;font:inherit;cursor:pointer}
  .ok{background:#eaf7ee;border:1px solid #9bd3ad;padding:8px 12px;border-radius:6px}
</style>`;

const head = (title: string) =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>${style}</head><body>`;

export function loginPage(error = "") {
  return `${head("Log in")}
<h1>Log in to submit research</h1>
<p>Enter the ingest key once. This browser stays logged in for 30 days, and the report form won't ask for it again.</p>
${error ? `<p style="color:#b00">${error}</p>` : ""}
<form method="post" action="/login">
  <label>Ingest key <input name="key" type="password" required autocomplete="current-password"></label>
  <button type="submit">Log in</button>
</form>
</body></html>`;
}

export function submitPage(loggedIn: boolean) {
  return `${head("Submit research report")}
<h1>Submit research report</h1>
${
  loggedIn
    ? `<p class="ok">Logged in. This browser can submit reports without a key. <a href="/logout">Log out</a></p>`
    : `<p>Not logged in. <a href="/login">Log in once</a> so this form doesn't need the key, or enter it below.</p>`
}
<form method="post" action="/submit">
  ${loggedIn ? "" : `<label>Access key <input name="key" type="password" required></label>`}
  <label>Topic <small>(short slug, e.g. fed-dec-decision)</small><input name="topic" required pattern="[a-z0-9-]{2,60}"></label>
  <label>Title <input name="title" required></label>
  <label>Gemini market symbol <small>(optional, e.g. GEMI-FED261211-HIKE25)</small><input name="market"></label>
  <label>Summary <small>(what people on X are saying, in 2-6 sentences)</small><textarea name="summary" required></textarea></label>
  <label>Sentiment <small>(-1 = very negative, 0 = neutral, 1 = very positive)</small><input name="sentiment" type="number" min="-1" max="1" step="0.05" required></label>
  <label>Confidence <small>(0 to 1)</small><input name="confidence" type="number" min="0" max="1" step="0.05" required></label>
  <label>Posts analyzed <input name="postsAnalyzed" type="number" min="0" required></label>
  <label>Source links <small>(X post URLs, one per line)</small><textarea name="sources"></textarea></label>
  <button type="submit">Submit report</button>
</form>
</body></html>`;
}
