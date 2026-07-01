"use client";

import { useEffect, useState } from "react";

/** Minimal segmented match meter + count-up number. */
export function MatchMeter({ score, segments = 10, showNum = true }: { score: number; segments?: number; showNum?: boolean }) {
  const filled = Math.round((Math.max(0, Math.min(100, score)) / 100) * segments);
  const color = score >= 85 ? "var(--pos)" : score >= 70 ? "var(--accent)" : "var(--faint)";
  const [n, setN] = useState(0);
  useEffect(() => {
    let raf: number; const start = performance.now();
    const tick = (t: number) => { const p = Math.min(1, (t - start) / 800); setN(Math.round((1 - Math.pow(1 - p, 3)) * score)); if (p < 1) raf = requestAnimationFrame(tick); };
    raf = requestAnimationFrame(tick); return () => cancelAnimationFrame(raf);
  }, [score]);
  return (
    <div className="flex items-center gap-2">
      <div className="meter">{Array.from({ length: segments }).map((_, i) => <span key={i} className="seg" style={{ background: i < filled ? color : undefined }} />)}</div>
      {showNum && <span className="tnum text-[14px] font-semibold" style={{ color }}>{n}</span>}
    </div>
  );
}
