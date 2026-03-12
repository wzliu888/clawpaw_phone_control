/**
 * Nearby POI search using Google Maps Places API (Nearby Search).
 */

// Maps common Chinese category names to Google Places types
const PLACE_TYPES: Record<string, string> = {
  "餐饮": "restaurant",
  "中餐厅": "chinese_restaurant",
  "外国餐厅": "restaurant",
  "快餐厅": "fast_food_restaurant",
  "咖啡厅": "cafe",
  "茶艺馆": "tea_house",
  "购物": "shopping_mall",
  "商场": "shopping_mall",
  "便利店": "convenience_store",
  "超市": "supermarket",
  "生活服务": "home_goods_store",
  "体育休闲": "sports_complex",
  "公园广场": "park",
  "电影院": "movie_theater",
  "医疗": "hospital",
  "药店": "pharmacy",
  "住宿": "lodging",
  "交通": "transit_station",
  "地铁站": "subway_station",
  "公交站": "bus_station",
  "停车场": "parking",
};

type PlaceResult = {
  name: string;
  types: string[];
  address: string;
  distance?: number;
  rating?: number;
  priceLevel?: number;
  openNow?: boolean;
  phoneNumber?: string;
};

function metersToMiles(m: number): number {
  return Math.round(m / 10) / 100;
}

function haversineMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parsePlaces(
  raw: Array<Record<string, unknown>>,
  originLat: number,
  originLon: number,
): PlaceResult[] {
  return raw.map((place) => {
    const geometry = place.geometry as Record<string, unknown> | undefined;
    const loc = geometry?.location as Record<string, unknown> | undefined;
    const lat = typeof loc?.lat === "number" ? loc.lat : null;
    const lng = typeof loc?.lng === "number" ? loc.lng : null;
    const distance =
      lat !== null && lng !== null
        ? Math.round(haversineMeters(originLat, originLon, lat, lng))
        : undefined;

    const opening = place.opening_hours as Record<string, unknown> | undefined;

    return {
      name: String(place.name ?? ""),
      types: Array.isArray(place.types) ? (place.types as string[]) : [],
      address: String(place.vicinity ?? place.formatted_address ?? ""),
      distance,
      rating: typeof place.rating === "number" ? place.rating : undefined,
      priceLevel: typeof place.price_level === "number" ? place.price_level : undefined,
      openNow: typeof opening?.open_now === "boolean" ? opening.open_now : undefined,
      phoneNumber:
        typeof place.formatted_phone_number === "string" ? place.formatted_phone_number : undefined,
    };
  });
}

function priceLevelLabel(level: number): string {
  return ["免费", "廉价", "中等", "较贵", "昂贵"][level] ?? String(level);
}

function formatPlaces(places: PlaceResult[], limit: number): string {
  if (!places.length) return "周边暂无相关地点";
  const lines = [`找到 ${places.length} 个地点：`, ""];
  for (const [i, place] of places.slice(0, limit).entries()) {
    lines.push(`${i + 1}. ${place.name}`);
    if (place.types.length) lines.push(`   类型: ${place.types.slice(0, 3).join(", ")}`);
    lines.push(`   地址: ${place.address}`);
    if (place.distance !== undefined) lines.push(`   距离: ${place.distance}米`);
    if (place.rating !== undefined) lines.push(`   评分: ${place.rating}分`);
    if (place.priceLevel !== undefined) lines.push(`   价位: ${priceLevelLabel(place.priceLevel)}`);
    if (place.openNow !== undefined) lines.push(`   营业中: ${place.openNow ? "是" : "否"}`);
    if (place.phoneNumber) lines.push(`   电话: ${place.phoneNumber}`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function searchNearby(
  apiKey: string,
  params: {
    longitude: number;
    latitude: number;
    keywords?: string;
    poiType?: string;
    radius?: number;
    limit?: number;
  },
): Promise<string> {
  const radius = Math.min(Math.max(params.radius ?? 1000, 1), 50000);
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 20);

  const qs = new URLSearchParams({
    key: apiKey,
    location: `${params.latitude},${params.longitude}`,
    radius: String(radius),
  });

  if (params.keywords) qs.set("keyword", params.keywords);
  if (params.poiType && PLACE_TYPES[params.poiType]) qs.set("type", PLACE_TYPES[params.poiType]);

  const url = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?${qs}`;
  const res = await fetch(url);
  if (!res.ok) return `HTTP 错误: ${res.status}`;

  const data = (await res.json()) as Record<string, unknown>;
  const status = String(data.status ?? "");
  if (status !== "OK" && status !== "ZERO_RESULTS") {
    return `Google Places API 错误: ${status} - ${String(data.error_message ?? "")}`;
  }

  const raw = (data.results ?? []) as Array<Record<string, unknown>>;
  const places = parsePlaces(raw, params.latitude, params.longitude);
  return formatPlaces(places, limit);
}
