/**
 * Background location collector.
 * Periodically polls ClawPaw for GPS, stores events, and runs event detection.
 */

import type { ClawPawClient } from "../clawpaw-client.js";
import type { EventStore } from "../events/store.js";
import { generateEventId } from "../events/types.js";
import type { UserEvent } from "../events/types.js";
import type { EventDetector } from "./event-detector.js";

export type LocationCollectorOptions = {
  client: ClawPawClient;
  store: EventStore;
  detector: EventDetector;
  intervalMs: number;
  logger?: { info?: (msg: string) => void; warn?: (msg: string) => void; debug?: (msg: string) => void };
  onHighPriorityEvent?: () => void;
};

const HIGH_PRIORITY_TYPES = new Set(["OVERWORK_ALERT", "UNUSUAL_PLACE"]);

export class LocationCollector {
  private readonly client: ClawPawClient;
  private readonly store: EventStore;
  private readonly detector: EventDetector;
  private readonly intervalMs: number;
  private readonly logger: LocationCollectorOptions["logger"];
  private readonly onHighPriorityEvent?: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: LocationCollectorOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.detector = opts.detector;
    this.intervalMs = opts.intervalMs;
    this.logger = opts.logger;
    this.onHighPriorityEvent = opts.onHighPriorityEvent;
  }

  start(): void {
    if (this.timer) return;
    // Run immediately on start, then at intervals
    this.tick().catch(() => {});
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
    this.logger?.info?.("[clawpaw-agent] location collector started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger?.info?.("[clawpaw-agent] location collector stopped");
    }
  }

  async tick(): Promise<void> {
    try {
      const loc = await this.client.getLocation();
      if (!loc) {
        this.logger?.debug?.("[clawpaw-agent] no location data available");
        return;
      }

      // Save raw location event
      const locationEvent: UserEvent = {
        id: generateEventId("loc"),
        type: "geo_location",
        name: "location_update",
        timestamp: Date.now(),
        data: {
          latitude: loc.latitude,
          longitude: loc.longitude,
          accuracy: loc.accuracy,
          altitude: loc.altitude,
          speed: loc.speed,
          heading: loc.heading,
        },
      };
      await this.store.save(locationEvent);
      this.logger?.debug?.(
        `[clawpaw-agent] location saved: ${loc.latitude.toFixed(4)},${loc.longitude.toFixed(4)}`,
      );

      // Run event detection
      const detected = await this.detector.processUpdate(loc.latitude, loc.longitude, Date.now());
      let shouldWake = false;

      for (const de of detected) {
        const detEvent: UserEvent = {
          id: generateEventId("det"),
          type: de.type === "ENTER_PLACE" || de.type === "FIRST_VISIT" ? "place_visit" : "alert",
          name: de.type.toLowerCase(),
          timestamp: de.timestamp,
          data: de.data,
        };
        await this.store.save(detEvent);
        this.logger?.info?.(`[clawpaw-agent] detected: ${de.type}`);

        if (HIGH_PRIORITY_TYPES.has(de.type)) {
          shouldWake = true;
        }
      }

      if (shouldWake && this.onHighPriorityEvent) {
        this.onHighPriorityEvent();
        this.logger?.info?.("[clawpaw-agent] triggered heartbeat wake for proactive alert");
      }
    } catch (err) {
      this.logger?.warn?.(`[clawpaw-agent] location collector error: ${String(err)}`);
    }
  }
}
