import { createServer } from "vite";

const cwd = process.cwd();
const defaultInput = {
  prompt: "3个人，预算100，附近找一家适合聊天的晚餐",
  people: 3,
  budget: 100,
  intent: "dinner",
  moods: ["chat", "value"],
  location: "116.397428,39.90923",
};

const checks = [];

function assertShape(condition, message) {
  if (!condition) throw new Error(message);
}

async function requestJson(baseUrl, path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30000);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const text = await response.text();
    let json;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      throw new Error(`Expected JSON but received: ${text.slice(0, 120)}`);
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
    }
    return json;
  } finally {
    clearTimeout(timeout);
  }
}

function record(name, result, detail) {
  checks.push({ name, result, detail });
  const icon = result === "pass" ? "PASS" : result === "warn" ? "WARN" : "FAIL";
  console.log(`${icon} ${name}${detail ? ` - ${detail}` : ""}`);
}

function statusDetail(status) {
  const enabled = Object.entries(status)
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  return enabled.length ? `enabled: ${enabled.join(", ")}` : "no external keys configured";
}

async function run() {
  const server = await createServer({
    configFile: "vite.config.ts",
    mode: "development",
    root: cwd,
    logLevel: "error",
    server: {
      host: "127.0.0.1",
      port: 0,
      strictPort: false,
    },
  });

  try {
    await server.listen();
    const baseUrl = server.resolvedUrls?.local?.[0]?.replace(/\/$/, "");
    if (!baseUrl) throw new Error("Vite did not expose a local test URL");
    console.log(`Testing API server at ${baseUrl}`);

    const status = await requestJson(baseUrl, "/api/status");
    assertShape(typeof status === "object" && status !== null, "/api/status should return an object");
    assertShape(typeof status.openMeteo === "boolean", "/api/status should include openMeteo");
    record("/api/status", "pass", statusDetail(status));

    const params = new URLSearchParams({
      intent: defaultInput.intent,
      location: defaultInput.location,
      prompt: defaultInput.prompt,
      budget: String(defaultInput.budget),
      people: String(defaultInput.people),
    });
    const places = await requestJson(baseUrl, `/api/places?${params.toString()}`, { timeoutMs: 45000 });
    assertShape(Array.isArray(places.places), "/api/places should return places[]");
    assertShape(typeof places.source === "string", "/api/places should return source");
    const placesDetail = [`source: ${places.source}`, `count: ${places.places.length}`];
    if (places.providers?.length) placesDetail.push(`providers: ${places.providers.join(", ")}`);
    if (places.message) placesDetail.push(places.message);
    record("/api/places", "pass", placesDetail.join(" | "));

    const weather = await requestJson(baseUrl, `/api/weather?location=${encodeURIComponent(defaultInput.location)}`, {
      timeoutMs: 30000,
    });
    assertShape(typeof weather.source === "string", "/api/weather should return source");
    record("/api/weather", "pass", `source: ${weather.source}${weather.weather ? `, condition: ${weather.weather.condition}` : ""}`);

    const diagnostics = await requestJson(
      baseUrl,
      `/api/source-diagnostics?intent=${defaultInput.intent}&location=${encodeURIComponent(defaultInput.location)}&budget=${defaultInput.budget}`,
      { timeoutMs: 45000 },
    );
    assertShape(Array.isArray(diagnostics.diagnostics), "/api/source-diagnostics should return diagnostics[]");
    record(
      "/api/source-diagnostics",
      "pass",
      diagnostics.diagnostics
        .map((item) => {
          const counts = `${item.usableCount}/${item.rawCount}`;
          return `${item.source}:${item.status} usable/raw=${counts}${item.message ? ` (${item.message})` : ""}`;
        })
        .join(", "),
    );

    const candidatePlaces = places.places.slice(0, 3);
    const enrichment = await requestJson(baseUrl, "/api/enrich", {
      method: "POST",
      timeoutMs: 60000,
      body: JSON.stringify({
        places: candidatePlaces.map((place) => ({
          id: place.id,
          name: place.name,
          address: place.address,
          category: place.category,
        })),
        input: defaultInput,
      }),
    });
    assertShape(Array.isArray(enrichment.enrichments), "/api/enrich should return enrichments[]");
    record(
      "/api/enrich",
      enrichment.source === "mock" && (status.tavily || status.bing || status.exa) ? "warn" : "pass",
      [`source: ${enrichment.source}`, `count: ${enrichment.enrichments.length}`, enrichment.message].filter(Boolean).join(" | "),
    );

    const enrichmentsById = new Map(enrichment.enrichments.map((item) => [item.placeId, item]));
    const enrichedPlaces = candidatePlaces.map((place) => ({
      ...place,
      enrichment: enrichmentsById.get(place.id),
    }));
    const decision = await requestJson(baseUrl, "/api/decision", {
      method: "POST",
      timeoutMs: 60000,
      body: JSON.stringify({
        places: enrichedPlaces,
        input: defaultInput,
        weather: weather.weather,
      }),
    });
    assertShape(decision.decision && typeof decision.decision.headline === "string", "/api/decision should return a decision headline");
    record(
      "/api/decision",
      decision.decision.source !== "openai" && status.openai ? "warn" : "pass",
      [`source: ${decision.decision.source}`, `best: ${decision.decision.bestPlaceId ?? "none"}`, decision.message].filter(Boolean).join(" | "),
    );

    const warnings = checks.filter((check) => check.result === "warn").length;
    const failures = checks.filter((check) => check.result === "fail").length;
    console.log(`\n${checks.length - warnings - failures} API checks passed${warnings ? `, ${warnings} warning(s)` : ""}.`);
  } catch (error) {
    record("api smoke test", "fail", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  } finally {
    await server.close();
  }
}

run();
