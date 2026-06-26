// GET  /api/status?meetingId=123&token=...   -> current live participants
// POST /api/status?meetingId=123&action=reset -> clear the live list
import { redis } from "../lib/redis.js";

const DASH_TOKEN = process.env.DASHBOARD_TOKEN || "";

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const meetingId =
    String(req.query?.meetingId || "default").replace(/\D/g, "") || "default";
  const token = req.query?.token || "";

  // Optional access protection for participant names.
  if (DASH_TOKEN && token !== DASH_TOKEN) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const key = `live:${meetingId}`;

  try {
    if (req.method === "POST") {
      const action = req.query?.action || "";
      if (action === "reset") {
        await redis.del(key);
        res.status(200).json({ ok: true, reset: true });
        return;
      }
      res.status(400).json({ error: "unknown action" });
      return;
    }

    const vals = (await redis.hvals(key)) || [];
    const names = [];
    for (const v of vals) {
      const n = v && typeof v === "object" ? v.n : v;
      if (n != null && String(n).trim()) names.push(String(n));
    }
    const updatedAt = await redis.get(`meta:${meetingId}:updated`);

    res.status(200).json({
      participants: names,
      count: names.length,
      updatedAt: updatedAt || null,
      meetingId,
    });
  } catch (e) {
    console.error("status error:", e);
    res.status(500).json({ error: "server error" });
  }
}
