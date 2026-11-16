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
    const action = typeof body?.action === "string" ? body.action : "send";

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("tg_secret_for", { p_uid: u.user.id });
    if (error) return json({ error: error.message }, 500);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row?.token || !row?.chat_id) return json({ error: "telegram not configured" }, 404);
    const tg = (method: string, payload: unknown) =>
      fetch(`https://api.telegram.org/bot${row.token}/${method}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      }).then(async (r) => ({ status: r.status, j: await r.json().catch(() => ({})) }));

    // Пошук чатів, які писали боту: користувачу не треба вручну шукати Chat ID
    if (action === "detect") {
      const { status, j } = await tg("getUpdates", { limit: 100, timeout: 0 });
      if (!j?.ok) {
        console.warn("telegram getUpdates rejected", status, j?.error_code, j?.description);
        return json({ error: j?.description || `Telegram HTTP ${status}` }, 502);
      }
      const seen = new Map<string, { id: string; title: string; type: string; date: number }>();
      for (const up of j.result ?? []) {
        const m = up.message ?? up.edited_message ?? up.channel_post ?? up.my_chat_member;
        const c = m?.chat;
        if (!c?.id) continue;
        const title = c.type === "private"
          ? [c.first_name, c.last_name].filter(Boolean).join(" ") + (c.username ? ` (@${c.username})` : "")
          : (c.title ?? String(c.id));
        seen.set(String(c.id), { id: String(c.id), title, type: c.type, date: m.date ?? 0 });
      }
      const chats = [...seen.values()].sort((a, b) => (a.type === "private" ? 0 : 1) - (b.type === "private" ? 0 : 1) || b.date - a.date).slice(0, 5);
      return json({ ok: true, chats });
    }

    // Підключити знайдений чат: зберігаємо через RPC від імені користувача (з тим самим токеном)
    if (action === "use") {
      const chat = typeof body?.chat === "string" ? body.chat.trim() : "";
      if (!/^-?\d{3,20}$/.test(chat)) return json({ error: "invalid chat id" }, 400);
      const { error: se } = await asUser.rpc("tg_save", { p_token: row.token, p_chat: chat });
      if (se) return json({ error: se.message }, 400);
      const { j } = await tg("sendMessage", { chat_id: chat, text: "Orbix: чат підключено, сюди надходитимуть сповіщення про угоди." });
      return json({ ok: true, sent: !!j?.ok });
    }

    const text = typeof body?.text === "string" ? body.text.trim() : "";
    if (!text || text.length > 3500) return json({ error: "text must be 1..3500 characters" }, 400);
    const { status: rs, j } = await tg("sendMessage", { chat_id: row.chat_id, text, disable_web_page_preview: true });
    const r = { status: rs };
    if (!j?.ok) {
      // у журнал — лише причина відмови Telegram, без токена й тексту повідомлення
      console.warn("telegram rejected", r.status, j?.error_code, j?.description);
      return json({ error: j?.description || `Telegram HTTP ${r.status}` }, 502);
    }
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
