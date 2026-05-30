import type { Plugin } from "vite";

const intentSearch = {
  dinner: { keyword: "餐厅", amapTypes: "050000" },
  coffee: { keyword: "咖啡", amapTypes: "050500" },
  bar: { keyword: "酒吧", amapTypes: "050700" },
  "late-night": { keyword: "夜宵", amapTypes: "050000" },
  dessert: { keyword: "甜品", amapTypes: "050900" },
  walk: { keyword: "公园", amapTypes: "060000|110000|140000" },
} as const;

type Intent = keyof typeof intentSearch;
type Mood = "quiet" | "lively" | "chat" | "date" | "value" | "photo" | "quick";
type PlaceSource = "mock" | "amap" | "merged";
type ReviewSource = "mock" | "tavily" | "mixed";
type ReviewPlatform = "xiaohongshu" | "meituan" | "dianping" | "other";

type AmapPoi = {
  id?: string;
  name?: string;
  type?: string;
  address?: string | string[];
  location?: string;
  distance?: string;
  tel?: string;
  business?: {
    rating?: string;
    cost?: string;
    opentime_today?: string;
    tag?: string;
  };
};

type AmapResponse = {
  status: string;
  info?: string;
  pois?: AmapPoi[];
};

type AmapWalkingResponse = {
  status: string;
  route?: {
    paths?: Array<{
      distance?: string;
      duration?: string;
    }>;
  };
};


type NormalizedPlace = {
  id: string;
  name: string;
  category: Intent;
  tags: Mood[];
  distanceMinutes: number;
  avgPrice: number;
  rating: number;
  groupFit: [number, number];
  openUntil: string;
  notes: string[];
  caution: string;
  address: string;
  source: PlaceSource;
  phone?: string;
  categories?: string[];
  recommendedDishes?: string[];
  qualityScore?: number;
  dataWarnings?: string[];
  qualityReasons?: string[];
  qualityPenalties?: string[];
  longitude?: number;
  latitude?: number;
  routeDistanceMeters?: number;
  routeDurationMinutes?: number;
  routeSource?: "amap-walking";
};

type DecisionInput = {
  prompt?: string;
  people?: number;
  budget?: number;
  intent?: Intent;
  moods?: Mood[];
  location?: string;
};

type WeatherContext = {
  temperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
};

function getAmapKey(env: Record<string, string | undefined>) {
  return env.AMAP_WEB_SERVICE_KEY || env.AMAP_KEY;
}

export function createNearbyApiPlugin(env: Record<string, string>): Plugin[] {
  const amapKey = getAmapKey(env);
  return [
    placesPlugin({
      amapKey,
    }),
    sourceDiagnosticsPlugin({
      amapKey,
    }),
    weatherPlugin(),
    statusPlugin(env),
    reviewEnrichmentPlugin({
      tavilyApiKey: env.TAVILY_API_KEY,
      bingApiKey: env.BING_SEARCH_KEY,
      exaApiKey: env.EXA_API_KEY,
    }),
    decisionPlugin({
      openaiApiKey: env.OPENAI_API_KEY,
      openaiModel: env.OPENAI_MODEL || "gpt-4.1-mini",
      openaiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com",
    }),
  ];
}


export function getSourceStatus(env: Record<string, string | undefined>) {
  return {
    amap: Boolean(getAmapKey(env)),
    tavily: Boolean(env.TAVILY_API_KEY),
    bing: Boolean(env.BING_SEARCH_KEY),
    exa: Boolean(env.EXA_API_KEY),
    openai: Boolean(env.OPENAI_API_KEY),
    openMeteo: true,
  };
}

export async function getPlacesResponse(env: Record<string, string | undefined>, params: URLSearchParams) {
  const intent = normalizeIntent(params.get("intent"));
  const location = params.get("location") || "116.397428,39.90923";
  const budget = Number(params.get("budget") ?? "0");
  const amapKey = getAmapKey(env);

  const results = await Promise.allSettled([
    amapKey ? fetchAmapPlaces(amapKey, intent, location) : Promise.resolve([]),
  ]);

  const places = mergePlaces(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])), intent, budget);
  const providers = Array.from(new Set(places.map((place) => place.source)));

  return {
    source: providers.length > 1 ? "merged" : providers[0] ?? "mock",
    providers,
    places,
    message: providers.length
      ? `??? ${providers.map(providerLabel).join(" + ")} POI`
      : "??????? POI????? mock ??",
  };
}

export async function getSourceDiagnosticsResponse(env: Record<string, string | undefined>, params: URLSearchParams) {
  const intent = normalizeIntent(params.get("intent"));
  const location = params.get("location") || "116.397428,39.90923";
  const budget = Number(params.get("budget") ?? "0");
  const amapKey = getAmapKey(env);

  const diagnostics = await Promise.all([
    diagnoseSource("amap", amapKey, () => fetchAmapPlaces(amapKey!, intent, location), intent, budget),
  ]);

  return {
    intent,
    location,
    diagnostics,
    message: "????????",
  };
}

export async function getWeatherResponse(params: URLSearchParams) {
  const location = params.get("location") || "116.397428,39.90923";
  const { lng, lat } = parseLngLat(location);
  const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
  weatherUrl.searchParams.set("latitude", String(lat));
  weatherUrl.searchParams.set("longitude", String(lng));
  weatherUrl.searchParams.set("current", "temperature_2m,precipitation,wind_speed_10m,weather_code");
  weatherUrl.searchParams.set("timezone", "auto");

  const weatherResponse = await fetch(weatherUrl);
  const payload = (await weatherResponse.json()) as {
    current?: {
      temperature_2m?: number;
      precipitation?: number;
      wind_speed_10m?: number;
      weather_code?: number;
    };
  };
  const current = payload.current;

  if (!current) {
    return { source: "mock", message: "??????" };
  }

  return {
    source: "open-meteo",
    weather: {
      temperature: current.temperature_2m ?? 0,
      precipitation: current.precipitation ?? 0,
      windSpeed: current.wind_speed_10m ?? 0,
      weatherCode: current.weather_code ?? 0,
      condition: weatherCodeLabel(current.weather_code ?? 0),
    },
    message: "??? Open-Meteo ??",
  };
}

export async function getEnrichmentResponse(env: Record<string, string | undefined>, body: { places?: EnrichPlace[]; input?: { prompt?: string } }) {
  const places = body.places ?? [];
  const config: EnrichmentConfig = {
    tavilyApiKey: env.TAVILY_API_KEY,
    bingApiKey: env.BING_SEARCH_KEY,
    exaApiKey: env.EXA_API_KEY,
  };

  if (!config.tavilyApiKey && !config.bingApiKey && !config.exaApiKey) {
    return {
      source: "mock",
      enrichments: places.map(mockEnrichment),
      message: "????????????? mock ????",
    };
  }

  const enrichments = [];
  for (const place of places.slice(0, 4)) {
    const webEnrichments = await Promise.allSettled([
      config.tavilyApiKey ? enrichWithTavily(place, config.tavilyApiKey, body.input?.prompt) : Promise.resolve(undefined),
      config.bingApiKey ? enrichWithBing(place, config.bingApiKey, body.input?.prompt) : Promise.resolve(undefined),
      config.exaApiKey ? enrichWithExa(place, config.exaApiKey, body.input?.prompt) : Promise.resolve(undefined),
    ]);
    const valid = webEnrichments
      .filter((result): result is PromiseFulfilledResult<Enrichment | undefined> => result.status === "fulfilled")
      .map((result) => result.value)
      .filter(Boolean) as Enrichment[];
    enrichments.push(mergeManyEnrichments(place, valid) ?? mockEnrichment(place));
  }

  const enabled = [
    config.tavilyApiKey ? "Tavily" : "",
    config.bingApiKey ? "Bing" : "",
    config.exaApiKey ? "Exa" : "",
  ].filter(Boolean);

  return {
    source: enabled.length > 1 ? "mixed" : "tavily",
    enrichments,
    message: `??? ${enabled.join(" + ")} ????`,
  };
}

export async function getDecisionResponse(
  env: Record<string, string | undefined>,
  body: { places?: NormalizedPlace[]; input?: DecisionInput; weather?: WeatherContext },
) {
  const places = (body.places ?? []).slice(0, 6);
  const fallback = buildRuleDecision(places, body.input, body.weather);
  const config = {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL || "gpt-4.1-mini",
    openaiBaseUrl: env.OPENAI_BASE_URL || "https://api.openai.com",
  };

  if (!config.openaiApiKey || !places.length) {
    return { decision: fallback, message: "OpenAI-compatible ?????????????" };
  }

  const decision = await callOpenAIDecision(config, places, body.input, body.weather, fallback);
  return {
    decision,
    message:
      decision.source === "openai"
        ? `??? OpenAI Agent ??? (${config.openaiModel})`
        : `OpenAI-compatible ????????????????? (${config.openaiModel})`,
  };
}

function placesPlugin(config: { amapKey?: string }): Plugin {
  return {
    name: "nearby-agent-places",
    configureServer(server) {
      server.middlewares.use("/api/places", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          const requestUrl = new URL(request.url ?? "", "http://localhost");
          const intent = normalizeIntent(requestUrl.searchParams.get("intent"));
          const location = requestUrl.searchParams.get("location") || "116.397428,39.90923";
          const budget = Number(requestUrl.searchParams.get("budget") ?? "0");

          const results = await Promise.allSettled([
            config.amapKey ? fetchAmapPlaces(config.amapKey, intent, location) : Promise.resolve([]),
          ]);

          const places = mergePlaces(results.flatMap((result) => (result.status === "fulfilled" ? result.value : [])), intent, budget);
          const providers = Array.from(new Set(places.map((place) => place.source)));

          response.end(
            JSON.stringify({
              source: providers.length > 1 ? "merged" : providers[0] ?? "mock",
              providers,
              places,
              message: providers.length
                ? `已接入 ${providers.map(providerLabel).join(" + ")} POI`
                : "没有拿到真实 POI，已回退到 mock 推荐",
            }),
          );
        } catch (error) {
          response.statusCode = 502;
          response.end(JSON.stringify({ source: "mock", providers: [], places: [], message: "POI 请求失败，已回退到 mock 推荐" }));
        }
      });
    },
  };
}

function statusPlugin(env: Record<string, string>): Plugin {
  const amapKey = getAmapKey(env);
  return {
    name: "nearby-agent-status",
    configureServer(server) {
      server.middlewares.use("/api/status", (_request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(
          JSON.stringify({
            amap: Boolean(amapKey),
            tavily: Boolean(env.TAVILY_API_KEY),
            bing: Boolean(env.BING_SEARCH_KEY),
            exa: Boolean(env.EXA_API_KEY),
            openai: Boolean(env.OPENAI_API_KEY),
            openMeteo: true,
          }),
        );
      });
    },
  };
}

type SourceDiagnostic = {
  source: "amap";
  status: "ok" | "empty" | "error" | "not-configured";
  durationMs: number;
  rawCount: number;
  usableCount: number;
  sampleNames: string[];
  message: string;
};

function sourceDiagnosticsPlugin(config: { amapKey?: string }): Plugin {
  return {
    name: "nearby-agent-source-diagnostics",
    configureServer(server) {
      server.middlewares.use("/api/source-diagnostics", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        const requestUrl = new URL(request.url ?? "", "http://localhost");
        const intent = normalizeIntent(requestUrl.searchParams.get("intent"));
        const location = requestUrl.searchParams.get("location") || "116.397428,39.90923";
        const budget = Number(requestUrl.searchParams.get("budget") ?? "0");

        const diagnostics = await Promise.all([
          diagnoseSource("amap", config.amapKey, () => fetchAmapPlaces(config.amapKey!, intent, location), intent, budget),
        ]);

        response.end(
          JSON.stringify({
            intent,
            location,
            diagnostics,
            message: "数据源诊断已完成",
          }),
        );
      });
    },
  };
}

async function diagnoseSource(
  source: SourceDiagnostic["source"],
  key: string | undefined,
  fetcher: () => Promise<NormalizedPlace[]>,
  intent: Intent,
  budget: number,
): Promise<SourceDiagnostic> {
  if (!key) {
    return {
      source,
      status: "not-configured",
      durationMs: 0,
      rawCount: 0,
      usableCount: 0,
      sampleNames: [],
      message: "未配置 key",
    };
  }

  const started = Date.now();
  try {
    const rawPlaces = await fetcher();
    const usablePlaces = cleanAndRankPlaces(rawPlaces, intent, budget);
    const durationMs = Date.now() - started;

    return {
      source,
      status: usablePlaces.length ? "ok" : "empty",
      durationMs,
      rawCount: rawPlaces.length,
      usableCount: usablePlaces.length,
      sampleNames: usablePlaces.slice(0, 3).map((place) => place.name),
      message: usablePlaces.length ? "可用" : rawPlaces.length ? "原始命中被质量层过滤" : "请求成功但无结果",
    };
  } catch (error) {
    return {
      source,
      status: "error",
      durationMs: Date.now() - started,
      rawCount: 0,
      usableCount: 0,
      sampleNames: [],
      message: error instanceof Error ? error.message : "请求失败",
    };
  }
}

async function fetchAmapPlaces(apiKey: string, intent: Intent, location: string): Promise<NormalizedPlace[]> {
  const amapUrl = new URL("https://restapi.amap.com/v5/place/around");
  amapUrl.searchParams.set("key", apiKey);
  amapUrl.searchParams.set("location", location);
  amapUrl.searchParams.set("keywords", intentSearch[intent].keyword);
  amapUrl.searchParams.set("types", intentSearch[intent].amapTypes);
  amapUrl.searchParams.set("radius", "3000");
  amapUrl.searchParams.set("page_size", "20");
  amapUrl.searchParams.set("page_num", "1");
  amapUrl.searchParams.set("show_fields", "business");
  amapUrl.searchParams.set("output", "json");

  const amapResponse = await fetch(amapUrl);
  const payload = (await amapResponse.json()) as AmapResponse;
  if (payload.status !== "1") return [];

  const places = (payload.pois ?? []).map((poi) => normalizeAmapPoi(poi, intent));
  return enrichAmapWalkingRoutes(apiKey, location, places);
}

function normalizeAmapPoi(poi: AmapPoi, intent: Intent): NormalizedPlace {
  const distanceMeters = Number(poi.distance ?? "900");
  const cost = Number(poi.business?.cost ?? "0");
  const rating = Number(poi.business?.rating ?? "4.2");
  const address = Array.isArray(poi.address) ? poi.address.join("") : poi.address;
  const categories = splitCategories(poi.business?.tag || poi.type);
  const poiLocation = parseOptionalLngLat(poi.location);

  return {
    id: `amap-${poi.id ?? poi.name ?? Math.random()}`,
    name: poi.name ?? "附近地点",
    category: intent,
    tags: inferTags(`${poi.name ?? ""}${poi.type ?? ""}${poi.business?.tag ?? ""}`),
    distanceMinutes: Math.max(3, Math.round(distanceMeters / 80)),
    avgPrice: Number.isFinite(cost) ? cost : 0,
    rating: Number.isFinite(rating) ? rating : 4.2,
    groupFit: inferGroupFit(intent),
    openUntil: poi.business?.opentime_today || "营业时间待确认",
    notes: [
      `${address || "地址待确认"}，距离约 ${distanceMeters || "未知"} 米`,
      categories.length ? `类别：${categories.slice(0, 4).join(" / ")}` : "类别信息待补充",
      "高德提供基础店铺、距离、人均和评分线索，可作为首轮筛选。",
    ],
    caution: "评分、人均和营业时间需要到店前再核对一次。",
    address: address || "地址待确认",
    source: "amap",
    phone: poi.tel,
    categories,
    recommendedDishes: categories.slice(0, 4),
    longitude: poiLocation.lng,
    latitude: poiLocation.lat,
  };
}

async function enrichAmapWalkingRoutes(apiKey: string, origin: string, places: NormalizedPlace[]) {
  const routed = await Promise.allSettled(
    places.map(async (place, index) => {
      if (index >= 12) return place;
      if (place.longitude === undefined || place.latitude === undefined) return place;
      const route = await fetchAmapWalkingRoute(apiKey, origin, `${place.longitude},${place.latitude}`);
      if (!route) return place;

      const routeMinutes = Math.max(1, Math.round(route.durationSeconds / 60));
      const routeNote = `高德步行路线约 ${routeMinutes} 分钟，距离 ${route.distanceMeters} 米`;

      return {
        ...place,
        distanceMinutes: routeMinutes,
        routeDistanceMeters: route.distanceMeters,
        routeDurationMinutes: routeMinutes,
        routeSource: "amap-walking" as const,
        notes: [routeNote, ...place.notes.filter((note) => !note.includes("高德步行路线约"))].slice(0, 4),
      };
    }),
  );

  return routed.map((result, index) => (result.status === "fulfilled" ? result.value : places[index]));
}

async function fetchAmapWalkingRoute(apiKey: string, origin: string, destination: string) {
  const routeUrl = new URL("https://restapi.amap.com/v3/direction/walking");
  routeUrl.searchParams.set("key", apiKey);
  routeUrl.searchParams.set("origin", origin);
  routeUrl.searchParams.set("destination", destination);
  routeUrl.searchParams.set("output", "json");

  const response = await fetch(routeUrl);
  const payload = (await response.json()) as AmapWalkingResponse;
  const path = payload.route?.paths?.[0];
  const distanceMeters = Number(path?.distance ?? "0");
  const durationSeconds = Number(path?.duration ?? "0");

  if (payload.status !== "1" || !Number.isFinite(distanceMeters) || !Number.isFinite(durationSeconds) || distanceMeters <= 0 || durationSeconds <= 0) {
    return undefined;
  }

  return { distanceMeters, durationSeconds };
}

function mergePlaces(places: NormalizedPlace[], intent: Intent, budget = 0) {
  const merged = new Map<string, NormalizedPlace>();

  for (const place of places) {
    const key = normalizePlaceKey(place);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, place);
      continue;
    }

    merged.set(key, {
      ...existing,
      source: "merged",
      avgPrice: existing.avgPrice || place.avgPrice,
      rating: Math.max(existing.rating, place.rating),
      openUntil: existing.openUntil !== "营业时间待确认" ? existing.openUntil : place.openUntil,
      phone: existing.phone || place.phone,
      categories: Array.from(new Set([...(existing.categories ?? []), ...(place.categories ?? [])])),
      recommendedDishes: Array.from(new Set([...(existing.recommendedDishes ?? []), ...(place.recommendedDishes ?? [])])),
      notes: Array.from(new Set([...existing.notes, ...place.notes])).slice(0, 4),
    });
  }

  return cleanAndRankPlaces(Array.from(merged.values()), intent, budget).slice(0, 24);
}

function cleanAndRankPlaces(places: NormalizedPlace[], intent: Intent, budget = 0) {
  return places
    .filter((place) => isIntentCompatiblePlace(place, intent))
    .filter((place) => hasMinimumPlaceQuality(place))
    .map((place) => ({
      ...place,
      qualityScore: scorePlaceQuality(place, intent, budget),
      dataWarnings: getPlaceDataWarnings(place),
      qualityReasons: getPlaceQualityReasons(place, intent, budget),
      qualityPenalties: getPlaceQualityPenalties(place, intent, budget),
    }))
    .sort((a, b) => b.qualityScore - a.qualityScore || a.distanceMinutes - b.distanceMinutes);
}

function isIntentCompatiblePlace(place: NormalizedPlace, intent: Intent) {
  const text = `${place.name} ${(place.categories ?? []).join(" ")} ${place.notes.join(" ")}`.toLowerCase();
  const patterns: Record<Intent, RegExp> = {
    dinner: /餐饮|美食|中餐|西餐|菜|餐厅|饭店|火锅|烧烤|小吃|bistro|restaurant|food|cuisine/,
    coffee: /咖啡|茶|饮品|cafe|coffee/,
    bar: /酒吧|精酿|啤酒|cocktail|bar|pub/,
    "late-night": /夜宵|烧烤|火锅|小吃|餐饮|美食|酒吧|food|restaurant|bar/,
    dessert: /甜品|面包|蛋糕|饮品|奶茶|dessert|bakery|cake/,
    walk: /公园|景点|广场|步道|商场|购物|park|scenic|mall/,
  };

  return patterns[intent].test(text);
}

function hasMinimumPlaceQuality(place: NormalizedPlace) {
  if (!place.name || /地址待确认|附近地点|nearby place/i.test(place.name)) return false;
  if (place.rating > 0 && place.rating < 3.2) return false;
  if (place.distanceMinutes > 45) return false;
  return true;
}

function scorePlaceQuality(place: NormalizedPlace, intent: Intent, budget = 0) {
  let score = 0;
  score += Math.max(0, Math.min(5, place.rating || 0)) * 18;
  if (place.avgPrice > 0) score += 12;
  if (place.avgPrice > 0 && place.avgPrice <= 150) score += 6;
  if (budget > 0 && place.avgPrice > 0 && place.avgPrice <= budget) score += 18;
  if (budget > 0 && place.avgPrice > budget) score -= Math.min(28, (place.avgPrice - budget) / 8);
  if (place.distanceMinutes <= 8) score += 18;
  else if (place.distanceMinutes <= 15) score += 10;
  else if (place.distanceMinutes <= 25) score += 4;
  if (place.source === "merged") score += 16;
  if (place.source === "amap") score += 10;
  if ((place.categories ?? []).length) score += 8;
  if (place.phone) score += 4;
  if (place.openUntil && place.openUntil !== "营业时间待确认") score += 4;
  if (place.avgPrice === 0) score -= 10;
  if (!place.address || place.address === "地址待确认") score -= 12;
  if (!isIntentCompatiblePlace(place, intent)) score -= 40;
  return Math.round(score);
}

function getPlaceDataWarnings(place: NormalizedPlace) {
  const warnings = [];
  if (!place.avgPrice) warnings.push("缺少人均消费");
  if (!place.rating) warnings.push("缺少评分");
  if (!place.openUntil || place.openUntil === "营业时间待确认") warnings.push("营业时间待确认");
  return warnings;
}

function getPlaceQualityReasons(place: NormalizedPlace, intent: Intent, budget = 0) {
  const reasons = [];
  if (isIntentCompatiblePlace(place, intent)) reasons.push("类型匹配当前场景");
  if (place.rating >= 4.5) reasons.push("评分较高");
  else if (place.rating >= 3.6) reasons.push("评分可接受");
  if (place.distanceMinutes <= 8) reasons.push("步行距离近");
  else if (place.distanceMinutes <= 15) reasons.push("距离可接受");
  if (place.avgPrice > 0 && budget > 0 && place.avgPrice <= budget) reasons.push("人均在预算内");
  if (place.avgPrice > 0) reasons.push("有人均消费参考");
  if ((place.categories ?? []).length) reasons.push("分类信息完整");
  if (place.source === "merged") reasons.push("多源 POI 交叉命中");
  else if (place.source === "amap") reasons.push("高德 POI 详情较完整");
  if (place.routeSource === "amap-walking") reasons.push("已用高德步行路线校准时间");
  if (place.phone) reasons.push("有联系电话");
  if (place.openUntil && place.openUntil !== "营业时间待确认") reasons.push("有营业时间线索");
  return reasons.slice(0, 6);
}

function getPlaceQualityPenalties(place: NormalizedPlace, intent: Intent, budget = 0) {
  const penalties = [];
  if (!isIntentCompatiblePlace(place, intent)) penalties.push("类型和当前场景弱相关");
  if (place.rating > 0 && place.rating < 3.6) penalties.push("评分偏低");
  if (place.distanceMinutes > 25) penalties.push("距离较远");
  if (!place.avgPrice) penalties.push("缺少人均消费");
  if (budget > 0 && place.avgPrice > budget) penalties.push("人均超过预算");
  if (!place.address || place.address === "地址待确认") penalties.push("地址不完整");
  if (!place.openUntil || place.openUntil === "营业时间待确认") penalties.push("营业时间待确认");
  return penalties.slice(0, 6);
}

function weatherPlugin(): Plugin {
  return {
    name: "nearby-agent-weather",
    configureServer(server) {
      server.middlewares.use("/api/weather", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          const requestUrl = new URL(request.url ?? "", "http://localhost");
          const location = requestUrl.searchParams.get("location") || "116.397428,39.90923";
          const { lng, lat } = parseLngLat(location);
          const weatherUrl = new URL("https://api.open-meteo.com/v1/forecast");
          weatherUrl.searchParams.set("latitude", String(lat));
          weatherUrl.searchParams.set("longitude", String(lng));
          weatherUrl.searchParams.set("current", "temperature_2m,precipitation,wind_speed_10m,weather_code");
          weatherUrl.searchParams.set("timezone", "auto");

          const weatherResponse = await fetch(weatherUrl);
          const payload = (await weatherResponse.json()) as {
            current?: {
              temperature_2m?: number;
              precipitation?: number;
              wind_speed_10m?: number;
              weather_code?: number;
            };
          };
          const current = payload.current;

          if (!current) {
            response.end(JSON.stringify({ source: "mock", message: "天气数据缺失" }));
            return;
          }

          response.end(
            JSON.stringify({
              source: "open-meteo",
              weather: {
                temperature: current.temperature_2m ?? 0,
                precipitation: current.precipitation ?? 0,
                windSpeed: current.wind_speed_10m ?? 0,
                weatherCode: current.weather_code ?? 0,
                condition: weatherCodeLabel(current.weather_code ?? 0),
              },
              message: "已接入 Open-Meteo 天气",
            }),
          );
        } catch {
          response.statusCode = 502;
          response.end(JSON.stringify({ source: "mock", message: "天气请求失败" }));
        }
      });
    },
  };
}

type EnrichPlace = {
  id: string;
  name: string;
  address?: string;
  category?: Intent;
};

type TavilyResult = {
  title?: string;
  url?: string;
  content?: string;
};

type TavilyResponse = {
  results?: TavilyResult[];
};

type EnrichmentConfig = {
  tavilyApiKey?: string;
  bingApiKey?: string;
  exaApiKey?: string;
};

type Enrichment = {
  placeId: string;
  source: ReviewSource;
  summary: string;
  highlights: string[];
  cautions: string[];
  tags: string[];
  links: Array<{ title: string; url: string; platform: ReviewPlatform }>;
};

function reviewEnrichmentPlugin(config: EnrichmentConfig): Plugin {
  return {
    name: "nearby-agent-review-enrichment",
    configureServer(server) {
      server.middlewares.use("/api/enrich", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          const body = (await readJsonBody(request)) as { places?: EnrichPlace[]; input?: { prompt?: string } };
          const places = body.places ?? [];

          if (!config.tavilyApiKey && !config.bingApiKey && !config.exaApiKey) {
            response.end(
              JSON.stringify({
                source: "mock",
                enrichments: places.map(mockEnrichment),
                message: "未配置搜索口碑来源，使用 mock 口碑补充",
              }),
            );
            return;
          }

          const enrichments = [];
          for (const place of places.slice(0, 4)) {
            const webEnrichments = await Promise.allSettled([
              config.tavilyApiKey ? enrichWithTavily(place, config.tavilyApiKey, body.input?.prompt) : Promise.resolve(undefined),
              config.bingApiKey ? enrichWithBing(place, config.bingApiKey, body.input?.prompt) : Promise.resolve(undefined),
              config.exaApiKey ? enrichWithExa(place, config.exaApiKey, body.input?.prompt) : Promise.resolve(undefined),
            ]);
            const valid = webEnrichments
              .filter((result): result is PromiseFulfilledResult<Enrichment | undefined> => result.status === "fulfilled")
              .map((result) => result.value)
              .filter(Boolean) as Enrichment[];
            enrichments.push(mergeManyEnrichments(place, valid) ?? mockEnrichment(place));
          }

          const enabled = [
            config.tavilyApiKey ? "Tavily" : "",
            config.bingApiKey ? "Bing" : "",
            config.exaApiKey ? "Exa" : "",
          ].filter(Boolean);

          response.end(
            JSON.stringify({
              source: enabled.length > 1 ? "mixed" : "tavily",
              enrichments,
              message: `已接入 ${enabled.join(" + ")} 口碑来源`,
            }),
          );
        } catch {
          response.statusCode = 502;
          response.end(JSON.stringify({ source: "mock", enrichments: [], message: "口碑补充失败" }));
        }
      });
    },
  };
}

async function enrichWithTavily(place: EnrichPlace, apiKey: string, prompt?: string): Promise<Enrichment> {
  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: apiKey,
      query: buildPlaceReviewQuery(place, prompt),
      search_depth: "advanced",
      max_results: 8,
      include_answer: false,
    }),
  });
  const payload = (await response.json()) as TavilyResponse;
  return buildEnrichmentFromResults(place, payload.results ?? [], "Tavily");
}

type BingResponse = {
  webPages?: {
    value?: Array<{ name?: string; url?: string; snippet?: string }>;
  };
};

async function enrichWithBing(place: EnrichPlace, apiKey: string, prompt?: string): Promise<Enrichment> {
  const bingUrl = new URL("https://api.bing.microsoft.com/v7.0/search");
  bingUrl.searchParams.set("q", buildPlaceReviewQuery(place, prompt));
  bingUrl.searchParams.set("count", "8");
  bingUrl.searchParams.set("mkt", "zh-CN");
  bingUrl.searchParams.set("responseFilter", "Webpages");

  const response = await fetch(bingUrl, {
    headers: { "Ocp-Apim-Subscription-Key": apiKey },
  });
  const payload = (await response.json()) as BingResponse;
  const results = (payload.webPages?.value ?? []).map((item) => ({
    title: item.name,
    url: item.url,
    content: item.snippet,
  }));
  return buildEnrichmentFromResults(place, results, "Bing");
}

type ExaResponse = {
  results?: Array<{ title?: string; url?: string; text?: string; summary?: string }>;
};

async function enrichWithExa(place: EnrichPlace, apiKey: string, prompt?: string): Promise<Enrichment> {
  const response = await fetch("https://api.exa.ai/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
    },
    body: JSON.stringify({
      query: buildPlaceReviewQuery(place, prompt),
      numResults: 8,
      type: "auto",
      contents: { text: true },
    }),
  });
  const payload = (await response.json()) as ExaResponse;
  const results = (payload.results ?? []).map((item) => ({
    title: item.title,
    url: item.url,
    content: item.summary || item.text,
  }));
  return buildEnrichmentFromResults(place, results, "Exa");
}

function buildEnrichmentFromResults(place: EnrichPlace, rawResults: TavilyResult[], provider: string): Enrichment {
  const results = filterReviewResults(rawResults, place).slice(0, 4);
  const text = results.map((item) => `${item.title ?? ""} ${item.content ?? ""}`).join(" ") || `${place.name} ${place.address ?? ""}`;

  return {
    placeId: place.id,
    source: "tavily",
    summary: buildSummaryFromText(text, results.length),
    highlights: inferHighlights(text, place.category),
    cautions: inferCautions(text),
    tags: inferReviewTags(text, place.category),
    links: dedupeLinks(
      results.slice(0, 3).map((item) => ({
        title: item.title ?? `${provider} 搜索结果`,
        url: item.url ?? "#",
        platform: classifyReviewPlatform(item),
      })),
    ),
  };
}

function mergeManyEnrichments(place: EnrichPlace, enrichments: Enrichment[]): Enrichment | undefined {
  if (!enrichments.length) return undefined;
  return enrichments.reduce((current, next) => ({
    placeId: place.id,
    source: current.source === "mock" ? next.source : "mixed",
    summary: Array.from(new Set([current.summary, next.summary].filter(Boolean))).join(" "),
    highlights: Array.from(new Set([...current.highlights, ...next.highlights])),
    cautions: Array.from(new Set([...current.cautions, ...next.cautions])),
    tags: Array.from(new Set([...current.tags, ...next.tags])),
    links: dedupeLinks([...current.links, ...next.links]),
  }));
}

type AgentDecision = {
  source: "openai" | "rules";
  bestPlaceId?: string;
  headline: string;
  rationale: string[];
  tradeoffs: string[];
  followUpQuestion?: string;
};

function decisionPlugin(config: { openaiApiKey?: string; openaiModel: string; openaiBaseUrl: string }): Plugin {
  return {
    name: "nearby-agent-decision",
    configureServer(server) {
      server.middlewares.use("/api/decision", async (request, response) => {
        response.setHeader("Content-Type", "application/json; charset=utf-8");

        try {
          const body = (await readJsonBody(request)) as {
            places?: NormalizedPlace[];
            input?: DecisionInput;
            weather?: WeatherContext;
          };
          const places = (body.places ?? []).slice(0, 6);
          const fallback = buildRuleDecision(places, body.input, body.weather);

          if (!config.openaiApiKey || !places.length) {
            response.end(JSON.stringify({ decision: fallback, message: "OpenAI 未配置或候选为空，使用规则决策" }));
            return;
          }

          const decision = await callOpenAIDecision(config, places, body.input, body.weather, fallback);
          response.end(
            JSON.stringify({
              decision,
              message:
                decision.source === "openai"
                  ? `已接入 OpenAI Agent 决策层 (${config.openaiModel})`
                  : `OpenAI 当前不可用，已使用规则决策兜底 (${config.openaiModel})`,
            }),
          );
        } catch {
          response.statusCode = 502;
          response.end(JSON.stringify({ decision: buildRuleDecision([], undefined, undefined), message: "OpenAI 决策失败，使用规则兜底" }));
        }
      });
    },
  };
}

async function callOpenAIDecision(
  config: { openaiApiKey?: string; openaiModel: string; openaiBaseUrl: string },
  places: NormalizedPlace[],
  input?: DecisionInput,
  weather?: WeatherContext,
  fallback?: AgentDecision,
): Promise<AgentDecision> {
  try {
    const payload = {
      model: config.openaiModel,
      input: [
        {
          role: "system",
          content:
            "你是一个本地生活决策 Agent。只基于用户需求、天气和候选 POI 做选择，不编造不存在的链接、评分或价格。输出必须是严格 JSON。",
        },
        {
          role: "user",
          content: JSON.stringify({
            userNeed: input,
            weather,
            candidates: places.map((place) => ({
              id: place.id,
              name: place.name,
              address: place.address,
              distanceMinutes: place.distanceMinutes,
              routeDistanceMeters: place.routeDistanceMeters,
              routeDurationMinutes: place.routeDurationMinutes,
              avgPrice: place.avgPrice,
              rating: place.rating,
              categories: place.categories,
              tags: place.tags,
              notes: place.notes,
              caution: place.caution,
              qualityScore: place.qualityScore,
              qualityReasons: place.qualityReasons,
              qualityPenalties: place.qualityPenalties,
              dataWarnings: place.dataWarnings,
            })),
            requiredShape: {
              source: "openai",
              bestPlaceId: "one candidate id",
              headline: "one short Chinese sentence",
              rationale: ["2-4 concise reasons"],
              tradeoffs: ["1-3 caveats"],
              followUpQuestion: "optional next question",
            },
          }),
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "nearby_decision",
          strict: true,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              source: { type: "string", enum: ["openai"] },
              bestPlaceId: { type: "string" },
              headline: { type: "string" },
              rationale: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 4 },
              tradeoffs: { type: "array", items: { type: "string" }, minItems: 0, maxItems: 3 },
              followUpQuestion: { type: "string" },
            },
            required: ["source", "bestPlaceId", "headline", "rationale", "tradeoffs", "followUpQuestion"],
          },
        },
      },
    };

    const apiBaseUrl = config.openaiBaseUrl.replace(/\/+$/, "");
    const chatCompletionsUrl = apiBaseUrl.includes("api.deepseek.com") && !apiBaseUrl.endsWith("/v1")
      ? `${apiBaseUrl}/chat/completions`
      : `${apiBaseUrl}/v1/chat/completions`;
    const chatPayload = {
      model: config.openaiModel,
      messages: payload.input,
      response_format: { type: "json_object" },
      temperature: 0.2,
    };

    const response = await fetch(chatCompletionsUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.openaiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(chatPayload),
    });

    if (!response.ok) return fallback ?? buildRuleDecision(places, input, weather);

    const json = (await response.json()) as {
      output_text?: string;
      output?: Array<{ content?: Array<{ text?: string; type?: string }> }>;
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text =
      json.output_text ||
      json.choices?.[0]?.message?.content ||
      json.output
        ?.flatMap((item) => item.content ?? [])
        .map((item) => item.text ?? "")
        .join("") ||
      "";
    if (!text.trim()) return fallback ?? buildRuleDecision(places, input, weather);

    const parsed = JSON.parse(text) as AgentDecision;
    if (!places.some((place) => place.id === parsed.bestPlaceId)) {
      return fallback ?? buildRuleDecision(places, input, weather);
    }

    return {
      source: "openai",
      bestPlaceId: parsed.bestPlaceId,
      headline: parsed.headline,
      rationale: parsed.rationale.slice(0, 4),
      tradeoffs: parsed.tradeoffs.slice(0, 3),
      followUpQuestion: parsed.followUpQuestion,
    };
  } catch {
    return fallback ?? buildRuleDecision(places, input, weather);
  }
}

function buildRuleDecision(places: NormalizedPlace[], input?: DecisionInput, weather?: WeatherContext): AgentDecision {
  const best = places[0];
  if (!best) {
    return {
      source: "rules",
      headline: "还没有足够候选，先扩大搜索范围更稳。",
      rationale: ["当前没有可比较的真实 POI。"],
      tradeoffs: ["需要先确认位置、类型或 API 状态。"],
      followUpQuestion: "要不要把半径扩大到 5 公里？",
    };
  }

  const budget = input?.budget ?? 0;
  const weatherReason = weather?.precipitation ? `当前有降水，优先选择距离近的 ${best.name}。` : `${best.name} 距离近，适合作为第一选择。`;
  const priceReason = best.avgPrice && budget ? `人均约 ${best.avgPrice}，${best.avgPrice <= budget ? "在预算内" : "略高于预算，需要确认" }。` : "人均信息不完整，需要到店前确认。";

  return {
    source: "rules",
    bestPlaceId: best.id,
    headline: `先选 ${best.name}，确定性最高。`,
    rationale: [weatherReason, priceReason, `评分约 ${best.rating}，分类和地址信息较完整。`],
    tradeoffs: [best.caution],
    followUpQuestion: "你更在意安静聊天，还是性价比和少排队？",
  };
}

function mockEnrichment(place: EnrichPlace): Enrichment {
  return {
    placeId: place.id,
    source: "mock",
    summary: "口碑层没有拿到可靠公开结果，先只展示 POI 基础信息。",
    highlights: inferHighlights(place.name, place.category),
    cautions: ["真实评论、排队和热门菜仍需补充验证。"],
    tags: inferReviewTags(place.name, place.category),
    links: [],
  };
}

function buildPlaceReviewQuery(place: EnrichPlace, prompt?: string) {
  const addressHint = cleanAddress(place.address);
  const userNeed = extractSearchNeed(prompt);
  const base = [`"${place.name}"`, addressHint, userNeed].filter(Boolean).join(" ");
  return `${base} (大众点评 OR 小红书 OR 美团 OR site:dianping.com OR site:meituan.com OR site:xiaohongshu.com) (推荐菜 OR 人均 OR 排队 OR 环境 OR 避雷 OR 适合聊天) -行业报告 -招商 -加盟`;
}

function filterReviewResults(results: TavilyResult[], place: EnrichPlace) {
  const fullName = place.name;
  const placeName = extractPlaceBaseName(place.name);
  const branchHint = extractBranchHint(place.name);
  const addressToken = cleanAddress(place.address).slice(0, 8);
  return results
    .map((item) => ({ ...item, score: scoreReviewResult(item, fullName, placeName, branchHint, addressToken) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
}

function scoreReviewResult(item: TavilyResult, fullName: string, placeName: string, branchHint: string, addressToken: string) {
  const title = item.title ?? "";
  const content = item.content ?? "";
  const url = item.url ?? "";
  const text = `${title} ${content}`;
  let score = 0;
  const hasExactName = Boolean(fullName && text.includes(fullName));
  const hasBaseName = Boolean(placeName && text.includes(placeName));
  const hasBranch = Boolean(branchHint && text.includes(branchHint));
  const hasAddress = Boolean(addressToken && text.includes(addressToken));
  const hasPlaceSignal = hasExactName || hasBaseName || hasAddress;
  if (!hasPlaceSignal) return -10;
  if (branchHint && hasBaseName && !hasBranch && !hasAddress && hasOtherBranchSignal(text, branchHint)) return -8;
  if (hasExactName) score += 16;
  if (hasBaseName) score += 8;
  if (hasBranch) score += 12;
  if (hasAddress) score += 10;
  if (branchHint && !hasBranch && !hasAddress) score -= 6;
  if (/大众点评|小红书|美团|dianping|xiaohongshu|meituan|smzdm|马蜂窝|携程|抖音/.test(text + url)) score += 4;
  if (/推荐菜|人均|排队|环境|避雷|适合聊天|好吃|安静|性价比/.test(text)) score += 4;
  if (/招商|加盟|行业报告|下载|App Store|股票|新闻/.test(text + url)) score -= 10;
  return score;
}

function extractPlaceBaseName(name: string) {
  return name.replace(/\([^)]*\)|（[^）]*）/g, "").trim();
}

function extractBranchHint(name: string) {
  const match = name.match(/\(([^)]*)\)|（([^）]*)）/);
  return (match?.[1] || match?.[2] || "").replace(/店$/, "").trim();
}

function hasOtherBranchSignal(text: string, branchHint: string) {
  const branchMatches = Array.from(text.matchAll(/[（(]([^）)]{2,20})[店铺]?[）)]/g)).map((match) => match[1]);
  return branchMatches.some((branch) => !branch.includes(branchHint) && !branchHint.includes(branch));
}

function buildSummaryFromText(text: string, resultCount = 0) {
  if (!text.trim() || resultCount === 0) return "没有命中足够具体的公开口碑结果，建议只把它当作 POI 候选。";
  const signals = [];
  if (/推荐菜|必点|招牌|好吃/.test(text)) signals.push("有推荐菜或招牌菜线索");
  if (/排队|等位|人多/.test(text)) signals.push("可能存在排队");
  if (/人均|性价比|划算/.test(text)) signals.push("有人均或性价比线索");
  if (/安静|聊天|环境|氛围/.test(text)) signals.push("有环境氛围线索");
  return signals.length ? `公开口碑命中 ${resultCount} 条：${signals.join("，")}。` : `公开口碑命中 ${resultCount} 条，但有效细节有限。`;
}

function inferHighlights(text: string, category?: Intent) {
  const highlights = [];
  if (/推荐菜|必点|招牌|好吃/.test(text)) highlights.push("有菜品推荐线索");
  if (/安静|聊天|环境|氛围/.test(text)) highlights.push("可能适合聊天或约会");
  if (/性价比|划算|人均/.test(text)) highlights.push("有预算参考线索");
  if (category === "coffee") highlights.push("适合咖啡和轻聊天");
  if (category === "bar") highlights.push("适合晚一点的小聚");
  return highlights.length ? highlights : ["基础 POI 信息可用"];
}

function inferCautions(text: string) {
  const cautions = [];
  if (/排队|等位|人多/.test(text)) cautions.push("可能需要排队或提前取号");
  if (/贵|踩雷|一般|服务/.test(text)) cautions.push("口碑存在分歧，需要二次确认");
  return cautions;
}

function inferReviewTags(text: string, category?: Intent) {
  const tags = new Set<Mood>();
  if (/安静|咖啡|书店/.test(text)) tags.add("quiet");
  if (/热闹|酒吧|夜宵/.test(text)) tags.add("lively");
  if (/聊天|聚会/.test(text)) tags.add("chat");
  if (/约会|氛围|拍照/.test(text)) tags.add("date");
  if (/性价比|划算|人均/.test(text)) tags.add("value");
  if (/拍照|出片/.test(text)) tags.add("photo");
  if (/快餐|简餐|近/.test(text)) tags.add("quick");
  if (category === "coffee") tags.add("quiet");
  if (category === "bar") tags.add("lively");
  if (category === "dinner") tags.add("chat");
  return Array.from(tags);
}

function classifyReviewPlatform(item: TavilyResult): ReviewPlatform {
  const text = `${item.title ?? ""} ${item.url ?? ""} ${item.content ?? ""}`.toLowerCase();
  if (/xiaohongshu|小红书|xhslink/.test(text)) return "xiaohongshu";
  if (/meituan|美团/.test(text)) return "meituan";
  if (/dianping|大众点评/.test(text)) return "dianping";
  return "other";
}

function inferTags(text: string): Mood[] {
  const tags = new Set<Mood>(["chat"]);
  if (/咖啡|甜品|书店|茶/.test(text)) tags.add("quiet");
  if (/酒吧|夜宵|烧烤|火锅/.test(text)) tags.add("lively");
  if (/快餐|简餐|小吃/.test(text)) tags.add("quick");
  if (/公园|景点|甜品|咖啡/.test(text)) tags.add("photo");
  if (/小吃|快餐|简餐/.test(text)) tags.add("value");
  return Array.from(tags);
}

function inferGroupFit(intent: Intent): [number, number] {
  if (intent === "bar" || intent === "coffee" || intent === "dessert") return [1, 4];
  if (intent === "walk") return [1, 6];
  return [1, 8];
}

function splitCategories(value?: string) {
  if (!value) return [];
  return value
    .split(/[;,|、，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeIntent(value: string | null): Intent {
  if (value && value in intentSearch) return value as Intent;
  return "dinner";
}

function normalizePlaceKey(place: NormalizedPlace) {
  return `${place.name.replace(/\([^)]*\)/g, "").trim()}-${place.address.slice(0, 10)}`;
}

function providerLabel(provider: PlaceSource) {
  if (provider === "amap") return "高德";
  if (provider === "merged") return "多源合并";
  return "Mock";
}

function weatherCodeLabel(code: number) {
  if (code === 0) return "晴";
  if ([1, 2, 3].includes(code)) return "多云";
  if ([45, 48].includes(code)) return "雾";
  if ([51, 53, 55, 61, 63, 65, 80, 81, 82].includes(code)) return "雨";
  if ([71, 73, 75, 77, 85, 86].includes(code)) return "雪";
  if ([95, 96, 99].includes(code)) return "雷雨";
  return "未知";
}

function parseLngLat(location: string) {
  const [lngRaw, latRaw] = location.split(",");
  return {
    lng: Number(lngRaw) || 116.397428,
    lat: Number(latRaw) || 39.90923,
  };
}

function parseOptionalLngLat(location?: string) {
  if (!location) return {};
  const [lngRaw, latRaw] = location.split(",");
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return {};
  return { lng, lat };
}

function cleanAddress(address?: string) {
  if (!address) return "";
  return address.replace(/\([^)]*\)/g, "").slice(0, 28);
}

function extractSearchNeed(prompt?: string) {
  if (!prompt) return "";
  const needWords = ["安静", "聊天", "聚会", "咖啡", "甜品", "夜宵", "酒吧", "便宜", "约会", "拍照", "少排队", "性价比"];
  return needWords.filter((word) => prompt.includes(word)).join(" ");
}

function dedupeLinks<T extends { url: string }>(links: T[]) {
  const seen = new Set<string>();
  return links.filter((link) => {
    if (!link.url || link.url === "#" || seen.has(link.url)) return false;
    seen.add(link.url);
    return true;
  });
}

async function readJsonBody(request: import("node:http").IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}
