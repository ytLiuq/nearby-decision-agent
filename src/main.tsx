import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Clock3,
  CloudSun,
  ExternalLink,
  LocateFixed,
  MapPin,
  MessageSquareText,
  Star,
  Wallet,
  X,
} from "lucide-react";
import { getEffectiveInput, intentOptions, moodOptions, recommendPlaces } from "./agent/recommender";
import { fetchAgentDecision, fetchNearbyPlaces, fetchReviewEnrichments, fetchWeather } from "./data/placesClient";
import { mockPlaces } from "./data/mockPlaces";
import type {
  AgentDecision,
  DecisionInput,
  Intent,
  Mood,
  Place,
  PlaceSource,
  ReviewPlatform,
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

declare global {
  interface Window {
    AMap?: any;
    _AMapSecurityConfig?: { securityJsCode?: string };
  }
}

type Coordinates = { lng: number; lat: number };
type AMapLoadState = "idle" | "loading" | "ready" | "error";
type ClientImportMeta = ImportMeta & { env: Record<string, string | undefined> };

let amapLoader: Promise<any> | undefined;

function getClientEnv(name: string) {
  return (import.meta as ClientImportMeta).env[name];
}

function getAmapJsKey() {
  return getClientEnv("VITE_AMAP_JS_KEY") ?? getClientEnv("VITE_AMAP_KEY") ?? "";
}

function getAmapSecurityCode() {
  return getClientEnv("VITE_AMAP_SECURITY_JS_CODE") ?? getClientEnv("VITE_AMAP_JS_SECURITY_CODE") ?? "";
}

function getAmapPlugins() {
  return ["AMap.Scale", "AMap.ToolBar", "AMap.Convertor"].join(",");
}

function loadAmapSdk() {
  if (window.AMap) return Promise.resolve(window.AMap);
  if (amapLoader) return amapLoader;

  const key = getAmapJsKey();
  if (!key) return Promise.reject(new Error("Missing VITE_AMAP_JS_KEY"));

  const securityCode = getAmapSecurityCode();
  if (securityCode) window._AMapSecurityConfig = { securityJsCode: securityCode };

  amapLoader = new Promise((resolve, reject) => {
    const existing = document.getElementById("amap-js-api") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(window.AMap), { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "amap-js-api";
    script.async = true;
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${encodeURIComponent(key)}&plugin=${getAmapPlugins()}`;
    script.onload = () => resolve(window.AMap);
    script.onerror = () => {
      amapLoader = undefined;
      reject(new Error("Failed to load AMap JS API"));
    };
    document.head.appendChild(script);
  });

  return amapLoader;
}

function hasPlaceCoordinates(place: Place | undefined): place is Place & { longitude: number; latitude: number } {
  return Number.isFinite(place?.longitude) && Number.isFinite(place?.latitude);
}

function convertGpsToAmap(AMap: any, coords: Coordinates): Promise<Coordinates> {
  if (!AMap?.convertFrom) return Promise.resolve(coords);

  return new Promise((resolve) => {
    AMap.convertFrom([coords.lng, coords.lat], "gps", (status: string, result: any) => {
      const point = result?.locations?.[0];
      if (status === "complete" && point) {
        resolve({ lng: point.lng, lat: point.lat });
        return;
      }
      resolve(coords);
    });
  });
}

function AMapPreview({
  center,
  places,
  selectedPlace,
  onSelectPlace,
}: {
  center: Coordinates | undefined;
  places: Place[];
  selectedPlace: Place | undefined;
  onSelectPlace: (place: Place) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any[]>([]);
  const [loadState, setLoadState] = useState<AMapLoadState>(center ? "loading" : "idle");

  useEffect(() => {
    let cancelled = false;

    async function mountMap() {
      if (!center || !containerRef.current) {
        setLoadState("idle");
        return;
      }

      setLoadState("loading");
      try {
        const AMap = await loadAmapSdk();
        if (cancelled || !containerRef.current) return;

        if (!mapRef.current) {
          mapRef.current = new AMap.Map(containerRef.current, {
            center: [center.lng, center.lat],
            zoom: 15,
            resizeEnable: true,
            viewMode: "2D",
            mapStyle: "amap://styles/normal",
          });
          if (AMap.Scale) mapRef.current.addControl(new AMap.Scale());
          if (AMap.ToolBar) mapRef.current.addControl(new AMap.ToolBar({ position: "RT" }));
        }

        markerRef.current.forEach((marker) => mapRef.current.remove(marker));
        markerRef.current = [];

        const nextMarkers = [
          new AMap.Marker({
            content: '<div class="amap-user-marker">你</div>',
            offset: new AMap.Pixel(-19, -19),
            position: [center.lng, center.lat],
            title: "你的位置",
          }),
        ];

        places.filter(hasPlaceCoordinates).slice(0, 6).forEach((place, index) => {
          const isSelected = selectedPlace?.id === place.id;
          const marker = new AMap.Marker({
            content: `<button class="amap-place-marker${isSelected ? " is-selected" : ""}" type="button">${index + 1}</button>`,
            offset: new AMap.Pixel(-18, -18),
            position: [place.longitude, place.latitude],
            title: place.name,
          });
          marker.on("click", () => onSelectPlace(place));
          nextMarkers.push(marker);
        });

        mapRef.current.add(nextMarkers);
        markerRef.current = nextMarkers;

        if (hasPlaceCoordinates(selectedPlace)) {
          mapRef.current.setZoomAndCenter(16, [selectedPlace.longitude, selectedPlace.latitude]);
        } else if (nextMarkers.length > 1) {
          mapRef.current.setFitView(nextMarkers, false, [64, 40, 64, 40], 16);
        } else {
          mapRef.current.setZoomAndCenter(15, [center.lng, center.lat]);
        }

        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    }

    mountMap();

    return () => {
      cancelled = true;
    };
  }, [center, onSelectPlace, places, selectedPlace]);

  return (
    <>
      <div ref={containerRef} className="amap-map-canvas" />
      {!center ? <div className="map-empty">允许定位后，这里会显示你附近的高德地图</div> : null}
      {loadState === "loading" ? (
        <div className="map-loading" role="status" aria-live="polite">
          <span className="loading-spinner" />
          <strong>正在加载高德地图</strong>
        </div>
      ) : null}
      {loadState === "error" ? (
        <div className="map-empty">高德地图加载失败，请检查 VITE_AMAP_JS_KEY 和安全密钥配置</div>
      ) : null}
    </>
  );
}

function App() {
  const [prompt, setPrompt] = useState("我们 3 个人，想在附近吃点不太贵、能聊天的");
  const [people] = useState(3);
  const [budget] = useState(100);
  const [intent, setIntent] = useState<Intent>("dinner");
  const [selectedMoods, setSelectedMoods] = useState<Mood[]>(["chat", "value"]);
  const [location, setLocation] = useState("");
  const [places, setPlaces] = useState<Place[]>(mockPlaces);
  const [source, setSource] = useState<PlaceSource>("mock");
  const [isLoading, setIsLoading] = useState(false);
  const [weather, setWeather] = useState<WeatherContext | undefined>();
  const [agentDecision, setAgentDecision] = useState<AgentDecision | undefined>();
  const [status, setStatus] = useState("输入你的需求，我会结合附近地点和口碑给出推荐。");
  const [locationMessage, setLocationMessage] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [expandedMapPlace, setExpandedMapPlace] = useState<Place | undefined>();
  const [showLocationDialog, setShowLocationDialog] = useState(true);

  const rawInput: DecisionInput = useMemo(
    () => ({ prompt, people, budget, intent, moods: selectedMoods, location }),
    [budget, intent, location, people, prompt, selectedMoods],
  );
  const effectiveInput = useMemo(() => getEffectiveInput(rawInput), [rawInput]);
  const hasUsableLocation = Boolean(parseLocation(effectiveInput.location));
  const recommendations = useMemo(() => recommendPlaces(places, effectiveInput, weather), [effectiveInput, places, weather]);
  const visibleRecommendations = hasUsableLocation ? recommendations : [];
  const best = visibleRecommendations[0];
  const mapPlace = expandedMapPlace ?? best;
  const mapPreviewPlaces = visibleRecommendations.slice(0, 3);
  const userCoordinates = parseLocation(effectiveInput.location);

  function toggleMood(mood: Mood) {
    setSelectedMoods((current) =>
      current.includes(mood) ? current.filter((item) => item !== mood) : [...current, mood],
    );
  }

  useEffect(() => {
    const controller = new AbortController();

    async function loadPlaces() {
      if (!parseLocation(effectiveInput.location)) {
        setPlaces(mockPlaces);
        setSource("mock");
        setWeather(undefined);
        setAgentDecision(undefined);
        setStatus("请先允许定位，或输入经纬度。拿到位置后，推荐和地图才会按你附近刷新。");
        return;
      }

      setIsLoading(true);
      setStatus("正在为你筛选附近可去的地方...");
      try {
        const [placesData, weatherData] = await Promise.all([
          fetchNearbyPlaces(effectiveInput),
          fetchWeather(effectiveInput),
        ]);
        if (controller.signal.aborted) return;

        const basePlaces = placesData.places.length ? placesData.places : mockPlaces;
        setPlaces(basePlaces);
        setSource(placesData.source);
        setWeather(weatherData.weather);
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

  function useBrowserLocation() {
    if (!navigator.geolocation) {
      setLocationMessage("当前浏览器不支持定位，请手动输入经纬度。");
      return;
    }

    setIsLocating(true);
    setLocationMessage("正在请求定位权限。若浏览器弹窗出现，请选择允许。");
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const gpsLocation = {
          lng: Number(position.coords.longitude.toFixed(6)),
          lat: Number(position.coords.latitude.toFixed(6)),
        };
        let amapLocation = gpsLocation;

        try {
          const AMap = await loadAmapSdk();
          amapLocation = await convertGpsToAmap(AMap, gpsLocation);
        } catch {
          amapLocation = gpsLocation;
        }

        const nextLocation = `${amapLocation.lng.toFixed(6)},${amapLocation.lat.toFixed(6)}`;
        const accuracyText = Number.isFinite(position.coords.accuracy)
          ? `浏览器定位精度约 ${Math.round(position.coords.accuracy)} 米。`
          : "";
        setLocation(nextLocation);
        setExpandedMapPlace(undefined);
        setLocationMessage(`已定位并校准为高德坐标。${accuracyText}`);
        setShowLocationDialog(false);
        setIsLocating(false);
      },
      (error) => {
        const reason =
          error.code === error.PERMISSION_DENIED
            ? "定位权限被拒绝。请在浏览器地址栏允许位置权限，或手动输入经纬度。"
            : error.code === error.TIMEOUT
              ? "定位超时。可以再试一次，或先手动输入经纬度。"
              : "定位失败。请检查浏览器位置权限，或手动输入经纬度。";
        setLocationMessage(reason);
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 },
    );
  }

  return (
    <main className="app-shell">
      {showLocationDialog ? (
        <div className="location-modal" role="dialog" aria-modal="true" aria-labelledby="location-modal-title">
          <div className="location-modal-card">
            <p className="eyebrow">Location</p>
            <h2 id="location-modal-title">先确定你的位置</h2>
            <p>这个应用需要你附近的位置来查找可去的地方和显示地图。点击“使用当前位置”后，浏览器会弹出定位授权。</p>
            <div className="location-modal-actions">
              <button type="button" className="primary-action" onClick={useBrowserLocation} disabled={isLocating}>
                {isLocating ? "定位中..." : "使用当前位置"}
              </button>
              <button
                type="button"
                className="secondary-action"
                onClick={() => {
                  setLocation("116.397428,39.90923");
                  setExpandedMapPlace(undefined);
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
        </div>

        <label className="prompt-box">
          <span>
            <MessageSquareText size={18} />
            你想找什么？
          </span>
          <textarea
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：我们 3 个人，想找一个附近、预算合适、适合聊天的地方"
          />
        </label>

        <div className="tag-section">
          <p>想做什么</p>
          <div className="intent-grid">
            {intentOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={intent === option.id ? "active" : ""}
                onClick={() => setIntent(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="tag-section">
          <p>偏好</p>
          <div className="mood-grid">
            {moodOptions.map((option) => (
              <button
                type="button"
                key={option.id}
                className={selectedMoods.includes(option.id) ? "active" : ""}
                onClick={() => toggleMood(option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="prompt-box">
          <span>
            <MapPin size={16} />
            你在哪儿？点击定位或输入高德坐标
          </span>
          <div className="location-row">
            <input
              value={location}
              onChange={(event) => {
                setLocation(event.target.value);
                setExpandedMapPlace(undefined);
                setLocationMessage(parseLocation(event.target.value) ? "已使用你输入的位置。" : "请输入“经度,纬度”，例如 116.397428,39.90923。");
              }}
              placeholder="例如：116.397428,39.90923"
            />
            <button type="button" className="icon-action" onClick={useBrowserLocation} title="使用浏览器定位" disabled={isLocating}>
              <LocateFixed size={18} />
            </button>
          </div>
          {locationMessage ? <small className="field-hint">{locationMessage}</small> : null}
        </div>

        {!isLoading && !hasUsableLocation ? <div className="agent-state">{status}</div> : null}
      </section>

      <section className="results-panel">
        {isLoading ? (
          <div className="loading-panel" role="status" aria-live="polite">
            <span className="loading-spinner" />
            <strong>正在更新附近推荐</strong>
            <p>正在读取位置、地点、天气和口碑信息。</p>
          </div>
        ) : null}
        <div className={`map-surface ${expandedMapPlace ? "expanded" : ""}`}>
          <AMapPreview
            center={userCoordinates}
            places={visibleRecommendations}
            selectedPlace={mapPlace}
            onSelectPlace={setExpandedMapPlace}
          />
          <div className="map-topbar">
            <span>{userCoordinates ? "高德地图" : "等待定位"}</span>
            <strong>{mapPlace?.name ?? "先定位后显示地图"}</strong>
          </div>
          <div className="map-place-strip">
            {mapPreviewPlaces.map((place, index) => (
              <button
                type="button"
                key={place.id}
                onClick={(event) => {
                  event.stopPropagation();
                  setExpandedMapPlace(place);
                }}
              >
                <strong>{index + 1}</strong>
                {place.name}
              </button>
            ))}
          </div>
          {mapPlace ? (
            <button type="button" className="map-caption" onClick={() => setExpandedMapPlace(mapPlace)}>
              {expandedMapPlace ? "已展开地图" : "点击展开地图"}
            </button>
          ) : null}
          {expandedMapPlace ? (
            <>
              <button type="button" className="map-close" onClick={() => setExpandedMapPlace(undefined)} title="收起地图">
                <X size={16} />
              </button>
              <a className="amap-open-link" href={getPlaceMapUrl(expandedMapPlace, location)} target="_blank" rel="noreferrer">
                用高德打开
                <ExternalLink size={14} />
              </a>
            </>
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
  if (reason.includes("人数合适")) return "适合当前人数";
  if (reason.includes("偏好标签")) return "氛围和你想要的感觉接近";
  if (reason.includes("口碑标签")) return "公开口碑里也有相近线索";
  if (reason.includes("实时周边地点")) return "位置在你附近";
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
