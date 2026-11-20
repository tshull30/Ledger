// Which markets the agent checks each cycle.
// = WATCHLIST in agent/.env  +  markets you add from the dashboard (saved in agent/data/watchlist.json).
import fs from "node:fs";
import path from "node:path";
import { config, type WatchItem } from "./config.js";

const file = () => path.join(config.dataDir, "watchlist.json");

function readAdded(): WatchItem[] {
  try {
    return JSON.parse(fs.readFileSync(file(), "utf8"));
  } catch {
    return [];
  }
}

export function getWatchlist(): WatchItem[] {
  const out = new Map<string, WatchItem>();
  for (const w of [...config.watchlist, ...readAdded()]) out.set(w.symbol, w);
  return [...out.values()];
}

/** A research topic slug for a market, e.g. GEMI-FED261211-HIKE25 -> gemi-fed261211-hike25 */
export function defaultTopic(symbol: string) {
  return symbol.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 60);
}

export function topicFor(symbol: string) {
  return getWatchlist().find((w) => w.symbol === symbol)?.topic ?? defaultTopic(symbol);
}

export function addToWatchlist(item: WatchItem) {
  const added = readAdded().filter((w) => w.symbol !== item.symbol);
  added.push(item);
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(added, null, 2));
}

/** Only removes markets added from the dashboard; ones in agent/.env stay until you edit the file. */
export function removeFromWatchlist(symbol: string) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(readAdded().filter((w) => w.symbol !== symbol), null, 2));
}

export const isFromEnv = (symbol: string) => config.watchlist.some((w) => w.symbol === symbol);
