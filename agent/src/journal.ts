// Every cycle's decision is appended to agent/data/decisions.jsonl (one JSON object per line).
// The dashboard will read this file.
import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export function writeEntry(entry: Record<string, unknown>) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const line = JSON.stringify(entry, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  fs.appendFileSync(path.join(config.dataDir, "decisions.jsonl"), line + "\n");
}

export function readEntries(): Record<string, unknown>[] {
  const file = path.join(config.dataDir, "decisions.jsonl");
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}
