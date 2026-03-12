/**
 * Nearby POI search using Gaode (Amap) API.
 */

import type { GaodeResponse } from "./geocode.js";

const POI_TYPES: Record<string, string> = {
  "餐饮": "050000",
  "中餐厅": "050100",
  "外国餐厅": "050200",
  "快餐厅": "050300",
  "咖啡厅": "050500",
  "茶艺馆": "050600",
  "购物": "060000",
  "商场": "060100",
  "便利店": "060200",
  "超市": "060300",
  "生活服务": "070000",
  "体育休闲": "080000",
  "公园广场": "080100",
  "电影院": "080500",
  "医疗": "090000",
  "药店": "090300",
  "住宿": "100000",
  "交通": "150000",
  "地铁站": "150500",
  "公交站": "150700",
  "停车场": "150900",
};

type PoiResult = {
  name: string;
  type: string;
  address: string;
  distance: number;
  rating: string;
  cost: string;
  tel: string;
  opentime: string;
};

function parsePois(raw: Array<Record<string, unknown>>): PoiResult[] {
  return raw.map((poi) => {
    const bizExt = (poi.biz_ext as Record<string, unknown>) ?? {};
    return {
      name: String(poi.name ?? ""),
      type: String(poi.type ?? ""),
      address: String(poi.address ?? ""),
      distance: parseInt(String(poi.distance ?? "0"), 10) || 0,
      rating: String(bizExt.rating ?? ""),
      cost: String(bizExt.cost ?? ""),
      tel: String(poi.tel ?? ""),
      opentime: String(poi.opentime ?? ""),
    };
  });
}

function formatPois(pois: PoiResult[], limit: number): string {
  if (!pois.length) return "周边暂无相关地点";
  const lines = [`找到 ${pois.length} 个地点：`, ""];
  for (const [i, poi] of pois.slice(0, limit).entries()) {
    lines.push(`${i + 1}. ${poi.name}`);
    lines.push(`   类型: ${poi.type}`);
    lines.push(`   地址: ${poi.address}`);
    if (poi.distance) lines.push(`   距离: ${poi.distance}米`);
    if (poi.rating) lines.push(`   评分: ${poi.rating}分`);
    if (poi.cost) lines.push(`   人均: ${poi.cost}元`);
    if (poi.tel) lines.push(`   电话: ${poi.tel}`);
    if (poi.opentime) lines.push(`   营业: ${poi.opentime}`);
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
  const limit = Math.min(Math.max(params.limit ?? 10, 1), 25);

  const qs = new URLSearchParams({
    key: apiKey,
    location: `${params.longitude},${params.latitude}`,
    radius: String(radius),
    offset: String(limit),
    extensions: "all",
    sortrule: "weight",
  });
  if (params.keywords) qs.set("keywords", params.keywords);
  if (params.poiType && POI_TYPES[params.poiType]) qs.set("types", POI_TYPES[params.poiType]);

  const url = `https://restapi.amap.com/v3/place/around?${qs}`;
  const res = await fetch(url);
  if (!res.ok) return `HTTP 错误: ${res.status}`;
  const data = (await res.json()) as GaodeResponse;

  if (data.status !== "1") return `高德 API 错误: ${data.info}`;

  const pois = parsePois(((data as Record<string, unknown>).pois ?? []) as Array<Record<string, unknown>>);
  return formatPois(pois, limit);
}
