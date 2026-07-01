"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bookmark, DoorOpen } from "lucide-react";
import { useStore } from "@/lib/store";

function Wordmark() {
  return (
    <span className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 place-items-center rounded-xl text-white" style={{ background: "var(--accent)" }}>
        <DoorOpen size={17} />
      </span>
      <span className="font-display text-[19px] font-semibold tracking-tight">Third Door</span>
    </span>
  );
}

export function TopNav() {
  const path = usePathname();
  const router = useRouter();
  const { items } = useStore();
  const onHome = path === "/";

  return (
    <header className="sticky top-0 z-50 border-b border-[var(--line)] bg-[var(--bg)]/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <Link href="/"><Wordmark /></Link>
        <nav className="flex items-center gap-2 sm:gap-4">
          {onHome && <a href="#how" className="hidden px-2 text-[14px] font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text)] sm:block">How it works</a>}
          {!onHome && <Link href="/search" className={`hidden px-2 text-[14px] font-medium transition-colors sm:block ${path?.startsWith("/search") ? "text-[var(--text)]" : "text-[var(--text-2)] hover:text-[var(--text)]"}`}>Search</Link>}
          <Link href="/shortlist" className="flex items-center gap-1.5 px-2 text-[14px] font-medium text-[var(--text-2)] transition-colors hover:text-[var(--text)]">
            <Bookmark size={15} /> Saved
            {items.length > 0 && <span className="tnum grid h-5 min-w-5 place-items-center rounded-full bg-[var(--accent-soft)] px-1 text-[11px] font-bold text-[var(--accent-2)]">{items.length}</span>}
          </Link>
          <button onClick={() => router.push("/search")} className="ui-btn-primary !rounded-full !px-4 !py-2.5 !text-[14px]">Find people</button>
        </nav>
      </div>
    </header>
  );
}
