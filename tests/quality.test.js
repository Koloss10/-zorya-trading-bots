// Тести аналізу якості стратегії (src/js/06-quality.js): витрати, ринкові режими, стабільність.
// Ряди свічок синтетичні, тож очікуваний результат видно з їх побудови.
'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { loadEngine } = require('./load-engine');
const E = loadEngine();
const H1 = 36e5, T0 = Date.UTC(2026, 0, 5);
const G = o => ({ ...E.DEF, pair: 'BTC/USDT', base: 100, lev: 1, orders: 1, mult: 1, smul: 1, step: 0.02, tp: 0.01, sl: 0.05, trail: 0, s1: 0, be: 0, cd: 0, d: 1, ...o });
// n годинних свічок: f(i, o) → {c, h, l}; ціна відкриття = закриття попередньої
function series(n, f, p0 = 100) { const A = []; let o = p0; for (let i = 0; i < n; i++) { const x = f(i, o); A.push({ t: T0 + i * H1, o, h: x.h, l: x.l, c: x.c, v: 1 }); o = x.c; } return A; }
const all = A => A.map(() => true);
const flat = (h, l) => () => ({ c: 100, h, l });

test('режим ринку: ріст, падіння, бічний', () => {
  assert.equal(E.qMarket(series(720, (i, o) => ({ c: o * 1.0002, h: o * 1.001, l: o * 0.999 })), 1, 720).reg, 'up'); // +15 %
  assert.equal(E.qMarket(series(720, (i, o) => ({ c: o * 0.9998, h: o * 1.001, l: o * 0.999 })), 1, 720).reg, 'dn');
  assert.equal(E.qMarket(series(720, flat(100.5, 99.5)), 1, 720).reg, 'fl');
  // для тижневого вікна поріг менший: 8 %·√(168/720) ≈ 3,9 %; +5 % — уже ріст
  assert.equal(E.qMarket(series(168, (i, o) => ({ c: o * 1.0003, h: o, l: o })), 1, 168).reg, 'up');
});

test('стабільна: прибуток з запасом на витрати в усіх вікнах', () => {
  // вхід за 100, наступна свічка доходить до 100,5 → TP 0,4 %; навіть подвоєні витрати (≈0,24 %) менші за TP
  const A = series(2880, flat(100.5, 99.9)), g = G({ tp: 0.004 }), q = E.qualityA(A, all(A), g, 1000);
  assert.ok(q.base.pnl > 0 && q.hard.pnl > 0 && q.gross.pnl > q.base.pnl);
  assert.equal(q.W, 720); assert.equal(q.wins.length, 4); assert.equal(q.pos, 4);
  assert.ok(q.wins.every(w => w.reg === 'fl'));
  assert.equal(q.flags.length, 0, JSON.stringify(q.flags)); assert.equal(q.verdict, 'стабільна');
});

test('чутлива до витрат: прибуткова лише з витратами бектесту', () => {
  // TP 0,12 %: комісії бектесту 0,05 % + 0,02 % лишають прибуток, подвоєні (0,1 % + 0,1 % прослизання + 0,04 %) — ні
  const A = series(2880, flat(100.15, 99.9)), g = G({ tp: 0.0012 }), q = E.qualityA(A, all(A), g, 1000);
  assert.ok(q.base.pnl > 0, 'базовий прибуток'); assert.ok(q.hard.pnl < 0, 'з подвоєними витратами збиток');
  // валовий прибуток 0,12 % на угоду, витрати ≈0,07 % → забирають більше половини
  assert.ok(q.costShare > 0.5 && q.costShare < 0.7, 'частка витрат ' + q.costShare);
  assert.ok(q.flags.some(f => /подвоєних витратах/.test(f.t)));
  assert.equal(q.verdict, 'нестабільна');
});

test('залежить від режиму: заробляє на рості, втрачає на падінні', () => {
  // перша половина: +0,02 %/год, кожна наступна свічка дає TP 0,5 %; друга: −0,05 %/год, Long виходить по SL 2 %
  const A = series(2880, (i, o) => i < 1440 ? { c: o * 1.0002, h: o * 1.0002 * 1.006, l: o * 0.999 } : { c: o * 0.9995, h: o * 1.0005, l: o * 0.9995 * 0.999 });
  const q = E.qualityA(A, all(A), G({ tp: 0.005, sl: 0.02 }), 1000);
  assert.ok(q.base.pnl > 0);
  assert.equal(q.wins.map(w => w.reg).join(), 'up,up,dn,dn');
  assert.ok(q.reg.up.pnl > 0 && q.reg.dn.pnl < 0);
  assert.ok(q.h1m > 0 && q.h2m < 0);
  assert.ok(q.flags.some(f => /падіння/.test(f.t)), 'режим падіння');
  assert.ok(q.flags.some(f => /Друга половина/.test(f.t)), 'перевага зникає');
  assert.equal(q.verdict, 'нестабільна');
});

test('збиткова і мало угод', () => {
  const A = series(2880, (i, o) => ({ c: o * 0.9995, h: o * 1.0005, l: o * 0.9995 * 0.999 }));
  assert.equal(E.qualityA(A, all(A), G({ tp: 0.005, sl: 0.02 }), 1000).verdict, 'збиткова');
  const B = series(2880, flat(100.5, 99.9)), e = B.map((_, i) => i % 400 === 0); // 8 угод
  assert.equal(E.qualityA(B, e, G({ tp: 0.004 }), 1000).verdict, 'мало угод');
});

test('короткий період: тижневі вікна, без вікон менше 2 тижнів', () => {
  const A = series(720, flat(100.5, 99.9)), q = E.qualityA(A, all(A), G({ tp: 0.004 }), 1000);
  assert.equal(q.W, 168); assert.equal(q.wins.length, 4);
  const B = series(168, flat(100.5, 99.9));
  assert.equal(E.qualityA(B, all(B), G({ tp: 0.004 }), 1000).wins.length, 0);
});

test('множник funding: frx=2 подвоює, frx=0 прибирає', () => {
  // ставка 0,1 % о 01:00, Long 1 BTC по 100 → платить 0,1 USDT
  const fr = [{ t: T0 + H1, r: 0.001 }], cs = [{ t: T0, o: 100, h: 100, l: 100, c: 100 }, { t: T0 + H1, o: 100, h: 100, l: 100, c: 100 }];
  const fd = frx => { const b = new E.Bot(E.normG(G({ fut: 1, frx })), fr, null); cs.forEach((r, i) => b.step(i, r, i === 0)); return b.pos.fd; };
  assert.ok(Math.abs(fd(undefined) - 0.1) < 1e-9); assert.ok(Math.abs(fd(2) - 0.2) < 1e-9); assert.equal(fd(0), 0);
});
