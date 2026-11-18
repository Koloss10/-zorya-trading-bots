// Ідентифікатори елементів інтерфейсу не повторюються між шаблоном і полями, які створює JS.
// Причина тесту: полотно анімації фону мало id="fx", а поле конструктора «Множник кроку» — теж fx;
// $('#fx') знаходив полотно, множник ставав NaN, і конструктор блокував бектест і створення бота.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const tpl = read('src/orbix.template.html');
const js = fs.readdirSync(path.join(root, 'src/js')).filter((f) => f.endsWith('.js')).map((f) => read('src/js/' + f)).join('\n');

// id зі статичного шаблону
const tplIds = [...tpl.matchAll(/\bid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]);
// id, які створює JS: літерали id="…" у рядках-шаблонах, поля конструктора (NUM: ['fx','…','smul',1]) і sel('fe',…)
const jsIds = new Set([
  ...[...js.matchAll(/\bid="([A-Za-z][\w-]*)"/g)].map((m) => m[1]),
  ...[...js.matchAll(/\['(f[a-z0-9]+)','[^']+','[a-z0-9]+',\d+\]/g)].map((m) => m[1]),
  ...[...js.matchAll(/\bsel\('([a-z][\w-]*)'/g)].map((m) => m[1]),
]);

test('Шаблон: кожен id трапляється один раз', () => {
  const seen = new Map();
  for (const id of tplIds) seen.set(id, (seen.get(id) || 0) + 1);
  assert.deepEqual([...seen].filter(([, n]) => n > 1).map(([id]) => id), []);
});

test('JS не створює елементів з id, який уже є в шаблоні', () => {
  assert.deepEqual(tplIds.filter((id) => jsIds.has(id)), []);
});

test('Поля конструктора знайдено (тест справді щось перевіряє)', () => {
  for (const id of ['fx', 'fo', 'fs', 'fe', 'fper']) assert.ok(jsIds.has(id), id);
});
