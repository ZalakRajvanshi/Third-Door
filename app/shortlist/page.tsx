"use client";

import { useState } from "react";
import Link from "next/link";
import { Bookmark, X, ArrowRight, Rows3, Columns3, Trash2, ChevronLeft } from "lucide-react";
import { useStore } from "@/lib/store";
import { MatchMeter } from "@/components/MatchMeter";

function initials(name: string) { return name.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase(); }

export default function ShortlistPage() {
  const { items, remove, clear } = useStore();
  const [compare, setCompare] = useState(false);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-6 py-28 text-center">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl" style={{ background: "var(--panel)", border: "1px solid var(--line)" }}><Bookmark className="text-accent" size={22} /></div>
        <h1 className="mt-5 text-xl font-semibold">Your shortlist is empty</h1>
        <p className="mt-2 text-[14px]" style={{ color: "var(--muted)" }}>Save people from a search to compare them here.</p>
        <Link href="/search" className="btn-primary mt-5 inline-flex">Start a search <ArrowRight size={15} /></Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-7">
      <Link href="/" className="back mb-4"><ChevronLeft size={15} /> Home</Link>
      <div className="flex items-center justify-between">
        <div className="flex items-baseline gap-2">
          <h1 className="text-xl font-semibold tracking-tight">Shortlist</h1>
          <span className="tnum label">{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--line-2)] p-0.5">
            <button onClick={() => setCompare(false)} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium ${!compare ? "chip-on" : ""}`}><Rows3 size={13} /> List</button>
            <button onClick={() => setCompare(true)} className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium ${compare ? "chip-on" : ""}`}><Columns3 size={13} /> Compare</button>
          </div>
          <button onClick={clear} className="ui-btn"><Trash2 size={13} /> Clear</button>
        </div>
      </div>

      {!compare ? (
        <div className="mt-6 space-y-1">
          {items.map((r) => (
            <div key={r.person.id} className="item flex items-center gap-3 p-3">
              <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[11px] font-bold" style={{ background: "var(--raise)", color: "var(--accent-2)" }}>{initials(r.person.name)}</div>
              <Link href={`/person/${encodeURIComponent(r.person.id)}`} className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-medium">{r.person.name}</p>
                <p className="truncate text-[12.5px]" style={{ color: "var(--muted)" }}>{r.person.current_title}{r.person.company ? ` · ${r.person.company}` : ""}</p>
              </Link>
              <MatchMeter score={r.score} segments={5} />
              <button onClick={() => remove(r.person.id)} className="grid h-8 w-8 place-items-center rounded-lg text-[var(--muted)] hover:bg-white/10"><X size={15} /></button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6 overflow-x-auto pb-2">
          <div className="flex gap-3" style={{ minWidth: "min-content" }}>
            {items.map((r) => {
              const d: any = r.person.dossier ?? {};
              return (
                <div key={r.person.id} className="surface-2 w-60 shrink-0 p-5">
                  <div className="flex items-start justify-between">
                    <div className="grid h-10 w-10 place-items-center rounded-xl text-[12px] font-bold" style={{ background: "var(--raise)", color: "var(--accent-2)" }}>{initials(r.person.name)}</div>
                    <button onClick={() => remove(r.person.id)} className="text-[var(--muted)] hover:text-[var(--text)]"><X size={15} /></button>
                  </div>
                  <p className="mt-3 truncate text-[14px] font-semibold">{r.person.name}</p>
                  <p className="truncate text-[12px]" style={{ color: "var(--muted)" }}>{r.person.current_title}</p>
                  <div className="mt-3"><MatchMeter score={r.score} /></div>
                  <Row label="Company">{r.person.company ?? "—"}</Row>
                  <Row label="Location">{r.person.location ?? "—"}</Row>
                  <Row label="Experience">{d.years != null ? `${d.years} yrs` : "—"}</Row>
                  <Link href={`/person/${encodeURIComponent(r.person.id)}`} className="mt-4 inline-flex items-center gap-1 text-[12px] font-medium text-accent">View profile <ArrowRight size={12} /></Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="mt-2.5 flex items-center justify-between border-t border-[var(--line)] pt-2.5 text-[12px]"><span style={{ color: "var(--muted)" }}>{label}</span><span className="truncate pl-2 text-right" style={{ color: "var(--text-2)" }}>{children}</span></div>;
}
