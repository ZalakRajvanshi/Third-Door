import type { Person, RankedPerson, StructuredQuery } from "@/lib/types";
import { supabaseAdapter } from "@/lib/sources/supabase";
import { apifyAdapter, hasApify } from "@/lib/sources/apify";
import { parseIntent, heuristicQuery } from "@/lib/intent";
import { rankPeople } from "@/lib/rank";
import { preRank, businessScore } from "@/lib/score";
import { ensureCompanies } from "@/lib/companies";
import { ensurePreferences } from "@/lib/learning";
import { ensureLearnings } from "@/lib/learnings";
import { COST } from "@/lib/config";
import { cacheKey, cacheGet, cacheSet, singleFlight } from "@/lib/cache";

// Orchestrator = a cost funnel: CACHE → DATABASE → AI RANK → (APIFY only if needed).
// We never pay for Apify when the database already has enough strong matches.

export interface SearchResult {
  query: StructuredQuery;
  results: RankedPerson[];
  meta: { found: number; afterDedupe: number; usedApify: boolean; cached: boolean };
}

/** Identity resolution: merge by social URL, else name+company — never by a blank key. */
function dedupe(people: Person[]): Person[] {
  const byKey = new Map<string, Person>();
  for (const p of people) {
    const social = p.social_links.map((s) => s.url.toLowerCase()).sort()[0];
    const named = p.name && p.name !== "Unknown" ? `${p.name.toLowerCase()}|${(p.company ?? "").toLowerCase()}` : null;
    const key = social ?? named ?? p.id;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, p);
    } else {
      const winner = p.profile_strength > existing.profile_strength ? p : existing;
      winner._sources = [...existing._sources, ...p._sources];
      byKey.set(key, winner);
    }
  }
  return Array.from(byKey.values());
}

function trim(ranked: RankedPerson[]): RankedPerson[] {
  // Hard relevance gate: only return matches at/above the floor. Better to show fewer
  // (or none) than to surface an irrelevant profile.
  return ranked.filter((r) => r.score >= COST.MIN_SHOW_SCORE);
}

/**
 * Assemble the final list = AI-vetted top tier + a "more relevant" tail.
 *  • vetted: the AI-ranked top, gated by MIN_SHOW_SCORE (full reasoning).
 *  • tail:   relevant people the AI didn't see (beyond the rank batch), business-scored
 *            with factual reasons — NO extra AI cost. Gated by TAIL_MIN_SCORE so it's
 *            never junk. This is how a search with lots of good data shows depth.
 * Honors an explicit count (query.wantCount); otherwise shows all relevant up to a cap.
 */
function assemble(preRanked: Person[], aiRanked: RankedPerson[], q: StructuredQuery): RankedPerson[] {
  const vetted = trim(aiRanked).map((r) => ({ ...r, vetted: true }));
  const seenByAi = new Set(aiRanked.map((r) => r.person.id)); // everyone the AI scored (incl. trimmed)
  const tail = preRanked
    .filter((p) => !seenByAi.has(p.id))
    .map((p) => ({ ...quickRank(p, q), vetted: false }))
    .filter((r) => r.score >= COST.TAIL_MIN_SCORE);
  const all = [...vetted, ...tail];
  const limit = q.wantCount && q.wantCount > 0 ? q.wantCount : COST.MAX_TOTAL_SHOWN;
  return all.slice(0, limit);
}

export interface SearchInput { q?: string; jd?: string; note?: string; }

/** Build the texts the pipeline needs from a raw string OR a {jd, note, q} input.
 *  - intentText  : what the intent engine reads (note emphasised, then the JD)
 *  - embedText   : what we embed for semantic search (the full JD when present)
 *  - displayBrief: a SHORT label for the UI + the ranker (keeps rank token cost low) */
function shapeInput(input: string | SearchInput) {
  const { q = "", jd = "", note = "" } = typeof input === "string" ? { q: input } : input;
  const jdT = jd.trim(), noteT = note.trim(), qT = q.trim();
  const intentText = jdT
    ? (noteT ? `${noteT}\n\nJOB DESCRIPTION:\n${jdT}` : jdT)
    : [noteT, qT].filter(Boolean).join(" ").trim();
  const embedText = jdT || qT || noteT;
  const displayBrief = (noteT || qT || jdT.split("\n").find((l) => l.trim())?.slice(0, 120) || jdT.slice(0, 120)).trim();
  return { intentText, embedText, displayBrief, noteT, hasJd: Boolean(jdT) };
}

const prettyFamily = (f: string) => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

/** A clean role summary from the parsed JD — used as the brief for ranking AND the UI
 *  label. For a JD this beats the raw first line ("About the role…"). */
function synthBrief(q: StructuredQuery, note: string, fallback: string): string {
  const role = q.roles[0] || (q.roleFamilies[0] ? prettyFamily(q.roleFamilies[0]) : "");
  const parts = [
    role,
    q.seniority.some((s) => /senior|lead|staff|leadership/.test(s)) && !/senior|lead|head|vp|director/i.test(role) ? "Senior" : "",
    q.yoeMin != null ? `${q.yoeMin}+ yrs` : "",
    q.companyTier.length ? "Tier-1" : "",
    q.domains.slice(0, 2).join("/"),
    q.locations.slice(0, 1).join(""),
  ].filter(Boolean);
  let s = parts.join(" · ");
  if (note) s = s ? `${s} — ${note}` : note;
  return s || fallback;
}

export async function runSearch(input: string | SearchInput): Promise<SearchResult> {
  const { intentText, embedText, displayBrief, noteT, hasJd } = shapeInput(input);
  if (!intentText) throw new Error("Empty search input");

  // ── Step 1: CACHE (free) ── key off all inputs so JD+note variants don't collide
  const key = cacheKey(`${hasJd ? "jd:" : ""}${displayBrief}::${embedText.slice(0, 400)}`);
  const cached = await cacheGet<SearchResult>(key);
  if (cached) return { ...cached, meta: { ...cached.meta, cached: true } };

  // Single-flight: concurrent identical queries share ONE computation (and one OpenAI spend).
  return singleFlight(key, async () => {
    // a late-arriving caller may find it cached now
    const recheck = await cacheGet<SearchResult>(key);
    if (recheck) return { ...recheck, meta: { ...recheck.meta, cached: true } };

    const t = (() => { const s = Date.now(); return () => Date.now() - s; })();
    const lap: Record<string, number> = {};
    const mark = (name: string, from: number) => { lap[name] = Date.now() - from; };

    const companiesReady = Promise.all([ensureCompanies(), ensurePreferences(), ensureLearnings()]); // context + learned prefs + notes

    let s = Date.now();
    const query = await parseIntent(intentText);
    // semantic embeds the full JD; rank/UI use a synthesized role brief (token-cheap, clean)
    query.embedText = embedText;
    query.raw = synthBrief(query, noteT, displayBrief);
    mark("intent", s);

    // ── Step 2: DATABASE (cheap) — always first ──
    s = Date.now();
    const dbPeople = dedupe(await supabaseAdapter.search(query));
    mark("retrieve", s);

    // ── Stage 4: weighted business score picks who's worth (token-costly) AI ranking ──
    s = Date.now();
    await companiesReady; // company intelligence in memory before we score
    let preRanked = preRank(dbPeople, query);
    let ranked = await rankPeople(preRanked.slice(0, COST.MAX_RANK_CANDIDATES), query);
    mark("rank", s);
    let strong = ranked.filter((r) => r.score >= COST.STRONG_SCORE);

    let usedApify = false;
    let totalFound = dbPeople.length;
    let dedupeCount = dbPeople.length;

    // ── Step 3: APIFY (expensive) — ONLY if the DB couldn't supply enough strong matches ──
    if (strong.length < COST.MIN_STRONG_RESULTS && hasApify) {
      const external = await apifyAdapter.search(query);
      if (external.length) {
        usedApify = true;
        const combined = dedupe([...dbPeople, ...external]);
        totalFound = dbPeople.length + external.length;
        dedupeCount = combined.length;
        preRanked = preRank(combined, query);
        ranked = await rankPeople(preRanked.slice(0, COST.MAX_RANK_CANDIDATES), query);
        strong = ranked.filter((r) => r.score >= COST.STRONG_SCORE);
      }
    }

    const result: SearchResult = {
      query,
      results: assemble(preRanked, ranked, query),
      meta: { found: totalFound, afterDedupe: dedupeCount, usedApify, cached: false },
    };

    // observability: per-stage timing (set COST.LOG_TIMING=false to silence)
    if (COST.LOG_TIMING) console.log(`[search] ${hasJd ? "[JD] " : ""}"${displayBrief.slice(0, 50)}" ${t()}ms total — intent ${lap.intent ?? 0} · retrieve ${lap.retrieve ?? 0} · rank ${lap.rank ?? 0} · ${dedupeCount} candidates · ${result.results.length} shown${usedApify ? " · +apify" : ""}`);

    await cacheSet(key, result);
    return result;
  });
}

// ── Progressive (streaming) search ───────────────────────────────────────────
// Emits a fast PRELIMINARY shortlist (instant heuristic intent → keyword retrieve →
// business score) so the user sees relevant people in ~1–2s, then a FINAL event with
// the full OpenAI-ranked results + reasons. Same cost as a normal search (one rank call).

export type ProgressEvent =
  | { type: "preliminary"; results: RankedPerson[]; query: StructuredQuery }
  | { type: "final"; results: RankedPerson[]; query: StructuredQuery; meta: SearchResult["meta"] }
  | { type: "error"; error: string };

/** Cheap RankedPerson from the business score — no LLM. Used for the instant preview. */
function quickRank(p: Person, q: StructuredQuery): RankedPerson {
  const d = (p.dossier ?? {}) as any;
  const bits: string[] = [];
  if (typeof d.years === "number") bits.push(`${d.years} yrs`);
  if (p.company) bits.push(p.company);
  if (Array.isArray(d.flags) && d.flags[0]) bits.push(d.flags[0]);
  return { person: p, score: businessScore(p, q).total, why: bits.length ? [bits.join(" · ")] : ["Strong match on role and skills"], concerns: [] };
}

export async function runSearchProgressive(input: string | SearchInput, emit: (e: ProgressEvent) => void): Promise<void> {
  const { intentText, embedText, displayBrief, noteT, hasJd } = shapeInput(input);
  if (!intentText) { emit({ type: "error", error: "Empty search input" }); return; }

  const key = cacheKey(`${hasJd ? "jd:" : ""}${displayBrief}::${embedText.slice(0, 400)}`);
  const cached = await cacheGet<SearchResult>(key);
  if (cached) { emit({ type: "final", results: cached.results, query: cached.query, meta: { ...cached.meta, cached: true } }); return; }

  // ── PRELIMINARY: instant heuristic intent → keyword retrieve → business score ──
  // Emit this FIRST — don't wait on the heavy company/prefs/learnings loads (that's what
  // made the preview slow on cold serverless). Preview uses hardcoded tier fallback; the
  // final pass below loads the full context.
  try {
    const hq = heuristicQuery(intentText);
    hq.embedText = embedText; // preview runs semantic too, so relevant people show from the start
    const prelimPeople = dedupe(await supabaseAdapter.search(hq));
    const top = preRank(prelimPeople, hq).slice(0, 16).map((p) => quickRank(p, hq));
    if (top.length) emit({ type: "preliminary", results: top, query: { ...hq, raw: displayBrief } });
  } catch (e) { console.error("[progressive] preview failed:", e); }

  await Promise.all([ensureCompanies(), ensurePreferences(), ensureLearnings()]); // full context for the final

  // ── FINAL: real intent → retrieve(+semantic) → AI rank ──
  try {
    const query = await parseIntent(intentText);
    query.embedText = embedText;
    query.raw = synthBrief(query, noteT, displayBrief);

    const dbPeople = dedupe(await supabaseAdapter.search(query));
    let preRanked = preRank(dbPeople, query);
    let ranked = await rankPeople(preRanked.slice(0, COST.MAX_RANK_CANDIDATES), query);
    let strong = ranked.filter((r) => r.score >= COST.STRONG_SCORE);
    let usedApify = false, totalFound = dbPeople.length, dedupeCount = dbPeople.length;

    if (strong.length < COST.MIN_STRONG_RESULTS && hasApify) {
      const external = await apifyAdapter.search(query);
      if (external.length) {
        usedApify = true;
        const combined = dedupe([...dbPeople, ...external]);
        totalFound = dbPeople.length + external.length; dedupeCount = combined.length;
        preRanked = preRank(combined, query);
        ranked = await rankPeople(preRanked.slice(0, COST.MAX_RANK_CANDIDATES), query);
      }
    }

    const result: SearchResult = { query, results: assemble(preRanked, ranked, query), meta: { found: totalFound, afterDedupe: dedupeCount, usedApify, cached: false } };
    emit({ type: "final", results: result.results, query: result.query, meta: result.meta });
    await cacheSet(key, result);
  } catch (e) {
    console.error("[progressive] final failed:", e);
    emit({ type: "error", error: "Search failed" });
  }
}
