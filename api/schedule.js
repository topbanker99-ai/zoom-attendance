// Daily education timetable, set by the admin dashboard and read by the farmer page.
//
//   GET  /api/schedule  -> { ok, schedule }             (public, for edu.html)
//   POST /api/schedule  -> save { schedule }            (admin only)
//        headers: x-admin-key: <ADMIN_KEY>
//        body:    { schedule: { title, date, capacity, rows:[{start,end,topic,teacher,tag,lunch}] } }
//
// Env var: ADMIN_KEY (same one used by voice.js / sms.js / config.js).
import { redis } from "../lib/redis.js";

const ADMIN_KEY = process.env.ADMIN_KEY || "";
const KEY = "config:schedule";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-admin-key");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  if (req.method === "GET") {
    try {
      const data = await redis.get(KEY);
      if (!data) { res.status(200).json({ ok: true, schedule: null }); return; }
      const obj = typeof data === "string" ? JSON.parse(data) : data;
      res.status(200).json({ ok: true, schedule: obj });
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
    const sched = body.schedule;
    if (!sched || !Array.isArray(sched.rows) || sched.rows.length === 0) {
      res.status(200).json({ ok: false, reason: "empty" });
      return;
    }
    const obj = {
      title: String(sched.title || "").trim(),
      date: String(sched.date || "").trim(),
      capacity: String(sched.capacity || "").trim(),
      rows: sched.rows.slice(0, 30).map((r) => ({
        start: String(r.start || "").trim(),
        end: String(r.end || "").trim(),
        topic: String(r.topic || "").trim(),
        teacher: String(r.teacher || "").trim(),
        tag: String(r.tag || "").trim(),
        lunch: !!r.lunch,
      })),
      updatedAt: Date.now(),
    };
    try {
      await redis.set(KEY, JSON.stringify(obj));
      res.status(200).json({ ok: true });
    } catch (e) {
      res.status(200).json({ ok: false, reason: "write_error" });
    }
    return;
  }

  res.status(200).json({ ok: false, reason: "method" });
}
