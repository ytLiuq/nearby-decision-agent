import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Beer,
  Clock3,
  CloudSun,
  Coffee,
  ExternalLink,
  MapPin,
  MessageSquareText,
  Moon,
  Search,
  Sparkles,
  Star,
  Users,
  Utensils,
  Wallet,
} from "lucide-react";
import { getEffectiveInput, intentOptions, moodOptions, recommendPlaces } from "./agent/recommender";
import { fetchAgentDecision, fetchNearbyPlaces, fetchReviewEnrichments, fetchSourceDiagnostics, fetchSourceStatus, fetchWeather } from "./data/placesClient";
import { mockPlaces } from "./data/mockPlaces";
import type {
  AgentDecision,
  DecisionInput,
  Intent,
  Mood,
  Place,
  PlaceSource,
  ReviewPlatform,
  SourceDiagnostic,
  SourceStatusResponse,
  WeatherContext,
} from "./domain";
import "./styles.css";

const intentIcons: Record<Intent, React.ElementType> = {
  dinner: Utensils,
  coffee: Coffee,
  bar: Beer,
  "late-night": Moon,
  dessert: Sparkles,
  walk: MapPin,
};

const platformLabels: Record<ReviewPlatform, string> = {
  xiaohongshu: "小红书",
  meituan: "美团",
  dianping: "大众点评",
  other: "网页",
};

function App() {
  const [prompt, setPrompt] = useState("我们 3 个人，想在附近吃点不太贵、能聊天的");
  const [people, setPeople] = useState(3);
  const [budget, setBudget] = useState(100);
  const [intent, setIntent] = useState<Intent>("dinner");
  const [selectedMoods, setSelectedMoods] = useState<Mood[]>(["chat", "value"]);
  const [location, setLocation] = useState("116.397428,39.90923");
  const [places, setPlaces] = useState<Place[]>(mockPlaces);
  const [source, setSource] = useState<PlaceSource>("mock");
  const [weather, setWeather] = useState<WeatherContext | undefined>();
  const [agentDecision, setAgentDecision] = useState<AgentDecision | undefined>();
  const [sourceStatus, setSourceStatus] = useState<SourceStatusResponse | undefined>();
  const [sourceDiagnostics, setSourceDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [status, setStatus] = useState("使用本地 mock 数据，可配置高德 Key 切到真实周边 POI");

  const rawInput: DecisionInput = useMemo(
    () => ({ prompt, people, budget, intent, moods: selectedMoods, location }),
    [budget, intent, location, people, prompt, selectedMoods],
  );
  const effectiveInput = useMemo(() => getEffectiveInput(rawInput), [rawInput]);
  const recommendations = useMemo(() => recommendPlaces(places, effectiveInput, weather), [effectiveInput, places, weather]);
  const best = recommendations[0];

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlaces() {
      setStatus("正在查询周边 POI、天气和口碑来源...");
      try {
        const [placesData, weatherData, diagnosticsData] = await Promise.all([
          fetchNearbyPlaces(effectiveInput),
          fetchWeather(effectiveInput),
          fetchSourceDiagnostics(effectiveInput).catch(() => undefined),
        ]);
        if (controller.signal.aborted) return;

        const basePlaces = placesData.places.length ? placesData.places : mockPlaces;
        setPlaces(basePlaces);
        setSource(placesData.source);
        setWeather(weatherData.weather);
        setSourceDiagnostics(diagnosticsData?.diagnostics ?? []);
        setStatus(`${placesData.message ?? "地点数据已更新"}；${weatherData.message ?? "天气上下文已更新"}`);

        const enrichmentData = await fetchReviewEnrichments(basePlaces, effectiveInput);
        if (controller.signal.aborted) return;
        const enrichmentById = new Map(enrichmentData.enrichments.map((item) => [item.placeId, item]));
        const enrichedPlaces = basePlaces.map((place) => ({ ...place, enrichment: enrichmentById.get(place.id) }));
        setPlaces(enrichedPlaces);
        setStatus(`${placesData.message ?? "地点数据已更新"}；${weatherData.message ?? "天气上下文已更新"}；${enrichmentData.message ?? "口碑补充已完成"}`);

        const decisionData = await fetchAgentDecision(enrichedPlaces, effectiveInput, weatherData.weather);
        if (controller.signal.aborted) return;
        setAgentDecision(decisionData.decision);
        setStatus(
          `${placesData.message ?? "地点数据已更新"}；${weatherData.message ?? "天气上下文已更新"}；${enrichmentData.message ?? "口碑补充已完成"}；${decisionData.message ?? "Agent 决策已完成"}`,
        );
      } catch {
        if (controller.signal.aborted) return;
        setAgentDecision(undefined);
        setSourceDiagnostics([]);
        setPlaces(mockPlaces);
        setSource("mock");
        setStatus("外部来源暂不可用，已自动回退到 mock 数据");
      }
    }

    loadPlaces();
    return () => controller.abort();
  }, [effectiveInput]);

  useEffect(() => {
    fetchSourceStatus()
      .then(setSourceStatus)
      .catch(() => undefined);
  }, []);

  function toggleMood(mood: Mood) {
    setSelectedMoods((current) =>
      current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood],
    );
  }

  return (
    <main className="app-shell">
      <section className="decision-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Nearby Decision Agent</p>
            <h1>附近吃点啥</h1>
          </div>
          <span className="status-pill">{source === "mock" ? "Mock 模式" : "实时 POI"}</span>
        </div>

        <label className="prompt-box">
          <span>
            <MessageSquareText size={18} />
            直接告诉 Agent
          </span>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
        </label>

        <div className="control-grid">
          <label>
            <span>
              <Users size={16} />
              人数
            </span>
            <input type="number" min={1} max={12} value={people} onChange={(event) => setPeople(Number(event.target.value))} />
          </label>
          <label>
            <span>
              <Wallet size={16} />
              人均预算
            </span>
            <input type="number" min={0} step={10} value={budget} onChange={(event) => setBudget(Number(event.target.value))} />
          </label>
        </div>

        <label className="prompt-box">
          <span>
            <MapPin size={16} />
            当前位置，经度,纬度
          </span>
          <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="116.397428,39.90923" />
        </label>

        <div className="tag-section">
          <p>想做什么</p>
          <div className="intent-grid">
            {intentOptions.map((item) => {
              const Icon = intentIcons[item.id];
              return (
                <button className={effectiveInput.intent === item.id ? "active" : ""} key={item.id} onClick={() => setIntent(item.id)}>
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="tag-section">
          <p>偏好标签</p>
          <div className="mood-grid">
            {moodOptions.map((mood) => (
              <button className={effectiveInput.moods.includes(mood.id) ? "active" : ""} key={mood.id} onClick={() => toggleMood(mood.id)}>
                {mood.label}
              </button>
            ))}
          </div>
        </div>

        <div className="agent-state">
          <Search size={18} />
          <span>
            已解析：{effectiveInput.people} 人，人均 {effectiveInput.budget}，
            {intentOptions.find((item) => item.id === effectiveInput.intent)?.label}。{status}
          </span>
        </div>

        {sourceStatus ? <SourceStatusBar status={sourceStatus} /> : null}
        {sourceDiagnostics.length ? <SourceDiagnosticsPanel diagnostics={sourceDiagnostics} /> : null}
      </section>

      <section className="results-panel">
        <div className="map-surface">
          <div className="map-road road-a" />
          <div className="map-road road-b" />
          <div className="user-dot">你</div>
          {recommendations.map((place, index) => (
            <div className={`place-pin pin-${index + 1}`} key={place.id}>
              {index + 1}
            </div>
          ))}
        </div>

        {best ? (
          <>
            <div className="answer-header">
              <div>
                <p className="eyebrow">首选推荐</p>
                <h2>{best.name}</h2>
              </div>
              <div className="score-badge">
                <Star size={16} />
                {Math.round(best.score)}
              </div>
            </div>

            <div className="best-card">
              <div className="meta-row">
                <span>
                  <MapPin size={15} />
                  {best.distanceMinutes} 分钟
                </span>
                <span>
                  <Wallet size={15} />
                  {best.avgPrice ? `人均 ${best.avgPrice}` : "价格待补充"}
                </span>
                <span>
                  <Clock3 size={15} />
                  到 {best.openUntil}
                </span>
                {weather ? (
                  <span>
                    <CloudSun size={15} />
                    {weather.condition} {weather.temperature}°C
                  </span>
                ) : null}
              </div>
              <StoreInfo place={best} />
              <QualityDiagnostics place={best} />
              {agentDecision ? <AgentDecisionPanel decision={agentDecision} /> : null}
              <p>{best.notes.join("；")}。</p>
              {best.enrichment ? <p>{best.enrichment.summary}</p> : null}
              <ReviewLinks place={best} />
              <strong>可能不适合：{best.caution}</strong>
              {best.enrichment?.cautions.length ? <strong>口碑风险：{best.enrichment.cautions.join("；")}</strong> : null}
            </div>

            <div className="recommendation-list">
              {recommendations.slice(1).map((place, index) => (
                <article className="place-card" key={place.id}>
                  <div className="rank">{index + 2}</div>
                  <div>
                    <h3>{place.name}</h3>
                    <p>{place.notes[0]}</p>
                    <StoreInfo place={place} compact />
                    <QualityDiagnostics place={place} compact />
                    {place.enrichment ? <p>{place.enrichment.summary}</p> : null}
                    <ReviewLinks place={place} compact />
                    <div className="compact-meta">
                      <span>{place.distanceMinutes} 分钟</span>
                      <span>{place.avgPrice ? `人均 ${place.avgPrice}` : "价格待补充"}</span>
                      <span>{place.rating}</span>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </>
        ) : (
          <div className="best-card">还没有找到可推荐的地点。</div>
        )}
      </section>
    </main>
  );
}

function SourceStatusBar({ status }: { status: SourceStatusResponse }) {
  const items = [
    ["高德", status.amap],
    ["天气", status.openMeteo],
    ["Tavily", status.tavily],
    ["Bing", status.bing],
    ["Exa", status.exa],
    ["OpenAI", status.openai],
  ] as const;

  return (
    <div className="source-status">
      {items.map(([label, active]) => (
        <span className={active ? "online" : ""} key={label}>
          {label}
        </span>
      ))}
    </div>
  );
}

function SourceDiagnosticsPanel({ diagnostics }: { diagnostics: SourceDiagnostic[] }) {
  const sourceLabels: Record<SourceDiagnostic["source"], string> = {
    amap: "高德",
  };
  const statusLabels: Record<SourceDiagnostic["status"], string> = {
    ok: "可用",
    empty: "空结果",
    error: "失败",
    "not-configured": "未配置",
  };

  return (
    <div className="source-diagnostics">
      <div className="quality-header">
        <span>来源诊断</span>
        <strong>{diagnostics.filter((item) => item.status === "ok").length}/{diagnostics.length}</strong>
      </div>
      {diagnostics.map((item) => (
        <div className={`source-diagnostic-row ${item.status}`} key={item.source}>
          <div>
            <strong>{sourceLabels[item.source]}</strong>
            <span>{statusLabels[item.status]} · {item.durationMs}ms</span>
          </div>
          <small>
            原始 {item.rawCount} / 可用 {item.usableCount}
            {item.sampleNames.length ? ` · ${item.sampleNames.slice(0, 2).join("、")}` : ` · ${item.message}`}
          </small>
        </div>
      ))}
    </div>
  );
}

function AgentDecisionPanel({ decision }: { decision: AgentDecision }) {
  return (
    <div className="agent-decision">
      <div>
        <span>{decision.source === "openai" ? "OpenAI Agent" : "规则兜底"}</span>
        <h3>{decision.headline}</h3>
      </div>
      <ul>
        {decision.rationale.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      {decision.tradeoffs.length ? <p>{decision.tradeoffs.join("；")}</p> : null}
      {decision.followUpQuestion ? <small>{decision.followUpQuestion}</small> : null}
    </div>
  );
}

function StoreInfo({ place, compact = false }: { place: Place; compact?: boolean }) {
  const categories = place.categories ?? [];
  const dishes = place.recommendedDishes ?? [];
  const warnings = place.dataWarnings ?? [];

  if (!categories.length && !dishes.length && !place.phone && !warnings.length) return null;

  return (
    <div className={compact ? "store-info compact-store-info" : "store-info"}>
      {categories.length ? <span>类型：{categories.slice(0, compact ? 2 : 4).join(" / ")}</span> : null}
      {dishes.length ? <span>推荐：{dishes.slice(0, compact ? 2 : 4).join(" / ")}</span> : null}
      {warnings.length ? <span>待核验：{warnings.slice(0, compact ? 1 : 3).join(" / ")}</span> : null}
      {!compact && place.phone ? <span>电话：{place.phone}</span> : null}
    </div>
  );
}

function QualityDiagnostics({ place, compact = false }: { place: Place; compact?: boolean }) {
  const reasons = place.qualityReasons ?? [];
  const penalties = place.qualityPenalties ?? [];
  const rankingScore = "rankingScore" in place && typeof place.rankingScore === "number" ? place.rankingScore : undefined;
  const rankingSignals = "rankingSignals" in place && Array.isArray(place.rankingSignals) ? place.rankingSignals : [];

  if (!place.qualityScore && !rankingScore && !reasons.length && !penalties.length && !rankingSignals.length) return null;

  return (
    <div className={compact ? "quality-panel compact-quality-panel" : "quality-panel"}>
      <div className="quality-header">
        <span>数据质量</span>
        {place.qualityScore ? <strong>{place.qualityScore}</strong> : null}
      </div>
      {rankingScore ? (
        <div className="quality-ranking">
          <span>排序分 {rankingScore}</span>
          {rankingSignals.slice(0, compact ? 1 : 3).map((signal) => (
            <small key={signal}>{signal}</small>
          ))}
        </div>
      ) : null}
      {reasons.length ? (
        <div className="quality-chips positive">
          {reasons.slice(0, compact ? 2 : 4).map((reason) => (
            <span key={reason}>{reason}</span>
          ))}
        </div>
      ) : null}
      {penalties.length ? (
        <div className="quality-chips negative">
          {penalties.slice(0, compact ? 1 : 3).map((penalty) => (
            <span key={penalty}>{penalty}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReviewLinks({ place, compact = false }: { place: Place; compact?: boolean }) {
  const links = place.enrichment?.links ?? [];
  if (!links.length) return null;

  return (
    <div className={compact ? "source-links compact-source-links" : "source-links"}>
      {links.map((link) => (
        <a href={link.url} key={`${place.id}-${link.url}`} rel="noreferrer" target="_blank">
          <span>{platformLabels[link.platform]}</span>
          {!compact ? <small>{link.title}</small> : null}
          <ExternalLink size={14} />
        </a>
      ))}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
