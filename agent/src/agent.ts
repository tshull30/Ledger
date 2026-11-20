// THE DECISION LOOP
//
// For each market on the watchlist, every LOOP_MINUTES:
//   1. Read live odds from Gemini                         (free, public)
//   2. Buy the latest X research report from our feed     (x402, $0.01 USDC on Arc)
//   3. Ask Claude for a probability estimate              (Claude only estimates; it never touches money)
//   4. Do the math: expected profit after Gemini fees     (strategy.ts; skip unless the edge is big enough)
//   5. Ask the rules contract on Arc for permission       (small = instant, big = owner must approve)
//   6. Place the order on Gemini, record the order id onchain
//
// Run once:      npm run once
// Run forever:   npm start
import { config, require as need } from "./config.js";
import { getQuote } from "./gemini.js";
import { placeOrder } from "./gemini.js";
import { estimate } from "./brain.js";
import { decide } from "./strategy.js";
import { Policy, Kind } from "./policy.js";
import { Research, type ResearchReport } from "./research.js";
import { writeEntry } from "./journal.js";
import type { WatchItem } from "./config.js";
import { getWatchlist } from "./watchlist.js";

const log = (m: string) => console.log(`[${new Date().toLocaleTimeString()}] ${m}`);

async function runMarket(item: WatchItem, policy: Policy, research: Research) {
  const entry: Record<string, unknown> = { at: new Date().toISOString(), symbol: item.symbol, topic: item.topic, mode: config.tradeMode };
  try {
    // 1. Odds
    const quote = await getQuote(item.symbol);
    entry.quote = quote;
    log(`${quote.eventTitle} / ${quote.contractLabel}: YES bid ${quote.bestBid} ask ${quote.bestAsk}`);

    // 2. Research
    let report: ResearchReport | null = null;
    try {
      report = await research.buyLatest(item.topic, log);
    } catch (err) {
      log(`  Research purchase failed: ${(err as Error).message}`);
    }
    entry.research = report ? { id: report.id, title: report.title, sentiment: report.sentiment, pricePaid: report.pricePaid, paymentTx: report.paymentTx } : null;

    // 3. Claude
    const est = await estimate(quote, report);
    entry.estimate = est;
    log(`  Claude: P(YES)=${est.probabilityYes.toFixed(2)}, confidence ${est.confidence.toFixed(2)}. ${est.oneLineReason}`);

    // 4. Math
    const d = decide(est, quote, {
      minEdge: config.minEdge,
      minConfidence: config.minConfidence,
      maxStakeUsd: config.maxStakeUsd,
      feeRate: config.geminiFeeRate,
    });
    entry.decision = d;
    if (d.action === "skip") {
      log(`  Skip: ${d.why}`);
      entry.outcome = "skipped";
      return;
    }
    log(`  Wants: BUY ${d.contracts} ${d.outcome.toUpperCase()} @ $${d.price.toFixed(2)} (~$${d.costUsd}, edge $${d.edge.toFixed(3)}/contract)`);

    // 5. Permission from the contract
    const blocked = await policy.checkSpend(Kind.TRADE, item.symbol, d.costUsd);
    if (blocked) {
      log(`  Contract says no: ${blocked}`);
      entry.outcome = `blocked:${blocked}`;
      return;
    }
    const reason = `${d.outcome.toUpperCase()} x${d.contracts} @${d.price.toFixed(2)}: ${est.oneLineReason}`;
    const req = await policy.requestSpend(Kind.TRADE, item.symbol, d.costUsd, reason);
    entry.requestId = req.id;
    entry.requestTx = req.tx;
    log(`  Request #${req.id}: ${req.status} (tx ${req.tx})`);

    let status = req.status;
    if (status === "Pending") {
      log(`  Over the approval threshold. Waiting up to ${config.approvalWaitMinutes} min for the owner...`);
      log(`  (approve with: npm run approve -- ${req.id})`);
      status = await policy.waitForDecision(req.id, config.approvalWaitMinutes * 60_000);
      log(`  Owner decision: ${status}`);
    }
    if (status !== "Approved") {
      entry.outcome = status === "Pending" ? "approval-timeout" : "rejected";
      return;
    }

    // 6. Trade + receipt
    const order = await placeOrder({
      symbol: item.symbol,
      outcome: d.outcome,
      quantity: d.contracts,
      price: d.price,
      clientOrderId: `oa-${req.id}-${Date.now()}`,
    });
    const execTx = await policy.recordExecution(req.id, `${order.mode}:${order.orderId}`);
    log(`  Order ${order.orderId} (${order.mode}, ${order.status}). Recorded onchain (tx ${execTx})`);
    entry.order = order;
    entry.executionTx = execTx;
    entry.outcome = "traded";
  } catch (err) {
    entry.outcome = "error";
    entry.error = (err as Error).message;
    log(`  Error: ${(err as Error).message}`);
  } finally {
    writeEntry(entry);
  }
}

export async function runCycle() {
  const agentKey = need("agentPrivateKey", "Run contracts/scripts/generate-wallets.js");
  const policyAddress = need("policyAddress", "Deploy the contract and add POLICY_ADDRESS to contracts/.env");
  need("anthropicApiKey", "Add ANTHROPIC_API_KEY to agent/.env");
  const watchlist = getWatchlist(); // re-read each cycle, so markets added from the dashboard are picked up
  if (watchlist.length === 0) throw new Error("Nothing to watch. Add a market from the dashboard, or set WATCHLIST in agent/.env.");

  const policy = new Policy({ privateKey: agentKey, address: policyAddress });
  const research = new Research(policy, agentKey);

  const limits = await policy.limits();
  log(`Mode: ${config.tradeMode.toUpperCase()}   Budget left today: $${limits.remainingTodayUsd}   Human approval at: $${limits.approvalThresholdUsd}+${limits.paused ? "   PAUSED" : ""}`);
  if (limits.paused) {
    log("Contract is paused (kill switch). Doing nothing.");
    return;
  }
  for (const item of watchlist) await runMarket(item, policy, research);
}

// Entry point
const once = process.argv.includes("--once");
if (once) {
  await runCycle();
} else {
  log(`Agent started. Checking ${getWatchlist().length} market(s) every ${config.loopMinutes} min. Ctrl+C to stop.`);
  for (;;) {
    try {
      await runCycle();
    } catch (err) {
      log(`Cycle failed: ${(err as Error).message}`);
    }
    await new Promise((r) => setTimeout(r, config.loopMinutes * 60_000));
  }
}
