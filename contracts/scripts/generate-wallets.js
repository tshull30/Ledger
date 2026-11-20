// Creates two fresh testnet wallets and writes them to .env:
//   OWNER  = you (deploys the contract, approves big trades)
//   AGENT  = the AI agent (can only ask; cannot approve)
// Run once:  node scripts/generate-wallets.js
const fs = require("fs");
const path = require("path");
const { Wallet } = require("ethers");

const envPath = path.join(__dirname, "..", ".env");
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
if (existing.includes("DEPLOYER_PRIVATE_KEY=0x")) {
  console.log(".env already has wallets. Delete them first if you really want new ones.");
  process.exit(0);
}

const owner = Wallet.createRandom();
const agent = Wallet.createRandom();

const lines = [
  "# TESTNET ONLY. Never put real funds in these wallets. Never commit this file.",
  `DEPLOYER_PRIVATE_KEY=${owner.privateKey}`,
  `OWNER_ADDRESS=${owner.address}`,
  `AGENT_PRIVATE_KEY=${agent.privateKey}`,
  `AGENT_ADDRESS=${agent.address}`,
  "ARC_RPC_URL=https://rpc.testnet.arc.network",
  "",
];
fs.writeFileSync(envPath, existing + (existing && !existing.endsWith("\n") ? "\n" : "") + lines.join("\n"));

console.log("Wallets written to .env\n");
console.log(`  Owner (you): ${owner.address}`);
console.log(`  Agent:       ${agent.address}\n`);
console.log("Next: go to https://faucet.circle.com, pick Arc Testnet,");
console.log("and request USDC for BOTH addresses (USDC is also the gas token on Arc).");
