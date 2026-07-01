import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// A non-zero 1536-dim test vector (normalized-ish) to probe the function.
const vec = Array.from({ length: 1536 }, () => 0.0255);

async function tryCall(name, params) {
  const { data, error } = await client.rpc(name, params);
  if (error) return `  ✗ ${name}(${Object.keys(params).join(",")}): ${error.message.slice(0, 110)}`;
  const sample = Array.isArray(data) ? data[0] : data;
  return `  ✓ ${name}(${Object.keys(params).join(",")}): ${Array.isArray(data) ? data.length + " rows" : "ok"}; cols: ${
    sample ? Object.keys(sample).slice(0, 12).join(", ") : "—"
  }`;
}

const variants = [
  ["match_profiles", { query_embedding: vec, match_count: 3 }],
  ["match_profiles", { query_embedding: vec, match_count: 3, match_threshold: 0.0 }],
  ["match_profiles", { query_embedding: vec, match_threshold: 0.0, match_count: 3 }],
];
for (const [n, p] of variants) console.log(await tryCall(n, p));
