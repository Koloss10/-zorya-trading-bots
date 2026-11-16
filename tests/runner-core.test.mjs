// Ядро серверних ботів: та сама торгова логіка, що й у браузері; стан відновлюється без розбіжностей.
import test from 'node:test';
import assert from 'node:assert/strict';
import { processBot, botConfig, eventText } from '../supabase/functions/runner/core.js';
import { Bot, entry } from '../supabase/functions/runner/engine.js';

const H = 36e5, T0 = Date.UTC(2026, 0, 5);
function series(n, seed = 9) { let s = seed, c = 100; const R = () => (s = (s * 16807) % 2147483647) / 2147483647, o = [];
  for (let i = 0; i < n; i++) { const op = c; c *= 1 + (R() - 0.5) * 0.03; o.push({ t: T0 + i * H, o: op, h: Math.max(op, c) * (1 + R() * 0.01), l: Math.min(op, c) * (1 - R() * 0.01), c, v: 1 }); }
  return o; }
const g = botConfig({ pair: 'BTC/USDT', tf: 1, d: 1, fut: 1, lev: 2, sg: ['rsi', 'bb'], k: 1, rm: 40, orders: 4, base: 20, step: 0.012, mult: 1.3, tp: 0.008, sl: 0.06, _t0: 1, _srv: true, _ex: 'bybit' });

test('botConfig прибирає службові поля й додає ставки бірж', () => {
  assert.equal(g._srv, undefined); assert.equal(g.ftk, 0.0005); assert.equal(g.pair, 'BTC/USDT');
});

test('Новий бот стартує з поточного моменту: історія не програється', () => {
  const cs = series(500), now = cs.at(-1).t + H;
  const r = processBot({ g, state: null, candles: cs, now });
  assert.equal(r.events.length, 0); assert.equal(r.state.b.tr.length, 0); assert.equal(r.state.lt, cs.at(-1).t + H);
});

test('Покроковий запуск (як cron) дає той самий результат, що й один прогін', () => {
  const cs = series(900), start = 400;
  // один прогін: бот створений на свічці start
  const one = processBot({ g, state: null, candles: cs.slice(0, start), now: cs[start - 1].t + H });
  const full = processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H });
  // покроково: кожні 5 «хвилин» з'являється не більше однієї нової свічки, сервер бачить лише останні 300
  let st = one.state, evs = [];
  for (let i = start + 1; i <= cs.length; i++) {
    const r = processBot({ g, state: JSON.parse(JSON.stringify(st)), candles: cs.slice(Math.max(0, i - 300), i), now: cs[i - 1].t + H });
    st = r.state; evs.push(...r.events);
  }
  assert.ok(full.state.b.tr.length > 3, 'є угоди');
  assert.equal(st.b.tr.length, full.state.b.tr.length, 'та сама кількість угод');
  assert.ok(Math.abs(st.b.cum - full.state.b.cum) < 1e-9, 'той самий PnL');
  assert.equal(evs.length, full.events.length, 'ті самі події');
});

test('Події відповідають угодам рушія (вхід, докупівлі, вихід)', () => {
  const cs = series(900), one = processBot({ g, state: null, candles: cs.slice(0, 400), now: cs[399].t + H });
  const r = processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H });
  const opens = r.events.filter(e => e.kind === 'open').length, exits = r.events.filter(e => ['close', 'sl', 'liq'].includes(e.kind)).length;
  assert.equal(exits, r.state.b.tr.length); assert.ok(opens === exits || opens === exits + 1);
  assert.ok(r.events.every(e => e.t > one.state.lt));
  assert.match(eventText(r.events[0], g), /^Orbix \(сервер\): BTC\/USDT Long/);
});

test('Незакрита свічка не обробляється', () => {
  const cs = series(450), one = processBot({ g, state: null, candles: cs.slice(0, 400), now: cs[399].t + H });
  const r = processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H / 2 });
  assert.equal(r.state.lt, cs.at(-2).t + H);
});

test('Обробка не змінює переданий стан', () => {
  const cs = series(900), one = processBot({ g, state: null, candles: cs.slice(0, 400), now: cs[399].t + H });
  const snap = JSON.stringify(one.state);
  processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H });
  assert.equal(JSON.stringify(one.state), snap);
});

test('Пауза: свічки, що закрилися під час паузи, пропускаються — після зняття нічого не дограється', () => {
  const cs = series(900), start = 400, t0 = cs[start - 1].t + H;
  const one = processBot({ g, state: null, candles: cs.slice(0, start), now: t0 });
  const pA = cs[500].t + H, pB = cs[800].t + H; // пауза між свічками 500 і 800
  const spans = [[t0 - 1, pA], [pB, null]];
  const r = processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H, spans });
  assert.ok(r.events.length > 0);
  assert.ok(r.events.every((e) => e.t <= pA || e.t > pB), 'жодної події під час паузи');
  const full = processBot({ g, state: one.state, candles: cs, now: cs.at(-1).t + H });
  assert.ok(full.events.some((e) => e.t > pA && e.t <= pB), 'без пауз події в цей час були б');
  assert.equal(r.state.lt, cs.at(-1).t + H);
});
