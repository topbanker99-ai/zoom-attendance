// GET /api/zoom-live?meetingId=123
// Asks Zoom for EVERYONE currently in an in-progress meeting (Dashboard/metrics API),
// then writes that authoritative roster into Redis. This means the dashboard shows
// every current attendee even if we connected AFTER the meeting already started —
// not just people who join/leave after we connect (that's what the webhook handles).
//
// Requires a Server-to-Server OAuth app (we already have "NONG") and these env vars:
//   ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET
// plus the scope: dashboard:read:list_meeting_participants:admin
//   (older name: dashboard_meetings:read:admin)
// The Dashboard API needs a Zoom Business/Education/Enterprise plan.
import { redis } from "../lib/redis.js";

const ACCOUNT_ID = process.env.ZOOM_ACCOUNT_ID || "";
const CLIENT_ID = process.env.ZOOM_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ZOOM_CLIENT_SECRET || "";
const TTL = 60 * 60 * 12; // keep live data up to 12 hours

// Get (and cache) a Server-to-Server OAuth access token.
async function getToken() {
  try {
    const cached = await redis.get("zoom:token");
    if (cached) return cached;
  } catch (e) {}

  const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const url =
    "https://zoom.us/oauth/token?grant_type=account_credentials&account_id=" +
    encodeURIComponent(ACCOUNT_ID);
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Basic " + basic },
  });
  if (!r.ok) {
    throw Object.assign(new Error("token_failed"), { status: r.status });
  }
  const j = await r.json();
  const tok = j.access_token;
  const ttl = Math.max(60, (j.expires_in || 3600) - 60);
  try {
    await redis.set("zoom:token", tok, { ex: ttl });
  } catch (e) {}
  return tok;
}

// Pull the live participant names (handles pagination).
async function fetchLiveNames(meetingId, token) {
  const names = [];
  let pageToken = "";
  for (let i = 0; i < 6; i++) {
    const url =
      "https://api.zoom.us/v2/metrics/meetings/" +
      encodeURIComponent(meetingId) +
      "/participants?type=live&page_size=300" +
      (pageToken ? "&next_page_token=" + encodeURIComponent(pageToken) : "");
    const r = await fetch(url, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) {
      throw Object.assign(new Error("metrics_failed"), { status: r.status });
    }
    const j = await r.json();
    (j.participants || []).forEach((p) => {
      const n = p.user_name || p.name || "";
      if (n && String(n).trim()) names.push(String(n).trim());
    });
    pageToken = j.next_page_token || "";
    if (!pageToken) break;
  }
  return names;
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const meetingId = String(req.query?.meetingId || "").replace(/\D/g, "");
  if (!meetingId) {
    res.status(200).json({ ok: false, reason: "no_meeting" });
    return;
  }
  if (!ACCOUNT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    res.status(200).json({ ok: false, reason: "no_credentials" });
    return;
  }

  let token;
  try {
    token = await getToken();
  } catch (e) {
    const st = e.status || 0;
    // 400/401 here almost always means wrong Account ID / Client ID / Secret.
    res.status(200).json({ ok: false, reason: "auth", status: st });
    return;
  }

  let names;
  try {
    names = await fetchLiveNames(meetingId, token);
  } catch (e) {
    const st = e.status || 0;
    if (st === 404) {
      // Meeting not found as a *live* meeting (not started yet / already ended).
      res.status(200).json({ ok: false, reason: "not_live", status: st });
      return;
    }
    if (st === 400 || st === 401 || st === 403) {
      // Missing Dashboard scope, or plan doesn't include Dashboard.
      res.status(200).json({ ok: false, reason: "plan_or_scope", status: st });
      return;
    }
    res.status(200).json({ ok: false, reason: "error", status: st });
    return;
  }

  // Seed Redis with the authoritative roster. Only overwrite when we actually
  // got people, so a transient empty reply never wipes good webhook data.
  if (names.length > 0) {
    const key = `live:${meetingId}`;
    const obj = {};
    names.forEach((n, idx) => {
      obj["live_" + idx] = { n: n };
    });
    try {
      await redis.del(key);
      await redis.hset(key, obj);
      await redis.expire(key, TTL);
      await redis.set(`meta:${meetingId}:updated`, Date.now(), { ex: TTL });
    } catch (e) {}
  }

  res.status(200).json({
    ok: true,
    participants: names,
    count: names.length,
    source: "zoom-live",
  });
}
