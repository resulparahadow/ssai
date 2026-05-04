# SSAI — SmartStarsAI

AI chatter system for OnlyFans agency operations. Single-file browser
application backed by Supabase.

## What this is

A working prototype currently running daily on free-sub creator accounts.
Generates chat responses, tracks PPV pitches and conversions, surfaces
operator dashboards. Designed for one-operator use; not yet hardened for
multi-tenant or autonomous operation.

## Architecture

- **Frontend:** Single HTML file (`SSAI.html`) — vanilla JS, Supabase client
- **Backend:** Supabase (Postgres + auth + realtime)
- **AI providers:** Claude (primary), Mistral (explicit content routing)
- **Storage:** All session state, events, and metrics persist to Supabase

## Setup

1. Open `SSAI.html` in a browser (Chrome recommended)
2. Set `SB_URL` and `SB_KEY` at the top of the script section to your Supabase project credentials
3. On first load, open Settings → API Keys and paste your Claude API key (and optionally Mistral via OpenRouter)
4. Keys are stored in browser localStorage — never committed to source

## Doctrine

The prompts, training documents, beat structure, fork detection logic, and
behavioral playbook are authored work maintained separately from this
repository. The code in this repo is the technical wrapper. Refactors of
the code are welcome; behavioral changes require coordination on the
doctrine side.

## Status

Prototype, not production. See briefing PDF for known gaps and the
prototype-to-production delta. Code audit in progress.
