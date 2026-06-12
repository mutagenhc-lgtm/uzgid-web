// Поиск конкретного места через Google Places API (New).
// Возвращает структурированные данные: название, адрес, рейтинг, координаты.
// Никакого текста не сочиняет — это работа AI выше по цепочке.

export async function findPlace(query, key) {
  if (!key || !query) return null;
  try {
    const r = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          // запрашиваем только нужные поля — экономия и скорость
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.rating," +
            "places.userRatingCount,places.priceLevel,places.types," +
            "places.location,places.regularOpeningHours.weekdayDescriptions," +
            "places.editorialSummary,places.googleMapsUri",
        },
        body: JSON.stringify({
          textQuery: query + " Uzbekistan",
          languageCode: "en",
          maxResultCount: 1,
          locationBias: {
            // Ташкент примерно в центре, радиус 500 км — вся страна
            circle: {
              center: { latitude: 41.31, longitude: 69.27 },
              radius: 500000.0,
            },
          },
        }),
      }
    );
    if (!r.ok) return null;
    const data = await r.json();
    const place = data.places && data.places[0];
    if (!place) return null;

    return {
      name: place.displayName?.text || query,
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
    return null;
  }
}
