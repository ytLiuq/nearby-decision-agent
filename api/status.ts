import { getSourceStatus } from "../server/viteApiPlugin";
import { sendJson } from "../server/vercelHttp";

export default function handler(_req: any, res: any) {
  sendJson(res, 200, getSourceStatus(process.env));
}
