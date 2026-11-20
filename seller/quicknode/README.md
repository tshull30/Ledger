# QuickNode Stream setup

The Stream watches Arc testnet and pushes **only our rules contract's events** to the feed server. The server verifies QuickNode's signature, stores each event, shows it on the dashboard's "Live from Arc" feed, and pops up a Mac notification when a trade needs your approval.

## How it's configured, and why

| Setting | Value | Why |
|---|---|---|
| Network | Arc testnet | That's where the AgentPolicy contract lives |
| Dataset | Block with Receipts | Receipts carry the event logs the contract emits |
| Filter | `filter.js` in this folder | Keeps only logs where `address` is AgentPolicy **and** `topics[0]` is one of its 7 event signatures. Everything else on Arc is dropped, and blocks with nothing for us return `null`, so nothing is delivered. Each delivery is a few small JSON objects instead of a whole block. |
| Destination | Webhook: `https://YOUR-TUNNEL-URL/webhooks/quicknode` | The feed server is the one piece already reachable from the internet (through the tunnel) |
| Security | Stream security token, set as `QN_STREAM_SECRET` in `seller/.env` | The server checks `X-QN-Signature` = HMAC-SHA256(token, nonce + timestamp + body) and refuses anything that doesn't match, so nobody can post fake "approval needed" events |
| Payload compression | Off | Simplest; the server handles gzip either way |

**What it powers**
- **Instant approval alerts:** an `ApprovalRequired` event triggers a macOS notification within seconds of the block. No polling.
- **Live feed:** the dashboard shows every request, automatic approval, human approval, decline, execution, pause, and limit change, each linked to its block on Arcscan.
- **Audit trail:** events are de-duplicated by `txHash:logIndex` (Streams may redeliver) and saved in `seller/data/db.json`.

## Setup (about 10 minutes)

1. **Start the feed server and tunnel** if they aren't running:
   ```bash
   cd ~/Documents/oracle-agent/seller && npm start
   ~/cloudflared tunnel --url http://localhost:4021      # in another window
   ```
2. In the QuickNode dashboard: **Streams → Create Stream**
   - Chain: **Arc**, Network: **Testnet**
   - Dataset: **Block with Receipts**
   - Start from: **latest block**
3. **Filter:** choose "Customize your payload," clear the editor, and paste all of `filter.js`. Check that `POLICY` near the top is your contract address in lowercase (`0x18731c3e4dde85e8d8fc14c67dffe20e2e69b737`). Click **Run test**. Most test blocks return `null`, which is correct.
4. **Destination:** Webhook. URL: `https://YOUR-TUNNEL-URL/webhooks/quicknode`. Turn compression off.
5. **Copy the security token** shown for the destination (or in the Stream's settings), then in Terminal:
   ```bash
   cd ~/Documents/oracle-agent/seller
   read -s "T?Paste the QuickNode security token, then Enter: " && echo "QN_STREAM_SECRET=$T" >> .env && unset T && echo saved
   ```
   Restart the feed server (Ctrl + C, `npm start`). It should print `QuickNode: POST /webhooks/quicknode (signature checked)`.
6. **Create / start** the Stream.
7. **Test it:** make the agent ask for something. `npm run once` in `agent/` usually triggers a research top-up, or approve and decline something from the dashboard. Within a few seconds the server prints lines like:
   ```
   [quicknode] block 1234567: The agent asked for $0.50 for a research budget refill.
   ```
   and they appear under "Live from Arc" on the dashboard.

**If the tunnel restarts,** its URL changes. Edit the Stream's destination URL to the new one.
