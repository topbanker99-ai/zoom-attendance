// /api/subsidies — 농어민 보조금 목록 (보조금24 API 프록시)
//
// 행정안전부 "대한민국 공공서비스(혜택) 정보"(보조금24) API를 호출해
// 농업·어업·귀농·청년농 관련 지원사업만 골라 정리해서 내려줍니다.
// 인증키는 환경변수 SUBSIDY_API_KEY (Decoding 키)로 숨깁니다.
// CDN 캐시(s-maxage) + Vercel Cron(하루 1회)으로 API 호출량을 아낍니다.
//
// 응답 예:
// { ok:true, updatedAt, count,
//   items:[ { id, name, target, amount, type, field, org, url,
//             deadlineText, deadline, status } ] }
//   status: "deadline"(마감일 있음) | "상시" | "문의"

const LIST_URL = "https://api.odcloud.kr/api/gov24/v3/serviceList";
const KEY = process.env.SUBSIDY_API_KEY || "";

// 농어업 관련으로 판단할 키워드 (사업명·대상·내용·분야에서 검색)
const KEYWORDS = [
  "농업인", "어업인", "귀농", "귀어", "청년농", "농어민", "농가", "어가",
  "영농", "축산", "임업", "수산", "농림", "농지", "작물", "가축", "양식", "농촌"
];
// 서비스분야가 이 값이면 무조건 포함 (서버 필터로도 사용)
const FARM_FIELD = "농림축산어업";

// 긴 텍스트를 앞부분만 잘라서 반환
function pick(str, n) {
  if (!str) return "";
  const s = String(str).replace(/\s+/g, " ").replace(/^[○\s]+/, "").trim();
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function mkDate(y, mo, da) {
  if (mo < 1 || mo > 12 || da < 1 || da > 31) return null;
  const d = new Date(y, mo - 1, da);
  return isNaN(d.getTime()) ? null : d;
}
function laterDate(a, b) { return !a ? b : (b > a ? b : a); }
function stripTime(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
function iso(d) {
  const p = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
}

// 신청기한 자유 텍스트에서 마감일(YYYY-MM-DD)을 최대한 뽑아냄.
// 뽑지 못하면 상시/문의로 처리.
function parseDeadline(text) {
  if (!text) return { deadline: null, status: "문의" };
  const t = String(text);
  if (/상시|수시|연중|자율|무관|기간\s*없음/.test(t)) return { deadline: null, status: "상시" };

  const now = stripTime(new Date());
  const yNow = now.getFullYear();
  let best = null;
  let m;

  // 1) YYYY-MM-DD / YYYY.MM.DD / YYYY/MM/DD
  let re = /(20\d{2})[.\-\/]\s*(\d{1,2})[.\-\/]\s*(\d{1,2})/g;
  while ((m = re.exec(t))) { const d = mkDate(+m[1], +m[2], +m[3]); if (d) best = laterDate(best, d); }

  // 2) 연도 없는 M.D (예: 5.31. / 5.31) → 올해 기준, 이미 지났으면 내년
  if (!best) {
    re = /(?<![\d.])(\d{1,2})[.\/](\d{1,2})(?![\d])/g;
    while ((m = re.exec(t))) {
      let d = mkDate(yNow, +m[1], +m[2]);
      if (d && d < now) d = mkDate(yNow + 1, +m[1], +m[2]);
      if (d) best = laterDate(best, d);
    }
  }

  // 3) N월 N일
  if (!best) {
    re = /(\d{1,2})\s*월\s*(\d{1,2})\s*일/g;
    while ((m = re.exec(t))) {
      let d = mkDate(yNow, +m[1], +m[2]);
      if (d && d < now) d = mkDate(yNow + 1, +m[1], +m[2]);
      if (d) best = laterDate(best, d);
    }
  }

  if (best) return { deadline: iso(best), status: "deadline" };
  return { deadline: null, status: "문의" };
}

function isFarm(item) {
  const field = item["서비스분야"] || "";
  if (/농림|수산|축산|어업|임업/.test(field)) return true;
  const hay = [item["서비스명"], item["지원대상"], item["지원내용"], field].join(" ");
  return KEYWORDS.some((k) => hay.indexOf(k) >= 0);
}

async function fetchPage(page, perPage, useCond) {
  const params = new URLSearchParams();
  params.set("page", String(page));
  params.set("perPage", String(perPage));
  params.set("returnType", "JSON");
  params.set("serviceKey", KEY); // Decoding 키 → URLSearchParams가 자동 인코딩
  if (useCond) params.set("cond[서비스분야::EQ]", FARM_FIELD);
  const r = await fetch(LIST_URL + "?" + params.toString(), { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("API " + r.status);
  return r.json();
}

async function collect() {
  const perPage = 100;

  // 1차 시도: '농림축산어업' 분야로 서버에서 좁히기
  let useCond = true;
  let first = null;
  try { first = await fetchPage(1, perPage, true); } catch (e) { first = null; }

  const ok =
    first && Array.isArray(first.data) &&
    typeof first.totalCount === "number" && first.totalCount > 0 && first.totalCount < 4000;

  if (!ok) {
    // cond가 안 먹히거나 실패 → 전체를 스캔(페이지 제한)하며 코드로 필터
    useCond = false;
    first = await fetchPage(1, perPage, false);
  }

  const total = (first && typeof first.totalCount === "number") ? first.totalCount : ((first && first.data) || []).length;
  const totalPages = Math.max(1, Math.ceil(total / perPage));
  const cap = useCond ? totalPages : Math.min(totalPages, 20); // 전체 스캔 시 20페이지(2000건)로 제한

  const pages = [first];
  const rest = [];
  for (let p = 2; p <= cap; p++) rest.push(p);

  // 병렬 호출 (동시성 6)
  const CONC = 6;
  for (let i = 0; i < rest.length; i += CONC) {
    const batch = rest.slice(i, i + CONC);
    const results = await Promise.all(batch.map((p) => fetchPage(p, perPage, useCond).catch(() => null)));
    for (const r of results) if (r) pages.push(r);
  }

  const out = [];
  for (const j of pages) for (const it of ((j && j.data) || [])) if (isFarm(it)) out.push(it);
  return out;
}

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (!KEY) { res.setHeader("Cache-Control", "no-store"); res.status(200).json({ ok: false, reason: "no_api_key" }); return; }

  try {
    const raw = await collect();
    const seen = new Set();
    const items = [];
    for (const it of raw) {
      const id = String(it["서비스ID"] || it["상세조회URL"] || it["서비스명"] || "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const dl = parseDeadline(it["신청기한"]);
      items.push({
        id: id,
        name: it["서비스명"] || "",
        target: pick(it["지원대상"], 60),
        amount: pick(it["지원내용"], 60),
        type: it["지원유형"] || "",
        field: it["서비스분야"] || "",
        org: it["소관기관명"] || "",
        url: it["상세조회URL"] || "",
        deadlineText: (it["신청기한"] || "").replace(/\s+/g, " ").trim(),
        deadline: dl.deadline,
        status: dl.status,
      });
    }
    // 마감일 가까운 순 → 상시/문의는 뒤로
    items.sort((a, b) => {
      if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : 1;
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return 0;
    });
    // 결과가 있을 때만 캐시 (빈 결과·오류는 캐시하지 않아 다음 요청에서 즉시 재시도)
    if (items.length > 0) {
      res.setHeader("Cache-Control", "public, max-age=1800, s-maxage=43200, stale-while-revalidate=86400");
    } else {
      res.setHeader("Cache-Control", "no-store");
    }
    res.status(200).json({ ok: true, updatedAt: Date.now(), count: items.length, items });
  } catch (e) {
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ ok: false, reason: "fetch_error", message: String((e && e.message) || e) });
  }
}
