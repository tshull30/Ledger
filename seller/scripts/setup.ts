// One-time setup: creates seller/.env with
//   SELLER_ADDRESS / SELLER_PRIVATE_KEY  - wallet that receives payments
//   INGEST_KEY                           - secret Grok Bot uses to submit reports
//   BUYER_PRIVATE_KEY                    - copied from the agent wallet in contracts/.env (for test purchases)
// Run:  npm run setup
import fs from "node:fs";
import { randomBytes } from "node:crypto";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const envPath = new URL("../.env", import.meta.url);
if (fs.existsSync(envPath) && fs.readFileSync(envPath, "utf8").includes("SELLER_PRIVATE_KEY=0x")) {
  console.log("seller/.env already set up. Delete it first if you really want new keys.");
  process.exit(0);
}

const sellerKey = generatePrivateKey();
const seller = privateKeyToAccount(sellerKey);
const ingestKey = randomBytes(24).toString("hex");

let buyerKey = "";
const contractsEnv = new URL("../../contracts/.env", import.meta.url);
if (fs.existsSync(contractsEnv)) {
  buyerKey = fs.readFileSync(contractsEnv, "utf8").match(/^AGENT_PRIVATE_KEY=(0x[0-9a-fA-F]{64})/m)?.[1] ?? "";
}

fs.writeFileSync(
  envPath,
  [
    "# TESTNET ONLY. Never commit this file.",
    `SELLER_ADDRESS=${seller.address}`,
    `SELLER_PRIVATE_KEY=${sellerKey}`,
    `INGEST_KEY=${ingestKey}`,
    `BUYER_PRIVATE_KEY=${buyerKey}`,
    "PORT=4021",
    "",
  ].join("\n"),
);

console.log("Created seller/.env\n");
console.log(`  Seller wallet (receives payments): ${seller.address}`);
console.log(`  Ingest key (give this to Grok Bot): ${ingestKey}`);
console.log(buyerKey ? "  Buyer key: copied from the agent wallet in contracts/.env" : "  Buyer key: not found. Run contracts/scripts/generate-wallets.js first, then paste AGENT_PRIVATE_KEY into BUYER_PRIVATE_KEY.");
console.log("\nThe seller wallet does not need any funds to receive payments.");
