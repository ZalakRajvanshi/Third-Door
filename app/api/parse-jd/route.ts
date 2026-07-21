import { NextRequest, NextResponse } from "next/server";

// Extracts plain text from an uploaded JD file (PDF / DOCX / TXT) so the search
// flow can treat every JD the same way. Heavy parsers are dynamically imported so
// they don't bloat cold starts when someone only pastes text.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB — JDs are small; reject anything absurd

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!file || typeof file === "string") {
      return NextResponse.json({ error: "No file uploaded." }, { status: 400 });
    }
    const blob = file as File;
    if (blob.size > MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 8 MB)." }, { status: 413 });
    }

    const name = (blob.name || "").toLowerCase();
    const buf = Buffer.from(await blob.arrayBuffer());
    let text = "";

    if (name.endsWith(".pdf") || blob.type === "application/pdf") {
      // unpdf ships a serverless build of pdfjs with fonts/cmaps bundled, so it works on Vercel.
      // pdf-parse (via pdfjs-dist) threw at runtime there — it needs external files Vercel's
      // bundler doesn't trace — which is why PDF upload 500'd in prod while TXT/DOCX worked.
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const res = await extractText(pdf, { mergePages: true });
      text = Array.isArray(res.text) ? res.text.join("\n") : res.text ?? "";
    } else if (name.endsWith(".docx") || blob.type.includes("officedocument.wordprocessing")) {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ buffer: buf });
      text = res?.value ?? "";
    } else if (name.endsWith(".txt") || name.endsWith(".md") || blob.type.startsWith("text/")) {
      text = buf.toString("utf8");
    } else {
      return NextResponse.json({ error: "Unsupported file. Use PDF, DOCX, or TXT." }, { status: 415 });
    }

    text = text
      .replace(/\r/g, "")
      .replace(/--\s*\d+\s+of\s+\d+\s*--/g, "") // pdf-parse page markers ("-- 1 of 3 --")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!text || text.length < 20) {
      return NextResponse.json({ error: "Couldn't read text from that file. Try pasting the JD instead." }, { status: 422 });
    }
    return NextResponse.json({ text: text.slice(0, 20000), chars: text.length, name: blob.name });
  } catch (e: any) {
    console.error("[/api/parse-jd]", e);
    return NextResponse.json({ error: "Couldn't read that file. Try pasting the JD text." }, { status: 500 });
  }
}
