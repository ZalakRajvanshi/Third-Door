import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// Ongoing embedding sync. Embeds a capped batch of profiles that still lack a vector,
// across all pools, then returns how many it did. Hit it on a schedule (Vercel Cron,
// GitHub Action, or any cron) to keep semantic search current as new profiles arrive.
//
//   GET /api/cron/embed?key=$CRON_SECRET            (default cap)
//   GET /api/cron/embed?key=$CRON_SECRET&limit=300
//
// Fails safe: pools whose embedding column doesn't exist yet are skipped silently.

export const maxDuration = 60;

const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const EMBED_KEY = process.env.EMBEDDING_API_KEY || process.env.AI_API_KEY;
const EMBED_URL = (process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const EMBED_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

const POOLS = [
  { table: "profiles", sel: "linkedin_slug, full_name, search_summary, one_liner, current_title, current_company", text: (p: any) => [p.search_summary, p.one_liner, p.current_title, p.current_company, p.full_name] },
  { table: "luma_profiles", sel: "linkedin_slug, full_name, career_summary, designation, company, title_role", text: (p: any) => [p.career_summary, p.designation, p.title_role, p.company, p.full_name] },
  { table: "yc_employees", sel: "linkedin_slug, full_name, career_summary, current_title, current_company_name, role_family", text: (p: any) => [p.career_summary, p.current_title, p.role_family, p.current_company_name, p.full_name] },
  { table: "ext_profiles", sel: "linkedin_slug, full_name, about, designation, company, inferred_role", text: (p: any) => [p.about, p.designation, p.inferred_role, p.company, p.full_name] },
  { table: "apify_search_profiles", sel: "linkedin_slug, full_name, about, designation, company, inferred_role", text: (p: any) => [p.about, p.designation, p.inferred_role, p.company, p.full_name] },
];

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBED_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts }),
  });
  if (!res.ok) throw new Error(`embeddings ${res.status}`);
  return (await res.json()).data.map((d: any) => d.embedding);
}

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const key = new URL(req.url).searchParams.get("key");
  if (secret && key !== secret) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!URL_ || !KEY || !EMBED_KEY) return NextResponse.json({ error: "not configured" }, { status: 500 });

  const cap = Math.min(500, Number(new URL(req.url).searchParams.get("limit")) || 200);
  const client = createClient(URL_, KEY);
  const out: Record<string, number> = {};
  let budget = cap;

  for (const pool of POOLS) {
    if (budget <= 0) break;
    try {
      const { data: rows, error } = await client
        .from(pool.table).select(pool.sel)
        .is("search_embedding", null).not("linkedin_slug", "is", null)
        .limit(Math.min(100, budget));
      if (error || !rows?.length) continue; // column missing or nothing to do → skip
      const vectors = await embedBatch(rows.map((r: any) => (pool.text(r).filter(Boolean).join(" — ").slice(0, 6000) || r.full_name || "profile")));
      await Promise.all(rows.map((r: any, i: number) =>
        client.from(pool.table).update({ search_embedding: `[${vectors[i].join(",")}]` }).eq("linkedin_slug", r.linkedin_slug)
      ));
      out[pool.table] = rows.length;
      budget -= rows.length;
    } catch (e) {
      console.error(`[cron/embed] ${pool.table}:`, e);
    }
  }

  const embedded = Object.values(out).reduce((a, b) => a + b, 0);
  return NextResponse.json({ embedded, byPool: out });
}
