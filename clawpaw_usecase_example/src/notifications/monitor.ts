/**
 * Notification change monitor.
 * Periodically polls ClawPaw for notifications and detects changes.
 */

import type { ClawPawClient } from "../clawpaw-client.js";
import type { EventStore } from "../events/store.js";
import { generateEventId } from "../events/types.js";
import type { UserEvent } from "../events/types.js";

type NotificationEntry = {
  key: string;
  packageName?: string;
  title?: string;
  text?: string;
};

function notificationKey(n: Record<string, unknown>): string {
  return String(n.key ?? n.id ?? `${n.packageName}_${n.title}_${n.text}`);
}

export type NotificationMonitorOptions = {
  client: ClawPawClient;
  store: EventStore;
  intervalMs: number;
  logger?: { info?: (msg: string) => void; warn?: (msg: string) => void; debug?: (msg: string) => void };
  onNewNotification?: () => void;
};

export class NotificationMonitor {
  private readonly client: ClawPawClient;
  private readonly store: EventStore;
  private readonly intervalMs: number;
  private readonly logger: NotificationMonitorOptions["logger"];
  private readonly onNewNotification?: () => void;
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastSnapshot = new Map<string, NotificationEntry>();
  private initialized = false;

  constructor(opts: NotificationMonitorOptions) {
    this.client = opts.client;
    this.store = opts.store;
    this.intervalMs = opts.intervalMs;
    this.logger = opts.logger;
    this.onNewNotification = opts.onNewNotification;
  }

  start(): void {
    if (this.timer) return;
    // First tick initializes the snapshot without emitting events
    this.tick().catch(() => {});
    this.timer = setInterval(() => {
      this.tick().catch(() => {});
    }, this.intervalMs);
    this.timer.unref?.();
    this.logger?.info?.("[clawpaw-agent] notification monitor started");
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.logger?.info?.("[clawpaw-agent] notification monitor stopped");
    }
  }

  async tick(): Promise<void> {
    try {
      const raw = await this.client.getNotifications();
      const current = new Map<string, NotificationEntry>();
      for (const n of raw) {
        const key = notificationKey(n);
        current.set(key, {
          key,
          packageName: typeof n.packageName === "string" ? n.packageName : undefined,
          title: typeof n.title === "string" ? n.title : undefined,
          text: typeof n.text === "string" ? n.text : undefined,
        });
      }

      if (!this.initialized) {
        // First run: just set the baseline, don't emit events
        this.lastSnapshot = current;
        this.initialized = true;
        this.logger?.debug?.(`[clawpaw-agent] notification baseline: ${current.size} notifications`);
        return;
      }

      // Detect new notifications
      let hasNew = false;
      for (const [key, entry] of current) {
        if (!this.lastSnapshot.has(key)) {
          hasNew = true;
          const event: UserEvent = {
            id: generateEventId("notif"),
            type: "notification_change",
            name: "notification_added",
            timestamp: Date.now(),
            data: {
              key: entry.key,
              packageName: entry.packageName,
              title: entry.title,
              text: entry.text,
            },
          };
          await this.store.save(event);
          this.logger?.info?.(
            `[clawpaw-agent] new notification: ${entry.packageName} - ${entry.title}`,
          );
        }
      }

      // Detect removed notifications
      for (const [key, entry] of this.lastSnapshot) {
        if (!current.has(key)) {
          const event: UserEvent = {
            id: generateEventId("notif"),
            type: "notification_change",
            name: "notification_removed",
            timestamp: Date.now(),
            data: {
              key: entry.key,
              packageName: entry.packageName,
              title: entry.title,
            },
          };
          await this.store.save(event);
        }
      }

      this.lastSnapshot = current;

      if (hasNew && this.onNewNotification) {
        this.onNewNotification();
      }
    } catch (err) {
      this.logger?.warn?.(`[clawpaw-agent] notification monitor error: ${String(err)}`);
    }
  }
}
