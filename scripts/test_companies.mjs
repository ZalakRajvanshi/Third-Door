import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) env[m[1]] = m[2];
}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);

function deriveTier(r) {
  if (r.is_faang || r.is_unicorn || r.is_big4 || r.is_consulting) return "tier1";
  const bs = Number(r.brand_strength_score) || 0;
  if (bs >= 60) return "tier1";
  if (bs >= 35 || r.is_bank || r.is_nbfc) return "tier2";
  return "tier3";
}

const names = ["flipkart", "razorpay", "cashfree", "phonepe", "swiggy", "google", "mckinsey", "tcs", "byju", "unacademy", "cred", "meesho"];
for (const n of names) {
  const { data } = await c.from("companies_metadata")
    .select("canonical_name,brand_strength_score,is_faang,is_unicorn,is_big4,is_consulting,is_bank,is_nbfc,is_payments_fintech,is_saas_b2b,is_ecommerce,primary_domain,competitors")
    .ilike("normalized_key", n).limit(1);
  const r = data?.[0];
  if (!r) { console.log(`${n.padEnd(12)} → not found`); continue; }
  const doms = [r.is_payments_fintech && "payments", r.is_saas_b2b && "saas", r.is_ecommerce && "ecommerce", r.primary_domain].filter(Boolean);
  console.log(`${n.padEnd(12)} → ${deriveTier(r).padEnd(6)} brand=${r.brand_strength_score} domains=[${doms.join(",")}] peers=${(r.competitors||[]).slice(0,3).join("/")}`);
}
