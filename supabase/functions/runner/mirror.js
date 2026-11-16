// Виконання угод серверного бота на демо-біржі (Bybit Demo / Binance Testnet).
// Чиста логіка без мережі й бази: біржа, збереження стану, журнал і сповіщення передаються ззовні
// (тестується в Node: tests/mirror.test.mjs).
//
// Bybit Demo («рідний» режим): після входу на біржі одразу стоять лімітні ордери докупівлі (DCA),
// а TP і SL — на самій позиції; для ботів із трейлінгом замість TP ставиться трейлінг-стоп біржі
// з активацією на рівні TP. Біржа виконує їх миттєво, не чекаючи закриття свічки; сервер щоразу
// звіряє захист із фактичною середньою ціною (після докупівлі він перевиставляється), а якщо ціна
// вже пройшла TP або SL — закриває позицію ринком.
// Binance Testnet: угоди дублюються ринковими ордерами з сервера (TP/SL — за закриттям свічки).
//
// Захист від повторних ордерів: кожен ордер має незмінний ідентифікатор (orderLinkId / newClientOrderId),
// перед відправкою перевіряється, чи такий ордер уже є; дії спершу зберігаються в стані бота
// (з перевіркою, що інший запуск не змінив його), і лише потім ідуть на біржу.
import { lv, rnd } from "./engine.js";
import { eventText } from "./core.js";
import { floorStep } from "./sign.js";

export const MAX_TRIES = 5;
/* вхід або докупівля за сигналом, старшим за цей час, на біржу не надсилається (сервер простоював) */
export const STALE_MS = 30 * 60e3;
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

/* Захист позиції від середньої ціни; округлення до кроку ціни в гірший бік, як у рушії.
   tp — тейк-профіт; sl — стоп-лосс; з трейлінгом замість TP: ap — ціна активації (рівень TP),
   ts — відстань трейлінгу в ціні (частка g.trail від рівня активації).
   З частковою фіксацією TP веде сервер (на біржі лише SL). */
export function protect(g, avg, F) {
  const d = g.d, tk = F && F.tick, part = g.s1 > 0, has = g.tp > 0 && !part;
  const lvl = has ? rnd(avg * (1 + d * g.tp), tk, d > 0 ? "ceil" : "floor") : 0;
  const sl = g.sl > 0 ? rnd(avg * (1 - d * g.sl), tk, d > 0 ? "floor" : "ceil") : 0;
  if (has && g.trail > 0) return { tp: 0, sl, ap: lvl, ts: Math.max(rnd(lvl * g.trail, tk, "ceil"), tk || 0) };
  return { tp: lvl, sl, ap: 0, ts: 0 };
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

const protText = (w) => `${w.tp ? ` · TP ${w.tp}` : ""}${w.ts ? ` · трейлінг ${w.ts} від ${w.ap}` : ""}${w.sl ? ` · SL ${w.sl}` : ""}`;
/* Привести захист позиції на біржі до потрібного (рідний режим). Повертає текст для журналу або null, якщо змін немає.
   fl — прапорці бота, що зберігаються в стані (nots: біржа не прийняла трейлінг — лишаємо SL, TP веде сервер). */
export async function guard(ex, { g, symbol, fl = {} }, p, F) {
  const d = g.d, want = protect(g, p.entry, F), m = +p.mark || 0, lvl = want.tp || want.ap;
  const closeNow = async (why) => {
    await ex.cancelAll(symbol);
    const o = await ex.market(symbol, p.amt > 0 ? "SELL" : "BUY", Math.abs(p.amt), true);
    return `Bybit Demo: ціна вже пройшла ${why} — позицію закрито ринком${o.price > 0 ? ` за ${o.price}` : ""}`;
  };
  if (m > 0 && want.sl && (d > 0 ? m <= want.sl : m >= want.sl)) return { msg: await closeNow(`SL ${want.sl}`), closed: true };
  if (m > 0 && want.tp && (d > 0 ? m >= want.tp : m <= want.tp)) return { msg: await closeNow(`TP ${want.tp}`), closed: true };
  if (fl.nots) { want.ts = 0; want.ap = 0; }
  if (want.ts && m > 0 && (d > 0 ? m >= want.ap : m <= want.ap)) want.ap = 0; // рівень активації вже пройдено — трейлінг діє одразу
  const tk = F && F.tick;
  // трейлінг біржі вже активний і підтягнув стоп у зону прибутку — не чіпаємо, щоб не відкинути його назад
  if (want.ts && near(p.ts, want.ts, tk) && p.sl > 0 && (d > 0 ? p.sl > p.entry : p.sl < p.entry)) return null;
  if (near(p.tp, want.tp, tk) && near(p.sl, want.sl, tk) && near(p.ts, want.ts, tk)) return null;
  try { await ex.tradingStop(symbol, want); }
  catch (e) {
    if (!want.ts) throw e;
    await ex.tradingStop(symbol, { tp: 0, sl: want.sl, ts: 0, ap: 0 });
    fl.nots = 1;
    return { msg: `Bybit Demo: біржа не прийняла трейлінг (${e.message}) — на біржі лише SL ${want.sl}, TP веде сервер` };
  }
  return { msg: `Bybit Demo: захист від середньої ${p.entry}${protText(want)}` };
}

/* одна дія на біржі; повертає текст для журналу */
export async function execute(ex, a, { g, symbol, native, botId, fl = {} }) {
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
    delete fl.nots;
    const gd = await guard(ex, { g, symbol, fl }, p, F);
    return msg + ` · на біржі: ${n} лімітн. докупівель${gd ? " · " + gd.msg.replace("Bybit Demo: ", "") : ""}`;
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

/* щоразу (рідний режим): захист відповідає фактичній середній ціні; без позиції — знімаються залишки ордерів бота */
export async function sync(ex, { g, symbol, botId, fl = {}, out = {} }) {
  const p = (await ex.positions(symbol))[0];
  out.pos = p || null; out.seen = !!p; // що побачили на біржі — для звірки з моделлю (reconcile)
  if (p) { const r = await guard(ex, { g, symbol, fl }, p, await ex.filt(symbol)); if (r && r.closed) out.pos = null; return r ? r.msg : null; }
  const mine = (await ex.openOrders(symbol)).filter((o) => String(o.link || "").startsWith("ox" + hex(botId)));
  if (!mine.length) return null;
  await ex.cancelAll(symbol);
  return `Bybit Demo: позиції немає (закрито біржею за TP/SL) — знято ${mine.length} ордер(ів) бота`;
}

/* Звірка моделі бота з позицією на біржі. mp — позиція рушія ({q, …}) або null; xp — позиція біржі ({amt, …}) або null.
   Повертає null, якщо збігаються, або { k, t }: nopos — у моделі є, на біржі немає; orphan — на біржі є, у моделі немає;
   size — напрям інший або кількість відрізняється більш ніж на 25 %. */
export const MIS_TOL = 0.25;
export function reconcile(mp, xp, g, symbol = g.pair) {
  if (mp && !xp) return { k: "nopos", t: `модель бота веде позицію ${g.pair}, а на Bybit Demo її немає` };
  if (!mp && xp) return { k: "orphan", t: `на Bybit Demo відкрита позиція ${symbol} (${xp.amt}), а модель бота позиції не має` };
  if (!mp || !xp) return null;
  if (Math.sign(xp.amt) !== Math.sign(g.d)) return { k: "size", t: `напрям позиції на Bybit Demo (${xp.amt > 0 ? "Long" : "Short"}) не збігається з ботом` };
  const q = Math.abs(xp.amt), m = +mp.q || 0;
  if (m > 0 && Math.abs(q - m) / m > MIS_TOL) return { k: "size", t: `обсяг на Bybit Demo ${q}, у моделі бота ${+m.toPrecision(6)} (різниця ${Math.round(Math.abs(q - m) / m * 100)} %)` };
  return null;
}
/* реакція на звірку: розбіжність, що тримається 2 запуски поспіль, — один запис у журнал і одне сповіщення;
   позицію, яку закрила сама біржа (TP/SL/трейлінг), модель закриє після своєї свічки — це не тривога */
export const MIS_RUNS = 2;
export async function onReconcile({ fl, mp, out, g, symbol, log, notify, now = Date.now() }) {
  if (out.seen) fl.had = 1;
  let d = reconcile(mp, out.pos, g, symbol);
  if (d && d.k === "nopos" && (fl.had || fl.xc)) { fl.xc = 1; d = { k: "xc", t: "позицію вже закрила біржа (TP/SL/трейлінг); модель бота закриє угоду після закриття свічки" }; }
  if (!mp) { delete fl.xc; if (!out.pos) delete fl.had; }
  const prev = fl.mis;
  if (!d) {
    if (prev && prev.n >= MIS_RUNS && prev.k !== "xc") await log("info", `Звірка з біржею: розбіжність усунено (${prev.t})`);
    delete fl.mis;
    return null;
  }
  const n = prev && prev.k === d.k ? prev.n + 1 : 1;
  fl.mis = { k: d.k, t: d.t, n, at: prev && prev.k === d.k ? prev.at : now };
  if (n === MIS_RUNS && d.k !== "xc") {
    const hint = d.k === "orphan" ? " Бот нею не керує: перевірте позицію в Bybit Demo і за потреби закрийте її там." : d.k === "nopos" ? " Нові ордери за цією угодою на біржу не надсилатимуться; бот продовжить після її закриття в моделі." : " Перевірте позицію в Bybit Demo.";
    const m = `Звірка з біржею: ${d.t}.${hint}`;
    await log("warn", m);
    await notify(`Orbix (сервер): ${g.pair} — ${m}`);
  }
  return fl.mis;
}

/* бот на паузі (рідний режим): зняти його лімітні докупівлі; позиція лишається на біржі зі своїм стопом */
export async function park(ex, { symbol, botId }) {
  const mine = (await ex.openOrders(symbol)).filter((o) => String(o.link || "").startsWith("ox" + hex(botId)));
  for (const o of mine) await ex.cancel(symbol, o.link);
  const p = (await ex.positions(symbol))[0];
  if (!mine.length && !p) return null;
  return `Bybit Demo: бот на паузі — знято ${mine.length} лімітн. докупівель` + (p ? `; позиція ${symbol} лишається на біржі${p.sl ? ` зі стопом ${p.sl}` : " БЕЗ стопу — перевірте її вручну"}` : "");
}

/**
 * Обробка бота після прогону рушія.
 * deps: save(state) → true, якщо стан збережено й ніхто інший його не змінив; log(level, text, data); notify(text);
 *       ex — адаптер біржі або null (немає ключів); mirror — чи дублювати угоди; native — рідний режим Bybit.
 */
export async function handleBot({ bot, g, r, symbol, mirror, native, ex, save, log, notify, now = Date.now() }) {
  const pend = [...(Array.isArray(bot.state?.pend) ? bot.state.pend : []), ...(mirror ? actionsFor(r.events, bot.id, native) : [])];
  const fl = { ...(bot.state?.fl || {}) }, fl0 = JSON.stringify(fl);
  delete fl.parked; // бот знову працює
  const st = { ...r.state, pend, fl };
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
    if (a.kind !== "close" && now - a.t > STALE_MS) { changed = true; await log("warn", `Біржа: сигнал застарів (${Math.round((now - a.t) / 60e3)} хв) — ${a.kind === "open" ? "вхід" : "докупівлю"} не надіслано`); continue; }
    try { await log("info", await execute(ex, a, { g, symbol, native, botId: bot.id, fl })); changed = true; }
    catch (e) {
      const b = { ...a, tries: (a.tries || 0) + 1 };
      changed = true;
      if (b.tries >= MAX_TRIES) { const m = `Біржа: дію «${a.kind}» знято після ${MAX_TRIES} спроб — ${e.message}`; await log("error", m); await notify(`Orbix (сервер): ${g.pair} — ${m}`); }
      else { await log("error", `Біржа: ${e.message} (спроба ${b.tries} з ${MAX_TRIES}, повторю)`); left.push(b); stop = true; }
    }
  }
  if (native && !left.length) {
    const out = {};
    try {
      const m = await sync(ex, { g, symbol, botId: bot.id, fl, out });
      if (m) { await log("info", m); if (/закрито (біржею|ринком)|не прийняла/.test(m)) await notify(`Orbix (сервер): ${g.pair} — ${m}`); }
      await onReconcile({ fl, mp: r.state?.b?.pos || null, out, g, symbol, log, notify, now });
    }
    catch (e) { await log("error", `Біржа (звірка захисту): ${e.message}`); }
  }
  if (changed || JSON.stringify(fl) !== fl0) await save({ ...st, pend: left, fl });
  return { saved: true, left: left.length };
}
