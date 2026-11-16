// Orbix runner: боти на сервері 24/7. Викликається розкладом бази (pg_cron) кожні 5 хвилин.
// Для кожного бота з позначкою «Сервер 24/7» бере свіжі закриті свічки з біржі, проганяє той самий
// торговий рушій, що й у браузері (engine.js, згенерований з src/js), зберігає стан, пише події,
// за потреби дублює угоди на Bybit Demo / Binance Testnet і надсилає сповіщення в Telegram.
// Доступ лише з секретом розкладу (x-runner-secret), перевірка — RPC runner_check.
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { botConfig, eventText, INTERVAL, processBot } from "./core.js";
import { binance, bybit, closePosition, marketNotional } from "./exchanges.ts";

const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const BYIV: Record<string, string> = { "1h": "60", "4h": "240", "12h": "720", "1d": "D", "1w": "W" };
type C = { t: number; o: number; h: number; l: number; c: number; v: number; ml?: number; mh?: number };

async function getJson(u: string) { const r = await fetch(u); if (!r.ok) throw new Error(`HTTP ${r.status} ${u.split("?")[0]}`); return r.json(); }
/* ринкові дані: Binance (ф'ючерси з mark price і funding або спот), резерв — Bybit */
async function market(symbol: string, iv: string, fut: boolean) {
  try {
    const base = fut ? "https://fapi.binance.com/fapi/v1" : "https://api.binance.com/api/v3";
    const k = await getJson(`${base}/klines?symbol=${symbol}&interval=${iv}&limit=400`);
    const candles: C[] = k.map((r: any[]) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }));
    let funding: { t: number; r: number }[] | null = null;
    if (fut) {
      const m = await getJson(`${base}/markPriceKlines?symbol=${symbol}&interval=${iv}&limit=400`).catch(() => []);
      const mm = new Map(m.map((r: any[]) => [+r[0], r]));
      for (const c of candles) { const x: any = mm.get(c.t); if (x) { c.ml = +x[3]; c.mh = +x[2]; } }
      const f = await getJson(`${base}/fundingRate?symbol=${symbol}&startTime=${Date.now() - 45 * 864e5}&limit=1000`).catch(() => []);
      funding = f.map((x: any) => ({ t: +x.fundingTime, r: +x.fundingRate }));
    }
    return { candles, funding, src: "binance" };
  } catch (_e) {
    const cat = fut ? "linear" : "spot";
    const j = await getJson(`https://api.bybit.com/v5/market/kline?category=${cat}&symbol=${symbol}&interval=${BYIV[iv]}&limit=400`);
    const candles: C[] = (j.result?.list ?? []).map((r: any[]) => ({ t: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] })).reverse();
    let funding: { t: number; r: number }[] | null = null;
    if (fut) {
      const m = await getJson(`https://api.bybit.com/v5/market/mark-price-kline?category=linear&symbol=${symbol}&interval=${BYIV[iv]}&limit=400`).catch(() => ({}));
      const mm = new Map((m.result?.list ?? []).map((r: any[]) => [+r[0], r]));
      for (const c of candles) { const x: any = mm.get(c.t); if (x) { c.ml = +x[3]; c.mh = +x[2]; } }
      const f = await getJson(`https://api.bybit.com/v5/market/funding/history?category=linear&symbol=${symbol}&limit=200`).catch(() => ({}));
      funding = (f.result?.list ?? []).map((x: any) => ({ t: +x.fundingRateTimestamp, r: +x.fundingRate })).reverse();
    }
    return { candles, funding, src: "bybit" };
  }
}

Deno.serve(async (req) => {
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: ok } = await admin.rpc("runner_check", { p_token: req.headers.get("x-runner-secret") ?? "" });
  if (ok !== true) return json({ error: "forbidden" }, 403);
  const started = Date.now();
  const { data: rows, error } = await admin.rpc("runner_bots");
  if (error) return json({ error: error.message }, 500);

  const mcache = new Map<string, Promise<any>>(), keys = new Map<string, Promise<any>>(), tgs = new Map<string, Promise<any>>();
  const log = (bot: any, level: string, message: string, data: unknown = null) =>
    admin.from("bot_events").insert({ bot_id: bot.id, user_id: bot.user_id, level, message: message.slice(0, 500), data });
  const exFor = (uid: string, exName: string) => {
    const k = `${uid}|${exName}`;
    if (!keys.has(k)) keys.set(k, admin.rpc("ex_secret_for", { p_uid: uid, p_exchange: exName }).then(({ data }) => {
      const s = Array.isArray(data) ? data[0] : data;
      return s?.api_key ? (exName === "bybit" ? bybit(s.api_key, s.api_secret) : binance(s.api_key, s.api_secret)) : null;
    }));
    return keys.get(k)!;
  };
  const tgFor = (uid: string) => {
    if (!tgs.has(uid)) tgs.set(uid, admin.rpc("tg_secret_for", { p_uid: uid }).then(({ data }) => (Array.isArray(data) ? data[0] : data) ?? null));
    return tgs.get(uid)!;
  };

  let done = 0, evCount = 0;
  for (const bot of rows ?? []) {
    if (Date.now() - started > 100e3) break; // запас до ліміту часу функції
    try {
      const g: any = botConfig(bot.config), cfg = bot.config || {};
      if (!/^[A-Z0-9]{2,20}\/USDT$/.test(g.pair || "")) continue;
      const iv = (INTERVAL as Record<number, string>)[g.tf || 1];
      if (!iv) continue;
      const symbol = g.pair.replace("/", ""), mk = `${symbol}|${iv}|${g.fut ? 1 : 0}`;
      if (!mcache.has(mk)) mcache.set(mk, market(symbol, iv, !!g.fut));
      const m = await mcache.get(mk);
      const r = processBot({ g, state: bot.state, candles: m.candles, funding: m.funding, now: Date.now() });
      for (const ev of r.events) {
        evCount++;
        const text = eventText(ev, g);
        await log(bot, ev.kind === "liq" || ev.kind === "sl" ? "warn" : "info", text, { ...ev, src: m.src });
        // дублювання на демо-рахунку біржі
        if (cfg._tn && g.fut) {
          const exName = cfg._ex === "binance" ? "binance" : "bybit";
          try {
            const ex = await exFor(bot.user_id, exName);
            if (!ex) await log(bot, "error", "Ключі біржі не підключено — угоду не продубльовано");
            else if (ev.kind === "open" || ev.kind === "dca") {
              const o = await marketNotional(ex, symbol, g.d > 0 ? "BUY" : "SELL", ev.notional, ev.kind === "open" ? Math.min(20, Math.max(1, Math.round(g.lev || 1))) : 0);
              await log(bot, "info", `${exName === "bybit" ? "Bybit Demo" : "Binance Testnet"}: ${ev.kind === "open" ? "вхід" : "докупівля"} ${o.qty} за ${o.approx ? "≈" : ""}${o.price}`);
            } else {
              const o = await closePosition(ex, symbol);
              await log(bot, "info", `${exName === "bybit" ? "Bybit Demo" : "Binance Testnet"}: ${o ? `позицію закрито за ${o.price}` : "позиції не було"}`);
            }
          } catch (e) { await log(bot, "error", `Біржа: ${(e as Error).message}`); }
        }
        // Telegram
        try {
          const t = await tgFor(bot.user_id);
          if (t?.token && t?.chat_id) await fetch(`https://api.telegram.org/bot${t.token}/sendMessage`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chat_id: t.chat_id, text, disable_web_page_preview: true }) });
        } catch (_e) { /* сповіщення не критичні */ }
      }
      await admin.from("bot_state").upsert({ bot_id: bot.id, user_id: bot.user_id, state: r.state, updated_at: new Date().toISOString() });
      done++;
    } catch (e) {
      console.warn("runner bot failed", bot.id, (e as Error).message);
      await log(bot, "error", `Сервер: ${(e as Error).message}`);
    }
  }
  return json({ ok: true, bots: rows?.length ?? 0, processed: done, events: evCount, ms: Date.now() - started });
});
