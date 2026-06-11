// Серверная "прослойка": держит ключ Anthropic в секрете и обогащает
// системный промпт ВАШИМИ местными фактами и хорошими ответами туристов.

import { FACTS } from "./_facts.js";

let redis = null;
try {
  const mod = await import("@upstash/redis");
  redis = mod.Redis.fromEnv();
} catch (e) {
  redis = null;
}

async function buildKnowledge() {
  let parts = [];
  if (FACTS && FACTS.length) {
    parts.push(
      "VERIFIED LOCAL FACTS (confirmed by a local expert — OVERRIDE your own knowledge; never contradict them):\n" +
      FACTS.map((f) => "- " + f).join("\n")
    );
  }
  if (redis) {
    try {
      const good = await redis.lrange("good_answers", 0, 4);
      if (good && good.length) {
        const examples = good
          .map((g, i) => {
            const obj = typeof g === "string" ? JSON.parse(g) : g;
            return "Example " + (i + 1) + " — Q: " + obj.question + "\nA: " + obj.answer;
          })
          .join("\n\n");
        parts.push(
          "PAST ANSWERS RATED EXCELLENT BY TOURISTS — match this style and accuracy:\n\n" +
          examples
        );
      }
    } catch (e) { /* нет БД — пропускаем */ }
  }
  return parts.length ? "\n\n" + parts.join("\n\n") : "";
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set in Vercel" });
    return;
  }
  try {
    const { system, messages } = req.body || {};
    const knowledge = await buildKnowledge();
    const fullSystem = (system || "") + knowledge;

    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 700,
        system: fullSystem,
        messages: messages,
      }),
    });
    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "Upstream request failed: " + e.message });
  }
}
