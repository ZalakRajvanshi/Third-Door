# Third Door

Describe who you need in one sentence → get ranked, explained people.
See [SPEC.md](SPEC.md) and [ARCHITECTURE.md](ARCHITECTURE.md) for the full design.

## Run it

```bash
npm install
npm run dev      # http://localhost:3000
```

**It runs with zero configuration** — no Supabase, no API key needed. With no keys it uses
built-in seed people, heuristic intent parsing, and heuristic ranking, so the full flow is
demoable immediately.

## Add real intelligence + data (optional)

Copy `.env.example` → `.env.local` and fill in:

- `ANTHROPIC_API_KEY` — turns on real intent parsing (Claude Haiku 4.5) and AI ranking (Claude Opus 4.8).
- `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — searches a `profiles` table instead of seed data.

No code changes needed — each layer detects its key and upgrades automatically.

## How it's wired (this slice)

```
app/page.tsx ──POST /api/search──► lib/search.ts (orchestrator)
                                      ├─ lib/intent.ts   intent → StructuredQuery + hypotheses
                                      ├─ lib/sources/*   SourceAdapter → Person[]  (Supabase | seed)
                                      ├─ dedupe          identity resolution (MVP)
                                      └─ lib/rank.ts     Person[] → score + why + concerns
```

Everything is normalized to the unified `Person` type (`lib/types.ts`) before the UI sees it —
the UI never knows which source a person came from.

## What's built vs. next

**Built (vertical slice):** chat input · intent engine · internal source + seed fallback ·
unified Person layer · basic identity resolution · AI/heuristic ranking with why+concerns ·
live progress UI · result cards.

**Next:** Apify adapter (gap-fill) · profile detail screen · refinement chat · feedback loop ·
streaming/hybrid result rendering · stronger identity resolution.
