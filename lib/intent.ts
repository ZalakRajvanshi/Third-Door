import type { StructuredQuery } from "@/lib/types";
import { callAI, hasLLM, extractJson } from "@/lib/ai";

// Intent Engine v2: plain-language hiring ask → structured query with every relevance lever.
// Works for any role (tech and non-tech). Uses OpenAI; minimal heuristic fallback.

const ROLE_FAMILIES = ["product_management", "engineering", "design", "analytics", "marketing", "category"];

/** Common-sense inference: more years asked → expect more seniority; leadership cues → leadership.
 *  So "8+ years" or "lead a team" biases toward senior/leadership people even if not spelled out. */
function inferSeniority(seniority: string[], yoeMin: number | null, raw: string): string[] {
  const s = new Set(seniority.map((x) => x.toLowerCase()));
  const t = raw.toLowerCase();
  if (/\b(head of|vp\b|chief|cxo|cto|cpo|cmo|director|founding|leadership|own the|build the team)\b/.test(t)) s.add("leadership");
  if (/\b(lead|principal|staff|senior|sr\.)\b/.test(t)) s.add("senior");
  if (yoeMin != null) {
    if (yoeMin >= 12) { s.add("leadership"); s.add("senior"); }
    else if (yoeMin >= 7) s.add("senior");
    else if (yoeMin >= 4) s.add("mid");
  }
  return Array.from(s);
}

/** Pull an explicit "how many" out of a prompt — "50 profiles", "top 100", "give me 20". */
function extractCount(t: string): number | null {
  const m =
    t.match(/\b(\d{1,4})\s*(?:profiles|people|candidates|results|names|matches|folks|persons?)\b/) ||
    t.match(/\b(?:top|show|give\s+me|list|find|need|want|get\s+me)\s+(\d{1,4})\b/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 && n <= 1000 ? n : null;
}

export function heuristicQuery(raw: string): StructuredQuery {
  const t = raw.toLowerCase();
  const yoeMatch = t.match(/(\d+)\s*\+?\s*(?:years|yrs|y)\b/);
  const families: string[] = [];
  if (/\b(engineer|developer|swe|backend|frontend|sde|ml|ai eng)/.test(t)) families.push("engineering");
  if (/\b(designer|design|ux|ui)/.test(t)) families.push("design");
  if (/\b(product manager|pm|product)\b/.test(t)) families.push("product_management");
  if (/\b(growth|marketing|brand|content|seo|demand)\b/.test(t)) families.push("marketing");
  if (/\b(analyst|analytics|data scientist|data)\b/.test(t)) families.push("analytics");
  const tier: string[] = [];
  if (/tier[\s-]?1|faang|maang/.test(t)) tier.push("tier1");
  if (/unicorn/.test(t)) tier.push("unicorn");
  const yoeMin = yoeMatch ? parseInt(yoeMatch[1]) : null;
  return {
    raw, roles: [], roleFamilies: families, seniority: inferSeniority([], yoeMin, raw),
    yoeMin, yoeMax: null,
    locations: [], india: /india|bengaluru|bangalore|mumbai|delhi|pune|chennai|hyderabad|gurgaon|gurugram|noida/.test(t),
    companyTier: tier, domains: [], compMinLpa: null, compMaxLpa: null, signals: [], skills: [],
    keywords: t.replace(/[^a-z0-9+ ]/g, " ").split(/\s+/).filter((w) => w.length > 2).slice(0, 8),
    hypotheses: [raw], mustHave: [], niceToHave: [], wantCount: extractCount(t),
  };
}

export async function parseIntent(raw: string): Promise<StructuredQuery> {
  if (!hasLLM) return heuristicQuery(raw);
  try {
    const text = await callAI(
      [
        {
          role: "system",
          content:
            `You convert a recruiter's hiring request into a JSON search spec for an Indian-market talent database. ` +
            `The request may be a short phrase OR a full JOB DESCRIPTION (possibly with a short priority NOTE at the top). ` +
            `If a NOTE is present, treat it as the recruiter's emphasis and let it override/sharpen the JD. ` +
            `From a long JD, distil only what matters for finding people — ignore boilerplate (company blurb, EEO, perks, "how to apply"). ` +
            `Handle ANY role — tech and non-tech (growth, marketing, sales, ops, finance, design, product, analytics).`,
        },
        {
          role: "user",
          content:
            `Request:\n"""\n${raw.slice(0, 8000)}\n"""\n\nReturn ONLY JSON with these keys:\n` +
            `roleFamilies: array, each one of [${ROLE_FAMILIES.join(", ")}] (best fit; growth→["marketing","product_management"]).\n` +
            `seniority: array of [intern,junior,mid,senior,staff,leadership].\n` +
            `yoeMin: number or null (e.g. "8+ years"→8, "5-8"→5). yoeMax: number or null.\n` +
            `india: boolean (true if India / an Indian city is implied).\n` +
            `locations: array of city names mentioned.\n` +
            `companyTier: array subset of ["tier1","faang","unicorn","big4"] — ONLY when the request explicitly names pedigree (Tier-1, top/marquee company, FAANG/MAANG, unicorn, Big 4). "startup" / "worked at a startup" is NOT a tier — leave companyTier empty and instead consider signals. Default to [].\n` +
            `domains: array of industry tags mentioned (e.g. fintech, payments, lending, saas, b2b, ecommerce, d2c, quick_commerce, edtech, healthtech, consumer, marketplace, ai).\n` +
            `compMinLpa / compMaxLpa: number or null (LPA, e.g. "30-40 LPA").\n` +
            `signals: array of [growth_pm, ai_pm, zero_to_one, founder, international, consulting, iit_iim, pnl_ownership] if implied.\n` +
            `roles: array of the literal role titles. keywords: 4-8 salient terms.\n` +
            `skills: array of concrete skills/tools implied (e.g. "experimentation", "a/b testing", "rag", "sql").\n` +
            `mustHave: array of the HARD requirements a candidate must satisfy (e.g. "8+ years", "Tier-1 company", "B2B SaaS"). Only true deal-breakers.\n` +
            `niceToHave: array of bonus signals that lift a candidate but aren't required.\n` +
            `hypotheses: 3-6 distinct candidate personas (short phrases — direct, adjacent, proven-scaler, pedigree).\n` +
            `No prose.`,
        },
      ],
      900
    );
    const p = extractJson<Partial<StructuredQuery>>(text);
    if (!p) return heuristicQuery(raw);
    const arr = (v: unknown) => (Array.isArray(v) ? (v as string[]).map(String) : []);
    return {
      raw,
      roles: arr(p.roles),
      roleFamilies: arr(p.roleFamilies).filter((f) => ROLE_FAMILIES.includes(f)),
      seniority: inferSeniority(arr(p.seniority), typeof p.yoeMin === "number" ? p.yoeMin : null, raw),
      yoeMin: typeof p.yoeMin === "number" ? p.yoeMin : null,
      yoeMax: typeof p.yoeMax === "number" ? p.yoeMax : null,
      locations: arr(p.locations),
      india: p.india === true || arr(p.locations).length > 0,
      companyTier: arr(p.companyTier),
      domains: arr(p.domains).map((d) => d.toLowerCase()),
      compMinLpa: typeof p.compMinLpa === "number" ? p.compMinLpa : null,
      compMaxLpa: typeof p.compMaxLpa === "number" ? p.compMaxLpa : null,
      signals: arr(p.signals),
      skills: arr(p.skills),
      keywords: arr(p.keywords),
      hypotheses: arr(p.hypotheses).slice(0, 6),
      mustHave: arr(p.mustHave),
      niceToHave: arr(p.niceToHave),
      wantCount: extractCount(raw.toLowerCase()),
    };
  } catch (e) {
    console.error("[intent] failed, heuristic:", e);
    return heuristicQuery(raw);
  }
}
