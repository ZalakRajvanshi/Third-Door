"use client";

import { useEffect } from "react";
import { ArrowRight } from "lucide-react";
import { LiveDemo } from "@/components/LiveDemo";
import { JDSearch } from "@/components/JDSearch";

const BRIEFS = [
  "A founding engineer who's shipped 0→1",
  "A growth lead from a consumer unicorn",
  "A B2B SaaS product designer in Bangalore",
  "A data scientist with fintech experience",
  "A VP of Engineering, 12+ years",
  "A brand marketer for a D2C label",
  "A senior PM from a Tier-1 company",
  "An AI engineer who can lead a small team",
];

const STEPS = [
  { t: "Describe who you need", b: "In a sentence, just like you'd tell a colleague. No filters, no boolean, nothing to learn." },
  { t: "We find the best matches", b: "We look across thousands of people and bring back only the ones who truly fit what you asked for." },
  { t: "See why — and reach out", b: "Every person comes with a clear reason they're a great fit. Save your favourites and get in touch." },
];

export default function Home() {
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  useEffect(() => {
    const ro = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("on"); ro.unobserve(e.target); } }), { threshold: 0.14 });
    document.querySelectorAll(".r,.clip,.zoomin").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, []);

  return (
    <main>
      {/* ── HERO ── */}
      <section className="relative overflow-hidden">
        <div className="aura" style={{ width: "40rem", height: "26rem", top: "-12rem", left: "50%", marginLeft: "-20rem", background: "radial-gradient(circle, rgba(194,146,94,.12), transparent 70%)" }} />
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-20 sm:pt-28">
          <p className="eyebrow r"><span className="n">①</span> An AI talent scout</p>

          <h1 className="mt-6 max-w-4xl font-display text-[clamp(44px,7vw,92px)] font-medium leading-[0.98] tracking-[-0.03em]">
            <span className="clip"><span>Find the right people,</span></span>{" "}
            <span className="clip d1"><span className="italic" style={{ color: "var(--accent-2)" }}>just by describing them.</span></span>
          </h1>

          <p className="r d2 mt-7 max-w-xl text-[17px] leading-relaxed text-[var(--text-2)]">
            Paste a job description — or drop the file. We read it, understand the role,
            and bring back a shortlist of great people, each with a clear reason they fit.
          </p>

          <div className="r d3 mt-9 max-w-2xl">
            <JDSearch autoFocus />
          </div>
        </div>

        {/* drifting marquee of real briefs — adds life without noise */}
        <div className="r border-y border-[var(--line)] py-4">
          <div className="marquee-mask mx-auto max-w-6xl overflow-hidden px-6">
            <div className="marquee">
              {[...BRIEFS, ...BRIEFS].map((b, i) => (
                <span key={i} className="chip whitespace-nowrap" style={{ cursor: "default" }}><span className="n mr-1.5 text-[var(--accent)]">›</span>{b}</span>
              ))}
            </div>
          </div>
        </div>

        {/* live demo — a looping product tour: types a brief, finds people, reveals the shortlist */}
        <div className="mx-auto max-w-3xl px-6 pb-28 pt-20">
          <div className="r mb-6 flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow"><span className="n">◆</span> See it work</p>
              <h2 className="mt-3 font-display text-[clamp(24px,3.4vw,38px)] font-medium tracking-[-0.02em]">Watch a search unfold.</h2>
            </div>
            <p className="hidden max-w-[15rem] text-[13px] leading-relaxed text-[var(--muted)] sm:block">A short, looping preview of a real search. The box below isn't live — your search is up top.</p>
          </div>
          <LiveDemo />
        </div>
      </section>

      {/* ── HOW IT WORKS — editorial numbered list ── */}
      <section id="how" className="border-t border-[var(--line-2)] py-24">
        <div className="mx-auto max-w-5xl px-6">
          <p className="eyebrow r"><span className="n">②</span> How it works</p>
          <h2 className="r d1 mt-5 max-w-2xl font-display text-[clamp(30px,4vw,52px)] font-medium tracking-[-0.02em]">As easy as asking a colleague.</h2>
          <div className="mt-14">
            {STEPS.map((s, i) => (
              <div key={s.t} className={`r d${i + 1} grid grid-cols-[auto_1fr] gap-6 border-t border-[var(--line)] py-8 sm:grid-cols-[120px_1fr_1.2fr] sm:gap-10`}>
                <span className="font-display text-[40px] italic leading-none text-[var(--accent)]">{String(i + 1).padStart(2, "0")}</span>
                <h3 className="text-[22px] font-medium tracking-[-0.01em]">{s.t}</h3>
                <p className="text-[15px] leading-relaxed text-[var(--text-2)]">{s.b}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="relative overflow-hidden border-t border-[var(--line-2)] py-32">
        <div className="aura" style={{ width: "34rem", height: "18rem", bottom: "-10rem", left: "50%", marginLeft: "-17rem", background: "radial-gradient(circle, rgba(194,146,94,.1), transparent 70%)" }} />
        <div className="r relative mx-auto max-w-3xl px-6 text-center">
          <h2 className="font-display text-[clamp(40px,6vw,76px)] font-medium leading-[1.02] tracking-[-0.02em]">Ready to <span className="italic" style={{ color: "var(--accent-2)" }}>meet them?</span></h2>
          <p className="mx-auto mt-5 max-w-md text-[17px] text-[var(--text-2)]">Paste your job description. Meet the few worth your time.</p>
          <button onClick={toTop} className="btn btn-primary mt-9">Start with a JD <ArrowRight size={17} /></button>
        </div>
      </section>

      <footer className="border-t border-[var(--line)] py-9">
        <div className="mx-auto flex max-w-5xl flex-col items-start justify-between gap-3 px-6 text-[12.5px] text-[var(--muted)] sm:flex-row sm:items-center">
          <span className="font-display text-[17px] italic text-[var(--text)]">Third Door</span>
          <span>Find the right people, just by describing them.</span>
          <span>© 2026</span>
        </div>
      </footer>
    </main>
  );
}
