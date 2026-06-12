// Серверная "прослойка": держит ключи в секрете, добавляет ваши факты и
// хорошие ответы как контекст, и пробует Gemini как фолбэк, если Claude
// сказал, что не знает места.

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

// --- Claude ---
async function askClaude(key, system, messages) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 700,
      system: system,
      messages: messages,
    }),
  });
  const data = await r.json();
  const text =
    (data.content && data.content[0] && data.content[0].text) || "";
  return { text, raw: data, ok: r.ok };
}

// --- Gemini (фолбэк) ---
async function askGemini(key, system, messages) {
  // Преобразуем формат Anthropic → Gemini
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: typeof m.content === "string" ? m.content : "" }],
  }));
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    "gemini-2.5-flash:generateContent?key=" + encodeURIComponent(key);
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { maxOutputTokens: 700 },
    }),
  });
  const data = await r.json();
  const text =
    (data.candidates &&
      data.candidates[0] &&
      data.candidates[0].content &&
      data.candidates[0].content.parts &&
      data.candidates[0].content.parts[0] &&
      data.candidates[0].content.parts[0].text) || "";
  return { text, raw: data, ok: r.ok };
}

// Признаки, что Claude "не знает" — стоит сходить в Gemini
const DONT_KNOW = [
  "i don't have", "i do not have", "i'm not familiar", "i am not familiar",
  "i cannot find", "i can't find", "no information", "not aware",
  "не знаю", "не уверен", "не нашёл", "не могу найти", "нет информации", "не располагаю",
  "no encontré", "정보가 없", "情報がありません", "我没有", "我不知道",
];
function looksLikeDontKnow(text) {
  const t = text.toLowerCase();
  return DONT_KNOW.some((p) => t.includes(p));
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const claudeKey = process.env.ANTHROPIC_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!claudeKey) {
    res.status(500).json({ error: "ANTHROPIC_API_KEY is not set" });
    return;
  }
  try {
    const { system, messages } = req.body || {};
    const knowledge = await buildKnowledge();
    const fullSystem = (system || "") + knowledge;

    // 1) Сначала Claude
    let { text, raw, ok } = await askClaude(claudeKey, fullSystem, messages);
    let usedModel = "claude";

    // 2) Фолбэк на Gemini — если ключ есть и ответ похож на «не знаю»
    if (geminiKey && (!ok || !text || looksLikeDontKnow(text))) {
      const g = await askGemini(geminiKey, fullSystem, messages);
      if (g.ok && g.text && !looksLikeDontKnow(g.text)) {
        text = g.text;
        usedModel = "gemini";
      }
    }

    // Возвращаем ответ в формате, который ждёт фронтенд (как у Anthropic)
    res.status(200).json({
      content: [{ type: "text", text }],
      _model: usedModel,
    });
  } catch (e) {
    res.status(500).json({ error: "Upstream request failed: " + e.message });
  }
}
