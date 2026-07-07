-- sql/onlyfans_integration_migration.sql
-- OnlyFans API integration v1 — schema additions.
-- Run in the Supabase Dashboard SQL Editor (runs as postgres, bypasses RLS).
-- Idempotent: safe to re-run.

ALTER TABLE aich_models   ADD COLUMN IF NOT EXISTS of_account_id text;
ALTER TABLE aich_sessions ADD COLUMN IF NOT EXISTS of_chat_id    text;
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS of_message_id text;
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS send_state    text;
-- The original aich_messages is a draft-log (response_text/input_messages/was_sent).
-- The OF paths (webhook, sync, send-dedup) + the realtime inbound handler store one
-- row per message with sender + text, so add those per-message columns here.
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS sender text;
ALTER TABLE aich_messages ADD COLUMN IF NOT EXISTS "text" text;

-- Dedup key: stops pull / messages.received / messages.sent-echo triple-insert.
-- MUST be a NON-partial unique index: PostgREST upserts use ON CONFLICT (of_message_id),
-- and Postgres cannot use a PARTIAL unique index as the conflict arbiter (42P10 → 400).
-- NULLs are distinct by default, so the many draft-log rows (null of_message_id) coexist
-- while non-null OF ids stay unique.
-- If a partial version was already created, drop it first:
--   DROP INDEX IF EXISTS uq_aich_messages_of_message_id;
CREATE UNIQUE INDEX IF NOT EXISTS uq_aich_messages_of_message_id
  ON aich_messages (of_message_id);

-- Reverse lookup acct_XXXX -> creator_model (webhook + proxy account check).
CREATE INDEX IF NOT EXISTS idx_aich_models_of_account_id
  ON aich_models (of_account_id) WHERE of_account_id IS NOT NULL;

-- Session routing lookup (acct + fan -> session) for the webhook find-or-create.
CREATE INDEX IF NOT EXISTS idx_aich_sessions_of_chat_id
  ON aich_sessions (creator_model, of_chat_id) WHERE of_chat_id IS NOT NULL;

-- Prevent duplicate sessions for the same fan under concurrent webhook deliveries (TOCTOU).
CREATE UNIQUE INDEX IF NOT EXISTS uq_aich_sessions_creator_of_chat
  ON aich_sessions (creator_model, of_chat_id) WHERE of_chat_id IS NOT NULL;
