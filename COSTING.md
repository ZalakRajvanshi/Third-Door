# Third Door — Cost Strategy & Monthly Estimate

## The funnel (cheapest → most expensive)

Every search flows through this. We stop as early as possible.

```
1. CACHE      free        identical query in last 30 min → instant, $0
2. DATABASE   ~$0         Supabase + 1 tiny embedding (~$0.00002)
3. AI RANK    cheap       Groq, capped to 24 candidates
4. APIFY      expensive   ONLY if the DB can't supply ≥ 8 strong matches
```

**Golden rule:** we never pay Apify when the database already has the answer.
Verified live: a normal "AI engineers in India" search returns 13 strong matches from the
DB → `usedApify: false`. Apify only fires for rare/niche asks the DB can't cover.

All knobs live in [lib/config.ts](lib/config.ts) — tune without touching logic.

## Per-search cost

| Step | What | Cost per search |
|---|---|---|
| Embedding | OpenAI text-embedding-3-small (1 short query) | ~$0.00002 |
| Intent | Groq (small) | ~$0.0005 |
| Ranking | Groq llama-3.3-70b, ~24 profiles | ~$0.004 |
| **DB-only search total** | | **~$0.005** (half a cent) |
| Apify (only when triggered) | ~15 profiles × actor price | **~$0.15–0.75** |

Apify is **30–100× more expensive** than a DB search — which is the whole reason for the
funnel. The more complete your internal DB, the less Apify runs, the lower the bill.

## Monthly estimate (approximate)

Assumes ~30% of searches are cache hits (free) and Apify fires on ~20% of unique searches.
Apify assumed at ~$0.03/profile × 15 = ~$0.45/run.

| Volume (searches/mo) | AI + embeddings | Apify | Supabase | **Total / mo** |
|---|---|---|---|---|
| **1,000** (light) | ~$5 | ~$60 | $25 (Pro) | **~$90** |
| **5,000** (medium) | ~$25 | ~$300 | $25 | **~$350** |
| **10,000** (heavy) | ~$70 | ~$600 | $25 | **~$700** |
| DB-only (rich DB, Apify off) — 5,000 | ~$25 | $0 | $25 | **~$50** |

**Apify dominates the bill.** Two levers cut it hard:
1. **Grow the internal DB** → fewer Apify gap-fills (the funnel does this automatically).
2. **Lower `MIN_STRONG_RESULTS`** in config → tolerate fewer DB matches before paying Apify.

Fixed/near-zero: OpenAI embeddings (a few dollars even at high volume), Groq (cheap, has a
free tier). Supabase Free tier ($0) works for now; Pro ($25) when you need more.

## ⚠️ Groq free-tier daily limit (important)

The free Groq tier caps at **100,000 tokens/day**. Each search uses ~3–5K tokens for ranking,
so the free tier handles only **~20–30 searches/day** before ranking falls back to the basic
heuristic (generic "why/concerns"). We hit this during testing.

To remove the cap for real use:
- **Upgrade Groq to a paid tier** (still cheap, ~$0.59/1M tokens) — best value, or
- Switch `AI_*` env to another provider (the AI layer is provider-agnostic).

Token-saving measures already in place: ranking capped to 16 candidates, summaries trimmed,
results cached. These stretch the free tier but don't remove the daily ceiling.

> These are planning estimates. Real numbers depend on your actual search volume and the
> per-result price of the specific Apify actor you choose. Apify is currently OFF (no
> `APIFY_ACTOR_ID` set), so today the running cost is just embeddings + Groq ≈ pennies/day.
