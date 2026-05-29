export type Intent = "dinner" | "coffee" | "bar" | "late-night" | "dessert" | "walk";

export type Mood = "quiet" | "lively" | "chat" | "date" | "value" | "photo" | "quick";

export type PlaceSource = "mock" | "amap" | "merged";

export type ReviewSource = "mock" | "tavily" | "mixed";

export type ReviewPlatform = "xiaohongshu" | "meituan" | "dianping" | "other";

export type ReviewLink = {
  title: string;
  url: string;
  platform: ReviewPlatform;
};

export type ReviewEnrichment = {
  placeId: string;
  source: ReviewSource;
  summary: string;
  highlights: string[];
  cautions: string[];
  tags: Mood[];
  links: ReviewLink[];
};

export type Place = {
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
  enrichment?: ReviewEnrichment;
};

export type DecisionInput = {
  prompt: string;
  people: number;
  budget: number;
  intent: Intent;
  moods: Mood[];
  location: string;
};

export type ParsedPrompt = Partial<Pick<DecisionInput, "people" | "budget" | "intent">> & {
  moods?: Mood[];
};

export type WeatherContext = {
  temperature: number;
  precipitation: number;
  windSpeed: number;
  weatherCode: number;
  condition: string;
};

export type Recommendation = Place & {
  score: number;
  reasons: string[];
  rankingScore: number;
  rankingSignals: string[];
};

export type PlacesResponse = {
  source: PlaceSource;
  providers: PlaceSource[];
  places: Place[];
  message?: string;
};

export type EnrichmentResponse = {
  source: ReviewSource;
  enrichments: ReviewEnrichment[];
  message?: string;
};

export type WeatherResponse = {
  source: "open-meteo" | "mock";
  weather?: WeatherContext;
  message?: string;
};

export type AgentDecision = {
  source: "openai" | "rules";
  bestPlaceId?: string;
  headline: string;
  rationale: string[];
  tradeoffs: string[];
  followUpQuestion?: string;
};

export type DecisionResponse = {
  decision: AgentDecision;
  message?: string;
};

export type SourceStatusResponse = {
  amap: boolean;
  tavily: boolean;
  bing: boolean;
  exa: boolean;
  openai: boolean;
  openMeteo: boolean;
};

export type SourceDiagnostic = {
  source: "amap";
  status: "ok" | "empty" | "error" | "not-configured";
  durationMs: number;
  rawCount: number;
  usableCount: number;
  sampleNames: string[];
  message: string;
};

export type SourceDiagnosticsResponse = {
  intent: Intent;
  location: string;
  diagnostics: SourceDiagnostic[];
  message?: string;
};
