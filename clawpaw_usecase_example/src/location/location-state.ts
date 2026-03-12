/**
 * Persisted location state (last known location + current session).
 * Uses a JSON file for persistence.
 */

import fsp from "node:fs/promises";
import path from "node:path";
import type { LocationSession, LocationSnapshot } from "./types.js";

export type PersistedState = {
  lastLocation: LocationSnapshot | null;
  session: LocationSession | null;
  updatedAt: number;
};

export class LocationStateStore {
  private readonly filePath: string;

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, "location-state.json");
  }

  async load(): Promise<PersistedState | null> {
    try {
      const raw = await fsp.readFile(this.filePath, "utf-8");
      return JSON.parse(raw) as PersistedState;
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  async save(state: PersistedState): Promise<void> {
    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now().toString(36)}`;
    try {
      await fsp.writeFile(tmpPath, JSON.stringify(state, null, 2), "utf-8");
      await fsp.rename(tmpPath, this.filePath);
    } catch (err) {
      await fsp.unlink(tmpPath).catch(() => {});
      throw err;
    }
  }
}
