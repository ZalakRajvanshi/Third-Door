import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// real query embedding so similarity is meaningful
const res = await fetch((env.EMBEDDING_BASE_URL || "https://api.openai.com/v1") + "/embeddings", {
  method: "POST",
  headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
  body: JSON.stringify({ model: env.EMBEDDING_MODEL || "text-embedding-3-small", input: "senior growth product manager fintech bangalore" }),
});
const vec = (await res.json()).data[0].embedding;

const fns = ["match_binary", "match_luma", "match_yc", "match_ext", "match_apify"];
for (const fn of fns) {
  const params = { query_embedding: vec, match_count: 3 };
  if (fn === "match_binary" || fn === "match_luma" || fn === "match_yc") { params.only_india = false; params.min_years = null; }
  const { data, error } = await c.rpc(fn, params);
  if (error) console.log(`  ✗ ${fn}: ${error.message.slice(0, 90)}`);
  else console.log(`  ✓ ${fn}: ${data.length} rows; top sim ${data[0]?.similarity?.toFixed(3)} slug ${data[0]?.linkedin_slug?.slice(0, 30)}`);
}
