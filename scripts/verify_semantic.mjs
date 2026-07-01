import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const q = "Senior AI engineers in India with LLM and agent experience";
console.log("Query:", q, "\n");

// 1) Embed via OpenAI
const er = await fetch((env.EMBEDDING_BASE_URL || "https://api.openai.com/v1") + "/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
  body: JSON.stringify({ model: env.EMBEDDING_MODEL || "text-embedding-3-small", input: q }),
});
if (!er.ok) {
  console.log("EMBED ERROR:", er.status, (await er.text()).slice(0, 200));
  process.exit(1);
}
const vec = (await er.json()).data[0].embedding;
console.log("✓ embedded:", vec.length, "dims\n");

// 2) Call the fixed RPC
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data, error } = await client.rpc("match_profiles", { query_embedding: vec, match_count: 8 });
if (error) {
  console.log("RPC ERROR:", error.message);
  process.exit(1);
}
console.log("✓ match_profiles returned", data.length, "rows:\n");
for (const r of data) {
  console.log(
    `  ${(r.similarity ?? 0).toFixed(3)} | ${r.full_name} | ${r.current_title ?? "?"} | ${r.location_city ?? "?"} | india=${r.is_india}`
  );
}
