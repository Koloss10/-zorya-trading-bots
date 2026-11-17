# Orbix — правила роботи з репозиторієм

Платформа DCA-ботів для крипто-ф'ючерсів і споту: один HTML-файл інтерфейсу на GitHub Pages плюс серверні функції Supabase. Мова інтерфейсу, документації, комітів і PR — українська.

## Межі (не порушувати)
- Лише **Bybit Demo** (`api-demo.bybit.com`) і **Binance Futures Testnet**. Реальні рахунки не підключати, адреси бірж не змінювати.
- Ключі й секрети ніколи не просити в чаті: користувач вносить їх лише через форми Orbix. Ключі з правом виведення відхиляються.
- Лише безкоштовні сервіси, без SMS.
- Дані користувача (email тощо) не передавати зовнішнім сервісам.
- До завершення поточного етапу не додавати великих нових функцій; не ламати наявне.

## Команди
```sh
npm run build    # зібрати orbix.html, runner/engine.js і копії _shared/*
npm run check    # усе згенероване актуальне (так робить CI)
npm test         # усі тести (115+)
npm run verify   # check + test
```

## Згенеровані файли — вручну не редагувати
- `orbix.html` ← `src/orbix.template.html`, `src/orbix.css`, `src/js/*`, `src/vendor/*`
- `supabase/functions/runner/engine.js` ← `src/js/01–06`
- `supabase/functions/{exchange,runner}/{exchanges.ts,sign.js}` ← `supabase/functions/_shared/`

Вручну пишуться: `runner/index.ts`, `runner/core.js`, `runner/mirror.js`, `exchange/index.ts`, `tg-notify/*`, `_shared/*`.

## Процес
- Робота в гілці, злиття в `main` лише через PR після зеленого CI «Validate Orbix» (`.github/workflows/validate.yml`), злиття з `expectedHeadSha`, потім fast-forward робочої гілки до `main`.
- Викладання на сервер — скіл **`orbix-deploy`** (`.claude/skills/orbix-deploy/`).
  - Проєкт Supabase `krmnaypaitruhqgaxkfw`.
  - `runner`: `verify_jwt false`. `exchange`: `verify_jwt true`.
  - У `deploy_edge_function` завжди передаються **всі** файли функції. Після розгортання — `verify.py` і перевірка запуску розкладу (200, усі боти оброблено, без `error`).
- Міграції: новий файл `supabase/migrations/<YYYYMMDDHHMMSS>_<назва>.sql`, застосування через `apply_migration`. Наявні міграції не змінювати.
- Стабільний реліз: тег `orbix-<дата>-<назва>` на коміті злиття й рядок у `archive/README.md` (див. «Архів»).

## Тести й перевірка змін
- Біржі в тестах підставні: `fakeEx` у `tests/mirror.test.mjs`, `simEx` у `tests/sim.test.mjs`. Ручні ордери й збої мережі там уже змодельовані (`flaky`, `chaos`, `manual`).
- Для важливих виправлень робити мутаційну перевірку: тимчасово повернути старий код і переконатися, що тест падає.
- Мобільний інтерфейс перевіряти Playwright (iPhone 13 і 360 px): без горизонтального прокручування сторінки, без помилок JS.

## Підводні камені
- Ключ localStorage `zorya3` (боти без акаунта) **не перейменовувати**: інакше зникнуть дані користувачів.
- Ідентифікатор ордера: `ox<12 hex id бота>-<t36>-<вид>`. Знімаються лише ордери з префіксом бота (`cancelMine`, `cancelPrefix`); `cancelAll` біржі не викликати.
- Якщо `byLink` упав, статус ордера невідомий: новий ордер не надсилати, дію лишити в черзі (`once` у `mirror.js`).
- Стан бота зберігається з перевіркою версії (CAS) **до** будь-яких дій на біржі.
- `auth`: адреса повернення = `location.origin + location.pathname`. Після зміни адреси сайту (наприклад, перейменування репозиторію) її треба додати в Supabase → Authentication → URL Configuration.

## Документи
- `docs/readiness-report.md` — звіт про готовність і поточні обмеження.
- `docs/engine-audit.md` — аудит рушія й усі знайдені розбіжності.
- `archive/` — старі версії (Zorya, старі гілки, знімки Orbix) і правила відкату. Збирання й CI його не чіпають.

## Поточний етап
План «перевірка надійності»:
- етап A (ризики виконання ордерів) завершено — PR #33;
- далі етап B: аварійна зупинка всіх ботів і ліміти ризику;
- потім етап C: 7-денний тест на Demo/Testnet без змін коду.
