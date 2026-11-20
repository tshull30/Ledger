// Deploys AgentPolicy to Arc testnet and funds it with a small USDC budget.
// Run:  npx hardhat run scripts/deploy.js --network arcTestnet
const { ethers, network } = require("hardhat");

// USDC's ERC-20 interface on Arc testnet (6 decimals)
const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";

// Starting limits (change any time later with setLimits)
const PER_REQUEST_CAP = "50";     // $50 max per request
const DAILY_CAP = "100";          // $100 max per day
const APPROVAL_THRESHOLD = "20";  // $20+ needs your approval
const INITIAL_BUDGET = "5";       // USDC moved into the contract now

// Markets the agent is allowed to trade. Add real symbols from
// https://api.gemini.com/v1/prediction-markets/events?status=active
const ALLOWED_MARKETS = [];

async function main() {
  const usd = (n) => ethers.parseUnits(n, 6);
  const [owner] = await ethers.getSigners();
  const agent = process.env.AGENT_ADDRESS;
  if (!agent) throw new Error("AGENT_ADDRESS missing from .env. Run scripts/generate-wallets.js first.");

  console.log(`Network: ${network.name}`);
  console.log(`Owner:   ${owner.address}`);
  console.log(`Agent:   ${agent}`);

  const Policy = await ethers.getContractFactory("AgentPolicy");
  const policy = await Policy.deploy(
    ARC_TESTNET_USDC, agent, usd(PER_REQUEST_CAP), usd(DAILY_CAP), usd(APPROVAL_THRESHOLD)
  );
  await policy.waitForDeployment();
  const address = await policy.getAddress();
  console.log(`\nAgentPolicy deployed: ${address}`);
  console.log(`Explorer: https://testnet.arcscan.app/address/${address}`);

  for (const m of ALLOWED_MARKETS) {
    await (await policy.setTarget(m, true)).wait();
    console.log(`Allowed market: ${m}`);
  }

  const usdc = await ethers.getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", ARC_TESTNET_USDC);
  await (await usdc.transfer(address, usd(INITIAL_BUDGET))).wait();
  console.log(`Funded with ${INITIAL_BUDGET} USDC`);

  console.log(`\nAdd this line to your .env:\nPOLICY_ADDRESS=${address}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
