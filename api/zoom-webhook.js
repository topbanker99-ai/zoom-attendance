// POST /api/zoom-webhook
// Receives Zoom Meeting webhooks and keeps a live participant list in Redis.
import crypto from "node:crypto";
import { redis } from "../lib/redis.js";

const SECRET = process.env.ZOOM_WEBHOOK_SECRET_TOKEN || "";
const TTL = 60 * 60 * 12; // keep live data for up to 12 hours

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = req.body || {};

  // 1) Endpoint URL validation (CRC challenge) — required by Zoom when you set the URL.
  if (body.event === "endpoint.url_validation") {
    const hash = crypto
      .createHmac("sha256", SECRET)
      .update(body.payload?.plainToken ?? "")
      .digest("hex");
    res.status(200).json({
      plainToken: body.payload?.plainToken,
      encryptedToken: hash,
    });
    return;
  }

  // 2) Verify the request really came from Zoom (official method).
  if (SECRET) {
    const ts = req.headers["x-zm-request-timestamp"];
    const message = `v0:${ts}:${JSON.stringify(body)}`;
    const expected =
      "v0=" + crypto.createHmac("sha256", SECRET).update(message).digest("hex");
    if (req.headers["x-zm-signature"] !== expected) {
      console.warn("Zoom signature mismatch");
      res.status(401).json({ error: "Invalid signature" });
      return;
    }
  }

  // 3) Handle participant events.
  try {
    const obj = body.payload?.object || {};
    const meetingId = String(obj.id || obj.meeting_id || "default").replace(/\D/g, "") || "default";
    const key = `live:${meetingId}`;
    const metaKey = `meta:${meetingId}:updated`;
    const ev = body.event;

    if (ev === "meeting.participant_joined") {
      const p = obj.participant || {};
      const field = String(
        p.participant_uuid || p.user_id || p.id || `${p.user_name}:${Date.now()}`
      );
      await redis.hset(key, { [field]: { n: p.user_name || "(이름 없음)" } });
      await redis.expire(key, TTL);
      await redis.set(metaKey, Date.now(), { ex: TTL });
    } else if (ev === "meeting.participant_left") {
      const p = obj.participant || {};
      const field = String(p.participant_uuid || p.user_id || p.id || "");
      if (field) await redis.hdel(key, field);
      await redis.set(metaKey, Date.now(), { ex: TTL });
    } else if (ev === "meeting.started") {
      await redis.del(key); // fresh start clears any leftovers
      await redis.set(metaKey, Date.now(), { ex: TTL });
    } else if (ev === "meeting.ended") {
      await redis.del(key);
      await redis.set(metaKey, Date.now(), { ex: TTL });
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error("webhook handler error:", e);
    // Respond 200 so Zoom doesn't aggressively retry on a transient error.
    res.status(200).json({ ok: false });
  }
}
