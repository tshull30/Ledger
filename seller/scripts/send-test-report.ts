// Sends a fake report so you can test without Grok Bot.
// Run (with the server running):  npm run test-report -- fed-dec-decision
// The summary is clearly marked TEST DATA so Claude won't trust it much.
import "dotenv/config";

const topic = process.argv[2] ?? "fed-dec-decision";
const base = process.env.SELLER_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;

const res = await fetch(`${base}/ingest/report`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-ingest-key": process.env.INGEST_KEY ?? "" },
  body: JSON.stringify({
    topic,
    title: `TEST: X sentiment on ${topic}`,
    summary:
      "TEST DATA, NOT REAL RESEARCH. This report exists only to test the payment flow. " +
      "Pretend accounts on X are split, with no clear new information in the last 24 hours.",
    sentiment: 0,
    confidence: 0.1,
    postsAnalyzed: 0,
    sources: [],
    researcher: "test-script",
  }),
});
console.log(res.status, await res.json());
