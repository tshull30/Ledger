// Gemini prediction markets.
//  - Market data: public API, no key needed. Always uses LIVE odds, even when not trading for real.
//  - Orders:      paper (just logged) | sandbox (fake money) | live (real money)
import { createHmac } from "node:crypto";
import { config, type TradeMode } from "./config.js";

// GEMINI_PUBLIC_API is only for tests; real use always reads Gemini's public API.
const PUBLIC_API = process.env.GEMINI_PUBLIC_API || "https://api.gemini.com";
const TRADE_API: Record<Exclude<TradeMode, "paper">, string> = {
  sandbox: "https://api.sandbox.gemini.com",
  live: "https://api.gemini.com",
};

export interface Quote {
  symbol: string;
  eventTitle: string;
  contractLabel: string;
  category: string;
  bestBid: number | null; // highest price someone will pay for YES
  bestAsk: number | null; // lowest price someone will sell YES for
  lastTradePrice: number | null;
}

const toNum = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(v));

interface RawEvent {
  title: string;
  status: string;
  category?: string;
  contracts?: { label: string; instrumentSymbol: string; prices?: Record<string, string> }[];
}

/** Active events, flattened to one row per contract. */
export async function listActiveContracts(opts: { category?: string; maxPages?: number } = {}): Promise<Quote[]> {
  const out: Quote[] = [];
  const limit = 50;
  for (let page = 0; page < (opts.maxPages ?? 40); page++) {
    const qs = new URLSearchParams({ status: "active", limit: String(limit), offset: String(page * limit) });
    if (opts.category) qs.set("category", opts.category);
    const res = await fetch(`${PUBLIC_API}/v1/prediction-markets/events?${qs}`);
    if (!res.ok) throw new Error(`Gemini events ${res.status}: ${await res.text()}`);
    const body = (await res.json()) as { data: RawEvent[]; pagination?: { total?: number } };
    for (const ev of body.data ?? []) {
      for (const c of ev.contracts ?? []) {
        out.push({
          symbol: c.instrumentSymbol,
          eventTitle: ev.title,
          contractLabel: c.label,
          category: ev.category ?? "",
          bestBid: toNum(c.prices?.bestBid),
          bestAsk: toNum(c.prices?.bestAsk),
          lastTradePrice: toNum(c.prices?.lastTradePrice),
        });
      }
    }
    // Keep paging until a page comes back short. (Don't trust pagination.total; it may be missing.)
    const got = (body.data ?? []).length;
    const total = body.pagination?.total;
    if (got < limit || (total !== undefined && total > 0 && (page + 1) * limit >= total)) break;
  }
  return out;
}

function rowsFromEvent(ev: RawEvent): Quote[] {
  return (ev.contracts ?? []).map((c) => ({
    symbol: c.instrumentSymbol,
    eventTitle: ev.title,
    contractLabel: c.label,
    category: ev.category ?? "",
    bestBid: toNum(c.prices?.bestBid),
    bestAsk: toNum(c.prices?.bestAsk),
    lastTradePrice: toNum(c.prices?.lastTradePrice),
  }));
}

/** Fast path: guess the event ticker from the symbol (GEMI-FED261211-HIKE25 -> FED261211) and fetch just that event. */
async function tryEventLookup(symbol: string): Promise<Quote | null> {
  const parts = symbol.split("-");
  const guesses = [parts[1], parts.slice(0, 2).join("-")].filter(Boolean);
  for (const ticker of guesses) {
    try {
      const res = await fetch(`${PUBLIC_API}/v1/prediction-markets/events/${encodeURIComponent(ticker)}`);
      if (!res.ok) continue;
      const body = (await res.json()) as RawEvent | { data: RawEvent };
      const ev = "data" in body ? body.data : body;
      const q = rowsFromEvent(ev).find((x) => x.symbol === symbol);
      if (q) return q;
    } catch {
      /* fall through to the slower search */
    }
  }
  return null;
}

// Category lists are cached for a minute so several markets share one fetch.
const CATEGORIES = ["economics", "politics", "crypto", "commodities", "tech", "business", "culture", "weather", "sports"];
const cache = new Map<string, { at: number; rows: Quote[] }>();
const knownCategory = new Map<string, string>(); // symbol -> category, remembered after the first find

async function categoryRows(category: string) {
  const hit = cache.get(category);
  if (hit && Date.now() - hit.at < 60_000) return hit.rows;
  const rows = await listActiveContracts({ category });
  cache.set(category, { at: Date.now(), rows });
  return rows;
}

export async function getQuote(symbol: string): Promise<Quote> {
  const direct = await tryEventLookup(symbol);
  if (direct) return direct;

  const order = knownCategory.has(symbol)
    ? [knownCategory.get(symbol)!, ...CATEGORIES.filter((c) => c !== knownCategory.get(symbol))]
    : CATEGORIES;
  for (const category of order) {
    const q = (await categoryRows(category)).find((x) => x.symbol === symbol);
    if (q) {
      knownCategory.set(symbol, category);
      return q;
    }
  }
  throw new Error(`Market ${symbol} not found in any category. It may have closed. Check with: npm run markets -- economics`);
}

/** Gemini's fee for one contract at price p (charged on the cheaper side). */
export function feePerContract(price: number, rate = config.geminiFeeRate) {
  return rate * Math.min(price, 1 - price);
}

export interface OrderRequest {
  symbol: string;
  outcome: "yes" | "no";
  quantity: number; // contracts
  price: number; // 0.01 - 0.99
  clientOrderId: string;
}

export interface OrderResult {
  mode: TradeMode;
  orderId: string;
  status: string;
  raw?: unknown;
}

export async function placeOrder(order: OrderRequest): Promise<OrderResult> {
  const mode = config.tradeMode;
  if (mode === "paper") {
    return { mode, orderId: `paper-${order.clientOrderId}`, status: "paper-filled" };
  }
  if (!config.geminiApiKey || !config.geminiApiSecret) {
    throw new Error("GEMINI_API_KEY / GEMINI_API_SECRET missing in agent/.env (needed for sandbox/live trading)");
  }

  const request = "/v1/prediction-markets/order";
  // Gemini REST auth: the order goes inside a signed, base64 payload; the HTTP body stays empty.
  const payload = {
    request,
    nonce: Date.now().toString(),
    symbol: order.symbol,
    orderType: "limit",
    side: "buy",
    outcome: order.outcome,
    quantity: String(order.quantity),
    price: order.price.toFixed(2),
    timeInForce: "good-til-cancel",
    clientOrderId: order.clientOrderId,
  };
  const b64 = Buffer.from(JSON.stringify(payload)).toString("base64");
  const signature = createHmac("sha384", config.geminiApiSecret).update(b64).digest("hex");

  const res = await fetch(TRADE_API[mode] + request, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "Content-Length": "0",
      "Cache-Control": "no-cache",
      "X-GEMINI-APIKEY": config.geminiApiKey,
      "X-GEMINI-PAYLOAD": b64,
      "X-GEMINI-SIGNATURE": signature,
    },
  });
  const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new Error(`Gemini order rejected (${res.status}): ${JSON.stringify(raw)}`);
  return { mode, orderId: String(raw.orderId ?? raw.order_id ?? "unknown"), status: String(raw.status ?? "accepted"), raw };
}
