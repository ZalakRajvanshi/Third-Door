// Continuous embedding sync. Runs the backfill, sleeps, repeats — forever.
// New profiles get embedded automatically within one interval. Each profile is
// embedded ONCE (the backfill skips rows that already have an embedding), so this
// only ever pays for genuinely new rows — pennies.
//
// Run it and leave it on:   node scripts/sync_embeddings.mjs
// Change the cadence:        SYNC_INTERVAL_MIN=15 node scripts/sync_embeddings.mjs   (default 30)
//
// (On a deployed server you'd instead schedule /api/cron/embed with a cron — same effect.)

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const BACKFILL = fileURLToPath(new URL("./backfill_embeddings.mjs", import.meta.url));
const MIN = Math.max(1, Number(process.env.SYNC_INTERVAL_MIN || 30));

function runOnce() {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [BACKFILL], { stdio: "inherit" });
    p.on("close", (code) => resolve(code));
  });
}

console.log(`[sync] embedding sync started — topping up every ${MIN} min. Ctrl+C to stop.`);
for (;;) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`\n[sync ${t}] checking for new profiles…`);
  try { await runOnce(); } catch (e) { console.error("[sync] run errored (will retry next cycle):", e?.message || e); }
  await new Promise((r) => setTimeout(r, MIN * 60_000));
}
