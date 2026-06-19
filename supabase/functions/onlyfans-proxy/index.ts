// supabase/functions/onlyfans-proxy/index.ts
// Allowlisted passthrough to OnlyFansAPI. Holds ONLYFANS_API_KEY server-side.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const OF_BASE = "https://app.onlyfansapi.com/api";
const OF_KEY = Deno.env.get("ONLYFANS_API_KEY")!;
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!OF_KEY) return json({ error: "proxy misconfigured: ONLYFANS_API_KEY unset" }, 500);

  const token = req.headers.get("x-ssai-token") || "";
  if (!token.startsWith("ssai_")) return json({ error: "missing/invalid proxy token" }, 401);

  let payload: any;
  try { payload = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const { op, account_id, chat_id, message } = payload || {};

  if (!["list_chats", "list_messages", "send"].includes(op)) return json({ error: "op not allowed" }, 400);
  if (!account_id || typeof account_id !== "string") return json({ error: "account_id required" }, 400);

  // Account must be one SSAI knows about (mapped to a creator).
  const { data: model } = await sb.from("aich_models")
    .select("name").eq("of_account_id", account_id).maybeSingle();
  if (!model) return json({ error: "unknown account_id" }, 403);

  // v1 text-only backstop.
  if (op === "send" && message && Number(message.price) > 0) {
    return json({ error: "PPV/paid send is disabled in v1 (text only)" }, 400);
  }

  let url: string, method = "GET", fwdBody: string | undefined;
  if (op === "list_chats") {
    url = `${OF_BASE}/${account_id}/chats`;
  } else if (op === "list_messages") {
    if (!chat_id) return json({ error: "chat_id required" }, 400);
    url = `${OF_BASE}/${account_id}/chats/${chat_id}/messages`;
  } else { // send
    if (!chat_id) return json({ error: "chat_id required" }, 400);
    if (!message || typeof message.text !== "string" || !message.text.trim()) {
      return json({ error: "non-empty text required" }, 400);
    }
    if (Number(message.price) > 0) return json({ error: "PPV/paid send is disabled in v1 (text only)" }, 400);
    url = `${OF_BASE}/${account_id}/chats/${chat_id}/messages`;
    method = "POST";
    fwdBody = JSON.stringify({ text: message.text });
  }

  const ofRes = await fetch(url, {
    method,
    headers: { "Authorization": `Bearer ${OF_KEY}`, "Content-Type": "application/json" },
    body: fwdBody,
  });
  const data = await ofRes.json().catch(() => ({}));
  return json(data, ofRes.ok ? 200 : ofRes.status);
});
