"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Upload, FileText, X, Loader2 } from "lucide-react";
import { setPendingSearch } from "@/lib/store";

// JD-primary search input: paste a job description OR upload a file (PDF/DOCX/TXT),
// plus an optional note to focus the search. This is the main entry to a search.

export function JDSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [jd, setJd] = useState("");
  const [note, setNote] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  // grow the textarea with its content (up to a max, then it scrolls)
  function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(420, Math.max(64, el.scrollHeight)) + "px";
  }
  useEffect(() => { autoGrow(taRef.current); }, [jd]); // re-grow when a file fills it

  async function handleFile(file: File) {
    setErr(null); setParsing(true); setFileName(file.name);
    try {
      const fd = new FormData(); fd.append("file", file);
      const res = await fetch("/api/parse-jd", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Couldn't read that file.");
      setJd(data.text); // show extracted text so the recruiter can review/edit
    } catch (e: any) {
      setErr(e.message || "Couldn't read that file. Try pasting the JD instead.");
      setFileName(null);
    } finally {
      setParsing(false);
    }
  }

  function submit() {
    const j = jd.trim(), n = note.trim();
    if (!j && !n) { setErr("Paste a job description, upload a file, or add a note."); return; }
    setPendingSearch({ jd: j, note: n });
    router.push("/search");
  }

  return (
    <div className="w-full">
      {/* JD card */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f) handleFile(f); }}
        className="jd-card relative overflow-hidden"
        style={{ borderColor: drag ? "var(--accent)" : undefined }}
      >
        {/* header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--line)] px-4 py-2.5">
          <span className="label inline-flex items-center gap-2"><FileText size={13} style={{ color: "var(--accent)" }} /> Paste job description</span>
          <button type="button" onClick={() => fileRef.current?.click()} className="jd-upload" disabled={parsing}>
            {parsing ? <><Loader2 size={14} className="animate-spin" /> Reading…</> : <><Upload size={14} /> Upload a file</>}
          </button>
        </div>

        <textarea
          ref={taRef}
          value={jd}
          onChange={(e) => { setJd(e.target.value); autoGrow(e.target); }}
          autoFocus={autoFocus}
          placeholder="Paste the job description here…  or click “Upload a file” to add a PDF, DOCX or TXT."
          className="block w-full resize-none overflow-y-auto bg-transparent px-4 py-3 text-[14.5px] leading-relaxed outline-none"
          style={{ minHeight: 64, maxHeight: 420 }}
        />

        {/* footer — only when there's a file or text, so the empty box stays compact */}
        {(jd || fileName) && (
          <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-4 py-2">
            {fileName && !parsing ? (
              <span className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px]" style={{ background: "var(--raise)", color: "var(--text-2)" }}>
                <FileText size={12} style={{ color: "var(--pos)" }} /> {fileName.length > 30 ? fileName.slice(0, 27) + "…" : fileName}
                <button type="button" onClick={() => { setFileName(null); setJd(""); }} className="ml-0.5 opacity-60 transition-opacity hover:opacity-100"><X size={12} /></button>
              </span>
            ) : <span />}
            {jd && <span className="tnum text-[11px]" style={{ color: "var(--faint)" }}>{jd.length.toLocaleString()} chars</span>}
          </div>
        )}

        {/* drag overlay */}
        {drag && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center" style={{ background: "rgba(194,146,94,.06)" }}>
            <span className="flex items-center gap-2 rounded-md border border-[var(--accent)] px-3 py-1.5 text-[13px]" style={{ background: "var(--panel)", color: "var(--accent-2)" }}><Upload size={14} /> Drop to read the JD</span>
          </div>
        )}
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
      </div>

      {/* optional note */}
      <div className="jd-note mt-3 flex items-center gap-3 px-4">
        <span className="label shrink-0" style={{ letterSpacing: ".1em" }}>Note</span>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Optional — focus the search (e.g. “prioritise fintech, must be in Bangalore”)"
          className="flex-1 bg-transparent py-3 text-[14px] outline-none"
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
      </div>

      {err && <p className="mt-2.5 text-[12.5px]" style={{ color: "var(--warn)" }}>{err}</p>}

      <div className="mt-5 flex items-center gap-4">
        <button onClick={submit} className="btn btn-primary !h-12 !px-6 !text-[14px]">Find people <ArrowRight size={16} /></button>
        <span className="text-[12.5px]" style={{ color: "var(--muted)" }}>No JD? Just write a note.</span>
      </div>
    </div>
  );
}
