// Tiny JSON-file database. Good enough for a hackathon; swap for SQLite/Postgres later.
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { Sale } from "./x402.js";
import type { ChainEvent } from "./quicknode.js";

/** What Grok Bot (or anyone with the ingest key) submits. */
export const ReportInput = z.object({
  topic: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9-]{2,60}$/, "topic must be a short slug like fed-jan-cut"),
  title: z.string().trim().min(3).max(200),
  market: z.string().trim().max(80).optional(), // Gemini instrument symbol, if it relates to one
  summary: z.string().trim().min(20).max(4000),
  sentiment: z.coerce.number().min(-1).max(1), // -1 very negative ... +1 very positive
  confidence: z.coerce.number().min(0).max(1), // how sure the researcher is
  postsAnalyzed: z.coerce.number().int().min(0).max(100000),
  sources: z.array(z.string().url()).max(20).default([]),
  researcher: z.string().trim().max(60).default("grok-bot"),
});
export type ReportInput = z.infer<typeof ReportInput>;
export type Report = ReportInput & { id: string; receivedAt: string };

interface Data {
  reports: Report[];
  sales: Sale[];
  chainEvents?: ChainEvent[];
}

export class Store {
  private data: Data = { reports: [], sales: [] };

  constructor(private file: string | null) {
    if (file && fs.existsSync(file)) {
      this.data = JSON.parse(fs.readFileSync(file, "utf8"));
    }
  }

  private save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
  }

  addReport(input: ReportInput): Report {
    const report: Report = {
      ...input,
      id: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      receivedAt: new Date().toISOString(),
    };
    this.data.reports.push(report);
    this.save();
    return report;
  }

  /** Newest first. */
  reportsFor(topic: string, limit = 10): Report[] {
    return this.data.reports
      .filter((r) => r.topic === topic)
      .slice(-limit)
      .reverse();
  }

  topics() {
    const byTopic = new Map<string, Report[]>();
    for (const r of this.data.reports) {
      byTopic.set(r.topic, [...(byTopic.get(r.topic) ?? []), r]);
    }
    return [...byTopic.entries()].map(([topic, rs]) => {
      const latest = rs[rs.length - 1];
      return {
        topic,
        title: latest.title,
        market: latest.market ?? null,
        reportCount: rs.length,
        latestAt: latest.receivedAt,
      };
    });
  }

  /** Adds events from QuickNode, skipping any we've already seen (Streams can redeliver). Returns the new ones. */
  addChainEvents(events: ChainEvent[]): ChainEvent[] {
    const list = (this.data.chainEvents ??= []);
    const seen = new Set(list.map((e) => e.key));
    const fresh = events.filter((e) => !seen.has(e.key));
    if (fresh.length) {
      list.push(...fresh);
      if (list.length > 500) list.splice(0, list.length - 500);
      this.save();
    }
    return fresh;
  }

  chainEvents(limit = 50): ChainEvent[] {
    return (this.data.chainEvents ?? []).slice(-limit).reverse();
  }

  addSale(sale: Sale) {
    this.data.sales.push(sale);
    this.save();
  }

  stats() {
    const sales = this.data.sales;
    const byEndpoint: Record<string, { count: number; usdc: number }> = {};
    for (const s of sales) {
      const key = s.endpoint.replace(/\/api\/reports\/[^/]+/, "/api/reports/:topic");
      byEndpoint[key] ??= { count: 0, usdc: 0 };
      byEndpoint[key].count++;
      byEndpoint[key].usdc = round(byEndpoint[key].usdc + s.amountUsdc);
    }
    return {
      totalEarnedUsdc: round(sales.reduce((a, s) => a + s.amountUsdc, 0)),
      salesCount: sales.length,
      uniqueBuyers: new Set(sales.map((s) => s.payer)).size,
      byEndpoint,
      recentSales: sales.slice(-20).reverse(),
      reportCount: this.data.reports.length,
    };
  }
}

const round = (n: number) => Math.round(n * 1e6) / 1e6;
