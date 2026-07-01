import { createClient } from "@supabase/supabase-js";
import type { Person } from "@/lib/types";

// ───────────────────────────────────────────────────────────────────────────
// Learning loop + OUTCOME learning.
//   • logEvent()          — record behaviour (open/save/contact) AND real outcomes
//                           (shortlist/interview/hire/reject + reason).
//   • ensurePreferences() — build an OUTCOME-WEIGHTED taste profile: a hire counts far
//                           more than a save; a reject builds a negative signal.
//   • prefBoost()         — lifts candidates like the team's wins, pushes down ones like
//                           its rejects. So ranking gets more accurate the more you use it.
// Fails safe: no table / no data → everything no-ops.
// ───────────────────────────────────────────────────────────────────────────

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const db = () => createClient(URL!, KEY!);
const lc = (s: unknown) => String(s ?? "").toLowerCase().trim();

export type EventType = "open" | "save" | "unsave" | "contact" | "shortlist" | "interview" | "hire" | "reject";
// how much each positive signal counts; a hire is worth far more than a save
const WEIGHT: Record<string, number> = { save: 1, contact: 1, shortlist: 2, interview: 3, hire: 5 };

export interface FeedbackEvent {
  event: EventType;
  person_id?: string; name?: string; company?: string;
  role_family?: string; domains?: string[]; tier?: string; query?: string; reason?: string;
}

/** Record one behaviour/outcome event. Fire-and-forget; never throws into the request path. */
export async function logEvent(e: FeedbackEvent): Promise<void> {
  if (!URL || !KEY || !e?.event) return;
  const row: Record<string, unknown> = {
    event: e.event, person_id: e.person_id ?? null, name: e.name ?? null,
    company: e.company ?? null, role_family: e.role_family ?? null,
    domains: e.domains ?? null, tier: e.tier ?? null, query: e.query?.slice(0, 300) ?? null,
  };
  // only reference `reason` when there is one — so events still store before outcomes.sql adds the column
  if (e.reason) row.reason = e.reason.slice(0, 300);
  try {
    const { error } = await db().from("search_events").insert(row);
    // if the reason column is missing, retry without it so the outcome still records
    if (error && "reason" in row) { delete row.reason; await db().from("search_events").insert(row); }
  } catch { /* table not created yet, or transient — ignore */ }
}

// ── outcome-weighted preferences (refreshed at most once a minute) ───────────
interface Prefs {
  pos: { companies: Map<string, number>; domains: Map<string, number>; families: Map<string, number> };
  neg: { companies: Set<string>; domains: Set<string> };
  loadedAt: number;
}
let PREFS: Prefs = { pos: { companies: new Map(), domains: new Map(), families: new Map() }, neg: { companies: new Set(), domains: new Set() }, loadedAt: 0 };
const TTL = 60_000;

export async function ensurePreferences(): Promise<void> {
  if (!URL || !KEY) return;
  if (Date.now() - PREFS.loadedAt < TTL) return;
  try {
    const { data, error } = await db()
      .from("search_events")
      .select("event, company, domains, role_family")
      .in("event", ["save", "contact", "shortlist", "interview", "hire", "reject"])
      .order("created_at", { ascending: false })
      .limit(600);
    if (error) { PREFS.loadedAt = Date.now(); return; }
    const pos = { companies: new Map<string, number>(), domains: new Map<string, number>(), families: new Map<string, number>() };
    const neg = { companies: new Set<string>(), domains: new Set<string>() };
    const bump = (m: Map<string, number>, k: string, w: number) => m.set(k, (m.get(k) ?? 0) + w);
    for (const r of (data as any[]) ?? []) {
      if (r.event === "reject") {
        if (r.company) neg.companies.add(lc(r.company));
        for (const d of (r.domains ?? [])) neg.domains.add(lc(d));
        continue;
      }
      const w = WEIGHT[r.event] ?? 1;
      if (r.company) bump(pos.companies, lc(r.company), w);
      for (const d of (r.domains ?? [])) bump(pos.domains, lc(d), w);
      if (r.role_family) bump(pos.families, lc(r.role_family), w);
    }
    PREFS = { pos, neg, loadedAt: Date.now() };
  } catch { PREFS.loadedAt = Date.now(); }
}

/** Lift for people like the team's wins (weighted), penalty for people like its rejects. */
export function prefBoost(p: Person): number {
  const { pos, neg } = PREFS;
  if (!pos.companies.size && !pos.domains.size && !neg.companies.size) return 0;
  const d = (p.dossier ?? {}) as any;
  const co = lc(p.company);
  const doms: string[] = (d.domains ?? []).map(lc);
  let b = 0;
  if (co && pos.companies.has(co)) b += Math.min(6, 2 + pos.companies.get(co)!); // company the team pursues
  if (doms.some((x) => (pos.domains.get(x) ?? 0) > 0)) b += 3;
  const fam = lc(d.roleFamily);
  if (fam && (pos.families.get(fam) ?? 0) > 0) b += 1;
  if (co && neg.companies.has(co)) b -= 5;                                        // like a past reject
  if (doms.some((x) => neg.domains.has(x))) b -= 2;
  return Math.max(-8, Math.min(12, b));
}
