// x402 paywall for Express, settled through Circle Gateway on Arc testnet.
// Adapted from Circle's arc-nanopayments starter kit (Apache-2.0).
//
// How a paid request works:
//  1. Buyer calls the endpoint with no payment  -> we answer 402 + a PAYMENT-REQUIRED header
//     describing the price and where to pay.
//  2. Buyer signs a USDC authorization offchain (no gas) and retries with a PAYMENT-SIGNATURE header.
//  3. We ask Circle Gateway to verify and settle it, then serve the data.
//     Gateway batches many of these into one onchain settlement on Arc.
import type { Request, Response, NextFunction, RequestHandler } from "express";

export const ARC_TESTNET_NETWORK = "eip155:5042002";
export const ARC_TESTNET_USDC = "0x3600000000000000000000000000000000000000";
export const ARC_TESTNET_GATEWAY_WALLET = "0x0077777d7EBA4688BDeF3E311b846F25870A19B9";

/** The two calls we need from Circle's BatchFacilitatorClient (an interface so tests can fake it). */
export interface Facilitator {
  verify(payload: any, requirements: any): Promise<{ isValid: boolean; invalidReason?: string; payer?: string }>;
  settle(payload: any, requirements: any): Promise<{ success: boolean; errorReason?: string; payer?: string; transaction: string }>;
}

export interface Sale {
  endpoint: string;
  payer: string;
  amountUsdc: number;
  transaction: string;
  at: string;
}

export function buildRequirements(priceUsd: number, payTo: string) {
  return {
    scheme: "exact" as const,
    network: ARC_TESTNET_NETWORK,
    asset: ARC_TESTNET_USDC,
    amount: Math.round(priceUsd * 1_000_000).toString(), // USDC has 6 decimals
    payTo,
    maxTimeoutSeconds: 345600,
    extra: {
      name: "GatewayWalletBatched",
      version: "1",
      verifyingContract: ARC_TESTNET_GATEWAY_WALLET,
    },
  };
}

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64");

/**
 * Returns middleware that charges `priceUsd` before letting the request through.
 * `onSale` is called after Circle confirms settlement (we use it to track earnings).
 */
export function paywall(opts: {
  priceUsd: number;
  payTo: string;
  facilitator: Facilitator;
  description: string;
  onSale: (sale: Sale) => void;
}): RequestHandler {
  const requirements = buildRequirements(opts.priceUsd, opts.payTo);

  return async (req: Request, res: Response, next: NextFunction) => {
    const endpoint = req.originalUrl.split("?")[0];
    const signature = req.header("payment-signature");

    if (!signature) {
      const paymentRequired = {
        x402Version: 2,
        resource: { url: endpoint, description: opts.description, mimeType: "application/json" },
        accepts: [requirements],
      };
      res
        .status(402)
        .set("PAYMENT-REQUIRED", b64(paymentRequired))
        .json({ error: "Payment required", priceUsd: opts.priceUsd, network: "Arc testnet", asset: "USDC" });
      return;
    }

    try {
      const payload = JSON.parse(Buffer.from(signature, "base64").toString("utf-8"));

      const verified = await opts.facilitator.verify(payload, requirements);
      if (!verified.isValid) {
        console.warn(`[x402] verification failed for ${endpoint}: ${verified.invalidReason ?? "no reason given"}`);
        res.status(402).json({ error: "Payment verification failed", reason: verified.invalidReason });
        return;
      }

      const settled = await opts.facilitator.settle(payload, requirements);
      if (!settled.success) {
        console.warn(`[x402] settlement failed for ${endpoint}: ${settled.errorReason ?? "no reason given"}`);
        res.status(402).json({ error: "Payment settlement failed", reason: settled.errorReason });
        return;
      }

      const payer = settled.payer ?? verified.payer ?? "unknown";
      opts.onSale({
        endpoint,
        payer,
        amountUsdc: opts.priceUsd,
        transaction: settled.transaction ?? "",
        at: new Date().toISOString(),
      });
      res.set(
        "PAYMENT-RESPONSE",
        b64({ success: true, transaction: settled.transaction, network: ARC_TESTNET_NETWORK, payer }),
      );
      console.log(`[x402] +$${opts.priceUsd} from ${payer} for ${endpoint}`);
      next();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[x402] payment error:", message);
      res.status(500).json({ error: "Payment processing error", message });
    }
  };
}
