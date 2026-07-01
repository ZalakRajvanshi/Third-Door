import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
for (const t of ["profiles","luma_profiles","yc_employees","ext_profiles","apify_search_profiles"]) {
  const { error } = await c.from(t).select("id").limit(1);
  console.log(t, error ? "NO id ("+error.message.slice(0,40)+")" : "has id");
}
