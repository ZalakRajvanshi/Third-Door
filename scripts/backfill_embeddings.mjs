// Keeps semantic search in sync across ALL FIVE pools.
// For each table, finds profiles still missing a search_embedding, generates one from
// the profile's text, and writes it back. Safe to run repeatedly — it only touches rows
// that still lack an embedding, so it's both the one-time catch-up AND the hourly sync.
//
// Run:  node scripts/backfill_embeddings.mjs            (all pools)
//       node scripts/backfill_embeddings.mjs luma yc    (only named pools)
// Cron it hourly to stay continuously in sync after the first full run.
//
// Prereq: run supabase/semantic_setup.sql once (adds the columns + indexes).

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}

const client = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const EMBED_URL = (env.EMBEDDING_BASE_URL || "https://api.openai.com/v1") + "/embeddings";
const MODEL = env.EMBEDDING_MODEL || "text-embedding-3-small";
const BATCH = 100;

if (!env.EMBEDDING_API_KEY) {
  console.error("EMBEDDING_API_KEY not set — cannot embed. Add it to .env.local.");
  process.exit(1);
}

// Per-pool: which key column to update by, and which text columns make a profile findable.
const POOLS = {
  profiles: {
    key: "linkedin_slug",
    sel: "linkedin_slug, full_name, search_summary, one_liner, current_title, current_company",
    text: (p) => [p.search_summary, p.one_liner, p.current_title, p.current_company, p.full_name],
  },
  luma_profiles: {
    key: "linkedin_slug",
    sel: "linkedin_slug, full_name, career_summary, designation, company, title_role",
    text: (p) => [p.career_summary, p.designation, p.title_role, p.company, p.full_name],
  },
  yc_employees: {
    key: "linkedin_slug",
    sel: "linkedin_slug, full_name, career_summary, current_title, current_company_name, role_family",
    text: (p) => [p.career_summary, p.current_title, p.role_family, p.current_company_name, p.full_name],
  },
  ext_profiles: {
    key: "linkedin_slug",
    sel: "linkedin_slug, full_name, about, designation, company, inferred_role",
    text: (p) => [p.about, p.designation, p.inferred_role, p.company, p.full_name],
  },
  apify_search_profiles: {
    key: "linkedin_slug",
    sel: "linkedin_slug, full_name, about, designation, company, inferred_role",
    text: (p) => [p.about, p.designation, p.inferred_role, p.company, p.full_name],
  },
};

function textFor(cfg, p) {
  return cfg.text(p).filter(Boolean).join(" — ").slice(0, 6000) || p.full_name || "profile";
}

async function embedBatch(texts) {
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.EMBEDDING_API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).data.map((d) => d.embedding);
}

async function backfillPool(table) {
  const cfg = POOLS[table];
  if (!cfg) { console.error(`unknown pool: ${table}`); return; }
  let done = 0;
  for (;;) {
    const { data: rows, error } = await client
      .from(table)
      .select(cfg.sel)
      .is("search_embedding", null)
      .not(cfg.key, "is", null)
      .limit(BATCH);
    if (error) { console.error(`[${table}] ${error.message}`); return; }
    if (!rows || rows.length === 0) break;

    const vectors = await embedBatch(rows.map((r) => textFor(cfg, r)));
    await Promise.all(
      rows.map((r, i) =>
        client.from(table).update({ search_embedding: `[${vectors[i].join(",")}]` }).eq(cfg.key, r[cfg.key])
      )
    );
    done += rows.length;
    process.stdout.write(`\r[${table}] embedded ${done}…`);
  }
  console.log(`\r[${table}] ✓ ${done} newly embedded.${" ".repeat(20)}`);
  return done;
}

const targets = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(POOLS);
let total = 0;
for (const t of targets) total += (await backfillPool(t)) || 0;
console.log(`\n✓ Done. ${total} profiles embedded across ${targets.length} pool(s). Semantic search in sync.`);
