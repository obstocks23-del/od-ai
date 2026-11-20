// O.D AI — backend (Cloudflare Pages Function)
// Route: POST /api/ask   body: { question, mode: "quick"|"council", history: [{role, content}] }
//
// Settings you add in Cloudflare (Settings → Variables and Secrets / Bindings):
//   GEMINI_API_KEY   secret   from Google AI Studio
//   GROQ_API_KEY     secret   from console.groq.com
//   AI               binding  Workers AI (no key needed)
//   OD_KV            binding  KV namespace, used for daily limits (optional but recommended)
// Optional plain variables:
//   GEMINI_MODEL (default gemini-2.5-flash)
//   GROQ_MODEL   (default llama-3.3-70b-versatile)
//   CF_MODEL     (default @cf/meta/llama-3.1-8b-instruct)
//   DAILY_PER_USER (default 25)   DAILY_TOTAL (default 600)

const SYSTEM =
  "You are a helpful, knowledgeable assistant. Answer accurately, clearly and concisely in Markdown. " +
  "Use headings or bullet points only when they help. If the question needs very recent information " +
  "you may not have, say so briefly.";

const MERGE =
  "You are O.D, an assistant that combines answers from several AI models into one best answer. " +
  "Below are their answers to the user's question. Write ONE answer in Markdown that keeps the facts " +
  "they agree on, includes important caveats any of them raised, and corrects or drops claims that look " +
  "wrong. If they genuinely disagree on something important, say so in one line. Do not name the models " +
  "and do not list their answers one by one. Be concise.";

const MAX_Q = 2000;
const MAX_HIST = 6;
const TIMEOUT_MS = 25000;

export async function onRequestPost({ request, env }) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "Bad request." }, 400); }

  const question = String(body.question || "").trim().slice(0, MAX_Q);
  const mode = body.mode === "council" ? "council" : "quick";
  if (!question) return json({ error: "Please type a question." }, 400);

  const history = Array.isArray(body.history)
    ? body.history.slice(-MAX_HIST).map(h => ({
        role: h.role === "assistant" ? "assistant" : "user",
        content: String(h.content || "").slice(0, 3000),
      }))
    : [];

  // ---- Daily limits (skipped if no KV is bound) ----
  const limit = await checkLimit(request, env, mode === "council" ? 2 : 1);
  if (limit) return json({ error: limit }, 429);

  const messages = [{ role: "system", content: SYSTEM }, ...history, { role: "user", content: question }];
  const models = available(env);
  if (!models.length) return json({ error: "O.D is not set up yet: no AI keys found." }, 500);

  try {
    if (mode === "quick") {
      // Try the fastest available model first, fall back to the others.
      for (const m of models) {
        const r = await settle(m.call(env, messages));
        if (r.ok) return json({ answer: r.text, panel: [{ name: m.name, ok: true }] });
      }
      return json({ error: "All AI services are busy right now. Please try again in a little while." }, 503);
    }

    // Council: ask every model in parallel, then merge.
    const results = await Promise.all(models.map(async m => ({ name: m.name, ...(await settle(m.call(env, messages))) })));
    const good = results.filter(r => r.ok);
    const panel = results.map(r => ({ name: r.name, ok: r.ok, text: r.ok ? r.text : null }));

    if (!good.length) return json({ error: "All AI services are busy right now. Please try again in a little while.", panel }, 503);
    if (good.length === 1) return json({ answer: good[0].text, panel });

    const mergeMsgs = [
      { role: "system", content: MERGE },
      ...history,
      {
        role: "user",
        content:
          "Question:\n" + question + "\n\n" +
          good.map((r, i) => `--- Answer ${i + 1} ---\n${r.text}`).join("\n\n"),
      },
    ];
    for (const m of models) {
      const r = await settle(m.call(env, mergeMsgs));
      if (r.ok) return json({ answer: r.text, panel });
    }
    // Merging failed: return the first good answer rather than nothing.
    return json({ answer: good[0].text, panel });
  } catch (e) {
    return json({ error: "Something went wrong. Please try again." }, 500);
  }
}

export async function onRequest({ request }) {
  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  return json({ error: "Use POST." }, 405);
}

// ---------------- Models ----------------

function available(env) {
  const list = [];
  if (env.GROQ_API_KEY) list.push({ name: "Llama (Groq)", call: groq });
  if (env.GEMINI_API_KEY) list.push({ name: "Gemini", call: gemini });
  if (env.AI) list.push({ name: "Cloudflare AI", call: cfai });
  return list;
}

async function groq(env, messages) {
  const r = await timed(fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: env.GROQ_MODEL || "llama-3.3-70b-versatile", messages, max_tokens: 1200, temperature: 0.4 }),
  }));
  if (!r.ok) throw new Error("groq " + r.status);
  const d = await r.json();
  return d.choices?.[0]?.message?.content;
}

async function gemini(env, messages) {
  const model = env.GEMINI_MODEL || "gemini-2.5-flash";
  const system = messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
  const contents = messages.filter(m => m.role !== "system").map(m => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const r = await timed(fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": env.GEMINI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 1500, temperature: 0.4 },
    }),
  }));
  if (!r.ok) throw new Error("gemini " + r.status);
  const d = await r.json();
  return (d.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("");
}

async function cfai(env, messages) {
  const d = await timed(env.AI.run(env.CF_MODEL || "@cf/meta/llama-3.1-8b-instruct", { messages, max_tokens: 1000 }));
  return d?.response;
}

// ---------------- Helpers ----------------

async function settle(p) {
  try {
    const text = await p;
    if (!text || !String(text).trim()) return { ok: false };
    return { ok: true, text: String(text).trim() };
  } catch { return { ok: false }; }
}

function timed(p) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), TIMEOUT_MS))]);
}

async function checkLimit(request, env, cost) {
  if (!env.OD_KV) return null;
  const perUser = parseInt(env.DAILY_PER_USER || "25", 10);
  const total = parseInt(env.DAILY_TOTAL || "600", 10);
  const day = new Date().toISOString().slice(0, 10);
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const uKey = `u:${day}:${await hash(ip)}`;
  const tKey = `t:${day}`;
  const [u, t] = await Promise.all([env.OD_KV.get(uKey), env.OD_KV.get(tKey)]);
  const uc = parseInt(u || "0", 10), tc = parseInt(t || "0", 10);
  if (tc + cost > total) return "O.D has reached today's free limit for everyone. Please come back tomorrow.";
  if (uc + cost > perUser) return "You've reached today's free question limit. Please come back tomorrow.";
  const ttl = { expirationTtl: 60 * 60 * 26 };
  await Promise.all([env.OD_KV.put(uKey, String(uc + cost), ttl), env.OD_KV.put(tKey, String(tc + cost), ttl)]);
  return null;
}

async function hash(s) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].slice(0, 8).map(x => x.toString(16).padStart(2, "0")).join("");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
