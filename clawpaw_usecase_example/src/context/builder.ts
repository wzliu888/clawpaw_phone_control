/**
 * Agent context builder.
 * Assembles current phone state (location, battery, network, trajectory)
 * into a formatted context string for injection into agent prompts.
 */

import type { ClawPawClient } from "../clawpaw-client.js";
import type { EventStore } from "../events/store.js";
import { haversineDistance } from "../location/geo.js";
import type { LocationStateStore } from "../location/location-state.js";
import type { PlaceRegistry } from "../location/place-registry.js";

const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function formatDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function getTimePeriod(ms: number): string {
  const hour = new Date(ms).getHours();
  if (hour >= 6 && hour < 9) return "早上";
  if (hour >= 9 && hour < 12) return "上午";
  if (hour >= 12 && hour < 14) return "中午";
  if (hour >= 14 && hour < 18) return "下午";
  if (hour >= 18 && hour < 22) return "晚上";
  return "深夜";
}

function formatDuration(ms: number): string {
  const hours = Math.floor(ms / 3600_000);
  const minutes = Math.round((ms % 3600_000) / 60_000);
  if (hours > 0) return minutes > 0 ? `${hours}小时${minutes}分钟` : `${hours}小时`;
  return `${minutes}分钟`;
}

export type ContextBuilderDeps = {
  client: ClawPawClient;
  store: EventStore;
  locationState: LocationStateStore;
  placeRegistry: PlaceRegistry;
};

export async function buildContext(deps: ContextBuilderDeps): Promise<string> {
  const { client, store, locationState, placeRegistry } = deps;
  const now = Date.now();

  const sections: string[] = ["# 用户状态上下文\n"];
  const statusLines: string[] = [];

  // Time
  const d = new Date(now);
  const weekday = WEEKDAYS[d.getDay()];
  statusLines.push(`- 时间: ${formatDate(now)} 周${weekday} ${getTimePeriod(now)} ${formatTime(now)}`);

  // Location from persisted state
  const locState = await locationState.load();
  if (locState?.session) {
    const elapsed = now - locState.session.enterTime;
    const tag = locState.session.currentTag;
    const allPlaces = await placeRegistry.getPlaces();

    // Resolve human-readable label
    const session = locState.session;
    let locationDesc: string = tag;
    if (session.placeId) {
      const matched = allPlaces.find((p) => p.id === session.placeId);
      if (matched) locationDesc = matched.label;
    }

    if (tag === "UNKNOWN" && locState.lastLocation && allPlaces.length > 0) {
      let nearest: { label: string; distKm: number } | null = null;
      for (const p of allPlaces) {
        const dist = haversineDistance(
          locState.lastLocation.latitude,
          locState.lastLocation.longitude,
          p.latitude,
          p.longitude,
        );
        if (!nearest || dist < nearest.distKm) {
          nearest = { label: p.label, distKm: dist };
        }
      }
      if (nearest) {
        statusLines.push(
          `- 位置: 未知地点 (已停留 ${formatDuration(elapsed)})，距最近的「${nearest.label}」约 ${nearest.distKm.toFixed(1)}km`,
        );
      } else {
        statusLines.push(`- 位置: 未知地点 (已停留 ${formatDuration(elapsed)})`);
      }
    } else {
      statusLines.push(`- 位置: ${locationDesc} (已停留 ${formatDuration(elapsed)})`);
    }
  }

  // Battery and network (parallel fetch, best effort)
  const [battery, network] = await Promise.all([
    client.getBattery().catch(() => null),
    client.getNetwork().catch(() => null),
  ]);

  if (battery) {
    const chargingStr = battery.charging ? "充电中" : "未充电";
    statusLines.push(`- 电池: ${battery.level}% ${chargingStr}`);
  }

  if (network) {
    const parts: string[] = [];
    if (typeof network.type === "string") parts.push(network.type);
    if (typeof network.ssid === "string") parts.push(network.ssid);
    if (typeof network.status === "string") parts.push(network.status);
    if (parts.length > 0) {
      statusLines.push(`- 网络: ${parts.join(" ")}`);
    }
  }

  sections.push("## 当前状态");
  sections.push(...statusLines, "");

  // Today's trajectory from place_visit events
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const placeVisits = (await store.queryByType("place_visit", 50)).filter(
    (e) => e.timestamp >= todayStart.getTime(),
  );
  const enterEvents = placeVisits
    .filter((e) => e.name === "enter_place")
    .sort((a, b) => a.timestamp - b.timestamp);

  if (enterEvents.length > 1) {
    const STAY_THRESHOLD_MS = 15 * 60_000;
    const stops: string[] = [];

    for (let i = 0; i < enterEvents.length; i++) {
      const e = enterEvents[i];
      const toTag = e.data.toTag as string;

      if (toTag === "UNKNOWN") {
        const nextEvent = enterEvents[i + 1];
        const stayEnd = nextEvent ? nextEvent.timestamp : now;
        if (stayEnd - e.timestamp >= STAY_THRESHOLD_MS) {
          stops.push(`外出 (${formatTime(e.timestamp)})`);
        }
      } else {
        const label = (e.data.placeLabel as string) ?? toTag;
        stops.push(`${label} (${formatTime(e.timestamp)})`);
      }
    }

    if (stops.length > 1) {
      if (locState?.session?.currentTag !== "UNKNOWN") {
        stops[stops.length - 1] = stops[stops.length - 1].replace(/\)$/, "-至今)");
      }
      sections.push("## 今日轨迹");
      sections.push(stops.join(" → "), "");
    }
  }

  return sections.join("\n");
}
