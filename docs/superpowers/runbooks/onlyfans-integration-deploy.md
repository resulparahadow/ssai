# OnlyFans Integration — Deploy & Rollout Runbook

## One-time setup
1. Run `sql/onlyfans_integration_migration.sql` in the Supabase SQL Editor.
2. Set secrets: `ONLYFANS_API_KEY` (required). Webhook auth is layered (first match wins): (a) set `ONLYFANS_WEBHOOK_SECRET` on BOTH sides → HMAC-SHA256 verification against the `Signature` header (most secure, OFapi's documented scheme); (b) else set `ONLYFANS_WEBHOOK_TOKEN` (e.g. `openssl rand -hex 32`) → require `?token=<value>` on every delivery; (c) else neither set → accept all POSTs (fully open endpoint).
3. Deploy functions: `onlyfans-proxy`, `onlyfans-webhook` (CLI `supabase functions deploy <name> --no-verify-jwt`, or paste in the Dashboard). Env vars load at cold start — redeploy after changing a secret.
4. Register the webhook in the OnlyFansAPI dashboard: URL `<SUPABASE_URL>/functions/v1/onlyfans-webhook` (append `?token=<ONLYFANS_WEBHOOK_TOKEN>` for token mode), event `messages.received`. For HMAC mode set the OFapi signing secret to the SAME value as `ONLYFANS_WEBHOOK_SECRET`; for token/open modes leave the OFapi signing secret blank.

## Staged rollout
- **Phase 0:** Steps above. No creator has `of_account_id` → zero behavior change.
- **Phase 1:** Connect ONE pilot creator's OF account in the OnlyFansAPI dashboard; copy its `acct_XXXX` into that creator's SSAI model. Use "Sync from OnlyFans" + watch live inbound for a day. Outbound still manual (don't accept-to-send yet — or accept knowing it sends; pilot the inbound first).
- **Phase 2:** Accept a text reply for the pilot creator → confirm it lands on OnlyFans and dedupes (count=1). Watch `send_state` for failures.
- **Phase 3:** Roll out remaining creators by setting `of_account_id` per model.

## Kill switch
Clear a creator's `of_account_id` (`UPDATE aich_models SET of_account_id=NULL WHERE name='<creator>';`). That creator instantly reverts to fully-manual — no inbound auto-import, no auto-send. The manual flow is never removed.

## Monitoring
- Inbound gaps: re-run "Sync from OnlyFans".
- `SELECT send_state, count(*) FROM aich_messages WHERE send_state IS NOT NULL GROUP BY 1;`
- `accounts.session_expired` (future event): reconnect the account in the OnlyFansAPI dashboard.

## v2 chat loading (paginated + lazy)
- Redeploy `onlyfans-proxy` (adds allowlisted pagination params): `supabase functions deploy onlyfans-proxy --no-verify-jwt`.
- No DB migration (relies on the existing sender/text columns + non-partial of_message_id index).
- UX: sidebar group "Load chats" loads a page of chat stubs; "Load more" pages forward; a chat's messages load when you open it.
- First live "Load more": confirm the `_pagination` param (offset vs id) — the proxy allowlist already supports both.
