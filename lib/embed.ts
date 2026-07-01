// Provider-agnostic embeddings (OpenAI-compatible /embeddings endpoint).
// Your stored vectors are 1536-dim OpenAI embeddings, so EMBEDDING_MODEL must be the
// SAME model that generated them (default: text-embedding-3-small). Different model =
// incompatible vectors = bad results.
//
// To ENABLE semantic search you need TWO things:
//   1. EMBEDDING_API_KEY (+ base url/model) here in .env.local
//   2. Run supabase/match_profiles.sql in your Supabase SQL editor (the existing
//      function is broken — wrong search_path for the pgvector operator).

const API_KEY = process.env.EMBEDDING_API_KEY;
const BASE_URL = (process.env.EMBEDDING_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
const MODEL = process.env.EMBEDDING_MODEL || "text-embedding-3-small";

export const hasEmbeddings = Boolean(API_KEY);

/** Embed a single query string → number[] (1536 dims for text-embedding-3-small). */
export async function embedQuery(text: string): Promise<number[]> {
  if (!hasEmbeddings) throw new Error("Embeddings not configured");
  const res = await fetch(`${BASE_URL}/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${API_KEY}` },
    body: JSON.stringify({ model: MODEL, input: text }),
  });
  if (!res.ok) throw new Error(`Embeddings ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const data = await res.json();
  return data?.data?.[0]?.embedding ?? [];
}
