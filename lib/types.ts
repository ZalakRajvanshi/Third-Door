// ───────────────────────────────────────────────────────────────────────────
// The two contracts that must never leak source-specific shape past this file.
// Everything the UI sees is a `Person`. Everything a data source provides comes
// through a `SourceAdapter`. See SPEC.md §3 and ARCHITECTURE.md §1.
// ───────────────────────────────────────────────────────────────────────────

export interface Experience {
  company: string;
  title: string;
  start?: string;
  end?: string;
}

export interface Education {
  school: string;
  degree?: string;
}

export interface SocialLink {
  type: "linkedin" | "github" | "twitter" | "website" | string;
  url: string;
}

/** Internal provenance only — NEVER rendered to the user as a "source". */
export interface SourceRef {
  adapter: string; // e.g. "supabase", "apify"
  raw_id: string;
  trust: number; // 0–1
}

/** The structured profile detail the UI renders. Typed (not `unknown`) so scoring/ranking
 *  read real fields instead of `as any` — an untyped dossier is how the `seniority` field
 *  silently stayed null everywhere. */
export interface Dossier {
  years: number | null;
  seniority: string | null;
  roleFamily?: string | null; // role_family enum (binary/yc) or title_role/inferred_role (luma/ext/apify)
  overview: string | null; // career arc summary
  tagline: string | null; // one-liner / search summary
  bestFor: string[];
  notFor: string[];
  products: { name: string; impact?: string; description?: string }[];
  roles: { title: string; company: string; years?: string; metric?: string }[];
  scale: string | null;
  skills: string[];
  tools: string[];
  domains: string[];
  education: { degree?: string; field?: string; institution: string; year?: string | number }[];
  flags: string[];
}

/** The single unified shape every profile is normalized into before the UI. */
export interface Person {
  id: string;
  name: string;
  headline: string | null;
  current_title: string | null;
  company: string | null;
  location: string | null;
  summary: string | null;
  experience: Experience[];
  skills: string[];
  education: Education[];
  social_links: SocialLink[];
  profile_strength: number; // 0–100 (data completeness)
  confidence_score: number; // 0–100 (sure this is one real person)
  last_updated: string; // ISO
  _sources: SourceRef[]; // internal only
  dossier?: Dossier; // structured detail for the UI + scoring
}

/** Parsed intent + search strategies produced by the Intent Engine (v2). */
export interface StructuredQuery {
  raw: string;
  roles: string[];
  roleFamilies: string[];          // mapped to DB enum: product_management|engineering|design|analytics|marketing|category
  seniority: string[];             // intern|junior|mid|senior|staff|leadership
  yoeMin: number | null;           // "8+ years" → 8
  yoeMax: number | null;
  locations: string[];
  india: boolean;                  // India-only?
  companyTier: string[];           // faang|unicorn|big4|tier1  (signals to require/boost)
  domains: string[];               // fintech|saas|ecommerce|edtech|quick_commerce|d2c|healthtech…
  compMinLpa: number | null;       // comp band (LPA)
  compMaxLpa: number | null;
  signals: string[];               // growth_pm|ai_pm|zero_to_one|founder|international|consulting|iit_iim…
  skills: string[];
  keywords: string[];
  hypotheses: string[];            // 3–6 distinct persona "bets"
  mustHave: string[];              // hard requirements the candidate MUST satisfy
  niceToHave: string[];            // bonus signals that lift but aren't required
  embedText?: string;              // full text used for semantic embedding (the JD, when present)
  wantCount?: number | null;       // how many profiles the user explicitly asked for (null = dynamic)
}

/** A source of people. New sources = new adapters; nothing downstream changes. */
export interface SourceAdapter {
  name: string;
  search(query: StructuredQuery): Promise<Person[]>;
}

/** AI ranking output attached to a person for the UI. */
export interface RankedPerson {
  person: Person;
  score: number; // 0–100 match
  why: string[]; // why they match
  concerns: string[]; // honest trade-offs
  vetted?: boolean; // true = AI-vetted top tier; false = relevant tail (cheap-scored)
}
