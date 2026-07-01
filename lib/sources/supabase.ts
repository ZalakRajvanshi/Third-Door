import { createClient } from "@supabase/supabase-js";
import type { Person, SourceAdapter, StructuredQuery } from "@/lib/types";
import { SEED_PEOPLE } from "./seed";
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
  m: { name: string; title: string; company?: string; city?: string; india?: string; yoe?: string; roleFamily?: string; roleText?: string; domains?: string; slug: string; one?: string; summary?: string; about?: string; skills?: string; ctc?: string };
  flags: (r: any) => string[];
  tier1: (r: any) => boolean;
}

const SOURCES: SrcCfg[] = [
  {
    label: "binary", table: "profiles",
    sel: "full_name,current_title,current_company,location_city,is_india,total_experience_years,seniority_level,role_family,domains,one_liner,search_summary,linkedin_slug,current_ctc_lpa,faang_worked_flag,big4_worked_flag,tier1_companies_count,iit_flag,iim_flag,has_founder_experience",
    m: { name: "full_name", title: "current_title", company: "current_company", city: "location_city", india: "is_india", yoe: "total_experience_years", roleFamily: "role_family", domains: "domains", slug: "linkedin_slug", one: "one_liner", summary: "search_summary", ctc: "current_ctc_lpa" },
    flags: (r) => [r.faang_worked_flag && "Ex-FAANG", r.big4_worked_flag && "Big 4", r.tier1_companies_count > 0 && "Tier-1 cos", (r.iit_flag || r.iim_flag) && "IIT/IIM", r.has_founder_experience && "Founder"].filter(Boolean) as string[],
    tier1: (r) => !!(r.faang_worked_flag || r.big4_worked_flag || r.tier1_companies_count > 0),
  },
  {
    label: "luma", table: "luma_profiles", limit: 80,
    sel: "full_name,designation,company,city_canonical,is_india,total_experience_years,title_seniority,title_role,inferred_role,domains_worked,career_summary,linkedin_slug,highest_company_tier,has_big_tech_exp,has_consulting_exp,has_startup_exp",
    m: { name: "full_name", title: "designation", company: "company", city: "city_canonical", india: "is_india", yoe: "total_experience_years", roleText: "title_role", domains: "domains_worked", slug: "linkedin_slug", summary: "career_summary" },
    flags: (r) => [r.has_big_tech_exp && "Big tech", r.has_consulting_exp && "Ex-consulting", r.has_startup_exp && "Startup", r.highest_company_tier && `Tier: ${r.highest_company_tier}`].filter(Boolean) as string[],
    tier1: (r) => !!(r.has_big_tech_exp || ["tier1", "faang", "unicorn", "tier_1"].includes(String(r.highest_company_tier).toLowerCase())),
  },
  {
    label: "yc", table: "yc_employees", limit: 60,
    sel: "full_name,current_title,current_company_name,city_canonical,is_india,total_experience_years,title_seniority,role_family,inferred_role,domains_worked,career_summary,linkedin_slug,highest_company_tier,has_big_tech_exp,has_consulting_exp,has_startup_exp",
    m: { name: "full_name", title: "current_title", company: "current_company_name", city: "city_canonical", india: "is_india", yoe: "total_experience_years", roleFamily: "role_family", domains: "domains_worked", slug: "linkedin_slug", summary: "career_summary" },
    flags: (r) => [r.has_big_tech_exp && "Big tech", r.has_consulting_exp && "Ex-consulting", r.has_startup_exp && "Startup", r.highest_company_tier && `Tier: ${r.highest_company_tier}`].filter(Boolean) as string[],
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
  const person: any = {
    id: `${s.label}:${slug || (r[m.name] || "x").toLowerCase().replace(/\s+/g, "-")}`,
    name: r[m.name] ?? "Unknown",
    headline: (m.one && r[m.one]) || title || null,
    current_title: title ?? null,
    company: company ?? null,
    location: (m.city && r[m.city]) ?? null,
    summary,
    experience: company ? [{ company, title: title ?? "" }] : [],
    skills: (skills.length ? skills : domains).slice(0, 12),
    education: [],
    social_links: slug ? [{ type: "linkedin", url: `https://linkedin.com/in/${slug}` }] : [],
    profile_strength: Math.min(100, 50 + (yoe ?? 0) * 3 + flags.length * 4),
    confidence_score: s.label === "binary" ? 88 : s.label === "ext" || s.label === "apify" ? 68 : 80,
    last_updated: new Date().toISOString(),
    _sources: [{ adapter: `supabase:${s.label}`, raw_id: String(slug ?? ""), trust: s.label === "binary" ? 1 : 0.85 }],
    dossier: {
      years: yoe ?? null, seniority: (m as any).sen ? r[(m as any).sen] : null,
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

async function runSource(client: any, s: SrcCfg, query: StructuredQuery, terms: string[]): Promise<Person[]> {
  const m = s.m;
  const useFamily = m.roleFamily && query.roleFamilies.length > 0;
  const build = (withTerms: boolean) => {
    let qb = client.from(s.table).select("id," + s.sel);
    if (useFamily) qb = qb.in(m.roleFamily!, query.roleFamilies);
    if (m.india && query.india) qb = qb.eq(m.india, true);
    if (m.yoe && query.yoeMin != null) qb = qb.gte(m.yoe, query.yoeMin);
    if (m.yoe && query.yoeMax != null) qb = qb.lte(m.yoe, query.yoeMax);
    if (m.city && query.locations[0]) {
      // match every spelling of the city (Bangalore ⇒ bengaluru) or matches silently vanish
      const variants = cityVariants(query.locations[0]).map(safe).filter(Boolean);
      qb = variants.length > 1
        ? qb.or(variants.map((v) => `${m.city}.ilike."%${v}%"`).join(","))
        : qb.ilike(m.city, `%${safe(query.locations[0])}%`);
    }
    if (withTerms && terms.length) {
      const cols = [m.title, m.one, m.summary, m.roleText, m.about].filter(Boolean) as string[];
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
    if (!error && useFamily && (data?.length ?? 0) < 6) { const r = await build(false); if (!r.error) data = r.data; }
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
        const params: Record<string, unknown> = { query_embedding: qvec, match_count: vi === 0 ? COST.VECTOR_MATCH_COUNT : 20 };
        if (v.filt) { params.only_india = !!query.india; if (query.yoeMin != null) params.min_years = query.yoeMin; }
        try {
          const { data, error } = await client.rpc(v.fn, params);
          if (error) return; // RPC not installed → keyword path covers it
          for (const r of ((data ?? []) as Array<{ linkedin_slug: string; similarity: number }>)) {
            const sim = Number(r.similarity) || 0;
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

function seedFallback(query: StructuredQuery): Person[] {
  const terms = [...query.roles, ...query.keywords, ...query.skills].map((t) => t.toLowerCase());
  return SEED_PEOPLE.filter((p) => !terms.length || terms.some((t) => [p.name, p.headline, p.current_title, p.company, ...p.skills].join(" ").toLowerCase().includes(t)));
}

export const supabaseAdapter: SourceAdapter = {
  name: "supabase",
  async search(query: StructuredQuery): Promise<Person[]> {
    if (!hasSupabase) return seedFallback(query);
    try {
      const client = db();
      // expand query terms with domain synonyms so e.g. "experimentation" also pulls
      // a/b testing / feature-flags people, and "marketplace" pulls Uber/Swiggy/Flipkart.
      const expanded = expandTerms([...query.roles, ...query.keywords, ...query.skills, ...query.signals], 14);
      const terms = Array.from(new Set(expanded.map(safe).filter((t) => t.length > 2))).slice(0, 10);

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
      console.error("[supabase] search error, seed fallback:", e);
      return seedFallback(query);
    }
  },
};

/** Fetch one person (id = "source:slug") for the detail page. */
export async function getPersonById(id: string): Promise<Person | null> {
  if (!hasSupabase) return SEED_PEOPLE.find((p) => p.id === id) ?? null;
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
