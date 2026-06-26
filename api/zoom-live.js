// GET /api/zoom-live?meetingId=123
// Returns EVERYONE currently in an in-progress Zoom meeting (Dashboard/metrics API).
// Used only while a meeting is live. No join/leave tracking — just the current roster.
//
// Env vars: ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
// Scopes (Dashboard): dashboard:read:list_meeting_participants:admin
//   (optional, improves accuracy) dashboard:read:list_meetings:admin
// The Dashboard API needs a Zoom Business/Education/Enterprise plan.
import { redis } from "../lib/redis.js";

const ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID || "";
const CLIENT_ID = process.env.ZOOM_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET || "";
const TTL = 60 * 60 * 12;

async function getToken() {
  try {
    const cached = await redis.get("zoom:token");
    if (cached) return cached;
  } catch (e) {}
  const basic = Buffer.from(CLIENT_ID + ":" + CLIENT_SECRET).toString("base64");
  const url =
    "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=" +
    encodeURIComponent(ACCOUNT_ID);
  const r = await fetch(url, { method: "POST", headers: { Authorization: "Basic " + basic } });
  if (!r.ok) throw Object.assign(new Error("token_failed"), { status: r.status });
  const j = await r.json();
  const tok = j.access_token;
  const ttl = Math.max(60, (j.expires_in || 3600) - 60);
  try { await redis.set("zoom:token", tok, { ex: ttl }); } catch (e) {}
  return tok;
}

// Zoom UUIDs may contain "/" or "+" and must be double-encoded.
function encId(id, isUuid) {
  if (isUuid && (id.indexOf("/") >= 0 || id.indexOf("+") >= 0)) {
    return encodeURIComponent(encodeURIComponent(id));
  }
  return encodeURIComponent(id);
}

// Find the live meeting's UUID (more reliable than the numeric id).
async function findLiveUuid(meetingId, token) {
  let pageToken = "";
  for (let i = 0; i < 6; i++) {
    const url =
      "https://api.zoom.us/v2/metrics/meetings?type=live&page_size=300" +
      (pageToken ? "&next_page_token=" + encodeURIComponent(pageToken) : "");
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw Object.assign(new Error("list_failed"), { status: r.status });
    const j = await r.json();
    const hit = (j.meetings || []).find(
      (m) => String(m.id || "").replace(/\D/g, "") === meetingId
    );
    if (hit && hit.uuid) return hit.uuid;
    pageToken = j.next_page_token || "";
    if (!pageToken) break;
  }
  return null;
}

// Pull live participant names + what Zoom says the total is.
async function fetchParticipants(idOrUuid, isUuid, token) {
  const names = [];
  let pageToken = "";
  let total = 0;
  let pages = 0;
  for (let i = 0; i < 12; i++) {
    const url =
      "https://api.zoom.us/v2/metrics/meetings/" +
      encId(idOrUuid, isUuid) +
      "/participants?type=live&page_size=300" +
      (pageToken ? "&next_page_token=" + encodeURIComponent(pageToken) : "");
    const r = await fetch(url, { headers: { Authorization: "Bearer " + token } });
    if (!r.ok) throw Object.assign(new Error("metrics_failed"), { status: r.status });
    const j = await r.json();
    pages++;
    if (typeof j.total_records === "number") total = j.total_records;
    (j.participants || []).forEach((p) => {
      const n = p.user_name || p.name || "";
      if (n && String(n).trim()) names.push(String(n).trim());
    });
    pageToken = j.next_page_token || "";
    if (!pageToken) break;
  }
  return { names: names, total: total, pages: pages };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const meetingId = String(req.query?.meetingId || "").replace(/\D/g, "");
  if (!meetingId) { res.status(200).json({ ok: false, reason: "no_meeting" }); return; }
  if (!ACCOUNT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    res.status(200).json({ ok: false, reason: "no_credentials" });
    return;
  }

  let token;
  try {
    token = await getToken();
  } catch (e) {
    res.status(200).json({ ok: false, reason: "auth", status: e.status || 0 });
    return;
  }

  // Resolve UUID (cached ~5 min). Falls back to numeric id if listing isn't allowed.
  let uuid = null;
  try { uuid = await redis.get("zoom:uuid:" + meetingId); } catch (e) {}
  if (!uuid) {
    try {
      uuid = await findLiveUuid(meetingId, token);
      if (uuid) { try { await redis.set("zoom:uuid:" + meetingId, uuid, { ex: 300 }); } catch (e) {} }
    } catch (e) { uuid = null; }
  }

  let result = null;
  let viaUuid = false;
  if (uuid) {
    try { result = await fetchParticipants(uuid, true, token); viaUuid = true; }
    catch (e) { result = null; }
  }
  if (!result) {
    try {
      result = await fetchParticipants(meetingId, false, token);
    } catch (e) {
      const st = e.status || 0;
      if (st === 404) { res.status(200).json({ ok: false, reason: "not_live", status: st }); return; }
      if (st === 400 || st === 401 || st === 403) { res.status(200).json({ ok: false, reason: "plan_or_scope", status: st }); return; }
      res.status(200).json({ ok: false, reason: "error", status: st }); return;
    }
  }

  const names = result.names;
  if (names.length > 0) {
    const key = "live:" + meetingId;
    const obj = {};
    names.forEach((n, idx) => { obj["live_" + idx] = { n: n }; });
    try {
      await redis.del(key);
      await redis.hset(key, obj);
      await redis.expire(key, TTL);
      await redis.set("meta:" + meetingId + ":updated", Date.now(), { ex: TTL });
    } catch (e) {}
  }

  res.status(200).json({
    ok: true,
    participants: names,
    count: names.length,
    zoomReported: result.total,
    pages: result.pages,
    viaUuid: viaUuid,
    source: "zoom-live",
  });
}
