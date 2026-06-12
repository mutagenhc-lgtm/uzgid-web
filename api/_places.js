// Поиск конкретного места через Google Places API (New).
// Возвращает структурированные данные: название, адрес, рейтинг, координаты.
// Никакого текста не сочиняет — это работа AI выше по цепочке.

export async function findPlace(query, key) {
  if (!key || !query) return { error: "no-key-or-query" };
  const variants = [
    query + " Uzbekistan",
    query + " Tashkent",
    query,
  ];
  let lastDiag = "no-variants";
  for (const q of variants) {
    const found = await searchOne(q, key);
    if (found && found.name) return found;
    if (found && found._diag) lastDiag = found._diag;
  }
  return { _diag: lastDiag };
}

async function searchOne(textQuery, key) {
  try {
    const r = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.rating," +
            "places.userRatingCount,places.priceLevel,places.types," +
            "places.location,places.regularOpeningHours.weekdayDescriptions," +
            "places.editorialSummary,places.googleMapsUri",
        },
        body: JSON.stringify({
          textQuery,
          maxResultCount: 1,
          locationBias: {
            circle: {
              center: { latitude: 41.31, longitude: 69.27 },
              radius: 500000.0,
            },
          },
        }),
      }
    );
    if (!r.ok) {
      const txt = await r.text();
      return { _diag: "http" + r.status + ":" + txt.slice(0, 80) };
    }
    const data = await r.json();
    const place = data.places && data.places[0];
    if (!place) {
      // вернули 200 ok, но без results — самая частая загадка
      const keys = Object.keys(data || {}).join(",");
      return { _diag: "empty(" + keys + ")" };
    }
    return {
      name: place.displayName?.text || textQuery,
      address: place.formattedAddress || "",
      rating: place.rating || null,
      ratingCount: place.userRatingCount || null,
      priceLevel: place.priceLevel || null,
      types: place.types || [],
      lat: place.location?.latitude || null,
      lon: place.location?.longitude || null,
      hours: place.regularOpeningHours?.weekdayDescriptions || [],
      summary: place.editorialSummary?.text || "",
      mapsUrl: place.googleMapsUri || "",
    };
  } catch (e) {
    return { _diag: "exc:" + (e.message || "").slice(0, 50) };
  }
}
