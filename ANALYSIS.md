# Third Door — Search & Relevance Analysis

*Analysis before building. Covers: what we have (pools, filters, search levels, cost), how the
reference (Kello) performs, the gap, and where we can beat them. Last analysed 2026-06-29.*

---

## 1. What we actually have (it's a lot more than one table)

### Candidate pools — ~52k raw rows · **28,730 in the unified layer**
| Pool | Table | Rows | What it is | Contact |
|---|---|---|---|---|
| **Binary (gold)** | `profiles` | 2,832 | GPT-parsed resumes (TPF form uploads) | email + phone + **CTC + notice + relocate** |
| **Luma** | `luma_profiles` | 26,213 | Event attendees, enriched | email 100% · phone ~63% |
| **YC** | `yc_employees` | 3,407 | YC-company employees (via Apify) | none (by design) |
| **Apify intake** | `apify_search_profiles` | 17,633 | Raw LinkedIn search results (staging) | sparse |
| **External** | `ext_profiles` | 1,436 | Misc external | sparse |
| **Sourced** | `sourced_candidates` | 1,145 | Already-sourced w/ role context, tier, verdict | varies |
| **Unified** | `unified_person_view` | **28,730** | Merged people layer used for search | — |

> **The bug in the current app:** it searches only `profiles` (2.8k). It should search
> `unified_person_view` (28.7k) + optionally `apify_search_profiles` (17.6k). That alone is ~10× the pool.

### Intelligence overlays (this is our edge)
- **`profile_facets` (23,254)** — per-person boolean signals: `worked_at_faang / unicorn / big4 / consulting / bank / nbfc`, fintech variants (`payments / lending / wealth / consumer`), `d2c / quick_commerce / ecommerce / edtech / saas_b2b / ai_native`, `*_current`, `growth_pm_signal / ai_pm_signal / platform_pm_signal / data_pm_signal`, `iit_or_iim`, `is_0to1_shipper`, `inferred_ctc_band / low / high`, `skills_extracted`.
- **`companies_metadata` (5,873)** — company canonical + tier + `is_unicorn / is_faang / is_big4 / is_fintech…` — the join key for **"Tier-1 company"** queries.
- **`company_tiers`, `_company_canon`** — company normalization (65k canon keys).

### Calibration & learning assets (Kello-style, already here)
- **`role_searches` (43)** — real briefs: company, title, JD link, `brief_md`, comp band, hiring team.
- **`search_learnings` (52)** — per-role learnings; **rejections = calibration** (e.g. "too senior, want IC").
- **`search_regression_baseline` (2,200)** — captured query→ranked-results, for measuring relevance changes.
- **`project_docs`** — product context, the **Apify cost playbook**, and live client intakes (1% Club: 2 Growth PMs @ 30–40 LPA; Trupeer: founding PM/designer with CV-screen feedback).

---

## 2. All possible filters (the levers for relevance)

| Lever | Field(s) | Example query it unlocks |
|---|---|---|
| Role family | `role_family` (product/eng/design/analytics/marketing/category) | "a growth **manager**" |
| Seniority | `seniority_level` (intern→leadership) + `yoe` (0–26) | "**8+ years**", "leadership" |
| Location | `is_india`, `is_tier1_city`, `current_city` | "in India / Bangalore" |
| **Company tier** | `companies_metadata.is_unicorn/faang/big4…`, `highest_company_tier`, `tier1_companies_count`, facets `worked_at_*` | "**from a Tier-1 company**", "ex-FAANG" |
| Domain / industry | `domains_array`, `primary_domain`, facets fintech/d2c/edtech… | "fintech", "quick commerce" |
| **Comp** | `current_ctc_lpa`, `expected_ctc_lpa`, `inferred_ctc_band` | "**within 30–40 LPA**" (1% Club ceiling) |
| Pedigree | `iit/iim/bits/isb/nit` flags | "IIT/IIM" |
| Special signals | `growth_pm_signal`, `is_0to1_shipper`, `has_startup/big_tech/consulting_exp`, `has_founder/intl_exp` | "0→1 builder", "ex-consulting" |
| Practical | `notice_period_days`, `open_to_relocate` | "joins soon", "will relocate" |
| Semantic | `search_embedding / career_embedding / embedding` | meaning-based match |

**Today the app uses ~3 of these (role_family, location, light keyword).** That's the relevance gap —
"Growth manager, 8+ yrs, Tier-1" needs **yoe + company-tier + role + comp**, none of which are wired in.

## 3. Search levels (capability ladder)
1. **Structured filter** — role + yoe + tier + domain + location + comp. Precise, ~$0, fast. *(barely used today)*
2. **Keyword / FTS** — on `searchable_text` / title / summary.
3. **Semantic vector** — embeddings + `match_profiles` RPC. *(working for `profiles` only)*
4. **Hybrid** — filter ∩ FTS ∩ vector. RPCs exist in DB (`search_profiles_v5_fts_v3`, `_hybrid`) but are **not currently callable from the API** (not in PostgREST schema cache) — we'd re-create or expose them.
5. **Persona fan-out + LLM rerank** with thesis/anti-thesis. *(not built — this is Kello's main trick)*
6. **Calibration** from `role_searches` + `search_learnings` + regression baselines. *(not used)*

## 4. Costing
- **Internal search:** ~**$0.005/search** (1 embedding + Groq rank). With 3–6 persona LLM calls: ~$0.01–0.03.
- **Apify external** (documented model): `harvestapi/linkedin-company-employees` = **$0.008/profile** full ($0.004 short) + $0.02/company. HarvestAPI direct profile = $0.0064. *Discovery `/lead-search` = $0.10/page = a cost trap — avoid.*
- **Per-search $ cap (your ask):** trivial to enforce — `max_external = floor(budget ÷ $0.008)`. So **$0.25/search ≈ 30 profiles**, **$0.50 ≈ 60**. Cap is a single config number.
- **Golden rule (from your own playbook):** estimate full-run cost before scraping; only gap-fill with Apify when the internal pool is thin.

## 5. Autosync (DB grows daily → 35–39k)
- Live queries already reflect new rows (no rebuild). ✅
- New rows need **embeddings** (semantic) + **facets** (signals). Embeddings backfill script exists; facets come from your enrichment pipeline.
- **Plan:** a scheduled job (hourly/daily) that embeds any new/changed rows and flags rows missing facets. Keep it running so search stays current.

---

## 6. The reference — Kello (the bar to beat)
**Method:** email a JD → *reads the job* (title, level, skills, synonyms, company context, culture) →
**calibrates on your past hires** (patterns the JD misses) → generates **2–6 personas** (domain insider /
adjacent / proven scaler / cross-platform) → **a dedicated AI sourcer per persona, in parallel** →
**honest review per candidate (thesis + anti-thesis)** → delivers **30 candidates in 60 min** as a sheet →
**learns from your reply feedback** for the next batch. Scale claim: **100M profiles**. Setup: none.

**Why their relevance is good:** (a) persona fan-out catches non-obvious/adjacent fits, (b) thesis+anti-thesis
is honest and decision-useful, (c) calibration on past hires + feedback loop, (d) deep JD intent extraction.

**Their weaknesses / our openings:** generic 100M pool (not India-tuned); **no comp/CTC** awareness; no
visible company-tier precision; qualitative scoring only; batch/async (60 min), not interactive.

---

## 7. Gap → how we beat Kello on relevance

| # | Move | Why it beats / matches Kello |
|---|---|---|
| 1 | **Search the full pool** (`unified_person_view` 28.7k + apify 17.6k), not 2.8k | ~10× recall; stops missing obvious people |
| 2 | **Rich structured pre-filter** (yoe-min + company-tier via facets/companies + domain + comp band) | Precision Kello can't match for Indian hiring (esp. **comp ceiling** & **Tier-1**) |
| 3 | **Persona fan-out** (3–6 personas, search each, merge) | Matches Kello's #1 relevance driver (adjacency + scalers) |
| 4 | **Hybrid retrieval** (filter ∩ semantic ∩ FTS) | Better recall+precision than single-mode |
| 5 | **LLM rerank w/ thesis + "worth checking"**, grounded in our rich data (tier, comp, signals) | Equals Kello's transparency, with more facts |
| 6 | **Calibration** from `role_searches` + `search_learnings` (rejections) + regression baselines | Closes the feedback loop; measurable relevance |
| 7 | **Apify gap-fill, hard $-capped**, only when internal pool is thin | Coverage of 100M-style breadth, cost-controlled |
| 8 | **Autosync** embeddings/facets for daily new rows | Always-fresh index |

**Net:** we can plausibly *beat* Kello's relevance for **Indian-market, all-role hiring** because we have
**comp data, company-tier intelligence, India-tuned signals, and a calibration substrate** they don't show —
*if* we actually use the full pool + facets + personas instead of keyword-matching 2.8k resumes.

---

## 8. Proposed build order (after you approve)
1. **Repoint search to `unified_person_view`** + wire the structured filters (yoe, tier, domain, comp, role). *(biggest single relevance win)*
2. **Intent engine v2** — extract yoe-min, company-tier, domain, comp band, role family from any plain-language ask (tech *and* non-tech).
3. **Persona fan-out + hybrid retrieval + LLM rerank** (thesis / worth-checking).
4. **Apify gap-fill with per-search $ cap** (config: `MAX_$_PER_SEARCH`).
5. **Autosync job** (embed + facet-flag new rows).
6. **Calibration** from learnings + a regression check against `search_regression_baseline`.
7. **Then** the UI pass (incl. fixes: drop repeated 01/02/03 numbering, fix text truncation).
