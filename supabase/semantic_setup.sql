-- ════════════════════════════════════════════════════════════════════════════
-- SEMANTIC SEARCH SETUP — run ONCE in the Supabase SQL editor.
-- Adds a meaning-vector column + fast index to the 4 pools that lack one, and a
-- uniform match_<pool>() function per pool. (profiles already has its column +
-- the working match_profiles function — we only add a slim slug variant for it.)
--
-- Safe + idempotent: every statement uses IF NOT EXISTS / OR REPLACE, so re-running
-- does no harm. After this, run:  node scripts/backfill_embeddings.mjs
--
-- Note on search_path: pgvector's `<=>` operator lives in the `extensions` schema;
-- every function MUST `set search_path = public, extensions` or it fails with
-- "operator does not exist: vector <=> vector".
-- ════════════════════════════════════════════════════════════════════════════

create extension if not exists vector with schema extensions;

-- ── 1. Embedding columns (same table, one column per profile — 1536-dim) ──────
alter table public.luma_profiles         add column if not exists search_embedding vector(1536);
alter table public.yc_employees          add column if not exists search_embedding vector(1536);
alter table public.ext_profiles          add column if not exists search_embedding vector(1536);
alter table public.apify_search_profiles add column if not exists search_embedding vector(1536);

-- ── 2. Fast similarity indexes (HNSW, cosine). Small tables → fine to build now.
--     For very large tables you'd backfill first, then index; at ≤26k it's a non-issue.
create index if not exists profiles_emb_idx  on public.profiles              using hnsw (search_embedding vector_cosine_ops);
create index if not exists luma_emb_idx      on public.luma_profiles         using hnsw (search_embedding vector_cosine_ops);
create index if not exists yc_emb_idx        on public.yc_employees          using hnsw (search_embedding vector_cosine_ops);
create index if not exists ext_emb_idx       on public.ext_profiles          using hnsw (search_embedding vector_cosine_ops);
create index if not exists apify_emb_idx     on public.apify_search_profiles using hnsw (search_embedding vector_cosine_ops);

-- ── 3. Uniform match functions — each returns (linkedin_slug, similarity). ─────
--     The app takes these slugs and fetches full rows, so every pool is handled
--     identically. Optional filters (india / min years) pre-filter before ranking.

-- profiles (binary/gold) — slim slug variant alongside the existing full match_profiles
create or replace function public.match_binary(
  query_embedding vector(1536), match_count int default 40,
  only_india boolean default false, min_years numeric default null
) returns table (linkedin_slug text, similarity float)
language sql stable set search_path = public, extensions as $$
  select p.linkedin_slug, 1 - (p.search_embedding <=> query_embedding)
  from public.profiles p
  where p.search_embedding is not null
    and (not only_india or p.is_india = true)
    and (min_years is null or p.total_experience_years >= min_years)
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_luma(
  query_embedding vector(1536), match_count int default 40,
  only_india boolean default false, min_years numeric default null
) returns table (linkedin_slug text, similarity float)
language sql stable set search_path = public, extensions as $$
  select p.linkedin_slug, 1 - (p.search_embedding <=> query_embedding)
  from public.luma_profiles p
  where p.search_embedding is not null
    and (not only_india or p.is_india = true)
    and (min_years is null or p.total_experience_years >= min_years)
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_yc(
  query_embedding vector(1536), match_count int default 40,
  only_india boolean default false, min_years numeric default null
) returns table (linkedin_slug text, similarity float)
language sql stable set search_path = public, extensions as $$
  select p.linkedin_slug, 1 - (p.search_embedding <=> query_embedding)
  from public.yc_employees p
  where p.search_embedding is not null
    and (not only_india or p.is_india = true)
    and (min_years is null or p.total_experience_years >= min_years)
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;

-- ext / apify are sparse (no reliable india/years) → vector-only
create or replace function public.match_ext(
  query_embedding vector(1536), match_count int default 40
) returns table (linkedin_slug text, similarity float)
language sql stable set search_path = public, extensions as $$
  select p.linkedin_slug, 1 - (p.search_embedding <=> query_embedding)
  from public.ext_profiles p
  where p.search_embedding is not null
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;

create or replace function public.match_apify(
  query_embedding vector(1536), match_count int default 40
) returns table (linkedin_slug text, similarity float)
language sql stable set search_path = public, extensions as $$
  select p.linkedin_slug, 1 - (p.search_embedding <=> query_embedding)
  from public.apify_search_profiles p
  where p.search_embedding is not null
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;

-- ── 4. (optional) sanity check after backfill: how many rows are embedded ──────
-- select 'profiles' t, count(search_embedding) embedded, count(*) total from public.profiles
-- union all select 'luma',  count(search_embedding), count(*) from public.luma_profiles
-- union all select 'yc',    count(search_embedding), count(*) from public.yc_employees
-- union all select 'ext',   count(search_embedding), count(*) from public.ext_profiles
-- union all select 'apify', count(search_embedding), count(*) from public.apify_search_profiles;
