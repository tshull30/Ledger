// Lets the agent trade a market (owner only).
// Run:  npx hardhat run scripts/allow-market.js --network arcTestnet
// with MARKET set, e.g.  MARKET=GEMI-FEDJAN26-DN25 npx hardhat run ...
// To block a market again add ALLOW=false.
const { ethers } = require("hardhat");

async function main() {
  const market = process.env.MARKET;
  const allow = process.env.ALLOW !== "false";
  if (!market) throw new Error("Set MARKET=<Gemini instrumentSymbol>");
  if (!process.env.POLICY_ADDRESS) throw new Error("POLICY_ADDRESS missing from .env");

  const policy = await ethers.getContractAt("AgentPolicy", process.env.POLICY_ADDRESS);
  const tx = await policy.setTarget(market, allow);
  await tx.wait();
  console.log(`${allow ? "Allowed" : "Blocked"} ${market}  (tx ${tx.hash})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
