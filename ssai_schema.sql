-- =============================================================================
-- SSAI — Database Schema (DDL only, no data)
-- Generated from live introspection of the public schema in production.
-- This file is runnable: it recreates the schema in an empty Postgres database.
--
-- Notes for the reader:
--   * Targets PostgreSQL 14+ (Supabase). Uses pgcrypto for gen_random_uuid().
--   * RLS is enabled with permissive policies — see warning before policies.
--   * Two tables (aich_ppv_sales, aich_tips) exist but have no insert path
--     in application code; live PPV/tip data is captured inside aich_events.payload.
-- =============================================================================

-- Required extension for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- =============================================================================
-- SEQUENCES
-- =============================================================================

CREATE SEQUENCE IF NOT EXISTS public.aich_events_id_seq
    AS bigint
    START WITH 1
    INCREMENT BY 1;


-- =============================================================================
-- TABLES
-- (Created in dependency order: parents first.)
-- =============================================================================

-- ── aich_models ──────────────────────────────────────────────────────────────
-- Per-creator persona, prompt, content library, and learned feedback rules.
CREATE TABLE public.aich_models (
    id              uuid          NOT NULL DEFAULT gen_random_uuid(),
    name            text          NOT NULL,
    tier            text,
    prompt          text,
    created_at      timestamptz            DEFAULT now(),
    feedback_rules  text,
    content_library text
);

-- ── aich_sessions ────────────────────────────────────────────────────────────
-- Live + archived chat sessions. Widest table — holds running session state.
-- NOTE: total_spend and tips_spend are stored as text here but as numeric in
-- customer_profiles. This is an inconsistency worth fixing (see findings).
CREATE TABLE public.aich_sessions (
    id                            uuid        NOT NULL DEFAULT gen_random_uuid(),
    creator_model                 text        NOT NULL,
    customer_name                 text        NOT NULL,
    customer_username             text,
    crm_notes                     text,
    total_spend                   text,
    tips_spend                    text,
    time_on_page                  text,
    subscription_status           text                 DEFAULT 'subscribed'::text,
    agent_note                    text,
    messages_input                text,
    status                        text                 DEFAULT 'active'::text,
    is_flagged                    boolean              DEFAULT false,
    last_active_at                timestamptz          DEFAULT now(),
    created_at                    timestamptz          DEFAULT now(),
    current_posture               text                 DEFAULT 'WARM_BUILD'::text,
    free_msg_count                integer              DEFAULT 0,
    unpaid_cta_count              integer              DEFAULT 0,
    aftercare_mode                boolean              DEFAULT false,
    aftercare_context             text,
    story_framework_step          integer              DEFAULT 0,
    session_closed_at             timestamptz,
    session_closed_at_msg_count   integer,
    promise_status                text                 DEFAULT 'not_started'::text,
    ladder_state                  jsonb                DEFAULT '{}'::jsonb
);

-- ── aich_messages ────────────────────────────────────────────────────────────
-- Per-generation log: input messages, agent note, generated response,
-- which API generated it, whether the agent sent it, optional feedback text.
CREATE TABLE public.aich_messages (
    id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
    session_id          uuid,
    creator_model       text,
    customer_username   text,
    input_messages      text,
    agent_note          text,
    response_text       text,
    api_used            text,
    was_sent            boolean                DEFAULT false,
    created_at          timestamptz            DEFAULT now(),
    feedback_text       text
);

-- ── aich_events ──────────────────────────────────────────────────────────────
-- Telemetry stream. Every message_sent, ppv_pitched, drift event, posture
-- transition. Powers the dashboard.
-- NOTE: session_id is text here but uuid everywhere else — this is why no FK
-- exists on this column (Postgres won't allow it across types). See findings.
CREATE TABLE public.aich_events (
    id                  bigint        NOT NULL DEFAULT nextval('public.aich_events_id_seq'::regclass),
    session_id          text          NOT NULL,
    creator_model       text          NOT NULL,
    customer_username   text,
    event_type          text          NOT NULL,
    payload             jsonb                  DEFAULT '{}'::jsonb,
    created_at          timestamptz            DEFAULT now()
);

-- ── aich_vn_used ─────────────────────────────────────────────────────────────
-- Voice notes already sent to a given customer. Prevents repeats.
CREATE TABLE public.aich_vn_used (
    id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
    session_id          uuid,
    creator_model       text,
    customer_username   text,
    voice_note_label    text,
    used_at             timestamptz            DEFAULT now()
);

-- ── aich_ppv_sales ───────────────────────────────────────────────────────────
-- PPV sale records. Provisioned but no code path writes to it. Live PPV data
-- is currently captured inside aich_events.payload.
CREATE TABLE public.aich_ppv_sales (
    id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
    session_id          uuid,
    creator_model       text          NOT NULL,
    customer_username   text,
    amount_gross        numeric(10,2) NOT NULL,
    amount_net          numeric(10,2) NOT NULL,
    caption             text,
    was_unlocked        boolean                DEFAULT false,
    unlocked_at         timestamptz,
    created_at          timestamptz            DEFAULT now()
);

-- ── aich_tips ────────────────────────────────────────────────────────────────
-- Tip records. Provisioned but no code path writes to it. Live tip data is
-- currently captured inside aich_events.payload.
CREATE TABLE public.aich_tips (
    id                  uuid          NOT NULL DEFAULT gen_random_uuid(),
    session_id          uuid,
    creator_model       text          NOT NULL,
    customer_username   text,
    amount              numeric(10,2) NOT NULL,
    created_at          timestamptz            DEFAULT now()
);

-- ── creator_status ───────────────────────────────────────────────────────────
-- Per-creator real-life context (location, mood, voice tics, current obsessions).
-- Auto-expires after 7 days (handled in application code).
CREATE TABLE public.creator_status (
    id              uuid          NOT NULL DEFAULT gen_random_uuid(),
    creator_model   text          NOT NULL,
    category        text          NOT NULL DEFAULT 'note'::text,
    status_text     text          NOT NULL,
    created_at      timestamptz   NOT NULL DEFAULT now(),
    expires_at      timestamptz
);

-- ── customer_profiles ────────────────────────────────────────────────────────
-- Per-customer running analysis: trust, archetype, temperature, timewaster flag.
CREATE TABLE public.customer_profiles (
    id                      uuid          NOT NULL DEFAULT gen_random_uuid(),
    creator_model           text          NOT NULL,
    customer_username       text          NOT NULL,
    customer_name           text,
    total_spend             numeric                DEFAULT 0,
    tips_spend              numeric                DEFAULT 0,
    time_on_page            text,
    subscription_status     text                   DEFAULT 'subscribed'::text,
    trust_level             integer                DEFAULT 1,
    archetype               text,
    temperature             text                   DEFAULT 'cold'::text,
    key_details             text,
    crm_notes               text,
    last_seen_at            timestamptz            DEFAULT now(),
    created_at              timestamptz            DEFAULT now(),
    tw_auto_cleared_at      timestamptz,
    is_timewaster           boolean                DEFAULT false
);


-- =============================================================================
-- PRIMARY KEYS & UNIQUE CONSTRAINTS
-- =============================================================================

ALTER TABLE public.aich_models       ADD CONSTRAINT aich_models_pkey       PRIMARY KEY (id);
ALTER TABLE public.aich_models       ADD CONSTRAINT aich_models_name_key   UNIQUE (name);

ALTER TABLE public.aich_sessions     ADD CONSTRAINT aich_sessions_pkey     PRIMARY KEY (id);

ALTER TABLE public.aich_messages     ADD CONSTRAINT aich_messages_pkey     PRIMARY KEY (id);

ALTER TABLE public.aich_events       ADD CONSTRAINT aich_events_pkey       PRIMARY KEY (id);

ALTER TABLE public.aich_vn_used      ADD CONSTRAINT aich_vn_used_pkey      PRIMARY KEY (id);

ALTER TABLE public.aich_ppv_sales    ADD CONSTRAINT aich_ppv_sales_pkey    PRIMARY KEY (id);

ALTER TABLE public.aich_tips         ADD CONSTRAINT aich_tips_pkey         PRIMARY KEY (id);

ALTER TABLE public.creator_status    ADD CONSTRAINT creator_status_pkey    PRIMARY KEY (id);

ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_pkey PRIMARY KEY (id);
ALTER TABLE public.customer_profiles ADD CONSTRAINT customer_profiles_creator_model_customer_username_key
    UNIQUE (creator_model, customer_username);


-- =============================================================================
-- FOREIGN KEYS
-- (Note: aich_events.session_id has no FK due to type mismatch — it's text,
-- aich_sessions.id is uuid. See findings.)
-- =============================================================================

ALTER TABLE public.aich_messages  ADD CONSTRAINT aich_messages_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.aich_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.aich_vn_used   ADD CONSTRAINT aich_vn_used_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.aich_sessions(id) ON DELETE CASCADE;

ALTER TABLE public.aich_ppv_sales ADD CONSTRAINT aich_ppv_sales_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.aich_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.aich_tips      ADD CONSTRAINT aich_tips_session_id_fkey
    FOREIGN KEY (session_id) REFERENCES public.aich_sessions(id) ON DELETE SET NULL;


-- =============================================================================
-- INDEXES
-- (Primary key and unique-constraint indexes are created automatically by the
-- ALTER TABLE statements above and are NOT repeated here.)
-- =============================================================================

CREATE INDEX idx_aich_events_model_time     ON public.aich_events       USING btree (creator_model, created_at DESC);
CREATE INDEX idx_aich_events_session        ON public.aich_events       USING btree (session_id);
CREATE INDEX idx_aich_events_type           ON public.aich_events       USING btree (event_type);

CREATE INDEX idx_ppv_model_customer         ON public.aich_ppv_sales    USING btree (creator_model, customer_username);
CREATE INDEX idx_ppv_session                ON public.aich_ppv_sales    USING btree (session_id);

CREATE INDEX idx_tips_model_customer        ON public.aich_tips         USING btree (creator_model, customer_username);
CREATE INDEX idx_tips_session               ON public.aich_tips         USING btree (session_id);

CREATE INDEX creator_status_model_idx       ON public.creator_status    USING btree (creator_model, created_at DESC);

CREATE INDEX idx_customer_profiles_is_tw    ON public.customer_profiles USING btree (is_timewaster) WHERE (is_timewaster = true);


-- =============================================================================
-- ROW LEVEL SECURITY
--
-- WARNING — every policy below is permissive (USING true / WITH CHECK true)
-- against the anon role for ALL operations. RLS is technically enabled but
-- enforces nothing: anyone with the public anon key has full read/write/
-- update/delete on every row. The only barrier today is that the anon key
-- isn't published. The anon key is hardcoded in the HTML application file,
-- so any chatter that gets the file gets full database access.
--
-- These policies should be replaced before any rollout that distributes
-- the app beyond one trusted machine. See findings document.
-- =============================================================================

ALTER TABLE public.aich_models       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_sessions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_vn_used      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_ppv_sales    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aich_tips         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.creator_status    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_all"               ON public.aich_models
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all"               ON public.aich_sessions
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all"               ON public.aich_messages
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon all aich_events"   ON public.aich_events
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all"               ON public.aich_vn_used
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_ppv"           ON public.aich_ppv_sales
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all_tips"          ON public.aich_tips
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "creator_status_all_anon" ON public.creator_status
    FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE POLICY "anon_all"               ON public.customer_profiles
    FOR ALL TO anon USING (true) WITH CHECK (true);


-- =============================================================================
-- SEQUENCE OWNERSHIP
-- =============================================================================

ALTER SEQUENCE public.aich_events_id_seq OWNED BY public.aich_events.id;


-- =============================================================================
-- END OF SCHEMA
-- =============================================================================
