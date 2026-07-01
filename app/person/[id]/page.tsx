"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { CandidateDetail } from "@/components/CandidateDetail";
import { readCachedPerson } from "@/lib/store";
import type { RankedPerson } from "@/components/types";

export default function PersonPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const router = useRouter();
  const [data, setData] = useState<RankedPerson | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const cached = readCachedPerson(decodeURIComponent(id));
    if (cached) { setData(cached); setLoading(false); return; }
    fetch(`/api/person/${id}`).then((r) => r.json())
      .then((j) => { if (j.person) setData({ person: j.person, score: j.person.confidence_score ?? 0, why: [], concerns: [] }); })
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="mx-auto max-w-3xl px-6 py-24 text-center text-[14px]" style={{ color: "var(--muted)" }}>Loading profile…</div>;
  if (!data) return (
    <div className="mx-auto max-w-3xl px-6 py-24 text-center">
      <p className="text-[14px]" style={{ color: "var(--muted)" }}>Profile not found.</p>
      <Link href="/search" className="mt-3 inline-block text-accent text-[14px]">Back to search</Link>
    </div>
  );

  return (
    <div className="mx-auto max-w-3xl px-6 py-6">
      <button onClick={() => router.back()} className="back mb-4"><ChevronLeft size={15} /> Back</button>
      <div className="surface overflow-hidden"><CandidateDetail data={data} /></div>
    </div>
  );
}
