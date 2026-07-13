// ─────────────────────────────────────────────────────────────────────────────
// Cost-control knobs. The search is a funnel from cheapest → most expensive:
//   1. CACHE     (free)      repeat queries return instantly
//   2. DATABASE  (~$0)       all 5 pools (≈48k) + OpenAI rank (gpt-4o-mini, cheap)
//   3. APIFY     (expensive) ONLY if the DB can't supply enough strong matches —
//                            and HARD-CAPPED to MAX_USD_PER_SEARCH dollars.
// ─────────────────────────────────────────────────────────────────────────────

export const COST = {
  /** A result counts as "strong" when its match score is at least this. */
  STRONG_SCORE: 70,

  /** If the DB yields at least this many strong matches, SKIP Apify entirely. */
  MIN_STRONG_RESULTS: 8,

  /** How many candidates we send to the AI ranker. With clean retrieval (similarity floor +
   *  real filters) 30 STRONG candidates beat 40 noisy ones — better output AND lower token cost.
   *  gpt-4o-mini stays well under a cent at this size. */
  MAX_RANK_CANDIDATES: 30,

  /** HARD relevance floor for the AI-vetted top tier: drop anything below this. */
  MIN_SHOW_SCORE: 65,

  /** Relevance floor for the "more relevant" tail (cheap business-scored, not AI-vetted).
   *  Set ABOVE the ~53 "matched-nothing" baseline so the tail requires real skill/domain
   *  overlap — not just being in the right role family. Lower than the AI floor to show depth. */
  TAIL_MIN_SCORE: 62,

  /** Safety cap on total results shown when NO count is requested (perf, not relevance). */
  MAX_TOTAL_SHOWN: 120,

  /** Repeat-query cache. ON by default (prod). To disable locally while tuning, set SEARCH_CACHE=off. */
  CACHE_ENABLED: process.env.SEARCH_CACHE !== "off",

  /** Repeat-query cache lifetime (short, so daily-new profiles surface fast). */
  CACHE_TTL_MS: 1000 * 60 * 10,

  /** Observability: log per-stage timing (intent · retrieve · rank) for every search. */
  LOG_TIMING: true,

  /** Semantic (vector) retrieval lane. Turn ON after running semantic_setup.sql +
   *  backfilling embeddings. Until then the keyword path runs alone. */
  SEARCH_SEMANTIC: process.env.SEARCH_SEMANTIC === "on",

  /** How many vector matches to pull per pool in the semantic lane. */
  VECTOR_MATCH_COUNT: 40,

  /** Cosine-similarity floor for the semantic lane. Below this, a "match" is noise — the
   *  vector function always returns match_count rows however unrelated, so without a floor
   *  ~200 off-target people flood every search. Persona bets use a slightly higher floor. */
  VECTOR_MIN_SIM: 0.32,

  // ── Apify cost cap (Apify is DORMANT until APIFY_TOKEN + APIFY_ACTOR_ID are set) ──
  /** Hard ceiling on Apify spend per search, in USD. */
  MAX_USD_PER_SEARCH: 0.25,
  /** Measured cost per profile for the chosen actor (harvestapi full = $0.008). */
  APIFY_COST_PER_PROFILE: 0.008,
  /** Derived: max external profiles per search = floor(budget ÷ cost/profile). */
  get APIFY_MAX_RESULTS() { return Math.max(0, Math.floor(this.MAX_USD_PER_SEARCH / this.APIFY_COST_PER_PROFILE)); },
} as const;
