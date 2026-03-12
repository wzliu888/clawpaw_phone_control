/**
 * Weather query using Gaode (Amap) API.
 * Supports real-time weather and multi-day forecast.
 */

import { getCityCodeFromCoords, fetchJson, type GaodeResponse } from "./geocode.js";

type WeatherLive = {
  province: string;
  city: string;
  weather: string;
  temperature: string;
  winddirection: string;
  windpower: string;
  humidity: string;
  reporttime: string;
};

type ForecastCast = {
  date: string;
  week: string;
  dayweather: string;
  nightweather: string;
  daytemp: string;
  nighttemp: string;
  daywind: string;
  nightwind: string;
  daypower: string;
  nightpower: string;
};

function formatLiveWeather(live: WeatherLive): string {
  return [
    `【${live.province} ${live.city} 实时天气】`,
    `天气状况: ${live.weather}`,
    `温度: ${live.temperature}°C`,
    `风向: ${live.winddirection}风`,
    `风力: ${live.windpower}级`,
    `湿度: ${live.humidity}%`,
    `数据更新时间: ${live.reporttime}`,
  ].join("\n");
}

function formatForecastWeather(province: string, city: string, casts: ForecastCast[]): string {
  const weekMap: Record<string, string> = {
    "1": "一", "2": "二", "3": "三", "4": "四", "5": "五", "6": "六", "7": "日",
  };
  const lines = [`【${province} ${city} 天气预报】`, ""];
  for (const cast of casts) {
    const w = weekMap[cast.week] ?? cast.week;
    lines.push(`【${cast.date} 星期${w}】`);
    lines.push(`白天: ${cast.dayweather} ${cast.daytemp}°C ${cast.daywind}风${cast.daypower}级`);
    lines.push(`夜间: ${cast.nightweather} ${cast.nighttemp}°C ${cast.nightwind}风${cast.nightpower}级`);
    lines.push("");
  }
  return lines.join("\n").trim();
}

export async function queryWeather(
  apiKey: string,
  params: { longitude?: number; latitude?: number; cityCode?: string; forecast?: boolean },
): Promise<string> {
  let cityCode = params.cityCode;

  if (!cityCode && params.longitude != null && params.latitude != null) {
    const resolved = await getCityCodeFromCoords(apiKey, params.longitude, params.latitude);
    if (!resolved) return "无法从坐标获取城市代码";
    cityCode = resolved;
  }

  if (!cityCode) return "请提供 city_code 或 longitude+latitude";

  const extensions = params.forecast ? "all" : "base";
  const url = `https://restapi.amap.com/v3/weather/weatherInfo?key=${apiKey}&city=${cityCode}&extensions=${extensions}&output=json`;
  const data = await fetchJson(url) as GaodeResponse;

  if (data.status !== "1") return `高德 API 错误: ${data.info}`;

  if (!params.forecast) {
    const live = (data as Record<string, unknown>).lives as WeatherLive[] | undefined;
    if (!live?.[0]) return "无天气数据";
    return formatLiveWeather(live[0]);
  }

  const forecasts = (data as Record<string, unknown>).forecasts as Array<{ province: string; city: string; casts: ForecastCast[] }> | undefined;
  const forecast = forecasts?.[0];
  if (!forecast?.casts?.length) return "无预报数据";
  return formatForecastWeather(forecast.province, forecast.city, forecast.casts);
}
