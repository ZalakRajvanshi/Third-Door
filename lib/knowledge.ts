// ───────────────────────────────────────────────────────────────────────────
// Domain knowledge — the "stronger context" layer. Turns shallow keyword
// matching into real understanding:
//   • company prestige (Tier-1/2/3) instead of matching the literal word "Tier-1"
//   • skill synonyms ("experimentation" ⇒ A/B testing, feature flags, growth loops…)
//   • role/experience expansion ("marketplace PM" ⇒ Uber, Swiggy, Flipkart, Meesho…)
// All static + deterministic = zero latency, zero cost, and easy to audit/extend.
// ───────────────────────────────────────────────────────────────────────────

import { lookupCompany } from "@/lib/companies";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+ ]/g, " ").replace(/\s+/g, " ").trim();

// ── Company prestige ────────────────────────────────────────────────────────
// Tier-1 = global blue-chips + India's most selective/marquee companies.
// Tier-2 = strong unicorns / well-funded, recognized scale-ups.
// (Tier-3 = everything else — early-stage / smaller / local.)
const TIER1 = [
  // global big tech
  "google", "alphabet", "meta", "facebook", "microsoft", "amazon", "aws", "apple", "netflix",
  "openai", "anthropic", "nvidia", "stripe", "uber", "airbnb", "atlassian", "notion", "figma",
  "linkedin", "salesforce", "adobe", "oracle", "databricks", "snowflake", "palantir", "coinbase",
  // India marquee / unicorn blue-chips
  "flipkart", "swiggy", "zomato", "razorpay", "cred", "phonepe", "paytm", "zerodha", "groww",
  "freshworks", "postman", "browserstack", "zoho", "meesho", "myntra", "ola", "dream11", "navi",
  "sprinklr", "druva", "icertis", "innovaccer", "gupshup", "chargebee", "hasura", "atlan",
  // global consulting / finance pedigree (Big-4 + MBB)
  "mckinsey", "bain", "boston consulting", "bcg", "deloitte", "pwc", "ey", "ernst", "kpmg",
  "goldman sachs", "morgan stanley", "jpmorgan", "jp morgan",
];
const TIER2 = [
  "walmart", "phonepe", "servicenow", "vmware", "sap", "intuit", "twilio", "hubspot", "segment",
  "unacademy", "byju", "vedantu", "upgrad", "sharechat", "urban company", "urbancompany", "delhivery",
  "licious", "cars24", "spinny", "lenskart", "nykaa", "pharmeasy", "1mg", "practo", "mamaearth",
  "pine labs", "pinelabs", "bharatpe", "slice", "jupiter", "khatabook", "zepto", "blinkit", "dunzo",
  "thoughtworks", "publicis sapient", "epam", "globant", "mu sigma", "fractal", "tiger analytics",
];

export type Tier = "tier1" | "tier2" | "tier3" | "unknown";

/** Classify a company by prestige. Prefers the enriched companies_metadata (5.9k companies),
 *  falls back to the hardcoded lists when a company isn't in the dataset.
 *  Returns "unknown" when we genuinely have no data — never a silent "tier3". */
export function companyTier(name: string | null | undefined): Tier {
  if (!name) return "unknown";
  const info = lookupCompany(name); // real data first (tier/brand-strength/flags)
  // an un-enriched row still lets the hardcoded list have a say before we give up
  if (info && info.tier !== "unknown") return info.tier;
  const n = norm(name);
  if (matchesKnown(n, TIER1)) return "tier1";
  if (matchesKnown(n, TIER2)) return "tier2";
  return "unknown"; // not in the data and not a known name — we don't know, so don't guess
}

/**
 * Match a company name against a known-brand list WITHOUT substring false-positives.
 * `n.includes(c)` was catastrophic here: "ey" (Ernst & Young) matched Honeywell / Disney /
 * Money View / Greyorange; "ola" matched Motorola and Coca Cola; "meta" matched Metabase.
 * All were then reported to the ranker as verified Tier-1 — which the prompt orders it to trust.
 *   • multi-word entries ("boston consulting") — substring is safe, they're distinctive
 *   • short entries (<= 4 chars: ey, ola, meta, navi, tata, cred, zoho) — WHOLE-NAME match only
 *   • everything else — whole-TOKEN match, so "Google India" hits but "Metabase" doesn't
 */
function matchesKnown(n: string, list: string[]): boolean {
  const tokens = new Set(n.split(" ").filter(Boolean));
  return list.some((c) => (c.includes(" ") ? n.includes(c) : c.length <= 4 ? n === c : tokens.has(c)));
}

/** Does this person's background satisfy a requested pedigree (tier1 / tier2+)?
 *  "unknown" never satisfies a pedigree ask — but it isn't treated as a failure either
 *  (see tierScore, which scores unknown as uncertain rather than disqualifying). */
export function meetsTier(companies: string[], wantTier1: boolean): boolean {
  const tiers = companies.map(companyTier);
  if (wantTier1) return tiers.includes("tier1");
  return tiers.includes("tier1") || tiers.includes("tier2");
}

// ── Skill / concept synonyms ────────────────────────────────────────────────
// Each key expands to related terms so a query for the concept also retrieves
// people who describe the same thing in different words.
const SKILL_SYNONYMS: Record<string, string[]> = {
  experimentation: ["a/b testing", "ab testing", "split testing", "feature flags", "growth loops", "product analytics", "conversion optimization", "cro", "funnel analysis", "experiment"],
  growth: ["acquisition", "retention", "activation", "funnel", "conversion", "growth loops", "user growth", "growth hacking", "plg", "product led growth"],
  "ai pm": ["llm", "rag", "prompt engineering", "ai agents", "agents", "embeddings", "evaluation", "evals", "mcp", "tool calling", "genai", "generative ai", "fine tuning"],
  "ai product": ["llm", "rag", "prompt engineering", "ai agents", "embeddings", "genai", "generative ai", "evals"],
  ml: ["machine learning", "deep learning", "pytorch", "tensorflow", "model training", "mlops"],
  analytics: ["sql", "data analysis", "dashboards", "tableau", "power bi", "looker", "metrics", "reporting"],
  marketing: ["brand", "performance marketing", "demand generation", "demand gen", "seo", "sem", "content", "campaigns", "go to market", "gtm"],
  design: ["ux", "ui", "product design", "figma", "design systems", "interaction design", "user research"],
  sales: ["business development", "bd", "account executive", "quota", "pipeline", "revenue", "saas sales"],
  fintech: ["payments", "lending", "banking", "upi", "neobank", "wealth", "insurance", "credit"],
  "0 to 1": ["zero to one", "0-1", "founding", "built from scratch", "early stage", "mvp", "first product"],
  leadership: ["led a team", "managed", "head of", "director", "vp", "people management", "team of"],
  "product management": ["product manager", "roadmap", "prioritization", "discovery", "user research", "prd", "stakeholder", "gtm", "north star", "metrics", "backlog", "product strategy"],
  "product designer": ["ux", "ui", "figma", "design systems", "user research", "prototyping", "interaction design", "wireframes", "product design"],
};

// Concepts whose meaning is best captured by example companies/products.
const EXPERIENCE_SYNONYMS: Record<string, string[]> = {
  marketplace: ["uber", "swiggy", "zomato", "doordash", "airbnb", "meesho", "flipkart", "ola", "urban company", "two sided", "two-sided"],
  "quick commerce": ["zepto", "blinkit", "dunzo", "instamart", "10 minute", "q-commerce", "qcommerce"],
  d2c: ["mamaearth", "boat", "licious", "nykaa", "sugar", "direct to consumer", "consumer brand"],
  edtech: ["byju", "unacademy", "vedantu", "upgrad", "physics wallah", "coursera"],
  saas: ["b2b saas", "subscription", "arr", "mrr", "enterprise software", "freshworks", "zoho", "postman"],
  consumer: ["b2c", "consumer app", "mobile app", "millions of users", "dau", "mau"],
};

const ALL_SYNONYMS: Record<string, string[]> = { ...SKILL_SYNONYMS, ...EXPERIENCE_SYNONYMS };

/**
 * Expand a set of query terms with their domain synonyms.
 * "experimentation" → also search a/b testing, feature flags, etc.
 * Returns a deduped, lowercased, length-capped list good for an OR keyword filter.
 */
export function expandTerms(terms: string[], cap = 14): string[] {
  const out = new Set<string>();
  for (const raw of terms) {
    const t = norm(raw);
    if (t.length < 2) continue;
    out.add(t);
    for (const [key, syns] of Object.entries(ALL_SYNONYMS)) {
      if (t === key || t.includes(key) || key.includes(t)) syns.forEach((s) => out.add(s));
    }
  }
  return Array.from(out).slice(0, cap);
}

/** Expand a single concept (used by the scorer to test skill overlap semantically). */
export function relatedTerms(concept: string): string[] {
  const t = norm(concept);
  const hit = ALL_SYNONYMS[t];
  return hit ? [t, ...hit] : [t];
}

// ── City aliases ────────────────────────────────────────────────────────────
// Recruiters say "Bangalore"; the DB stores "Bengaluru". Without this, a city in
// the query silently drops most matches (luma stores only the canonical spelling).
const CITY_SYNONYMS: Record<string, string[]> = {
  bangalore: ["bangalore", "bengaluru"], bengaluru: ["bangalore", "bengaluru"],
  gurgaon: ["gurgaon", "gurugram"], gurugram: ["gurgaon", "gurugram"],
  mumbai: ["mumbai", "bombay"], bombay: ["mumbai", "bombay"],
  delhi: ["delhi", "new delhi"], "new delhi": ["delhi", "new delhi"],
  kolkata: ["kolkata", "calcutta"], calcutta: ["kolkata", "calcutta"],
  chennai: ["chennai", "madras"], madras: ["chennai", "madras"],
  pune: ["pune", "poona"], poona: ["pune", "poona"],
  hyderabad: ["hyderabad", "secunderabad"],
  noida: ["noida", "greater noida"],
};

/** All spellings a city query should match (e.g. "Bangalore" → bangalore, bengaluru). */
export function cityVariants(name: string): string[] {
  const n = norm(name);
  return CITY_SYNONYMS[n] ?? [n];
}
