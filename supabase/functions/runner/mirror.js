// Виконання угод серверного бота на демо-біржі (Bybit Demo / Binance Testnet).
// Чиста логіка без мережі й бази: біржа, збереження стану, журнал і сповіщення передаються ззовні
// (тестується в Node: tests/mirror.test.mjs).
//
// Bybit Demo («рідний» режим): після входу на біржі одразу стоять лімітні ордери докупівлі (DCA),
// а TP і SL — на самій позиції. Біржа виконує їх миттєво, не чекаючи закриття свічки; сервер щоразу
// звіряє TP/SL з фактичною середньою ціною (після докупівлі вони перевиставляються).
// Binance Testnet: угоди дублюються ринковими ордерами з сервера (TP/SL — за закриттям свічки).
//
// Захист від повторних ордерів: кожен ордер має незмінний ідентифікатор (orderLinkId / newClientOrderId),
// перед відправкою перевіряється, чи такий ордер уже є; дії спершу зберігаються в стані бота
// (з перевіркою, що інший запуск не змінив його), і лише потім ідуть на біржу.
import { lv, rnd } from "./engine.js";
import { eventText } from "./core.js";
import { floorStep } from "./sign.js";

export const MAX_TRIES = 5;
const hex = (id) => String(id).replace(/-/g, "").slice(0, 12);
/* ідентифікатор ордера: незмінний для тієї самої події бота, ≤36 символів, лише [A-Za-z0-9-] */
export const linkBase = (botId, t) => `ox${hex(botId)}-${Math.floor(t / 1000).toString(36)}-`;
export const linkId = (botId, t, kind) => linkBase(botId, t) + kind;

/* події рушія → дії на біржі */
export function actionsFor(events, botId, native) {
  const out = [];
  for (const ev of events) {
    if (ev.kind === "open") out.push({ id: linkId(botId, ev.t, "o"), kind: "open", t: ev.t, notional: ev.notional, tries: 0 });
    else if (ev.kind === "dca") { if (!native) out.push({ id: linkId(botId, ev.t, "a" + ev.n), kind: "dca", t: ev.t, notional: ev.notional, tries: 0 }); }
    else out.push({ id: linkId(botId, ev.t, "c"), kind: "close", t: ev.t, tries: 0 });
  }
  return out;
}

/* ціни й кількості докупівель від фактичної ціни входу — той самий розрахунок, що й у рушії (lv) */
export function ladder(g, px, F) {
  const R = lv(g, px, F ? { tick: F.tick, step: F.step, minQty: F.minQty, minN: F.minN } : null);
  return R.L.slice(1).map((x, i) => ({ k: i + 1, price: x.p, qty: F && F.step ? floorStep(x.s / x.p, F.step) : x.s / x.p })).filter((x) => x.qty > 0);
}

/* TP і SL від середньої ціни позиції; округлення до кроку ціни в гірший бік, як у рушії.
   З трейлінгом або частковою фіксацією TP веде сервер (на біржі лише SL). */
export function protect(g, avg, F) {
  const d = g.d, tk = F && F.tick;
  const tp = g.trail || g.s1 > 0 || !(g.tp > 0) ? 0 : rnd(avg * (1 + d * g.tp), tk, d > 0 ? "ceil" : "floor");
  const sl = g.sl > 0 ? rnd(avg * (1 - d * g.sl), tk, d > 0 ? "floor" : "ceil") : 0;
  return { tp, sl };
}
const lev = (g) => Math.min(20, Math.max(1, Math.round(g.lev || 1)));
const near = (a, b, tick) => Math.abs((+a || 0) - (+b || 0)) <= (tick || 0) / 2 + 1e-12;

/* ордер з ідентифікатором: якщо такий уже є на біржі — повторно не надсилається */
async function once(ex, symbol, id, place) {
  const had = await ex.byLink(symbol, id).catch(() => null);
  if (had) return { ...had, existed: true };
  try { return await place(); }
  catch (e) { const o = await ex.byLink(symbol, id).catch(() => null); if (o) return { ...o, existed: true }; throw e; }
}
async function marketNotional(ex, symbol, side, notional, id) {
  const F = await ex.filt(symbol);
  if (!F) throw new Error("пари немає на демо-біржі");
  const px = await ex.mark(symbol), qty = floorStep(notional / px, F.step);
  if (!(qty > 0) || qty < F.minQty || qty * px < F.minN) throw new Error(`ордер замалий: мінімум ${Math.max(F.minN, F.minQty * px).toFixed(2)} USDT`);
  const o = await ex.market(symbol, side, qty, false, id);
  return o.price > 0 ? o : { ...o, price: px, approx: true };
}

/* одна дія на біржі; повертає текст для журналу */
export async function execute(ex, a, { g, symbol, native, botId }) {
  const side = g.d > 0 ? "BUY" : "SELL", name = native ? "Bybit Demo" : "Binance Testnet";
  if (a.kind === "open") {
    let o = await ex.byLink(symbol, a.id).catch(() => null);
    if (!o) {
      if ((await ex.positions(symbol))[0]) return `${name}: на біржі вже є позиція ${symbol} — вхід не дубльовано`;
      await ex.leverage(symbol, lev(g));
      o = await once(ex, symbol, a.id, () => marketNotional(ex, symbol, side, a.notional, a.id));
    }
    let msg = `${name}: вхід ${o.qty} за ${o.approx ? "≈" : ""}${o.price}`;
    if (!native) return msg;
    const F = await ex.filt(symbol), p = (await ex.positions(symbol))[0];
    if (!p) return msg + " (позиції вже немає)";
    const base = a.id.slice(0, -1);
    let n = 0;
    for (const r of ladder(g, p.entry, F)) {
      try { await once(ex, symbol, base + "d" + r.k, () => ex.limit(symbol, side, r.qty, r.price, base + "d" + r.k)); n++; }
      catch (e) { msg += ` · докупівля ${r.k}: ${e.message}`; }
    }
    const pr = protect(g, p.entry, F);
    await ex.tradingStop(symbol, pr);
    return msg + ` · на біржі: ${n} лімітн. докупівель${pr.tp ? `, TP ${pr.tp}` : ""}${pr.sl ? `, SL ${pr.sl}` : ""}`;
  }
  if (a.kind === "dca") {
    const o = await once(ex, symbol, a.id, () => marketNotional(ex, symbol, side, a.notional, a.id));
    return `${name}: докупівля ${o.qty} за ${o.approx ? "≈" : ""}${o.price}`;
  }
  // close
  if (native) await ex.cancelAll(symbol);
  const done = await ex.byLink(symbol, a.id).catch(() => null);
  if (done) return `${name}: позицію закрито за ${done.price}`;
  const p = (await ex.positions(symbol))[0];
  if (!p) return `${name}: позиції вже немає${native ? " (закрито біржею за TP/SL)" : ""}`;
  const o = await once(ex, symbol, a.id, () => ex.market(symbol, p.amt > 0 ? "SELL" : "BUY", Math.abs(p.amt), true, a.id));
  return `${name}: позицію закрито за ${o.price}`;
}

/* щоразу (рідний режим): TP/SL відповідають фактичній середній ціні; без позиції — знімаються залишки ордерів бота */
export async function sync(ex, { g, symbol, botId }) {
  const p = (await ex.positions(symbol))[0];
  if (p) {
    const F = await ex.filt(symbol), want = protect(g, p.entry, F);
    if (near(p.tp, want.tp, F && F.tick) && near(p.sl, want.sl, F && F.tick)) return null;
    await ex.tradingStop(symbol, want);
    return `Bybit Demo: TP/SL оновлено від середньої ${p.entry}${want.tp ? ` · TP ${want.tp}` : ""}${want.sl ? ` · SL ${want.sl}` : ""}`;
  }
  const mine = (await ex.openOrders(symbol)).filter((o) => String(o.link || "").startsWith("ox" + hex(botId)));
  if (!mine.length) return null;
  await ex.cancelAll(symbol);
  return `Bybit Demo: позиції немає (закрито біржею за TP/SL) — знято ${mine.length} ордер(ів) бота`;
}

/**
 * Обробка бота після прогону рушія.
 * deps: save(state) → true, якщо стан збережено й ніхто інший його не змінив; log(level, text, data); notify(text);
 *       ex — адаптер біржі або null (немає ключів); mirror — чи дублювати угоди; native — рідний режим Bybit.
 */
export async function handleBot({ bot, g, r, symbol, mirror, native, ex, save, log, notify }) {
  const pend = [...(Array.isArray(bot.state?.pend) ? bot.state.pend : []), ...(mirror ? actionsFor(r.events, bot.id, native) : [])];
  const st = { ...r.state, pend };
  if (!(await save(st))) { await log("warn", "Стан не збережено (паралельний запуск або помилка бази) — біржу не чіпаю, повторю наступного разу"); return { saved: false }; }
  for (const ev of r.events) {
    const text = eventText(ev, g);
    await log(ev.kind === "liq" || ev.kind === "sl" ? "warn" : "info", text, ev);
    await notify(text);
  }
  if (!mirror) return { saved: true };
  if (!ex) {
    if (pend.length) await log("error", "Ключі біржі не підключено — угоди не продубльовано");
    if (pend.length) await save({ ...st, pend: [] });
    return { saved: true };
  }
  const left = [];
  let stop = false, changed = false;
  for (const a of pend) {
    if (stop) { left.push(a); continue; }
    try { await log("info", await execute(ex, a, { g, symbol, native, botId: bot.id })); changed = true; }
    catch (e) {
      const b = { ...a, tries: (a.tries || 0) + 1 };
      changed = true;
      if (b.tries >= MAX_TRIES) { const m = `Біржа: дію «${a.kind}» знято після ${MAX_TRIES} спроб — ${e.message}`; await log("error", m); await notify(`Orbix (сервер): ${g.pair} — ${m}`); }
      else { await log("error", `Біржа: ${e.message} (спроба ${b.tries} з ${MAX_TRIES}, повторю)`); left.push(b); stop = true; }
    }
  }
  if (native && !left.length) {
    try { const m = await sync(ex, { g, symbol, botId: bot.id }); if (m) { await log("info", m); if (m.includes("закрито біржею")) await notify(`Orbix (сервер): ${g.pair} — ${m}`); } }
    catch (e) { await log("error", `Біржа (звірка TP/SL): ${e.message}`); }
  }
  if (changed) await save({ ...st, pend: left });
  return { saved: true, left: left.length };
}
