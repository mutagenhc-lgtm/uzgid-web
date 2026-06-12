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
async function askGemini(key, system, messages, userQuestion) {
  // Для Gemini используем облегчённый промпт: основная инструкция Claude
  // часто слишком жёсткая для него ("если не уверен — молчи"), и Gemini
  // отказывается отвечать даже когда что-то знает.
  const lastUser = userQuestion || ((messages || []).filter((m) => m.role === "user").slice(-1)[0]?.content) || "";
  const geminiSystem =
    "You are a helpful local travel assistant for Uzbekistan. " +
    "A tourist asked about a specific place, dish, business, or entity. " +
    "Use any knowledge you have from Google Maps, reviews, blogs, and local sources. " +
    "Identify the SPECIFIC named thing they asked about — not a general topic. " +
    "Give a concrete, useful answer: what it is, where (district / landmark), " +
    "typical price range in UZS and USD, why it's worth visiting. " +
    "If you genuinely have no data on this specific entity, say so briefly and suggest " +
    "1–2 well-known similar places nearby. " +
    "Keep it 2–3 short paragraphs. Reply in the SAME LANGUAGE as the tourist's question. " +
    "On the very last line, output: PHOTO: <main place name in English, Wikipedia-style> or PHOTO: none";

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
      systemInstruction: { parts: [{ text: geminiSystem }] },
      contents,
      generationConfig: { maxOutputTokens: 800, temperature: 0.4 },
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

// Признаки, что Claude явно "не знает" — самый простой триггер фолбэка
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

// Самопроверка: спрашиваем Claude, ответил ли он на конкретный вопрос
// пользователя, или ушёл в общую тему. Возвращает true, если промах.
async function answerIsOffTopic(key, userMessage, answer) {
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 5,
        system:
          "You are a strict QA judge. The user asked about a SPECIFIC named place, dish, person, or entity in Uzbekistan. The assistant answered. Decide: did the assistant give information about that EXACT named thing, or did it go off-topic to a general explanation? Reply with a single word: SPECIFIC or GENERAL. Reply GENERAL when the assistant talked around the topic without identifying the actual named place/entity.",
        messages: [
          {
            role: "user",
            content:
              "USER QUESTION:\n" + userMessage + "\n\nASSISTANT ANSWER:\n" + answer + "\n\nVerdict?",
          },
        ],
      }),
    });
    const data = await r.json();
    const v = (data.content && data.content[0] && data.content[0].text) || "";
    return /GENERAL/i.test(v);
  } catch (e) {
    return false; // при ошибке самопроверки не дёргаем фолбэк
  }
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

    // Берём последний пользовательский вопрос для самопроверки
    const lastUser = (messages || []).filter((m) => m.role === "user").slice(-1)[0];
    const userText = lastUser && typeof lastUser.content === "string" ? lastUser.content : "";

    // Эвристика: если в вопросе есть имя собственное (заглавные буквы
    // посреди фразы или кавычки) — стоит проверить, попал ли ответ в цель
    const hasNamedEntity =
      /[«"'].+?["'»]/.test(userText) ||
      /\b[A-ZА-ЯЁ][\wА-Яа-яёЁ'-]+(?:\s+[A-ZА-ЯЁ][\wА-Яа-яёЁ'-]+)+/.test(userText) ||
      /(restaurant|cafe|hotel|bar|ресторан|кафе|отель|chayhana|чайхана|osh|ош|palov|плов|somsa|сомса)/i.test(userText);

    let shouldFallback = false;
    if (!ok || !text) {
      shouldFallback = true;
    } else if (looksLikeDontKnow(text)) {
      shouldFallback = true;
    } else if (hasNamedEntity && geminiKey) {
      // дорогая проверка — только когда дёшево и осмысленно
      shouldFallback = await answerIsOffTopic(claudeKey, userText, text);
    }

    // 2) Фолбэк на Gemini
    if (geminiKey && shouldFallback) {
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
