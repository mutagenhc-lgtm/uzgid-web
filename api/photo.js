// Серверный поиск фото в Википедии — как в боте, где всё работало.
// Браузер из некоторых стран/сетей не может ходить на Википедию напрямую,
// а сервер Vercel может. Поэтому фото ищем здесь.

export default async function handler(req, res) {
  const q = (req.query && req.query.q) || "";
  if (!q) {
    res.status(400).json({ url: null, reason: "no query" });
    return;
  }

  // если в названии кириллица — ищем сразу в русской Википедии
  const hasCyrillic = /[\u0400-\u04FF]/.test(q);
  const hosts = hasCyrillic
    ? ["ru.wikipedia.org", "en.wikipedia.org"]
    : ["en.wikipedia.org", "ru.wikipedia.org"];

  try {
    for (const host of hosts) {
      const u =
        "https://" + host + "/w/api.php?action=query&format=json" +
        "&generator=search&gsrsearch=" +
        encodeURIComponent(q) +
        "&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=1000";
      const r = await fetch(u, {
        headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
      });
      if (!r.ok) continue;
      const data = await r.json();
      const pages = (data.query && data.query.pages) || {};
      for (const k in pages) {
        const s = pages[k].thumbnail && pages[k].thumbnail.source;
        if (s) {
          res.status(200).json({ url: s, reason: null });
          return;
        }
      }
    }
    res.status(200).json({ url: null, reason: 'no image for "' + q + '"' });
  } catch (e) {
    res.status(200).json({ url: null, reason: "server fetch failed" });
  }
}
