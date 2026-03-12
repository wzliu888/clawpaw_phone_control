/**
 * Geocoding and reverse geocoding using Gaode (Amap) API.
 */

export type GaodeResponse = {
  status: string;
  info: string;
  [key: string]: unknown;
};

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

/** Get city adcode from GPS coordinates via reverse geocoding. */
export async function getCityCodeFromCoords(
  apiKey: string,
  longitude: number,
  latitude: number,
): Promise<string | null> {
  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${apiKey}&location=${longitude},${latitude}&output=json`;
  const data = (await fetchJson(url)) as GaodeResponse;
  if (data.status !== "1") return null;
  const regeo = (data as Record<string, unknown>).regeocode as Record<string, unknown> | undefined;
  const comp = regeo?.addressComponent as Record<string, unknown> | undefined;
  return (comp?.adcode as string) ?? null;
}

/** Convert address to coordinates. */
export async function geocodeAddress(
  apiKey: string,
  address: string,
): Promise<{ longitude: number; latitude: number; formattedAddress: string } | null> {
  const url = `https://restapi.amap.com/v3/geocode/geo?key=${apiKey}&address=${encodeURIComponent(address)}&output=json`;
  const data = (await fetchJson(url)) as GaodeResponse;
  if (data.status !== "1") return null;

  const geocodes = (data as Record<string, unknown>).geocodes as Array<Record<string, unknown>> | undefined;
  const first = geocodes?.[0];
  if (!first) return null;

  const loc = String(first.location ?? "");
  const [lon, lat] = loc.split(",").map(Number);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;

  return {
    longitude: lon,
    latitude: lat,
    formattedAddress: String(first.formatted_address ?? ""),
  };
}

/** Convert coordinates to address (reverse geocoding). */
export async function reverseGeocode(
  apiKey: string,
  longitude: number,
  latitude: number,
): Promise<{ address: string; province: string; city: string; district: string } | null> {
  const url = `https://restapi.amap.com/v3/geocode/regeo?key=${apiKey}&location=${longitude},${latitude}&output=json&extensions=base`;
  const data = (await fetchJson(url)) as GaodeResponse;
  if (data.status !== "1") return null;

  const regeo = (data as Record<string, unknown>).regeocode as Record<string, unknown> | undefined;
  if (!regeo) return null;

  const comp = regeo.addressComponent as Record<string, unknown> | undefined;
  return {
    address: String(regeo.formatted_address ?? ""),
    province: String(comp?.province ?? ""),
    city: String(comp?.city ?? ""),
    district: String(comp?.district ?? ""),
  };
}
