import type { DecisionInput, Intent, Mood, ParsedPrompt, Place, Recommendation, WeatherContext } from "../domain";

export const intentOptions: Array<{ id: Intent; label: string }> = [
  { id: "dinner", label: "吃饭" },
  { id: "coffee", label: "咖啡" },
  { id: "bar", label: "小酌" },
  { id: "late-night", label: "夜宵" },
  { id: "dessert", label: "甜品" },
  { id: "walk", label: "逛逛" },
];

export const moodOptions: Array<{ id: Mood; label: string }> = [
  { id: "quiet", label: "安静" },
  { id: "lively", label: "热闹" },
  { id: "chat", label: "适合聊天" },
  { id: "date", label: "约会" },
  { id: "value", label: "性价比" },
  { id: "photo", label: "好拍照" },
  { id: "quick", label: "出餐快" },
];

export function parsePrompt(prompt: string): ParsedPrompt {
  const peopleMatch = prompt.match(/(\d+)\s*(个|位|人)/);
  const budgetMatch = prompt.match(/人均\s*(\d+)|(\d+)\s*(以内|以下|左右)/);
  const inferredMoods: Mood[] = [];

  if (/安静|清净|不吵/.test(prompt)) inferredMoods.push("quiet");
  if (/热闹|氛围|开心/.test(prompt)) inferredMoods.push("lively");
  if (/聊天|坐一会|谈事/.test(prompt)) inferredMoods.push("chat");
  if (/便宜|性价比|划算|不贵/.test(prompt)) inferredMoods.push("value");
  if (/快|赶时间|不用等|少排队/.test(prompt)) inferredMoods.push("quick");
  if (/约会|对象|浪漫/.test(prompt)) inferredMoods.push("date");
  if (/拍照|出片|好看/.test(prompt)) inferredMoods.push("photo");

  let intent: Intent | undefined;
  if (/咖啡|拿铁|美式/.test(prompt)) intent = "coffee";
  if (/酒|清酒|小酌|喝点|精酿|酒吧/.test(prompt)) intent = "bar";
  if (/夜宵|宵夜|晚点|深夜/.test(prompt)) intent = "late-night";
  if (/甜品|蛋糕|奶茶|冰淇淋/.test(prompt)) intent = "dessert";
  if (/逛|走走|散步/.test(prompt)) intent = "walk";
  if (/吃|饭|餐|火锅|烧烤|清淡|辣|湘菜|川菜|日料/.test(prompt)) intent = "dinner";

  return {
    people: peopleMatch ? Number(peopleMatch[1]) : undefined,
    budget: budgetMatch ? Number(budgetMatch[1] || budgetMatch[2]) : undefined,
    intent,
    moods: inferredMoods,
  };
}

export function getEffectiveInput(input: DecisionInput): DecisionInput {
  const parsed = parsePrompt(input.prompt);

  return {
    ...input,
    people: input.people,
    budget: parsed.budget ?? input.budget,
    intent: parsed.intent ?? input.intent,
    moods: Array.from(new Set([...(parsed.moods ?? []), ...input.moods])),
  };
}

export function recommendPlaces(places: Place[], input: DecisionInput, weather?: WeatherContext): Recommendation[] {
  const moodSet = new Set(input.moods);

  return places
    .map((place) => {
      const scored = scorePlace(place, input.intent, moodSet, input.people, input.budget, weather);
      return { ...place, ...scored };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 4);
}

function scorePlace(place: Place, intent: Intent, moodSet: Set<Mood>, people: number, budget: number, weather?: WeatherContext) {
  let score = place.rating * 16;
  const reasons: string[] = [];

  if (place.qualityScore) {
    score += Math.min(24, place.qualityScore / 5);
    reasons.push("数据完整度更高");
  }

  if (place.category === intent) {
    score += 24;
    reasons.push("类型匹配当前选择");
  }

  if (place.distanceMinutes <= 10) {
    score += 18;
    reasons.push("距离近，适合临时决定");
  } else if (place.distanceMinutes <= 18) {
    score += 8;
  }

  if (place.avgPrice === 0 || place.avgPrice <= budget) {
    score += 16;
    reasons.push("预算匹配");
  } else {
    score -= Math.min(24, (place.avgPrice - budget) / 5);
  }

  if (people >= place.groupFit[0] && people <= place.groupFit[1]) {
    score += 14;
    reasons.push("人数合适");
  } else {
    score -= 18;
  }

  const matchedTags = place.tags.filter((tag) => moodSet.has(tag));
  score += matchedTags.length * 10;
  if (matchedTags.length) reasons.push("偏好标签命中");

  const matchedReviewTags = place.enrichment?.tags.filter((tag) => moodSet.has(tag)) ?? [];
  score += matchedReviewTags.length * 8;
  if (matchedReviewTags.length) reasons.push("口碑标签命中");

  if (place.source === "amap" || place.source === "merged") {
    score += 4;
    reasons.push("来自实时周边地点");
  }

  if (place.enrichment?.source === "tavily" || place.enrichment?.source === "mixed") {
    score += 6;
    reasons.push("已补充公开口碑搜索");
  }

  if (place.enrichment?.links.length) {
    score += Math.min(10, place.enrichment.links.length * 4);
    reasons.push("有可追溯口碑链接");
  }

  if (place.dataWarnings?.includes("缺少人均消费")) {
    score -= 6;
  }

  if (place.enrichment?.cautions.some((item) => /排队|吵|贵|踩雷/.test(item))) {
    score -= 4;
  }

  if (weather && weather.precipitation > 0.2) {
    if (place.category === "walk") {
      score -= 20;
      reasons.push("降雨时不优先推荐户外逛逛");
    } else {
      score += 6;
      reasons.push("天气不佳时更适合室内");
    }
  }

  return {
    score,
    reasons,
    rankingScore: Math.round(score),
    rankingSignals: reasons,
  };
}
