-- ════════════════════════════════════════════════════════════════════════════
-- OUTCOME LEARNING — run ONCE in the Supabase SQL editor.
-- Adds a 'reason' column so we can capture WHY a candidate was a hire/reject.
-- The event column already stores the outcome ('shortlist'|'interview'|'hire'|'reject'
-- alongside the existing 'open'|'save'|'contact'). Idempotent + non-destructive.
-- ════════════════════════════════════════════════════════════════════════════

alter table public.search_events add column if not exists reason text;

-- See what outcomes have been recorded:
-- select event, company, reason, count(*) from public.search_events
--   where event in ('shortlist','interview','hire','reject') group by 1,2,3 order by 4 desc;
