import { createClient } from "@supabase/supabase-js";

// ───────────────────────────────────────────────────────────────────────────
// search_learnings — real recruiter notes captured per role/company, e.g.
// "FSZT wants mid-level builders, not architects." When a search's JD clearly
// names a company we have notes on, we hand those notes to the AI ranker so it
// applies the exact lesson the team already learned. Matched by company mention
// only (precise), so it never adds noise to unrelated searches.
// ───────────────────────────────────────────────────────────────────────────

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

interface Learning { company: string; ncompany: string; title: string; type: string; text: string; }

let CACHE: Learning[] | null = null;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  if (!URL || !KEY) { CACHE = []; return; }
  try {
    const { data, error } = await createClient(URL, KEY)
      .from("search_learnings").select("role_company, role_title, learning_type, text").limit(500);
    if (error) { CACHE = []; return; }
    CACHE = (data as any[] ?? [])
      .filter((r) => r.role_company && r.text)
      .map((r) => ({ company: r.role_company, ncompany: norm(r.role_company), title: r.role_title ?? "", type: r.learning_type ?? "", text: String(r.text) }));
  } catch { CACHE = []; }
}

export function ensureLearnings(): Promise<void> {
  if (CACHE) return Promise.resolve();
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

/** Notes whose company is clearly named in the JD/brief text (precise match). Capped. */
export function relevantLearnings(text: string | null | undefined): string[] {
  if (!CACHE?.length || !text) return [];
  const t = norm(text);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const l of CACHE) {
    // match the full company name, or a distinctive token (≥4 chars, avoids tiny words like "co")
    const token = l.ncompany.split(" ").find((w) => w.length >= 4) ?? "";
    const hit = (l.ncompany.length >= 4 && t.includes(l.ncompany)) || (token && t.includes(token));
    if (!hit) continue;
    const line = `${l.company}${l.title ? ` (${l.title})` : ""}: ${l.text}`;
    const key = line.slice(0, 60);
    if (seen.has(key)) continue;
    seen.add(key); out.push(line);
    if (out.length >= 6) break;
  }
  return out;
}
