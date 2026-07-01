// Provider-agnostic AI client. Works with any OpenAI-compatible chat API:
// Grok/xAI, Groq, OpenAI, OpenRouter, Together, etc. You supply:
//   AI_API_KEY   — the key
//   AI_BASE_URL  — e.g. https://api.x.ai/v1  (Grok), https://api.groq.com/openai/v1, ...
//   AI_MODEL     — e.g. grok-2-latest, llama-3.3-70b-versatile, gpt-4o-mini, ...
// If any are missing, hasLLM is false and the app falls back to heuristics.

const API_KEY = process.env.AI_API_KEY;
const BASE_URL = (process.env.AI_BASE_URL || "").replace(/\/$/, "");
const MODEL = process.env.AI_MODEL || "";

export const hasLLM = Boolean(API_KEY && BASE_URL && MODEL);

// ── Embeddings (semantic search) — separate key/model so chat & embeddings can
//    use different providers. Defaults to OpenAI text-embedding-3-small (1536-dim). ──
const EMBED_KEY = process.env.EMBEDDING_API_KEY || API_KEY;
const EMBED_URL = (process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const EMBED_MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

export const hasEmbeddings = Boolean(EMBED_KEY);

/** Embed one piece of text → a 1536-dim vector. Used for the query at search time. */
export async function embed(text: string): Promise<number[]> {
  if (!hasEmbeddings) throw new Error("Embeddings not configured (EMBEDDING_API_KEY)");
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBED_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: text.slice(0, 8000) }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? [];
}

/** Embed several texts in ONE call (for multi-persona search). Output order matches input. */
export async function embedMany(texts: string[]): Promise<number[][]> {
  if (!hasEmbeddings) throw new Error("Embeddings not configured (EMBEDDING_API_KEY)");
  if (!texts.length) return [];
  const res = await fetch(`${EMBED_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${EMBED_KEY}` },
    body: JSON.stringify({ model: EMBED_MODEL, input: texts.map((t) => t.slice(0, 8000)) }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}`);
  const data = await res.json();
  return (data?.data ?? []).map((d: any) => d.embedding as number[]);
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** One call to an OpenAI-compatible /chat/completions endpoint. Returns text. */
export async function callAI(messages: ChatMessage[], maxTokens = 1500): Promise<string> {
  if (!hasLLM) throw new Error("AI not configured");
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages,
      max_tokens: maxTokens,
      temperature: 0.2,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AI ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = await res.json();
  return data?.choices?.[0]?.message?.content ?? "";
}

/** Pull the first JSON object/array out of a model response, tolerant of prose/fences. */
export function extractJson<T>(text: string): T | null {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) return null;
  for (let end = candidate.length; end > start; end--) {
    const slice = candidate.slice(start, end);
    try {
      return JSON.parse(slice) as T;
    } catch {
      /* keep shrinking */
    }
  }
  return null;
}
