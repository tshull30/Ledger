// Loads settings from the three .env files so you don't have to copy keys around:
//   contracts/.env  -> wallets + POLICY_ADDRESS
//   seller/.env     -> feed server port
//   agent/.env      -> Claude key, Gemini keys, watchlist, trading settings
import { config as load } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..");
load({ path: path.join(root, "agent", ".env"), quiet: true });
load({ path: path.join(root, "contracts", ".env"), quiet: true });
load({ path: path.join(root, "seller", ".env"), quiet: true });

const env = process.env;
const num = (v: string | undefined, d: number) => (v === undefined || v === "" ? d : Number(v));

export type TradeMode = "paper" | "sandbox" | "live";

export interface WatchItem {
  symbol: string; // Gemini instrumentSymbol (must also be allowed in the contract)
  topic: string; // research topic slug in the feed (e.g. fed-jan-cut)
}

/** WATCHLIST format:  SYMBOL=topic,SYMBOL2=topic2 */
function parseWatchlist(raw: string | undefined): WatchItem[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair) => {
      const [symbol, topic] = pair.split("=").map((x) => x.trim());
      if (!symbol || !topic) throw new Error(`Bad WATCHLIST entry "${pair}". Use SYMBOL=topic`);
      return { symbol, topic };
    });
}

export const config = {
  root,
  dataDir: path.join(root, "agent", "data"),

  // Arc
  arcRpcUrl: env.ARC_RPC_URL || "https://rpc.testnet.arc.network",
  agentPrivateKey: env.AGENT_PRIVATE_KEY as `0x${string}` | undefined,
  ownerPrivateKey: env.DEPLOYER_PRIVATE_KEY as `0x${string}` | undefined,
  policyAddress: env.POLICY_ADDRESS as `0x${string}` | undefined,

  // Research feed (our seller server)
  feedUrl: env.FEED_URL || `http://localhost:${env.PORT || 4021}`,
  gatewayTopUpUsd: num(env.GATEWAY_TOPUP_USD, 0.5), // how much to request when the data budget runs low
  gatewayMinUsd: num(env.GATEWAY_MIN_USD, 0.05),

  // Claude
  anthropicApiKey: env.ANTHROPIC_API_KEY,
  claudeModel: env.CLAUDE_MODEL || "claude-sonnet-5-5",

  // Gemini
  tradeMode: (env.TRADE_MODE || "paper") as TradeMode,
  geminiApiKey: env.GEMINI_API_KEY,
  geminiApiSecret: env.GEMINI_API_SECRET,
  geminiFeeRate: num(env.GEMINI_FEE_RATE, 0.07), // fee = rate x min(P, 1-P) per contract; check gemini.com/fees

  // Strategy
  watchlist: parseWatchlist(env.WATCHLIST),
  minEdge: num(env.MIN_EDGE, 0.05), // need at least 5 cents of expected value per contract after fees
  minConfidence: num(env.MIN_CONFIDENCE, 0.5),
  maxStakeUsd: num(env.MAX_STAKE_USD, 25), // the contract enforces its own caps on top of this
  loopMinutes: num(env.LOOP_MINUTES, 15),
  approvalWaitMinutes: num(env.APPROVAL_WAIT_MINUTES, 10),
};

export function require<K extends keyof typeof config>(key: K, hint: string): NonNullable<(typeof config)[K]> {
  const v = config[key];
  if (v === undefined || v === null || v === "") {
    throw new Error(`Missing ${String(key)}. ${hint}`);
  }
  return v as NonNullable<(typeof config)[K]>;
}
