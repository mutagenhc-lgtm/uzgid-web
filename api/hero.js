// Эндпойнт для фото минарета Калян на главном экране.
// Сервер скачивает картинку из Wikimedia (где нет ограничений для серверов)
// и отдаёт браузеру с нашего домена. Кэшируется на сутки.

const KALYAN_URL =
  "https://upload.wikimedia.org/wikipedia/commons/3/30/Kalan_Minaret_01.jpg";

export default async function handler(req, res) {
  try {
    const r = await fetch(KALYAN_URL, {
      headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
    });
    if (!r.ok) {
      res.status(r.status).send("upstream " + r.status);
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400, immutable");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send("fetch failed");
  }
}
