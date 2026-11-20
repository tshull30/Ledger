// Starts the research feed server.  Run:  npm start
import "dotenv/config";
import { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
import { createApp } from "./app.js";
import { Store } from "./store.js";

const {
  SELLER_ADDRESS,
  INGEST_KEY,
  PORT = "4021",
  DATA_FILE = "data/db.json",
  // Circle's verifier. The library defaults to MAINNET, so testnet payments must point here.
  // For real money later, set GATEWAY_API_URL=https://gateway-api.circle.com
  GATEWAY_API_URL = "https://gateway-api-testnet.circle.com",
  QN_STREAM_SECRET, // the security token from your QuickNode Stream's settings
} = process.env;

if (!SELLER_ADDRESS || !/^0x[0-9a-fA-F]{40}$/.test(SELLER_ADDRESS)) {
  console.error("Set SELLER_ADDRESS in seller/.env (the wallet that receives payments). Run: npm run setup");
  process.exit(1);
}
if (!INGEST_KEY || INGEST_KEY.length < 16) {
  console.error("Set INGEST_KEY in seller/.env (a long random secret for Grok Bot). Run: npm run setup");
  process.exit(1);
}

const app = createApp({
  store: new Store(DATA_FILE),
  facilitator: new BatchFacilitatorClient({ url: GATEWAY_API_URL }),
  sellerAddress: SELLER_ADDRESS,
  ingestKey: INGEST_KEY,
  quicknodeSecret: QN_STREAM_SECRET,
});

app.listen(Number(PORT), () => {
  console.log(`Research feed running on http://localhost:${PORT}`);
  console.log(`  Catalog (free):  http://localhost:${PORT}/catalog`);
  console.log(`  Earnings (free): http://localhost:${PORT}/stats`);
  console.log(`  Grok Bot form:   http://localhost:${PORT}/submit`);
  console.log(
    QN_STREAM_SECRET
      ? `  QuickNode:       POST /webhooks/quicknode (signature checked)`
      : `  QuickNode:       off (add QN_STREAM_SECRET to seller/.env)`,
  );
  console.log(`Payments go to ${SELLER_ADDRESS}, verified by ${GATEWAY_API_URL}`);
});
