# Connecting Grok Bot

Grok Bot is the researcher. It reads X on a schedule, writes up what people are saying, and submits the report to our feed. Agents then pay to read it.

```
Grok Bot (reads X) ──submits──► our feed server ──sells via x402──► agents (ours + anyone's)
```

## 1. Give the server a public address

Grok Bot runs in the cloud, so it can't reach `localhost`. The quickest fix is a free Cloudflare tunnel (no account needed):

```bash
brew install cloudflared
npm start                                   # in one terminal (inside seller/)
cloudflared tunnel --url http://localhost:4021   # in a second terminal
```

It prints a URL like `https://something-random.trycloudflare.com`. That's your public address.

The URL changes every time you restart the tunnel. Update Grok Bot's instructions when it does, or deploy the server to Render or Railway later for a permanent URL.

## 2. Log in once in Chrome

Grok Bot can't send HTTP requests from its own workspace (outbound connections are blocked), and it won't type secret keys into forms. So it submits through the web form **in your Chrome**, and you log that browser in once:

1. In Chrome, open `https://YOUR-URL/login`.
2. Paste your ingest key (`grep ^INGEST_KEY seller/.env`) and click **Log in**.
3. You land on `/submit`, which now says **Logged in** and has no key field.

The login lasts 30 days, but it's tied to the URL. A new tunnel URL means logging in again.

## 3. Do a one-time task in Grok Bot

Start with a single run, check the result, and only then turn it into a routine. Paste this into Grok Bot, filling in the two blanks:

---

> You're the research analyst for my prediction-market project.
>
> **Task:** Research what people on X are saying about **whether the US Federal Reserve will cut interest rates at its January meeting**. Look at posts from the last 24 hours. Favor economists, macro analysts, and financial journalists. Ignore spam, bots, and engagement bait.
>
> **Then write a report with exactly these fields:**
> - topic: `fed-jan-cut`
> - title: one line, starting "X sentiment:"
> - summary: 3–6 sentences on the main views, how they're shifting, and any notable posts or news driving them. Plain facts, no hype.
> - sentiment: a number from -1 to 1, where 1 means X strongly expects a cut and -1 means X strongly expects no cut
> - confidence: a number from 0 to 1 for how clear the picture is
> - postsAnalyzed: roughly how many posts you looked at
> - sources: links to up to 10 of the most informative posts
>
> **Submit it** using the form at `https://YOUR-URL/submit` in my Chrome. I'm already logged in there, so the form won't ask for a key. Fill in every field and click **Submit report**. Don't try to send an HTTP request directly; your workspace can't reach this server.
>
> If you find too little recent discussion to say anything meaningful, don't submit. Tell me instead.
>
> When you're done, tell me the report ID the server returned.

---

## 4. Make it a routine

Once a single run works, ask Grok Bot to save it as a skill and run it on a schedule. During the demo every 15–30 minutes is plenty. Add more topics by copying the task with a new topic slug and question, ideally ones that match active Gemini markets. Find those at
`https://api.gemini.com/v1/prediction-markets/events?status=active`.

## 5. For the Grok Bot bounty

The bounty requires:
- **A Grok Bot chat export** showing how you set it up. Export the conversation from steps 3–4 and put it in `docs/grok-bot-chat-export`.
- **A 3–4 sentence README section** on Grok Bot's role. Draft:

  > Grok Bot is our research analyst. On a schedule, it reads X for live sentiment on topics tied to Gemini prediction markets and submits a structured report (summary, sentiment score, confidence, source posts) to our feed. Our feed sells each report for $0.01 in USDC on Arc via x402, so our trading agent, and any other agent, pays per report instead of needing an X API account. Without Grok Bot the agent would be trading on odds alone; with it, the agent trades on what people are saying right now.

## Notes

- The login cookie is signed with the ingest key and is `HttpOnly` and `SameSite=Lax`, so other websites can't submit reports through your browser. Changing the ingest key logs every browser out.
- The ingest key only lets someone **submit** reports. It can't move money. Still, don't post it publicly, and change it after the hackathon (delete the `INGEST_KEY` line in `seller/.env` and run `npm run setup` again).
- Don't scrape X yourself. It's against X's terms. Grok Bot is xAI's own tool, which is why it's the right way in.
- If Grok Bot can't submit to an outside server at all, the fallback is calling xAI's API with its `x_search` tool from our own server. That's the same feed, but it probably wouldn't count for the Grok Bot bounty.
