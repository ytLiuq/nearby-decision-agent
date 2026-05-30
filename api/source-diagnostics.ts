import { getSourceDiagnosticsResponse } from "../server/viteApiPlugin.js";
import { queryToSearchParams, sendJson } from "../server/vercelHttp.js";

export default async function handler(req: any, res: any) {
  try {
    sendJson(res, 200, await getSourceDiagnosticsResponse(process.env, queryToSearchParams(req.query ?? {})));
  } catch {
    sendJson(res, 502, { diagnostics: [], message: "数据源诊断失败" });
  }
}
