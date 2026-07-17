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

  /** How many candidates we send to the AI ranker — i.e. how many get real reasoning + a
   *  why/concerns, which is what a recruiter actually reads. Now that retrieval ranks the whole
   *  101k database by meaning (VECTOR_MATCH_COUNT) instead of skimming the most senior 0.7%,
   *  the top 40 are genuinely worth vetting. gpt-4o-mini: still well under a cent per search. */
  MAX_RANK_CANDIDATES: 40,

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

  /**
   * How many vector matches to pull per pool in the semantic lane.
   *
   * THIS IS THE LEVER THAT DECIDES QUALITY. The DB holds 101k profiles (luma alone has ~11.9k
   * India-based PMs). The keyword lane can only return `limit` rows ordered by yoe desc — i.e.
   * "the most senior people who matched", not "the best-matched people". Only the vector lane
   * ranks the ENTIRE table by meaning (HNSW index, so 200 costs barely more than 40).
   * At 40 we were judging a 101k database on ~0.7% of it, chosen by seniority.
   * preRank scores whatever comes back in pure JS (free) and only MAX_RANK_CANDIDATES reach the
   * LLM — so widening this buys much better candidates at ~zero extra AI cost.
   */
  VECTOR_MATCH_COUNT: 200,

  /** Per-persona ("adjacent"/"pedigree" bets) vector pull — narrower, they're speculative. */
  VECTOR_PERSONA_COUNT: 60,

  /** Cap on rows fetched back per pool from the semantic lane (highest similarity first). */
  VECTOR_FETCH_CAP: 250,

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
