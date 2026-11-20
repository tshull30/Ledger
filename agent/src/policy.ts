// Talks to the AgentPolicy rules contract on Arc.
// The agent can only ASK. The contract decides, and big requests wait for the owner.
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  parseEventLogs,
  type Chain,
  type Hex,
  keccak256,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arcTestnet, hardhat } from "viem/chains";
import { config } from "./config.js";

export const policyAbi = parseAbi([
  "function requestSpend(uint8 kind, string target, uint256 amount, string reason) returns (uint256)",
  "function recordExecution(uint256 id, string executionRef)",
  "function approve(uint256 id)",
  "function reject(uint256 id, string why)",
  "function getRequest(uint256 id) view returns ((uint8 kind, uint8 status, uint64 createdAt, uint256 amount, string target, string reason, string executionRef))",
  "function requestCount() view returns (uint256)",
  "function remainingToday() view returns (uint256)",
  "function perRequestCap() view returns (uint256)",
  "function approvalThreshold() view returns (uint256)",
  "function allowedTarget(bytes32) view returns (bool)",
  "function paused() view returns (bool)",
  "function setPaused(bool paused_)",
  "function setTarget(string target, bool allowed)",
  "function usdc() view returns (address)",
  "function dailyCap() view returns (uint256)",
  "event SpendRequested(uint256 indexed id, uint8 kind, string target, uint256 amount, string reason)",
  "event ApprovalRequired(uint256 indexed id, uint8 kind, string target, uint256 amount, string reason)",
  "event SpendApproved(uint256 indexed id, uint8 kind, string target, uint256 amount, bool byHuman)",
  "event SpendRejected(uint256 indexed id, string why)",
  "event SpendExecuted(uint256 indexed id, string executionRef)",
  "error NotOwner()",
  "error NotAgent()",
  "error IsPaused()",
  "error TargetNotAllowed()",
  "error OverPerRequestCap()",
  "error OverDailyCap()",
  "error BadStatus()",
  "error ZeroAmount()",
]);

export const Kind = { TOPUP: 0, TRADE: 1 } as const;
export const Status = ["None", "Pending", "Approved", "Rejected", "Executed"] as const;
export type StatusName = (typeof Status)[number];

/** USDC has 6 decimals in the ERC-20 interface. */
export const toUsdc6 = (usd: number) => BigInt(Math.round(usd * 1_000_000));
export const fromUsdc6 = (v: bigint) => Number(v) / 1_000_000;

export class Policy {
  readonly publicClient;
  readonly walletClient;
  readonly address: Hex;

  constructor(opts: { privateKey: Hex; address: Hex; rpcUrl?: string; chain?: Chain }) {
    // LOCAL_CHAIN=1 is only for testing against a local Hardhat node.
    const chain = opts.chain ?? (process.env.LOCAL_CHAIN ? hardhat : arcTestnet);
    const transport = http(opts.rpcUrl ?? config.arcRpcUrl);
    this.address = opts.address;
    this.publicClient = createPublicClient({ chain, transport });
    this.walletClient = createWalletClient({ chain, transport, account: privateKeyToAccount(opts.privateKey) });
  }

  /** Ask for permission. Returns the request id and whether it was approved instantly or is waiting for the owner. */
  async requestSpend(kind: number, target: string, usd: number, reason: string) {
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: policyAbi,
      functionName: "requestSpend",
      args: [kind, target, toUsdc6(usd), reason.slice(0, 280)],
    });
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new Error(`requestSpend reverted (tx ${hash})`);
    const logs = parseEventLogs({ abi: policyAbi, logs: receipt.logs });
    const requested = logs.find((l) => l.eventName === "SpendRequested");
    if (!requested) throw new Error(`No SpendRequested event (tx ${hash})`);
    const id = (requested.args as { id: bigint }).id;
    const approved = logs.some((l) => l.eventName === "SpendApproved");
    return { id, status: (approved ? "Approved" : "Pending") as StatusName, tx: hash };
  }

  /** Dry run: would this request revert? Returns the contract's error name, or null if it would pass. */
  async checkSpend(kind: number, target: string, usd: number): Promise<string | null> {
    try {
      await this.publicClient.simulateContract({
        account: this.walletClient.account,
        address: this.address,
        abi: policyAbi,
        functionName: "requestSpend",
        args: [kind, target, toUsdc6(usd), "dry-run"],
      });
      return null;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const known = ["NotAgent", "IsPaused", "TargetNotAllowed", "OverPerRequestCap", "OverDailyCap", "ZeroAmount"];
      return known.find((k) => msg.includes(k)) ?? msg.split("\n")[0];
    }
  }

  async status(id: bigint): Promise<StatusName> {
    const r = await this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "getRequest", args: [id] });
    return Status[r.status];
  }

  /** Wait for the owner to approve or reject (polls every few seconds). */
  async waitForDecision(id: bigint, timeoutMs: number, pollMs = 4000): Promise<StatusName> {
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const s = await this.status(id);
      if (s !== "Pending") return s;
      await new Promise((r) => setTimeout(r, pollMs));
    }
    return "Pending";
  }

  async recordExecution(id: bigint, ref: string) {
    const hash = await this.walletClient.writeContract({
      address: this.address,
      abi: policyAbi,
      functionName: "recordExecution",
      args: [id, ref.slice(0, 120)],
    });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async approve(id: bigint) {
    const hash = await this.walletClient.writeContract({ address: this.address, abi: policyAbi, functionName: "approve", args: [id] });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async reject(id: bigint, why: string) {
    const hash = await this.walletClient.writeContract({ address: this.address, abi: policyAbi, functionName: "reject", args: [id, why] });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async isAllowed(target: string) {
    return this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "allowedTarget", args: [keccak256(toBytes(target))] });
  }

  /** Owner only: let the agent trade this market (or block it again). */
  async setTarget(target: string, allowed: boolean) {
    const hash = await this.walletClient.writeContract({ address: this.address, abi: policyAbi, functionName: "setTarget", args: [target, allowed] });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  async setPaused(paused: boolean) {
    const hash = await this.walletClient.writeContract({ address: this.address, abi: policyAbi, functionName: "setPaused", args: [paused] });
    await this.publicClient.waitForTransactionReceipt({ hash });
    return hash;
  }

  /** USDC sitting in the contract (the agent's total budget pot). */
  async vaultBalanceUsd() {
    const token = await this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "usdc" });
    const bal = await this.publicClient.readContract({
      address: token,
      abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
      functionName: "balanceOf",
      args: [this.address],
    });
    return fromUsdc6(bal);
  }

  /** The most recent requests, newest first. */
  async recentRequests(limit = 25) {
    const count = await this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "requestCount" });
    const out = [];
    for (let i = count - 1n; i >= 0n && i >= count - BigInt(limit); i--) {
      const r = await this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "getRequest", args: [i] });
      out.push({
        id: Number(i),
        kind: r.kind === 0 ? "TOPUP" : "TRADE",
        status: Status[r.status],
        createdAt: new Date(Number(r.createdAt) * 1000).toISOString(),
        amountUsd: fromUsdc6(r.amount),
        target: r.target,
        reason: r.reason,
        executionRef: r.executionRef,
      });
    }
    return out;
  }

  async limits() {
    const [remaining, perRequest, threshold, paused, daily] = await Promise.all([
      this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "remainingToday" }),
      this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "perRequestCap" }),
      this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "approvalThreshold" }),
      this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "paused" }),
      this.publicClient.readContract({ address: this.address, abi: policyAbi, functionName: "dailyCap" }),
    ]);
    return {
      dailyCapUsd: fromUsdc6(daily),
      remainingTodayUsd: fromUsdc6(remaining),
      perRequestCapUsd: fromUsdc6(perRequest),
      approvalThresholdUsd: fromUsdc6(threshold),
      paused,
    };
  }
}
