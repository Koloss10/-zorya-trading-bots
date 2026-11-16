// Виконання угод серверного бота на демо-біржі: ордери на біржі й захист від повторів (фейкова біржа).
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionsFor, execute, handleBot, ladder, linkId, protect, sync, MAX_TRIES } from '../supabase/functions/runner/mirror.js';
import { botConfig } from '../supabase/functions/runner/core.js';
import { Bot } from '../supabase/functions/runner/engine.js';

const BOT = '5dcac020-795d-450f-8a9e-fe9ca731dc22', T = Date.UTC(2026, 10, 16, 0);
const g = botConfig({ pair: 'TON/USDT', tf: 24, d: 1, fut: 1, lev: 3, orders: 4, base: 20, step: 0.02, smul: 1.2, mult: 1.5, tp: 0.012, sl: 0.08 });
const F = { step: 0.1, minQty: 0.1, minN: 5, tick: 0.0001 };

/* фейкова біржа Bybit: одна позиція на символ, ордери з унікальним orderLinkId */
function fakeEx({ px = 2.5, native = true } = {}) {
  const S = { px, pos: null, orders: [], calls: [], fills: [] };
  const fill = (side, qty, price) => {
    const sg = side === 'BUY' ? 1 : -1, p = S.pos;
    if (!p) { S.pos = { symbol: 'TONUSDT', amt: sg * qty, entry: price, tp: 0, sl: 0 }; return; }
    if (Math.sign(p.amt) === sg) { const q = Math.abs(p.amt) + qty; p.entry = (p.entry * Math.abs(p.amt) + price * qty) / q; p.amt = sg * q; }
    else { const q = Math.abs(p.amt) - qty; if (q <= 1e-12) S.pos = null; else p.amt = -sg * q; }
  };
  const ex = {
    native, S,
    async positions() { S.calls.push('positions'); return S.pos ? [{ ...S.pos }] : []; },
    async filt() { return F; },
    async mark() { return S.px; },
    async leverage(_s, l) { S.calls.push('leverage:' + l); },
    async market(symbol, side, qty, reduceOnly, link) {
      if (link && S.orders.some((o) => o.link === link)) { const e = new Error('OrderLinkedID is duplicate'); e.code = 110072; throw e; }
      S.calls.push('market:' + side); S.orders.push({ link, side, qty, price: S.px, status: 'Filled' }); fill(side, qty, S.px);
      return { id: S.orders.length, qty, price: S.px, link };
    },
    async limit(symbol, side, qty, price, link) {
      if (S.orders.some((o) => o.link === link)) { const e = new Error('dup'); e.code = 110072; throw e; }
      S.calls.push('limit'); S.orders.push({ link, side, qty, price, status: 'New' }); return { id: S.orders.length, qty, price, link };
    },
    async byLink(_s, link) { const o = S.orders.find((x) => x.link === link); return o ? { id: 1, qty: o.qty, price: o.price, status: o.status, link } : null; },
    async openOrders() { return S.orders.filter((o) => o.status === 'New').map((o) => ({ link: o.link, price: o.price, qty: o.qty })); },
    async cancelAll() { S.calls.push('cancelAll'); for (const o of S.orders) if (o.status === 'New') o.status = 'Cancelled'; },
    async tradingStop(_s, { tp, sl }) { S.calls.push('tradingStop'); if (S.pos) { S.pos.tp = tp; S.pos.sl = sl; } },
    /* ціна дійшла до лімітного ордера */
    hit(price) { S.px = price; for (const o of S.orders) if (o.status === 'New' && (o.side === 'BUY' ? price <= o.price : price >= o.price)) { o.status = 'Filled'; fill(o.side, o.qty, o.price); } },
  };
  return ex;
}
const ctx = { g, symbol: 'TONUSDT', native: true, botId: BOT };
const count = (ex, k) => ex.S.calls.filter((c) => c.startsWith(k)).length;

test('Ідентифікатор ордера незмінний для події і вкладається в 36 символів Bybit', () => {
  const a = linkId(BOT, T, 'd8'), b = linkId(BOT, T, 'd8');
  assert.equal(a, b); assert.ok(a.length <= 36); assert.match(a, /^[A-Za-z0-9-]+$/);
  assert.notEqual(linkId(BOT, T, 'o'), linkId(BOT, T + 864e5, 'o'));
});

test('Драбина докупівель на біржі збігається з цінами DCA, які бере рушій', () => {
  const L = ladder(g, 2.5, F);
  assert.equal(L.length, g.orders - 1);
  // рушій: вхід за 2.5, далі ціна падає — Bot.step виставляє докупівлі за тими самими цінами
  const b = new Bot(g, null, F), cs = [{ t: 0, o: 2.5, h: 2.5, l: 2.5, c: 2.5 }];
  b.step(0, cs[0], true);
  for (let i = 1; i <= 3; i++) { const lo = L[i - 1].price; b.step(i, { t: i, o: lo * 1.001, h: lo * 1.001, l: lo, c: lo * 1.0005 }, false); }
  const eng = b.pos.f.slice(1).map((x) => x.p);
  assert.deepEqual(eng, L.map((x) => x.price));
  for (const x of L) assert.ok(Math.abs(x.qty / F.step - Math.round(x.qty / F.step)) < 1e-9, 'кількість кратна кроку біржі');
});

test('TP/SL від середньої з округленням до кроку ціни; з трейлінгом TP веде сервер', () => {
  const p = protect(g, 2.4567, F);
  assert.equal(p.tp, 2.4862); assert.equal(p.sl, 2.2601);
  assert.equal(protect({ ...g, trail: 0.01 }, 2.4567, F).tp, 0);
  const s = protect({ ...g, d: -1 }, 2.4567, F); assert.ok(s.tp < 2.4567 && s.sl > 2.4567);
});

test('Вхід: ринковий ордер + лімітні докупівлі + TP/SL на позиції', async () => {
  const ex = fakeEx(), [a] = actionsFor([{ kind: 'open', notional: 60, t: T }], BOT, true);
  const msg = await execute(ex, a, ctx);
  assert.equal(count(ex, 'market'), 1); assert.equal(count(ex, 'limit'), 3); assert.equal(count(ex, 'tradingStop'), 1);
  assert.ok(ex.S.pos.tp > 2.5 && ex.S.pos.sl < 2.5); assert.match(msg, /3 лімітн/);
});

test('Повторний запуск з тією самою дією не створює жодного нового ордера', async () => {
  const ex = fakeEx(), [a] = actionsFor([{ kind: 'open', notional: 60, t: T }], BOT, true);
  await execute(ex, a, ctx); const n = ex.S.orders.length;
  await execute(ex, a, ctx); await execute(ex, a, ctx);
  assert.equal(ex.S.orders.length, n); assert.equal(count(ex, 'market'), 1);
});

test('Після спрацювання докупівлі TP/SL перераховуються від нової середньої', async () => {
  const ex = fakeEx(), [a] = actionsFor([{ kind: 'open', notional: 60, t: T }], BOT, true);
  await execute(ex, a, ctx); const tp0 = ex.S.pos.tp;
  ex.hit(ladder(g, 2.5, F)[0].price);
  const m = await sync(ex, ctx);
  assert.match(m, /TP\/SL оновлено/); assert.ok(ex.S.pos.tp < tp0);
  assert.deepEqual(ex.S.pos.tp, protect(g, ex.S.pos.entry, F).tp);
  assert.equal(await sync(ex, ctx), null, 'без змін — без зайвих запитів');
});

test('Біржа закрила позицію за TP — звірка знімає залишки ордерів бота', async () => {
  const ex = fakeEx(), [a] = actionsFor([{ kind: 'open', notional: 60, t: T }], BOT, true);
  await execute(ex, a, ctx); ex.S.pos = null;
  const m = await sync(ex, ctx);
  assert.match(m, /закрито біржею/); assert.equal((await ex.openOrders()).length, 0);
});

test('Закриття: скасування ордерів і reduce-only ринком; повтор нічого не надсилає', async () => {
  const ex = fakeEx(), [o, c] = actionsFor([{ kind: 'open', notional: 60, t: T }, { kind: 'close', pnl: 1, t: T + 864e5 }], BOT, true);
  await execute(ex, o, ctx); await execute(ex, c, ctx);
  assert.equal(ex.S.pos, null); assert.equal((await ex.openOrders()).length, 0);
  const n = ex.S.orders.length; await execute(ex, c, ctx); assert.equal(ex.S.orders.length, n);
});

const run = async (ex, { saveOk = true, state = null, events } = {}) => {
  const logs = [], saved = [], notes = [];
  const r = { state: { b: {}, lt: T }, events: events ?? [{ kind: 'open', notional: 60, price: 2.5, t: T }] };
  const res = await handleBot({ bot: { id: BOT, state }, g, r, symbol: 'TONUSDT', mirror: true, native: !!ex?.native, ex,
    save: async (s) => { saved.push(s); return saveOk; }, log: async (l, m) => logs.push([l, m]), notify: async (m) => notes.push(m) });
  return { res, logs, saved, notes };
};

test('Стан не збережено (паралельний запуск) — жодного звернення до біржі й жодної події', async () => {
  const ex = fakeEx(), { res, logs, notes } = await run(ex, { saveOk: false });
  assert.equal(res.saved, false); assert.equal(ex.S.calls.length, 0); assert.equal(notes.length, 0);
  assert.match(logs[0][1], /Стан не збережено/);
});

test('Черга дій: спершу збереження з дією, після виконання — без неї', async () => {
  const ex = fakeEx(), { saved } = await run(ex);
  assert.equal(saved[0].pend.length, 1); assert.equal(saved.at(-1).pend.length, 0); assert.equal(count(ex, 'market'), 1);
});

test('Помилка біржі: дія лишається в черзі й повторюється, після 5 спроб знімається', async () => {
  const ex = fakeEx(); ex.market = async () => { throw new Error('timeout'); };
  let state = null, last;
  for (let i = 0; i < MAX_TRIES; i++) { last = await run(ex, { state, events: i ? [] : undefined }); state = last.saved.at(-1); }
  assert.equal(state.pend.length, 0); assert.ok(last.notes.some((m) => /знято після 5 спроб/.test(m)));
});

test('Binance Testnet: докупівля дублюється ринковим ордером, без лімітів і TP/SL', async () => {
  const ex = fakeEx({ native: false }), acts = actionsFor([{ kind: 'open', notional: 60, t: T }, { kind: 'dca', notional: 90, n: 2, t: T + 864e5 }], BOT, false);
  for (const a of acts) await execute(ex, a, { ...ctx, native: false });
  assert.equal(count(ex, 'market'), 2); assert.equal(count(ex, 'limit'), 0); assert.equal(count(ex, 'tradingStop'), 0);
  assert.equal(actionsFor([{ kind: 'dca', notional: 90, n: 2, t: T }], BOT, true).length, 0, 'Bybit: докупівля вже стоїть лімітом');
});
