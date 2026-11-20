// Receives the QuickNode Stream (see quicknode/filter.js) and turns raw logs into readable events.
//
// Every delivery is signed: X-QN-Signature = hex HMAC-SHA256(securityToken, nonce + timestamp + body).
// We reject anything that doesn't verify, so nobody else can post fake "approval needed" events.
import { createHmac, timingSafeEqual } from "node:crypto";
import { execFile } from "node:child_process";
import { decodeEventLog, parseAbi, type Hex } from "viem";

const abi = parseAbi([
  "event SpendRequested(uint256 indexed id, uint8 kind, string target, uint256 amount, string reason)",
  "event ApprovalRequired(uint256 indexed id, uint8 kind, string target, uint256 amount, string reason)",
  "event SpendApproved(uint256 indexed id, uint8 kind, string target, uint256 amount, bool byHuman)",
  "event SpendRejected(uint256 indexed id, string why)",
  "event SpendExecuted(uint256 indexed id, string executionRef)",
  "event Paused(bool paused)",
  "event LimitsChanged(uint256 perRequestCap, uint256 dailyCap, uint256 approvalThreshold)",
]);

export interface ChainEvent {
  key: string; // txHash:logIndex, for de-duplication (Streams may redeliver)
  name: string;
  blockNumber: number;
  transactionHash: string;
  receivedAt: string;
  requestId: number | null;
  kind: "TOPUP" | "TRADE" | null;
  target: string | null;
  amountUsd: number | null;
  text: string; // one plain sentence describing what happened
}

export function verifySignature(secret: string, rawBody: Buffer, headers: Record<string, unknown>) {
  const nonce = String(headers["x-qn-nonce"] ?? "");
  const ts = String(headers["x-qn-timestamp"] ?? "");
  const sig = String(headers["x-qn-signature"] ?? "");
  if (!secret || !nonce || !ts || !/^[0-9a-fA-F]{64}$/.test(sig)) return false;
  const expected = createHmac("sha256", secret)
    .update(Buffer.concat([Buffer.from(nonce, "latin1"), Buffer.from(ts, "latin1"), rawBody]))
    .digest();
  const given = Buffer.from(sig, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const usd = (v: bigint) => Number(v) / 1_000_000;
const money = (n: number) => `$${n.toFixed(2)}`;

/** Turn one filtered log into a readable event. Returns null for anything we can't decode. */
export function decode(raw: {
  topics: Hex[];
  data: Hex;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}): ChainEvent | null {
  let ev;
  try {
    ev = decodeEventLog({ abi, topics: raw.topics as [Hex, ...Hex[]], data: raw.data });
  } catch {
    return null;
  }
  const a = ev.args as Record<string, unknown>;
  const id = a.id !== undefined ? Number(a.id) : null;
  const kind = a.kind === undefined ? null : Number(a.kind) === 0 ? "TOPUP" : "TRADE";
  const target = (a.target as string) ?? null;
  const amount = typeof a.amount === "bigint" ? usd(a.amount) : null;
  const what = kind === "TOPUP" ? "a research budget refill" : target ? `a trade on ${target}` : "a request";

  const text = {
    SpendRequested: `The agent asked for ${money(amount ?? 0)} for ${what}.`,
    ApprovalRequired: `Request #${id} needs your approval: ${money(amount ?? 0)} for ${what}.`,
    SpendApproved: a.byHuman ? `You approved request #${id}.` : `The contract approved request #${id} automatically.`,
    SpendRejected: `Request #${id} was declined: ${a.why}.`,
    SpendExecuted: `Request #${id} was carried out (${a.executionRef}).`,
    Paused: a.paused ? "Spending was paused." : "Spending was resumed.",
    LimitsChanged: `Limits changed: ${money(usd(a.perRequestCap as bigint))} per request, ${money(usd(a.dailyCap as bigint))} a day, approval at ${money(usd(a.approvalThreshold as bigint))}.`,
  }[ev.eventName];

  return {
    key: `${raw.transactionHash}:${raw.logIndex}`,
    name: ev.eventName,
    blockNumber: raw.blockNumber,
    transactionHash: raw.transactionHash,
    receivedAt: new Date().toISOString(),
    requestId: id,
    kind,
    target,
    amountUsd: amount,
    text,
  };
}

/** macOS notification for things that need a human. Silently does nothing elsewhere. */
export function notify(ev: ChainEvent) {
  if (process.platform !== "darwin" || process.env.NOTIFY === "0") return;
  if (ev.name !== "ApprovalRequired") return;
  const clean = (s: string) => s.replace(/["\\]/g, "");
  const script = `display notification "${clean(ev.text)}" with title "Oracle Agent needs your OK" sound name "Glass"`;
  execFile("osascript", ["-e", script], () => {});
}
