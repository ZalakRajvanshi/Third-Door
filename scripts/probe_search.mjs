import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// Probe each search RPC with several arg shapes; print full errors to learn signatures.
const RPCS = {
  search_profiles_hybrid: [{ query_text: "growth manager", match_count: 3 }, { q: "growth manager" }, { search_query: "growth manager", limit_count: 3 }],
  search_profiles_v5_fts_v3: [{ query_text: "growth manager", limit_count: 3 }, { q: "growth manager" }, { search_text: "growth manager" }],
  domain_match_candidates: [{ query_text: "fintech growth", match_count: 3 }, { domain: "fintech" }],
};
for (const [name, variants] of Object.entries(RPCS)) {
  for (const args of variants) {
    const { data, error } = await c.rpc(name, args);
    if (!error) { console.log(`✓ ${name}(${Object.keys(args).join(",")}) → ${Array.isArray(data) ? data.length + " rows; cols: " + Object.keys(data[0] ?? {}).join(",") : "ok"}`); break; }
    else console.log(`✗ ${name}(${Object.keys(args).join(",")}): ${error.message.slice(0, 120)}`);
  }
}

// facets join + tier1 signals
console.log("\n── profile_facets sample (key signals) ──");
const { data: f } = await c.from("profile_facets").select("source,profile_id,worked_at_faang,worked_at_unicorn,worked_at_big4,growth_pm_signal,iit_or_iim,inferred_ctc_band,skills_extracted").limit(2);
console.log(JSON.stringify(f, null, 1)?.slice(0, 700));

// unified view: role_family + seniority vocab + yoe
console.log("\n── unified_person_view role_family / seniority ──");
const { data: uv } = await c.from("unified_person_view").select("role_family,seniority_level,yoe").limit(1500);
const rf = {}, sl = {}; (uv ?? []).forEach((r) => { rf[r.role_family ?? "∅"] = (rf[r.role_family ?? "∅"] || 0) + 1; sl[r.seniority_level ?? "∅"] = (sl[r.seniority_level ?? "∅"] || 0) + 1; });
console.log("role_family:", Object.entries(rf).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "));
console.log("seniority:", Object.entries(sl).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "));
