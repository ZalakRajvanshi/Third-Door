import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data, error, count } = await c.from("search_events").select("event,name,company,tier,domains", { count: "exact" }).order("created_at", { ascending: false }).limit(5);
if (error) console.log("ERROR:", error.message);
else { console.log("total events:", count); data.forEach(r => console.log(" ", r.event, "|", r.name, "@", r.company, "| tier:", r.tier, "| domains:", (r.domains||[]).join(","))); }
