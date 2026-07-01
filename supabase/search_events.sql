-- ════════════════════════════════════════════════════════════════════════════
-- LEARNING LOOP — run ONCE in the Supabase SQL editor.
-- Stores recruiter behaviour (which profiles get opened / saved / contacted) so the
-- ranker can learn what "good" looks like for this team and boost similar people.
-- Idempotent + non-destructive.
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.search_events (
  id           bigserial primary key,
  event        text not null,          -- 'open' | 'save' | 'unsave' | 'contact'
  person_id    text,                   -- our "source:slug"
  name         text,
  company      text,
  role_family  text,
  domains      text[],
  tier         text,                   -- tier1 | tier2 | tier3 (company prestige at time of action)
  query        text,                   -- the search brief this happened under
  created_at   timestamptz default now()
);

create index if not exists search_events_event_idx   on public.search_events (event);
create index if not exists search_events_created_idx  on public.search_events (created_at desc);
create index if not exists search_events_company_idx  on public.search_events (lower(company));

-- Security: RLS ON, no policies. Our server uses the SERVICE-ROLE key (bypasses RLS), so the
-- app works fine — but the public/anon key can't read or write this behaviour data. Keep it private.
alter table public.search_events enable row level security;

-- After running this, the app starts logging automatically. To see what it has learned:
-- select event, company, count(*) from public.search_events group by 1,2 order by 3 desc limit 20;
