// Витягує торговий рушій з orbix.html і виконує його в ізольованому контексті Node,
// щоб тести перевіряли саме той код, який працює в браузері.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
function loadEngine(file = path.join(__dirname, '..', 'orbix.html')) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const app = scripts[scripts.length - 1];
  const end = app.indexOf('/* ===== інтерфейс');
  if (end < 0) throw new Error('не знайдено межу рушія /* ===== інтерфейс');
  const code = app.slice(0, end) + `
;({Bot,run,summ,ladder,lv,entry,SIG,agg,aggC,ema,rsi,bbands,cci,stoch,macdH,auto,evalC,stress,DEF,PAIRS,DT,MD,STR,
  bt:typeof bt==='function'?bt:null,aggT:typeof aggT==='function'?aggT:null,closedTf:typeof closedTf==='function'?closedTf:null,
  replay:typeof replay==='function'?replay:null})`;
  const ctx = vm.createContext({ console, Math, Date, JSON, Array, Object, Number, String, Set, Map, Promise, Proxy,
    isFinite, Infinity, NaN, setTimeout, clearTimeout, AbortController, indexedDB: undefined, fetch: undefined });
  return vm.runInContext(code, ctx, { filename: 'orbix-engine.js' });
}
module.exports = { loadEngine };
