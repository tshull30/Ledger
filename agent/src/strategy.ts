// Turns Claude's probability estimate into a trade (or not).
// This part is plain math on purpose: the model estimates, the code decides.
import { feePerContract } from "./gemini.js";

export interface Estimate {
  probabilityYes: number; // 0..1, Claude's estimate that the event happens
  confidence: number; // 0..1, how much Claude trusts its own estimate
}

export interface Market {
  bestBid: number | null; // YES bid
  bestAsk: number | null; // YES ask
}

export interface Settings {
  minEdge: number; // required expected profit per contract, after fees (in $)
  minConfidence: number;
  maxStakeUsd: number;
  feeRate: number;
}

export type Decision =
  | { action: "skip"; why: string; evYes: number | null; evNo: number | null }
  | {
      action: "trade";
      outcome: "yes" | "no";
      price: number; // limit price per contract
      contracts: number;
      costUsd: number; // price x contracts + fees, rounded up to the cent
      edge: number; // expected profit per contract after fees
      evYes: number | null;
      evNo: number | null;
    };

const round2 = (n: number) => Math.round(n * 100) / 100;
const valid = (p: number | null): p is number => p !== null && p > 0 && p < 1;

/**
 * Expected value per contract = (chance we're right) - (price) - (fee).
 * Buying YES costs the YES ask. Buying NO costs 1 - YES bid.
 */
export function decide(est: Estimate, mkt: Market, s: Settings): Decision {
  const p = clamp(est.probabilityYes);
  const yesPrice = valid(mkt.bestAsk) ? mkt.bestAsk : null;
  const noPrice = valid(mkt.bestBid) ? round2(1 - mkt.bestBid) : null;

  const evYes = yesPrice === null ? null : round4(p - yesPrice - feePerContract(yesPrice, s.feeRate));
  const evNo = noPrice === null ? null : round4(1 - p - noPrice - feePerContract(noPrice, s.feeRate));

  if (yesPrice === null && noPrice === null) return { action: "skip", why: "No prices in the order book", evYes, evNo };
  if (est.confidence < s.minConfidence) {
    return { action: "skip", why: `Confidence ${est.confidence.toFixed(2)} below ${s.minConfidence}`, evYes, evNo };
  }

  const best =
    (evYes ?? -Infinity) >= (evNo ?? -Infinity)
      ? { outcome: "yes" as const, ev: evYes!, price: yesPrice! }
      : { outcome: "no" as const, ev: evNo!, price: noPrice! };

  if (best.ev < s.minEdge) {
    return { action: "skip", why: `Best edge ${best.ev.toFixed(3)}/contract is below ${s.minEdge}`, evYes, evNo };
  }

  // Bet more when the edge is bigger and Claude is more confident, never above maxStake.
  const scale = Math.min(1, best.ev / 0.15) * est.confidence;
  const stake = s.maxStakeUsd * scale;
  const perContract = best.price + feePerContract(best.price, s.feeRate);
  const contracts = Math.max(1, Math.floor(stake / perContract));
  const costUsd = Math.ceil(contracts * perContract * 100) / 100;

  return { action: "trade", outcome: best.outcome, price: best.price, contracts, costUsd, edge: best.ev, evYes, evNo };
}

const clamp = (n: number) => Math.min(0.99, Math.max(0.01, n));
const round4 = (n: number) => Math.round(n * 10000) / 10000;
