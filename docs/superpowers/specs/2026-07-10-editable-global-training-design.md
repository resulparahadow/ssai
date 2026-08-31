# Editable Global Training (admin settings) — Design

**Date:** 2026-07-10
**Status:** Design (pending implementation plan)
**Owner area:** Settings · Doctrine · Engine

## Goal

Restore the legacy "Global Training" settings feature in the new app: an
**admin-only** settings page to **view / edit / PDF-upload / reset** the global
agency doctrine (the "brain"), and wire the active doctrine into AI generation so
edits actually change output. Behaviour mirrors the legacy `js/app.js` Global
Training tab (`saveTraining` / `resetTraining` / `extractPdf` /
`checkDoctrineIntegrity`).

### What legacy did (reference)

- Settings → **Global Training** tab: a big textarea, plus **Upload PDF**,
  **Reset Default**, **Save Training** buttons (`legacy/index.html:322,338-352`).
- **Save** (`legacy/js/app.js:1550`): integrity-gate (`checkDoctrineIntegrity` —
  min 6000 words + 10 required section markers), typed "SAVE ANYWAY" override if
  broken, then persist. Injected as "LAYER 1: GLOBAL AGENCY TRAINING" into every
  generation call (`legacy/js/app.js:6442`).
- **Reset** (`legacy/js/app.js:1597`): typed "RESET DOCTRINE" confirm → back to the
  code `DEFAULT_TRAINING`.
- **PDF** (`legacy/js/app.js:1648`): PDF.js extracts text **client-side** into the
  textarea; the user reviews then Saves (upload does not auto-save).

## Key decisions

1. **Effect on AI:** the saved doctrine **drives generation** (not display-only).
2. **Access:** **admin only** (new `edit-global-training` gate).
3. **Canonical source = the engine.** Because the Docker `app` (PHP-FPM) container
   has no Node and can't re-eval `legacy/js/doctrine.js` at runtime, the default
   (canonical) doctrine is read live from the engine via a new `GET /doctrine`
   endpoint. The `doctrines` table stores only **overrides**. This preserves
   CLAUDE.md's invariant that the engine runs the exact canonical brain.
4. **PDF extraction is client-side** (`pdfjs-dist`, a new npm dep), matching legacy.

## Architecture

```
Admin settings page (Vue)
  │  GET  /settings/global-training      → edit()   (content = override OR engine default)
  │  PUT  /settings/global-training      → update() (integrity gate → saveCustom)
  │  POST /settings/global-training/reset→ reset()  (resetToDefault)
  ▼
GlobalTrainingController  ──►  DoctrineService  ──►  doctrines table (overrides only)
                                     │
                                     └─► EngineClient::defaultDoctrine()  ──►  engine GET /doctrine
                                                                                (canonical DEFAULT_TRAINING)

Generation:
  EngineClient::buildPayload / generateFromLive
     adds  'doctrine' => active override prompt (or omit when none)
  ──► engine POST /generate  ──►  runGenerate: if (input.doctrine) globalTraining = input.doctrine
```

### Persistence model (`doctrines` table — already exists)

- **Default (canonical):** the engine's in-process `DEFAULT_TRAINING`, exposed by
  `GET /doctrine`. Not stored as a required row.
- **Override:** the `is_active` row in `doctrines` (0 or 1). `DoctrineService::active()`.
- **Save:** insert a new `{version:'custom', prompt, sha256, tier:'system',
  is_active:true, notes}`, deactivating any prior active. Old rows are retained →
  free audit/rollback history (mirrors legacy `aich_models_backups`); latest active
  wins.
- **Reset to default:** deactivate all custom rows → generation reverts to the engine
  canonical. History rows retained (not deleted).

No migration needed — the `doctrines` table (`version, prompt, sha256, tier,
is_active, notes`) and `Doctrine` model (`$fillable` + `scopeActive`) already fit.

## Components

### 1. Access & routing

- New gate `edit-global-training` in `AppServiceProvider::configureGates()` →
  `UserRole::Admin` only.
- Routes in `routes/settings.php`, middleware `auth` + `can:edit-global-training`:
  - `GET  /settings/global-training` → `GlobalTrainingController@edit`
  - `PUT  /settings/global-training` → `GlobalTrainingController@update`
  - `POST /settings/global-training/reset` → `GlobalTrainingController@reset`
- `SsSettingsLayout.vue` nav gains a **Global Training** item, rendered only when
  `auth.user.role === 'admin'` (shared via `HandleInertiaRequests` → `auth.user`).
- No PDF upload endpoint — extraction is client-side.

### 2. Engine `GET /doctrine`

- `engine/server.js`: add a `GET /doctrine` returning
  `{ ok:true, version, sha256, len, prompt }` from the in-process `DEFAULT_TRAINING`
  / `DEFAULT_TRAINING_SHA256` (version parsed from the header line, same regex as
  `DoctrineSeeder`). Parallels the existing `/health`.
- Guard: extend `engine/smoke.js` (or add a tiny check) asserting `/doctrine`
  returns the canonical sha (`a1bcbcef…`) and `len === doctrineLen`.

### 3. `DoctrineService` additions

Alongside existing `active()` / `hash()` / `integrityOk()`:

- `checkIntegrity(string $text): array{ok:bool,reason:string,missing:string[],words:int}`
  — direct port of legacy `checkDoctrineIntegrity` (`legacy/js/app.js:1394`):
  `MIN_WORDS = 6000`; `REQUIRED_MARKERS = [UNDERLYING FRAMEWORK, IDENTIFYING
  CUSTOMERS, CHAT SKELETON, PROMISE RITUAL, POSTURE SYSTEM, OBJECTION HANDLING,
  GOODBYE FRAMEWORK, AFTERCARE, TOS, HARD RULES]`.
- `saveCustom(string $prompt, ?string $notes = null): Doctrine` — deactivate all,
  insert new active custom row with recomputed `sha256`. There is **no** user-facing
  notes field; the controller passes an auto note (`"Edited in settings by {email} on
  {date}"`) so the retained history rows are self-describing.
- `resetToDefault(): void` — deactivate all custom rows.
- `defaultDoctrine(): array{version,sha256,prompt}` — delegates to
  `EngineClient::defaultDoctrine()` (short-cached, e.g. `Cache::remember` keyed by
  engine url, TTL ~5 min; falls back to the seeded canonical DB row if the engine is
  unreachable).

### 4. `GlobalTrainingController`

- `edit()` → Inertia `settings/GlobalTraining` with:
  `{ content, version, shaShort, words, integrity:{ok,reason,missing}, updatedAt,
  isDefault }` where `content` is the active override's prompt, or the engine default
  when no override (isDefault=true).
- `update(Request)` → validate `content: required|string`, `force: boolean`. Run
  `checkIntegrity`; if `!ok && !force` → **422** with `{reason, missing, words}` (the
  frontend shows the typed "SAVE ANYWAY" confirm and resubmits with `force:true`).
  Else `DoctrineService::saveCustom(content, notes?)`, redirect back with flash.
- `reset()` → `DoctrineService::resetToDefault()`, redirect back with flash.

### 5. `EngineClient` — wire into generation

- Add a private `activeDoctrinePrompt(): ?string` returning
  `app(DoctrineService::class)->active()?->prompt`.
- In **both** payload builders (`buildPayload` and `generateFromLive`), add
  top-level `'doctrine' => $this->activeDoctrinePrompt()`. When null the key is
  omitted (or ignored by the engine's `if (input.doctrine)` guard at
  `engine/runGenerate.js:43`) → engine falls back to its in-process `DEFAULT_TRAINING`.
- Add `defaultDoctrine(): array` that GETs `{engine.url}/doctrine`.
- Update the class doc comment that currently states the doctrine is "intentionally
  NOT sent."
- Parity guards (`engine/parity.js`) test the constant directly and are unaffected.

### 6. Frontend `settings/GlobalTraining.vue`

- Layout: `[SmartStarsLayout, SsSettingsLayout]` like the other settings pages.
- Status row: version, word count, short sha, integrity OK / ⚠ (with missing
  markers), last-updated, and a **Default** vs **Custom** badge.
- Tall monospace `<textarea>` bound to `content`.
- **PDF upload** (client-side `pdfjs-dist`, file input + drag-drop): extract text →
  fill textarea + status ("✓ Extracted N pages from file.pdf"). Does **not**
  auto-save.
- **Save Training**: submits `PUT`; on 422 shows a typed "SAVE ANYWAY" confirm and
  resubmits with `force:true`.
- **Reset to Default**: typed "RESET DOCTRINE" confirm → `POST …/reset`.

## Data flow (save)

1. Admin edits textarea (or loads a PDF → textarea), clicks Save.
2. `PUT /settings/global-training { content, force? }`.
3. Controller `checkIntegrity`. If broken and not forced → 422 → UI confirm →
   resubmit `force:true`.
4. `saveCustom` deactivates prior active, inserts new active custom row (sha256
   recomputed).
5. Next generation: `EngineClient` sends the new active prompt as `input.doctrine`;
   the engine uses it as Layer 1.

## Error handling

- No active override + engine reachable → default shown / used (canonical).
- Engine unreachable during `edit()` → fall back to the seeded canonical DB row; if
  that's also missing, show an inline error and disable Save with a clear message.
- Non-admin → 403 (gate).
- Empty `content` → 422 validation error (required).

## Testing (Pest + engine guards)

- **Gate:** manager & chatter → 403 on GET/PUT/POST-reset; admin → 200.
- **update:** valid content → new active row created, `sha256` matches body, prior
  row deactivated; invalid (short / missing markers) without force → 422 with
  reason+missing; with `force:true` → saved.
- **reset:** after reset, no active custom row remains (reverts to default).
- **checkIntegrity** unit: word floor + each required marker.
- **EngineClient:** payload includes the active doctrine prompt when an override
  exists; omits it otherwise (fake `Http`).
- **Engine:** `node engine/parity.js` + `node engine/smoke.js` stay green; new
  `/doctrine` check returns canonical sha `a1bcbcef…`.

## Out of scope (YAGNI)

- Version-history browse / rollback picker UI (rows kept in DB, no picker).
- The generator's `_genDoctrineMode` slim/full/none toggle (`legacy/js/app.js:6020`)
  — engine keeps its default.
- Server-side PDF parsing.
- The legacy 3-layer "refuse to run" tamper-recovery machinery
  (`verifyBrainTamper` / `__brainCorrupted`) — the storage-level
  `DoctrineService::integrityOk()` hash check plus the save-time `checkIntegrity`
  gate are sufficient here.

## New dependency

- `pdfjs-dist` (npm) — client-side PDF text extraction, worker bundled via Vite
  (legacy loaded PDF.js from a CDN; npm is cleaner for the built Docker asset
  pipeline).
