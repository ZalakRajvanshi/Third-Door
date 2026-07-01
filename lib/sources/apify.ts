import type { Person, SourceAdapter, StructuredQuery } from "@/lib/types";
import { COST } from "@/lib/config";

// External source (expensive — bills per result). Only invoked by the orchestrator as a
// GAP-FILL when the database can't supply enough strong matches. See lib/config.ts.
//
// Configure with:
//   APIFY_TOKEN     — your Apify API token
//   APIFY_ACTOR_ID  — the actor to run, e.g. "apimaestro~linkedin-profile-search"
//
// Actor input/output shapes vary; normalizeApify() is defensive and may need a small
// tweak to match the exact actor you choose.

const TOKEN = process.env.APIFY_TOKEN;
const ACTOR = process.env.APIFY_ACTOR_ID;
export const hasApify = Boolean(TOKEN && ACTOR);

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/** Best-effort mapping of an arbitrary Apify person record → unified Person. */
function normalizeApify(raw: Record<string, any>, i: number): Person {
  const name = str(raw.fullName) ?? str(raw.name) ?? ([raw.firstName, raw.lastName].filter(Boolean).join(" ") || "Unknown");
  const title = str(raw.headline) ?? str(raw.title) ?? str(raw.jobTitle) ?? str(raw.position);
  const company = str(raw.companyName) ?? str(raw.company) ?? str(raw.currentCompany);
  const location = str(raw.location) ?? str(raw.addressWithCountry) ?? str(raw.city);
  const url = str(raw.url) ?? str(raw.profileUrl) ?? str(raw.linkedinUrl);
  const skills = Array.isArray(raw.skills)
    ? raw.skills.map((s: any) => (typeof s === "string" ? s : s?.name)).filter(Boolean).slice(0, 12)
    : [];

  return {
    id: `apify:${url ?? raw.id ?? `${name}-${i}`}`,
    name,
    headline: title,
    current_title: title,
    company,
    location,
    summary: str(raw.summary) ?? str(raw.about) ?? null,
    experience: Array.isArray(raw.experience)
      ? raw.experience.slice(0, 3).map((e: any) => ({ company: str(e.company) ?? "—", title: str(e.title) ?? "" }))
      : company
      ? [{ company, title: title ?? "" }]
      : [],
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
      const input = {
        // Generic input keys most search actors accept; harmless extras are ignored.
        searchQuery: query.raw,
        queries: query.hypotheses.slice(0, 3),
        keywords: [...query.roles, ...query.skills].slice(0, 5),
        location: query.locations[0] ?? "",
        maxItems: COST.APIFY_MAX_RESULTS,
        maxResults: COST.APIFY_MAX_RESULTS,
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
