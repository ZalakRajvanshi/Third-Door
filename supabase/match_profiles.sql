-- Run this once in the Supabase SQL editor.
-- Fixes the broken match_profiles function: the original couldn't resolve the pgvector
-- `<=>` operator ("operator does not exist: extensions.vector <=> extensions.vector")
-- because its search_path didn't include the `extensions` schema where pgvector lives.

-- Remove ALL existing overloads first so there's exactly one function (no ambiguity).
drop function if exists public.match_profiles(extensions.vector, double precision, integer);
drop function if exists public.match_profiles(extensions.vector, integer);
drop function if exists public.match_profiles(vector, double precision, integer);
drop function if exists public.match_profiles(vector, integer);

create or replace function match_profiles(
  query_embedding vector(1536),
  match_count int default 30
)
returns table (
  id uuid,
  full_name text,
  current_title text,
  current_company text,
  location_city text,
  is_india boolean,
  seniority_level text,
  role_family text,
  one_liner text,
  search_summary text,
  linkedin_url text,
  linkedin_slug text,
  domains jsonb,
  parsed_json jsonb,
  total_experience_years numeric,
  updated_at timestamptz,
  similarity float
)
language sql
stable
set search_path = public, extensions
as $$
  select
    p.id, p.full_name, p.current_title, p.current_company, p.location_city,
    p.is_india, p.seniority_level, p.role_family, p.one_liner, p.search_summary,
    p.linkedin_url, p.linkedin_slug,
    to_jsonb(p.domains) as domains,
    p.parsed_json,
    p.total_experience_years, p.updated_at,
    1 - (p.search_embedding <=> query_embedding) as similarity
  from public.profiles p
  where p.search_embedding is not null
  order by p.search_embedding <=> query_embedding
  limit match_count;
$$;
