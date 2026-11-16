// Orbix: торгівля на ТЕСТНЕТІ Binance Futures від імені користувача.
// Ключі API зберігаються в Supabase Vault і не потрапляють у браузер.
// Адреса біржі зашита: ця функція фізично не може надіслати ордер на реальний рахунок.
// POST /functions/v1/exchange { action: "check" | "balance" | "positions" | "order" | "close" }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { floorStep, sign } from "./sign.js";

const BASE = "https://testnet.binancefuture.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const SYM = /^[A-Z0-9]{2,20}USDT$/;

let info: { at: number; f: Record<string, { step: number; minQty: number; minN: number }> } | null = null;
async function filters() {
  if (info && Date.now() - info.at < 3600e3) return info.f;
  const j = await fetch(`${BASE}/fapi/v1/exchangeInfo`).then((r) => r.json());
  const f: Record<string, { step: number; minQty: number; minN: number }> = {};
  for (const s of j.symbols ?? []) {
    const F: Record<string, any> = {};
    for (const x of s.filters ?? []) F[x.filterType] = x;
    f[s.symbol] = { step: +(F.MARKET_LOT_SIZE?.stepSize || F.LOT_SIZE?.stepSize || 0), minQty: +(F.MARKET_LOT_SIZE?.minQty || F.LOT_SIZE?.minQty || 0), minN: +(F.MIN_NOTIONAL?.notional || 0) };
  }
  info = { at: Date.now(), f };
  return f;
}

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

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data, error } = await admin.rpc("ex_secret_for", { p_uid: u.user.id });
    if (error) return json({ error: error.message }, 500);
    const k = Array.isArray(data) ? data[0] : data;
    if (!k?.api_key || !k?.api_secret) return json({ error: "keys not configured" }, 404);

    const call = async (method: string, path: string, params: Record<string, string | number | boolean> = {}) => {
      const q = new URLSearchParams(Object.entries({ ...params, recvWindow: 5000, timestamp: Date.now() }).map(([a, b]) => [a, String(b)])).toString();
      const sig = await sign(q, k.api_secret);
      const r = await fetch(`${BASE}${path}?${q}&signature=${sig}`, { method, headers: { "X-MBX-APIKEY": k.api_key } });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || (j && typeof j.code === "number" && j.code < 0)) {
        console.warn("binance testnet rejected", path, r.status, j?.code, j?.msg);
        throw Object.assign(new Error(j?.msg || `HTTP ${r.status}`), { code: j?.code, status: r.status });
      }
      return j;
    };
    const mark = async (symbol: string) => +(await fetch(`${BASE}/fapi/v1/premiumIndex?symbol=${symbol}`).then((r) => r.json())).markPrice;
    const setStatus = (status: string, canTrade = false) =>
      admin.from("exchange_connections").update({ status, can_trade: canTrade, last_checked_at: new Date().toISOString() }).eq("id", k.conn_id);

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    try {
      if (action === "check" || action === "balance") {
        const a = await call("GET", "/fapi/v2/account");
        await setStatus("active", !!a.canTrade);
        return json({ ok: true, canTrade: !!a.canTrade, wallet: +a.totalWalletBalance, available: +a.availableBalance, unrealized: +a.totalUnrealizedProfit });
      }
      if (action === "positions") {
        const p = await call("GET", "/fapi/v2/positionRisk");
        return json({ ok: true, positions: p.filter((x: any) => +x.positionAmt !== 0).map((x: any) => ({ symbol: x.symbol, amt: +x.positionAmt, entry: +x.entryPrice, mark: +x.markPrice, pnl: +x.unRealizedProfit, lev: +x.leverage, liq: +x.liquidationPrice })) });
      }
      const symbol = String(body?.symbol || "");
      if (!SYM.test(symbol)) return json({ error: "invalid symbol" }, 400);
      if (action === "order") {
        const side = body?.side === "SELL" ? "SELL" : body?.side === "BUY" ? "BUY" : "";
        const notional = +body?.notional;
        if (!side || !(notional > 0 && notional <= 100000)) return json({ error: "invalid order" }, 400);
        const lev = Math.round(+body?.leverage || 0);
        if (lev) {
          if (lev < 1 || lev > 20) return json({ error: "leverage 1..20" }, 400);
          await call("POST", "/fapi/v1/leverage", { symbol, leverage: lev });
        }
        const F = (await filters())[symbol];
        if (!F) return json({ error: "symbol not on testnet" }, 400);
        const px = await mark(symbol), qty = floorStep(notional / px, F.step);
        if (!(qty > 0) || qty < F.minQty || qty * px < F.minN) return json({ error: `order too small: min ${F.minN} USDT` }, 400);
        const o = await call("POST", "/fapi/v1/order", { symbol, side, type: "MARKET", quantity: qty, newOrderRespType: "RESULT" });
        return json({ ok: true, order: { id: o.orderId, symbol, side, qty: +o.executedQty, price: +o.avgPrice, status: o.status } });
      }
      if (action === "close") {
        const p = (await call("GET", "/fapi/v2/positionRisk", { symbol })).find((x: any) => +x.positionAmt !== 0);
        if (!p) return json({ ok: true, closed: false });
        const amt = +p.positionAmt;
        const o = await call("POST", "/fapi/v1/order", { symbol, side: amt > 0 ? "SELL" : "BUY", type: "MARKET", quantity: Math.abs(amt), reduceOnly: true, newOrderRespType: "RESULT" });
        return json({ ok: true, closed: true, order: { id: o.orderId, symbol, qty: +o.executedQty, price: +o.avgPrice, status: o.status } });
      }
      return json({ error: "unknown action" }, 400);
    } catch (e) {
      const err = e as { message: string; code?: number };
      if (err.code === -2014 || err.code === -2015 || err.code === -1022) await setStatus("invalid");
      return json({ error: err.message, code: err.code ?? null }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
