import { getEnrichmentResponse } from "../server/viteApiPlugin.js";
import { parseJsonBody, sendJson } from "../server/vercelHttp.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { source: "mock", enrichments: [], message: "Method not allowed" });
    return;
  }

  try {
    sendJson(res, 200, await getEnrichmentResponse(process.env, await parseJsonBody(req)));
  } catch {
    sendJson(res, 502, { source: "mock", enrichments: [], message: "口碑补充请求失败" });
  }
}
