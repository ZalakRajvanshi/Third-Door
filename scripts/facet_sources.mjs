import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data } = await c.from("profile_facets").select("source").limit(5000);
const counts = {};
for (const r of data) counts[r.source] = (counts[r.source]||0)+1;
console.log("facet source distribution (first 5000):", JSON.stringify(counts));
