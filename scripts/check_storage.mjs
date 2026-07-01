import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

// 1) list storage buckets
const { data: buckets, error: bErr } = await client.storage.listBuckets();
console.log("BUCKETS:", bErr ? bErr.message : buckets.map((b) => `${b.name} (public=${b.public})`).join(", ") || "none");

// 2) for each bucket, list a few files
for (const b of buckets ?? []) {
  const { data: files } = await client.storage.from(b.name).list("", { limit: 8 });
  console.log(`\n[${b.name}] files:`, (files ?? []).map((f) => f.name).join(", ") || "(empty at root)");
  // try nested folders
  for (const f of (files ?? []).filter((x) => !x.metadata)) {
    const { data: sub } = await client.storage.from(b.name).list(f.name, { limit: 5 });
    console.log(`  ${f.name}/`, (sub ?? []).map((s) => s.name).join(", "));
  }
}

// 3) what does the profiles row reference for the file?
const { data: rows } = await client.from("profiles").select("email, source_file, source, portfolio_url").limit(3);
console.log("\nPROFILE FILE REFS:");
for (const r of rows ?? []) console.log(" ", JSON.stringify(r));
