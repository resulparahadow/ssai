// js/onlyfans.js — OnlyFans API integration (v1). Pure helpers + proxy calls.
// No module system: functions are global (loaded via <script> after app.js, and
// into tests/harness.js). Pure helpers here are mirrored in the Deno Edge
// Functions (supabase/functions/onlyfans-*) — keep them in sync.

// Returns true when a paid (PPV) send must be blocked in v1 (text-only).
function ofPpvBlocked(price){
  const n=Number(price)||0;
  return n>0;
}
