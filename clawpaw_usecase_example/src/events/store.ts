/**
 * File-based event store using JSONL files organized by date.
 * Events are stored under <dataDir>/events/YYYY-MM-DD.jsonl.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import type { UserEvent } from "./types.js";

export class EventStore {
  private readonly eventsDir: string;

  constructor(dataDir: string) {
    this.eventsDir = path.join(dataDir, "events");
  }

  private dateKey(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  private filePath(dateKey: string): string {
    return path.join(this.eventsDir, `${dateKey}.jsonl`);
  }

  async save(event: UserEvent): Promise<void> {
    await fsp.mkdir(this.eventsDir, { recursive: true });
    await fsp.appendFile(this.filePath(this.dateKey(event.timestamp)), JSON.stringify(event) + "\n", "utf-8");
  }

  async queryRecent(hours: number, limit: number): Promise<UserEvent[]> {
    const now = Date.now();
    const cutoff = now - hours * 3600_000;

    const dateKeys = new Set<string>();
    for (let t = cutoff; t <= now; t += 86400_000) {
      dateKeys.add(this.dateKey(t));
    }
    dateKeys.add(this.dateKey(now));

    const all: UserEvent[] = [];
    for (const dk of dateKeys) {
      const events = await this.readFile(this.filePath(dk));
      for (const e of events) {
        if (e.timestamp >= cutoff) all.push(e);
      }
    }

    all.sort((a, b) => b.timestamp - a.timestamp);
    return all.slice(0, limit);
  }

  async queryByType(eventType: string, limit: number): Promise<UserEvent[]> {
    const files = await this.listDateFiles();
    const result: UserEvent[] = [];

    for (const f of files.reverse()) {
      const events = await this.readFile(f);
      for (const e of events) {
        if (e.type === eventType) result.push(e);
      }
      if (result.length >= limit) break;
    }

    result.sort((a, b) => b.timestamp - a.timestamp);
    return result.slice(0, limit);
  }

  async queryByDate(date: string): Promise<UserEvent[]> {
    return this.readFile(this.filePath(date));
  }

  private async readFile(filePath: string): Promise<UserEvent[]> {
    try {
      const raw = await fsp.readFile(filePath, "utf-8");
      return raw
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as UserEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is UserEvent => e !== null);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }

  private async listDateFiles(): Promise<string[]> {
    try {
      const entries = await fsp.readdir(this.eventsDir);
      return entries
        .filter((e) => e.endsWith(".jsonl"))
        .sort()
        .map((e) => path.join(this.eventsDir, e));
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
  }
}
