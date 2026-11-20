// The dashboard web page (one self-contained HTML document).
//
// Design idea: the agent lives on an allowance set by a rulebook. So the page leads with
// one thing, today's allowance, drawn as a single bar: spent, waiting for you (hatched),
// left, with the approval threshold marked. Everything else is a plain ledger.
// Hatching always means "waiting for you", on the bar and on the approval panel.
export function dashboardPage(token: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="dashboard-token" content="${token}">
<title>Leash</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E%3Crect x=%221%22 y=%225%22 width=%2214%22 height=%226%22 rx=%221%22 fill=%22%23233f35%22/%3E%3C/svg%3E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,400;12..96,600;12..96,700&family=Instrument+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root {
  color-scheme: light;
  --paper: #e7ece5;      /* banknote paper */
  --sheet: #f3f6f1;      /* raised surface */
  --ink: #18221e;        /* green-black ink */
  --ink-2: #4a5852;
  --ink-3: #75817b;
  --rule: #c6cfc4;
  --spent: #233f35;      /* deep note green */
  --wait: #b8860b;       /* amber: waiting for you */
  --left: #d5ddd2;
  --claude: #1d5f8a;
  --market: #a86a12;
  --stop: #a3352b;
  --go: #2c7a3f;
  --display: "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --body: "Instrument Sans", ui-sans-serif, system-ui, sans-serif;
}
@media (prefers-color-scheme: dark) {
  :root {
    color-scheme: dark;
    --paper: #121815; --sheet: #19211d; --ink: #e6ece6; --ink-2: #aab6ae; --ink-3: #7d8a82;
    --rule: #2c3832; --spent: #7fb59a; --left: #26312b; --wait: #d9a52c;
    --claude: #5aa2d6; --market: #d39032; --stop: #e0685c; --go: #5cb874;
  }
}
* { box-sizing: border-box; }
html { background: var(--paper); }
body { margin: 0; color: var(--ink); font: 15px/1.5 var(--body); font-variant-numeric: tabular-nums; }
a { color: inherit; text-underline-offset: 3px; text-decoration-color: var(--ink-3); }
button { font: inherit; }
:focus-visible { outline: 2px solid var(--claude); outline-offset: 2px; }
.page { max-width: 1120px; margin: 0 auto; padding: 28px 24px 64px; }

/* Masthead */
.top { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.mark { font: 700 22px/1 var(--display); letter-spacing: -0.02em; margin: 0; }
.mode { color: var(--ink-2); }
.top .grow { flex: 1; }
.quiet { color: var(--ink-3); font-size: 13px; }
.btn { border-radius: 6px; padding: 8px 14px; cursor: pointer; font-weight: 600; border: 1.5px solid var(--ink); background: transparent; color: var(--ink); }
.btn:disabled { opacity: .5; cursor: progress; }
.btn.solid { background: var(--ink); color: var(--paper); }
.btn.stop { border-color: var(--stop); color: var(--stop); }

/* Paused state */
.paused { display: none; margin-top: 20px; padding: 14px 18px; border-radius: 6px; background: var(--stop); color: #fff; align-items: center; gap: 16px; flex-wrap: wrap; }
.paused.on { display: flex; }
.paused p { margin: 0; flex: 1; min-width: 240px; }
.paused .btn { border-color: #fff; color: #fff; }

/* The allowance: the one big thing */
.allowance { margin: 34px 0 10px; }
.allowance h1 { font: 600 15px/1.3 var(--body); color: var(--ink-2); margin: 0 0 6px; }
.big { font: 700 clamp(44px, 7vw, 76px)/0.95 var(--display); letter-spacing: -0.035em; margin: 0; }
.big small { font: 500 0.32em var(--body); letter-spacing: 0; color: var(--ink-2); margin-left: 10px; }
.track { position: relative; height: 34px; margin: 22px 0 10px; display: flex; border-radius: 4px; overflow: hidden; background: var(--left); }
.track > span { height: 100%; transition: width .4s ease; }
.seg-spent { background: var(--spent); }
.seg-wait { background: repeating-linear-gradient(-45deg, var(--wait) 0 6px, color-mix(in srgb, var(--wait) 45%, var(--left)) 6px 12px); }
.threshold { position: absolute; top: -6px; bottom: -6px; width: 2px; background: var(--ink); }
.key { display: flex; gap: 28px; flex-wrap: wrap; font-size: 14px; color: var(--ink-2); }
.key b { color: var(--ink); font-weight: 600; }
.sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; margin-right: 7px; vertical-align: -1px; }

/* Approval */
.ask { display: none; margin: 30px 0 0; background: var(--sheet); border-radius: 8px; overflow: hidden; }
.ask.on { display: block; }
.ask-row { display: grid; grid-template-columns: 10px 1fr auto; align-items: stretch; border-top: 1px solid var(--rule); }
.ask-row:first-child { border-top: 0; }
.ask-row .hatch { background: repeating-linear-gradient(-45deg, var(--wait) 0 5px, transparent 5px 10px); }
.ask-body { padding: 16px 20px; }
.ask-body h2 { font: 600 19px/1.3 var(--display); margin: 0 0 4px; letter-spacing: -0.01em; }
.ask-body p { margin: 0; color: var(--ink-2); max-width: 70ch; }
.ask-actions { display: flex; gap: 10px; align-items: center; padding: 16px 20px; }


/* Market finder */
.finder { margin-top: 44px; }
.search { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; margin: 12px 0 6px; }
.search input[type=search] { flex: 1; min-width: 220px; font: inherit; padding: 9px 12px; border-radius: 6px; border: 1.5px solid var(--rule); background: var(--sheet); color: var(--ink); }
.search select { font: inherit; padding: 9px 10px; border-radius: 6px; border: 1.5px solid var(--rule); background: var(--sheet); color: var(--ink); }
.search label { font-size: 14px; color: var(--ink-2); display: flex; gap: 6px; align-items: center; }
.results { list-style: none; margin: 8px 0 0; padding: 0; }
.mkt { border-bottom: 1px solid var(--rule); }
.mkt-row { display: grid; grid-template-columns: minmax(0, 1fr) 6.5em 6.5em 18em; gap: 14px; align-items: center; padding: 11px 0; }
.mkt-row .t { font-weight: 500; }
.mkt-row .s { display: block; color: var(--ink-3); font-size: 13px; }
.mkt-row .px { font-size: 14px; text-align: right; }
.mkt-row .px span { display: block; color: var(--ink-3); font-size: 12px; }
.mkt-row .acts { display: flex; gap: 8px; justify-content: flex-end; }
.mkt-row .btn { padding: 6px 12px; font-size: 14px; }
.watching { color: var(--go); font-weight: 600; font-size: 14px; align-self: center; }
.verdict-box { margin: 0 0 14px; padding: 14px 16px; background: var(--sheet); border-radius: 8px; max-width: 80ch; }
.verdict-box h4 { font: 600 17px/1.35 var(--display); margin: 0 0 6px; letter-spacing: -0.01em; }
.verdict-box p { margin: 0 0 6px; color: var(--ink-2); font-size: 14px; }
.verdict-box .cmp { display: flex; gap: 22px; margin: 4px 0 10px; font-size: 14px; }
.verdict-box .cmp b { font: 700 22px/1 var(--display); display: block; }
.verdict-box .cmp .c b { color: var(--claude); } .verdict-box .cmp .m b { color: var(--market); }
@media (max-width: 560px) { .mkt-row { grid-template-columns: minmax(0, 1fr) auto; } .mkt-row .px { text-align: left; } .mkt-row .acts { grid-column: 1 / -1; justify-content: flex-start; } }

/* Lower half */
.cols { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(0, 1fr); gap: 48px; margin-top: 46px; }
@media (max-width: 900px) { .cols { grid-template-columns: 1fr; gap: 36px; } }
h3 { font: 600 20px/1.2 var(--display); letter-spacing: -0.015em; margin: 0 0 4px; }
.lede { margin: 0 0 16px; color: var(--ink-2); font-size: 14px; max-width: 60ch; }
section + section { margin-top: 40px; }

/* Charts */
.market { margin-bottom: 30px; }
.market h4 { font: 600 15px/1.35 var(--body); margin: 0; }
.chart { position: relative; height: 200px; margin-top: 8px; }
.chart svg { display: block; width: 100%; height: 100%; overflow: visible; }
.chart text { font: 12px var(--body); fill: var(--ink-3); }
.tip { position: absolute; top: 4px; pointer-events: none; background: var(--sheet); border: 1px solid var(--rule); border-radius: 6px; padding: 8px 10px; font-size: 13px; display: none; min-width: 150px; }
.tip div { display: flex; gap: 8px; align-items: center; }
.tip b { margin-left: auto; }

/* Ledger */
.ledger { width: 100%; border-collapse: collapse; }
.ledger td { padding: 10px 0; border-bottom: 1px solid var(--rule); vertical-align: baseline; }
.ledger td:last-child { text-align: right; font-weight: 600; white-space: nowrap; padding-left: 16px; }
.ledger .sub { display: block; color: var(--ink-3); font-size: 13px; }
.plus { color: var(--go); }

.feed { list-style: none; margin: 0; padding: 0; }
.feed li { display: grid; grid-template-columns: 4.6em 1fr; gap: 10px; padding: 9px 0; border-bottom: 1px solid var(--rule); font-size: 14px; }
.feed .t { color: var(--ink-3); font-size: 13px; }
.feed .blk { display: block; color: var(--ink-3); font-size: 12px; }
.feed li.needs { box-shadow: inset 3px 0 0 var(--wait); padding-left: 10px; }
.feed li.fresh { animation: land 1.6s ease-out; }
@keyframes land { from { background: color-mix(in srgb, var(--wait) 22%, transparent); } to { background: transparent; } }
@media (prefers-reduced-motion: reduce) { .feed li.fresh { animation: none; } }
.log { list-style: none; margin: 0; padding: 0; }
.log li { display: grid; grid-template-columns: 2.4em 1fr auto; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--rule); font-size: 14px; }
.log .n { color: var(--ink-3); }
.log .why { display: block; color: var(--ink-2); font-size: 13px; }
.state { font-weight: 600; white-space: nowrap; }
.state.wait { color: var(--wait); } .state.ok { color: var(--go); } .state.no { color: var(--stop); } .state.dim { color: var(--ink-3); font-weight: 500; }

/* Calls (decisions) */
.calls { list-style: none; margin: 0; padding: 0; }
.call { border-bottom: 1px solid var(--rule); }
.call button { all: unset; display: grid; grid-template-columns: 5.2em minmax(0, 1fr) 9em; gap: 14px; width: 100%; padding: 12px 0; cursor: pointer; }
.call button:focus-visible { outline: 2px solid var(--claude); }
.call .when { color: var(--ink-3); font-size: 13px; padding-top: 2px; }
.call .what { font-weight: 500; }
.call .said { display: block; color: var(--ink-2); font-size: 14px; }
.call .nums { display: block; font-size: 13px; color: var(--ink-3); margin-top: 2px; }
.call .nums i { font-style: normal; font-weight: 600; }
.call .verdict { text-align: right; font-size: 14px; }
.call .verdict .state { white-space: normal; }
.call .more { padding: 0 0 14px calc(5.2em + 14px); color: var(--ink-2); font-size: 14px; max-width: 78ch; }
.call .more p { margin: 0 0 6px; }
.more-btn { margin-top: 14px; }
.empty { color: var(--ink-2); padding: 18px 0; }
footer { margin-top: 48px; color: var(--ink-3); font-size: 13px; }
.err { color: var(--stop); }
@media (max-width: 560px) {
  .call button { grid-template-columns: minmax(0, 1fr) auto; }
  .call .when { grid-column: 1 / -1; padding: 0; }
  .call .more { padding-left: 0; }
  .ask-row { grid-template-columns: 8px 1fr; }
  .ask-actions { grid-column: 2; padding-top: 0; }
  .key { gap: 10px 20px; }
}
@media (prefers-reduced-motion: reduce) { .track > span { transition: none; } }
</style>
</head>
<body>
<div class="page">
  <div class="top">
    <p class="mark">Leash</p>
    <span class="mode" id="mode"></span>
    <span class="grow"></span>
    <span class="quiet" id="updated">Connecting to Arc</span>
    <a class="quiet" id="contractLink" target="_blank" rel="noopener">View contract on Arcscan</a>
    <button class="btn stop" id="pauseBtn">Pause spending</button>
  </div>

  <div class="paused" id="paused">
    <p><b>Spending is paused.</b> The contract refuses every request from the agent until you resume.</p>
    <button class="btn" id="resumeBtn">Resume spending</button>
  </div>

  <div class="allowance">
    <h1>Left to spend today</h1>
    <p class="big" id="left">$—</p>
    <div class="track" id="track" role="img" aria-label="Today's allowance"></div>
    <div class="key" id="key"></div>
  </div>

  <div class="ask" id="ask"></div>


  <section class="finder">
    <h3>Find a market</h3>
    <p class="lede">Search Gemini's live prediction markets. Ask Claude about any of them, or have the agent watch one. Watching also allows that market in the contract, which signs a transaction with your owner key.</p>
    <form class="search" id="searchForm">
      <input type="search" id="q" placeholder="Search, for example Fed, bitcoin, election" aria-label="Search markets">
      <select id="cat" aria-label="Category"></select>
      <button class="btn" type="submit">Search</button>
      <label><input type="checkbox" id="buyResearch"> Buy the latest research report first ($0.01 with x402)</label>
    </form>
    <p class="quiet" id="mktNote"></p>
    <ul class="results" id="results"></ul>
  </section>

  <div class="cols">
    <div>
      <section>
        <h3>Claude against the market</h3>
        <p class="lede">The market's price is what traders think the odds are. The agent only trades when Claude's estimate is far enough away, after fees, and it's confident.</p>
        <div id="charts"></div>
      </section>
      <section>
        <h3>Every call it made</h3>
        <p class="lede">Open one to read Claude's full reasoning and the math behind the decision.</p>
        <ul class="calls" id="calls"></ul>
      </section>
    </div>
    <div>
      <section>
        <h3>Money</h3>
        <table class="ledger" id="money"></table>
      </section>
      <section>
        <h3>Live from Arc</h3>
        <p class="lede">Your contract's events, pushed here by a QuickNode Stream as each block lands. You get a Mac notification when one needs your approval.</p>
        <ol class="feed" id="feed"></ol>
      </section>
      <section>
        <h3>Contract log</h3>
        <p class="lede">Each time the agent asked the rulebook on Arc for money, and what it said.</p>
        <ol class="log" id="log"></ol>
      </section>
    </div>
  </div>
  <footer id="footer"></footer>
</div>

<script>
const TOKEN = document.querySelector('meta[name="dashboard-token"]').content;
let state = null, showAll = false;
const seenEvents = new Set();
const opened = new Set();
const SHOW = 10;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (n, d = 2) => n == null ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (p) => p == null ? "—" : Math.round(Number(p) * 100) + "%";
const cents = (p) => Math.round(Number(p) * 100) + "¢";
const time = (iso) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const day = (iso) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

async function act(path, body, btn) {
  if (btn) btn.disabled = true;
  try {
    const res = await fetch(path, { method: "POST", headers: { "content-type": "application/json", "x-dashboard-token": TOKEN }, body: JSON.stringify(body) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    state = out.state; render();
  } catch (e) { $("footer").innerHTML = '<span class="err">That didn\\'t go through: ' + esc(e.message) + '</span>'; }
  finally { if (btn) btn.disabled = false; }
}
$("pauseBtn").onclick = (e) => { if (confirm("Pause spending? The contract will refuse every request until you resume.")) act("/api/pause", { paused: true }, e.target); };
$("resumeBtn").onclick = (e) => act("/api/pause", { paused: false }, e.target);

// "Fed decision in December? · Hike 25bps" -> "Fed decision in December? Hike 25bps"
const nice = (title) => String(title).replace(/([?!.]) · /, "$1 ").replace(" · ", ": ");
// Turn "GEMI-FED261211-HIKE25" into words a person reads.
function marketName(symbol) {
  const m = (state.markets || []).find((x) => x.symbol === symbol);
  return m ? nice(m.title) : symbol;
}

function render() {
  const s = state; if (!s) return;
  const L = s.limits;
  $("mode").textContent = s.mode === "live" ? "Trading real money" : s.mode === "sandbox" ? "Trading in Gemini's sandbox" : "Paper trading, no real orders";
  $("updated").textContent = "Updated " + time(s.updatedAt);
  $("contractLink").href = s.explorer + "/address/" + s.policyAddress;
  $("paused").classList.toggle("on", L.paused);
  $("pauseBtn").hidden = L.paused;

  // Allowance bar
  const cap = L.dailyCapUsd || 0;
  const spent = Math.max(0, cap - L.remainingTodayUsd);
  const waiting = s.pending.filter((r) => r.kind === "TRADE" || r.kind === "TOPUP").reduce((a, r) => a + r.amountUsd, 0);
  const left = Math.max(0, L.remainingTodayUsd - waiting);
  const w = (v) => cap ? Math.min(100, (v / cap) * 100) : 0;
  $("left").innerHTML = usd(left) + "<small>of " + usd(cap, 0) + " a day</small>";
  $("track").innerHTML =
    '<span class="seg-spent" style="width:' + w(spent) + '%"></span>' +
    '<span class="seg-wait" style="width:' + w(Math.min(waiting, L.remainingTodayUsd)) + '%"></span>' +
    '<i class="threshold" style="left:calc(' + w(L.approvalThresholdUsd) + '% - 1px)" title="Anything at or above ' + usd(L.approvalThresholdUsd, 0) + ' needs you"></i>';
  $("key").innerHTML =
    '<span><span class="sw" style="background:var(--spent)"></span><b>' + usd(spent) + '</b> spent</span>' +
    (waiting ? '<span><span class="sw seg-wait"></span><b>' + usd(waiting) + '</b> waiting for you</span>' : '') +
    '<span><span class="sw" style="background:var(--left)"></span><b>' + usd(left) + '</b> left</span>' +
    '<span>Single requests of <b>' + usd(L.approvalThresholdUsd, 0) + '</b> or more need your OK (the line on the bar). Nothing over <b>' + usd(L.perRequestCapUsd, 0) + '</b> is allowed at all.</span>';

  // Approval requests
  $("ask").classList.toggle("on", s.pending.length > 0);
  $("ask").innerHTML = s.pending.map((r) => {
    const t = r.reason.match(/^(YES|NO) x(\\d+) @([\\d.]+): (.*)$/);
    const headline = r.kind === "TOPUP"
      ? "Move " + usd(r.amountUsd) + " into the research budget"
      : t ? "Buy " + t[2] + " " + t[1] + " on " + esc(marketName(r.target)) + " at " + cents(t[3]) + ", " + usd(r.amountUsd) + " total"
          : "Trade " + usd(r.amountUsd) + " on " + esc(marketName(r.target));
    return '<div class="ask-row"><div class="hatch"></div><div class="ask-body"><h2>' + headline + '</h2>' +
      '<p>' + esc(t ? t[4] : r.reason) + '</p></div>' +
      '<div class="ask-actions"><button class="btn solid" data-approve="' + r.id + '">Approve ' + usd(r.amountUsd) + '</button>' +
      '<button class="btn" data-decline="' + r.id + '">Decline</button></div></div>';
  }).join("");
  document.querySelectorAll("[data-approve]").forEach((b) => b.onclick = () => act("/api/approve", { id: b.dataset.approve }, b));
  document.querySelectorAll("[data-decline]").forEach((b) => b.onclick = () => {
    const why = prompt("Why are you declining? This is stored with the request on Arc.", "Too large for now");
    if (why !== null) act("/api/reject", { id: b.dataset.decline, why }, b);
  });

  // Charts
  $("charts").innerHTML = s.markets.length ? s.markets.map((m, i) =>
    '<div class="market"><h4>' + esc(nice(m.title)) + '</h4><div class="chart" id="c' + i + '"></div></div>').join("")
    : '<p class="empty">No calls yet. Run <b>npm run once</b> in the agent folder and the first one shows up here.</p>';
  s.markets.forEach((m, i) => drawChart($("c" + i), m.points));

  // Calls
  const list = showAll ? s.decisions : s.decisions.slice(0, SHOW);
  $("calls").innerHTML = list.length ? list.map((d) => {
    const key = d.at + d.symbol;
    const mid = d.bid != null && d.ask != null ? (d.bid + d.ask) / 2 : null;
    const v = verdict(d);
    let more = "";
    if (opened.has(key)) {
      more = '<div class="more">' + (d.reasoning ? '<p>' + esc(d.reasoning) + '</p>' : '') +
        (d.decision && d.decision.why ? '<p>Skipped because: ' + esc(lower(d.decision.why)) + '.</p>' : '') +
        (d.decision && d.decision.evYes != null ? '<p>Expected profit per contract after Gemini fees: ' + signed(d.decision.evYes) + ' buying YES, ' + signed(d.decision.evNo) + ' buying NO. The agent needs at least 5¢.</p>' : '') +
        (d.research ? '<p>Paid ' + usd(d.research.pricePaid) + ' for research: ' + esc(d.research.title) + '</p>' : '<p>No research report was available.</p>') +
        (d.requestTx ? '<p><a target="_blank" rel="noopener" href="' + s.explorer + '/tx/' + d.requestTx + '">See request #' + d.requestId + ' on Arcscan</a></p>' : '') + '</div>';
    }
    return '<li class="call"><button aria-expanded="' + opened.has(key) + '" data-key="' + esc(key) + '">' +
      '<span class="when">' + time(d.at) + '</span>' +
      '<span><span class="what">' + esc(nice(d.title)) + '</span>' +
      '<span class="said">' + esc(d.reason) + '</span>' +
      '<span class="nums">Market <i>' + pct(mid) + '</i>, Claude <i>' + pct(d.claude) + '</i>' + (d.confidence != null ? ', confidence ' + Math.round(d.confidence * 100) + '%' : '') + '</span></span>' +
      '<span class="verdict"><span class="state ' + v[1] + '">' + v[0] + '</span>' + (v[2] ? '<span class="nums">' + v[2] + '</span>' : '') + '</span>' +
      '</button>' + more + '</li>';
  }).join("") + "" : '<li class="empty">Nothing yet.</li>';
  if (s.decisions.length > SHOW) $("calls").insertAdjacentHTML("beforeend", '<li><button class="btn more-btn" id="moreBtn">' + (showAll ? "Show the latest " + SHOW : "Show all " + s.decisions.length) + '</button></li>');
  document.querySelectorAll(".call button").forEach((b) => b.onclick = () => { const k = b.dataset.key; opened.has(k) ? opened.delete(k) : opened.add(k); render(); });
  if ($("moreBtn")) $("moreBtn").onclick = () => { showAll = !showAll; render(); };

  // Money
  const f = s.feed;
  $("money").innerHTML =
    row("Research sold to other agents", f ? f.salesCount + " report" + (f.salesCount === 1 ? "" : "s") + " to " + f.uniqueBuyers + " buyer" + (f.uniqueBuyers === 1 ? "" : "s") : "Feed server is off", s.money.earnedUsd == null ? "—" : '<span class="plus">+' + usd(s.money.earnedUsd) + '</span>') +
    row("Research the agent bought", "Paid per report with x402", "−" + usd(s.money.researchSpentUsd)) +
    row("Trades placed", s.money.tradesCount + " so far" + (s.mode === "paper" ? ", on paper" : ""), usd(s.money.tradeNotionalUsd)) +
    row("Held by the contract", "The agent can only reach it by asking", usd(s.vaultUsd)) +
    row("Ready for research", "Prepaid x402 balance", s.gatewayUsd == null ? "—" : usd(s.gatewayUsd, 3));

  // Live feed from the QuickNode Stream
  const st = s.stream;
  if (!st) $("feed").innerHTML = '<li class="empty" style="display:block">The feed server isn\\'t answering, so the stream can\\'t be shown. Start it with <b>npm start</b> in the seller folder.</li>';
  else if (!st.streaming) $("feed").innerHTML = '<li class="empty" style="display:block">The QuickNode stream isn\\'t connected yet. Add <b>QN_STREAM_SECRET</b> to seller/.env and restart the feed server.</li>';
  else if (!st.events.length) $("feed").innerHTML = '<li class="empty" style="display:block">Connected. Waiting for the contract\\'s next event.</li>';
  else {
    $("feed").innerHTML = st.events.slice(0, 12).map((e) => {
      const isNew = !seenEvents.has(e.transactionHash + e.name + e.requestId);
      return '<li class="' + (e.name === "ApprovalRequired" ? "needs " : "") + (isNew && seenEvents.size ? "fresh" : "") + '"><span class="t">' + time(e.receivedAt) + '</span><span>' + esc((s.markets || []).reduce((t, m) => t.split(m.symbol).join(nice(m.title)), e.text)) +
        '<a class="blk" target="_blank" rel="noopener" href="' + s.explorer + '/tx/' + e.transactionHash + '">Block ' + e.blockNumber.toLocaleString("en-US") + '</a></span></li>';
    }).join("");
    st.events.forEach((e) => seenEvents.add(e.transactionHash + e.name + e.requestId));
  }

  // Contract log
  $("log").innerHTML = s.requests.length ? s.requests.map((r) => {
    const st = { Pending: ["Waiting for you", "wait"], Approved: ["Approved", "ok"], Executed: ["Done", "ok"], Rejected: ["Declined", "no"] }[r.status] || [r.status, "dim"];
    const what = r.kind === "TOPUP" ? "Refill the research budget" : esc(marketName(r.target));
    return '<li><span class="n">#' + r.id + '</span><span>' + what + ', ' + usd(r.amountUsd) +
      '<span class="why">' + esc(r.reason.replace(/^(YES|NO) x\\d+ @[\\d.]+: /, "")) + '</span></span>' +
      '<span class="state ' + st[1] + '">' + st[0] + '</span></li>';
  }).join("") : '<li class="empty">The agent hasn\\'t asked for anything yet.</li>';

  $("footer").textContent = "Rulebook contract " + s.policyAddress + " on Arc testnet. This page runs only on your computer and signs with your owner key.";
}

function verdict(d) {
  const o = d.outcome || "";
  const dec = d.decision && d.decision.action === "trade" ? (d.decision.contracts + " " + d.decision.outcome.toUpperCase() + " at " + cents(d.decision.price)) : "";
  if (o === "traded") return ["Bought", "ok", dec];
  if (o === "skipped") return ["Passed", "dim", ""];
  if (o === "analyzed") return ["Checked by you", "dim", dec ? "would buy " + dec : "would pass"];
  if (o === "rejected") return ["You declined", "no", dec];
  if (o === "approval-timeout") return ["Not approved in time", "wait", dec];
  if (o.startsWith("blocked:")) return ["Contract said no", "no", o.slice(8)];
  if (o === "error") return ["Failed", "no", ""];
  return [o, "dim", ""];
}
const signed = (n) => (n >= 0 ? "+" : "−") + Math.abs(Math.round(n * 100)) + "¢";
const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);
function row(label, sub, amount) { return '<tr><td>' + esc(label) + '<span class="sub">' + esc(sub) + '</span></td><td>' + amount + '</td></tr>'; }

// Market price vs Claude's estimate, 0 to 100%, one axis.
function drawChart(el, points) {
  const W = el.clientWidth || 600, H = el.clientHeight || 200;
  const m = { l: 40, r: 92, t: 8, b: 24 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b, n = points.length;
  const x = (i) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (p) => m.t + (1 - p) * ih;
  let g = "";
  for (const p of [0, .5, 1]) g += '<line x1="' + m.l + '" x2="' + (m.l + iw) + '" y1="' + y(p) + '" y2="' + y(p) + '" stroke="var(--rule)" /><text x="' + (m.l - 10) + '" y="' + (y(p) + 4) + '" text-anchor="end">' + p * 100 + '%</text>';
  const series = [["market", "var(--market)", "Market"], ["claude", "var(--claude)", "Claude"]];
  let lines = "", ends = [];
  for (const [k, c, name] of series) {
    const pts = points.map((p, i) => [i, p[k]]).filter(([, v]) => v != null);
    if (!pts.length) continue;
    if (pts.length > 1) lines += '<path d="' + pts.map(([i, v], j) => (j ? "L" : "M") + x(i).toFixed(1) + " " + y(v).toFixed(1)).join(" ") + '" fill="none" stroke="' + c + '" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" />';
    const [li, lv] = pts[pts.length - 1];
    lines += '<circle cx="' + x(li) + '" cy="' + y(lv) + '" r="4" fill="' + c + '" />';
    ends.push({ y: y(lv) + 4, x: x(li) + 10, c, t: name + " " + Math.round(lv * 100) + "%" });
  }
  if (ends.length === 2 && Math.abs(ends[0].y - ends[1].y) < 15) { const mid = (ends[0].y + ends[1].y) / 2, up = ends[0].y <= ends[1].y; ends[0].y = mid + (up ? -8 : 8); ends[1].y = mid + (up ? 8 : -8); }
  const labels = ends.map((e) => '<text x="' + e.x + '" y="' + e.y + '" style="fill:' + e.c + ';font-weight:600">' + e.t + '</text>').join("");
  const ticks = n > 1 ? '<text x="' + x(0) + '" y="' + (H - 4) + '">' + day(points[0].at) + '</text><text x="' + x(n - 1) + '" y="' + (H - 4) + '" text-anchor="end">' + day(points[n - 1].at) + '</text>' : "";
  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Market price and Claude\\'s estimate over time">' + g + lines + labels + ticks +
    '<line class="x" y1="' + m.t + '" y2="' + (m.t + ih) + '" stroke="var(--ink-3)" stroke-dasharray="2 3" style="display:none" />' +
    '<rect x="' + m.l + '" y="0" width="' + iw + '" height="' + H + '" fill="transparent" /></svg><div class="tip"></div>';
  const tip = el.querySelector(".tip"), cross = el.querySelector(".x"), hit = el.querySelector("rect");
  hit.onmousemove = (ev) => {
    const b = el.getBoundingClientRect(), px = (ev.clientX - b.left) * (W / b.width);
    const i = n <= 1 ? 0 : Math.max(0, Math.min(n - 1, Math.round(((px - m.l) / iw) * (n - 1)))), p = points[i];
    cross.setAttribute("x1", x(i)); cross.setAttribute("x2", x(i)); cross.style.display = "";
    tip.innerHTML = '<div style="color:var(--ink-3)">' + day(p.at) + '</div><div><span class="sw" style="background:var(--claude)"></span>Claude<b>' + pct(p.claude) + '</b></div><div><span class="sw" style="background:var(--market)"></span>Market<b>' + pct(p.market) + '</b></div>';
    tip.style.display = "block"; tip.style.left = Math.min(b.width - 165, Math.max(0, (x(i) / W) * b.width + 12)) + "px";
  };
  hit.onmouseleave = () => { tip.style.display = "none"; cross.style.display = "none"; };
}

async function refresh() {
  try {
    const res = await fetch("/api/state", { cache: "no-store" });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    state = out; render();
  } catch (e) { $("footer").innerHTML = '<span class="err">Can\\'t reach the dashboard server: ' + esc(e.message) + '. Is <b>npm run dashboard</b> still running?</span>'; }
}

// ---------------------------------------------------------------- market finder
const CATS = ["economics", "politics", "crypto", "commodities", "tech", "business", "culture", "weather", "sports"];
$("cat").innerHTML = CATS.map((c) => '<option value="' + c + '">' + c.charAt(0).toUpperCase() + c.slice(1) + '</option>').join("");
let found = [];
const analyses = {};
const busy = new Set();

async function searchMarkets() {
  $("mktNote").textContent = "Loading " + $("cat").value + " markets from Gemini...";
  try {
    const res = await fetch("/api/markets?category=" + encodeURIComponent($("cat").value) + "&q=" + encodeURIComponent($("q").value), { cache: "no-store" });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    found = out.markets;
    $("mktNote").textContent = out.total ? "Showing " + found.length + " of " + out.total + ", tightest spread first. A tight spread means the price is reliable." : "No open markets match. Try another word or category.";
    renderMarkets();
  } catch (e) { $("mktNote").innerHTML = '<span class="err">Could not load markets: ' + esc(e.message) + '</span>'; }
}
$("searchForm").onsubmit = (e) => { e.preventDefault(); searchMarkets(); };
$("cat").onchange = searchMarkets;

function renderMarkets() {
  $("results").innerHTML = found.map((m) => {
    const mid = m.bestBid != null && m.bestAsk != null ? (m.bestBid + m.bestAsk) / 2 : m.lastTradePrice;
    const a = analyses[m.symbol];
    const working = busy.has(m.symbol);
    return '<li class="mkt"><div class="mkt-row">' +
      '<span><span class="t">' + esc(nice(m.eventTitle + " · " + m.contractLabel)) + '</span><span class="s">' + esc(m.symbol) + '</span></span>' +
      '<span class="px">' + pct(mid) + '<span>market odds</span></span>' +
      '<span class="px">' + (m.bestBid != null && m.bestAsk != null ? cents(m.bestBid) + " / " + cents(m.bestAsk) : "no quotes") + '<span>' + (m.spread != null ? "spread " + cents(m.spread) : "bid / ask") + '</span></span>' +
      '<span class="acts">' +
        '<button class="btn" data-analyze="' + esc(m.symbol) + '"' + (working ? " disabled" : "") + '>' + (working ? "Asking Claude..." : a ? "Ask again" : "Ask Claude") + '</button>' +
        (m.watched ? '<span class="watching">Watching</span><button class="btn" data-unwatch="' + esc(m.symbol) + '">Stop</button>'
                   : '<button class="btn" data-watch="' + esc(m.symbol) + '">Watch</button>') +
      '</span></div>' + (a ? analysisBox(m, a) : "") + '</li>';
  }).join("");
  document.querySelectorAll("[data-analyze]").forEach((b) => b.onclick = () => analyze(b.dataset.analyze));
  document.querySelectorAll("[data-watch]").forEach((b) => b.onclick = () => watch(b.dataset.watch, true, b));
  document.querySelectorAll("[data-unwatch]").forEach((b) => b.onclick = () => watch(b.dataset.unwatch, false, b));
}

function analysisBox(m, a) {
  if (a.error) return '<div class="verdict-box"><p class="err">Claude could not analyze this market: ' + esc(a.error) + '</p></div>';
  const q = a.quote, mid = q.bestBid != null && q.bestAsk != null ? (q.bestBid + q.bestAsk) / 2 : null;
  const d = a.decision, est = a.estimate;
  const head = d.action === "trade"
    ? "Claude would buy " + d.contracts + " " + d.outcome.toUpperCase() + " at " + cents(d.price) + ", " + usd(d.costUsd) + " in total"
    : "Claude would pass on this one";
  const why = d.action === "trade"
    ? "Expected profit is " + signed(d.edge) + " per contract after Gemini fees, and confidence is " + Math.round(est.confidence * 100) + "%."
    : "Skipped because: " + lower(d.why) + ".";
  return '<div class="verdict-box"><h4>' + head + '</h4>' +
    '<div class="cmp"><span class="c"><b>' + pct(est.probabilityYes) + '</b>Claude</span><span class="m"><b>' + pct(mid) + '</b>Market</span><span><b>' + Math.round(est.confidence * 100) + '%</b>Confidence</span></div>' +
    '<p>' + esc(why) + '</p><p>' + esc(est.reasoning) + '</p>' +
    '<p class="quiet">' + (a.research ? "Used research: " + esc(a.research.title) + " (paid " + usd(a.research.pricePaid) + ")" : "No research report was used" + (a.notes && a.notes.length ? ": " + esc(a.notes[a.notes.length - 1]) : ".")) + ' This was only an analysis; nothing was traded.</p></div>';
}

async function analyze(symbol) {
  busy.add(symbol); renderMarkets();
  try {
    const m = found.find((x) => x.symbol === symbol);
    const res = await fetch("/api/analyze", { method: "POST", headers: { "content-type": "application/json", "x-dashboard-token": TOKEN }, body: JSON.stringify({ symbol, topic: m && m.topic, buyResearch: $("buyResearch").checked }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    analyses[symbol] = out;
    refresh();
  } catch (e) { analyses[symbol] = { error: e.message }; }
  finally { busy.delete(symbol); renderMarkets(); }
}

async function watch(symbol, on, btn) {
  if (on && !confirm("Watch " + symbol + "? The agent will check it every cycle, and this allows it in your contract (one transaction signed with your owner key).")) return;
  btn.disabled = true;
  try {
    const m = found.find((x) => x.symbol === symbol);
    const res = await fetch(on ? "/api/watch" : "/api/unwatch", { method: "POST", headers: { "content-type": "application/json", "x-dashboard-token": TOKEN }, body: JSON.stringify({ symbol, topic: m && m.topic }) });
    const out = await res.json();
    if (!res.ok) throw new Error(out.error || res.statusText);
    if (m) m.watched = on;
    renderMarkets();
  } catch (e) { $("mktNote").innerHTML = '<span class="err">That did not go through: ' + esc(e.message) + '</span>'; btn.disabled = false; }
}
searchMarkets();

refresh();
setInterval(refresh, 3000);
let rt; addEventListener("resize", () => { clearTimeout(rt); rt = setTimeout(render, 150); });
</script>
</body>
</html>`;
}
