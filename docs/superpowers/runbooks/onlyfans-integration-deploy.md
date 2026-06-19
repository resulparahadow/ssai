# OnlyFans Integration — Deploy & Rollout Runbook

## One-time setup
1. Run `sql/onlyfans_integration_migration.sql` in the Supabase SQL Editor.
2. Set secrets: `ONLYFANS_API_KEY`, `ONLYFANS_WEBHOOK_SECRET` (Edge Function secrets).
3. Deploy functions: `onlyfans-proxy`, `onlyfans-webhook` (CLI `supabase functions deploy <name> --no-verify-jwt`, or paste in the Dashboard).
4. Register the webhook in the OnlyFansAPI dashboard: URL `<SUPABASE_URL>/functions/v1/onlyfans-webhook`, event `messages.received`, secret header = `ONLYFANS_WEBHOOK_SECRET`.

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
