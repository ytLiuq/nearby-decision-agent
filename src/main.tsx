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

function getMapCoordinates(place: Place | undefined, fallbackLocation: string) {
  const fallback = parseLocation(fallbackLocation);
  if (place?.longitude && place.latitude) return { lng: place.longitude, lat: place.latitude };
  return fallback;
}

function getOsmMapUrl(coords: { lng: number; lat: number } | undefined) {
  if (!coords) return undefined;
  const delta = 0.012;
  const bbox = [coords.lng - delta, coords.lat - delta, coords.lng + delta, coords.lat + delta].join(",");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${coords.lat},${coords.lng}`;
}

function App() {
  const [prompt, setPrompt] = useState("我们 3 个人，想在附近吃点不太贵、能聊天的");
  const [people] = useState(3);
  const [budget] = useState(100);
  const [selectedMoods] = useState<Mood[]>([]);
  const [location, setLocation] = useState("");
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
  const [showLocationDialog, setShowLocationDialog] = useState(true);

  const rawInput: DecisionInput = useMemo(
    () => ({ prompt, people, budget, intent: "dinner", moods: selectedMoods, location }),
    [budget, location, people, prompt, selectedMoods],
  );
  const effectiveInput = useMemo(() => getEffectiveInput(rawInput), [rawInput]);
  const hasUsableLocation = Boolean(parseLocation(effectiveInput.location));
  const recommendations = useMemo(() => recommendPlaces(places, effectiveInput, weather), [effectiveInput, places, weather]);
  const visibleRecommendations = hasUsableLocation ? recommendations : [];
  const best = visibleRecommendations[0];
  const mapPlace = expandedMapPlace ?? best;
  const mapPreviewPlaces = visibleRecommendations.slice(0, 3);
  const mapCoordinates = getMapCoordinates(mapPlace, effectiveInput.location);
  const mapEmbedUrl = getOsmMapUrl(mapCoordinates);
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
      if (!parseLocation(effectiveInput.location)) {
        setPlaces(mockPlaces);
        setSource("mock");
        setWeather(undefined);
        setAgentDecision(undefined);
        setSourceDiagnostics([]);
        setStatus("请先允许定位，或输入经纬度。拿到位置后，推荐和地图才会按你附近刷新。");
        return;
      }

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
        setStatus(placesData.source === "mock" ? "地点接口暂未返回真实结果，正在使用演示数据。" : "已按当前位置更新附近地点。");

        const enrichmentData = await fetchReviewEnrichments(basePlaces, effectiveInput);
        if (controller.signal.aborted) return;
        const enrichmentById = new Map(enrichmentData.enrichments.map((item) => [item.placeId, item]));
        const enrichedPlaces = basePlaces.map((place) => ({ ...place, enrichment: enrichmentById.get(place.id) }));
        setPlaces(enrichedPlaces);
        setStatus("已按当前位置更新地点，并补充口碑来源。");

        const decisionData = await fetchAgentDecision(enrichedPlaces, effectiveInput, weatherData.weather);
        if (controller.signal.aborted) return;
        setAgentDecision(decisionData.decision);
        setStatus(decisionData.decision.source === "openai" ? "已结合当前位置、天气和口碑生成推荐。" : "已结合当前位置生成推荐，模型暂不可用时使用规则兜底。");
      } catch {
        if (controller.signal.aborted) return;
        setAgentDecision(undefined);
        setSourceDiagnostics([]);
        setPlaces(mockPlaces);
        setSource("mock");
        setStatus("外部服务暂不可用，已切换到演示数据。请稍后重试或检查 API 配置。");
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
      setLocationMessage("当前浏览器不支持定位，请手动输入经纬度。");
      return;
    }

    setIsLocating(true);
    setLocationMessage("正在请求浏览器定位权限...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const nextLocation = `${position.coords.longitude.toFixed(6)},${position.coords.latitude.toFixed(6)}`;
        setLocation(nextLocation);
        setLocationMessage("已定位到当前位置，将用这组经纬度查询附近地点。");
        setShowLocationDialog(false);
        setIsLocating(false);
      },
      () => {
        setLocationMessage("定位失败。请允许浏览器定位，或手动输入经纬度。");
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }

  return (
    <main className="app-shell">
      {showLocationDialog ? (
        <div className="location-modal" role="dialog" aria-modal="true" aria-labelledby="location-modal-title">
          <div className="location-modal-card">
            <p className="eyebrow">Location</p>
            <h2 id="location-modal-title">先确定你的位置</h2>
            <p>这个应用需要经纬度来拉取你附近的 POI 和地图。点击“使用当前位置”后，浏览器会弹出定位授权。</p>
            <div className="location-modal-actions">
              <button type="button" className="primary-action" onClick={useBrowserLocation} disabled={isLocating}>
                {isLocating ? "定位中..." : "使用当前位置"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setLocation("116.397428,39.90923");
                  setLocationMessage("已使用北京示例坐标。你也可以手动改成自己的经纬度。");
                  setShowLocationDialog(false);
                }}
              >
                先用示例位置
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <section className="decision-panel">
        <div className="brand-row">
          <div>
            <p className="eyebrow">Nearby Decision Agent</p>
            <h1>附近去哪儿</h1>
          </div>
          <span className={`status-pill ${isFallbackMode ? "fallback" : ""}`}>{modeLabel}</span>
        </div>

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
            你在哪儿？输入经纬度或点击定位
          </span>
          <div className="location-row">
            <input
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
              }}
              placeholder="例如：116.397428,39.90923"
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
            <span>{mapCoordinates ? "你附近的地图" : "等待定位"}</span>
            <strong>{mapPlace?.name ?? "先定位后显示附近地图"}</strong>
          </div>
          <div className="map-zone zone-a">商圈</div>
          <div className="map-zone zone-b">步行圈</div>
          <div className="map-zone zone-c">推荐密度</div>
          <div className="map-road road-a" />
          <div className="map-road road-b" />
          <div className="map-road road-c" />
          {!mapEmbedUrl ? <div className="map-empty">允许定位后，这里会显示你附近的地图</div> : null}
          <div className="user-dot">你</div>
          {visibleRecommendations.map((place, index) => (
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
              {mapEmbedUrl ? <iframe title={`${expandedMapPlace.name} 附近地图`} src={mapEmbedUrl} loading="lazy" /> : null}
              <div className="map-expanded-footer">
                <strong>{expandedMapPlace.name}</strong>
                <a href={getPlaceMapUrl(expandedMapPlace, location)} target="_blank" rel="noreferrer">
                  用高德打开
                  <ExternalLink size={14} />
                </a>
              </div>
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
              <PlaceMeta place={best} weather={weather} />
              <RecommendationDetails place={best} decision={agentDecision} />
              <ReviewLinks place={best} />
            </div>

            <div className="recommendation-list">
              {visibleRecommendations.slice(1).map((place, index) => (
                <article className="place-card" key={place.id}>
                  <div className="rank">{index + 2}</div>
                  <div>
                    <h3>{place.name}</h3>
                    <PlaceMeta place={place} weather={weather} />
                    <RecommendationDetails place={place} />
                    <ReviewLinks place={place} />
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

function PlaceMeta({ place, weather }: { place: Place; weather?: WeatherContext }) {
  return (
    <div className="meta-row">
      <span>
        <MapPin size={15} />
        {place.distanceMinutes} 分钟
      </span>
      <span>
        <Wallet size={15} />
        {place.avgPrice ? `人均 ${place.avgPrice}` : "价格待补充"}
      </span>
      <span>
        <Clock3 size={15} />
        到 {place.openUntil}
      </span>
      {weather ? (
        <span>
          <CloudSun size={15} />
          {weather.condition} {weather.temperature}°C
        </span>
      ) : null}
    </div>
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
        {visibleReasons.slice(0, 4).join("；") || "和你描述的需求匹配。"}
      </p>
      {place.enrichment?.summary ? (
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
    <div className="review-block">
      <strong>口碑参考</strong>
      <div className={compact ? "source-links compact-source-links" : "source-links"}>
        {links.map((link) => (
          <a href={link.url} key={`${place.id}-${link.url}`} rel="noreferrer" target="_blank">
            <span>{platformLabels[link.platform]}</span>
            <small>{link.title}</small>
            <ExternalLink size={14} />
          </a>
        ))}
      </div>
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
