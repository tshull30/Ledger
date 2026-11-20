// The dashboard: a page on YOUR Mac that shows what the agent is doing and lets you
// approve/reject big trades or hit the kill switch.
//
// Run:  npm run dashboard   ->  http://localhost:4030
//
// Safety:
//  - Listens on 127.0.0.1 only. Never expose it through the tunnel: it holds the OWNER key.
//  - Every action needs a random token that's only embedded in the page itself,
//    so other websites can't click buttons for you.
import http from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { config, require as need } from "./config.js";
import { Policy } from "./policy.js";
import { readEntries } from "./journal.js";
import { listActiveContracts, type Quote } from "./gemini.js";
import { analyzeMarket } from "./analyze.js";
import { Research } from "./research.js";
import { getWatchlist, addToWatchlist, removeFromWatchlist, topicFor, isFromEnv } from "./watchlist.js";

export const CATEGORIES = ["economics", "politics", "crypto", "commodities", "tech", "business", "culture", "weather", "sports"];
import { dashboardPage } from "./dashboard-page.js";
import { buildState, EXPLORER, type StateDeps, type FeedStats, type StreamEvent } from "./dashboard-state.js";

const PORT = Number(process.env.DASHBOARD_PORT || 4030);

// ---------------------------------------------------------------- server

function start() {
  const ownerKey = need("ownerPrivateKey", "DEPLOYER_PRIVATE_KEY missing from contracts/.env");
  const policyAddress = need("policyAddress", "POLICY_ADDRESS missing from contracts/.env");
  const owner = new Policy({ privateKey: ownerKey, address: policyAddress });
  const gateway = config.agentPrivateKey ? new GatewayClient({ chain: "arcTestnet", privateKey: config.agentPrivateKey }) : null;
  const token = randomBytes(24).toString("hex");
  const agentPolicy = config.agentPrivateKey ? new Policy({ privateKey: config.agentPrivateKey, address: policyAddress }) : null;
  const research = agentPolicy && config.agentPrivateKey ? new Research(agentPolicy, config.agentPrivateKey) : null;

  // Gemini's market list is big; fetch each category at most once a minute.
  const marketCache = new Map<string, { at: number; rows: Quote[] }>();
  const marketsIn = async (category: string) => {
    const hit = marketCache.get(category);
    if (hit && Date.now() - hit.at < 60_000) return hit.rows;
    const rows = await listActiveContracts({ category, maxPages: category === "sports" ? 8 : 40 });
    marketCache.set(category, { at: Date.now(), rows });
    return rows;
  };

  const deps: StateDeps = {
    owner,
    gatewayBalanceUsd: async () => (gateway ? Number((await gateway.getBalances()).gateway.formattedAvailable) : null),
    feedStats: async () => {
      const res = await fetch(`${config.feedUrl}/stats`, { signal: AbortSignal.timeout(2500) });
      return res.ok ? ((await res.json()) as FeedStats) : null;
    },
    streamEvents: async () => {
      const res = await fetch(`${config.feedUrl}/events`, { signal: AbortSignal.timeout(2500) });
      return res.ok ? ((await res.json()) as { streaming: boolean; events: StreamEvent[] }) : null;
    },
    entries: readEntries,
  };

  // Reading the chain takes a moment; don't do it more than every few seconds.
  let cached: { at: number; state: unknown } | null = null;
  const getState = async (fresh = false) => {
    if (!fresh && cached && Date.now() - cached.at < 2500) return cached.state;
    cached = { at: Date.now(), state: await buildState(deps) };
    return cached.state;
  };

  const tokenOk = (req: http.IncomingMessage) => {
    const given = Buffer.from(String(req.headers["x-dashboard-token"] ?? ""));
    const want = Buffer.from(token);
    return given.length === want.length && timingSafeEqual(given, want);
  };

  const server = http.createServer(async (req, res) => {
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type, "cache-control": "no-store", "x-frame-options": "DENY" });
      res.end(type === "application/json" ? JSON.stringify(body) : String(body));
    };
    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

      if (req.method === "GET" && url.pathname === "/") return send(200, dashboardPage(token), "text/html; charset=utf-8");
      if (req.method === "GET" && url.pathname === "/api/state") return send(200, await getState());

      // Market finder: search Gemini's live markets by category and text.
      if (req.method === "GET" && url.pathname === "/api/markets") {
        const category = CATEGORIES.includes(url.searchParams.get("category") ?? "") ? url.searchParams.get("category")! : "economics";
        const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
        const watched = new Set(getWatchlist().map((w) => w.symbol));
        const rows = (await marketsIn(category))
          .filter((r) => !q || `${r.eventTitle} ${r.contractLabel} ${r.symbol}`.toLowerCase().includes(q))
          .map((r) => ({
            ...r,
            spread: r.bestBid != null && r.bestAsk != null ? +(r.bestAsk - r.bestBid).toFixed(3) : null,
            watched: watched.has(r.symbol),
            topic: topicFor(r.symbol),
          }))
          // Tradable first (both sides quoted), tightest spread first.
          .sort((a, b) => (a.spread ?? 9) - (b.spread ?? 9) || a.eventTitle.localeCompare(b.eventTitle));
        return send(200, { category, categories: CATEGORIES, total: rows.length, markets: rows.slice(0, 40) });
      }

      if (req.method === "POST" && url.pathname.startsWith("/api/")) {
        if (!tokenOk(req)) return send(403, { error: "Missing dashboard token" });
        const body = await readJson(req);
        let tx: string;
        if (url.pathname === "/api/approve") {
          tx = await owner.approve(BigInt(body.id));
          console.log(`[dashboard] approved #${body.id} (tx ${tx})`);
        } else if (url.pathname === "/api/reject") {
          tx = await owner.reject(BigInt(body.id), String(body.why || "rejected from dashboard").slice(0, 120));
          console.log(`[dashboard] rejected #${body.id} (tx ${tx})`);
        } else if (url.pathname === "/api/analyze") {
          if (!config.anthropicApiKey) return send(400, { error: "ANTHROPIC_API_KEY is missing from agent/.env" });
          const symbol = String(body.symbol ?? "");
          const topic = String(body.topic || topicFor(symbol));
          const result = await analyzeMarket({ symbol, topic, research, buyResearch: Boolean(body.buyResearch) });
          console.log(`[dashboard] analyzed ${symbol}: Claude ${result.estimate.probabilityYes}, ${result.decision.action}`);
          cached = null;
          return send(200, { ok: true, topic, ...result });
        } else if (url.pathname === "/api/watch") {
          const symbol = String(body.symbol ?? "");
          const topic = String(body.topic || topicFor(symbol)).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
          if (!/^[A-Za-z0-9_.-]{3,80}$/.test(symbol)) return send(400, { error: "That doesn't look like a Gemini market symbol" });
          tx = (await owner.isAllowed(symbol)) ? "already-allowed" : await owner.setTarget(symbol, true);
          addToWatchlist({ symbol, topic });
          console.log(`[dashboard] watching ${symbol} (research topic ${topic}); allowed onchain: ${tx}`);
        } else if (url.pathname === "/api/unwatch") {
          const symbol = String(body.symbol ?? "");
          if (isFromEnv(symbol)) return send(400, { error: "This market is in WATCHLIST in agent/.env. Remove it there." });
          removeFromWatchlist(symbol);
          tx = await owner.setTarget(symbol, false);
          console.log(`[dashboard] stopped watching ${symbol} and blocked it onchain (tx ${tx})`);
        } else if (url.pathname === "/api/pause") {
          tx = await owner.setPaused(Boolean(body.paused));
          console.log(`[dashboard] ${body.paused ? "PAUSED" : "resumed"} the agent (tx ${tx})`);
        } else {
          return send(404, { error: "Unknown action" });
        }
        return send(200, { ok: true, tx, state: await getState(true) });
      }
      send(404, { error: "Not found" });
    } catch (err) {
      const msg = err instanceof Error ? err.message.split("\n")[0] : String(err);
      console.error("[dashboard]", msg);
      send(500, { error: msg });
    }
  });

  server.listen(PORT, "127.0.0.1", () => {
    console.log(`Dashboard: http://localhost:${PORT}`);
    console.log(`Contract:  ${EXPLORER}/address/${policyAddress}`);
    console.log("Local only. Don't expose this port through the tunnel; it can approve trades.");
  });
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 10_000) reject(new Error("Body too large"));
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

start();
