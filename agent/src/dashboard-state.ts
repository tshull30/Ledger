// Builds the JSON the dashboard page shows. Kept separate from the server so it can be tested.
import { config } from "./config.js";
import type { Policy } from "./policy.js";

export const EXPLORER = "https://testnet.arcscan.app";

export interface StateDeps {
  owner: Policy;
  gatewayBalanceUsd: () => Promise<number | null>;
  feedStats: () => Promise<FeedStats | null>;
  streamEvents: () => Promise<{ streaming: boolean; events: StreamEvent[] } | null>;
  entries: () => Record<string, any>[];
}

export interface StreamEvent {
  name: string;
  blockNumber: number;
  transactionHash: string;
  receivedAt: string;
  requestId: number | null;
  text: string;
}

export interface FeedStats {
  totalEarnedUsdc: number;
  salesCount: number;
  uniqueBuyers: number;
  reportCount: number;
}

/** Everything the page shows, in one JSON object. */
export async function buildState(deps: StateDeps) {
  const [limits, vault, requests, gatewayBal, feed, stream] = await Promise.all([
    deps.owner.limits(),
    deps.owner.vaultBalanceUsd(),
    deps.owner.recentRequests(25),
    deps.gatewayBalanceUsd().catch(() => null),
    deps.feedStats().catch(() => null),
    deps.streamEvents().catch(() => null),
  ]);

  const entries = deps.entries();
  const recent = entries.slice(-60).reverse();

  // Money in and out (research spend comes from the agent's own journal).
  const researchSpent = entries.reduce((a, e) => a + Number(e.research?.pricePaid ?? 0), 0);
  const traded = entries.filter((e) => e.outcome === "traded");
  const tradeNotional = traded.reduce((a, e) => a + Number(e.decision?.costUsd ?? 0), 0);
  const counts: Record<string, number> = {};
  for (const e of entries) counts[e.outcome ?? "unknown"] = (counts[e.outcome ?? "unknown"] ?? 0) + 1;

  // Chart data: per market, market-implied probability vs Claude's estimate over time.
  const markets: Record<string, { symbol: string; title: string; points: { at: string; market: number | null; claude: number | null }[] }> = {};
  for (const e of entries) {
    const q = e.quote;
    if (!q) continue;
    const m = (markets[e.symbol] ??= { symbol: e.symbol, title: `${q.eventTitle} · ${q.contractLabel}`, points: [] });
    const mid = q.bestBid != null && q.bestAsk != null ? (Number(q.bestBid) + Number(q.bestAsk)) / 2 : (q.lastTradePrice ?? null);
    m.points.push({ at: e.at, market: mid, claude: e.estimate?.probabilityYes ?? null });
  }
  for (const m of Object.values(markets)) m.points = m.points.slice(-60);

  return {
    updatedAt: new Date().toISOString(),
    mode: config.tradeMode,
    policyAddress: deps.owner.address,
    explorer: EXPLORER,
    limits,
    vaultUsd: vault,
    gatewayUsd: gatewayBal,
    feed,
    stream,
    money: {
      researchSpentUsd: round(researchSpent),
      earnedUsd: feed?.totalEarnedUsdc ?? null,
      tradeNotionalUsd: round(tradeNotional),
      tradesCount: traded.length,
    },
    counts,
    pending: requests.filter((r) => r.status === "Pending"),
    requests,
    markets: Object.values(markets),
    decisions: recent.map((e) => ({
      at: e.at,
      symbol: e.symbol,
      title: e.quote ? `${e.quote.eventTitle} · ${e.quote.contractLabel}` : e.symbol,
      bid: e.quote?.bestBid ?? null,
      ask: e.quote?.bestAsk ?? null,
      claude: e.estimate?.probabilityYes ?? null,
      confidence: e.estimate?.confidence ?? null,
      reason: e.estimate?.oneLineReason ?? e.error ?? "",
      reasoning: e.estimate?.reasoning ?? "",
      decision: e.decision ?? null,
      outcome: e.outcome ?? "unknown",
      research: e.research ?? null,
      requestId: e.requestId ?? null,
      requestTx: e.requestTx ?? null,
      executionTx: e.executionTx ?? null,
      order: e.order ?? null,
    })),
  };
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;

