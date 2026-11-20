# O.D AI: free setup guide

O.D AI is a free website. You ask a question, it asks several AIs (Gemini, Llama on Groq, and Cloudflare AI), and it merges their answers into one.

Everything below uses free accounts. No credit card is needed.

```
od-ai/
├── public/              ← the website people see
│   ├── index.html
│   ├── favicon.svg, robots.txt, sitemap.xml
│   └── marked.min.js, purify.min.js   (formatting libraries)
└── functions/api/ask.js ← the hidden backend that talks to the AIs
```

Your API keys stay on Cloudflare's servers and never appear in the website code, so visitors cannot see or steal them.

---

## Step 1: Get two free API keys (about 5 minutes)

**Gemini (Google)**
1. Go to https://aistudio.google.com and sign in with a Google account.
2. Click **Get API key**, then **Create API key**.
3. Copy the key and keep it somewhere safe for now.

**Groq (runs Llama)**
1. Go to https://console.groq.com and sign up.
2. Open **API Keys**, then **Create API Key**.
3. Copy the key.

You don't need a key for Cloudflare AI. It comes with your Cloudflare account.

---

## Step 2: Put the code on GitHub

1. On https://github.com, create a new repository called `od-ai`. It can be public or private.
2. Click **Add file → Upload files** and drag in the **contents** of the `od-ai` folder (`public`, `functions`, `README.md`). Commit.

   Or, from a terminal inside the `od-ai` folder:
   ```bash
   git init && git add . && git commit -m "O.D AI"
   git branch -M main
   git remote add origin https://github.com/<your-username>/od-ai.git
   git push -u origin main
   ```

---

## Step 3: Publish on Cloudflare Pages

1. Sign up free at https://dash.cloudflare.com.
2. Go to **Workers & Pages → Create → Pages → Connect to Git**, and choose your `od-ai` repository.
3. Use these build settings:
   - **Project name:** `od-ai`. This gives you the address **od-ai.pages.dev**.
   - **Framework preset:** None
   - **Build command:** leave empty
   - **Build output directory:** `public`
4. Click **Save and Deploy**.

> If `od-ai` is already taken, pick another name, such as `odai-chat`. Then replace `od-ai.pages.dev` with your new address in `public/index.html` (4 places), `public/robots.txt` and `public/sitemap.xml`, and push again.

---

## Step 4: Connect the AIs (in your Pages project → Settings)

**Secrets** (under *Variables and Secrets*; choose type **Secret**):

| Name | Value |
|---|---|
| `GEMINI_API_KEY` | your Gemini key |
| `GROQ_API_KEY` | your Groq key |

**Bindings** (under *Bindings*):

| Type | Variable name | Value |
|---|---|---|
| Workers AI | `AI` | — |
| KV namespace | `OD_KV` | first create a namespace called `od-limits` under **Storage & Databases → KV**, then pick it here |

The KV binding is what enforces the daily limits. Without it, O.D still works, but there's no limit, so heavy use could exhaust your free quotas early in the day.

After saving, go to **Deployments**, then **Retry deployment** on the latest one, so the new settings take effect.

Open **https://od-ai.pages.dev** and ask a question in both Quick and Council modes. 🎉

---

## Step 5: Get found on Google

1. Go to https://search.google.com/search-console and add a property of the **URL prefix** type, using `https://od-ai.pages.dev/`.
2. Choose **HTML file** verification. Google gives you a small file such as `google1234abcd.html`. Put it in the `public/` folder, push to GitHub (Cloudflare redeploys automatically), then click **Verify**.
3. In Search Console, open **Sitemaps** and submit `sitemap.xml`.
4. Paste your address into the top search bar and click **Request indexing**.

It usually takes days to a few weeks before O.D AI shows up in search. Sharing the link (WhatsApp groups, LinkedIn, the college website) helps Google find and rank it faster.

---

## Optional settings (Settings → Variables, type Text)

| Name | Default | What it does |
|---|---|---|
| `DAILY_PER_USER` | `25` | Questions per visitor per day (Council counts as 2) |
| `DAILY_TOTAL` | `600` | Questions for the whole site per day |
| `GEMINI_MODEL` | `gemini-2.5-flash` | Change if Google retires this model |
| `GROQ_MODEL` | `llama-3.3-70b-versatile` | Change if Groq retires this model |
| `CF_MODEL` | `@cf/meta/llama-3.1-8b-instruct` | Cloudflare AI model |

---

## If something goes wrong

- **"All AI services are busy"**: a free daily quota is used up, or a model name has been retired. Check the current model names at https://ai.google.dev/gemini-api/docs/models and https://console.groq.com/docs/models, then set `GEMINI_MODEL` / `GROQ_MODEL`.
- **One card in Council mode says "busy, skipped"**: that one AI failed or hit its limit. O.D merges the others, so this is normal.
- **"O.D is not set up yet"**: the secrets weren't saved, or you didn't redeploy after adding them.
- **See the actual errors:** in your Pages project, open **Functions → Real-time logs**.

## Things to know

- On Google's free tier, Google may use the questions to improve its products. The site already tells visitors not to type personal information.
- O.D answers from what the AIs know. It does not search the live web yet.
- Free limits can change. If O.D gets popular, the limits are the first thing you'll hit.
