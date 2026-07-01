import { NextRequest, NextResponse } from "next/server";
import { getResumeText } from "@/lib/sources/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const resume = await getResumeText(decodeURIComponent(params.id));
  return NextResponse.json({ resume });
}
