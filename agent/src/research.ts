// Buys research reports from our feed with x402, paying from the agent's Circle Gateway balance.
// When that balance runs low, the agent must ask the rules contract for a top-up (real USDC, real limits).
import { GatewayClient } from "@circle-fin/x402-batching/client";
import { config } from "./config.js";
import { Kind, type Policy } from "./policy.js";

export interface ResearchReport {
  id: string;
  topic: string;
  title: string;
  summary: string;
  sentiment: number;
  confidence: number;
  postsAnalyzed: number;
  researcher: string;
  receivedAt: string;
  pricePaid: string;
  paymentTx: string;
}

export class Research {
  readonly gateway: GatewayClient;

  constructor(private policy: Policy, privateKey: `0x${string}`) {
    this.gateway = new GatewayClient({ chain: "arcTestnet", privateKey });
  }

  async gatewayBalanceUsd() {
    const b = await this.gateway.getBalances();
    return Number(b.gateway.formattedAvailable);
  }

  /**
   * Make sure there's enough prepaid balance to buy data.
   * Asks the contract for a TOPUP; if approved, the contract sends USDC and we deposit it into Gateway.
   */
  async ensureBudget(log: (m: string) => void): Promise<boolean> {
    const bal = await this.gatewayBalanceUsd();
    if (bal >= config.gatewayMinUsd) return true;

    log(`Data budget low ($${bal.toFixed(4)}). Asking the contract for a $${config.gatewayTopUpUsd} top-up...`);
    const blocked = await this.policy.checkSpend(Kind.TOPUP, "gateway", config.gatewayTopUpUsd);
    if (blocked) {
      log(`  Top-up refused by contract: ${blocked}`);
      return false;
    }
    const req = await this.policy.requestSpend(Kind.TOPUP, "gateway", config.gatewayTopUpUsd, "Refill x402 research budget");
    if (req.status !== "Approved") {
      log(`  Top-up #${req.id} needs owner approval. Skipping research this cycle.`);
      return false;
    }
    const dep = await this.gateway.deposit(String(config.gatewayTopUpUsd));
    await this.policy.recordExecution(req.id, `gateway-deposit:${dep.depositTxHash}`);
    log(`  Top-up #${req.id} approved, deposited into Gateway (tx ${dep.depositTxHash})`);
    return true;
  }

  /** Buy the latest report on a topic. Returns null if there's nothing to buy. */
  async buyLatest(topic: string, log: (m: string) => void): Promise<ResearchReport | null> {
    const url = `${config.feedUrl}/api/reports/${encodeURIComponent(topic)}/latest`;

    // Free check first, so we never pay for an empty topic.
    const probe = await fetch(url).catch(() => null);
    if (!probe) {
      log(`  Research feed unreachable at ${config.feedUrl}`);
      return null;
    }
    if (probe.status === 404) {
      log(`  No research yet for "${topic}"`);
      return null;
    }
    if (probe.status !== 402) {
      log(`  Unexpected response from feed: ${probe.status}`);
      return null;
    }

    if (!(await this.ensureBudget(log))) return null;
    const result = await this.gateway.pay<Omit<ResearchReport, "pricePaid" | "paymentTx">>(url);
    log(`  Bought report "${result.data.title}" for $${result.formattedAmount}`);
    return { ...result.data, pricePaid: result.formattedAmount, paymentTx: result.transaction };
  }
}
