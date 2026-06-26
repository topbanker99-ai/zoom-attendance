// Shared Upstash Redis client.
// Works whether you add Upstash directly (UPSTASH_REDIS_REST_*)
// or via Vercel's Storage marketplace (KV_REST_API_*).
import { Redis } from "@upstash/redis";

const url =
  process.env.UPSTASH_REDIS_REST_URL ||
  process.env.KV_REST_API_URL ||
  process.env.REDIS_URL;

const token =
  process.env.UPSTASH_REDIS_REST_TOKEN ||
  process.env.KV_REST_API_TOKEN ||
  process.env.REDIS_TOKEN;

if (!url || !token) {
  console.error(
    "Redis env vars missing. Set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN (or KV_REST_API_URL / KV_REST_API_TOKEN)."
  );
}

export const redis = new Redis({ url, token });
