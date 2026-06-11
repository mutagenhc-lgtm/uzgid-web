// Прокси для картинок: браузер в некоторых сетях не может грузить
// напрямую с upload.wikimedia.org, а наш сервер может. Берём картинку
// здесь и отдаём с нашего домена.

export default async function handler(req, res) {
  const url = (req.query && req.query.url) || "";
  // пускаем только картинки с Викимедиа — на всякий случай
  if (!url || !/^https:\/\/upload\.wikimedia\.org\//.test(url)) {
    res.status(400).send("bad url");
    return;
  }
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
    });
    if (!r.ok) {
      res.status(r.status).send("upstream " + r.status);
      return;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader(
      "Content-Type",
      r.headers.get("content-type") || "image/jpeg"
    );
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(buf);
  } catch (e) {
    res.status(502).send("fetch failed");
  }
}
