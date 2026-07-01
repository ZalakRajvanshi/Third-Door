import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) { const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2]; }
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// 1) project_docs — likely the product idea / architecture
console.log("════ PROJECT DOCS ════");
const { data: docs } = await c.from("project_docs").select("doc_key,title,body_md");
for (const d of docs ?? []) console.log(`\n## ${d.doc_key} — ${d.title}\n${(d.body_md || "").slice(0, 1400)}`);

// 2) unified_person_view
console.log("\n\n════ unified_person_view ════");
const { data: uv, count: uc, error: ue } = await c.from("unified_person_view").select("*", { count: "exact" }).limit(1);
if (ue) console.log("err:", ue.message); else { console.log("rows:", uc); console.log("cols:", Object.keys(uv?.[0] ?? {}).join(", ")); }

// 3) company tiers vocabulary
console.log("\n════ company tiers ════");
const { data: ct } = await c.from("companies_metadata").select("tier").limit(2000);
const tc = {}; (ct ?? []).forEach((r) => { tc[r.tier ?? "∅"] = (tc[r.tier ?? "∅"] || 0) + 1; });
console.log(Object.entries(tc).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join("  "));

// 4) probe the search RPCs (learn signatures via errors)
console.log("\n════ RPC probes ════");
for (const [name, args] of [
  ["search_profiles_hybrid", { query: "growth manager", match_count: 3 }],
  ["search_profiles_v5_fts_v3", { q: "growth manager", limit_n: 3 }],
  ["domain_match_candidates", { query: "growth", match_count: 3 }],
]) {
  const { data, error } = await c.rpc(name, args);
  if (error) console.log(`✗ ${name}: ${error.message.slice(0, 140)}`);
  else console.log(`✓ ${name}: ${Array.isArray(data) ? data.length + " rows; cols: " + Object.keys(data[0] ?? {}).slice(0, 14).join(",") : "ok"}`);
}
