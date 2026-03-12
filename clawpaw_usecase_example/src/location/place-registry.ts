/**
 * Registry of user-defined known places (HOME, COMPANY, etc.).
 * Matches incoming GPS coordinates against registered places using Haversine distance.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import { haversineDistance } from "./geo.js";
import type { KnownPlace, PlaceTag } from "./types.js";

export type PlaceMatch = {
  tag: PlaceTag;
  placeId: string | null;
  label: string | null;
  distanceKm: number | null;
};

export class PlaceRegistry {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "places.json");
  }

  async getPlaces(): Promise<KnownPlace[]> {
    try {
      const raw = await fsp.readFile(this.filePath, "utf-8");
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  async addPlace(place: Omit<KnownPlace, "id" | "createdAt">): Promise<KnownPlace> {
    const places = await this.getPlaces();
    const newPlace: KnownPlace = {
      ...place,
      id: `place_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
    };
    places.push(newPlace);
    await this.writePlaces(places);
    return newPlace;
  }

  async removePlace(id: string): Promise<boolean> {
    const places = await this.getPlaces();
    const filtered = places.filter((p) => p.id !== id);
    if (filtered.length === places.length) return false;
    await this.writePlaces(filtered);
    return true;
  }

  /**
   * Match coordinates against known places.
   * Returns the closest place within its radius, or UNKNOWN if none match.
   */
  matchLocation(lat: number, lon: number, places: KnownPlace[]): PlaceMatch {
    let closest: { place: KnownPlace; distance: number } | null = null;

    for (const place of places) {
      const dist = haversineDistance(lat, lon, place.latitude, place.longitude);
      if (dist <= place.radiusKm) {
        if (!closest || dist < closest.distance) {
          closest = { place, distance: dist };
        }
      }
    }

    if (closest) {
      return {
        tag: closest.place.tag,
        placeId: closest.place.id,
        label: closest.place.label,
        distanceKm: closest.distance,
      };
    }
    return { tag: "UNKNOWN", placeId: null, label: null, distanceKm: null };
  }

  private async writePlaces(places: KnownPlace[]): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
      await fsp.writeFile(tmpPath, JSON.stringify(places, null, 2), "utf-8");
      await fsp.rename(tmpPath, this.filePath);
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}
