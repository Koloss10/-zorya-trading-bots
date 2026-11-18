-- Ліміти ризику користувача (USDT) для серверних ботів, що торгують на демо-біржі.
-- Коли ліміт перевищено, сервер (runner/risk.js) не відкриває нових угод; відкриті позиції бот веде далі.
--   risk_max_pos   — повна драбина одного бота (вхід + усі докупівлі, з плечем);
--   risk_max_total — сума повних драбин усіх ботів, що мають позицію, разом із новою угодою;
--   risk_day_loss  — реалізований збиток за поточну добу UTC.
-- null — ліміт вимкнено. Змінювати може лише власник (наявні політики profiles, MFA при ввімкненій 2FA).
alter table public.profiles
  add column if not exists risk_max_pos numeric default 3000 check (risk_max_pos is null or risk_max_pos > 0),
  add column if not exists risk_max_total numeric default 8000 check (risk_max_total is null or risk_max_total > 0),
  add column if not exists risk_day_loss numeric default 150 check (risk_day_loss is null or risk_day_loss > 0);
