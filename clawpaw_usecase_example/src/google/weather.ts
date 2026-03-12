/**
 * Weather query using Open-Meteo (free, no API key required).
 * Drop-in replacement for Gaode weather — same interface, same output format.
 *
 * Geocoding (coordinates → city name) is done via Google Maps Geocoding API
 * when a googleApiKey is provided; otherwise city name is omitted.
 */

import { reverseGeocode } from "./geocode.js";

const WMO_CODES: Record<number, string> = {
  0: "晴", 1: "晴间多云", 2: "多云", 3: "阴",
  45: "大雾", 48: "冻雾",
  51: "小毛毛雨", 53: "毛毛雨", 55: "大毛毛雨",
  61: "小雨", 63: "中雨", 65: "大雨",
  71: "小雪", 73: "中雪", 75: "大雪",
  77: "冰粒",
  80: "小阵雨", 81: "中阵雨", 82: "强阵雨",
  85: "阵雪", 86: "强阵雪",
  95: "雷暴", 96: "雷暴伴冰雹", 99: "强雷暴伴冰雹",
};

const WEEK_DAYS = ["日", "一", "二", "三", "四", "五", "六"];

function wmoLabel(code: number): string {
  return WMO_CODES[code] ?? `代码${code}`;
}

function windLabel(speed: number): string {
  if (speed < 1) return "0级";
  if (speed < 6) return "1级";
  if (speed < 12) return "2级";
  if (speed < 20) return "3级";
  if (speed < 29) return "4级";
  if (speed < 39) return "5级";
  if (speed < 50) return "6级";
  if (speed < 62) return "7级";
  if (speed < 75) return "8级";
  if (speed < 89) return "9级";
  if (speed < 103) return "10级";
  if (speed < 118) return "11级";
  return "12级以上";
}

export async function queryWeather(
  googleApiKey: string,
  params: { longitude?: number; latitude?: number; cityCode?: string; forecast?: boolean },
): Promise<string> {
  if (params.longitude == null || params.latitude == null) {
    return "请提供 longitude 和 latitude（Open-Meteo 不支持 city_code，需要坐标）";
  }

  const { longitude, latitude } = params;

  // Resolve city name via Google reverse geocode (best-effort)
  let cityLabel = "";
  if (googleApiKey) {
    try {
      const geo = await reverseGeocode(googleApiKey, longitude, latitude);
      if (geo) cityLabel = `${geo.province} ${geo.city}`.trim();
    } catch {
      // non-fatal
    }
  }

  const locationStr = `${latitude},${longitude}`;

  if (!params.forecast) {
    // Real-time: current_weather + hourly humidity
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${latitude}&longitude=${longitude}` +
      `&current_weather=true` +
      `&hourly=relativehumidity_2m` +
      `&forecast_days=1` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return `Open-Meteo HTTP 错误: ${res.status}`;
    const data = (await res.json()) as Record<string, unknown>;

    const cw = data.current_weather as Record<string, unknown> | undefined;
    if (!cw) return "无天气数据";

    const temp = String(cw.temperature ?? "?");
    const windspeed = typeof cw.windspeed === "number" ? cw.windspeed : 0;
    const winddirDeg = typeof cw.winddirection === "number" ? cw.winddirection : 0;
    const wmoCode = typeof cw.weathercode === "number" ? cw.weathercode : -1;
    const reporttime = String(cw.time ?? "");

    // Pick current hour humidity
    const hourly = data.hourly as Record<string, unknown> | undefined;
    const times = hourly?.time as string[] | undefined;
    const humidities = hourly?.relativehumidity_2m as number[] | undefined;
    let humidity = "?";
    if (times && humidities) {
      const nowHour = reporttime.slice(0, 13); // "2024-01-15T14"
      const idx = times.findIndex((t) => t.startsWith(nowHour));
      if (idx >= 0) humidity = String(humidities[idx]);
    }

    const windDir = windDegToLabel(winddirDeg);

    const header = cityLabel ? `【${cityLabel} 实时天气】` : `【${locationStr} 实时天气】`;
    return [
      header,
      `天气状况: ${wmoLabel(wmoCode)}`,
      `温度: ${temp}°C`,
      `风向: ${windDir}风`,
      `风力: ${windLabel(windspeed)}`,
      `湿度: ${humidity}%`,
      `数据更新时间: ${reporttime}`,
    ].join("\n");
  }

  // Forecast: daily for next 4 days
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${latitude}&longitude=${longitude}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,windspeed_10m_max,winddirection_10m_dominant` +
    `&forecast_days=4` +
    `&timezone=auto`;

  const res = await fetch(url);
  if (!res.ok) return `Open-Meteo HTTP 错误: ${res.status}`;
  const data = (await res.json()) as Record<string, unknown>;

  const daily = data.daily as Record<string, unknown> | undefined;
  if (!daily) return "无预报数据";

  const dates = daily.time as string[] | undefined;
  const codes = daily.weathercode as number[] | undefined;
  const maxTemps = daily.temperature_2m_max as number[] | undefined;
  const minTemps = daily.temperature_2m_min as number[] | undefined;
  const windSpeeds = daily.windspeed_10m_max as number[] | undefined;
  const windDirs = daily.winddirection_10m_dominant as number[] | undefined;

  if (!dates?.length) return "无预报数据";

  const header = cityLabel ? `【${cityLabel} 天气预报】` : `【${locationStr} 天气预报】`;
  const lines = [header, ""];

  for (let i = 0; i < dates.length; i++) {
    const date = dates[i];
    const weekDay = WEEK_DAYS[new Date(date).getDay()] ?? "?";
    const code = codes?.[i] ?? -1;
    const maxT = maxTemps?.[i] ?? "?";
    const minT = minTemps?.[i] ?? "?";
    const wspeed = windSpeeds?.[i] ?? 0;
    const wdir = windDirs?.[i] ?? 0;

    lines.push(`【${date} 星期${weekDay}】`);
    lines.push(`天气: ${wmoLabel(code)}`);
    lines.push(`气温: ${minT}°C ~ ${maxT}°C`);
    lines.push(`风向: ${windDegToLabel(wdir)}风 ${windLabel(wspeed)}`);
    lines.push("");
  }

  return lines.join("\n").trim();
}

function windDegToLabel(deg: number): string {
  const dirs = ["北", "东北", "东", "东南", "南", "西南", "西", "西北"];
  return dirs[Math.round(deg / 45) % 8];
}
