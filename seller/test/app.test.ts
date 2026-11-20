// Run:  npm test
// Uses a fake Circle facilitator, so no network or funds needed.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { createApp } from "../src/app.js";
import { Store } from "../src/store.js";
import type { Facilitator } from "../src/x402.js";

const KEY = "test-ingest-key-1234567890";
const SELLER = "0x1111111111111111111111111111111111111111";
let base = "";
let server: Server;
let store: Store;
let nextVerify = true;

const fakeFacilitator: Facilitator = {
  async verify() {
    return nextVerify ? { isValid: true, payer: "0xBuyer" } : { isValid: false, invalidReason: "bad_signature" };
  },
  async settle() {
    return { success: true, payer: "0xBuyer", transaction: "0xtx" };
  },
};

const report = {
  topic: "fed-jan-cut",
  title: "X sentiment: Fed January cut",
  summary: "Most accounts expect a hold; a minority argues for a cut after weak jobs data.",
  sentiment: -0.3,
  confidence: 0.6,
  postsAnalyzed: 120,
  sources: ["https://x.com/someone/status/1"],
};
const fakePayment = Buffer.from(JSON.stringify({ x402Version: 2, payload: {} })).toString("base64");

before(async () => {
  store = new Store(null);
  const app = createApp({ store, facilitator: fakeFacilitator, sellerAddress: SELLER, ingestKey: KEY });
  server = app.listen(0);
  base = `http://localhost:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const post = (path: string, body: unknown, key = KEY) =>
  fetch(base + path, { method: "POST", headers: { "content-type": "application/json", "x-ingest-key": key }, body: JSON.stringify(body) });

test("rejects ingest without the right key", async () => {
  const res = await post("/ingest/report", report, "wrong-key-wrong-key-wrong");
  assert.equal(res.status, 401);
});

test("rejects a malformed report", async () => {
  const res = await post("/ingest/report", { ...report, sentiment: 5 });
  assert.equal(res.status, 400);
});

test("paid route 404s (free) before any report exists", async () => {
  const res = await fetch(`${base}/api/reports/fed-jan-cut/latest`);
  assert.equal(res.status, 404);
});

test("accepts a valid report and lists it in the catalog", async () => {
  const res = await post("/ingest/report", report);
  assert.equal(res.status, 201);
  const catalog = await (await fetch(`${base}/catalog`)).json();
  assert.equal(catalog.topics[0].topic, "fed-jan-cut");
  assert.equal(catalog.payment.payTo, SELLER);
});

test("accepts a report through the web form", async () => {
  const form = new URLSearchParams({
    key: KEY, topic: "btc-100k", title: "BTC 100k chatter", summary: "Lots of excitement after ETF inflows, some caution.",
    sentiment: "0.5", confidence: "0.4", postsAnalyzed: "50", sources: "https://x.com/a/status/1\nhttps://x.com/b/status/2",
  });
  const res = await fetch(`${base}/submit`, { method: "POST", body: form });
  assert.equal(res.status, 200);
  assert.equal(store.reportsFor("btc-100k")[0].sources.length, 2);
});

test("asks for payment with a proper x402 402 response", async () => {
  const res = await fetch(`${base}/api/reports/fed-jan-cut/latest`);
  assert.equal(res.status, 402);
  const required = JSON.parse(Buffer.from(res.headers.get("payment-required")!, "base64").toString());
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts[0].amount, "10000"); // $0.01 in USDC base units
  assert.equal(required.accepts[0].payTo, SELLER);
  assert.equal(required.accepts[0].network, "eip155:5042002");
});

test("rejects a payment that fails verification and records no sale", async () => {
  nextVerify = false;
  const res = await fetch(`${base}/api/reports/fed-jan-cut/latest`, { headers: { "payment-signature": fakePayment } });
  nextVerify = true;
  assert.equal(res.status, 402);
  assert.equal(store.stats().salesCount, 0);
});

test("serves the report after payment and records earnings", async () => {
  const res = await fetch(`${base}/api/reports/fed-jan-cut/latest`, { headers: { "payment-signature": fakePayment } });
  assert.equal(res.status, 200);
  assert.ok(res.headers.get("payment-response"));
  const body = await res.json();
  assert.equal(body.title, report.title);

  await fetch(`${base}/api/reports/fed-jan-cut/history`, { headers: { "payment-signature": fakePayment } });
  const stats = await (await fetch(`${base}/stats`)).json();
  assert.equal(stats.salesCount, 2);
  assert.equal(stats.totalEarnedUsdc, 0.06);
  assert.equal(stats.byEndpoint["/api/reports/:topic/latest"].count, 1);
});

test("form refuses a submission with no key and no login", async () => {
  const form = new URLSearchParams({ topic: "x-test", title: "t t t", summary: "a summary long enough to pass.", sentiment: "0", confidence: "0.5", postsAnalyzed: "1" });
  const res = await fetch(`${base}/submit`, { method: "POST", body: form });
  assert.equal(res.status, 401);
});

test("wrong key can't log in", async () => {
  const res = await fetch(`${base}/login`, { method: "POST", body: new URLSearchParams({ key: "nope" }), redirect: "manual" });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("set-cookie"), null);
});

test("after logging in once, the form works without the key", async () => {
  const login = await fetch(`${base}/login`, { method: "POST", body: new URLSearchParams({ key: KEY }), redirect: "manual" });
  assert.equal(login.status, 302);
  const cookie = login.headers.get("set-cookie")!.split(";")[0];
  assert.match(login.headers.get("set-cookie")!, /HttpOnly/);

  const page = await (await fetch(`${base}/submit`, { headers: { cookie } })).text();
  assert.match(page, /Logged in/);
  assert.doesNotMatch(page, /name="key"/);

  const form = new URLSearchParams({ topic: "grok-test", title: "Logged-in submit", summary: "Submitted with a session cookie, no key.", sentiment: "0.2", confidence: "0.5", postsAnalyzed: "5" });
  const res = await fetch(`${base}/submit`, { method: "POST", body: form, headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(store.reportsFor("grok-test").length, 1);
});

test("a forged session cookie is rejected", async () => {
  const form = new URLSearchParams({ topic: "forged", title: "t t t", summary: "a summary long enough to pass.", sentiment: "0", confidence: "0.5", postsAnalyzed: "1" });
  const res = await fetch(`${base}/submit`, { method: "POST", body: form, headers: { cookie: `oa_session=${Date.now()}.deadbeef` } });
  assert.equal(res.status, 401);
});
