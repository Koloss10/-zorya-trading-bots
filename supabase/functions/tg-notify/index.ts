// Orbix: надсилання сповіщення в Telegram від імені користувача.
// Токен бота зберігається у Supabase Vault і ніколи не повертається в браузер.
// Виклик: POST /functions/v1/tg-notify { "text": "..." } з JWT користувача.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const auth = req.headers.get("Authorization") ?? "";
    // клієнт від імені користувача: перевіряє JWT і 2FA (aal2) через RPC
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: auth } } });
    const { data: u, error: ue } = await asUser.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    const { data: can, error: ce } = await asUser.rpc("tg_can_send");
    if (ce) return json({ error: ce.message }, 500);
    if (!can) return json({ error: "telegram not configured or 2FA code required" }, 403);

    const body = await req.json().catch(() => ({}));
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 3500) return json({ error: "text must be 1..3500 characters" }, 400);

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("tg_secret_for", { p_uid: u.user.id });
    if (error) return json({ error: error.message }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token || !row?.chat_id) return json({ error: "telegram not configured" }, 404);

    const r = await fetch(`https://api.telegram.org/bot${row.token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: row.chat_id, text, disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => ({}));
    if (!j?.ok) return json({ error: j?.description || `Telegram HTTP ${r.status}` }, 502);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
