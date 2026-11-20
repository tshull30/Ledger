// Tests the QuickNode path end to end without QuickNode:
// build realistic Arc receipts -> run our Stream filter -> sign like QuickNode -> POST to the webhook.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { encodeAbiParameters, encodeEventTopics, parseAbi, pad, toHex } from "viem";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";

const POLICY = "0x18731C3e4dDe85e8D8fC14c67DFFe20e2e69B737";
const OTHER = "0x3600000000000000000000000000000000000000";
const SECRET = "qn-test-security-token-0123456789abcdef";
const abi = parseAbi([
  "event ApprovalRequired(uint256 indexed id, uint8 kind, string target, uint256 amount, string reason)",
  "event SpendApproved(uint256 indexed id, uint8 kind, string target, uint256 amount, bool byHuman)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

const log = (address: string, topics: readonly unknown[], data: string, i: number) => ({
  address, topics, data, blockNumber: "0x1a2b", transactionHash: "0x" + "ab".repeat(32), logIndex: toHex(i),
});
const approvalLog = log(
  POLICY,
  encodeEventTopics({ abi, eventName: "ApprovalRequired", args: { id: 2n } }),
  encodeAbiParameters([{ type: "uint8" }, { type: "string" }, { type: "uint256" }, { type: "string" }], [1, "GEMI-FED261211-HIKE25", 24_360_000n, "YES x27 @0.88: test"]),
  0,
);
const approvedLog = log(
  POLICY,
  encodeEventTopics({ abi, eventName: "SpendApproved", args: { id: 1n } }),
  encodeAbiParameters([{ type: "uint8" }, { type: "string" }, { type: "uint256" }, { type: "bool" }], [0, "gateway", 500_000n, false]),
  1,
);
// Noise the filter must drop: a USDC transfer from another contract.
const noiseLog = log(
  OTHER,
  encodeEventTopics({ abi, eventName: "Transfer", args: { from: OTHER, to: POLICY } }),
  pad(toHex(5_000_000n)),
  2,
);
const block = { block: { number: "0x1a2b" }, receipts: [{ transactionHash: "0x" + "ab".repeat(32), blockNumber: "0x1a2b", logs: [approvalLog, approvedLog, noiseLog] }] };

// Load filter.js exactly as QuickNode would run it.
function runFilter(streamData: unknown) {
  const code = fs.readFileSync(new URL("../quicknode/filter.js", import.meta.url), "utf8");
  const ctx: Record<string, unknown> = {};
  vm.runInNewContext(code + "\nresult = main(input);", Object.assign(ctx, { input: { data: streamData, metadata: {} } }));
  return ctx.result == null ? null : (JSON.parse(JSON.stringify(ctx.result)) as { events: any[] });
}

const sign = (body: string) => {
  const nonce = "n" + Math.random().toString(36).slice(2), ts = String(Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", SECRET).update(nonce + ts + body).digest("hex");
  return { "content-type": "application/json", "x-qn-nonce": nonce, "x-qn-timestamp": ts, "x-qn-signature": sig };
};

let base = "", server: Server, store: Store;
before(() => {
  store = new Store(null);
  const app = createApp({
    store, sellerAddress: "0x1111111111111111111111111111111111111111", ingestKey: "ingest-key-0123456789",
    facilitator: { verify: async () => ({ isValid: false }), settle: async () => ({ success: false, transaction: "" }) },
    quicknodeSecret: SECRET,
  });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

test("filter keeps only our contract's events and drops other contracts", () => {
  const out = runFilter([block]);
  assert.ok(out);
  assert.deepEqual(out!.events.map((e) => e.name), ["ApprovalRequired", "SpendApproved"]);
  assert.equal(out!.events[0].blockNumber, 0x1a2b);
});

test("filter handles the other payload shape and returns null when nothing matches", () => {
  assert.equal(runFilter({ receipts: [{ logs: [noiseLog] }] }), null);
  assert.equal(runFilter([[{ logs: [approvalLog] }]])!.events.length, 1);
});

test("webhook refuses a delivery with a forged signature", async () => {
  const body = JSON.stringify(runFilter([block]));
  const headers = { ...sign(body), "x-qn-signature": "0".repeat(64) };
  const res = await fetch(`${base}/webhooks/quicknode`, { method: "POST", headers, body });
  assert.equal(res.status, 401);
  assert.equal(store.chainEvents().length, 0);
});

test("webhook accepts a signed delivery, decodes it, and ignores redelivery", async () => {
  const body = JSON.stringify(runFilter([block]));
  const first = await (await fetch(`${base}/webhooks/quicknode`, { method: "POST", headers: sign(body), body })).json();
  assert.deepEqual(first, { ok: true, received: 2, new: 2 });
  const again = await (await fetch(`${base}/webhooks/quicknode`, { method: "POST", headers: sign(body), body })).json();
  assert.equal(again.new, 0);

  const { events, streaming } = await (await fetch(`${base}/events`)).json();
  assert.equal(streaming, true);
  const approval = events.find((e: any) => e.name === "ApprovalRequired");
  assert.equal(approval.requestId, 2);
  assert.equal(approval.amountUsd, 24.36);
  assert.match(approval.text, /needs your approval: \$24\.36 for a trade on GEMI-FED261211-HIKE25/);
  assert.match(events.find((e: any) => e.name === "SpendApproved").text, /approved request #1 automatically/);
});

test("webhook also accepts a batched array of deliveries", async () => {
  const body = JSON.stringify([{ events: [{ ...runFilter([block])!.events[0], logIndex: 9, transactionHash: "0x" + "cd".repeat(32) }] }]);
  const out = await (await fetch(`${base}/webhooks/quicknode`, { method: "POST", headers: sign(body), body })).json();
  assert.equal(out.new, 1);
});
