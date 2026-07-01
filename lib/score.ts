import type { Person, StructuredQuery } from "@/lib/types";
import { companyTier, meetsTier, relatedTerms, expandTerms } from "@/lib/knowledge";
import { lookupCompany } from "@/lib/companies";
import { prefBoost } from "@/lib/learning";

// ───────────────────────────────────────────────────────────────────────────
// Stage-4 business score — a transparent, deterministic 0–100 that decides which
// candidates are worth (token-costly) OpenAI ranking. Weighted exactly per spec:
//   role 30 · skills 20 · experience 20 · industry 10 · company tier 10 · location 10
// Plus a mild recency factor (fresher data ranks slightly higher).
// Fast (pure JS, no I/O), so we can score the whole retrieved pool every search.
// ───────────────────────────────────────────────────────────────────────────

const WEIGHTS = { role: 30, skills: 20, experience: 20, industry: 10, tier: 10, location: 10 };

const lc = (s: unknown) => String(s ?? "").toLowerCase();

export interface ScoreBreakdown {
  total: number; // 0–100
  role: number; skills: number; experience: number; industry: number; tier: number; location: number;
}

function dossier(p: Person) { return (p.dossier ?? {}) as any; }

/** All the company names we can attribute to a person (current + past + flag hints). */
function companies(p: Person): string[] {
  const out = [p.company, ...p.experience.map((e) => e.company)].filter(Boolean) as string[];
  const flags: string[] = Array.isArray(dossier(p).flags) ? dossier(p).flags : [];
  // luma/yc flags like "Ex-FAANG", "Big tech", "Tier: tier1" → treat as tier1 evidence
  if (flags.some((f) => /faang|big tech|unicorn|tier-1|tier:\s*(tier_?1|faang|unicorn)/i.test(f))) out.push("google");
  return out;
}

function roleScore(p: Person, q: StructuredQuery): number {
  const hay = `${lc(p.current_title)} ${lc(p.headline)} ${lc(dossier(p).tagline)}`;
  const fam = lc(dossier(p).roleFamily);
  // literal role phrases the recruiter used
  const roleTerms = [...q.roles, ...q.keywords].map(lc).filter((t) => t.length > 2);
  const hits = roleTerms.filter((t) => hay.includes(t)).length;
  let s = roleTerms.length ? hits / roleTerms.length : 0.4;
  // role-family alignment (DB enum) is strong evidence
  if (q.roleFamilies.length && q.roleFamilies.some((f) => fam.includes(lc(f)) || hay.includes(lc(f).replace(/_/g, " ")))) s = Math.max(s, 0.85);
  // seniority alignment
  if (q.seniority.length && q.seniority.some((sv) => hay.includes(lc(sv)))) s = Math.min(1, s + 0.1);
  return Math.max(0, Math.min(1, s));
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

function industryScore(p: Person, q: StructuredQuery): number {
  if (!q.domains.length) return 0.5;
  // the company's real domains from companies_metadata are the strongest, cleanest signal
  const coDomains = [p.company, ...p.experience.map((e) => e.company)]
    .flatMap((c) => lookupCompany(c)?.domains ?? []).map(lc);
  if (coDomains.length && q.domains.some((d) => coDomains.includes(lc(d)))) return 1;
  // else fall back to text/dossier evidence
  const want = q.domains.flatMap((d) => expandTerms([d], 8));
  const hay = [lc(p.summary), lc(p.company), ...(dossier(p).domains ?? []).map(lc)].join(" ");
  return q.domains.some((d) => want.some((w) => hay.includes(w)) || hay.includes(lc(d))) ? 1 : 0.2;
}

function tierScore(p: Person, q: StructuredQuery): number {
  const cos = companies(p);
  const wantTier1 = q.companyTier.some((t) => /tier_?1|faang|unicorn|big4/i.test(t));
  if (q.companyTier.length) return meetsTier(cos, wantTier1) ? 1 : 0.15; // pedigree explicitly required
  // not requested → reward actual quality mildly so blue-chips edge ahead, but don't dominate
  const best = cos.map(companyTier);
  return best.includes("tier1") ? 0.7 : best.includes("tier2") ? 0.55 : 0.45;
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
    skills: skillsScore(p, q),
    experience: experienceScore(p, q),
    industry: industryScore(p, q),
    tier: tierScore(p, q),
    location: locationScore(p, q),
  };
  const raw =
    parts.role * WEIGHTS.role +
    parts.skills * WEIGHTS.skills +
    parts.experience * WEIGHTS.experience +
    parts.industry * WEIGHTS.industry +
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

/** Rank the retrieved pool by business score, return the strongest first (for the AI cut). */
export function preRank(people: Person[], q: StructuredQuery): Person[] {
  return people
    .map((p) => ({ p, s: businessScore(p, q).total }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.p);
}
