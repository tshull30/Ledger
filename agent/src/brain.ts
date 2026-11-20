// Claude reads the market and the research, and estimates the real probability.
// It does NOT decide whether to trade or how much. strategy.ts does that with plain math.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { config } from "./config.js";
import type { Quote } from "./gemini.js";
import type { ResearchReport } from "./research.js";

export const EstimateSchema = z.object({
  probabilityYes: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(1200),
  oneLineReason: z.string().max(200),
});
export type ClaudeEstimate = z.infer<typeof EstimateSchema>;

const SYSTEM = `You are the analyst for a small, cautious prediction-market trading agent.

You get one Gemini prediction-market contract with its current prices, and possibly a research report summarizing recent sentiment on X.
Estimate the true probability that the contract resolves YES.

Rules of thumb:
- Market prices already reflect a lot of information. Start from the market's implied probability (the midpoint of bid and ask) and move away from it only when you have a concrete reason.
- Social media sentiment is noisy and often lags or overreacts. Treat it as weak evidence unless it points to a specific new fact (a data release, an official statement).
- If there is no research, or the research is old or vague, stay close to the market and give low confidence.
- confidence = how much you trust your estimate to be better than the market's. 0.3 means "barely", 0.8 means "I have a clear, specific reason".
- Never invent facts. If you are unsure what the contract means, give low confidence.

Respond only by calling the submit_estimate tool. If you cannot call tools, reply with only a JSON object with the keys probabilityYes, confidence, reasoning, oneLineReason.`;

const tool: Anthropic.Tool = {
  name: "submit_estimate",
  description: "Submit your probability estimate for this contract.",
  input_schema: {
    type: "object",
    properties: {
      probabilityYes: { type: "number", description: "0 to 1. Your estimate that the contract resolves YES." },
      confidence: { type: "number", description: "0 to 1. How much you trust your estimate over the market price." },
      reasoning: { type: "string", description: "2 to 5 sentences explaining the estimate." },
      oneLineReason: { type: "string", description: "Under 150 characters. Stored onchain as the reason for any trade." },
    },
    required: ["probabilityYes", "confidence", "reasoning", "oneLineReason"],
  },
};

export function buildPrompt(quote: Quote, report: ResearchReport | null, now = new Date()) {
  const mid =
    quote.bestBid !== null && quote.bestAsk !== null ? ((quote.bestBid + quote.bestAsk) / 2).toFixed(3) : "unknown";
  const lines = [
    `Current time: ${now.toISOString()}`,
    ``,
    `CONTRACT`,
    `Event: ${quote.eventTitle}`,
    `Contract: ${quote.contractLabel}  (symbol ${quote.symbol}, category ${quote.category || "n/a"})`,
    `YES best bid: ${quote.bestBid ?? "none"}   YES best ask: ${quote.bestAsk ?? "none"}   last trade: ${quote.lastTradePrice ?? "none"}`,
    `Market-implied probability (mid): ${mid}`,
    ``,
  ];
  if (report) {
    const ageMin = Math.round((now.getTime() - new Date(report.receivedAt).getTime()) / 60000);
    lines.push(
      `RESEARCH REPORT (bought for $${report.pricePaid}, ${ageMin} minutes old, by ${report.researcher})`,
      `Title: ${report.title}`,
      `Sentiment: ${report.sentiment} (-1..1)   Researcher confidence: ${report.confidence}   Posts analyzed: ${report.postsAnalyzed}`,
      `Summary: ${report.summary}`,
    );
  } else {
    lines.push(`RESEARCH REPORT: none available this cycle.`);
  }
  return lines.join("\n");
}

export async function estimate(
  quote: Quote,
  report: ResearchReport | null,
  client: Pick<Anthropic, "messages"> = new Anthropic({ apiKey: config.anthropicApiKey }),
): Promise<ClaudeEstimate> {
  // Some models don't allow forcing a specific tool, so we ask nicely (tool_choice "auto")
  // and fall back to reading a JSON object from plain text. One retry if neither works.
  let lastProblem = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const msg = await client.messages.create({
      model: config.claudeModel,
      max_tokens: 2048,
      system: SYSTEM,
      tools: [tool],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: buildPrompt(quote, report) }],
    });
    const parsed = extractEstimate(msg.content);
    if (parsed.ok) return parsed.value;
    lastProblem = parsed.problem;
  }
  throw new Error(`Claude did not return a usable estimate: ${lastProblem}`);
}

/** Pull the estimate out of a tool call, or out of a JSON object in plain text. */
export function extractEstimate(
  content: ReadonlyArray<{ type: string }>,
): { ok: true; value: ClaudeEstimate } | { ok: false; problem: string } {
  const call = content.find((b) => b.type === "tool_use") as { input?: unknown } | undefined;
  if (call) {
    const r = EstimateSchema.safeParse(call.input);
    return r.success ? { ok: true, value: r.data } : { ok: false, problem: r.error.message };
  }
  const text = content
    .filter((b) => b.type === "text")
    .map((b) => String((b as { text?: unknown }).text ?? ""))
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { ok: false, problem: "no tool call and no JSON in the reply" };
  try {
    const r = EstimateSchema.safeParse(JSON.parse(match[0]));
    return r.success ? { ok: true, value: r.data } : { ok: false, problem: r.error.message };
  } catch {
    return { ok: false, problem: "reply contained invalid JSON" };
  }
}
