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

// HMAC-SHA256(body, secret) as lowercase hex — matches OnlyFansAPI's documented
// signing scheme (the JSON body is the message, the signing secret is the key).
async function hmacHex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Constant-time compare for equal-length hex signatures.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function stripToText(html: string): string {
  if (!html) return "";
  return String(html).replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, " ").trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("POST only", { status: 405 });

  // Read the raw body FIRST — the HMAC must be computed over the exact bytes
  // OnlyFansAPI signed (re-serializing parsed JSON would change the bytes).
  const raw = await req.text();

  // Verify HMAC-SHA256(rawBody, ONLYFANS_WEBHOOK_SECRET). OnlyFansAPI sends the
  // signature as a hex digest in a header; the exact header name is not documented,
  // so we accept a match on any likely candidate. The HMAC must still match, so this
  // tolerates header-name uncertainty WITHOUT weakening security.
  if (!SECRET) return new Response("unauthorized", { status: 401 });
  const computed = await hmacHex(SECRET, raw);
  const sigHeaders = ["x-webhook-signature", "x-ofapi-signature", "x-signature", "ofapi-signature", "x-hub-signature-256"];
  let verified = false;
  for (const h of sigHeaders) {
    const v = (req.headers.get(h) || "").replace(/^sha256=/i, "").trim().toLowerCase();
    if (v && timingSafeEqual(v, computed)) { verified = true; break; }
  }
  if (!verified) {
    // Log header NAMES (not values) so the real signature header can be identified
    // from the Supabase function logs on the first delivery, then pinned here.
    console.log("webhook signature verify failed; headers present:", [...req.headers.keys()].join(", "));
    return new Response("unauthorized", { status: 401 });
  }

  let evt: any;
  try { evt = JSON.parse(raw); } catch { return new Response("bad json", { status: 400 }); }
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
