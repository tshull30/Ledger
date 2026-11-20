// Lists active Gemini prediction markets so you can pick a watchlist.
// Run:  npm run markets            (all categories)
//       npm run markets -- politics
import { listActiveContracts } from "../src/gemini.js";

const category = process.argv[2];
const rows = await listActiveContracts({ category, maxPages: 4 });
const tradable = rows.filter((r) => r.bestBid !== null && r.bestAsk !== null);

console.log(`${rows.length} active contracts${category ? ` in "${category}"` : ""}, ${tradable.length} with live bids and asks:\n`);
for (const r of tradable.slice(0, 60)) {
  const spread = ((r.bestAsk! - r.bestBid!) * 100).toFixed(0);
  console.log(`${r.symbol.padEnd(34)} ${String(r.bestBid).padStart(5)} / ${String(r.bestAsk).padEnd(5)} spread ${spread.padStart(2)}c  ${r.eventTitle} | ${r.contractLabel}`);
}
console.log(`\nPick 1-3 with a tight spread and a topic people talk about on X.`);
console.log(`Then add to agent/.env, e.g.  WATCHLIST=SYMBOL=fed-jan-cut`);
console.log(`And allow each one in the contract (see README).`);
