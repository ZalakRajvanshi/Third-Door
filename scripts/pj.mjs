import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const l of readFileSync(new URL("../.env.local", import.meta.url),"utf8").split(/\r?\n/)){const m=l.match(/^([A-Z_]+)=(.*)$/);if(m)env[m[1]]=m[2];}
const c = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY);
const { data } = await c.from("profiles").select("parsed_json").eq("role_family","engineering").limit(1);
const pj = data[0].parsed_json;
const show = (k)=>console.log(k, "=>", JSON.stringify(pj[k])?.slice(0,180));
["best_fit_roles","not_a_fit_for","built_products","companies_worked","biggest_scale_metric","education","hard_skills","tools","domains","all_business_models","ai_specifics","thought_leadership_details","company_stages_experienced"].forEach(show);
