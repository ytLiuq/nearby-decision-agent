import type {
  DecisionInput,
  DecisionResponse,
  EnrichmentResponse,
  Place,
  PlacesResponse,
  SourceDiagnosticsResponse,
  SourceStatusResponse,
  WeatherContext,
  WeatherResponse,
} from "../domain";

export async function fetchNearbyPlaces(input: DecisionInput): Promise<PlacesResponse> {
  const params = new URLSearchParams({
    intent: input.intent,
    location: input.location,
    prompt: input.prompt,
    budget: String(input.budget),
    people: String(input.people),
  });

  const response = await fetch(`/api/places?${params.toString()}`);
  if (!response.ok) {
    throw new Error(`POI request failed: ${response.status}`);
  }

  return response.json() as Promise<PlacesResponse>;
}

export async function fetchReviewEnrichments(places: Place[], input: DecisionInput): Promise<EnrichmentResponse> {
  const response = await fetch("/api/enrich", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      places: places.slice(0, 6).map((place) => ({
        id: place.id,
        name: place.name,
        address: place.address,
        category: place.category,
      })),
      input,
    }),
  });

  if (!response.ok) {
    throw new Error(`Enrichment request failed: ${response.status}`);
  }

  return response.json() as Promise<EnrichmentResponse>;
}

export async function fetchWeather(input: DecisionInput): Promise<WeatherResponse> {
  const params = new URLSearchParams({ location: input.location });
  const response = await fetch(`/api/weather?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Weather request failed: ${response.status}`);
  }

  return response.json() as Promise<WeatherResponse>;
}

export async function fetchSourceDiagnostics(input: DecisionInput): Promise<SourceDiagnosticsResponse> {
  const params = new URLSearchParams({
    intent: input.intent,
    location: input.location,
    budget: String(input.budget),
  });
  const response = await fetch(`/api/source-diagnostics?${params.toString()}`);

  if (!response.ok) {
    throw new Error(`Source diagnostics request failed: ${response.status}`);
  }

  return response.json() as Promise<SourceDiagnosticsResponse>;
}

export async function fetchAgentDecision(places: Place[], input: DecisionInput, weather?: WeatherContext): Promise<DecisionResponse> {
  const response = await fetch("/api/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      places: places.slice(0, 6),
      input,
      weather,
    }),
  });

  if (!response.ok) {
    throw new Error(`Decision request failed: ${response.status}`);
  }

  return response.json() as Promise<DecisionResponse>;
}

export async function fetchSourceStatus(): Promise<SourceStatusResponse> {
  const response = await fetch("/api/status");
  if (!response.ok) {
    throw new Error(`Status request failed: ${response.status}`);
  }

  return response.json() as Promise<SourceStatusResponse>;
}
