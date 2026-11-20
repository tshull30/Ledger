// Owner tools: see waiting requests, approve or reject them.
// Uses the OWNER key (DEPLOYER_PRIVATE_KEY in contracts/.env). The agent's key can't do this.
//
//   npm run pending                    list requests waiting for you
//   npm run approve -- 3               approve request #3
//   npm run approve -- 3 reject "why"  reject request #3
import { config, require as need } from "../src/config.js";
import { Policy, policyAbi, Status, fromUsdc6 } from "../src/policy.js";

const ownerKey = need("ownerPrivateKey", "DEPLOYER_PRIVATE_KEY missing from contracts/.env");
const address = need("policyAddress", "POLICY_ADDRESS missing from contracts/.env");
const policy = new Policy({ privateKey: ownerKey, address });

const [cmd, idArg, action, ...why] = process.argv.slice(2);

if (cmd === "pending") {
  const count = await policy.publicClient.readContract({ address, abi: policyAbi, functionName: "requestCount" });
  let found = 0;
  for (let i = count - 1n; i >= 0n && i >= count - 50n; i--) {
    const r = await policy.publicClient.readContract({ address, abi: policyAbi, functionName: "getRequest", args: [i] });
    if (Status[r.status] !== "Pending") continue;
    found++;
    console.log(`#${i}  $${fromUsdc6(r.amount)}  ${r.target}\n     ${r.reason}`);
  }
  console.log(found ? `\nApprove with: npm run approve -- <id>` : "Nothing waiting for approval.");
} else if (cmd === "approve" && idArg) {
  const id = BigInt(idArg);
  if (action === "reject") {
    const tx = await policy.reject(id, why.join(" ") || "rejected by owner");
    console.log(`Rejected #${id} (tx ${tx})`);
  } else {
    const tx = await policy.approve(id);
    console.log(`Approved #${id} (tx ${tx})`);
  }
} else {
  console.log(`Usage:\n  npm run pending\n  npm run approve -- <id>\n  npm run approve -- <id> reject "reason"`);
}
void config;
