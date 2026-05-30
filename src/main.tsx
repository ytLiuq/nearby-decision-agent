import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Clock3,
  CloudSun,
  ExternalLink,
  LocateFixed,
  MapPin,
  MessageSquareText,
  Search,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { getEffectiveInput, recommendPlaces } from "./agent/recommender";
import { fetchAgentDecision, fetchNearbyPlaces, fetchReviewEnrichments, fetchSourceDiagnostics, fetchSourceStatus, fetchWeather } from "./data/placesClient";
import { mockPlaces } from "./data/mockPlaces";
import type {
  AgentDecision,
  DecisionInput,
  Mood,
  Place,
  PlaceSource,
  ReviewPlatform,
  SourceDiagnostic,
  SourceStatusResponse,
  WeatherContext,
} from "./domain";
import "./styles.css";

const platformLabels: Record<ReviewPlatform, string> = {
  xiaohongshu: "小红书",
  meituan: "美团",
  dianping: "大众点评",
  other: "网页",
};

function parseLocation(value: string) {
  const [lngRaw, latRaw] = value.split(",");
  const lng = Number(lngRaw);
  const lat = Number(latRaw);
  return Number.isFinite(lng) && Number.isFinite(lat) ? { lng, lat } : undefined;
}

function getPlaceMapUrl(place: Place | undefined, fallbackLocation: string) {
  const fallback = parseLocation(fallbackLocation);
  const lng = place?.longitude ?? fallback?.lng ?? 116.397428;
  const lat = place?.latitude ?? fallback?.lat ?? 39.90923;
  const name = encodeURIComponent(place?.name ?? "当前位置附近");
  return `https://uri.amap.com/marker?position=${lng},${lat}&name=${name}&src=nearby-decision-agent&coordinate=gaode&callnative=0`;
}

const amapLoginUrl = "https://www.amap.com/";

function App() {
  const [prompt, setPrompt] = useState("我们 3 个人，想在附近吃点不太贵、能聊天的");
  const [people] = useState(3);
  const [budget] = useState(100);
  const [selectedMoods] = useState<Mood[]>([]);
  const [location, setLocation] = useState("北京市东城区");
  const [browserLocation, setBrowserLocation] = useState<string | undefined>();
  const [places, setPlaces] = useState<Place[]>(mockPlaces);
  const [source, setSource] = useState<PlaceSource>("mock");
  const [isLoading, setIsLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherContext | undefined>();
  const [agentDecision, setAgentDecision] = useState<AgentDecision | undefined>();
  const [sourceStatus, setSourceStatus] = useState<SourceStatusResponse | undefined>();
  const [sourceDiagnostics, setSourceDiagnostics] = useState<SourceDiagnostic[]>([]);
  const [status, setStatus] = useState("输入你的需求，我会结合附近地点和口碑给出推荐。");
  const [locationMessage, setLocationMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [expandedMapPlace, setExpandedMapPlace] = useState<Place | undefined>();

  const rawInput: DecisionInput = useMemo(
    () => ({ prompt, people, budget, intent: "dinner", moods: selectedMoods, location: browserLocation ?? location }),
    [browserLocation, budget, location, people, prompt, selectedMoods],
  );
  const effectiveInput = useMemo(() => getEffectiveInput(rawInput), [rawInput]);
  const recommendations = useMemo(() => recommendPlaces(places, effectiveInput, weather), [effectiveInput, places, weather]);
  const best = recommendations[0];
  const mapPlace = expandedMapPlace ?? best;
  const mapPreviewPlaces = recommendations.slice(0, 3);
  const amapDiagnostic = sourceDiagnostics.find((item) => item.source === "amap");
  const isFallbackMode = !isLoading && source === "mock";
  const modeLabel = isLoading
    ? "加载中"
    : source === "mock"
      ? sourceStatus?.amap === false || amapDiagnostic?.status === "not-configured"
        ? "演示数据：缺少高德 Key"
        : amapDiagnostic?.status === "error"
          ? "演示数据：高德请求失败"
          : amapDiagnostic?.status === "empty"
            ? "演示数据：附近暂无结果"
            : "演示数据"
      : source === "amap"
        ? "高德实时 POI"
        : "实时 POI";

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlaces() {
      setIsLoading(true);
      setStatus("正在为你筛选附近可去的地方...");
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
      } finally {
        if (!controller.signal.aborted) setIsLoading(false);
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

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("当前浏览器不支持定位，可以直接输入城市和区。");
      return;
    }

    setIsLocating(true);
    setLocationMessage("正在获取当前位置...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = `${position.coords.longitude.toFixed(6)},${position.coords.latitude.toFixed(6)}`;
        setBrowserLocation(nextLocation);
        setLocation("浏览器当前位置");
        setLocationMessage("已使用浏览器当前位置，不会在页面展示经纬度。");
        setIsLocating(false);
      },
      () => {
        setLocationMessage("定位失败，请检查浏览器定位权限。");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <main className="app-shell">
      <section className="decision-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Nearby Decision Agent</p>
            <h1>附近去哪儿</h1>
          </div>
          <span className={`status-pill ${isFallbackMode ? "fallback" : ""}`}>{modeLabel}</span>
        </div>

        <section className="amap-login-card">
          <div>
            <span>第一步</span>
            <strong>先登录高德地图</strong>
            <p>提前登录后，展开地图和打开路线时会更顺，不会到最后一步才弹登录页。</p>
          </div>
          <a href={amapLoginUrl} target="_blank" rel="noreferrer">
            打开高德
            <ExternalLink size={14} />
          </a>
        </section>

        <label className="prompt-box">
          <span>
            <MessageSquareText size={18} />
            你想找什么？
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：我们 3 个人在东城区，想找一家人均 100 左右、适合聊天的餐厅"
          />
        </label>

        <div className="prompt-box">
          <span>
            <MapPin size={16} />
            你在哪儿？
          </span>
          <div className="location-row">
            <input
              value={location}
              onChange={(event) => {
                setBrowserLocation(undefined);
                setLocation(event.target.value);
              }}
              placeholder="例如：北京市东城区"
            />
            <button type="button" className="icon-action" onClick={useBrowserLocation} title="使用浏览器定位" disabled={isLocating}>
              <LocateFixed size={18} />
            </button>
          </div>
          {locationMessage ? <small className="field-hint">{locationMessage}</small> : null}
        </div>

        <div className="agent-state">
          <Search size={18} />
          <span>{status}</span>
        </div>
      </section>

      <section className="results-panel">
        <div
          role="button"
          tabIndex={0}
          className={`map-surface ${mapPlace ? "is-clickable" : ""} ${expandedMapPlace ? "expanded" : ""}`}
          onClick={() => mapPlace && setExpandedMapPlace(mapPlace)}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && mapPlace) setExpandedMapPlace(mapPlace);
          }}
        >
          <div className="map-glow map-glow-a" />
          <div className="map-glow map-glow-b" />
          <div className="map-topbar">
            <span>Nearby map</span>
            <strong>{mapPlace?.name ?? "当前位置"}</strong>
          </div>
          <div className="map-zone zone-a">商圈</div>
          <div className="map-zone zone-b">步行圈</div>
          <div className="map-zone zone-c">推荐密度</div>
          <div className="map-road road-a" />
          <div className="map-road road-b" />
          <div className="map-road road-c" />
          <div className="user-dot">你</div>
          {recommendations.map((place, index) => (
            <span
              className={`place-pin pin-${index + 1} ${expandedMapPlace?.id === place.id ? "selected" : ""}`}
              key={place.id}
              onClick={(event) => {
                event.stopPropagation();
                setExpandedMapPlace(place);
              }}
            >
              {index + 1}
            </span>
          ))}
          <div className="map-place-strip">
            {mapPreviewPlaces.map((place, index) => (
              <span key={place.id}>
                <strong>{index + 1}</strong>
                {place.name}
              </span>
            ))}
          </div>
          <span className="map-caption">{expandedMapPlace ? `${expandedMapPlace.name} 附近地图` : "点击展开附近地图"}</span>
          {expandedMapPlace ? (
            <span className="map-expanded" onClick={(event) => event.stopPropagation()}>
              <button type="button" className="map-close" onClick={() => setExpandedMapPlace(undefined)} title="收起地图">
                <X size={16} />
              </button>
              <iframe title={`${expandedMapPlace.name} 附近地图`} src={getPlaceMapUrl(expandedMapPlace, location)} loading="lazy" />
              <a href={getPlaceMapUrl(expandedMapPlace, location)} target="_blank" rel="noreferrer">
                在高德地图打开
              </a>
            </span>
          ) : null}
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
                首选
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
              <RecommendationDetails place={best} decision={agentDecision} />
              <ReviewLinks place={best} />
            </div>

            <div className="recommendation-list">
              {recommendations.slice(1).map((place, index) => (
                <article className="place-card" key={place.id}>
                  <div className="rank">{index + 2}</div>
                  <div>
                    <h3>{place.name}</h3>
                    <RecommendationDetails place={place} compact />
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

function RecommendationDetails({ place, decision, compact = false }: { place: Place; decision?: AgentDecision; compact?: boolean }) {
  const scoredReasons = "reasons" in place && Array.isArray(place.reasons) ? place.reasons : [];
  const decisionReasons = decision?.bestPlaceId === place.id ? decision.rationale : [];
  const visibleReasons = [...decisionReasons, ...scoredReasons, ...place.notes].map(toUserReason).filter(Boolean);

  return (
    <div className={compact ? "recommendation-detail compact-recommendation-detail" : "recommendation-detail"}>
      <p>
        <strong>地址</strong>
        {place.address}
      </p>
      <p>
        <strong>推荐理由</strong>
        {visibleReasons.slice(0, compact ? 2 : 4).join("；")}
      </p>
      {!compact && place.enrichment?.summary ? (
        <p>
          <strong>口碑参考</strong>
          {place.enrichment.summary}
        </p>
      ) : null}
    </div>
  );
}

function toUserReason(reason: string) {
  if (/数据完整度|排序分|来源|POI|高德提供基础/.test(reason)) return "";
  if (reason.includes("类型匹配")) return "和你描述的需求匹配";
  if (reason.includes("预算匹配")) return "预算上比较合适";
  if (reason.includes("人数适配")) return "适合当前人数";
  if (reason.includes("偏好标签")) return "氛围和你想要的感觉接近";
  return reason;
}

function ReviewLinks({ place, compact = false }: { place: Place; compact?: boolean }) {
  const links = [...(place.enrichment?.links ?? []), ...buildReviewSearchLinks(place)].slice(0, compact ? 3 : 6);

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

function buildReviewSearchLinks(place: Place) {
  const keyword = encodeURIComponent(`${place.name} ${place.address}`);
  return [
    { title: `在小红书搜索 ${place.name}`, url: `https://www.xiaohongshu.com/search_result?keyword=${keyword}`, platform: "xiaohongshu" as const },
    { title: `在大众点评搜索 ${place.name}`, url: `https://www.dianping.com/search/keyword/2/0_${keyword}`, platform: "dianping" as const },
    { title: `在美团搜索 ${place.name}`, url: `https://www.meituan.com/s/${keyword}/`, platform: "meituan" as const },
  ];
}

createRoot(document.getElementById("root")!).render(<App />);
