import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = l.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL, KEY = env.SUPABASE_SECRET_KEY;

// 1) PostgREST root lists every exposed table/view
const root = await fetch(`${SUPA}/rest/v1/`, { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` } });
const spec = await root.json();
const tables = Object.keys(spec.paths || {}).filter((p) => p !== "/" && !p.includes("{")).map((p) => p.slice(1));
console.log("TABLES / VIEWS:", tables.join(", ") || "(none found)");

const client = createClient(SUPA, KEY);
for (const t of tables) {
  try {
    const { data, count, error } = await client.from(t).select("*", { count: "exact", head: false }).limit(1);
    if (error) { console.log(`\n[${t}] error: ${error.message.slice(0, 80)}`); continue; }
    console.log(`\n[${t}] rows=${count}`);
    if (data && data[0]) console.log("  cols:", Object.keys(data[0]).join(", "));
  } catch (e) { console.log(`\n[${t}] ${String(e).slice(0, 80)}`); }
}
