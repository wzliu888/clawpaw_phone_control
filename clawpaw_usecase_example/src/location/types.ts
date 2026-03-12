/**
 * Location-related type definitions.
 */

/** Location category tag for known places. */
export type PlaceTag = "HOME" | "COMPANY" | "OTHER" | "UNKNOWN";

/** A user-registered known place (e.g. home, office). */
export type KnownPlace = {
  id: string;
  tag: PlaceTag;
  label: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  createdAt: number;
};

/** Point-in-time location with resolved place tag. */
export type LocationSnapshot = {
  latitude: number;
  longitude: number;
  placeTag: PlaceTag;
  placeId: string | null;
  timestamp: number;
};

/** A session of continuous presence at a place. */
export type LocationSession = {
  currentTag: PlaceTag;
  placeId: string | null;
  enterTime: number;
  overworkAlerted: boolean;
  unusualAlerted: boolean;
};

/** Semantic events detected from location updates. */
export type DetectedEventType = "ENTER_PLACE" | "FIRST_VISIT" | "OVERWORK_ALERT" | "UNUSUAL_PLACE";

export type DetectedEvent = {
  type: DetectedEventType;
  timestamp: number;
  data: Record<string, unknown>;
};
