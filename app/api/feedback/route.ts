import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/learning";
import { companyTier } from "@/lib/knowledge";
import { ensureCompanies } from "@/lib/companies";

// Records a behaviour event (open / save / unsave / contact) for the learning loop.
// The client sends minimal data; we enrich with the company's verified tier.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// These rows feed prefBoost() and therefore shift ranking for EVERY search, and they're written
// with the service-role key (which bypasses RLS). So validate strictly: an unconstrained `event`
// plus unbounded strings let anyone poison global ranking (600 fake "reject"s for a company
// docks it -5 for every recruiter within the 60s preference TTL).
const EVENTS = new Set(["open", "save", "unsave", "contact", "shortlist", "interview", "hire", "reject"]);
const str = (v: unknown, max: number): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined;

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!EVENTS.has(b?.event)) return NextResponse.json({ ok: false }, { status: 400 });
    const company = str(b.company, 120);
    await ensureCompanies();
    await logEvent({
      event: b.event,
      person_id: str(b.personId, 200),
      name: str(b.name, 120),
      company,
      role_family: str(b.roleFamily, 60),
      domains: Array.isArray(b.domains) ? b.domains.filter((d: unknown) => typeof d === "string").slice(0, 12).map((d: string) => d.slice(0, 40)) : undefined,
      tier: company ? companyTier(company) : undefined,
      query: str(b.query, 300),
      reason: str(b.reason, 300),
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 }); // never break the UI over feedback
  }
}
