# Nearby Decision Agent

一个本地生活决策 Agent 原型：用户输入人数、预算、位置和场景，系统拉取附近 POI、天气和公开口碑线索，再由 OpenAI 决策层给出“先去哪一家”的解释。

## 当前数据源

- 高德 Web 服务：`/api/places` 使用 `AMAP_WEB_SERVICE_KEY` 拉取附近 POI、距离、评分、人均和营业信息。
- Open-Meteo：`/api/weather` 免费拉取当前天气，无需 key。
- Tavily：`/api/enrich` 使用 `TAVILY_API_KEY` 搜索公开网页口碑线索。
- Exa：`/api/enrich` 使用 `EXA_API_KEY` 搜索公开网页口碑线索。
- Bing Search：`/api/enrich` 仍保留 `BING_SEARCH_KEY` 兼容入口；如果你没有可用的 Azure Bing Search 资源，可以先不配置。
- OpenAI-compatible 模型：`/api/decision` 使用 `OPENAI_API_KEY`、`OPENAI_BASE_URL` 和 `OPENAI_MODEL` 做最终 Agent 决策，失败时自动回退到规则决策。DeepSeek 可配置为 `https://api.deepseek.com` 和 `deepseek-v4-flash`。

小红书 MCP 和 Cookie 接入已移除。搜索结果里如果命中公开的小红书、美团或大众点评网页，卡片仍会按平台标注链接来源。

## 环境变量

复制 `.env.example` 为 `.env.local`，按需填写：

```bash
AMAP_WEB_SERVICE_KEY=your_amap_web_service_key
TAVILY_API_KEY=your_tavily_api_key
BING_SEARCH_KEY=your_bing_search_api_key
EXA_API_KEY=your_exa_api_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可使用。API key 只在 Vite 服务端插件中读取，不会暴露给前端。

## 接口测试

```bash
npm run test:api
```

该命令会临时启动 Vite API server，并依次检查 `/api/status`、`/api/places`、`/api/weather`、`/api/source-diagnostics`、`/api/enrich` 和 `/api/decision`。输出里会标注每个接口是否返回了合法 JSON、使用的真实源或兜底源，以及候选数量；不会打印任何 API key。

```bash
npm run typecheck:api
```

该命令只检查 Vercel Functions 入口和服务端共享逻辑的类型。

## 项目结构

- `src/`：浏览器端 React 应用、领域类型、前端推荐打分和 API client。
- `api/`：Vercel Functions 入口，线上部署时提供 `/api/*`。
- `server/viteApiPlugin.ts`：本地 Vite dev server 的 API 插件和可复用 API 核心逻辑，负责 POI 拉取、天气、口碑搜索、数据清洗和 OpenAI-compatible 模型决策。
- `server/vercelHttp.ts`：Vercel 请求参数、JSON body 和响应的小工具。
- `vite.config.ts`：只保留 Vite 配置入口，并挂载 React 插件和本地 API 插件。
- `vercel.json`：Vercel 构建和函数配置。

## API 速览

- `GET /api/status`：查看高德、Tavily、Bing、Exa、OpenAI、Open-Meteo 是否已配置。
- `GET /api/places?intent=dinner&location=116.397428,39.90923`：拉取附近候选地点。
- `GET /api/weather?location=116.397428,39.90923`：拉取天气上下文。
- `POST /api/enrich`：给候选地点补充公开口碑和来源链接。
- `POST /api/decision`：让 OpenAI Agent 在候选地点里做最终选择。

## 部署说明

当前项目已支持 Vercel 部署。Vite 负责构建前端静态文件，`api/*.ts` 负责线上 `/api/*` 接口。

在 Vercel Project Settings 中配置这些环境变量：

```bash
AMAP_WEB_SERVICE_KEY=your_amap_web_service_key
TAVILY_API_KEY=your_tavily_api_key
BING_SEARCH_KEY=your_bing_search_api_key
EXA_API_KEY=your_exa_api_key
OPENAI_API_KEY=your_openai_api_key
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
```

如果部署到 GitHub Pages、纯 CDN 或任意静态托管服务，页面可以打开，但 `/api/*` 不会存在。Vercel 部署不会有这个问题。
