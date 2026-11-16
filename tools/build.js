#!/usr/bin/env node
// Збирає orbix.html з модулів у src/: стилі, вбудована бібліотека графіків і код застосунку.
// Результат — один самодостатній HTML-файл (працює на GitHub Pages, офлайн і в перегляді файлів).
//   node tools/build.js          — зібрати orbix.html
//   node tools/build.js --check  — перевірити, що orbix.html збігається зі зборкою (для CI)
// Модулі коду застосунку підключаються в порядку назв файлів (01-…, 02-…, 10-…): це один спільний
// скрипт, тож пізніші модулі можуть використовувати функції та змінні попередніх.
'use strict';
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), src = path.join(root, 'src'), out = path.join(root, 'orbix.html');
const read = f => fs.readFileSync(path.join(src, f), 'utf8');

function build() {
  const tpl = read('orbix.template.html');
  const css = read('orbix.css');
  const vendor = read('vendor/lightweight-charts.standalone.production.js');
  const mods = fs.readdirSync(path.join(src, 'js')).filter(f => /^\d\d-.*\.js$/.test(f)).sort();
  const app = mods.map(f => read('js/' + f)).join('');
  for (const [name, text] of [['vendor', vendor], ['app', app]])
    if (/<\/script/i.test(text)) throw new Error(`${name}: містить "</script", це зламає HTML`);
  const parts = { '/*@css*/': css, '/*@vendor*/': vendor, '/*@app*/': app };
  let html = tpl;
  for (const [k, v] of Object.entries(parts)) {
    if (html.split(k).length !== 2) throw new Error(`у шаблоні має бути рівно одна мітка ${k}`);
    html = html.replace(k, () => v);
  }
  return { html, mods };
}

const { html, mods } = build();
if (process.argv.includes('--check')) {
  const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (cur !== html) { console.error('orbix.html не збігається зі зборкою з src/. Запустіть: node tools/build.js'); process.exit(1); }
  console.log(`orbix.html актуальний (${mods.length} модулів)`);
} else {
  fs.writeFileSync(out, html);
  console.log(`orbix.html зібрано: ${mods.length} модулів, ${(Buffer.byteLength(html) / 1024).toFixed(0)} КБ`);
}
