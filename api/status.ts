import { sendJson } from "../server/vercelHttp";

export default function handler(_req: any, res: any) {
  sendJson(res, 200, {
    amap: Boolean(process.env.AMAP_WEB_SERVICE_KEY || process.env.AMAP_KEY),
    tavily: Boolean(process.env.TAVILY_API_KEY),
    bing: Boolean(process.env.BING_SEARCH_KEY),
    exa: Boolean(process.env.EXA_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    openMeteo: true,
  });
}
