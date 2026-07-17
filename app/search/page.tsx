"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { ArrowRight, SlidersHorizontal, ChevronLeft, FileText, Upload, Loader2 } from "lucide-react";
import { MatchMeter } from "@/components/MatchMeter";
import { CandidateDetail } from "@/components/CandidateDetail";
import { cacheResults, logFeedback, readPendingSearch, setPendingSearch, type PendingSearch } from "@/lib/store";
import type { RankedPerson } from "@/lib/types";

function initials(name: string) { return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase(); }
const prettyRole = (f: string) => f.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

// Build the "here's what we understood" chips from the parsed query.
function understanding(q: any): string[] {
  if (!q) return [];
  const out: string[] = [];
  (q.roleFamilies ?? []).forEach((r: string) => out.push(prettyRole(r)));
  if (q.yoeMin != null) out.push(`${q.yoeMin}+ yrs`);
  (q.seniority ?? []).filter((s: string) => /senior|lead|staff|leadership/.test(s)).slice(0, 1).forEach((s: string) => out.push(prettyRole(s)));
  (q.companyTier ?? []).forEach((t: string) => out.push(t.replace(/tier_?1/i, "Tier-1").replace(/^\w/, (c: string) => c.toUpperCase())));
  (q.domains ?? []).slice(0, 4).forEach((d: string) => out.push(d.toUpperCase()));
  (q.locations ?? []).slice(0, 2).forEach((l: string) => out.push(l));
  return Array.from(new Set(out)).slice(0, 8);
}

function SearchInner() {
  const params = useSearchParams();
  const router = useRouter();

  const [search, setSearch] = useState<PendingSearch | null>(null);
  const [refine, setRefine] = useState("");
  const [loading, setLoading] = useState(false);
  const [refining, setRefining] = useState(false);
  const [results, setResults] = useState<RankedPerson[] | null>(null);
  const [parsed, setParsed] = useState<any>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [minScore, setMinScore] = useState(0);
  const [loc, setLoc] = useState("all");
  const [showMore, setShowMore] = useState(false);

  // pick up the JD/note (from the home page) or a legacy ?q= query
  useEffect(() => {
    const p = readPendingSearch();
    const urlQ = params.get("q");
    if (p && (p.jd || p.note || p.q)) { setSearch(p); setRefine(p.note ?? ""); }
    else if (urlQ) { setSearch({ q: urlQ }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // run the search whenever the input changes (initial + refine) — streamed:
  // a fast preliminary shortlist first, then the AI-ranked final list in place.
  useEffect(() => {
    if (!search) return;
    let alive = true;
    setLoading(true); setRefining(false); setResults(null); setParsed(null); setSel(null); setMinScore(0); setLoc("all"); setShowMore(false);

    (async () => {
      try {
        const res = await fetch("/api/search/stream", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(search) });
        if (!res.body) throw new Error("no stream");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (alive) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          const chunks = buf.split("\n\n"); buf = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const dataLine = chunk.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            let ev: any; try { ev = JSON.parse(dataLine.slice(5).trim()); } catch { continue; }
            if (!alive) break;
            if (ev.type === "preliminary") {
              setParsed(ev.query ?? null);
              const list = ev.results ?? [];
              setResults(list); // show the LIST first — don't auto-open a profile
              setLoading(false); setRefining(true);
            } else if (ev.type === "final") {
              setParsed(ev.query ?? null);
              const list = ev.results ?? [];
              setResults(list); cacheResults(list);
              setSel((p) => (list.some((r: RankedPerson) => r.person.id === p) ? p : null)); // keep a click, else stay on list
              setLoading(false); setRefining(false);
            } else if (ev.type === "error") {
              setResults([]); setLoading(false); setRefining(false);
            }
          }
        }
      } catch {
        if (alive) { setResults([]); }
      } finally {
        if (alive) { setLoading(false); setRefining(false); }
      }
    })();

    return () => { alive = false; };
  }, [search]);

  const locations = useMemo(() => {
    const m = new Map<string, number>();
    (results ?? []).forEach((r) => { const l = r.person.location?.split(",")[0]?.trim(); if (l) m.set(l, (m.get(l) ?? 0) + 1); });
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map((e) => e[0]);
  }, [results]);

  const shown = useMemo(() => (results ?? []).filter((r) => r.score >= minScore && (loc === "all" || r.person.location?.toLowerCase().includes(loc.toLowerCase()))), [results, minScore, loc]);
  // AI-vetted top vs the "more relevant" tail (collapsed behind an expander)
  const vettedList = useMemo(() => shown.filter((r) => r.vetted !== false), [shown]);
  const moreList = useMemo(() => shown.filter((r) => r.vetted === false), [shown]);
  const visible = showMore ? shown : vettedList;
  const selected = sel ? (shown.find((r) => r.person.id === sel) ?? null) : null; // only when the user picks someone

  const brief = parsed?.raw || search?.note || search?.q || "your job description";
  const fromJd = Boolean(search?.jd);
  const chips = understanding(parsed);

  const applyRefine = () => {
    const next = { ...(search ?? {}), note: refine.trim() };
    setPendingSearch(next); setSearch(next);
  };

  // upload a fresh JD right from the results page (no need to go home)
  const jdFileRef = useRef<HTMLInputElement>(null);
  const [parsingJd, setParsingJd] = useState(false);
  const [jdErr, setJdErr] = useState<string | null>(null);
  async function handleJdUpload(file: File) {
    setParsingJd(true); setJdErr(null);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/parse-jd", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that file.");
      const next = { jd: data.text as string };
      setRefine(""); setPendingSearch(next); setSearch(next); // triggers a fresh search
    } catch (e: any) {
      setJdErr(e.message || "Couldn't read that file. Try a PDF, DOCX or TXT.");
    } finally {
      setParsingJd(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-6">
      <button onClick={() => router.push("/")} className="back mb-4"><ChevronLeft size={15} /> New search</button>

      {/* what we're searching for + understanding + refine */}
      <div className="surface mx-auto max-w-2xl p-4">
        <div className="flex items-start gap-2">
          {fromJd && <FileText size={15} className="mt-0.5 shrink-0" style={{ color: "var(--accent)" }} />}
          <div className="min-w-0 flex-1">
            <p className="label">{fromJd ? "From your job description" : "Searching for"}</p>
            <p className="mt-1 text-[14px] leading-snug">{brief}</p>
            {chips.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {chips.map((c) => <span key={c} className="chip" style={{ cursor: "default" }}>{c}</span>)}
              </div>
            )}
          </div>
          <button type="button" onClick={() => jdFileRef.current?.click()} disabled={parsingJd} className="jd-upload shrink-0">
            {parsingJd ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
            {parsingJd ? "Reading…" : "Upload JD"}
          </button>
          <input ref={jdFileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleJdUpload(f); e.target.value = ""; }} />
        </div>
        {jdErr && <p className="mt-2 text-[12px]" style={{ color: "var(--warn)" }}>{jdErr}</p>}
        <div className="mt-3 flex items-center gap-2 border-t border-[var(--line)] pt-3">
          <input
            value={refine}
            onChange={(e) => setRefine(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") applyRefine(); }}
            placeholder="Refine — add a note (e.g. “must be in Bangalore”, “prioritise fintech”)"
            className="flex-1 bg-transparent text-[13.5px] outline-none"
          />
          <button onClick={applyRefine} className="ui-btn-primary">Refine <ArrowRight size={13} /></button>
        </div>
      </div>

      {loading && (
        <div className="mt-10 flex items-center justify-center gap-2 text-[14px]" style={{ color: "var(--muted)" }}>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-[var(--line-2)] border-t-[var(--accent)]" /> Reading the role and finding people…
        </div>
      )}

      {results && !loading && (
        <>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex items-baseline gap-2">
                <p className="text-[14px]"><span style={{ color: "var(--muted)" }}>People matched</span></p>
                <span className="tnum label">{shown.length}</span>
              </div>
              {refining && (
                <span className="inline-flex items-center gap-1.5 text-[11.5px]" style={{ color: "var(--accent-2)" }}>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-[var(--line-2)] border-t-[var(--accent)]" /> Refining with AI…
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <SlidersHorizontal size={13} style={{ color: "var(--muted)" }} />
              {[{ l: "All", v: 0 }, { l: "70+", v: 70 }, { l: "85+", v: 85 }].map((o) => <button key={o.v} onClick={() => setMinScore(o.v)} className={`chip ${minScore === o.v ? "chip-on" : ""}`}>{o.l}</button>)}
              {locations.map((l) => <button key={l} onClick={() => setLoc(loc === l ? "all" : l)} className={`chip ${loc === l ? "chip-on" : ""}`}>{l}</button>)}
            </div>
          </div>

          {shown.length === 0 ? (
            <div className="mt-16 text-center text-[14px]" style={{ color: "var(--muted)" }}>No great matches{minScore || loc !== "all" ? " with these filters" : " yet — try a note to widen or sharpen the search"}. {(minScore || loc !== "all") && <button onClick={() => { setMinScore(0); setLoc("all"); }} className="text-accent">Clear filters</button>}</div>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-[340px_1fr]">
              {/* list */}
              <div className={`${selected ? "hidden lg:block" : "block"} space-y-1`}>
                {visible.map((r, i) => {
                  const on = selected?.person.id === r.person.id;
                  const firstTail = showMore && r.vetted === false && (i === 0 || visible[i - 1]?.vetted !== false);
                  return (
                    <div key={r.person.id}>
                      {firstTail && <p className="label px-1 pb-1.5 pt-3">More relevant</p>}
                      <button onClick={() => { setSel(r.person.id); logFeedback("open", r, brief); }} className={`item flex w-full items-center gap-3 p-3 text-left ${on ? "item-on" : ""}`}>
                        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold" style={{ background: "var(--raise)", color: "var(--accent-2)" }}>{initials(r.person.name)}</div>
                        <div className="min-w-0 flex-1">
                          <p className="text-[14px] font-medium leading-snug">{r.person.name}</p>
                          <p className="truncate text-[12.5px]" style={{ color: "var(--muted)" }}>{r.person.current_title}{r.person.company ? ` · ${r.person.company}` : ""}</p>
                        </div>
                        <MatchMeter score={r.score} segments={5} />
                      </button>
                    </div>
                  );
                })}
                {!showMore && moreList.length > 0 && (
                  <button onClick={() => setShowMore(true)} className="mt-2 w-full rounded-md border border-[var(--line-2)] py-2.5 text-[13px] transition-colors hover:border-[var(--bone)]" style={{ color: "var(--text-2)" }}>
                    Show {moreList.length} more relevant {moreList.length === 1 ? "person" : "people"}
                  </button>
                )}
              </div>

              {/* detail — opens when you pick someone; placeholder on desktop until then */}
              {selected ? (
                <div className="surface min-h-[60vh] overflow-hidden">
                  <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-2.5">
                    <button onClick={() => setSel(null)} className="back"><ChevronLeft size={15} /> Back to list</button>
                  </div>
                  <CandidateDetail key={selected.person.id} data={selected} />
                </div>
              ) : (
                <div className="surface hidden min-h-[60vh] place-items-center px-8 text-center lg:grid">
                  <p className="text-[14px]" style={{ color: "var(--muted)" }}>Select a person from the list to see their full profile and why they fit.</p>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SearchPage() {
  return <Suspense fallback={<div className="py-24 text-center text-[14px]" style={{ color: "var(--muted)" }}>Loading…</div>}><SearchInner /></Suspense>;
}
