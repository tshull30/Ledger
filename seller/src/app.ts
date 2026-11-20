import express, { type Request, type Response, type NextFunction } from "express";
import { timingSafeEqual } from "node:crypto";
import { Store, ReportInput } from "./store.js";
import { paywall, type Facilitator } from "./x402.js";
import { submitPage, loginPage } from "./submit-page.js";
import { decode, notify, verifySignature } from "./quicknode.js";
import { COOKIE_NAME, isValidSession, makeSession, readCookie, sessionCookie } from "./session.js";

export const PRICES = {
  latest: 0.01, // one fresh report
  history: 0.05, // last 10 reports on a topic (for spotting trends)
};

export function createApp(opts: {
  store: Store;
  facilitator: Facilitator;
  sellerAddress: string;
  ingestKey: string;
  quicknodeSecret?: string;
}) {
  const { store, facilitator, sellerAddress, ingestKey, quicknodeSecret } = opts;
  const app = express();

  // ------------------------------------------------------------- QuickNode Streams -> us
  // Registered before the JSON parser: the signature covers the exact raw bytes.
  // express.raw also un-gzips compressed deliveries; QuickNode signs the uncompressed body.
  app.post("/webhooks/quicknode", express.raw({ type: "*/*", limit: "5mb" }), (req, res) => {
    if (!quicknodeSecret) {
      res.status(503).json({ error: "QN_STREAM_SECRET is not set on this server" });
      return;
    }
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
    if (!verifySignature(quicknodeSecret, raw, req.headers)) {
      console.warn("[quicknode] rejected a delivery with a bad or missing signature");
      res.status(401).json({ error: "Bad signature" });
      return;
    }
    let payload: any;
    try {
      payload = JSON.parse(raw.toString("utf8"));
    } catch {
      res.status(400).json({ error: "Body is not JSON" });
      return;
    }
    // Our filter returns { events: [...] }; Streams may batch several of those into an array.
    const batches = Array.isArray(payload) ? payload : [payload];
    const decoded = batches
      .flatMap((b) => (Array.isArray(b?.events) ? b.events : []))
      .map(decode)
      .filter((e): e is NonNullable<typeof e> => e !== null);
    const fresh = store.addChainEvents(decoded);
    for (const e of fresh) {
      console.log(`[quicknode] block ${e.blockNumber}: ${e.text}`);
      notify(e);
    }
    res.json({ ok: true, received: decoded.length, new: fresh.length });
  });

  /** Free: contract activity as seen by the QuickNode Stream (public onchain data anyway). */
  app.get("/events", (_req, res) => {
    res.json({ streaming: Boolean(quicknodeSecret), events: store.chainEvents(50) });
  });

  app.use(express.json({ limit: "100kb" }));
  app.use(express.urlencoded({ extended: false, limit: "100kb" }));

  // ------------------------------------------------------------- free routes

  app.get("/", (_req, res) => {
    res.json({
      name: "Oracle Agent research feed",
      about: "Live sentiment research from X, gathered by Grok Bot. Pay per report in USDC on Arc via x402.",
      catalog: "/catalog",
    });
  });

  /** Free: what's for sale. Agents read this to discover topics and prices. */
  app.get("/catalog", (_req, res) => {
    res.json({
      payment: { protocol: "x402", network: "Arc testnet", asset: "USDC", payTo: sellerAddress },
      products: [
        { path: "/api/reports/{topic}/latest", priceUsd: PRICES.latest, description: "Newest research report on a topic" },
        { path: "/api/reports/{topic}/history", priceUsd: PRICES.history, description: "Last 10 reports, newest first" },
      ],
      topics: store.topics(),
    });
  });

  /** Free: earnings, for the dashboard. */
  app.get("/stats", (_req, res) => {
    res.json(store.stats());
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ------------------------------------------------------------- ingest (Grok Bot -> us)

  const requireKey = (req: Request, res: Response, next: NextFunction) => {
    const given = req.header("x-ingest-key") ?? (req.body?.key as string | undefined) ?? "";
    if (!safeEqual(given, ingestKey)) {
      res.status(401).json({ error: "Missing or wrong ingest key" });
      return;
    }
    next();
  };

  /** JSON API: Grok Bot (or a script) POSTs a report here. */
  app.post("/ingest/report", requireKey, (req, res) => {
    const parsed = ReportInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid report", issues: parsed.error.flatten().fieldErrors });
      return;
    }
    const report = store.addReport(parsed.data);
    console.log(`[ingest] ${report.topic}: "${report.title}" (sentiment ${report.sentiment})`);
    res.status(201).json({ ok: true, id: report.id });
  });

  // ------------------------------------------------------------- browser login (for Grok Bot)

  const loggedIn = (req: Request) => isValidSession(ingestKey, readCookie(req.header("cookie"), COOKIE_NAME));
  const isHttps = (req: Request) => req.secure || req.header("x-forwarded-proto") === "https";

  app.get("/login", (req, res) => {
    if (loggedIn(req)) return res.redirect("/submit");
    res.type("html").send(loginPage());
  });

  app.post("/login", (req, res) => {
    if (!safeEqual(String(req.body?.key ?? ""), ingestKey)) {
      res.status(401).type("html").send(loginPage("Wrong key."));
      return;
    }
    res.set("Set-Cookie", sessionCookie(makeSession(ingestKey), isHttps(req)));
    console.log("[login] a browser logged in for report submission");
    res.redirect("/submit");
  });

  app.get("/logout", (_req, res) => {
    res.set("Set-Cookie", `${COOKIE_NAME}=; Path=/; Max-Age=0`);
    res.redirect("/login");
  });

  /** Web form version. Logged-in browsers don't need the key, so Grok Bot can submit from yours. */
  app.get("/submit", (req, res) => {
    res.type("html").send(submitPage(loggedIn(req)));
  });

  const keyOrSession = (req: Request, res: Response, next: NextFunction) => {
    if (loggedIn(req)) return next();
    if (safeEqual(String(req.body?.key ?? ""), ingestKey)) return next();
    res.status(401).type("html").send(`<h1>Not logged in</h1><p><a href="/login">Log in</a> first, then submit again.</p>`);
  };

  app.post("/submit", keyOrSession, (req, res) => {
    const body = { ...req.body };
    body.sources = String(body.sources ?? "")
      .split(/\s+/)
      .map((s: string) => s.trim())
      .filter(Boolean);
    if (!body.market) delete body.market;
    const parsed = ReportInput.safeParse(body);
    if (!parsed.success) {
      res.status(400).type("html").send(`<h1>Not saved</h1><pre>${escapeHtml(JSON.stringify(parsed.error.flatten().fieldErrors, null, 2))}</pre><a href="/submit">Back</a>`);
      return;
    }
    const report = store.addReport(parsed.data);
    console.log(`[ingest:form] ${report.topic}: "${report.title}"`);
    res.type("html").send(`<h1>Report saved</h1><p>ID: ${report.id}</p><a href="/submit">Submit another</a>`);
  });

  // ------------------------------------------------------------- paid routes (agents -> us)

  // Don't charge for a topic we have nothing on.
  const requireTopic = (req: Request, res: Response, next: NextFunction) => {
    if (store.reportsFor(String(req.params.topic), 1).length === 0) {
      res.status(404).json({ error: "No reports for this topic yet", catalog: "/catalog" });
      return;
    }
    next();
  };

  const onSale = (s: Parameters<Store["addSale"]>[0]) => store.addSale(s);

  app.get(
    "/api/reports/:topic/latest",
    requireTopic,
    paywall({ priceUsd: PRICES.latest, payTo: sellerAddress, facilitator, onSale, description: "Latest X research report" }),
    (req, res) => {
      res.json(store.reportsFor(String(req.params.topic), 1)[0]);
    },
  );

  app.get(
    "/api/reports/:topic/history",
    requireTopic,
    paywall({ priceUsd: PRICES.history, payTo: sellerAddress, facilitator, onSale, description: "Last 10 X research reports" }),
    (req, res) => {
      res.json(store.reportsFor(String(req.params.topic), 10));
    },
  );

  return app;
}

function safeEqual(a: string, b: string) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
