import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

const { data } = await client
  .from("profiles")
  .select("full_name, current_title, parsed_json, search_embedding, role_family, seniority_level, ai_depth")
  .limit(3);

for (const row of data) {
  console.log("―――", row.full_name, "|", row.current_title, "―――");
  const pj = row.parsed_json || {};
  console.log("parsed_json keys:", Object.keys(pj).join(", "));
  console.log("  skills:", JSON.stringify(pj.skills)?.slice(0, 300));
  console.log("  experience sample:", JSON.stringify(pj.experience ?? pj.work ?? pj.work_experience)?.slice(0, 300));
  const emb = row.search_embedding;
  const embArr = typeof emb === "string" ? JSON.parse(emb) : emb;
  console.log("  search_embedding: type", typeof emb, "| dims:", Array.isArray(embArr) ? embArr.length : "n/a");
  console.log("");
}

// Check whether a vector match RPC exists
const { error: rpcErr } = await client.rpc("match_profiles", { query_embedding: [], match_count: 1 });
console.log("match_profiles RPC:", rpcErr ? "NOT FOUND (" + rpcErr.message.slice(0, 80) + ")" : "exists");
