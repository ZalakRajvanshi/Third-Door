import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local manually (no dependency on dotenv)
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data, error, count } = await client.from("profiles").select("*", { count: "exact" }).limit(2);

if (error) {
  console.log("ERROR:", error.message);
} else {
  console.log("TOTAL ROWS:", count);
  console.log("COLUMNS:", Object.keys(data[0] ?? {}).join(", "));
  console.log("\nSAMPLE ROW 1:\n", JSON.stringify(data[0], null, 2));
}
