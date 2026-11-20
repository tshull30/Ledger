// Buys a report from the feed with a real x402 payment on Arc testnet.
// This is exactly what the agent will do later.
// Run:  npm run buy -- fed-jan-cut
import "dotenv/config";
import { GatewayClient } from "@circle-fin/x402-batching/client";

const topic = process.argv[2] ?? "fed-jan-cut";
const base = process.env.SELLER_URL ?? `http://localhost:${process.env.PORT ?? 4021}`;
const key = process.env.BUYER_PRIVATE_KEY as `0x${string}` | undefined;
if (!key) {
  console.error("BUYER_PRIVATE_KEY missing in seller/.env");
  process.exit(1);
}

const gateway = new GatewayClient({ chain: "arcTestnet", privateKey: key });
console.log(`Buyer: ${gateway.address ?? "(agent wallet)"}`);

// Payments come out of a prepaid Gateway balance. Top it up if it's low.
let balances = await gateway.getBalances();
console.log(`Wallet USDC: ${balances.wallet.formatted}   Gateway balance: ${balances.gateway.formattedAvailable}`);
if (balances.gateway.available < 100_000n) {
  // < $0.10
  console.log("Gateway balance low, depositing 0.5 USDC (one onchain tx)...");
  const dep = await gateway.deposit("0.5");
  console.log(`  deposit tx: ${dep.depositTxHash}`);
  balances = await gateway.getBalances();
  console.log(`  Gateway balance now: ${balances.gateway.formattedAvailable}`);
}

const result = await gateway.pay(`${base}/api/reports/${topic}/latest`);
console.log(`\nPaid ${result.formattedAmount} USDC (status ${result.status})`);
console.log(JSON.stringify(result.data, null, 2));
