"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Bookmark, Sparkles, AlertCircle, FileText, Upload } from "lucide-react";
import { MatchMeter } from "@/components/MatchMeter";

// Self-running cinematic tour for the landing page. It walks the whole flow:
//   type a brief → search → ranked shortlist → open a profile → save it → next brief.
// Purely illustrative (no backend). Clearly framed as a non-interactive preview.

type Person = { name: string; role: string; loc: string; score: number; why: string };
type Detail = {
  flags: string[];
  strengths: string[];
  watch: string;
  goodFor: string[];
};
type Scenario = { q: string; jdFile: string; people: Person[]; detail: Detail };

const SCENARIOS: Scenario[] = [
  {
    jdFile: "Senior_AI_Engineer_JD.pdf",
    q: "prioritise hands-on leaders",
    people: [
      { name: "Sarathy Balasubramanian", role: "GenAI Lead · HCLTech", loc: "Chennai", score: 94, why: "Led a 20-person team building production AI — the senior, hands-on leadership you described." },
      { name: "Pallavi Nanda", role: "Senior AI Engineer · ProjectPro", loc: "Mumbai", score: 91, why: "Builds AI products end-to-end with a strong applied background." },
      { name: "Prince Saroj", role: "Lead AI Engineer · Simbian", loc: "Bengaluru", score: 90, why: "Ships production AI agents and leads small teams." },
    ],
    detail: {
      flags: ["GenAI Lead", "Team of 20", "12 yrs"],
      strengths: ["Led a 20-person team shipping production AI", "Hands-on across LLMs, RAG and evaluation pipelines", "Owns delivery end-to-end, from spec to ship"],
      watch: "Most recent role is leadership-heavy — confirm how hands-on you need them.",
      goodFor: ["AI Engineering Lead", "Founding AI Engineer"],
    },
  },
  {
    jdFile: "Growth_Manager_JD.docx",
    q: "Tier-1 background, 8+ years",
    people: [
      { name: "Abhinav Gupta", role: "Senior Growth PM · Flipkart", loc: "Bengaluru", score: 93, why: "19 years scaling growth at a marquee consumer company — exactly the pedigree you asked for." },
      { name: "Sandeep Talla", role: "Director, Growth · Walmart", loc: "Hyderabad", score: 90, why: "Owns P&L for growth at Tier-1 scale, 17 years across marketplaces." },
      { name: "Guha Kashyap", role: "Growth Lead · Freshworks", loc: "Chennai", score: 88, why: "Tier-1 SaaS growth leader, deep in funnels and retention." },
    ],
    detail: {
      flags: ["Ex-Flipkart", "Tier-1", "P&L owner"],
      strengths: ["19 years scaling growth at marquee consumer companies", "Owns funnel, retention and P&L outcomes", "Has built and led large growth teams"],
      watch: "Long tenure at big companies — gauge startup appetite if that's the role.",
      goodFor: ["Head of Growth", "Senior Growth PM"],
    },
  },
  {
    jdFile: "Product_Designer_JD.pdf",
    q: "must be in Bangalore",
    people: [
      { name: "Ananya Rao", role: "Senior Product Designer · Postman", loc: "Bengaluru", score: 92, why: "B2B SaaS design at a developer-first company — right craft, right city." },
      { name: "Rohan Mehta", role: "Lead Designer · Chargebee", loc: "Bengaluru", score: 89, why: "Designs complex billing workflows end-to-end." },
      { name: "Ishita Sharma", role: "Product Designer · Hasura", loc: "Bengaluru", score: 87, why: "Systems-minded designer with a strong B2B SaaS portfolio." },
    ],
    detail: {
      flags: ["B2B SaaS", "Design systems", "8 yrs"],
      strengths: ["Designs complex B2B SaaS workflows end-to-end", "Strong systems thinking and visual craft", "Shipped at a developer-first product company"],
      watch: "Portfolio skews B2B — check consumer range if the role needs it.",
      goodFor: ["Senior Product Designer", "Design Lead"],
    },
  },
];

function initials(n: string) { return n.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase(); }

type Step = "type" | "search" | "results" | "open" | "profile" | "save" | "saved";

const CAPTIONS: Record<Step, string> = {
  type: "Drop in a job description — add a note if you like.",
  search: "We read the role and look across thousands of people.",
  results: "A ranked shortlist, each with a reason.",
  open: "Open anyone for the full picture.",
  profile: "See why they fit — and what to check.",
  save: "Save the ones worth your time.",
  saved: "Saved. Move on to the next.",
};

// cursor anchor points within the stage, in %
const CURSOR = {
  rest: { top: 16, left: 50 },
  topCard: { top: 33, left: 26 },
  saveBtn: { top: 85, left: 84 },
};

export function LiveDemo() {
  const [si, setSi] = useState(0);
  const [typed, setTyped] = useState("");
  const [step, setStep] = useState<Step>("type");
  const [shown, setShown] = useState(0);
  const [cursor, setCursor] = useState(CURSOR.rest);
  const [ripple, setRipple] = useState<{ top: number; left: number; k: number } | null>(null);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const sc = SCENARIOS[si];
  const top = sc.people[0];
  const onProfile = step === "profile" || step === "save" || step === "saved";
  const saved = step === "saved";

  const click = (pt: { top: number; left: number }) => setRipple({ ...pt, k: (ripple?.k ?? 0) + 1 });

  // typing
  useEffect(() => {
    if (step !== "type") return;
    if (reduced.current) { setTyped(sc.q); setStep("search"); return; }
    if (typed.length >= sc.q.length) { const t = setTimeout(() => setStep("search"), 480); return () => clearTimeout(t); }
    const t = setTimeout(() => setTyped(sc.q.slice(0, typed.length + 1)), 36 + Math.min(typed.length, 6) * 4);
    return () => clearTimeout(t);
  }, [step, typed, sc.q]);

  // step machine for everything after typing
  useEffect(() => {
    const R = reduced.current;
    let timers: ReturnType<typeof setTimeout>[] = [];
    const after = (ms: number, fn: () => void) => timers.push(setTimeout(fn, R ? Math.min(ms, 250) : ms));

    if (step === "search") {
      setCursor(CURSOR.rest);
      after(850, () => { setShown(0); setStep("results"); });
    } else if (step === "results") {
      if (shown < sc.people.length) after(300, () => setShown((n) => n + 1));
      else after(1100, () => setStep("open"));
    } else if (step === "open") {
      setCursor(CURSOR.topCard);
      after(720, () => { click(CURSOR.topCard); after(420, () => setStep("profile")); });
    } else if (step === "profile") {
      setCursor(CURSOR.rest);
      after(1700, () => setStep("save"));
    } else if (step === "save") {
      setCursor(CURSOR.saveBtn);
      after(760, () => { click(CURSOR.saveBtn); after(360, () => setStep("saved")); });
    } else if (step === "saved") {
      after(1900, () => { setSi((n) => (n + 1) % SCENARIOS.length); setTyped(""); setShown(0); setCursor(CURSOR.rest); setStep("type"); });
    }
    return () => timers.forEach(clearTimeout);
  }, [step, shown, sc.people.length]);

  return (
    <div className="zoomin relative">
      <div className="aura" style={{ width: "32rem", height: "17rem", top: "18%", left: "50%", marginLeft: "-16rem", background: "radial-gradient(circle, rgba(194,146,94,.1), transparent 70%)" }} />

      {/* window — non-interactive on purpose; it's a preview, not the real search */}
      <div className="demo-win relative select-none" style={{ pointerEvents: "none" }} aria-hidden>
        {/* title bar */}
        <div className="relative flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
          <div className="flex items-center gap-2"><span className="wdot" /><span className="wdot" /><span className="wdot" /></div>
          <span className="absolute left-1/2 -translate-x-1/2 font-display text-[13px] italic text-[var(--text-2)]">Third Door — demo</span>
          <span className="livebadge"><span className="livedot" /> Auto-playing</span>
        </div>

        <div className="px-5 pb-5 pt-6 sm:px-8">
          {/* JD field — uploaded file + an optional note being typed */}
          <div className="field px-4 py-3" style={{ borderColor: "var(--line)" }}>
            <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2.5">
              <FileText size={15} className="shrink-0" style={{ color: "var(--accent)" }} />
              <span className="truncate text-[13px]" style={{ color: "var(--text-2)" }}>{sc.jdFile}</span>
              <span className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px]" style={{ background: "var(--raise)", color: "var(--pos)" }}><Upload size={10} /> JD uploaded</span>
            </div>
            <div className="flex items-center gap-3 pt-2.5">
              <span className="label shrink-0" style={{ letterSpacing: ".1em" }}>Note</span>
              <span className="flex-1 truncate text-[14px]">
                {typed || <span style={{ color: "var(--muted)" }}>Add a note (optional)…</span>}
                {step === "type" && <span className="caret" />}
              </span>
              <span className="ui-btn-primary !py-2">
                {step === "search"
                  ? <><span className="h-3 w-3 animate-spin rounded-full border-2 border-[rgba(19,17,14,.3)] border-t-[#13110E]" /> Finding</>
                  : <>Find</>}
              </span>
            </div>
          </div>

          {/* stage — search screen and profile screen crossfade here */}
          <div className="relative mt-6 min-h-[330px]">
            {/* cursor + ripple */}
            {!reduced.current && (
              <>
                <div className="democursor" style={{ top: `${cursor.top}%`, left: `${cursor.left}%` }}>
                  <svg width="20" height="22" viewBox="0 0 20 22" fill="none"><path d="M1 1l6.5 17 2.7-6.8L17 8.4 1 1z" fill="#ECE5D7" stroke="#13110E" strokeWidth="1.2" strokeLinejoin="round" /></svg>
                </div>
                {ripple && <span key={ripple.k} className="ripple" style={{ top: `${ripple.top}%`, left: `${ripple.left}%` }} />}
              </>
            )}

            {/* SEARCH SCREEN */}
            <div className="screen absolute inset-0" style={{ opacity: onProfile ? 0 : 1, transform: onProfile ? "translateX(-16px)" : "none", pointerEvents: "none" }}>
              <div className="flex items-baseline justify-between border-b border-[var(--line-2)] pb-3">
                <p className="label">{step === "type" || step === "search" ? "Shortlist" : "Your shortlist"}</p>
                <p className="label tnum" style={{ letterSpacing: ".1em" }}>{step === "search" ? "…" : `${shown} of ${sc.people.length}`}</p>
              </div>

              {step === "search" ? (
                <div className="space-y-1 pt-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="flex items-center gap-4 py-5">
                      <span className="h-11 w-11 shrink-0 rounded-full shimmer" />
                      <div className="flex-1 space-y-2"><span className="block h-3 w-40 rounded shimmer" /><span className="block h-2.5 w-64 rounded shimmer" /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div>
                  {sc.people.map((p, i) => {
                    const highlight = i === 0 && (step === "open");
                    return (
                      <div key={`${si}-${p.name}`} className="grid grid-cols-[auto_1fr_auto] items-start gap-5 rounded-lg border-b border-[var(--line)] px-2 py-4 transition-all duration-700"
                        style={{ opacity: i < shown ? 1 : 0, transform: i < shown ? "none" : "translateY(14px)", background: highlight ? "rgba(236,229,215,.05)" : "transparent" }}>
                        <span className="mt-0.5 grid h-11 w-11 place-items-center rounded-full border border-[var(--line-2)] text-[13px] font-semibold text-[var(--text-2)]">{initials(p.name)}</span>
                        <div className="min-w-0">
                          <p className="text-[15px] font-medium tracking-[-0.01em]">{p.name}</p>
                          <p className="mt-0.5 text-[12.5px]" style={{ color: "var(--muted)" }}>{p.role} · {p.loc}</p>
                          <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-2)]"><span style={{ color: "var(--pos)" }}>Great fit — </span>{p.why}</p>
                        </div>
                        <span className="mt-1 hidden sm:block">{i < shown && <MatchMeter key={`${si}-${i}-${shown}`} score={p.score} segments={5} />}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* PROFILE SCREEN */}
            <div className="screen absolute inset-0" style={{ opacity: onProfile ? 1 : 0, transform: onProfile ? "none" : "translateX(20px)", pointerEvents: "none" }}>
              <div className="flex items-start gap-4 border-b border-[var(--line-2)] pb-4">
                <span className="grid h-14 w-14 shrink-0 place-items-center rounded-full border border-[var(--line-2)] text-[16px] font-semibold text-[var(--text-2)]">{initials(top.name)}</span>
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[20px] tracking-[-0.01em]">{top.name}</p>
                  <p className="mt-0.5 text-[13px]" style={{ color: "var(--muted)" }}>{top.role} · {top.loc}</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {sc.detail.flags.map((f) => <span key={f} className="rounded px-2 py-0.5 text-[11px]" style={{ background: "var(--raise)", color: "var(--accent-2)" }}>{f}</span>)}
                  </div>
                </div>
                <div className="hidden shrink-0 text-right sm:block">
                  <MatchMeter key={`prof-${si}`} score={top.score} segments={5} />
                  <p className="label mt-1">Match</p>
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-[1.4fr_1fr]">
                <div>
                  <p className="label mb-2 flex items-center gap-1.5"><Sparkles size={12} style={{ color: "var(--pos)" }} /> Why they're a great fit</p>
                  <ul className="space-y-1.5">
                    {sc.detail.strengths.map((s) => (
                      <li key={s} className="flex gap-2 text-[13px] leading-relaxed text-[var(--text-2)]"><span className="mt-1.5 h-1 w-1 shrink-0 rounded-full" style={{ background: "var(--pos)" }} />{s}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="label mb-2 flex items-center gap-1.5"><AlertCircle size={12} style={{ color: "var(--warn)" }} /> Worth checking</p>
                  <p className="text-[13px] leading-relaxed text-[var(--text-2)]">{sc.detail.watch}</p>
                  <p className="label mb-1.5 mt-4">Great for</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sc.detail.goodFor.map((g) => <span key={g} className="chip" style={{ cursor: "default" }}>{g}</span>)}
                  </div>
                </div>
              </div>

              {/* save action */}
              <div className="mt-5 flex items-center justify-end gap-3 border-t border-[var(--line)] pt-4">
                <span className="text-[12px] transition-opacity duration-300" style={{ color: "var(--pos)", opacity: saved ? 1 : 0 }}>Added to your shortlist</span>
                <span className="inline-flex items-center gap-2 rounded-[3px] px-3.5 py-2 text-[13px] font-semibold transition-all duration-300"
                  style={saved ? { background: "var(--pos)", color: "#13110E" } : { background: "var(--bone)", color: "#13110E" }}>
                  {saved ? <><Check size={14} /> Saved</> : <><Bookmark size={14} /> Save</>}
                </span>
              </div>
            </div>
          </div>

          {/* narrator caption */}
          <div className="mt-5 flex h-5 items-center justify-center">
            <p key={step} className="cap text-[12.5px]" style={{ color: "var(--text-2)" }}>
              <span className="font-display italic" style={{ color: "var(--accent)" }}>{["type", "search", "results", "open", "profile", "save", "saved"].indexOf(step) <= 2 ? ["1", "2", "3"][["type", "search", "results"].indexOf(step)] ?? "3" : "4"} — </span>
              {CAPTIONS[step]}
            </p>
          </div>

          {/* which brief we're on */}
          <div className="mt-4 flex items-center justify-center gap-2">
            {SCENARIOS.map((_, i) => <span key={i} className={`pdot ${i === si ? "pdot-on" : ""}`} />)}
          </div>
        </div>
      </div>
    </div>
  );
}
