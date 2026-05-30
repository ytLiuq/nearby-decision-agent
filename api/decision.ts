import { getDecisionResponse } from "../server/viteApiPlugin.js";
import { parseJsonBody, sendJson } from "../server/vercelHttp.js";

export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    sendJson(res, 405, { decision: { source: "rules", headline: "请求方法不支持", rationale: [], tradeoffs: [] } });
    return;
  }

  try {
    sendJson(res, 200, await getDecisionResponse(process.env, await parseJsonBody(req)));
  } catch {
    sendJson(res, 502, {
      decision: { source: "rules", headline: "模型决策请求失败", rationale: [], tradeoffs: [] },
      message: "模型决策请求失败",
    });
  }
}
