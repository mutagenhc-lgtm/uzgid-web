// Одна функция делает всё на сервере — как Telegram-бот, где всё работало:
// 1) ищет статью в Википедии, 2) скачивает картинку, 3) отдаёт её готовой
// строкой data:URL в JSON. Браузеру остаётся только показать. Никакой
// бинарной передачи и второго запроса — именно там раньше всё ломалось.

async function findThumb(host, q) {
  const u =
    "https://" + host + "/w/api.php?action=query&format=json" +
    "&generator=search&gsrsearch=" + encodeURIComponent(q) +
    "&gsrlimit=1&prop=pageimages&piprop=thumbnail&pithumbsize=800";
  const r = await fetch(u, {
    headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const pages = (data.query && data.query.pages) || {};
  for (const k in pages) {
    const s = pages[k].thumbnail && pages[k].thumbnail.source;
    if (s) return s;
  }
  return null;
}

export default async function handler(req, res) {
  const q = (req.query && req.query.q) || "";
  if (!q) {
    res.status(200).json({ dataUrl: null, reason: "no query" });
    return;
  }
  try {
    const cyr = /[\u0400-\u04FF]/.test(q);
    const hosts = cyr
      ? ["ru.wikipedia.org", "en.wikipedia.org"]
      : ["en.wikipedia.org", "ru.wikipedia.org"];

    let thumb = null;
    for (const h of hosts) {
      thumb = await findThumb(h, q);
      if (thumb) break;
    }
    if (!thumb) {
      res.status(200).json({ dataUrl: null, reason: 'no image for "' + q + '"' });
      return;
    }

    const ir = await fetch(thumb, {
      headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
    });
    if (!ir.ok) {
      res.status(200).json({ dataUrl: null, reason: "image http " + ir.status });
      return;
    }
    const buf = Buffer.from(await ir.arrayBuffer());
    const type = ir.headers.get("content-type") || "image/jpeg";
    const dataUrl = "data:" + type + ";base64," + buf.toString("base64");
    res.status(200).json({ dataUrl: dataUrl, reason: null });
  } catch (e) {
    res.status(200).json({ dataUrl: null, reason: "server error: " + e.message });
  }
}
