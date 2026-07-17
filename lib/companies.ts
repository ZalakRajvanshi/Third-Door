import { createClient } from "@supabase/supabase-js";

// ───────────────────────────────────────────────────────────────────────────
// Company intelligence — the "recruiter brain" for companies. Loads the enriched
// companies_metadata table (~5.9k companies) ONCE into memory, so scoring/ranking
// knows each company's real tier, domains, brand strength, and peers — instead of
// a tiny hardcoded list. Lazy-loaded on first search, then cached in-process.
// ───────────────────────────────────────────────────────────────────────────

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SECRET_KEY;

/** "unknown" is NOT a low tier — it means we have no pedigree data for this company.
 *  Collapsing the two made us report "Tier-3 Bajaj Finserv" / "Angel One (Tier-3)" as fact
 *  and penalise the candidate for our own missing data. Absence of evidence ≠ evidence of absence. */
export type Tier = "tier1" | "tier2" | "tier3" | "unknown";

export interface CompanyInfo {
  name: string;
  tier: Tier;
  domains: string[];      // fintech, payments, saas, b2b, d2c, ecommerce, edtech, ai…
  brand: number;          // 0–100 brand strength
  flags: string[];        // FAANG, Unicorn, Big 4, Consulting, Bank…
  competitors: string[];  // peer companies (for "similar to X" reasoning)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
// Legal/geographic noise we strip so "Flipkart India Pvt Ltd" resolves to "flipkart".
// Deliberately does NOT include tech/technologies/global/group/solutions/systems/software/labs —
// those are load-bearing parts of real names, and stripping them merged distinct companies:
// "Tech Mahindra" -> "mahindra" (the auto conglomerate), "Tata Technologies" -> "tata".
const SUFFIX = /\b(pvt|private|ltd|limited|inc|incorporated|llp|llc|india|corp|corporation|co|company|the)\b/g;

function deriveTier(r: any): Tier {
  if (r.is_faang || r.is_unicorn || r.is_big4 || r.is_consulting) return "tier1";
  if (r.is_bank || r.is_nbfc) return "tier2";
  // brand_strength_score === null means the row was never enriched (78 rows — and they're big
  // names: Bajaj Finance, Angel One, Aditya Birla Capital). Don't invent a tier for them.
  if (r.brand_strength_score === null || r.brand_strength_score === undefined) return "unknown";
  const bs = Number(r.brand_strength_score) || 0;
  if (bs >= 60) return "tier1";
  if (bs >= 35) return "tier2";
  return "tier3"; // genuinely enriched AND low brand — a real Tier-3
}

function deriveDomains(r: any): string[] {
  const d = new Set<string>();
  if (r.primary_domain && r.primary_domain !== "other") d.add(String(r.primary_domain).toLowerCase());
  const map: [string, string[]][] = [
    ["is_payments_fintech", ["payments", "fintech"]], ["is_lending_fintech", ["lending", "fintech"]],
    ["is_wealth_fintech", ["wealth", "fintech"]], ["is_insurance_fintech", ["insurance", "fintech"]],
    ["is_consumer_fintech", ["fintech", "consumer"]], ["is_saas_b2b", ["saas", "b2b"]],
    ["is_d2c_brand", ["d2c"]], ["is_quick_commerce", ["quick_commerce"]], ["is_ecommerce", ["ecommerce"]],
    ["is_marketplace", ["marketplace"]], ["is_edtech", ["edtech"]], ["is_healthtech", ["healthtech"]],
    ["is_consumer_app", ["consumer"]], ["is_ai_native", ["ai"]], ["is_devtools", ["devtools", "b2b"]],
    ["is_fmcg", ["fmcg"]], ["is_bank", ["banking"]], ["is_nbfc", ["lending"]],
  ];
  for (const [flag, doms] of map) if (r[flag]) doms.forEach((x) => d.add(x));
  return Array.from(d);
}

function deriveFlags(r: any): string[] {
  const f: string[] = [];
  if (r.is_faang) f.push("FAANG");
  if (r.is_unicorn) f.push("Unicorn");
  if (r.is_big4) f.push("Big 4");
  if (r.is_consulting) f.push("Consulting");
  if (r.is_bank) f.push("Bank");
  return f;
}

// name → CompanyInfo. Built from normalized_key + canonical_name + aliases.
let CACHE: Map<string, CompanyInfo> | null = null;
let loading: Promise<void> | null = null;

async function load(): Promise<void> {
  if (!URL || !KEY) { CACHE = new Map(); return; }
  const client = createClient(URL, KEY);
  const map = new Map<string, CompanyInfo>();
  const cols =
    "canonical_name,normalized_key,aliases,tier,brand_strength_score,primary_domain,competitors," +
    "is_faang,is_unicorn,is_big4,is_consulting,is_bank,is_nbfc,is_payments_fintech,is_lending_fintech," +
    "is_wealth_fintech,is_insurance_fintech,is_consumer_fintech,is_saas_b2b,is_d2c_brand,is_quick_commerce," +
    "is_ecommerce,is_marketplace,is_edtech,is_healthtech,is_consumer_app,is_ai_native,is_devtools,is_fmcg";
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data, error } = (await client.from("companies_metadata").select(cols).range(from, from + PAGE - 1)) as { data: any[] | null; error: any };
    if (error) { console.error("[companies] load:", error.message.slice(0, 80)); break; }
    if (!data?.length) break;
    for (const r of data) {
      const info: CompanyInfo = {
        name: r.canonical_name, tier: deriveTier(r), domains: deriveDomains(r),
        brand: Number(r.brand_strength_score) || 0, flags: deriveFlags(r),
        competitors: Array.isArray(r.competitors) ? r.competitors.map(String) : [],
      };
      const keys = [r.normalized_key, r.canonical_name, ...(Array.isArray(r.aliases) ? r.aliases : [])]
        .filter(Boolean).map((k: string) => norm(k)).filter((k) => k.length > 1);
      for (const k of keys) if (!map.has(k)) map.set(k, info);
    }
    if (data.length < PAGE) break;
  }
  CACHE = map;
  console.log(`[companies] loaded ${map.size} keys`);
}

/** Load companies_metadata into memory once. Safe to await on every search (no-op after first). */
export function ensureCompanies(): Promise<void> {
  if (CACHE) return Promise.resolve();
  if (!loading) loading = load().finally(() => { loading = null; });
  return loading;
}

/** Resolve a raw company name from a profile to its enriched info (tier/domains/peers). */
export function lookupCompany(raw: string | null | undefined): CompanyInfo | null {
  if (!CACHE || !raw) return null;
  const n = norm(raw);
  if (CACHE.has(n)) return CACHE.get(n)!;
  // strip legal noise: "flipkart india pvt ltd" → "flipkart"
  const cleaned = n.replace(SUFFIX, " ").replace(/\s+/g, " ").trim();
  if (cleaned && CACHE.has(cleaned)) return CACHE.get(cleaned)!;
  // Progressively shorter leading token windows — but NEVER down to a single token when the
  // name has more. Collapsing to the first token handed unrelated companies a famous brand's
  // identity: "Meta Foods Pvt Ltd" → "meta" → Meta/FAANG/Tier-1, "Apple Hospitality" → "apple".
  // Real variants ("Flipkart India Pvt Ltd") are already handled by SUFFIX + the aliases column.
  const toks = cleaned.split(" ").filter(Boolean);
  for (let take = Math.min(3, toks.length); take >= 2; take--) {
    const key = toks.slice(0, take).join(" ");
    if (CACHE.has(key)) return CACHE.get(key)!;
  }
  return null;
}
