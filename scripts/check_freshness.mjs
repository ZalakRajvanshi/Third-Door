import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { count: total } = await client.from("profiles").select("*", { count: "exact", head: true });
const { count: noEmb } = await client
  .from("profiles")
  .select("*", { count: "exact", head: true })
  .is("search_embedding", null);

console.log("Total profiles:        ", total);
console.log("Missing search_embedding:", noEmb, `(${((noEmb / total) * 100).toFixed(1)}%)`);

// Most recently added/updated, to see if new rows are arriving + whether they have embeddings
const { data: recent } = await client
  .from("profiles")
  .select("full_name, created_at, updated_at, search_embedding")
  .order("created_at", { ascending: false })
  .limit(5);
console.log("\nMost recent 5 by created_at:");
for (const r of recent ?? []) {
  console.log(`  ${r.created_at} | emb=${r.search_embedding ? "yes" : "NO "} | ${r.full_name}`);
}
