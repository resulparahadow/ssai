// supabase/functions/onlyfans-webhook/index.ts
// Receives OnlyFansAPI webhooks, writes inbound fan messages to SSAI.
// Mirrors ofHtmlStripToText/ofResolveCreator from js/onlyfans.js — keep in sync.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SECRET = Deno.env.get("ONLYFANS_WEBHOOK_SECRET")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const ok = () => new Response("ok", { status: 200 });

function stripToText(html: string): string {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // Verify shared secret (header configured when registering the webhook).
  const sig = req.headers.get("x-ofapi-signature") || req.headers.get("x-webhook-secret") || "";
  if (!SECRET || sig !== SECRET) return new Response("unauthorized", { status: 401 });

  let evt: any;
  try { evt = await req.json(); } catch { return new Response("bad json", { status: 400 }); }
  if (evt?.event !== "messages.received") return ok(); // ignore other events in v1

  const accountId = evt.account_id;
  const p = evt.payload || {};
  const fan = p.fromUser || {};
  const ofMsgId = p.id != null ? String(p.id) : null;
  if (!accountId || !fan.id || !ofMsgId) return ok(); // malformed → drop, don't retry

  // acct -> creator (isolation boundary). Unmapped → log + 2xx (never accept).
  const { data: model } = await sb.from("aich_models")
    .select("name").eq("of_account_id", accountId).maybeSingle();
  if (!model) { console.log("unmapped account", accountId); return ok(); }
  const creatorModel = model.name;
  const ofChatId = String(fan.id);

  // Find-or-create session (creator_model + of_chat_id).
  const { data: existing } = await sb.from("aich_sessions")
    .select("id").eq("creator_model", creatorModel).eq("of_chat_id", ofChatId).maybeSingle();
  let sessionId = existing?.id;
  if (!sessionId) {
    // Attribute to a chatter assigned to this creator, else null (system).
    const { data: asg } = await sb.from("model_assignments")
      .select("chatter_id").eq("creator_model", creatorModel).limit(1).maybeSingle();
    const { data: created } = await sb.from("aich_sessions").insert({
      creator_model: creatorModel,
      customer_name: fan.name || fan.username || ofChatId,
      customer_username: fan.username || ("of_" + ofChatId),
      of_chat_id: ofChatId,
      status: "active",
      current_posture: "WARM_BUILD",
      last_active_at: new Date().toISOString(),
      chatter_id: asg?.chatter_id || null,
    }).select("id").single();
    sessionId = created?.id;
  }
  if (!sessionId) return new Response("session create failed", { status: 500 }); // let OF retry

  // NOTE for the implementer: confirm the actual `aich_messages` column names against the live schema before deploy
  // (this repo has no schema dump). The required columns are `session_id`, `sender`, `text`, `of_message_id`, `created_at`;
  // adjust any others (`creator_model`, `customer_username`) to match what the table actually has. Remove keys the table doesn't define.

  // Idempotent insert (unique of_message_id). ON CONFLICT DO NOTHING via upsert+ignore.
  await sb.from("aich_messages").upsert({
    session_id: sessionId,
    creator_model: creatorModel,
    customer_username: undefined, // optional; left to existing columns
    sender: "customer",
    text: stripToText(p.text),
    of_message_id: ofMsgId,
    created_at: p.createdAt || new Date().toISOString(),
    chatter_id: null,
  }, { onConflict: "of_message_id", ignoreDuplicates: true });

  return ok();
});
