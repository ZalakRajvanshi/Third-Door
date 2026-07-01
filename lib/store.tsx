"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { RankedPerson } from "@/components/types";

interface Store {
  items: RankedPerson[];
  toggle: (r: RankedPerson) => void;
  remove: (id: string) => void;
  has: (id: string) => boolean;
  clear: () => void;
  recents: string[];
  addRecent: (q: string) => void;
}

const Ctx = createContext<Store | null>(null);
const KEY = "thirddoor.shortlist.v2";
const RKEY = "thirddoor.recents.v1";

export function ShortlistProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<RankedPerson[]>([]);
  const [recents, setRecents] = useState<string[]>([]);

  useEffect(() => {
    try { const r = localStorage.getItem(KEY); if (r) setItems(JSON.parse(r)); } catch {}
    try { const r = localStorage.getItem(RKEY); if (r) setRecents(JSON.parse(r)); } catch {}
  }, []);

  useEffect(() => { try { localStorage.setItem(KEY, JSON.stringify(items)); } catch {} }, [items]);
  useEffect(() => { try { localStorage.setItem(RKEY, JSON.stringify(recents)); } catch {} }, [recents]);

  const toggle = useCallback((r: RankedPerson) => {
    setItems((prev) => prev.some((p) => p.person.id === r.person.id) ? prev.filter((p) => p.person.id !== r.person.id) : [...prev, r]);
  }, []);
  const remove = useCallback((id: string) => setItems((prev) => prev.filter((p) => p.person.id !== id)), []);
  const clear = useCallback(() => setItems([]), []);
  const has = (id: string) => items.some((i) => i.person.id === id);
  const addRecent = useCallback((q: string) => {
    const v = q.trim(); if (!v) return;
    setRecents((prev) => [v, ...prev.filter((x) => x.toLowerCase() !== v.toLowerCase())].slice(0, 6));
  }, []);

  return <Ctx.Provider value={{ items, toggle, remove, has, clear, recents, addRecent }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useStore must be used within ShortlistProvider");
  return c;
}
export const useShortlist = useStore;

export interface PendingSearch { jd?: string; note?: string; q?: string }
const PENDING = "thirddoor.pendingSearch";

/** Carry a JD/note search between the home page and /search (too long for the URL). */
export function setPendingSearch(s: PendingSearch) {
  try { sessionStorage.setItem(PENDING, JSON.stringify(s)); } catch {}
}
export function readPendingSearch(): PendingSearch | null {
  try { const r = sessionStorage.getItem(PENDING); return r ? JSON.parse(r) : null; } catch { return null; }
}

export type FeedbackType = "open" | "save" | "unsave" | "contact" | "shortlist" | "interview" | "hire" | "reject";

/** Fire a behaviour/outcome event to the learning loop. Fire-and-forget. */
export function logFeedback(event: FeedbackType, r: RankedPerson, query?: string, reason?: string) {
  try {
    const p = r.person;
    const d = (p.dossier ?? {}) as any;
    fetch("/api/feedback", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, personId: p.id, name: p.name, company: p.company, domains: d.domains ?? [], query, reason }),
      keepalive: true,
    }).catch(() => {});
  } catch {}
}

export function cacheResults(list: RankedPerson[]) {
  try { sessionStorage.setItem("thirddoor.lastResults", JSON.stringify(list)); } catch {}
}
export function readCachedPerson(id: string): RankedPerson | null {
  try {
    const raw = sessionStorage.getItem("thirddoor.lastResults");
    if (!raw) return null;
    return (JSON.parse(raw) as RankedPerson[]).find((r) => r.person.id === id) ?? null;
  } catch { return null; }
}
