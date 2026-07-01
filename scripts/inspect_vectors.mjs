import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const POOLS = [
  { t: "profiles", embed: "search_embedding" },
  { t: "luma_profiles", embed: "search_embedding" },
  { t: "yc_employees", embed: "search_embedding" },
  { t: "ext_profiles", embed: "search_embedding" },
  { t: "apify_search_profiles", embed: "search_embedding" },
];

console.log("== embedding column presence + coverage ==");
for (const p of POOLS) {
  // total
  const { count: total } = await c.from(p.t).select("*", { count: "exact", head: true });
  // does the embed col exist? try selecting it
  const probe = await c.from(p.t).select(p.embed).limit(1);
  if (probe.error) { console.log(`  ${p.t}: total=${total ?? "?"} | NO '${p.embed}' column (${probe.error.message.slice(0, 50)})`); continue; }
  // count non-null embeddings
  const { count: withEmb } = await c.from(p.t).select("*", { count: "exact", head: true }).not(p.embed, "is", null);
  console.log(`  ${p.t}: total=${total ?? "?"} | embedded=${withEmb ?? 0}`);
}

console.log("\n== env for embeddings ==");
console.log("  EMBEDDING_API_KEY:", env.EMBEDDING_API_KEY ? "set" : "MISSING");
console.log("  EMBEDDING_MODEL:", env.EMBEDDING_MODEL || "(default text-embedding-3-small)");

console.log("\n== match_profiles RPC ==");
const vec = Array.from({ length: 1536 }, () => 0.0255);
const { data, error } = await c.rpc("match_profiles", { query_embedding: vec, match_count: 2 });
console.log(error ? "  ✗ " + error.message.slice(0, 140) : `  ✓ returns ${Array.isArray(data) ? data.length : "?"} rows`);
