-- ════════════════════════════════════════════════════════════════════════════
-- FULL-TEXT SEARCH INDEXES — run ONCE in the Supabase SQL editor.
--
-- WHY THIS EXISTS
-- The app searches the full profile text (profiles.resume_text, luma/yc
-- searchable_text) instead of just the short title/summary fields. That is where the
-- real evidence lives: a summary says "Senior PM at Acme", the full text says
-- "owned UPI reconciliation, cut payment failures 40%". Measured recall gain on the
-- binary pool alone:
--     "a/b testing"    58 →  614   (10.6x)
--     "reconciliation" 35 →  156   (4.5x)
--     "settlement"     20 →   82   (4.1x)
--
-- WHY AN INDEX IS MANDATORY
-- `ILIKE '%term%'` has a leading wildcard, so B-tree indexes cannot help — Postgres
-- must scan every row. On luma_profiles (64k rows x multi-KB text) that exceeds the
-- statement timeout and the query is CANCELLED. Measured before this index:
--     luma keyword lane + searchable_text  →  "canceling statement due to statement timeout" (8.2s)
-- A GIN trigram index makes the same lookup an index scan (milliseconds).
--
-- UNTIL YOU RUN THIS: the app detects the timeout and falls back to searching only the
-- short columns, so nothing breaks — you just don't get the recall gain above.
--
-- Safe + idempotent: IF NOT EXISTS everywhere. Building the luma index takes a couple
-- of minutes and briefly locks writes on the table (fine for a sourcing DB).
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists pg_trgm;

-- ── The full-text columns the keyword lane searches ──────────────────────────
-- binary: 3,204 rows, full parsed resume (100% populated)
create index if not exists profiles_resume_trgm
  on public.profiles using gin (resume_text gin_trgm_ops);

-- luma: 64k rows. searchable_text is a SUPERSET (name + designation + company +
-- the whole dated career history), so the app searches ONLY this column for luma/yc.
create index if not exists luma_searchable_trgm
  on public.luma_profiles using gin (searchable_text gin_trgm_ops);

create index if not exists yc_searchable_trgm
  on public.yc_employees using gin (searchable_text gin_trgm_ops);

-- ── ext / apify are sparse: they have no full-text blob, so the app ORs their
--    small columns. Index those to keep the OR off a sequential scan.
create index if not exists ext_about_trgm
  on public.ext_profiles using gin (about gin_trgm_ops);
create index if not exists ext_designation_trgm
  on public.ext_profiles using gin (designation gin_trgm_ops);

create index if not exists apify_about_trgm
  on public.apify_search_profiles using gin (about gin_trgm_ops);
create index if not exists apify_designation_trgm
  on public.apify_search_profiles using gin (designation gin_trgm_ops);

-- ── binary also ORs its short columns alongside resume_text (it's small enough that
--    this stays fast, and the LLM-written summary isn't inside the raw resume).
create index if not exists profiles_summary_trgm
  on public.profiles using gin (search_summary gin_trgm_ops);
create index if not exists profiles_title_trgm
  on public.profiles using gin (current_title gin_trgm_ops);

-- ── Verify (after building): these should report an Index/Bitmap scan, NOT a Seq Scan.
-- explain analyze select linkedin_slug from public.luma_profiles
--   where searchable_text ilike '%upi%' limit 80;
-- explain analyze select linkedin_slug from public.profiles
--   where resume_text ilike '%reconciliation%' limit 80;
