# SmartStars CRM — Legacy Engine Parity (Phase 3)

**Date:** 2026-06-24
**Status:** Implemented (parity + minimal wiring)
**Builds on:** [Foundation (Phase 1)](2026-06-24-laravel-vue-foundation-design.md), [Dashboard slice (Phase 2)](2026-06-24-dashboard-slice-design.md)

## Goal

Run the **exact** legacy SSAI generation logic inside the new project before
enhancing anything. No PHP rewrite (drift risk), no client-side engine (ships IP).

## Decisions (confirmed)
1. **Node engine sidecar** — run the real legacy JS under Node behind an HTTP service Laravel calls.
2. **Parity + minimal wiring first** — identical drafts through `Laravel → engine → back`, exercised by a thin dev screen. Full Conversations UI + enhancements are later.

## How it works

```
Vue dev screen ─▶ Laravel POST /conversations/{id}/generate
                      │  (EngineClient maps MySQL → legacy session shape)
                      └─HTTP─▶ engine/server.js ─▶ real legacy generate() ─▶ Anthropic/Mistral
                                   │  (server-held keys)
                      ◀────────────┘  { draft, strategy, telemetry, writes }
Laravel persists a draft-log AichMessage and returns JSON.
```

### Engine package (`engine/`)
- `loadEngine.js` — loads the **unchanged** legacy `config/doctrine/supabase-client/ui/app/onlyfans.js`
  into ONE Node `vm` context (emulating the browser's shared top-level scope, since the legacy
  globals — `sb, api, sessions, activeId, models, currentSender, globalTraining` — are browser-shared
  `let`s in supabase-client.js). An appended epilogue bridges those bindings out via a scoped `eval`.
  DOM/localStorage/Supabase are stubbed; `getElementById` returns forgiving element stubs.
- `callModel.js` — headless `callApi`/`callMistral` replicating legacy `js/api.js` request shape
  (model ids, `cache_control` system blocks, the verbatim Mistral system prompt). Keys from env.
- `runGenerate.js` — sets the legacy globals from the payload, injects `callApi`/`callMistral`,
  serves creator status from the payload (no DB), runs the **real `generate()` unmodified**, and
  extracts `draft` + `strategy` + `telemetry` + captured DB writes.
- `server.js` — `POST /generate`, `GET /health`; `/analyze` is a stub (post-message analysis is a follow-up).
- `smoke.js` / `parity.js` — run the real pipeline with fake/recording model calls.

api.js is the ONLY legacy file excluded (host injects headless model calls); everything else is byte-identical.

### Laravel
- `config/services.php` → `engine.url` / `engine.timeout`.
- `App\Services\Engine\EngineClient` — maps `AichSession` (+ `AichModel` persona, `CustomerProfile`,
  `CreatorStatus`) into the legacy session shape and calls the engine. Doctrine is NOT sent — the
  engine uses its in-process `DEFAULT_TRAINING` constant (canonical).
- `App\Http\Controllers\GenerationController` → `POST /conversations/{session}/generate`, persists a
  draft-log `AichMessage` (`was_sent=false`, `send_state='draft'`), returns `{draft, strategy, telemetry}`.
- `DoctrineSeeder` — imports the EXACT `DEFAULT_TRAINING` from `legacy/js/doctrine.js` (Node-eval of the
  template literal) into the `doctrines` table; verified `sha256 = a1bcbcef…`, `integrityOk() = true`.
- `EngineDemoSeeder` — one full Camila persona + a demo conversation so the pipeline has real inputs.
- `pages/DevGenerate.vue` (`GET /dev/generate`, in the SmartStars shell) — pick a seeded conversation,
  optional agent context, route; renders the draft + telemetry + strategy JSON.

## Parity evidence
- `node engine/parity.js` — strategy Layer 1 === the **exact 132,232-char doctrine**; persona +
  conversation + TOS blocks present; `cache_control` 1h preserved.
- `node engine/smoke.js` — real `generate()` produces a draft headless (fake model calls).
- `node legacy/tests/harness.js` — **PASS 283 / FAIL 0** (decision layer intact; the engine runs this same code).
- `DoctrineSeeder` integrity matches the documented SHA.
- `php artisan test` — GenerationTest asserts the controller wiring + that the EXACT persona +
  conversation reach the engine (Http faked).

## Running it
- Engine: `ANTHROPIC_API_KEY=… OPENROUTER_API_KEY=… node engine/server.js` (port 8787).
- App: `composer run dev`; visit `/dev/generate` (login `admin@smartstars.test` / `password`).
- Without API keys the pipeline runs through to the model call and returns an empty draft (the legacy
  try/catch swallows the error) — wiring is correct; only the live model call needs a key.

## Out of scope (next)
Post-message analysis (`runAnalysis`/`/analyze`), the full Conversations inbox UI, PPV price suggestion
wiring, OnlyFans live send, real persona/data migration, and any behavioral enhancements (parity first).
