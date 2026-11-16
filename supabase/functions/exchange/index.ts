// Orbix: торгівля на ДЕМО/ТЕСТНЕТІ біржі від імені користувача.
//   exchange = "bybit"   → Bybit Demo Trading (віртуальні кошти, реальні ринкові ціни): https://api-demo.bybit.com
//   exchange = "binance" → Binance Futures Testnet: https://testnet.binancefuture.com
// Ключі API зберігаються в Supabase Vault і не потрапляють у браузер.
// Адреси бірж зашиті (exchanges.ts): ця функція фізично не може надіслати ордер на реальний рахунок.
// POST /functions/v1/exchange { exchange, action: "check" | "balance" | "positions" | "order" | "close", ... }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { binance, bybit, closePosition, ExErr, marketNotional, SYM } from "./exchanges.ts";

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
    const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: u, error: ue } = await asUser.auth.getUser();
    if (ue || !u?.user) return json({ error: "unauthorized" }, 401);
    const { data: mfa, error: me } = await asUser.rpc("mfa_ok_now");
    if (me) return json({ error: me.message }, 500);
    if (!mfa) return json({ error: "mfa required" }, 403);

    const body = await req.json().catch(() => ({}));
    const exName = body?.exchange === "bybit" ? "bybit" : "binance";
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("ex_secret_for", { p_uid: u.user.id, p_exchange: exName });
    if (error) return json({ error: error.message }, 500);
    const k = Array.isArray(data) ? data[0] : data;
    if (!k?.api_key || !k?.api_secret) return json({ error: "keys not configured" }, 404);
    const ex = exName === "bybit" ? bybit(k.api_key, k.api_secret) : binance(k.api_key, k.api_secret);
    const setStatus = (status: string, canTrade = false) =>
      admin.from("exchange_connections").update({ status, can_trade: canTrade, last_checked_at: new Date().toISOString() }).eq("id", k.conn_id);

    const action = String(body?.action || "");
    try {
      if (action === "check" || action === "balance") {
        const a = await ex.check();
        await setStatus("active", a.canTrade);
        return json({ ok: true, ...a });
      }
      if (action === "positions") return json({ ok: true, positions: await ex.positions() });
      const symbol = String(body?.symbol || "");
      if (!SYM.test(symbol)) return json({ error: "invalid symbol" }, 400);
      if (action === "order") {
        const side = body?.side === "SELL" ? "SELL" : body?.side === "BUY" ? "BUY" : "";
        const notional = +body?.notional;
        if (!side || !(notional > 0 && notional <= 100000)) return json({ error: "invalid order" }, 400);
        const lev = Math.round(+body?.leverage || 0);
        if (lev && (lev < 1 || lev > 20)) return json({ error: "leverage 1..20" }, 400);
        return json({ ok: true, order: await marketNotional(ex, symbol, side, notional, lev) });
      }
      if (action === "close") {
        const o = await closePosition(ex, symbol);
        return json(o ? { ok: true, closed: true, order: o } : { ok: true, closed: false });
      }
      return json({ error: "unknown action" }, 400);
    } catch (e) {
      const err = e as ExErr;
      if (ex.invalid(err.code ?? null)) await setStatus("invalid");
      else if (ex.noPerm(err.code ?? null)) await setStatus("active", false);
      return json({ error: err.message, code: err.code ?? null }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
