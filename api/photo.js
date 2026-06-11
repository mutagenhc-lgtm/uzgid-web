// Одна функция делает всё на сервере — как Telegram-бот, где всё работало:
// 1) ищет статью в Википедии, 2) скачивает картинку, 3) отдаёт её готовой
// строкой data:URL в JSON. Браузеру остаётся только показать. Никакой
// бинарной передачи и второго запроса — именно там раньше всё ломалось.

async function findThumb(host, q) {
  const u =
    "https://" + host + "/w/api.php?action=query&format=json" +
    "&generator=search&gsrsearch=" + encodeURIComponent(q) +
    "&gsrlimit=1&prop=pageimages|coordinates&piprop=thumbnail&pithumbsize=800";
  const r = await fetch(u, {
    headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
  });
  if (!r.ok) return null;
  const data = await r.json();
  const pages = (data.query && data.query.pages) || {};
  for (const k in pages) {
    const thumb = pages[k].thumbnail && pages[k].thumbnail.source;
    const co = pages[k].coordinates && pages[k].coordinates[0];
    if (thumb || co) {
      return {
        thumb: thumb || null,
        lat: co ? co.lat : null,
        lon: co ? co.lon : null,
      };
    }
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

    let found = null;
    for (const h of hosts) {
      found = await findThumb(h, q);
      if (found && (found.thumb || (found.lat && found.lon))) break;
    }
    if (!found) {
      res.status(200).json({ dataUrl: null, lat: null, lon: null, reason: 'no article for "' + q + '"' });
      return;
    }

    let dataUrl = null;
    if (found.thumb) {
      const ir = await fetch(found.thumb, {
        headers: { "User-Agent": "UzGid/1.0 (travel guide)" },
      });
      if (ir.ok) {
        const buf = Buffer.from(await ir.arrayBuffer());
        const type = ir.headers.get("content-type") || "image/jpeg";
        dataUrl = "data:" + type + ";base64," + buf.toString("base64");
      }
    }
    res.status(200).json({
      dataUrl: dataUrl,
      lat: found.lat,
      lon: found.lon,
      reason: dataUrl ? null : 'no image for "' + q + '"',
    });
  } catch (e) {
    res.status(200).json({ dataUrl: null, lat: null, lon: null, reason: "server error: " + e.message });
  }
}
