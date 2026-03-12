/**
 * ClawPaw backend HTTP client.
 * Sends commands to a phone connected via ClawPaw's WebSocket relay.
 * Protocol: POST /api/mobile { uid, method, params } with x-clawpaw-secret header.
 */

export type ClawPawClientConfig = {
  backendUrl: string;
  uid: string;
  secret: string;
};

export type CommandResult = {
  success: boolean;
  data?: unknown;
  error?: string;
};

export class ClawPawClient {
  private readonly url: string;
  private readonly uid: string;
  private readonly secret: string;

  constructor(config: ClawPawClientConfig) {
    this.url = config.backendUrl.replace(/\/+$/, "");
    this.uid = config.uid;
    this.secret = config.secret;
  }

  async sendCommand(method: string, params: Record<string, unknown> = {}): Promise<CommandResult> {
    const res = await fetch(`${this.url}/api/mobile`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-clawpaw-secret": this.secret,
      },
      body: JSON.stringify({ uid: this.uid, method, params }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return { success: false, error: `HTTP ${res.status}: ${text}` };
    }

    return res.json() as Promise<CommandResult>;
  }

  async getLocation(): Promise<{
    latitude: number;
    longitude: number;
    accuracy?: number;
    altitude?: number;
    speed?: number;
    heading?: number;
  } | null> {
    const result = await this.sendCommand("location.get");
    if (!result.success || !result.data) return null;
    const d = result.data as Record<string, unknown>;
    const lat = typeof d.latitude === "number" ? d.latitude : null;
    const lon = typeof d.longitude === "number" ? d.longitude : null;
    if (lat === null || lon === null) return null;
    return {
      latitude: lat,
      longitude: lon,
      accuracy: typeof d.accuracy === "number" ? d.accuracy : undefined,
      altitude: typeof d.altitude === "number" ? d.altitude : undefined,
      speed: typeof d.speed === "number" ? d.speed : undefined,
      heading: typeof d.heading === "number" ? d.heading : undefined,
    };
  }

  async getBattery(): Promise<{
    level: number;
    charging: boolean;
    status?: string;
  } | null> {
    const result = await this.sendCommand("battery.get");
    if (!result.success || !result.data) return null;
    const d = result.data as Record<string, unknown>;
    return {
      level: typeof d.level === "number" ? d.level : 0,
      charging: typeof d.charging === "boolean" ? d.charging : false,
      status: typeof d.status === "string" ? d.status : undefined,
    };
  }

  async getNetwork(): Promise<Record<string, unknown> | null> {
    const result = await this.sendCommand("network.get");
    if (!result.success || !result.data) return null;
    return result.data as Record<string, unknown>;
  }

  async getNotifications(): Promise<Array<Record<string, unknown>>> {
    const result = await this.sendCommand("notifications.list");
    if (!result.success || !result.data) return [];
    const d = result.data;
    return Array.isArray(d) ? d as Array<Record<string, unknown>> : [];
  }
}
