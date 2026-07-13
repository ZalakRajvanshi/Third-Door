import { NextRequest } from "next/server";
import { runSearchProgressive } from "@/lib/search";

// Streaming search (Server-Sent Events). Emits a fast `preliminary` shortlist, then
// a `final` AI-ranked one. Same cost as /api/search — just delivered progressively.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // the AI final pass can take a while (Pro plan allows up to 300s)

export async function POST(req: NextRequest) {
  const { q, jd, note } = await req.json().catch(() => ({}));

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (e: any) => {
        try { controller.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); } catch {}
      };
      try {
        await runSearchProgressive({ q, jd, note }, send);
      } catch {
        send({ type: "error", error: "Search failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
