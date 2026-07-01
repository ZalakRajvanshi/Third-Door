import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data, error } = await c
  .from("profiles")
  .select("full_name, current_title, current_company, search_embedding")
  .not("search_embedding", "is", null)
  .limit(5);

if (error) { console.log("ERROR:", error.message); process.exit(1); }

for (const p of data) {
  // pgvector returns the embedding as a string like "[0.013,-0.21,...]"
  const nums = JSON.parse(p.search_embedding);
  const first8 = nums.slice(0, 8).map((n) => n.toFixed(4)).join(", ");
  console.log(`\n${p.full_name} — ${p.current_title} @ ${p.current_company}`);
  console.log(`  embedding: [${first8}, … ] (${nums.length} numbers total)`);
}
