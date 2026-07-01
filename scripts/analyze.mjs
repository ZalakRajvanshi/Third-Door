import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// total people across the unified view + each pool
console.log("── POOL SIZES ──");
for (const t of ["unified_person_view", "profiles", "luma_profiles", "yc_employees", "apify_search_profiles", "ext_profiles", "sourced_candidates", "profile_facets", "companies_metadata"]) {
  const { count } = await c.from(t).select("*", { count: "exact", head: true });
  console.log(`  ${t}: ${count}`);
}

// existing search RPC signatures
console.log("\n── SEARCH RPCs ──");
const RPCS = {
  search_profiles_hybrid: [{ query_text: "growth manager", match_count: 3 }, { q: "growth manager" }, { search_query: "growth manager", limit_count: 3 }, { query: "x", filters: {} }],
  search_profiles_v5_fts_v3: [{ query_text: "growth manager", limit_count: 3 }, { q: "growth manager" }, { search_text: "growth manager" }, { query: "growth manager" }],
  domain_match_candidates: [{ query_text: "fintech", match_count: 3 }, { domain: "fintech" }, { query: "fintech" }],
};
for (const [name, variants] of Object.entries(RPCS)) {
  let done = false;
  for (const args of variants) {
    const { data, error } = await c.rpc(name, args);
    if (!error) { console.log(`  ✓ ${name}(${Object.keys(args).join(",")}) → ${Array.isArray(data) ? data.length + " rows; cols: " + Object.keys(data[0] ?? {}).join(",").slice(0,160) : "ok"}`); done = true; break; }
  }
  if (!done) { const { error } = await c.rpc(name, variants[0]); console.log(`  ✗ ${name}: ${error?.message.slice(0, 130)}`); }
}

// filter vocab on unified view
console.log("\n── FILTER VOCAB (unified_person_view) ──");
const { data: uv } = await c.from("unified_person_view").select("role_family,seniority_level,source,is_india,yoe").limit(2000);
const tally = (k) => { const o = {}; (uv ?? []).forEach((r) => { o[r[k] ?? "∅"] = (o[r[k] ?? "∅"] || 0) + 1; }); return Object.entries(o).sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x}:${n}`).join("  "); };
console.log("  role_family:", tally("role_family"));
console.log("  seniority:", tally("seniority_level"));
console.log("  source:", tally("source"));
const yoes = (uv ?? []).map((r) => r.yoe).filter((x) => x != null).sort((a, b) => a - b);
console.log("  yoe range:", yoes[0], "→", yoes[yoes.length - 1], "| median", yoes[Math.floor(yoes.length / 2)]);

// company tier flags available
console.log("\n── COMPANY SIGNAL FLAGS (companies_metadata) ──");
const { data: cm } = await c.from("companies_metadata").select("*").limit(1);
console.log("  ", Object.keys(cm?.[0] ?? {}).filter((k) => k.startsWith("is_")).join(", "));
