import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data } = await c.from("search_learnings").select("role_company, role_title, learning_type, text").limit(500);
const byCo = {};
for (const r of data) (byCo[r.role_company] ||= []).push(r);
console.log("companies with learnings:", Object.keys(byCo).length);
for (const [co, rows] of Object.entries(byCo)) {
  console.log(`\n${co} (${rows[0].role_title}) — ${rows.length} notes`);
  console.log("   e.g.:", rows[0].text.slice(0, 130));
}
