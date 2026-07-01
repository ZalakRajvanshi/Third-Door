import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// grab a few facet rows per source, then see if profile_id matches the pool table's id (and get slug)
const poolTable = { binary: "profiles", luma: "luma_profiles", yc: "yc_employees", ext: "ext_profiles", apify: "apify_search_profiles" };
const { data: facets } = await c.from("profile_facets").select("source, profile_id, growth_pm_signal, ai_pm_signal, is_0to1_shipper, iit_or_iim, inferred_ctc_band").limit(30);
const bySource = {};
for (const f of facets) (bySource[f.source] ||= []).push(f);
for (const [src, rows] of Object.entries(bySource)) {
  const tbl = poolTable[src]; if (!tbl) { console.log(src, "-> no pool mapping"); continue; }
  const f = rows[0];
  const { data: match, error } = await c.from(tbl).select("id, linkedin_slug").eq("id", f.profile_id).limit(1);
  console.log(`source=${src} facet.profile_id=${f.profile_id.slice(0,8)}… -> ${tbl}:`, error ? "ERR "+error.message.slice(0,40) : (match?.length ? `MATCH slug=${match[0].linkedin_slug}` : "no match"));
  console.log(`   signals: growth_pm=${f.growth_pm_signal} ai_pm=${f.ai_pm_signal} 0to1=${f.is_0to1_shipper} iit_iim=${f.iit_or_iim} ctc=${f.inferred_ctc_band}`);
}
