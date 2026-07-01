import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const { data } = await c.from("search_learnings").select("role_company, role_title, text").limit(500);
const CACHE = data.filter(r => r.role_company && r.text).map(r => ({ company: r.role_company, ncompany: norm(r.role_company), title: r.role_title||"", text: String(r.text) }));

function match(text) {
  const t = norm(text); const out = []; const seen = new Set();
  for (const l of CACHE) {
    const token = l.ncompany.split(" ").find(w => w.length >= 4) ?? "";
    const hit = (l.ncompany.length >= 4 && t.includes(l.ncompany)) || (token && t.includes(token));
    if (!hit) continue;
    const line = `${l.company}: ${l.text.slice(0,80)}`; const key = line.slice(0,50);
    if (seen.has(key)) continue; seen.add(key); out.push(line); if (out.length >= 4) break;
  }
  return out;
}
for (const jd of ["Founding Product Manager at Trupeer, own the customer journey", "Staff PM role at AiPrise, identity compliance", "AI Engineer fullstack for FSZT Partners SMB clients"]) {
  console.log("\nJD:", jd);
  match(jd).forEach(l => console.log("  →", l));
}
