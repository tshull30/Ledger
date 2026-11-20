import { test } from "node:test";
import assert from "node:assert/strict";
import { decide } from "../src/strategy.js";
import { buildPrompt, EstimateSchema } from "../src/brain.js";

const s = { minEdge: 0.05, minConfidence: 0.5, maxStakeUsd: 25, feeRate: 0.07 };

test("skips when Claude agrees with the market", () => {
  const d = decide({ probabilityYes: 0.5, confidence: 0.8 }, { bestBid: 0.48, bestAsk: 0.52 }, s);
  assert.equal(d.action, "skip");
});

test("skips when confidence is too low, even with a big edge", () => {
  const d = decide({ probabilityYes: 0.9, confidence: 0.3 }, { bestBid: 0.48, bestAsk: 0.52 }, s);
  assert.equal(d.action, "skip");
});

test("buys YES when Claude thinks it's underpriced", () => {
  const d = decide({ probabilityYes: 0.7, confidence: 0.8 }, { bestBid: 0.48, bestAsk: 0.52 }, s);
  assert.equal(d.action, "trade");
  if (d.action !== "trade") return;
  assert.equal(d.outcome, "yes");
  assert.equal(d.price, 0.52);
  // edge = 0.70 - 0.52 - 0.07*0.48 = 0.1464
  assert.equal(d.edge, 0.1464);
  assert.ok(d.costUsd <= 25);
  assert.ok(d.contracts >= 1);
});

test("buys NO when Claude thinks YES is overpriced", () => {
  const d = decide({ probabilityYes: 0.25, confidence: 0.8 }, { bestBid: 0.48, bestAsk: 0.52 }, s);
  assert.equal(d.action, "trade");
  if (d.action !== "trade") return;
  assert.equal(d.outcome, "no");
  assert.equal(d.price, 0.52); // NO costs 1 - YES bid
});

test("fees can wipe out a small edge", () => {
  // edge before fees 0.06, fee 0.07*0.45 = 0.0315 -> 0.0285 < 0.05
  const d = decide({ probabilityYes: 0.61, confidence: 0.9 }, { bestBid: 0.53, bestAsk: 0.55 }, s);
  assert.equal(d.action, "skip");
});

test("skips an empty order book", () => {
  const d = decide({ probabilityYes: 0.9, confidence: 0.9 }, { bestBid: null, bestAsk: null }, s);
  assert.equal(d.action, "skip");
});

test("never stakes more than the max", () => {
  const d = decide({ probabilityYes: 0.99, confidence: 1 }, { bestBid: 0.05, bestAsk: 0.06 }, s);
  assert.equal(d.action, "trade");
  if (d.action === "trade") assert.ok(d.costUsd <= 25.01);
});

test("prompt includes odds and research", () => {
  const p = buildPrompt(
    { symbol: "S", eventTitle: "Fed cut?", contractLabel: "Yes", category: "economics", bestBid: 0.4, bestAsk: 0.44, lastTradePrice: 0.42 },
    { id: "r", topic: "t", title: "X sentiment", summary: "Most expect a hold.", sentiment: -0.3, confidence: 0.6, postsAnalyzed: 100, researcher: "grok-bot", receivedAt: new Date().toISOString(), pricePaid: "0.01", paymentTx: "0x" },
  );
  assert.match(p, /0\.420/);
  assert.match(p, /Most expect a hold/);
});

test("rejects a malformed Claude answer", () => {
  assert.throws(() => EstimateSchema.parse({ probabilityYes: 1.4, confidence: 0.5, reasoning: "x", oneLineReason: "x" }));
});

import { extractEstimate } from "../src/brain.js";
const blocks = (b: object[]) => b as { type: string }[];

test("reads Claude's estimate from a tool call", () => {
  const r = extractEstimate(blocks([{ type: "tool_use", input: { probabilityYes: 0.6, confidence: 0.5, reasoning: "r", oneLineReason: "o" } }]));
  assert.equal(r.ok, true);
});

test("falls back to JSON in plain text", () => {
  const r = extractEstimate(blocks([{ type: "text", text: 'Here you go: {"probabilityYes":0.3,"confidence":0.4,"reasoning":"r","oneLineReason":"o"}' }]));
  assert.equal(r.ok, true);
  if (r.ok) assert.equal(r.value.probabilityYes, 0.3);
});

test("reports a reply with no estimate", () => {
  const r = extractEstimate(blocks([{ type: "text", text: "I think it's likely." }]));
  assert.equal(r.ok, false);
});
