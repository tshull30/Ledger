# How to start Leash Agent

Leash runs as four programs, each in its own Terminal window. Open a new window with **Cmd + N**. Run each command exactly as written, one line at a time.

| Window | What it is | Needed for |
|---|---|---|
| 1 | Research feed server | Selling research, receiving QuickNode events |
| 2 | Tunnel | Grok Bot and QuickNode (they need a public address) |
| 3 | Dashboard | Watching and controlling everything |
| 4 | Agent | Checking markets and trading on its own |

---

## Every time

### Window 1: research feed server
```bash
cd ~/Documents/oracle-agent/seller && npm start
```
Ready when it says `Research feed running on http://localhost:4021`.

### Window 2: tunnel (optional)
```bash
~/cloudflared tunnel --url http://localhost:4021
```
Copy the `https://....trycloudflare.com` address it prints. **It's different every time**, so after starting it:
- **QuickNode:** in the QuickNode dashboard, set the Stream's destination to `NEW-ADDRESS/webhooks/quicknode`.
- **Grok Bot:** open `NEW-ADDRESS/login` in Chrome, log in with your ingest key, and give Grok Bot the new address.

To print your ingest key:
```bash
cd ~/Documents/oracle-agent/seller && grep ^INGEST_KEY .env
```

### Window 3: dashboard
```bash
cd ~/Documents/oracle-agent/agent && npm run dashboard
```
Then open **http://localhost:4030** in your browser.

Never send the dashboard through the tunnel. It holds your owner key and only works on your own Mac.

### Window 4: the agent
Keep it running (checks every 15 minutes):
```bash
cd ~/Documents/oracle-agent/agent && npm start
```
Or run a single check right now:
```bash
cd ~/Documents/oracle-agent/agent && npm run once
```

---

## What to do on the dashboard

- **Find a market:** pick a category, search, then click **Ask Claude** to see its estimate. Nothing is traded. Click **Watch** to add the market to the agent's checks (this also allows it in your contract).
- **Waiting for your approval:** big trades appear at the top. Click **Approve** or **Decline**. Both are recorded on Arc.
- **Pause spending:** the kill switch. The contract refuses everything until you click **Resume spending**.
- **Live from Arc:** your contract's events, pushed by QuickNode. Needs windows 1 and 2.

---

## Quick demo (for the video)

1. Start windows 1, 3, and 4. Add window 2 if you want to show QuickNode notifications or Grok Bot.
2. On the dashboard, search **economics**, click **Ask Claude** on a market, and read out its verdict.
3. Click **Watch** on that market.
4. In window 4, run `npm run once` and watch the new call appear on the dashboard.
5. If a trade needs approval: show the Mac notification, then click **Approve** on the dashboard.
6. Click **View contract on Arcscan** to show it all happened onchain.

---

## Stopping

Click into each window and press **Ctrl + C**.

---

## If something goes wrong

| What you see | What to do |
|---|---|
| `command not found: npm` | Quit Terminal fully (**Cmd + Q**), reopen it, and try again |
| `Cannot find module ...` | Run `npm install` in that folder (`seller` or `agent`), then try again |
| `EPERM` / `operation not permitted` | Run `cd ~`, then the command again. Still failing? System Settings → Privacy & Security → Files and Folders → Terminal → turn on Documents |
| Dashboard says it can't reach the server | Window 3 stopped. Run `npm run dashboard` again |
| Bad gateway on the tunnel address | Window 1 isn't running. Start the feed server |
| `Missing ANTHROPIC_API_KEY` | Your Claude key isn't in `agent/.env` |
| `Payment verification failed` | The feed server needs the testnet fix. Check `grep -c gateway-api-testnet ~/Documents/oracle-agent/seller/src/server.ts` prints 1 |
| QuickNode feed says "isn't connected yet" | Add `QN_STREAM_SECRET` to `seller/.env` (see `seller/quicknode/README.md`) and restart window 1 |
| `Port 4021 / 4030 already in use` | That program is already running in another window. Use that one, or close it with Ctrl + C |

---

## Never share

Anything in a `.env` file: private keys, your Claude key, your ingest key, your QuickNode security token. The `.gitignore` keeps them off GitHub; don't paste them anywhere else either.

**Safe to share:** wallet addresses (`0x...`), your contract address, and your tunnel address.
