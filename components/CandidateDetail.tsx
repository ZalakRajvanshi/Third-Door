"use client";

import { useEffect, useState } from "react";
import { Bookmark, MapPin, Building2, GraduationCap, Award, Check, AlertCircle, ExternalLink, FileText } from "lucide-react";
import { MatchMeter } from "./MatchMeter";
import { useStore, logFeedback } from "@/lib/store";
import type { RankedPerson, Dossier } from "@/lib/types";

function initials(name: string) { return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase(); }

function Sec({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-[var(--line)] pt-6">
      <p className="label mb-4">{label}</p>
      {children}
    </section>
  );
}

export function CandidateDetail({ data }: { data: RankedPerson }) {
  const [tab, setTab] = useState<"overview" | "resume">("overview");
  const { toggle, has } = useStore();
  const p = data.person;
  const d = (p.dossier ?? {}) as Partial<Dossier>;
  const saved = has(p.id);
  const linkedin = p.social_links?.find((s) => s.type === "linkedin")?.url;
  const why = Array.isArray(data.why) ? data.why : [];
  const concerns = Array.isArray(data.concerns) ? data.concerns : [];

  // fetch the raw résumé text on demand when the Résumé tab is opened
  const [resume, setResume] = useState<string | null>(null);
  const [resumeState, setResumeState] = useState<"idle" | "loading" | "done">("idle");
  useEffect(() => {
    if (tab !== "resume" || resumeState !== "idle") return;
    setResumeState("loading");
    fetch(`/api/person/${encodeURIComponent(p.id)}/resume`)
      .then((r) => r.json())
      .then((d) => setResume(typeof d.resume === "string" ? d.resume : null))
      .catch(() => setResume(null))
      .finally(() => setResumeState("done"));
  }, [tab, resumeState, p.id]);

  const glance = [
    d.years != null ? `${d.years} yrs exp` : null,
    d.seniority ? d.seniority[0].toUpperCase() + d.seniority.slice(1) : null,
    ...(d.domains ?? []).slice(0, 2),
  ].filter(Boolean) as string[];

  // outcome learning: mark what actually happened → the ranker learns from it
  const [outcome, setOutcome] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("");
  const OUTCOMES: { k: "shortlist" | "interview" | "hire"; label: string }[] = [
    { k: "shortlist", label: "Shortlisted" }, { k: "interview", label: "Interviewed" }, { k: "hire", label: "Hired" },
  ];
  const mark = (o: "shortlist" | "interview" | "hire" | "reject", why?: string) => {
    logFeedback(o, data, undefined, why); setOutcome(o); setRejectOpen(false); setReason("");
  };

  return (
    <div className="flex h-full flex-col">
      {/* header */}
      <div className="flex items-start gap-4 px-7 pt-7">
        <div className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl text-base font-bold" style={{ background: "var(--raise)", color: "var(--accent-2)" }}>{initials(p.name)}</div>
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold tracking-tight">{p.name}</h1>
          <p className="mt-0.5 text-[14px]" style={{ color: "var(--text-2)" }}>{p.current_title}</p>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]" style={{ color: "var(--muted)" }}>
            {p.company && <span className="inline-flex items-center gap-1.5"><Building2 size={13} />{p.company}</span>}
            {p.location && <span className="inline-flex items-center gap-1.5"><MapPin size={13} />{p.location}</span>}
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <MatchMeter score={data.score} />
          <div className="flex gap-2">
            {linkedin && <a href={linkedin} target="_blank" rel="noreferrer" onClick={() => logFeedback("contact", data)} className="ui-btn !px-2.5"><ExternalLink size={14} /></a>}
            <button onClick={() => { logFeedback(saved ? "unsave" : "save", data); toggle(data); }} className={saved ? "ui-btn-primary" : "ui-btn"}><Bookmark size={14} fill={saved ? "#fff" : "none"} /> {saved ? "Saved" : "Save"}</button>
          </div>
        </div>
      </div>

      {/* outcome learning bar */}
      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--line)] px-7 pt-3">
        <span className="label">Outcome</span>
        {outcome && !rejectOpen && <span className="text-[12px]" style={{ color: outcome === "reject" ? "var(--warn)" : "var(--pos)" }}>✓ {outcome === "reject" ? "Marked not a fit" : `Marked ${outcome}`} — the model learns from this</span>}
        <div className="ml-auto flex flex-wrap gap-1.5">
          {OUTCOMES.map((o) => <button key={o.k} onClick={() => mark(o.k)} className={`chip ${outcome === o.k ? "chip-on" : ""}`}>{o.label}</button>)}
          <button onClick={() => setRejectOpen((v) => !v)} className={`chip ${outcome === "reject" ? "chip-on" : ""}`}>Not a fit</button>
        </div>
      </div>
      {rejectOpen && (
        <div className="mt-2 flex items-center gap-2 px-7">
          <input value={reason} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") mark("reject", reason.trim()); }}
            placeholder="Why not? (optional) — e.g. too senior, wrong domain, job-hopper" className="field flex-1 bg-transparent px-3 py-1.5 text-[13px] outline-none" />
          <button onClick={() => mark("reject", reason.trim())} className="ui-btn-primary">Log</button>
        </div>
      )}

      {/* tabs */}
      <div className="mt-6 flex gap-1 border-b border-[var(--line)] px-7">
        {(["overview", "resume"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className="relative px-3 py-2.5 text-[13px] font-medium transition-colors"
            style={{ color: tab === t ? "var(--text)" : "var(--muted)" }}>
            {t === "resume" ? "Résumé & background" : "Summary"}
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded" style={{ background: "var(--accent)" }} />}
          </button>
        ))}
      </div>

      {/* body */}
      <div className="flex-1 space-y-6 overflow-y-auto px-7 py-6">
        {tab === "overview" ? (
          <>
            {(why.length > 0 || concerns.length > 0) && (
              <div className="space-y-4">
                {why.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--pos)" }}><Check size={13} strokeWidth={3} /> Why they're a great fit</p>
                    <ul className="space-y-1.5">{why.map((w, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}><span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--pos)" }} />{w}</li>)}</ul>
                  </div>
                )}
                {concerns.length > 0 && (
                  <div>
                    <p className="mb-2 flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: "var(--warn)" }}><AlertCircle size={13} strokeWidth={3} /> Worth checking</p>
                    <ul className="space-y-1.5">{concerns.map((c, i) => <li key={i} className="flex gap-2.5 text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}><span className="mt-2 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--warn)" }} />{c}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {glance.length > 0 && (
              <Sec label="At a glance">
                <div className="flex flex-wrap gap-2">{glance.map((g) => <span key={g} className="chip cursor-default">{g}</span>)}{(d.flags ?? []).map((f) => <span key={f} className="chip cursor-default" style={{ color: "var(--accent-2)" }}>{f}</span>)}</div>
              </Sec>
            )}

            {(d.bestFor?.length || d.notFor?.length) ? (
              <Sec label="Where they shine">
                <div className="grid gap-5 sm:grid-cols-2">
                  {d.bestFor?.length ? <div><p className="mb-2 text-[12px] font-medium" style={{ color: "var(--text-2)" }}>Great for roles like</p><ul className="space-y-1 text-[13.5px]" style={{ color: "var(--muted)" }}>{d.bestFor.map((r) => <li key={r}>· {r}</li>)}</ul></div> : null}
                  {d.notFor?.length ? <div><p className="mb-2 text-[12px] font-medium" style={{ color: "var(--text-2)" }}>Probably not for</p><ul className="space-y-1 text-[13.5px]" style={{ color: "var(--muted)" }}>{d.notFor.map((r) => <li key={r}>· {r}</li>)}</ul></div> : null}
                </div>
              </Sec>
            ) : null}

            {(p.skills?.length ?? 0) > 0 && (
              <Sec label="Skills"><div className="flex flex-wrap gap-1.5">{p.skills.slice(0, 12).map((s) => <span key={s} className="chip cursor-default">{s}</span>)}</div></Sec>
            )}
          </>
        ) : (
          <>
            {/* quick links to the real profile / résumé */}
            <div className="flex flex-wrap items-center gap-2">
              {linkedin && <a href={linkedin} target="_blank" rel="noreferrer" onClick={() => logFeedback("contact", data)} className="ui-btn-primary"><ExternalLink size={14} /> View on LinkedIn</a>}
            </div>

            {/* raw résumé text when we have it (gold pool); else the career summary */}
            {resumeState === "loading" && <p className="text-[13px]" style={{ color: "var(--muted)" }}>Loading résumé…</p>}
            {resume ? (
              <Sec label="Résumé">
                <pre className="whitespace-pre-wrap break-words font-sans text-[13.5px] leading-relaxed" style={{ color: "var(--text-2)" }}>{resume}</pre>
              </Sec>
            ) : (
              d.overview && (
                <Sec label="Background">
                  <p className="text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}>{d.overview}</p>
                  {resumeState === "done" && <p className="mt-3 inline-flex items-center gap-1.5 text-[12px]" style={{ color: "var(--faint)" }}><FileText size={12} /> No full résumé on file — summary shown. Open LinkedIn for the complete profile.</p>}
                </Sec>
              )
            )}

            {(d.roles?.length ?? 0) > 0 && (
              <Sec label="Experience">
                <ol className="space-y-5">
                  {d.roles!.map((r, i) => (
                    <li key={i} className="relative pl-5">
                      <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full" style={{ background: "var(--accent)" }} />
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <p className="text-[14px] font-semibold">{r.title || "—"}</p>
                        <p className="text-[13px]" style={{ color: "var(--muted)" }}>· {r.company}</p>
                        {r.years && <p className="tnum ml-auto text-[12px]" style={{ color: "var(--faint)" }}>{r.years}</p>}
                      </div>
                      {r.metric && <p className="mt-1 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>{r.metric}</p>}
                    </li>
                  ))}
                </ol>
              </Sec>
            )}

            {(d.products?.length ?? 0) > 0 && (
              <Sec label="Highlights">
                <div className="space-y-3.5">
                  {d.products!.map((pr, i) => (
                    <div key={i} className="surface-2 p-4">
                      <p className="flex items-center gap-1.5 text-[13.5px] font-semibold"><Award size={13} className="text-accent" /> {pr.name}</p>
                      {pr.impact && <p className="mt-1.5 text-[13px] leading-relaxed" style={{ color: "var(--text-2)" }}>{pr.impact}</p>}
                    </div>
                  ))}
                </div>
              </Sec>
            )}

            {d.scale && (
              <Sec label="Scale"><p className="text-[14px] leading-relaxed" style={{ color: "var(--text-2)" }}>{d.scale}</p></Sec>
            )}

            {(d.education?.length ?? 0) > 0 && (
              <Sec label="Education">
                <ul className="space-y-2.5">{d.education!.map((e, i) => (
                  <li key={i} className="flex items-baseline gap-2 text-[13.5px]">
                    <GraduationCap size={14} className="shrink-0 translate-y-0.5" style={{ color: "var(--muted)" }} />
                    <span>{[e.degree, e.field].filter(Boolean).join(", ") || "—"}<span style={{ color: "var(--muted)" }}> · {e.institution}{e.year ? ` · ${e.year}` : ""}</span></span>
                  </li>
                ))}</ul>
              </Sec>
            )}

            {((d.skills?.length ?? 0) > 0 || (d.tools?.length ?? 0) > 0) && (
              <Sec label="Skills & tools">
                <div className="flex flex-wrap gap-1.5">
                  {(d.skills ?? []).map((s) => <span key={s} className="chip cursor-default">{s}</span>)}
                  {(d.tools ?? []).map((t) => <span key={t} className="chip cursor-default" style={{ color: "var(--accent-2)" }}>{t}</span>)}
                </div>
              </Sec>
            )}
          </>
        )}
      </div>
    </div>
  );
}
