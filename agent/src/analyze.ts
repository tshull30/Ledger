// One-off analysis of any Gemini market, run from the dashboard.
// Same steps as the agent's loop up to the decision, but it never asks the contract or trades.
import { config } from "./config.js";
import { getQuote } from "./gemini.js";
import { estimate } from "./brain.js";
import { decide } from "./strategy.js";
import type { Research, ResearchReport } from "./research.js";
import { writeEntry } from "./journal.js";

export async function analyzeMarket(opts: { symbol: string; topic: string; research: Research | null; buyResearch: boolean }) {
  const notes: string[] = [];
  const log = (m: string) => notes.push(m.trim());

  const quote = await getQuote(opts.symbol);

  let report: ResearchReport | null = null;
  if (opts.buyResearch && opts.research) {
    try {
      report = await opts.research.buyLatest(opts.topic, log);
    } catch (err) {
      log(`Research purchase failed: ${(err as Error).message}`);
    }
  }

  const est = await estimate(quote, report);
  const decision = decide(est, quote, {
    minEdge: config.minEdge,
    minConfidence: config.minConfidence,
    maxStakeUsd: config.maxStakeUsd,
    feeRate: config.geminiFeeRate,
  });

  // Logged like any other call, so it shows on the chart and in the list.
  writeEntry({
    at: new Date().toISOString(),
    symbol: opts.symbol,
    topic: opts.topic,
    mode: config.tradeMode,
    source: "dashboard",
    quote,
    research: report ? { id: report.id, title: report.title, sentiment: report.sentiment, pricePaid: report.pricePaid, paymentTx: report.paymentTx } : null,
    estimate: est,
    decision,
    outcome: "analyzed",
  });

  return { quote, research: report, estimate: est, decision, notes };
}
