// Сохраняет оценки туристов (👍/👎) и хорошие ответы в Vercel KV.
// Если KV не настроен — функция тихо «соглашается» и ничего не пишет,
// чтобы сайт не ломался, пока KV не подключён.

let kv = null;
try {
  // Подключение к Vercel KV. Чтобы это заработало, нужно один раз в
  // панели Vercel: Storage → Create Database → KV → Connect to project.
  // Vercel сам впишет переменные окружения, ничего вручную не нужно.
  kv = (await import("@vercel/kv")).kv;
} catch (e) {
  kv = null;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "POST only" });
    return;
  }
  if (!kv) {
    // KV ещё не подключён — отвечаем «ок», чтобы сайт не показывал ошибку
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

    // Все отзывы — для аналитики
    await kv.set("fb:" + id, entry);

    // Хорошие ответы (rating=up) кладём в отдельный список, чтобы потом
    // подавать как примеры новой сессии
    if (entry.rating === 1) {
      await kv.lpush("good_answers", entry);
      await kv.ltrim("good_answers", 0, 199); // храним последние 200
    }
    res.status(200).json({ ok: true, stored: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
