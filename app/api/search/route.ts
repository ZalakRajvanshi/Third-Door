import { NextRequest, NextResponse } from "next/server";
import { runSearch } from "@/lib/search";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const { q, jd, note } = await req.json();
    const hasInput = [q, jd, note].some((v) => typeof v === "string" && v.trim());
    if (!hasInput) {
      return NextResponse.json({ error: "Provide a job description, a description, or a note." }, { status: 400 });
    }
    const result = await runSearch({ q, jd, note });
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("[/api/search]", e);
    return NextResponse.json({ error: "Search failed." }, { status: 500 });
  }
}
