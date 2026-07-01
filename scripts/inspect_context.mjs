import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function peek(table) {
  const { data, error, count } = await c.from(table).select("*", { count: "exact" }).limit(3);
  if (error) { console.log(`\n[${table}] ✗ ${error.message.slice(0, 80)}`); return; }
  console.log(`\n[${table}] rows=${count}`);
  console.log("  columns:", Object.keys(data?.[0] ?? {}).join(", "));
  (data ?? []).slice(0, 2).forEach((r, i) => console.log(`  sample${i}:`, JSON.stringify(r).slice(0, 260)));
}

for (const t of ["companies_metadata", "search_learnings", "role_searches", "regression_baseline", "profile_facets"]) {
  await peek(t);
}

// what tier values exist + how many per tier
const { data: tiers } = await c.from("companies_metadata").select("tier").limit(2000);
if (tiers) {
  const counts = {};
  for (const r of tiers) counts[r.tier ?? "null"] = (counts[r.tier ?? "null"] || 0) + 1;
  console.log("\n[companies_metadata] tier distribution (first 2000):", JSON.stringify(counts));
}
