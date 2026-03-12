/**
 * ClawPaw Agent — OpenClaw plugin entry point.
 *
 * Provides phone-aware capabilities via ClawPaw's backend API:
 * - Location history + semantic place detection
 * - Agent context injection (location/battery/network/trajectory)
 * - Gaode-based location services (weather/nearby/geocode)
 * - Notification change monitoring
 */

import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { jsonResult } from "openclaw/plugin-sdk";
import { ClawPawClient } from "./src/clawpaw-client.js";
import { buildContext } from "./src/context/builder.js";
import { EventStore } from "./src/events/store.js";
import { queryWeather } from "./src/gaode/weather.js";
import { searchNearby } from "./src/gaode/nearby.js";
import { geocodeAddress, reverseGeocode } from "./src/gaode/geocode.js";
import { queryWeather as googleQueryWeather } from "./src/google/weather.js";
import { searchNearby as googleSearchNearby } from "./src/google/nearby.js";
import { geocodeAddress as googleGeocodeAddress, reverseGeocode as googleReverseGeocode } from "./src/google/geocode.js";
import { EventDetector } from "./src/location/event-detector.js";
import { LocationStateStore } from "./src/location/location-state.js";
import { PlaceRegistry } from "./src/location/place-registry.js";
import { LocationCollector } from "./src/location/collector.js";
import { NotificationMonitor } from "./src/notifications/monitor.js";
import type { PlaceTag } from "./src/location/types.js";

// ─── Config ──────────────────────────────────────────────────────────

type PluginConfig = {
  backendUrl: string;
  uid: string;
  secret: string;
  locationIntervalSec: number;
  overworkHours: number;
  unusualPlaceMin: number;
  gaodeApiKey: string;
  googleApiKey: string;
  notificationIntervalSec: number;
};

function parseConfig(raw: unknown): PluginConfig {
  const o =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    backendUrl: typeof o.backendUrl === "string" ? o.backendUrl : "",
    uid: typeof o.uid === "string" ? o.uid : "",
    secret: typeof o.secret === "string" ? o.secret : "",
    locationIntervalSec: typeof o.locationIntervalSec === "number" ? o.locationIntervalSec : 120,
    overworkHours: typeof o.overworkHours === "number" ? o.overworkHours : 8,
    unusualPlaceMin: typeof o.unusualPlaceMin === "number" ? o.unusualPlaceMin : 30,
    gaodeApiKey: typeof o.gaodeApiKey === "string" ? o.gaodeApiKey : "",
    googleApiKey: typeof o.googleApiKey === "string" ? o.googleApiKey : "",
    notificationIntervalSec:
      typeof o.notificationIntervalSec === "number" ? o.notificationIntervalSec : 30,
  };
}

const configSchema = {
  parse: parseConfig,
  uiHints: {
    backendUrl: { label: "ClawPaw Backend URL", help: "ClawPaw 后端地址 (如 https://www.clawpaw.me)" },
    uid: { label: "ClawPaw UID", help: "ClawPaw 用户 UID" },
    secret: { label: "ClawPaw Secret", help: "ClawPaw 认证密钥", sensitive: true },
    locationIntervalSec: { label: "位置采集间隔 (秒)", help: "后台轮询位置的间隔，默认 120", advanced: true },
    overworkHours: { label: "加班提醒阈值 (小时)", help: "在公司超过此时间触发提醒，默认 8", advanced: true },
    unusualPlaceMin: { label: "异常地点阈值 (分钟)", help: "在未知地点超过此时间触发提醒，默认 30", advanced: true },
    gaodeApiKey: { label: "高德 API Key", help: "高德地图 API Key，用于天气/附近搜索/地理编码", sensitive: true },
    googleApiKey: { label: "Google Maps API Key", help: "Google Maps API Key，用于附近搜索/地理编码/天气", sensitive: true },
    notificationIntervalSec: { label: "通知检查间隔 (秒)", help: "后台轮询通知的间隔，默认 30", advanced: true },
  },
};

// ─── Plugin ──────────────────────────────────────────────────────────

const clawpawAgentPlugin = {
  id: "clawpaw-agent",
  name: "ClawPaw Agent",
  description:
    "通过 ClawPaw 提供手机位置追踪、上下文注入、位置服务和通知监听能力",
  configSchema,

  register(api: OpenClawPluginApi) {
    const config = parseConfig(api.pluginConfig);

    // Require ClawPaw credentials
    if (!config.backendUrl || !config.uid || !config.secret) {
      api.logger.warn("[clawpaw-agent] Missing backendUrl/uid/secret — plugin disabled");
      return;
    }

    const client = new ClawPawClient({
      backendUrl: config.backendUrl,
      uid: config.uid,
      secret: config.secret,
    });

    // Data directory
    const dataDir = path.join(
      api.runtime.state.resolveStateDir(),
      "plugins",
      "clawpaw-agent",
    );
    const store = new EventStore(dataDir);
    const registry = new PlaceRegistry(dataDir);
    const locationState = new LocationStateStore(dataDir);
    const detector = new EventDetector(registry, locationState, {
      overworkHours: config.overworkHours,
      unusualPlaceMinutes: config.unusualPlaceMin,
    });

    // ─── Tools: Place Management ──────────────────────────────────

    api.registerTool({
      name: "clawpaw_save_place",
      label: "Save Known Place",
      description:
        "注册一个已知地点（如家、公司）。后续位置更新会自动检测是否到达/离开此地点。",
      parameters: Type.Object({
        tag: Type.String({ description: "地点标签: HOME, COMPANY, 或 OTHER" }),
        label: Type.String({ description: "地点名称 (如 '家', '公司')" }),
        latitude: Type.Number({ description: "纬度" }),
        longitude: Type.Number({ description: "经度" }),
        radiusKm: Type.Optional(Type.Number({ description: "匹配半径 (km)，默认 0.5" })),
      }),
      async execute(_id, params) {
        const tag = (String(params.tag).toUpperCase() as PlaceTag) || "OTHER";
        const radiusKm = typeof params.radiusKm === "number" ? params.radiusKm : 0.5;
        const place = await registry.addPlace({
          tag,
          label: String(params.label),
          latitude: Number(params.latitude),
          longitude: Number(params.longitude),
          radiusKm,
        });
        return jsonResult({ success: true, place });
      },
    });

    api.registerTool({
      name: "clawpaw_get_places",
      label: "Get Known Places",
      description: "查看所有已注册的已知地点。",
      parameters: Type.Object({}),
      async execute() {
        const places = await registry.getPlaces();
        return jsonResult({ places });
      },
    });

    api.registerTool({
      name: "clawpaw_remove_place",
      label: "Remove Known Place",
      description: "删除一个已注册的已知地点。",
      parameters: Type.Object({
        id: Type.String({ description: "地点 ID" }),
      }),
      async execute(_id, params) {
        const removed = await registry.removePlace(String(params.id));
        return jsonResult({ success: removed });
      },
    });

    // ─── Tools: Event Queries ─────────────────────────────────────

    api.registerTool({
      name: "clawpaw_location_history",
      label: "Location History",
      description: "查询最近的位置历史记录。",
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ description: "查询最近几小时，默认 24" })),
        limit: Type.Optional(Type.Number({ description: "最大返回条数，默认 50" })),
      }),
      async execute(_id, params) {
        const hours = typeof params.hours === "number" ? params.hours : 24;
        const limit = typeof params.limit === "number" ? params.limit : 50;
        const events = await store.queryByType("geo_location", limit);
        const filtered = events.filter(
          (e) => e.timestamp >= Date.now() - hours * 3600_000,
        );
        return jsonResult({ count: filtered.length, events: filtered });
      },
    });

    api.registerTool({
      name: "clawpaw_query_events",
      label: "Query Events",
      description:
        "查询事件记录。支持按类型过滤: geo_location, place_visit, alert, notification_change。",
      parameters: Type.Object({
        type: Type.Optional(Type.String({ description: "事件类型过滤" })),
        hours: Type.Optional(Type.Number({ description: "查询最近几小时，默认 24" })),
        limit: Type.Optional(Type.Number({ description: "最大返回条数，默认 50" })),
      }),
      async execute(_id, params) {
        const hours = typeof params.hours === "number" ? params.hours : 24;
        const limit = typeof params.limit === "number" ? params.limit : 50;

        let events;
        if (typeof params.type === "string" && params.type) {
          events = await store.queryByType(params.type, limit);
        } else {
          events = await store.queryRecent(hours, limit);
        }
        return jsonResult({ count: events.length, events });
      },
    });

    // ─── Tools: Context ───────────────────────────────────────────

    api.registerTool({
      name: "clawpaw_get_context",
      label: "Get Phone Context",
      description:
        "获取当前手机状态上下文（位置、电池、网络、今日轨迹）。",
      parameters: Type.Object({}),
      async execute() {
        const context = await buildContext({
          client,
          store,
          locationState,
          placeRegistry: registry,
        });
        return jsonResult({ context });
      },
    });

    // ─── Tools: Gaode Location Services ───────────────────────────

    if (config.gaodeApiKey) {
      api.registerTool({
        name: "clawpaw_weather",
        label: "Weather Query",
        description:
          "查询天气信息（实时或预报）。提供经纬度或城市代码。",
        parameters: Type.Object({
          longitude: Type.Optional(Type.Number({ description: "经度 (WGS84)" })),
          latitude: Type.Optional(Type.Number({ description: "纬度 (WGS84)" })),
          city_code: Type.Optional(Type.String({ description: "城市 adcode (如 110000)" })),
          forecast: Type.Optional(Type.Boolean({ description: "true 返回预报，false 返回实时天气" })),
        }),
        async execute(_id, params) {
          const result = await queryWeather(config.gaodeApiKey, {
            longitude: typeof params.longitude === "number" ? params.longitude : undefined,
            latitude: typeof params.latitude === "number" ? params.latitude : undefined,
            cityCode: typeof params.city_code === "string" ? params.city_code : undefined,
            forecast: params.forecast === true,
          });
          return jsonResult({ weather: result });
        },
      });

      api.registerTool({
        name: "clawpaw_nearby",
        label: "Nearby Search",
        description:
          "搜索附近地点（餐饮、购物、医疗、交通等）。",
        parameters: Type.Object({
          longitude: Type.Number({ description: "经度 (GCJ02)" }),
          latitude: Type.Number({ description: "纬度 (GCJ02)" }),
          keywords: Type.Optional(Type.String({ description: "搜索关键词 (如 火锅, coffee)" })),
          poi_type: Type.Optional(
            Type.String({ description: "POI 类别 (餐饮/购物/咖啡厅/地铁站 等)" }),
          ),
          radius: Type.Optional(Type.Number({ description: "搜索半径 (米)，默认 1000" })),
          limit: Type.Optional(Type.Number({ description: "最大返回数，默认 10" })),
        }),
        async execute(_id, params) {
          const result = await searchNearby(config.gaodeApiKey, {
            longitude: Number(params.longitude),
            latitude: Number(params.latitude),
            keywords: typeof params.keywords === "string" ? params.keywords : undefined,
            poiType: typeof params.poi_type === "string" ? params.poi_type : undefined,
            radius: typeof params.radius === "number" ? params.radius : undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          });
          return jsonResult({ result });
        },
      });

      api.registerTool({
        name: "clawpaw_geocode",
        label: "Geocode Address",
        description: "将地址转换为经纬度坐标。",
        parameters: Type.Object({
          address: Type.String({ description: "地址文本" }),
        }),
        async execute(_id, params) {
          const result = await geocodeAddress(config.gaodeApiKey, String(params.address));
          if (!result) return jsonResult({ error: "地址无法解析" });
          return jsonResult(result);
        },
      });

      api.registerTool({
        name: "clawpaw_reverse_geocode",
        label: "Reverse Geocode",
        description: "将经纬度坐标转换为地址。",
        parameters: Type.Object({
          longitude: Type.Number({ description: "经度" }),
          latitude: Type.Number({ description: "纬度" }),
        }),
        async execute(_id, params) {
          const result = await reverseGeocode(
            config.gaodeApiKey,
            Number(params.longitude),
            Number(params.latitude),
          );
          if (!result) return jsonResult({ error: "坐标无法解析" });
          return jsonResult(result);
        },
      });

      api.logger.info("[clawpaw-agent] Gaode tools registered (weather/nearby/geocode)");
    }

    // ─── Tools: Google Maps Location Services ─────────────────────

    if (config.googleApiKey) {
      api.registerTool({
        name: "clawpaw_google_weather",
        label: "Weather Query (Google/Open-Meteo)",
        description:
          "查询天气信息（实时或预报）。使用 Open-Meteo 获取天气，Google Maps 解析城市名称。需提供经纬度。",
        parameters: Type.Object({
          longitude: Type.Number({ description: "经度 (WGS84)" }),
          latitude: Type.Number({ description: "纬度 (WGS84)" }),
          forecast: Type.Optional(Type.Boolean({ description: "true 返回预报，false 返回实时天气" })),
        }),
        async execute(_id, params) {
          const result = await googleQueryWeather(config.googleApiKey, {
            longitude: Number(params.longitude),
            latitude: Number(params.latitude),
            forecast: params.forecast === true,
          });
          return jsonResult({ weather: result });
        },
      });

      api.registerTool({
        name: "clawpaw_google_nearby",
        label: "Nearby Search (Google Maps)",
        description: "使用 Google Maps Places API 搜索附近地点（餐饮、购物、医疗、交通等）。",
        parameters: Type.Object({
          longitude: Type.Number({ description: "经度 (WGS84)" }),
          latitude: Type.Number({ description: "纬度 (WGS84)" }),
          keywords: Type.Optional(Type.String({ description: "搜索关键词 (如 火锅, coffee)" })),
          poi_type: Type.Optional(
            Type.String({ description: "POI 类别 (餐饮/购物/咖啡厅/地铁站 等)" }),
          ),
          radius: Type.Optional(Type.Number({ description: "搜索半径 (米)，默认 1000" })),
          limit: Type.Optional(Type.Number({ description: "最大返回数，默认 10" })),
        }),
        async execute(_id, params) {
          const result = await googleSearchNearby(config.googleApiKey, {
            longitude: Number(params.longitude),
            latitude: Number(params.latitude),
            keywords: typeof params.keywords === "string" ? params.keywords : undefined,
            poiType: typeof params.poi_type === "string" ? params.poi_type : undefined,
            radius: typeof params.radius === "number" ? params.radius : undefined,
            limit: typeof params.limit === "number" ? params.limit : undefined,
          });
          return jsonResult({ result });
        },
      });

      api.registerTool({
        name: "clawpaw_google_geocode",
        label: "Geocode Address (Google Maps)",
        description: "使用 Google Maps 将地址转换为经纬度坐标。",
        parameters: Type.Object({
          address: Type.String({ description: "地址文本" }),
        }),
        async execute(_id, params) {
          const result = await googleGeocodeAddress(config.googleApiKey, String(params.address));
          if (!result) return jsonResult({ error: "地址无法解析" });
          return jsonResult(result);
        },
      });

      api.registerTool({
        name: "clawpaw_google_reverse_geocode",
        label: "Reverse Geocode (Google Maps)",
        description: "使用 Google Maps 将经纬度坐标转换为地址。",
        parameters: Type.Object({
          longitude: Type.Number({ description: "经度" }),
          latitude: Type.Number({ description: "纬度" }),
        }),
        async execute(_id, params) {
          const result = await googleReverseGeocode(
            config.googleApiKey,
            Number(params.longitude),
            Number(params.latitude),
          );
          if (!result) return jsonResult({ error: "坐标无法解析" });
          return jsonResult(result);
        },
      });

      api.logger.info("[clawpaw-agent] Google Maps tools registered (weather/nearby/geocode)");
    }

    // ─── Tools: Notification Changes ──────────────────────────────

    api.registerTool({
      name: "clawpaw_notification_changes",
      label: "Notification Changes",
      description: "获取最近的手机通知变更记录。",
      parameters: Type.Object({
        hours: Type.Optional(Type.Number({ description: "查询最近几小时，默认 1" })),
        limit: Type.Optional(Type.Number({ description: "最大返回条数，默认 20" })),
      }),
      async execute(_id, params) {
        const hours = typeof params.hours === "number" ? params.hours : 1;
        const limit = typeof params.limit === "number" ? params.limit : 20;
        const events = await store.queryByType("notification_change", limit);
        const filtered = events.filter(
          (e) => e.timestamp >= Date.now() - hours * 3600_000,
        );
        return jsonResult({ count: filtered.length, events: filtered });
      },
    });

    // ─── Hook: Context Injection ──────────────────────────────────

    api.on("before_prompt_build", async () => {
      try {
        const context = await buildContext({
          client,
          store,
          locationState,
          placeRegistry: registry,
        });
        if (context.trim()) {
          return { prependContext: context };
        }
      } catch (err) {
        api.logger.warn?.(`[clawpaw-agent] context build error: ${String(err)}`);
      }
    });

    // ─── Service: Location Collector ──────────────────────────────

    let collector: LocationCollector | null = null;

    api.registerService({
      id: "clawpaw-location-collector",
      start: async () => {
        collector = new LocationCollector({
          client,
          store,
          detector,
          intervalMs: config.locationIntervalSec * 1000,
          logger: api.logger,
          onHighPriorityEvent: () => {
            api.runtime?.system?.requestHeartbeatNow?.({ reason: "hook" });
          },
        });
        collector.start();
      },
      stop: async () => {
        collector?.stop();
        collector = null;
      },
    });

    // ─── Service: Notification Monitor ────────────────────────────

    let notifMonitor: NotificationMonitor | null = null;

    api.registerService({
      id: "clawpaw-notification-monitor",
      start: async () => {
        notifMonitor = new NotificationMonitor({
          client,
          store,
          intervalMs: config.notificationIntervalSec * 1000,
          logger: api.logger,
          onNewNotification: () => {
            api.runtime?.system?.requestHeartbeatNow?.({ reason: "hook" });
          },
        });
        notifMonitor.start();
      },
      stop: async () => {
        notifMonitor?.stop();
        notifMonitor = null;
      },
    });

    api.logger.info("[clawpaw-agent] Plugin registered successfully");
  },
};

export default clawpawAgentPlugin;
