// Shared Zoom-link config, set by the admin dashboard and read by the farmer page.
//
//   GET  /api/config   -> { ok, zoomUrl, meetingId, updatedAt }   (public, for edu.html)
//   POST /api/config   -> save { zoomUrl, meetingId }             (admin only)
//        headers: x-admin-key: <ADMIN_KEY>
//        body:    { zoomUrl, meetingId }
//
// Env var: ADMIN_KEY (same one used by voice.js / sms.js).
import { redis } from "../lib/redis.js";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const KEY = "config:zoom";

// Pull the meeting number out of a full Zoom link (the /j/NUMBER part).
function extractMeetingId(url) {
  if (!url) return "";
  let m = String(url).match(/\/j\/(\d{8,12})/);
  if (m) return m[1];
  m = String(url).match(/(\d{9,12})/);
  return m ? m[1] : "";
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (req.method === "GET") {
    try {
      const data = await redis.get(KEY);
      if (!data) { res.status(200).json({ ok: true, zoomUrl: "", meetingId: "" }); return; }
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      res.status(200).json({
        ok: true,
        zoomUrl: obj.zoomUrl || "",
        meetingId: obj.meetingId || "",
        updatedAt: obj.updatedAt || 0,
      });
    } catch (e) {
      res.status(200).json({ ok: false, reason: "read_error" });
    }
    return;
  }

  if (req.method === "POST") {
    const key = req.headers["x-admin-key"] || "";
    if (!ADMIN_KEY || key !== ADMIN_KEY) {
      res.status(200).json({ ok: false, reason: "unauthorized" });
      return;
    }
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    body = body || {};
    const zoomUrl = String(body.zoomUrl || "").trim();
    let meetingId = String(body.meetingId || "").replace(/\D/g, "");
    if (!meetingId) meetingId = extractMeetingId(zoomUrl);
    if (!zoomUrl && !meetingId) {
      res.status(200).json({ ok: false, reason: "empty" });
      return;
    }
    const obj = { zoomUrl: zoomUrl, meetingId: meetingId, updatedAt: Date.now() };
    try {
      await redis.set(KEY, JSON.stringify(obj));
      res.status(200).json({ ok: true, zoomUrl: zoomUrl, meetingId: meetingId });
    } catch (e) {
      res.status(200).json({ ok: false, reason: "write_error" });
    }
    return;
  }

  res.status(200).json({ ok: false, reason: "method" });
}
