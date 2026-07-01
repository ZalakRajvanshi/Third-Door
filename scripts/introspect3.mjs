import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

async function distinct(col) {
  const { data } = await client.from("profiles").select(col).limit(3000);
  const counts = {};
  for (const r of data) {
    const v = r[col] ?? "∅";
    counts[v] = (counts[v] || 0) + 1;
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  console.log(`\n${col} (${sorted.length} distinct):`);
  for (const [v, c] of sorted.slice(0, 25)) console.log(`  ${String(v).padEnd(28)} ${c}`);
}

for (const col of ["role_family", "seniority_level", "ai_depth", "is_india", "primary_business_model"]) {
  await distinct(col);
}
