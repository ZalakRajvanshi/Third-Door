import type { Person, RankedPerson, StructuredQuery } from "@/lib/types";
import { callAI, hasLLM, extractJson } from "@/lib/ai";
import { companyTier } from "@/lib/knowledge";
import { relevantNotes } from "@/lib/learning";

// "Unrated" ≠ Tier-3. We have no pedigree data for that company (it's absent from
// companies_metadata or the row was never enriched — Bajaj Finance, Angel One et al).
// Saying "Tier-3" there is a false statement the model then repeats to the recruiter.
const tierLabel = (t: string) => (t === "tier1" ? "Tier-1" : t === "tier2" ? "Tier-2" : t === "tier3" ? "Tier-3" : "Unrated");

// Ranking Engine (the heart): for each person → match score + why + concerns.
// LLM-powered when a key exists; deterministic heuristic otherwise.

function heuristicRank(person: Person, q: StructuredQuery): RankedPerson {
  const hay = [
    person.headline,
    person.current_title,
    person.company,
    person.location,
    person.summary,
    ...person.skills,
    ...person.experience.map((e) => `${e.title} ${e.company}`),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const terms = Array.from(
    new Set([...q.roles, ...q.seniority, ...q.locations, ...q.skills].map((t) => t.toLowerCase()))
  ).filter(Boolean);

  const hits = terms.filter((t) => hay.includes(t));
  const coverage = terms.length ? hits.length / terms.length : 0.5;
  const score = Math.round(40 + coverage * 50 + (person.profile_strength / 100) * 10);

  // Factual reason built from real fields — years, current role+company, a verified signal.
  const d = (person.dossier ?? {}) as any;
  const bits: string[] = [];
  if (typeof d.years === "number") bits.push(`${d.years} yrs`);
  if (person.current_title && person.company) bits.push(`${person.current_title} at ${person.company}`);
  else if (person.current_title) bits.push(person.current_title);
  const tier = companyTier(person.company);
  if (tier === "tier1" || tier === "tier2") bits.push(tierLabel(tier)); // never assert a tier we don't have
  if (Array.isArray(d.flags) && d.flags[0] && !bits.some((b) => b.includes(d.flags[0]))) bits.push(d.flags[0]);
  const why = bits.length ? [bits.join(" · ")] : [`${person.current_title ?? "Candidate"} — overlaps with the brief.`];

  const concerns: string[] = [];
  const missingSkills = q.skills.filter((s) => !hay.includes(s.toLowerCase()));
  if (missingSkills.length) concerns.push(`No clear signal on: ${missingSkills.slice(0, 3).join(", ")}.`);
  if (q.locations.length && !q.locations.some((l) => hay.includes(l.toLowerCase())))
    concerns.push(`Location may not match (${person.location ?? "unknown"}).`);
  if (concerns.length === 0) concerns.push(`Not yet AI-vetted — verify depth in a quick call.`);

  return { person, score: Math.min(99, Math.max(35, score)), why, concerns };
}

export async function rankPeople(people: Person[], q: StructuredQuery): Promise<RankedPerson[]> {
  if (!hasLLM || people.length === 0) {
    return people.map((p) => heuristicRank(p, q)).sort((a, b) => b.score - a.score);
  }

  try {
    const compact = people.map((p) => {
      const d = (p.dossier ?? {}) as any;
      return {
        id: p.id,
        name: p.name,
        title: p.current_title,
        company: p.company,
        location: p.location,
        yoe: d.years ?? null,
        seniority: d.seniority ?? null,
        tier: tierLabel(companyTier(p.company)), // our VERIFIED prestige — don't let the model guess
        // PAST companies — "ex-Flipkart" is often the whole reason someone fits, and it's
        // invisible from the current employer alone. Capped to keep the payload cheap.
        past: p.experience.slice(1, 6).map((e) => e.company).filter(Boolean),
        domains: (d.domains ?? []).slice(0, 5),
        signals: (d.flags ?? []).slice(0, 6), // Ex-FAANG, Unicorn, IIT/IIM, Growth PM, ~35 LPA…
        summary: (p.summary ?? "").slice(0, 220),
      };
    });

    // Spell out exactly what the recruiter asked for, so the model scores against it.
    // The distilled JD — the intent engine already stripped boilerplate into these fields.
    // Sending THIS (≈120 tokens) beats both the lossy 6-token label AND the raw JD (thousands
    // of tokens of company blurb/perks): sharper signal, lower cost.
    const want = [
      q.roles.length ? `title: ${q.roles.join(" / ")}` : null,
      q.roleFamilies.length ? `function: ${q.roleFamilies.join("/")}` : null,
      q.seniority.length ? `seniority: ${q.seniority.join("/")}` : null,
      q.yoeMin != null ? `${q.yoeMin}+ years experience` : null,
      q.yoeMax != null ? `at most ${q.yoeMax} years` : null,
      q.companyTier.length ? `pedigree: ${q.companyTier.join("/")} (Tier-1)` : null,
      q.companies.length ? `target companies (current OR past counts): ${q.companies.join(", ")}` : null,
      q.domains.length ? `domain: ${q.domains.join("/")}` : null,
      q.skills.length ? `skills: ${q.skills.join(", ")}` : null,
      q.compMinLpa || q.compMaxLpa ? `comp ${q.compMinLpa ?? "?"}–${q.compMaxLpa ?? "?"} LPA` : null,
      q.india ? "based in India" : null,
      q.signals.length ? `signals: ${q.signals.join(", ")}` : null,
    ].filter(Boolean).join(" · ");

    // real recruiter notes for this specific role/company, if any (human calibration)
    const learnings = relevantNotes(q.embedText || q.raw);

    const text = await callAI(
      [
        {
          role: "system",
          content:
            `You are an elite, skeptical recruiter scoring candidates for an Indian-market hiring brief. ` +
            `Score strictly — most candidates are NOT a strong fit; reserve 85+ for genuine fits. ` +
            `\nRANK BY REASONING, NOT JOB TITLES. A "Senior PM" who scaled acquisition 400% and owned ` +
            `activation funnels beats a "Growth PM" with no measurable growth work. Weigh, in order: ` +
            `(1) exact role + responsibility fit, (2) measurable impact / ownership / scale, ` +
            `(3) relevant skills & domain, (4) company quality, (5) seniority & career progression, ` +
            `(6) recency — recent relevant experience counts more than old. ` +
            `\nReward transferable experience even when titles differ. ` +
            `\nCAREER, NOT JUST THE CURRENT JOB: each candidate has a "past" array of previous ` +
            `employers. A relevant PAST stint (e.g. ex-Flipkart for a payments brief) is real ` +
            `evidence — weigh it nearly as much as the current role, discounted for how long ago ` +
            `it likely was. Never say a candidate lacks domain experience if "past" contradicts it. ` +
            `\nPEDIGREE: each candidate has a verified "tier" field — TRUST IT. Never call a company ` +
            `Tier-1 unless its tier says so; don't infer prestige from the name yourself. ` +
            `"Unrated" means we simply have NO pedigree data for that company — it does NOT mean low ` +
            `pedigree. For Unrated, judge on the other evidence and never state or imply a tier for ` +
            `them (do not call them Tier-3, and do not list "no Tier-1 pedigree" as a concern unless ` +
            `the brief explicitly demanded pedigree). ` +
            `\nSENIORITY: respect the real ladder (e.g. PM ladder: APM < PM < Senior PM < Group PM < ` +
            `Director/Head < VP < CPO; mirror the equivalent for eng, design, marketing, data, etc.). ` +
            `\nFUNCTION: a brief for one function is NOT satisfied by another — a "product designer" search ` +
            `is not met by a product manager, nor an engineer by a designer — unless the brief is explicitly ` +
            `cross-functional. Treat a wrong function as a role miss (score < 50). ` +
            `\nTHINK LIKE A SENIOR RECRUITER — beyond keywords, weigh: ` +
            `• TRAJECTORY: is their career going up-and-to-the-right (growing scope/seniority)? Reward it. ` +
            `• STAGE FIT: a big-company specialist often struggles at an early startup and vice-versa — match ` +
            `the candidate's company stage to the role's stage (founding/early vs enterprise). ` +
            `• TENURE: be wary of serial <1-year job-hoppers when stability matters; reward meaningful tenure. ` +
            `• DEPTH vs BREADTH: founding/0→1 roles want scrappy generalists; specialist roles want depth. ` +
            `• Note flight-risk or comp-mismatch signals as concerns when visible. ` +
            `\nHeavily penalise (score < 50) a MISSED must-have: wrong role, fewer years than required, ` +
            `missing requested pedigree, wrong domain, or wrong location.`,
        },
        {
          role: "user",
          content:
            `Hiring brief: "${q.raw}"\n` +
            (want ? `Role spec (distilled from the JD — score against THIS): ${want}\n` : "") +
            (q.mustHave?.length ? `Hard requirements: ${q.mustHave.join(", ")}\n` : "") +
            (q.niceToHave?.length ? `Nice-to-have (bonus only): ${q.niceToHave.join(", ")}\n` : "") +
            (learnings.length ? `\nKNOWN HIRING PATTERNS for this exact role (from past interviews — APPLY these):\n${learnings.map((l) => `• ${l}`).join("\n")}\n` : "") +
            `\nCandidates (JSON; "tier" = verified company prestige; signals = verified facts like Ex-FAANG / ` +
            `Unicorn / IIT-IIM / Growth PM / comp):\n${JSON.stringify(compact)}\n\n` +
            `For EACH return {id, score (0-100), why: string[2-3], concerns: string[1-2]}.\n` +
            `• score: judge "is this genuinely one of the strongest candidates for THIS brief?" — ` +
            `evidence of impact and ownership should move the score more than a matching title.\n` +
            `• why: cite ACTUAL facts — years, company (with its verified tier), role, measurable impact, a ` +
            `listed signal/domain (e.g. "9 yrs, ex-Flipkart (Tier-1), scaled growth funnel"). Never generic.\n` +
            `• concerns: a real gap vs the brief (e.g. "only 4 yrs vs 8 asked", "no Tier-1 pedigree", ` +
            `"title says growth but no measurable growth work"). Never "None".\n` +
            `Return ONLY a JSON array.`,
        },
      ],
      3000
    );

    const arr = extractJson<Array<{ id: string; score: number; why: string[]; concerns: string[] }>>(text);
    if (!arr) throw new Error("no JSON from ranker");

    // Models sometimes return why/concerns as a string (or omit them) — coerce to string[].
    const isJunk = (s: string) => /^(none|n\/?a|no concerns?|nothing)\.?$/i.test(s.trim());
    const toStrArray = (v: unknown): string[] => {
      const arr = Array.isArray(v) ? v.map((x) => String(x)) : typeof v === "string" && v.trim() ? [v.trim()] : [];
      return arr.map((s) => s.trim()).filter((s) => s && !isJunk(s));
    };

    const byId = new Map(people.map((p) => [p.id, p]));
    const ranked: RankedPerson[] = arr
      .filter((r) => byId.has(r.id))
      .map((r) => ({
        person: byId.get(r.id)!,
        score: Math.round(Number(r.score) || 0),
        why: toStrArray(r.why),
        concerns: toStrArray(r.concerns),
      }));

    // Any candidate the model skipped: keep them, but CAP the score so an un-vetted
    // candidate can never outrank an AI-vetted one (and weak ones fall below the show floor).
    for (const p of people) {
      if (!ranked.find((r) => r.person.id === p.id)) {
        const h = heuristicRank(p, q);
        ranked.push({ ...h, score: Math.min(h.score, 62) });
      }
    }
    return ranked.sort((a, b) => b.score - a.score);
  } catch (e) {
    console.error("[rank] LLM failed, using heuristic:", e);
    return people.map((p) => heuristicRank(p, q)).sort((a, b) => b.score - a.score);
  }
}
