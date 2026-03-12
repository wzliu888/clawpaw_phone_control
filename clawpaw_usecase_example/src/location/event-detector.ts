/**
 * Semantic event detector for location updates.
 * Detects:
 * - ENTER_PLACE: place tag changed (edge detection)
 * - FIRST_VISIT: moved >= 5km from last location (edge detection)
 * - OVERWORK_ALERT: at COMPANY for > N hours (state machine, one-shot)
 * - UNUSUAL_PLACE: at UNKNOWN for > N minutes (state machine, one-shot)
 */

import { haversineDistance } from "./geo.js";
import type { LocationStateStore, PersistedState } from "./location-state.js";
import type { PlaceRegistry } from "./place-registry.js";
import type { DetectedEvent, LocationSession, LocationSnapshot } from "./types.js";

const FIRST_VISIT_DISTANCE_KM = 5.0;

export type EventDetectorConfig = {
  overworkHours: number;
  unusualPlaceMinutes: number;
};

export class EventDetector {
  private readonly registry: PlaceRegistry;
  private readonly stateStore: LocationStateStore;
  private readonly overworkMs: number;
  private readonly unusualMs: number;

  constructor(
    registry: PlaceRegistry,
    stateStore: LocationStateStore,
    config: EventDetectorConfig,
  ) {
    this.registry = registry;
    this.stateStore = stateStore;
    this.overworkMs = config.overworkHours * 3600_000;
    this.unusualMs = config.unusualPlaceMinutes * 60_000;
  }

  /**
   * Process a location update and return any detected events.
   * Manages state internally (load → detect → persist).
   */
  async processUpdate(lat: number, lon: number, timestamp: number): Promise<DetectedEvent[]> {
    const state = await this.stateStore.load();
    const lastLocation = state?.lastLocation ?? null;
    let session = state?.session ?? null;

    const places = await this.registry.getPlaces();
    const match = this.registry.matchLocation(lat, lon, places);

    const current: LocationSnapshot = {
      latitude: lat,
      longitude: lon,
      placeTag: match.tag,
      placeId: match.placeId,
      timestamp,
    };

    const events: DetectedEvent[] = [];

    if (lastLocation) {
      // Edge detection: place tag changed
      if (current.placeTag !== lastLocation.placeTag) {
        events.push({
          type: "ENTER_PLACE",
          timestamp,
          data: {
            fromTag: lastLocation.placeTag,
            toTag: current.placeTag,
            placeId: match.placeId,
            placeLabel: match.label,
            latitude: lat,
            longitude: lon,
          },
        });
        // Reset session on place change
        session = {
          currentTag: current.placeTag,
          placeId: match.placeId,
          enterTime: timestamp,
          overworkAlerted: false,
          unusualAlerted: false,
        };
      }

      // Edge detection: large distance move
      const distance = haversineDistance(lastLocation.latitude, lastLocation.longitude, lat, lon);
      if (distance >= FIRST_VISIT_DISTANCE_KM) {
        events.push({
          type: "FIRST_VISIT",
          timestamp,
          data: {
            distanceKm: Math.round(distance * 100) / 100,
            fromLatitude: lastLocation.latitude,
            fromLongitude: lastLocation.longitude,
            toLatitude: lat,
            toLongitude: lon,
            placeTag: current.placeTag,
          },
        });
      }
    }

    // Initialize session if none exists
    if (!session) {
      session = {
        currentTag: current.placeTag,
        placeId: match.placeId,
        enterTime: timestamp,
        overworkAlerted: false,
        unusualAlerted: false,
      };
    }

    // State machine: duration-based detection
    const elapsed = timestamp - session.enterTime;

    if (session.currentTag === "COMPANY" && elapsed > this.overworkMs && !session.overworkAlerted) {
      session.overworkAlerted = true;
      events.push({
        type: "OVERWORK_ALERT",
        timestamp,
        data: {
          hours: Math.round((elapsed / 3600_000) * 10) / 10,
          enterTime: session.enterTime,
          placeId: session.placeId,
        },
      });
    }

    if (session.currentTag === "UNKNOWN" && elapsed > this.unusualMs && !session.unusualAlerted) {
      session.unusualAlerted = true;
      events.push({
        type: "UNUSUAL_PLACE",
        timestamp,
        data: {
          minutes: Math.round(elapsed / 60_000),
          latitude: lat,
          longitude: lon,
        },
      });
    }

    // Persist updated state
    const newState: PersistedState = {
      lastLocation: current,
      session,
      updatedAt: timestamp,
    };
    await this.stateStore.save(newState);

    return events;
  }
}
