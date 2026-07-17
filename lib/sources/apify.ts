import type { Person, SourceAdapter, StructuredQuery } from "@/lib/types";
import { COST } from "@/lib/config";

// External source (expensive — bills per result). Only invoked by the orchestrator as a
// GAP-FILL when the database can't supply enough strong matches. See lib/config.ts.
//
// Configure with:
//   APIFY_TOKEN     — your Apify API token
//   APIFY_ACTOR_ID  — the actor to run. Built for "harvestapi~linkedin-profile-search"
//                     (the discovery actor the data pipeline uses); `input` below matches
//                     ITS schema. Point this at a different actor and the input keys change.
//
// COST — this actor is PAY_PER_EVENT, and the bill scales with how many pages it walks:
//   full-profile             $4  / 1k profiles
//   full-profile-with-email  $10 / 1k profiles
//   minimum charge per run   $0.10
// maxItems is the safety rail; MAX_USD_PER_SEARCH derives it. Per the team's own retro
// ("burned $12 once"), never widen this without extrapolating the full-run cost first.
//
// normalizeApify() is deliberately defensive about output field names.

const TOKEN = process.env.APIFY_TOKEN;
const ACTOR = process.env.APIFY_ACTOR_ID;
export const hasApify = Boolean(TOKEN && ACTOR);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * Map a harvestapi/linkedin-profile-search record → unified Person.
 *
 * VERIFIED against a real run — the previous "best-effort" guesses were all wrong for this
 * actor, and each one silently produced a broken candidate:
 *   • company  read `companyName` at the top level → always NULL. It lives in
 *     currentPosition[].companyName. A null company guts careerScore (34/100 — the heaviest
 *     signal) and tierScore, so a genuine Razorpay PM would have scored like a nobody.
 *   • location read `location` as a string → always NULL. It's an object
 *     {linkedinText, parsed:{...}}.
 *   • experience read `e.company`/`e.title` → the actor uses `companyName`/`position`, so every
 *     past role became the literal placeholder "—".
 * Fallbacks to the old generic keys are kept so a different actor still degrades gracefully.
 */
function normalizeApify(raw: Record<string, any>, i: number): Person {
  const name = str(raw.fullName) ?? str(raw.name) ?? ([raw.firstName, raw.lastName].filter(Boolean).join(" ") || "Unknown");
  const positions: any[] = Array.isArray(raw.currentPosition) ? raw.currentPosition : [];
  const history: any[] = Array.isArray(raw.experience) ? raw.experience : [];
  const cur = positions[0] ?? history[0] ?? {};

  // headline is marketing ("Lead PM | Global Payments | Wallets | UPI • SEPA • FPS | FinTech");
  // the actual position title is cleaner for matching and for the card.
  const title = str(cur.position) ?? str(raw.headline) ?? str(raw.title) ?? str(raw.jobTitle) ?? str(raw.position);
  const company = str(cur.companyName) ?? str(raw.companyName) ?? str(raw.company) ?? str(raw.currentCompany);
  const location =
    str(raw.location?.linkedinText) ?? str(raw.location?.parsed?.text) ?? str(raw.location?.parsed?.country) ??
    str(raw.location) ?? str(raw.addressWithCountry) ?? str(raw.city);
  const url = str(raw.linkedinUrl) ?? str(raw.url) ?? str(raw.profileUrl);
  // skills are [{name, positions}], not strings
  const skills: string[] = [...(Array.isArray(raw.skills) ? raw.skills : []), ...(Array.isArray(raw.topSkills) ? raw.topSkills : [])]
    .map((s: any) => (typeof s === "string" ? s : str(s?.name)))
    .filter((s): s is string => Boolean(s))
    .slice(0, 12);

  // FULL career graph, same as the DB pools: current first, then every past employer. This is
  // what lets "ex-Flipkart payments" match — matching on the current job alone misses it.
  const experience = history
    .map((e: any) => ({ company: str(e.companyName) ?? str(e.company) ?? "", title: str(e.position) ?? str(e.title) ?? "" }))
    .filter((e) => e.company)
    .slice(0, 12);
  if (!experience.length && company) experience.push({ company, title: title ?? "" });

  return {
    id: `apify:${url ?? raw.id ?? `${name}-${i}`}`,
    name,
    headline: str(raw.headline) ?? title,
    current_title: title,
    company,
    location,
    summary: str(raw.about) ?? str(raw.summary) ?? str(cur.description) ?? null,
    experience,
    skills,
    education: [],
    social_links: url ? [{ type: "linkedin", url }] : [],
    profile_strength: 60,
    confidence_score: 65,
    last_updated: new Date().toISOString(),
    _sources: [{ adapter: "apify", raw_id: String(raw.id ?? url ?? i), trust: 0.8 }],
  };
}

export const apifyAdapter: SourceAdapter = {
  name: "apify",
  async search(query: StructuredQuery): Promise<Person[]> {
    if (!hasApify) return [];
    try {
      // Run the actor synchronously and read its dataset items in one call.
      const endpoint = `https://api.apify.com/v2/acts/${ACTOR}/run-sync-get-dataset-items?token=${TOKEN}`;
      // Input matches harvestapi/linkedin-profile-search's real schema. The previous generic
      // shape (`location`, `queries`, `keywords`, `maxResults`) used keys this actor doesn't
      // have — they were silently ignored, so it would have run an unfiltered, needlessly
      // expensive search. Every filter we pass narrows the result set and therefore the bill.
      const locations = query.locations.length ? query.locations.slice(0, 3) : query.india ? ["India"] : [];
      const input: Record<string, unknown> = {
        searchQuery: query.raw,
        maxItems: COST.APIFY_MAX_RESULTS, // hard cap → bounds the spend (see MAX_USD_PER_SEARCH)
        // "Full" per the data contract: Short rows can't be upgraded later without re-paying.
        profileScraperMode: "Full",
        ...(locations.length ? { locations } : {}),
        ...(query.roles.length ? { currentJobTitles: query.roles.slice(0, 5) } : {}),
        // companies the JD named: match them CURRENT or PAST — a past stint is why someone fits
        ...(query.companies.length ? { currentCompanies: query.companies.slice(0, 5), pastCompanies: query.companies.slice(0, 5) } : {}),
      };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        console.error("[apify] run failed:", res.status, (await res.text()).slice(0, 160));
        return [];
      }
      const items = (await res.json()) as Record<string, any>[];
      return (items ?? []).slice(0, COST.APIFY_MAX_RESULTS).map(normalizeApify);
    } catch (e) {
      console.error("[apify] error:", e);
      return [];
    }
  },
};
