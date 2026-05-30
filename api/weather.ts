import { getWeatherResponse } from "../server/viteApiPlugin.js";
import { queryToSearchParams, sendJson } from "../server/vercelHttp.js";

export default async function handler(req: any, res: any) {
  try {
    sendJson(res, 200, await getWeatherResponse(queryToSearchParams(req.query ?? {})));
  } catch {
    sendJson(res, 502, { source: "mock", message: "天气请求失败" });
  }
}
