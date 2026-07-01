# Third Door — Product & Architecture Spec

> AI-powered people discovery. Users describe an *outcome* in one sentence and receive
> ranked, explained shortlists of real people — without ever knowing where the data came from.

Status: **Planning** (no code yet). Last updated: 2026-06-22.

---

## 1. Product thesis

Finding people should feel like talking to an elite recruiter, not querying a database.

- Users describe **outcomes**, not filters: _"Find senior AI engineers in India."_
- The system understands intent, fans out into multiple search strategies, searches
  multiple sources, merges + dedupes, ranks with AI, and explains every recommendation.
- **Source invisibility is the core promise.** Internal (Supabase) and external (Apify)
  profiles are normalized into ONE schema before reaching the UI. No source labels, ever.

Experience: **Intent → Discovery → Insights → Decisions.**

Reference product: [Kello](https://kello.ai) — same problem space, but Kello is async/batch
(JD in → 30 candidates by email in 60 min). Third Door's differentiator is **hybrid real-time
conversational** discovery.

---

## 2. Decisions locked

| Decision | Choice |
|---|---|
| Interaction model | **Hybrid** — fast internal results appear instantly; Apify enrichment fills in progressively |
| Phase 1 focus | Written spec → then build internal-only happy path |
| Data: Supabase | ✅ Ready |
| Data: Apify (actors) | ✅ Account + actors available |
| Data: LLM key | ⚠️ **Not confirmed** — needed before ranking/intent (Anthropic Claude) |

Open decisions: dedup strictness threshold, ranking model cost/latency tradeoff, auth provider.

---

## 3. The unified Person layer (the single most important contract)

Every profile from every source MUST normalize to this before reaching the UI. Source-specific
shape must NEVER leak past the adapter boundary.

```ts
interface Person {
  id: string;                 // stable internal id (post-identity-resolution)
  name: string;
  headline: string | null;
  current_title: string | null;
  company: string | null;
  location: string | null;
  summary: string | null;     // AI-generated when missing
  experience: Experience[];
  skills: string[];
  education: Education[];
  social_links: SocialLink[];
  profile_strength: number;   // 0–100, completeness of data
  confidence_score: number;   // 0–100, how sure we are this is one real person
  last_updated: string;       // ISO

  // internal-only, never rendered as a "source":
  _sources: SourceRef[];      // provenance for merge/audit
}
```

`SourceRef`, `Experience`, `Education`, `SocialLink` to be defined alongside the schema.

---

## 4. Architecture

```
Chat input (one sentence)
   │
   ▼
[Intent Engine]            LLM → structured query + N search hypotheses (3–6)
   │
   ├──▶ SourceAdapter: Supabase   ── FAST, runs first, returns instantly
   └──▶ SourceAdapter: Apify      ── async gap-fill, streams in progressively
   │
   ▼
[Normalizer]               raw source rows → unified Person
   │
   ▼
[Identity Resolution]      name + company + social URLs + experience → dedup/merge
   │
   ▼
[Ranking Engine]           LLM → match score + why-they-match + concerns (per person)
   │
   ▼
[Results UI]               cards → profile detail → refinement chat → feedback loop
```

### SourceAdapter interface (the other critical contract)

```ts
interface SourceAdapter {
  name: string;                                  // internal only
  search(query: StructuredQuery): Promise<RawProfile[]>;
  normalize(raw: RawProfile): Person;
}
```

New sources (GitHub, future providers) = new adapters. Nothing downstream changes.

---

## 5. Search flow (hybrid)

1. **Understand** — LLM parses the sentence into a `StructuredQuery` + generates 3–6
   hypotheses (e.g. "AI engineers" → infra eng, applied AI, agent builders, ML platform).
2. **Internal first** — query Supabase across hypotheses; return matches immediately to UI.
3. **Gap-fill** — if more/better profiles needed, trigger Apify in background; stream results in.
4. **Normalize** — every result → Person schema.
5. **Resolve identity** — dedupe aggressively across sources; merge likely-same people.
6. **Rank** — score + explain each person; re-rank as new results stream in.

Progress UI stages (must feel alive): _Understanding → Building strategies → Finding profiles → Ranking._

---

## 6. Ranking engine (the heart)

Per person, the LLM produces:
- **Match score** — e.g. `91/100`
- **Why they match** — concrete, evidence-based bullets
- **Potential concerns** — honest trade-offs (Kello-style "thesis + counter-argument")

Output must be structured (forced schema). Re-ranking happens as streamed results arrive.

---

## 7. UI screens

- **Home** — single prompt + example chips. Nothing else.
- **Search progress** — live pipeline stages.
- **Results** — candidate cards: name, role, company, match score, why-they-match, highlights.
  Refine via chat ("focus on India", "exclude enterprise", "prioritize founders").
- **Profile detail** — career timeline, experience, skills, AI summary, suggested outreach angle.
- **Feedback** — Relevant / Not Relevant / Excellent Match → stored → improves future ranking.

Design language: Linear / Notion / Arc / Perplexity. Clean, minimal, fast.

---

## 8. MVP scope

**Build:** conversational search · Supabase integration · Apify integration · unified Person
layer · AI ranking engine · candidate cards · profile detail · refinement chat · feedback loop.

**Do NOT build:** outreach automation · email sequencing · CRM · ATS · campaign management.

---

## 9. Proposed build order

1. **Foundations** — Next.js + Supabase schema (`Person`, search sessions, feedback) + `SourceAdapter` interface.
2. **Internal-only happy path** — chat → intent → Supabase → unified cards. End-to-end, zero external deps.
3. **Ranking engine** — LLM scoring with structured why/concerns. (Opus 4.8 ranking, Haiku 4.5 intent.)
4. **Apify adapter** — gap-fill + normalize into the same schema.
5. **Identity resolution** — dedup/merge between sources.
6. **Refinement chat + feedback loop** — conversational filtering + thumbs storage.

---

## 10. Risks / things to get right early

- **Source leakage** — if any UI component reads a source-specific field, the core promise breaks.
- **Identity resolution tuning** — too loose = wrong merges; too strict = visible duplicates.
- **Ranking cost/latency** — scoring many profiles with a large model is slow/expensive; batch + cache.
- **Apify reliability/rate limits** — must degrade gracefully to internal-only.
- **LLM key not yet provisioned** — blocks phases 1→3 transition.
