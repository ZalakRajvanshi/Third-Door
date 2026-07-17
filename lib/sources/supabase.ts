import { createClient } from "@supabase/supabase-js";
import type { Person, SourceAdapter, StructuredQuery } from "@/lib/types";
import { expandTerms, meetsTier, cityVariants } from "@/lib/knowledge";
import { embedMany, hasEmbeddings } from "@/lib/ai";
import { COST } from "@/lib/config";

// Internal source — searches ALL FIVE candidate pools (≈48k deduped) and merges them:
//   binary (profiles) · luma (luma_profiles) · yc (yc_employees) · ext (ext_profiles) · apify (apify_search_profiles)
// Each pool has a different schema, so we map common filters (role, yoe, location, keyword)
// onto each table's own columns, normalize to one Person shape, and dedupe by LinkedIn slug.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;
const hasSupabase = Boolean(URL && KEY);
const db = () => createClient(URL!, KEY!);
const safe = (t: string) => t.replace(/[,%()*]/g, " ").trim().toLowerCase();

interface SrcCfg {
  label: string; table: string; sel: string; limit?: number;
  m: {
    name: string; title: string; company?: string; city?: string; india?: string; yoe?: string;
    roleFamily?: string; roleText?: string; domains?: string; slug: string; one?: string;
    summary?: string; about?: string; skills?: string; ctc?: string;
    /** FULL searchable text (resume / searchable_text). SEARCHED but never SELECTED — it's
     *  multi-KB per row, so pulling it would balloon the payload. This is where the real
     *  evidence lives ("owned UPI reconciliation"), which short summary fields never carry. */
    full?: string;
    /** True when `full` already CONTAINS the small columns (luma/yc `searchable_text` embeds
     *  name + designation + company + the whole dated career history). Then we search that ONE
     *  column instead of OR-ing four — strictly better recall, and only one index needed. */
    fullIsSuperset?: boolean;
    /** seniority column (vocab differs per pool — normalised via the ladder in score.ts) */
    sen?: string;
    /** text[] of EVERY company worked at (current + past) — the documented 4x recall lift */
    allCos?: string;
  };
  flags: (r: any) => string[];
  tier1: (r: any) => boolean;
}

const SOURCES: SrcCfg[] = [
  {
    label: "binary", table: "profiles",
    sel: "full_name,current_title,current_company,location_city,is_india,total_experience_years,seniority_level,role_family,domains,one_liner,search_summary,linkedin_slug,current_ctc_lpa,faang_worked_flag,big4_worked_flag,tier1_companies_count,iit_flag,iim_flag,has_founder_experience",
    m: { name: "full_name", title: "current_title", company: "current_company", city: "location_city", india: "is_india", yoe: "total_experience_years", roleFamily: "role_family", domains: "domains", slug: "linkedin_slug", one: "one_liner", summary: "search_summary", ctc: "current_ctc_lpa", full: "resume_text", sen: "seniority_level" },
    flags: (r) => [r.faang_worked_flag && "Ex-FAANG", r.big4_worked_flag && "Big 4", r.tier1_companies_count > 0 && "Tier-1 cos", (r.iit_flag || r.iim_flag) && "IIT/IIM", r.has_founder_experience && "Founder"].filter(Boolean) as string[],
    tier1: (r) => !!(r.faang_worked_flag || r.big4_worked_flag || r.tier1_companies_count > 0),
  },
  {
    label: "luma", table: "luma_profiles", limit: 80,
    sel: "full_name,designation,company,city_canonical,is_india,total_experience_years,title_seniority,title_role,inferred_role,domains_worked,career_summary,linkedin_slug,highest_company_tier,has_big_tech_exp,has_consulting_exp,has_startup_exp,all_companies_worked",
    m: { name: "full_name", title: "designation", company: "company", city: "city_canonical", india: "is_india", yoe: "total_experience_years", roleText: "title_role", domains: "domains_worked", slug: "linkedin_slug", summary: "career_summary", full: "searchable_text", fullIsSuperset: true, sen: "title_seniority", allCos: "all_companies_worked" },
    // Only surface highest_company_tier when it's a POSITIVE signal. Passing it through raw
    // leaked "Tier: tier3" into the UI and the reasons — a second, conflicting tier taxonomy
    // asserting a low tier we haven't verified. Positive signals only; our companyTier() rules.
    flags: (r) => [r.has_big_tech_exp && "Big tech", r.has_consulting_exp && "Ex-consulting", r.has_startup_exp && "Startup", ["tier1", "tier_1", "faang", "unicorn"].includes(String(r.highest_company_tier).toLowerCase()) && "Tier-1 background"].filter(Boolean) as string[],
    tier1: (r) => !!(r.has_big_tech_exp || ["tier1", "faang", "unicorn", "tier_1"].includes(String(r.highest_company_tier).toLowerCase())),
  },
  {
    label: "yc", table: "yc_employees", limit: 60,
    sel: "full_name,current_title,current_company_name,city_canonical,is_india,total_experience_years,title_seniority,role_family,inferred_role,domains_worked,career_summary,linkedin_slug,highest_company_tier,has_big_tech_exp,has_consulting_exp,has_startup_exp,all_companies_worked",
    m: { name: "full_name", title: "current_title", company: "current_company_name", city: "city_canonical", india: "is_india", yoe: "total_experience_years", roleFamily: "role_family", domains: "domains_worked", slug: "linkedin_slug", summary: "career_summary", full: "searchable_text", fullIsSuperset: true, sen: "title_seniority", allCos: "all_companies_worked" },
    // Only surface highest_company_tier when it's a POSITIVE signal. Passing it through raw
    // leaked "Tier: tier3" into the UI and the reasons — a second, conflicting tier taxonomy
    // asserting a low tier we haven't verified. Positive signals only; our companyTier() rules.
    flags: (r) => [r.has_big_tech_exp && "Big tech", r.has_consulting_exp && "Ex-consulting", r.has_startup_exp && "Startup", ["tier1", "tier_1", "faang", "unicorn"].includes(String(r.highest_company_tier).toLowerCase()) && "Tier-1 background"].filter(Boolean) as string[],
    tier1: (r) => !!(r.has_big_tech_exp || ["tier1", "faang", "unicorn", "tier_1"].includes(String(r.highest_company_tier).toLowerCase())),
  },
  {
    label: "ext", table: "ext_profiles", limit: 40,
    sel: "full_name,designation,company,person_location,about,skills,inferred_role,linkedin_slug",
    m: { name: "full_name", title: "designation", company: "company", city: "person_location", roleText: "inferred_role", slug: "linkedin_slug", about: "about", skills: "skills" },
    flags: () => [], tier1: () => false,
  },
  {
    label: "apify", table: "apify_search_profiles", limit: 60,
    sel: "full_name,designation,company,person_location,about,skills,inferred_role,linkedin_slug",
    m: { name: "full_name", title: "designation", company: "company", city: "person_location", roleText: "inferred_role", slug: "linkedin_slug", about: "about", skills: "skills" },
    flags: () => [], tier1: () => false,
  },
];

function normalize(s: SrcCfg, r: any): Person {
  const m = s.m;
  const slug = r[m.slug];
  const title = m.title ? r[m.title] : null;
  const company = m.company ? r[m.company] : null;
  const summary = (m.summary && r[m.summary]) || (m.one && r[m.one]) || (m.about && r[m.about]) || null;
  const domains: string[] = m.domains && Array.isArray(r[m.domains]) ? r[m.domains] : [];
  const skills: string[] = m.skills && Array.isArray(r[m.skills]) ? r[m.skills] : (m.skills && typeof r[m.skills] === "string" ? String(r[m.skills]).split(/[,;]/).map((x) => x.trim()).filter(Boolean) : []);
  const flags = s.flags(r);
  // sanitize years — some rows carry garbage (e.g. 4056.6); keep only 0–50.
  const rawYoe = m.yoe ? Number(r[m.yoe]) : NaN;
  const yoe = Number.isFinite(rawYoe) && rawYoe >= 0 && rawYoe <= 50 ? Math.round(rawYoe) : null;
  const comp = m.ctc ? r[m.ctc] : null;
  // FULL career graph: current + every past company (all_companies_worked). This is the 4x
  // recall lift — "ex-Flipkart payments" only matches if we look past the current employer.
  // Downstream (tier, career/domain, target-company match) all read p.experience.
  const nrm = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");
  const past: string[] = m.allCos && Array.isArray(r[m.allCos]) ? r[m.allCos].filter(Boolean) : [];
  const experience: { company: string; title: string }[] = [];
  if (company) experience.push({ company, title: title ?? "" });
  for (const co of past) {
    if (typeof co !== "string" || !co.trim()) continue;
    if (company && nrm(co) === nrm(company)) continue; // already the current row
    if (experience.some((e) => nrm(e.company) === nrm(co))) continue;
    experience.push({ company: co, title: "" });
    if (experience.length >= 12) break;
  }
  const person: any = {
    id: `${s.label}:${slug || (r[m.name] || "x").toLowerCase().replace(/\s+/g, "-")}`,
    name: r[m.name] ?? "Unknown",
    headline: (m.one && r[m.one]) || title || null,
    current_title: title ?? null,
    company: company ?? null,
    location: (m.city && r[m.city]) ?? null,
    summary,
    experience,
    skills: (skills.length ? skills : domains).slice(0, 12),
    education: [],
    social_links: slug ? [{ type: "linkedin", url: `https://linkedin.com/in/${slug}` }] : [],
    profile_strength: Math.min(100, 50 + (yoe ?? 0) * 3 + flags.length * 4),
    confidence_score: s.label === "binary" ? 88 : s.label === "ext" || s.label === "apify" ? 68 : 80,
    last_updated: new Date().toISOString(),
    _sources: [{ adapter: `supabase:${s.label}`, raw_id: String(slug ?? ""), trust: s.label === "binary" ? 1 : 0.85 }],
    dossier: {
      years: yoe ?? null, seniority: (m.sen && r[m.sen]) || null,
      // role family/text so scoring can match on function (binary/yc → role_family enum;
      // luma/ext/apify → title_role/inferred_role). Was never set → role-family scoring no-op'd.
      roleFamily: (m.roleFamily && r[m.roleFamily]) || (m.roleText && r[m.roleText]) || null,
      overview: summary, tagline: (m.one && r[m.one]) || null,
      bestFor: [], notFor: [], products: [], roles: [], scale: null,
      skills: skills.slice(0, 16), tools: [], domains,
      education: [], flags: [...flags, ...(comp ? [`~${comp} LPA`] : [])],
    },
  };
  person._pid = r.id;      // pool row id — used to join profile_facets
  person._src = s.label;   // source label (binary/luma/yc/ext/apify)
  return person as Person;
}

// Circuit breaker: tables whose full-text column has no trigram index yet. The first search
// pays one statement timeout discovering this; every search after skips straight to the small
// columns instead of burning ~8s on a query we know will be cancelled. Clears on redeploy —
// so once supabase/trigram_indexes.sql is run, full-text turns itself back on.
const FULLTEXT_UNAVAILABLE = new Set<string>();

async function runSource(client: any, s: SrcCfg, query: StructuredQuery, terms: string[]): Promise<Person[]> {
  const m = s.m;
  const useFamily = m.roleFamily && query.roleFamilies.length > 0;
  const build = (withTerms: boolean, skipFull = false) => {
    let qb = client.from(s.table).select("id," + s.sel);
    if (useFamily) qb = qb.in(m.roleFamily!, query.roleFamilies);
    if (m.india && query.india) qb = qb.eq(m.india, true);
    // soft floor: allow a 2-year stretch below the ask so a strong near-miss surfaces
    // (scored down in businessScore), instead of being hard-dropped by the DB.
    if (m.yoe && query.yoeMin != null) qb = qb.gte(m.yoe, Math.max(0, query.yoeMin - 2));
    if (m.yoe && query.yoeMax != null) qb = qb.lte(m.yoe, query.yoeMax);
    if (m.city && query.locations[0]) {
      // match every spelling of the city (Bangalore ⇒ bengaluru) or matches silently vanish
      const variants = cityVariants(query.locations[0]).map(safe).filter(Boolean);
      qb = variants.length > 1
        ? qb.or(variants.map((v) => `${m.city}.ilike."%${v}%"`).join(","))
        : qb.ilike(m.city, `%${safe(query.locations[0])}%`);
    }
    if (withTerms && terms.length) {
      // m.full (resume_text / searchable_text) is the big one: the short summary fields say
      // "Senior PM at Acme", the full text says "owned UPI reconciliation, cut failures 40%".
      // Filtering on a non-selected column is fine — we search it without paying to fetch it.
      // When `full` is a superset (luma/yc searchable_text embeds title+company+career), search
      // ONLY it: one indexed column beats OR-ing four unindexed ones, and misses nothing.
      const full = skipFull || FULLTEXT_UNAVAILABLE.has(s.table) ? undefined : m.full;
      const cols = (full && m.fullIsSuperset
        ? [full]
        : [m.title, m.one, m.summary, m.roleText, m.about, full]
      ).filter(Boolean) as string[];
      // Quote the value — multi-word/expanded terms ("b2b saas", "a/b testing") contain
      // spaces & reserved chars that break PostgREST's unquoted .or() syntax.
      const ors = terms.flatMap((t) => cols.map((c) => `${c}.ilike."%${t}%"`)).join(",");
      if (ors) qb = qb.or(ors);
    }
    if (m.yoe) qb = qb.order(m.yoe, { ascending: false, nullsFirst: false });
    return qb.limit(s.limit ?? 70);
  };
  try {
    // text tables (no role_family) NEED the keyword filter; family tables relax it if too few.
    let { data, error } = await build(true);
    // The full-text column needs a GIN trigram index (supabase/trigram_indexes.sql) — without it
    // an ILIKE '%x%' over 64k multi-KB rows blows the statement timeout. If that happens, retry on
    // the small columns so the pool degrades to its old behaviour instead of silently vanishing.
    if (error && m.full && !FULLTEXT_UNAVAILABLE.has(s.table)) {
      FULLTEXT_UNAVAILABLE.add(s.table); // don't pay this timeout again on the next search
      console.warn(`[src ${s.label}] full-text search on ${m.full} failed (${error.message.slice(0, 60)}) — falling back to summary columns. Run supabase/trigram_indexes.sql to enable full-text (measured 4–10x recall).`);
      const r = await build(true, true);
      data = r.data; error = r.error;
    }
    // Fallback WITHOUT terms orders by yoe-desc = "the most experienced humans", unrelated to the
    // JD. Only acceptable when semantic is OFF (keyword is all we have). When semantic is ON, the
    // vector lane carries recall for thin-keyword JDs — so skip this noise entirely.
    if (!error && useFamily && (data?.length ?? 0) < 6 && !COST.SEARCH_SEMANTIC) {
      const r = await build(false); if (!r.error) data = r.data;
    }
    if (error) { console.error(`[src ${s.label}] ${error.message.slice(0, 90)}`); return []; }
    return (data ?? []).map((r: any) => normalize(s, r));
  } catch (e) { console.error(`[src ${s.label}]`, e); return []; }
}

// ── Semantic (vector) lane ───────────────────────────────────────────────────
// Per-pool match function (created by supabase/semantic_setup.sql). Returns slugs
// ranked by meaning-similarity; we then fetch the full rows. Fails safe: if the RPC
// or embeddings aren't installed yet, each pool just returns [] and the keyword path
// carries the search.
const VEC: Record<string, { fn: string; filt: boolean }> = {
  binary: { fn: "match_binary", filt: true },
  luma: { fn: "match_luma", filt: true },
  yc: { fn: "match_yc", filt: true },
  ext: { fn: "match_ext", filt: false },
  apify: { fn: "match_apify", filt: false },
};

async function fetchBySlugs(client: any, s: SrcCfg, slugs: string[]): Promise<Person[]> {
  if (!slugs.length) return [];
  const { data, error } = await client.from(s.table).select("id," + s.sel).in(s.m.slug, slugs.slice(0, 80));
  if (error) return [];
  return (data ?? []).map((r: any) => normalize(s, r));
}

async function vectorLane(client: any, query: StructuredQuery): Promise<Person[]> {
  if (!COST.SEARCH_SEMANTIC || !hasEmbeddings) return [];
  // MULTI-PERSONA: search the JD itself AND each persona "bet" (direct / adjacent /
  // proven-scaler / pedigree). A candidate strong on ANY angle surfaces — like a
  // recruiter chasing several theories at once. Union by best similarity across angles.
  const texts = [query.embedText || query.raw, ...(query.hypotheses ?? []).slice(0, 3)]
    .map((t) => (t ?? "").trim()).filter((t) => t.length > 4);
  let vecs: number[][];
  try { vecs = await embedMany(texts); } catch (e) { console.error("[vec] embed failed:", e); return []; }
  if (!vecs.length) return [];

  const perPool = await Promise.all(
    SOURCES.map(async (s) => {
      const v = VEC[s.label];
      if (!v) return [];
      const simBySlug = new Map<string, number>();
      await Promise.all(vecs.map(async (qvec, vi) => {
        // primary = the JD itself (trust it more); persona bets are speculative → higher floor
        const floor = vi === 0 ? COST.VECTOR_MIN_SIM : COST.VECTOR_MIN_SIM + 0.06;
        // relax the DB min_years pre-filter by 2 — near-misses should surface (scored down), not vanish
        const params: Record<string, unknown> = { query_embedding: qvec, match_count: vi === 0 ? COST.VECTOR_MATCH_COUNT : 20 };
        if (v.filt) { params.only_india = !!query.india; if (query.yoeMin != null) params.min_years = Math.max(0, query.yoeMin - 2); }
        try {
          const { data, error } = await client.rpc(v.fn, params);
          if (error) return; // RPC not installed → keyword path covers it
          for (const r of ((data ?? []) as Array<{ linkedin_slug: string; similarity: number }>)) {
            const sim = Number(r.similarity) || 0;
            if (sim < floor) continue; // below the floor = noise, drop it
            if (sim > (simBySlug.get(r.linkedin_slug) ?? 0)) simBySlug.set(r.linkedin_slug, sim);
          }
        } catch { /* ignore this angle */ }
      }));
      const people = await fetchBySlugs(client, s, Array.from(simBySlug.keys()));
      for (const p of people) {
        const slug = p.id.split(":").slice(1).join(":");
        (p as any)._sim = simBySlug.get(slug) ?? 0; // best similarity across all angles → hybrid blend
      }
      return people;
    })
  );
  return perPool.flat();
}

// ── Profile facets ───────────────────────────────────────────────────────────
// profile_facets holds computed per-person signals (0→1 shipper, growth/AI-PM, ex-FAANG,
// IIT/IIM, CTC band…). We join by (source, pool row id) and fold them into each person's
// flags, so scoring, the AI ranker, and the UI all see the richer signal.
const FACET_FLAGS: [string, string][] = [
  ["growth_pm_signal", "Growth PM"], ["ai_pm_signal", "AI PM"], ["platform_pm_signal", "Platform PM"],
  ["data_pm_signal", "Data PM"], ["is_0to1_shipper", "0→1 shipper"], ["is_ai_builder", "AI builder"],
  ["iit_or_iim", "IIT/IIM"], ["worked_at_faang", "Ex-FAANG"], ["worked_at_unicorn", "Ex-unicorn"],
  ["worked_at_consulting", "Ex-consulting"], ["worked_at_big4", "Big 4"],
];
const FACET_SEL = "profile_id," + FACET_FLAGS.map((f) => f[0]).join(",") + ",inferred_ctc_band";

async function attachFacets(client: any, people: Person[]): Promise<void> {
  const bySrc = new Map<string, Person[]>();
  for (const p of people) {
    const src = (p as any)._src, pid = (p as any)._pid;
    if (!src || !pid) continue;
    if (!bySrc.has(src)) bySrc.set(src, []);
    bySrc.get(src)!.push(p);
  }
  await Promise.all(Array.from(bySrc.entries()).map(async ([src, ppl]) => {
    const pids = ppl.map((p) => (p as any)._pid).slice(0, 300);
    try {
      const { data, error } = await client.from("profile_facets").select(FACET_SEL).eq("source", src).in("profile_id", pids);
      if (error || !data) return;
      const byPid = new Map((data as any[]).map((r) => [r.profile_id, r]));
      for (const p of ppl) {
        const f = byPid.get((p as any)._pid);
        if (!f) continue;
        const d = p.dossier as any;
        const flags: string[] = Array.isArray(d.flags) ? d.flags : (d.flags = []);
        for (const [col, label] of FACET_FLAGS) if (f[col] && !flags.includes(label)) flags.push(label);
        if (f.inferred_ctc_band && !flags.some((x) => /lpa/i.test(x))) flags.push(String(f.inferred_ctc_band));
      }
    } catch { /* facets optional — ignore */ }
  }));
}

export const supabaseAdapter: SourceAdapter = {
  name: "supabase",
  async search(query: StructuredQuery): Promise<Person[]> {
    // Fail loudly, never fabricate. A recruiter must never be shown invented candidates:
    // a misconfiguration or an outage has to surface as an error, not as fake profiles.
    if (!hasSupabase) throw new Error("Supabase not configured (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SECRET_KEY)");
    try {
      const client = db();
      // expand query terms with domain synonyms so e.g. "experimentation" also pulls
      // a/b testing / feature-flags people, and "marketplace" pulls Uber/Swiggy/Flipkart.
      const expanded = expandTerms([...query.roles, ...query.keywords, ...query.skills, ...query.signals], 14);
      // Companies named in the JD are searched verbatim (never synonym-expanded) — now that the
      // full-text column is in the OR, "Flipkart" hits anyone whose resume/career text mentions it.
      const named = query.companies.map(safe).filter((t) => t.length > 2);
      const terms = Array.from(new Set([...named, ...expanded.map(safe).filter((t) => t.length > 2)])).slice(0, 12);

      // keyword lane (all pools) + semantic lane (all pools) run together; merged below.
      const [batches, vectorPeople] = await Promise.all([
        Promise.all(SOURCES.map((s) => runSource(client, s, query, terms))),
        vectorLane(client, query),
      ]);

      // dedupe by slug. Vector lane FIRST so a profile that matches on both keyword AND
      // semantic keeps its similarity score (for the hybrid blend); keyword-only people follow.
      const seen = new Set<string>();
      let people: Person[] = [];
      for (const batch of [vectorPeople, ...batches]) for (const p of batch) {
        const slug = p.social_links?.[0]?.url ?? p.id;
        if (seen.has(slug)) continue;
        seen.add(slug); people.push(p);
      }

      // enrich with computed per-person signals (0→1 shipper, growth/AI-PM, IIT-IIM, CTC…)
      await attachFacets(client, people);

      // company-tier filter if requested — uses real company prestige (knowledge layer),
      // so pools without tier flags (luma/yc/ext/apify) are still judged by their companies.
      if (query.companyTier.length) {
        const wantT1 = query.companyTier.some((t) => /tier_?1|faang|unicorn|big4/i.test(t));
        const isTier = (p: Person) => {
          const cos = [p.company, ...p.experience.map((e) => e.company)].filter(Boolean) as string[];
          if (meetsTier(cos, wantT1)) return true;
          const flags = (p.dossier as any)?.flags;
          return Array.isArray(flags) && flags.some((f: string) => /faang|big 4|tier-1|big tech|unicorn|tier:/i.test(f));
        };
        const withTier = people.filter(isTier);
        people = withTier.length >= 6 ? withTier : [...withTier, ...people.filter((p) => !isTier(p))];
      }
      return people;
    } catch (e) {
      // Surface the failure — the API turns this into an honest "Search failed" rather than
      // silently returning an empty/fake list that reads as "no such candidates exist".
      console.error("[supabase] search failed:", e);
      throw e;
    }
  },
};

/** Fetch one person (id = "source:slug") for the detail page. */
export async function getPersonById(id: string): Promise<Person | null> {
  if (!hasSupabase) return null;
  try {
    const [label, ...rest] = id.split(":");
    const slug = rest.join(":");
    const s = SOURCES.find((x) => x.label === label);
    if (!s) return null;
    const { data } = await db().from(s.table).select("id," + s.sel).eq(s.m.slug, slug).limit(1).maybeSingle();
    return data ? normalize(s, data) : null;
  } catch (e) { console.error("[supabase] getPersonById:", e); return null; }
}

/** Raw resume text (binary pool only). */
export async function getResumeText(id: string): Promise<string | null> {
  if (!hasSupabase) return null;
  try {
    const slug = id.split(":").slice(1).join(":");
    const { data } = await db().from("profiles").select("raw_resume_text,resume_text").eq("linkedin_slug", slug).maybeSingle();
    return (data?.raw_resume_text || data?.resume_text || null) as string | null;
  } catch { return null; }
}
