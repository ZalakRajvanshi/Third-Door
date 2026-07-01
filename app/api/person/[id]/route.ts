import { NextRequest, NextResponse } from "next/server";
import { getPersonById } from "@/lib/sources/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const person = await getPersonById(decodeURIComponent(params.id));
  if (!person) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ person });
}
