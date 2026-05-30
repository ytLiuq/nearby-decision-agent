import { getPlacesResponse } from "../server/viteApiPlugin.js";
import { queryToSearchParams, sendJson } from "../server/vercelHttp.js";

export default async function handler(req: any, res: any) {
  try {
    sendJson(res, 200, await getPlacesResponse(process.env, queryToSearchParams(req.query ?? {})));
  } catch {
    sendJson(res, 502, { source: "mock", providers: [], places: [], message: "POI 请求失败，已回退到 mock 候选" });
  }
}
