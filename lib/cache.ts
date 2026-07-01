import { COST } from "./config";

// Query cache + single-flight. Identical queries cost $0 (no DB, no AI, no Apify).
//
// Two backends, chosen at runtime:
//   • Upstash Redis (REST)  — shared across instances, survives restarts, ready for
//     horizontal scale. Enabled automatically when UPSTASH_REDIS_REST_URL + _TOKEN are set.
//   • In-memory Map         — process-local fallback for local dev / single server.
// No new npm dependency — Upstash is reached over plain fetch.

const R_URL = process.env.UPSTASH_REDIS_REST_URL?.replace(/\/$/, "");
const R_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const hasRedis = Boolean(R_URL && R_TOKEN);
const TTL_S = Math.floor(COST.CACHE_TTL_MS / 1000);

export function cacheKey(q: string): string {
  return "td:q:" + q.trim().toLowerCase().replace(/\s+/g, " ");
}

// ── Upstash REST: POST the base URL with a command array, e.g. ["GET", key] ──
async function redis(cmd: (string | number)[]): Promise<any> {
  const res = await fetch(R_URL!, {
    method: "POST",
    headers: { Authorization: `Bearer ${R_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`redis ${res.status}`);
  return (await res.json())?.result ?? null;
}

// ── in-memory fallback ──
interface Entry<T> { value: T; expires: number; }
const store = new Map<string, Entry<unknown>>();

export async function cacheGet<T>(key: string): Promise<T | null> {
  if (!COST.CACHE_ENABLED) return null;
  if (hasRedis) {
    try {
      const raw = await redis(["GET", key]);
      return raw ? (JSON.parse(raw as string) as T) : null;
    } catch (e) {
      console.error("[cache] redis GET failed, in-memory:", e);
    }
  }
  const hit = store.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expires) { store.delete(key); return null; }
  return hit.value as T;
}

export async function cacheSet<T>(key: string, value: T): Promise<void> {
  if (!COST.CACHE_ENABLED) return;
  if (hasRedis) {
    try { await redis(["SET", key, JSON.stringify(value), "EX", TTL_S]); return; }
    catch (e) { console.error("[cache] redis SET failed, in-memory:", e); }
  }
  store.set(key, { value, expires: Date.now() + COST.CACHE_TTL_MS });
}

// ── single-flight: collapse concurrent identical queries into ONE computation ──
// Under load, 50 users searching the same thing trigger 1 DB+AI run, not 50.
const inflight = new Map<string, Promise<unknown>>();

export function singleFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key);
  if (existing) return existing as Promise<T>;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}
