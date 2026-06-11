// Серверная "прослойка": держит ключ Anthropic в секрете.
// Браузер обращается сюда (/api/chat), а ключ берётся из переменной
// окружения ANTHROPIC_API_KEY, которую вы зададите в панели Vercel.
// Ключ НИКОГДА не попадает в код сайта и не виден туристам.

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
        system: system,
        messages: messages,
      }),
    });

    const data = await upstream.json();
    res.status(upstream.status).json(data);
  } catch (e) {
    res.status(500).json({ error: "Upstream request failed" });
  }
}
