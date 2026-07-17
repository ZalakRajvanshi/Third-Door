import type { Person, StructuredQuery } from "@/lib/types";
import { companyTier, meetsTier, relatedTerms, expandTerms } from "@/lib/knowledge";
import { lookupCompany } from "@/lib/companies";
import { prefBoost } from "@/lib/learning";

// ───────────────────────────────────────────────────────────────────────────
// Stage-4 business score — a transparent, deterministic 0–100 that decides which
// candidates are worth (token-costly) OpenAI ranking.
//   role 22 · seniority 8 · skills 14 · experience 12 · career 34 · tier 8 · location 2
// CAREER is now the heaviest signal (34 + 8 tier = 42/100, up from 20/100): who someone
// has actually worked for — across their WHOLE career, not just the current job — predicts
// fit far better than title keywords. Seniority is its own component scored on a real
// ladder (it used to be a substring check against an always-null field).
// Plus a mild recency factor (fresher data ranks slightly higher).
// Fast (pure JS, no I/O), so we can score the whole retrieved pool every search.
// ───────────────────────────────────────────────────────────────────────────

const WEIGHTS = { role: 22, seniority: 8, skills: 14, experience: 12, career: 34, tier: 8, location: 2 };

const lc = (s: unknown) => String(s ?? "").toLowerCase();

export interface ScoreBreakdown {
  total: number; // 0–100
  role: number; seniority: number; skills: number; experience: number; career: number; tier: number; location: number;
}

function dossier(p: Person) { return (p.dossier ?? {}) as any; }

/** All the company names we can attribute to a person (current + past + flag hints). */
function companies(p: Person): string[] {
  const out = [p.company, ...p.experience.map((e) => e.company)].filter(Boolean) as string[];
  const flags: string[] = Array.isArray(dossier(p).flags) ? dossier(p).flags : [];
  // luma/yc flags like "Ex-FAANG", "Big tech", "Tier: tier1" → treat as tier1 evidence
  // NOTE: "big ?4" matters — the binary pool emits the literal flag "Big 4", and companyTier
  // treats big4 as a Tier-1 ask, but this regex didn't recognise it. So a candidate carrying the
  // exact pedigree the brief asked for failed meetsTier while their "Ex-FAANG" peer passed.
  if (flags.some((f) => /faang|big tech|big ?4|unicorn|tier-1|tier:\s*(tier_?1|faang|unicorn)/i.test(f))) out.push("google");
  return out;
}

function roleScore(p: Person, q: StructuredQuery): number {
  const hay = `${lc(p.current_title)} ${lc(p.headline)} ${lc(dossier(p).tagline)}`;
  const fam = lc(dossier(p).roleFamily);
  // literal role phrases the recruiter used
  const roleTerms = [...q.roles, ...q.keywords].map(lc).filter((t) => t.length > 2);
  const hits = roleTerms.filter((t) => hay.includes(t)).length;
  let s = roleTerms.length ? hits / roleTerms.length : 0.4;
  // role-family alignment (DB enum) is necessary but NOT sufficient — it floors the score at
  // 0.7, but a genuine title/keyword match (hits above) is what earns the top of the range.
  // Otherwise every PM scores identically on a PM search and the heaviest weight stops discriminating.
  if (q.roleFamilies.length && q.roleFamilies.some((f) => fam.includes(lc(f)) || hay.includes(lc(f).replace(/_/g, " ")))) s = Math.max(s, 0.7);
  return Math.max(0, Math.min(1, s));
}

// One ladder for every pool. The vocabularies genuinely differ (binary: intern/junior/mid/
// leadership; yc: adds lead/director/vp/c_level/founder) — per the data contract, unify before
// comparing. Parallel rungs share a level (staff ≈ lead, leadership ≈ director).
const LADDER: Record<string, number> = {
  intern: 0, trainee: 0, junior: 1, entry: 1, associate: 1, mid: 2, senior: 3, sr: 3,
  lead: 4, staff: 4, principal: 5, director: 6, leadership: 6, head: 6, vp: 7,
  c_level: 8, cxo: 8, chief: 8, founder: 8,
};
const senRank = (s: unknown): number | null => {
  const k = lc(s).trim().replace(/[\s-]+/g, "_");
  return k in LADDER ? LADDER[k] : null;
};

/** Distance on the real seniority ladder. Under-levelled is worse than over-levelled:
 *  a VP for a Senior brief is a stretch; a junior for a Senior brief is a miss. */
function seniorityScore(p: Person, q: StructuredQuery): number {
  if (!q.seniority.length) return 0.5;
  const want = q.seniority.map(senRank).filter((n): n is number => n != null);
  if (!want.length) return 0.5;
  // Take the HIGHER of the stored value and the title. Measured: 28% of senior/lead/principal-
  // titled people carry seniority_level junior/intern/mid (e.g. a 9-yr "Lead PM — UPI" stored as
  // "mid"). Some of that is the enrichment discounting title inflation, which is fair — but
  // under-levelling a real lead is worse, and yoe is scored separately (experienceScore), so an
  // inflated title without the years still can't sneak through.
  const stored = senRank(dossier(p).seniority);
  let titled: number | null = null;
  const hay = `${lc(p.current_title)} ${lc(p.headline)}`;
  for (const [k, v] of Object.entries(LADDER)) {
    if (new RegExp(`\\b${k.replace(/_/g, " ")}\\b`).test(hay)) titled = Math.max(titled ?? 0, v);
  }
  const cand = stored == null ? titled : titled == null ? stored : Math.max(stored, titled);
  if (cand == null) return 0.45; // genuinely unknown → mild neutral, never a hard miss
  // closest requested rung; over-qualified counts at 60% of the distance
  const dist = Math.min(...want.map((w) => (cand! >= w ? (cand! - w) * 0.6 : w - cand!)));
  return dist === 0 ? 1 : dist <= 1 ? 0.78 : dist <= 2 ? 0.45 : 0.2;
}

function skillsScore(p: Person, q: StructuredQuery): number {
  const concepts = Array.from(new Set([...q.skills, ...q.signals, ...q.keywords].map(lc).filter((t) => t.length > 2)));
  if (!concepts.length) return 0.5;
  const hay = [lc(p.summary), lc(p.current_title), ...(p.skills ?? []).map(lc), ...(dossier(p).domains ?? []).map(lc)].join(" ");
  // a concept counts if IT or any of its domain synonyms appears (semantic, not literal)
  const found = concepts.filter((c) => relatedTerms(c).some((t) => hay.includes(t))).length;
  return found / concepts.length;
}

function experienceScore(p: Person, q: StructuredQuery): number {
  const y = dossier(p).years;
  if (q.yoeMin == null && q.yoeMax == null) return 0.6;
  if (typeof y !== "number") return 0.4; // unknown years → mild neutral
  if (q.yoeMin != null && y < q.yoeMin) return Math.max(0, 0.5 - (q.yoeMin - y) * 0.12); // below ask → penalty
  if (q.yoeMax != null && y > q.yoeMax) return Math.max(0.4, 0.9 - (y - q.yoeMax) * 0.05); // over ask → mild
  return 1; // within band / meets the floor
}

const nrmCo = (c: unknown) => lc(c).replace(/[^a-z0-9]/g, "");

/** Did they work at one of the companies the JD actually named — EVER, not just now? */
function namedCompanyHit(p: Person, q: StructuredQuery): boolean {
  if (!q.companies.length) return false;
  const wanted = q.companies.map(nrmCo).filter((w) => w.length > 2);
  if (!wanted.length) return false;
  return [p.company, ...p.experience.map((e) => e.company)].filter(Boolean).some((c) => {
    const n = nrmCo(c);
    // "flipkart" matches "flipkartindiapvtltd"; guard the reverse so short names don't over-match
    return wanted.some((w) => n.includes(w) || (n.length > 3 && w.includes(n)));
  });
}

/**
 * CAREER — the heaviest signal (34/100). Reads the WHOLE career graph, not just the current
 * employer, which is the documented 4x lift: "ex-Flipkart payments" is invisible if you only
 * look at where someone works today. Current beats past (recency), real company metadata beats
 * text guessing.
 */
function careerScore(p: Person, q: StructuredQuery): number {
  const named = namedCompanyHit(p, q);

  if (q.domains.length) {
    const want = q.domains.map(lc);
    // CURRENT company's real domains (companies_metadata) — cleanest, most recent signal
    const cur = (lookupCompany(p.company)?.domains ?? []).map(lc);
    const curHit = cur.some((d) => want.includes(d));
    // ANY past company in the domain — the 4x lift, discounted for recency.
    // experience[0] is the current company ONLY when p.company is set; otherwise entry 0 is
    // already a past employer and slicing it off would hide a real stint.
    const pastCos = p.company ? p.experience.slice(1) : p.experience;
    const past = pastCos.flatMap((e) => lookupCompany(e.company)?.domains ?? []).map(lc);
    const pastHit = past.some((d) => want.includes(d));
    // text/dossier evidence (no company metadata match)
    const expanded = q.domains.flatMap((d) => expandTerms([d], 8));
    const hay = [lc(p.summary), lc(p.company), ...(dossier(p).domains ?? []).map(lc)].join(" ");
    const textHit = q.domains.some((d) => hay.includes(lc(d))) || expanded.some((w) => hay.includes(w));
    // Do we actually KNOW any of their employers? If none resolve to companies_metadata we have
    // no domain evidence either way — that's our data gap, not a wrong-domain candidate. Same
    // principle tierScore already applies; career carries 4x the weight, so it mattered 4x more.
    const known = [p.company, ...p.experience.map((e) => e.company)].some((c) => lookupCompany(c));

    let s = curHit ? 0.95 : pastHit ? 0.75 : textHit ? 0.5 : known ? 0.15 : 0.45;
    // A named company must NOT override the domain: a JD saying "payments, ideally from
    // Flipkart" is not satisfied by a Flipkart PM who did Assets & Inventory. Being at a named
    // company is a floor (real evidence), not a free pass — the domain still decides the top.
    if (named) s = Math.max(s, 0.7);
    if (named && (curHit || pastHit)) s = 1; // named company AND the right domain = best signal
    return s;
  }

  if (named) return 1; // companies named, no domain asked → they're exactly who was requested
  if (q.companies.length) return 0.3; // companies named and none matched — a real miss
  return 0.5; // nothing company-ish asked → neutral
}

function tierScore(p: Person, q: StructuredQuery): number {
  const cos = companies(p);
  const tiers = cos.map(companyTier);
  const wantTier1 = q.companyTier.some((t) => /tier_?1|faang|unicorn|big4/i.test(t));
  if (q.companyTier.length) {
    if (meetsTier(cos, wantTier1)) return 1; // pedigree explicitly required, and met
    // Every company they've worked at is unknown to us. That's OUR data gap, not their flaw —
    // score it uncertain rather than disqualifying (a real Tier-3 still gets the 0.15).
    if (tiers.length && tiers.every((t) => t === "unknown")) return 0.35;
    return 0.15;
  }
  // not requested → reward actual quality mildly so blue-chips edge ahead, but don't dominate
  if (tiers.includes("tier1")) return 0.7;
  if (tiers.includes("tier2")) return 0.55;
  if (tiers.includes("tier3")) return 0.45;
  return 0.5; // nothing known → neutral, never a penalty
}

function locationScore(p: Person, q: StructuredQuery): number {
  const loc = lc(p.location);
  if (q.locations.length) return q.locations.some((l) => loc.includes(lc(l))) ? 1 : 0.15;
  if (q.india) return /india|bengaluru|bangalore|mumbai|delhi|pune|chennai|hyderabad|gurgaon|gurugram|noida|kolkata|ahmedabad|jaipur/.test(loc) ? 1 : 0.4;
  return 0.6;
}

/** Recency: fresher data ranks slightly higher (0.92–1.0). Honest proxy — we don't
 *  have reliable per-role end-dates, so we use data freshness, not role chronology. */
function recencyFactor(p: Person): number {
  const t = Date.parse(p.last_updated);
  if (!Number.isFinite(t)) return 0.97;
  const days = (Date.now() - t) / 86_400_000;
  if (days < 90) return 1;
  if (days < 365) return 0.97;
  return 0.93;
}

/** Full weighted business score with component breakdown (breakdown aids debugging/observability). */
export function businessScore(p: Person, q: StructuredQuery): ScoreBreakdown {
  const parts = {
    role: roleScore(p, q),
    seniority: seniorityScore(p, q),
    skills: skillsScore(p, q),
    experience: experienceScore(p, q),
    career: careerScore(p, q),
    tier: tierScore(p, q),
    location: locationScore(p, q),
  };
  const raw =
    parts.role * WEIGHTS.role +
    parts.seniority * WEIGHTS.seniority +
    parts.skills * WEIGHTS.skills +
    parts.experience * WEIGHTS.experience +
    parts.career * WEIGHTS.career +
    parts.tier * WEIGHTS.tier +
    parts.location * WEIGHTS.location;
  // small completeness nudge so richer profiles edge ahead on ties
  const completeness = Math.min(1, (p.profile_strength ?? 0) / 100) * 3;
  // HYBRID: blend in semantic similarity (cosine 0–1 from the vector lane). A profile that
  // matches the meaning of the JD gets lifted even if it doesn't share the exact keywords —
  // so genuinely relevant people aren't buried by keyword-only scoring.
  const sim = Math.max(0, Math.min(1, Number((p as any)._sim) || 0));
  const semantic = sim > 0 ? (sim - 0.2) * 28 : 0; // ~0 below 0.2 similarity, up to +22 for a strong match
  // learning loop: gentle lift for people like those the team has saved/contacted before
  const learned = prefBoost(p);
  const total = Math.round((raw + completeness + semantic + learned) * recencyFactor(p));
  return { total: Math.max(0, Math.min(100, total)), ...parts };
}

// Function/role-family cues per family. Deliberately LENIENT — a "Growth Product Manager"
// hits both marketing (growth) and product_management (product manager), so cross-function
// people are never mistaken for off-function. Used only to ORDER the cheap tail, never to drop.
const FAMILY_CUES: Record<string, RegExp> = {
  product_management: /\b(product manager|product management|pm|apm|group product|cpo|head of product|product owner|product lead)\b/,
  engineering: /\b(engineer|developer|swe|sde|software|backend|frontend|full[- ]?stack|architect|tech lead|devops)\b/,
  design: /\b(design|designer|ux|ui|user experience|visual|interaction|graphic)\b/,
  analytics: /\b(analyst|analytics|data scientist|data science|bi|business intelligence|data engineer)\b/,
  marketing: /\b(marketing|growth|brand|content|seo|sem|demand gen|performance marketing|social media|community)\b/,
  category: /\b(category|merchandis|buying|sourcing|assortment)\b/,
};

/** Does this person plausibly belong to a requested function? Lenient by design: matches on the
 *  structured role-family enum (binary/yc) OR title/headline cues, so a genuine cross-function
 *  candidate always passes. Returns true when no function was requested. */
export function matchesFunction(p: Person, q: StructuredQuery): boolean {
  if (!q.roleFamilies.length) return true;
  const d = dossier(p);
  const fam = lc(d.roleFamily);
  const hay = `${lc(p.current_title)} ${lc(p.headline)} ${fam} ${lc(d.tagline)}`;
  return q.roleFamilies.some((f) => {
    if (fam && fam.includes(lc(f))) return true; // structured enum match (binary/yc)
    const cue = FAMILY_CUES[f];
    return cue ? cue.test(hay) : hay.includes(lc(f).replace(/_/g, " "));
  });
}

/** Rank the retrieved pool by business score, return the strongest first (for the AI cut).
 *  Ties break DETERMINISTICALLY by id: many candidates land on the same integer score, and
 *  without a stable second key their order follows whatever sequence the DB happened to return
 *  — so the same search silently reshuffles who makes the cut between runs. (This is the exact
 *  flaw tpf-profile-matcher's own audit blames for candidates swapping in and out of its top-20.) */
export function preRank(people: Person[], q: StructuredQuery): Person[] {
  return people
    .map((p) => ({ p, s: businessScore(p, q).total }))
    .sort((a, b) => b.s - a.s || a.p.id.localeCompare(b.p.id))
    .map((x) => x.p);
}
