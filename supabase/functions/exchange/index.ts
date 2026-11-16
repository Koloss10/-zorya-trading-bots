// Orbix: торгівля на ДЕМО/ТЕСТНЕТІ біржі від імені користувача.
//   exchange = "bybit"   → Bybit Demo Trading (віртуальні кошти, реальні ринкові ціни): https://api-demo.bybit.com
//   exchange = "binance" → Binance Futures Testnet: https://testnet.binancefuture.com
// Ключі API зберігаються в Supabase Vault і не потрапляють у браузер.
// Адреси бірж зашиті: ця функція фізично не може надіслати ордер на реальний рахунок.
// POST /functions/v1/exchange { exchange, action: "check" | "balance" | "positions" | "order" | "close", ... }
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { bybitPayload, floorStep, sign } from "./sign.js";

const BINANCE = "https://testnet.binancefuture.com";
const BYBIT = "https://api-demo.bybit.com";
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });
const SYM = /^[A-Z0-9]{2,20}USDT$/;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
type Filt = { step: number; minQty: number; minN: number };
type Pos = { symbol: string; amt: number; entry: number; mark: number; pnl: number; lev: number; liq: number };
type Fill = { id: string | number; symbol: string; side: string; qty: number; price: number; status: string };
class ExErr extends Error { code: number | null; constructor(m: string, c: number | null = null) { super(m); this.code = c; } }

let bnInfo: { at: number; f: Record<string, Filt> } | null = null;

// ---------- Binance Futures Testnet ----------
function binance(key: string, secret: string) {
  const call = async (method: string, path: string, params: Record<string, string | number | boolean> = {}) => {
    const q = new URLSearchParams(Object.entries({ ...params, recvWindow: 5000, timestamp: Date.now() }).map(([a, b]) => [a, String(b)])).toString();
    const r = await fetch(`${BINANCE}${path}?${q}&signature=${await sign(q, secret)}`, { method, headers: { "X-MBX-APIKEY": key } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j && typeof j.code === "number" && j.code < 0)) {
      console.warn("binance testnet rejected", path, r.status, j?.code, j?.msg);
      throw new ExErr(j?.msg || `HTTP ${r.status}`, j?.code ?? null);
    }
    return j;
  };
  const filters = async () => {
    if (bnInfo && Date.now() - bnInfo.at < 3600e3) return bnInfo.f;
    const j = await fetch(`${BINANCE}/fapi/v1/exchangeInfo`).then((r) => r.json());
    const f: Record<string, Filt> = {};
    for (const s of j.symbols ?? []) {
      const F: Record<string, any> = {};
      for (const x of s.filters ?? []) F[x.filterType] = x;
      f[s.symbol] = { step: +(F.MARKET_LOT_SIZE?.stepSize || F.LOT_SIZE?.stepSize || 0), minQty: +(F.MARKET_LOT_SIZE?.minQty || F.LOT_SIZE?.minQty || 0), minN: +(F.MIN_NOTIONAL?.notional || 0) };
    }
    bnInfo = { at: Date.now(), f };
    return f;
  };
  return {
    invalid: (c: number | null) => c === -2014 || c === -2015 || c === -1022,
    async check() {
      const a = await call("GET", "/fapi/v2/account");
      return { canTrade: !!a.canTrade, withdraw: false, wallet: +a.totalWalletBalance, available: +a.availableBalance, unrealized: +a.totalUnrealizedProfit };
    },
    async positions(symbol?: string): Promise<Pos[]> {
      const p = await call("GET", "/fapi/v2/positionRisk", symbol ? { symbol } : {});
      return p.filter((x: any) => +x.positionAmt !== 0).map((x: any) => ({ symbol: x.symbol, amt: +x.positionAmt, entry: +x.entryPrice, mark: +x.markPrice, pnl: +x.unRealizedProfit, lev: +x.leverage, liq: +x.liquidationPrice }));
    },
    async filt(symbol: string) { return (await filters())[symbol]; },
    async mark(symbol: string) { return +(await fetch(`${BINANCE}/fapi/v1/premiumIndex?symbol=${symbol}`).then((r) => r.json())).markPrice; },
    async leverage(symbol: string, lev: number) { await call("POST", "/fapi/v1/leverage", { symbol, leverage: lev }); },
    async market(symbol: string, side: "BUY" | "SELL", qty: number, reduceOnly = false): Promise<Fill> {
      const o = await call("POST", "/fapi/v1/order", { symbol, side, type: "MARKET", quantity: qty, ...(reduceOnly ? { reduceOnly: true } : {}), newOrderRespType: "RESULT" });
      return { id: o.orderId, symbol, side, qty: +o.executedQty, price: +o.avgPrice, status: o.status };
    },
  };
}

// ---------- Bybit Demo Trading (v5, USDT perpetual) ----------
function bybit(key: string, secret: string) {
  const recv = 5000;
  const call = async (method: "GET" | "POST", path: string, params: Record<string, unknown> = {}) => {
    const ts = Date.now();
    let url = `${BYBIT}${path}`, payload = "", body: string | undefined;
    if (method === "GET") { payload = new URLSearchParams(Object.entries(params).map(([a, b]) => [a, String(b)])).toString(); if (payload) url += `?${payload}`; }
    else { body = payload = JSON.stringify(params); }
    const headers: Record<string, string> = { "X-BAPI-API-KEY": key, "X-BAPI-TIMESTAMP": String(ts), "X-BAPI-RECV-WINDOW": String(recv), "X-BAPI-SIGN": await sign(bybitPayload(ts, key, recv, payload), secret) };
    if (body) headers["content-type"] = "application/json";
    const r = await fetch(url, { method, headers, body });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j?.retCode !== 0) {
      console.warn("bybit demo rejected", path, r.status, j?.retCode, j?.retMsg);
      throw new ExErr(j?.retMsg || `HTTP ${r.status}`, typeof j?.retCode === "number" ? j.retCode : null);
    }
    return j.result;
  };
  const pub = async (path: string) => { const j = await fetch(`${BYBIT}${path}`).then((r) => r.json()); if (j?.retCode !== 0) throw new ExErr(j?.retMsg || "market data error"); return j.result; };
  return {
    invalid: (c: number | null) => c === 10003 || c === 10004 || c === 10005 || c === 33004,
    async check() {
      const w = (await call("GET", "/v5/account/wallet-balance", { accountType: "UNIFIED" })).list?.[0] ?? {};
      const k = await call("GET", "/v5/user/query-api");
      const perms = JSON.stringify(k?.permissions ?? {});
      return { canTrade: k?.readOnly === 0, withdraw: /Withdraw/i.test(perms), wallet: +(w.totalWalletBalance || 0), available: +(w.totalAvailableBalance || 0), unrealized: +(w.totalPerpUPL || 0) };
    },
    async positions(symbol?: string): Promise<Pos[]> {
      const l = (await call("GET", "/v5/position/list", { category: "linear", ...(symbol ? { symbol } : { settleCoin: "USDT" }) })).list ?? [];
      return l.filter((x: any) => +x.size > 0).map((x: any) => ({ symbol: x.symbol, amt: x.side === "Sell" ? -x.size : +x.size, entry: +x.avgPrice, mark: +x.markPrice, pnl: +x.unrealisedPnl, lev: +x.leverage, liq: +(x.liqPrice || 0) }));
    },
    async filt(symbol: string): Promise<Filt | undefined> {
      const s = (await pub(`/v5/market/instruments-info?category=linear&symbol=${symbol}`)).list?.[0];
      return s ? { step: +s.lotSizeFilter.qtyStep, minQty: +s.lotSizeFilter.minOrderQty, minN: +(s.lotSizeFilter.minNotionalValue || 0) } : undefined;
    },
    async mark(symbol: string) { return +(await pub(`/v5/market/tickers?category=linear&symbol=${symbol}`)).list?.[0]?.markPrice; },
    async leverage(symbol: string, lev: number) {
      try { await call("POST", "/v5/position/set-leverage", { category: "linear", symbol, buyLeverage: String(lev), sellLeverage: String(lev) }); }
      catch (e) { if ((e as ExErr).code !== 110043) throw e; } // 110043: плече вже таке
    },
    async market(symbol: string, side: "BUY" | "SELL", qty: number, reduceOnly = false): Promise<Fill> {
      const o = await call("POST", "/v5/order/create", { category: "linear", symbol, side: side === "BUY" ? "Buy" : "Sell", orderType: "Market", qty: String(qty), ...(reduceOnly ? { reduceOnly: true } : {}) });
      let h: any = null;
      for (let i = 0; i < 3 && !(+h?.avgPrice > 0); i++) { await sleep(300); h = (await call("GET", "/v5/order/history", { category: "linear", orderId: o.orderId })).list?.[0]; }
      return { id: o.orderId, symbol, side, qty: +(h?.cumExecQty || qty), price: +(h?.avgPrice || 0), status: h?.orderStatus || "Submitted" };
    },
  };
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
        if (lev) {
          if (lev < 1 || lev > 20) return json({ error: "leverage 1..20" }, 400);
          await ex.leverage(symbol, lev);
        }
        const F = await ex.filt(symbol);
        if (!F) return json({ error: "symbol not on testnet" }, 400);
        const px = await ex.mark(symbol), qty = floorStep(notional / px, F.step);
        if (!(qty > 0) || qty < F.minQty || qty * px < F.minN) return json({ error: `order too small: min ${Math.max(F.minN, F.minQty * px).toFixed(2)} USDT` }, 400);
        return json({ ok: true, order: await ex.market(symbol, side, qty) });
      }
      if (action === "close") {
        const p = (await ex.positions(symbol))[0];
        if (!p) return json({ ok: true, closed: false });
        return json({ ok: true, closed: true, order: await ex.market(symbol, p.amt > 0 ? "SELL" : "BUY", Math.abs(p.amt), true) });
      }
      return json({ error: "unknown action" }, 400);
    } catch (e) {
      const err = e as ExErr;
      if (ex.invalid(err.code ?? null)) await setStatus("invalid");
      return json({ error: err.message, code: err.code ?? null }, 502);
    }
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 500);
  }
});
