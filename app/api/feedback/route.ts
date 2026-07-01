import { NextRequest, NextResponse } from "next/server";
import { logEvent } from "@/lib/learning";
import { companyTier } from "@/lib/knowledge";
import { ensureCompanies } from "@/lib/companies";

// Records a behaviour event (open / save / unsave / contact) for the learning loop.
// The client sends minimal data; we enrich with the company's verified tier.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const b = await req.json().catch(() => ({}));
    if (!b?.event) return NextResponse.json({ ok: false }, { status: 400 });
    await ensureCompanies();
    await logEvent({
      event: b.event,
      person_id: b.personId,
      name: b.name,
      company: b.company,
      role_family: b.roleFamily,
      domains: Array.isArray(b.domains) ? b.domains : undefined,
      tier: b.company ? companyTier(b.company) : undefined,
      query: b.query,
      reason: b.reason,
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 200 }); // never break the UI over feedback
  }
}
