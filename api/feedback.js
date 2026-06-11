// Сохраняет оценки туристов (👍/👎) и хорошие ответы в Upstash Redis
// через REST API (использует переменные KV_REST_API_URL и
// KV_REST_API_TOKEN, которые Vercel подключает автоматически).

let redis = null;
try {
  const mod = await import("@upstash/redis");
  redis = mod.Redis.fromEnv();
} catch (e) {
  redis = null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  if (!redis) {
    res.status(200).json({ ok: true, stored: false });
    return;
  }
  try {
    const { question, answer, rating, lang } = req.body || {};
    if (!question || !answer || !rating) {
      res.status(400).json({ ok: false, error: "missing fields" });
      return;
    }
    const ts = Date.now();
    const id = ts + "-" + Math.random().toString(36).slice(2, 8);
    const entry = {
      id, ts,
      lang: lang || "en",
      rating: rating === "up" ? 1 : -1,
      question: String(question).slice(0, 500),
      answer: String(answer).slice(0, 2000),
    };
    await redis.set("fb:" + id, entry);
    if (entry.rating === 1) {
      await redis.lpush("good_answers", entry);
      await redis.ltrim("good_answers", 0, 199);
    }
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
