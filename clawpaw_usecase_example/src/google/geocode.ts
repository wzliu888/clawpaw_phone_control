/**
 * Geocoding and reverse geocoding using Google Maps Geocoding API.
 */

export type GoogleResponse = {
  status: string;
  error_message?: string;
  [key: string]: unknown;
};

export async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

/** Convert address to coordinates. */
export async function geocodeAddress(
  apiKey: string,
  address: string,
): Promise<{ longitude: number; latitude: number; formattedAddress: string } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${apiKey}&address=${encodeURIComponent(address)}`;
  const data = (await fetchJson(url)) as GoogleResponse;
  if (data.status !== "OK") return null;

  const results = (data as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined;
  const first = results?.[0];
  if (!first) return null;

  const geometry = first.geometry as Record<string, unknown> | undefined;
  const location = geometry?.location as Record<string, unknown> | undefined;
  if (!location) return null;

  const lat = Number(location.lat);
  const lng = Number(location.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    latitude: lat,
    longitude: lng,
    formattedAddress: String(first.formatted_address ?? ""),
  };
}

/** Convert coordinates to address (reverse geocoding). */
export async function reverseGeocode(
  apiKey: string,
  longitude: number,
  latitude: number,
): Promise<{ address: string; province: string; city: string; district: string } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?key=${apiKey}&latlng=${latitude},${longitude}`;
  const data = (await fetchJson(url)) as GoogleResponse;
  if (data.status !== "OK") return null;

  const results = (data as Record<string, unknown>).results as Array<Record<string, unknown>> | undefined;
  const first = results?.[0];
  if (!first) return null;

  const components = first.address_components as Array<Record<string, unknown>> | undefined;

  function findComponent(types: string[]): string {
    const comp = components?.find((c) => {
      const t = c.types as string[] | undefined;
      return types.some((type) => t?.includes(type));
    });
    return String(comp?.long_name ?? "");
  }

  return {
    address: String(first.formatted_address ?? ""),
    province: findComponent(["administrative_area_level_1"]),
    city: findComponent(["locality", "administrative_area_level_2"]),
    district: findComponent(["sublocality_level_1", "administrative_area_level_3"]),
  };
}
