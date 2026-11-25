# Scripts Layout Fix + CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Scripts to where CreatorHero has them — a Scripts button + panel on the message box for chatters, a sent-PPVs list in the right rail's PPV tab, and a manager-only Scripts page with CSV import from CreatorHero.

**Architecture:** Server gains a `needs_media` flag on steps, a CSV import endpoint (preview + commit), a send guard for needs-media steps and a thin `/scripts` page shell. The client moves the existing rail UI into a composer panel (use only), replaces the rail's Scripts tab with a PPV tab built from the loaded thread, and adds `pages/Scripts.vue` for management reusing `SsScriptStepModal`.

**Tech Stack:** Laravel 13 / Pest, Inertia 2 + Vue 3 TS, Wayfinder (generated, git-ignored), node client checks in `tests/client/`.

**Spec:** `docs/superpowers/specs/2026-11-25-scripts-design.md` — sections "Chat UI" (revised 2026-11-26) and "Where scripts are managed (revised 2026-11-26)", incl. "Import from CreatorHero".

## Global Constraints

- Everything in the 2026-11-25 Scripts plan's constraints still holds (price 0 or $3–$200, ≤40 media, creator pinning, `validateJson`, explicit `$fillable`, reads/marks for anyone assigned, writes `can:manage-team`, ledger never loses rows, step text never in `context`).
- A step with `needs_media = true` is the ONLY step allowed to hold `price > 0` with empty media. It cannot be loaded in the chat (client) and cannot be sent (`send` with its `scriptStepId` → 422 `'This step needs media before it can be sent.'`). Saving media on it clears the flag.
- CSV columns (CreatorHero export): `Name, Category, Script Order, Message, Fallback, Price, Created At`. Trim every name. Group by Category → one script; order steps by `Script Order` (int) within a category. Title ≤120, text ≤2000, fallback ≤60 (truncate, report truncations in the preview). Price parsed as float; a price not 0 and not in $3–$200 → imported as 0 with a preview warning.
- Needs-media rule on import: title matches `/\((?:\s*PPV|\s*FREE)\s*\)|FREE PIC/i` OR price > 0 → `needs_media = true`, media `[]`.
- Import never merges: a script whose trimmed name already exists for the creator is skipped (reported). The uploaded file is never stored. Max upload 1 MB, `.csv`/`text/csv`/`text/plain`.
- The `/scripts` page and the import endpoint are `can:manage-team`; chatters get no sidebar item and a 403 on the route.
- The rail is Fan · AI Intel · PPV. The "no auto-switch to AI Intel while on Scripts" exception is removed (a reply Generate switches to AI Intel again; caption mode still doesn't).
- Never `prettier --write` a glob. `npm run lint:check`, `types:check`, `php artisan test`, client checks must pass.

## Review Focus

1. **Needs-media step reaching a fan** — loading must be refused in the composer panel and a hand-crafted send with its id must 422 before the vendor call. Pinned in Tasks 1 and 2.
2. **Re-import of the same CSV** — must create nothing new and say every script was skipped. Pinned in Task 1.
3. **CreatorHero CSV quirks** — trailing spaces in names/categories, BOM, quoted multi-line messages, out-of-rule price. Pinned in Task 1 (use the real `Scripts.csv` shape in a fixture, not the file itself).
4. **Sent-PPV list correctness** — free media (price 0) and fan-sent messages must not appear; a mass PPV shows its Mass label; Bought follows `isOpened`. Pinned in Task 2.
5. **Composer panel and a dirty composer** — loading from the panel keeps the existing replace confirm and stale-reply guard (`stepLoads`). Pinned in Task 2.

---

### Task 1: Server — needs_media, CSV import, send guard, page shell

**Files:**
- Create: `database/migrations/2026_11_26_100000_add_needs_media_to_script_steps.php`
- Modify: `app/Models/ScriptStep.php` (`needs_media` fillable + bool cast), `app/Http/Controllers/ScriptController.php` (present `needsMedia`; update clears it when media saved; rules allow price-without-media only when the stored step `needs_media`), `app/Http/Controllers/OnlyFansChatController.php` (`send` guard)
- Create: `app/Services/Scripts/CreatorHeroScriptImport.php`, `app/Http/Controllers/ScriptsPageController.php`
- Modify: `routes/web.php` (`POST onlyfans/{model}/scripts/import` in the manage-team group, registered above `scripts/{script}`; `GET /scripts` page route with `can:manage-team`)
- Test: `tests/Feature/ScriptImportTest.php` (create), extend `tests/Feature/OnlyFansChatSendStepTest.php`, `tests/Feature/ScriptTest.php`

**Interfaces:**
- Produces:
  - `CreatorHeroScriptImport::parse(string $csv): array{scripts: list<array{name:string, steps: list<array{title,text,fallbackName,price,needsMedia,order}>}>, warnings: list<string>}` (pure).
  - `POST onlyfans/{model}/scripts/import` multipart `file`, `commit` (bool, default false) → `{scripts: [{name, steps: n, needsMedia: n, skipped: bool}], warnings: string[], totals: {scripts, steps, needsMedia, skipped}}`; with `commit=1` it also writes (one DB transaction) and returns the same shape plus `created: n`.
  - StepDto gains `needsMedia: boolean`.
  - `GET /scripts` → Inertia `Scripts` page (no props; creator from the app-wide context, like `MediaVaultController`).

- [ ] **Step 1: Write the failing tests** — `ScriptImportTest`: parses a fixture shaped like CreatorHero's export (BOM, header, `"Master Script "` with trailing space, a quoted multi-line Message, `MS 1.7 (PPV)` price 12, `MS 1.4 (FREE)` price 0, an off-rule price 2.5) → grouping, order, trimmed names, needsMedia on both, price 2.5→0 with a warning; preview writes nothing; commit creates scripts/steps with `needs_media`; second commit of the same file creates nothing and reports all skipped; chatter → 403; another creator's model → 404; oversize/non-csv → 422. `OnlyFansChatSendStepTest`: send with a needs-media step id → 422 and no vendor call. `ScriptTest`: updating a needs-media step with media clears the flag; a non-needs-media step still rejects price without media; `GET /scripts` 200 for manager, 403 for chatter.
- [ ] **Step 2: Run** `php artisan test --filter='ScriptImportTest|OnlyFansChatSendStepTest|ScriptTest'` — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the same filter, then `php artisan test` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): needs-media steps, CreatorHero CSV import, scripts page route`

### Task 2: Chat — composer Scripts panel + sent-PPV rail tab

**Files:**
- Create: `resources/js/components/crm/conversations/SsScriptsPanel.vue` (use-only: levels script list → steps → preview; Mark sent/Unmark; no CRUD), `resources/js/components/crm/conversations/SsSentPpvs.vue`, `resources/js/lib/sentPpvs.ts`
- Delete: `resources/js/components/crm/conversations/SsScriptsRail.vue` (its use parts move to the panel; manager parts move to Task 3's page)
- Modify: `resources/js/components/crm/conversations/SsComposer.vue` (Scripts button top-right of the input card, panel toggle), `resources/js/pages/Conversations.vue` (rail tabs `fan | ai | ppv`; remove the three `rail.value !== 'scripts'` exceptions; mount `SsSentPpvs`; wire the panel's `load` to the existing `loadStep`), `resources/js/types/crm.ts` (`ScriptStep.needsMedia`)
- Test: `tests/client/scripts-check.mjs` (extend)

**Interfaces:**
- Consumes: Task 1 `needsMedia`; existing `ofApi.scripts/scriptStatus/markStep/unmarkStep`, `scriptProgress`, `loadStep`.
- Produces:
  - `sentPpvs(messages: OfMessage[]): { id: string; price: number; opened: boolean; mass: boolean; photos: number; videos: number; thumb: OfMedia | null; text: string; createdAt: string | null }[]` — creator messages with `price > 0` and media, newest first.
  - Panel behaviour per spec "1. Scripts button + panel": opens above the message box over the thread bottom, full composer width; level 1 scripts + progress; level 2 steps (title, one-line text, kind badge, Sent/Bought, Next, ◉ preview, ⋯ Mark sent/Unmark); preview with `‹ n/N ›` and **Use**; click/Use loads and closes; a needs-media step shows a "Needs media" badge, is not loadable, and its row says "Ask a manager to add media"; Esc / outside click / button closes; arrow keys + Enter.
  - Rail PPV tab per spec "2. Right rail → PPV tab": cards (thumb, price, Bought/Not bought, counts, relative time, 2-line caption, Mass label), click scrolls the thread to the message, empty "No PPVs sent to this fan yet."

- [ ] **Step 1: Write the failing checks** in `scripts-check.mjs` for `sentPpvs`: fan message with price ignored; creator free media (price 0) ignored; priced creator message included with counts; `isOpened` → opened; `fromQueue` → mass; order newest first.
- [ ] **Step 2: Run** `node --experimental-strip-types tests/client/scripts-check.mjs` — Expected: FAIL.
- [ ] **Step 3: Implement** helper, components, composer + page wiring.
- [ ] **Step 4: Run** both client checks, `npm run types:check`, `npm run lint:check`, prettier on changed files — Expected: PASS.
- [ ] **Step 5: Commit** `feat(scripts): composer Scripts panel, sent-PPV rail tab`

### Task 3: Scripts management page + import UI

**Files:**
- Create: `resources/js/pages/Scripts.vue`, `resources/js/components/crm/scripts/SsScriptsManager.vue` (list/search/CRUD/reorder), `resources/js/components/crm/scripts/SsScriptImportModal.vue`
- Modify: `resources/js/app.ts` (`Scripts` → `SmartStarsLayout`), `resources/js/crm/nav.ts` (sidebar **Scripts**, `cap: 'manageTeam'`, href `/scripts`, after Media Vault), `resources/js/lib/onlyfans.ts` (`importScripts(m, file, commit)` multipart)

**Interfaces:**
- Consumes: Task 1 endpoints; existing `ofApi` script CRUD/reorder; `SsScriptStepModal` unchanged; app-wide creator context (follow `MediaVault.vue`: creators prop, `SsCreatorPrompt` when none, `hydrated` placeholder guard).
- Produces per spec "3. A Scripts page": wide list, scripts as expandable folders (name, step count, needs-media count), steps (title, kind badge or **Needs media**, one-line text, media count, price), search over title + text, New script / New step / rename / delete (confirm with step count; history kept) / reorder (drag if cheap, ↑/↓ always), Edit opens `SsScriptStepModal`; **Import CSV** → modal: choose file → preview table (per script: steps, needs media, skipped) + warnings → Import → refresh; empty state "No scripts yet" with New script + Import CSV.

- [ ] **Step 1: Verify in the browser** (isolated harness: throwaway SQLite, fake vendor, `php -S` from `public/`, playwright-core, `--host-resolver-rules=MAP localhost 127.0.0.1`; never the real DB or vendor), using a fixture CSV shaped like CreatorHero's export (generate it; do not commit `Scripts.csv`): manager imports → preview counts → import → page lists scripts with Needs media badges → re-import says skipped → attach media to a needs-media step → badge gone; chat: Scripts button opens the panel, progress shows, a needs-media step can't load, a normal step loads and closes the panel; rail PPV tab lists a priced message with Bought/Not bought; chatter: no Scripts sidebar item, `/scripts` 403, panel has Mark sent but no edit. Light + dark, 1440 and 1024. Expected: all of the above, no new console errors.
- [ ] **Step 2: Implement** until Step 1 passes.
- [ ] **Step 3: Run** types, lint, prettier on changed files, client checks, `php artisan test` — Expected: PASS.
- [ ] **Step 4: Commit** `feat(scripts): scripts management page with CreatorHero import`

### Task 4: Docs

**Files:** `CLAUDE.md` (Scripts paragraph: composer panel, PPV tab = sent PPVs from the thread, `/scripts` page, import + needs-media, AI Intel auto-switch exception removed), `docs/chatter-guide.md` §7 (Scripts button, sent-PPV tab; managers: Scripts page + import).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Run** `php artisan test` + both client checks — Expected: PASS.
- [ ] **Step 3: Commit** `docs(scripts): layout fix, scripts page, import`
