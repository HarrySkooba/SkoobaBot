# Skooba Discord Bot

Многофункциональный Discord-бот для семьи Skooba: заявки, обзвоны, проверки на читы, личные профили, Капт/МЦЛ списки, напоминания, проверка войса, история посещаемости и админ-панель.

## Возможности

- Заявки в семью через modal-форму, канал модерации, назначение обзвона, принятие/отклонение и автоматическая выдача роли.
- Приватный admin-чат с панелью настроек, slash-команды `/setting` и `/role-rule`.
- Проверки на читы: очередь ожидания, роль `CheatHunter`, вызов игрока, подтверждение `Игрок чист`, выдача `Verified`.
- Личные профили игроков: канал в категории `Тир 3`, ветки `отчет капт`, `отчет мцл`, `отчет рп`, повышение тира наставником.
- Капт/МЦЛ мероприятия: запись, основной список по 3 тирам, запасной список, DM-уведомления, экспорт, проверка voice-канала.
- История посещаемости и статистика неявок.

## Установка

```bash
npm install
cp .env.example .env
npm run db:migrate
npm run commands:deploy
npm run build
npm start
```

На Windows вместо `cp` можно создать `.env` вручную по примеру `.env.example`.

## .env

```env
DISCORD_TOKEN=your-bot-token
CLIENT_ID=your-application-client-id
GUILD_ID=your-discord-server-id
DATABASE_PATH=./data/skooba.sqlite
```

В Discord Developer Portal включи для бота privileged intents:

- Server Members Intent
- Message Content Intent не обязателен для текущей реализации, но можно включить для будущих текстовых команд

Боту нужны права:

- Manage Roles
- Manage Channels
- Send Messages
- Create Public Threads
- Read Message History
- View Channels

Роль бота должна стоять выше ролей, которые он выдает или снимает.

## Первый Запуск

1. Заполни `.env`.
2. Выполни `npm run db:migrate`.
3. Выполни `npm run commands:deploy`, чтобы зарегистрировать slash-команды на сервере.
4. Запусти бота через `npm run dev` или `npm start` после сборки.
5. В Discord вызови `/admin-panel`.
6. Через `/setting set` заполни роли, каналы и категории.
7. Через `/role-rule` настрой сценарии выдачи ролей, если нужно переопределить стандартные настройки.

## Важные Настройки

Основные ключи для `/setting set`:

- `admin_role_id`, `staff_role_id`, `family_role_id`, `verified_role_id`, `unverified_role_id`
- `mentor_role_id`, `cheat_hunter_role_id`
- `application_review_channel_id`, `application_log_channel_id`
- `application_panel_banner_url` — URL GIF/изображения в шапке панели заявок
- `applications_open` — `true` / `false` (обычно через `/application-intake`)
- `event_capt_channel_id`, `event_capt_log_channel_id`, `event_mcl_channel_id`, `event_mcl_log_channel_id`, `default_voice_channel_id`
- `cheat_queue_channel_id`, `cheat_log_channel_id`
- `profile_log_channel_id`
- `tier_1_role_id`, `tier_2_role_id`, `tier_3_role_id` — общие роли тира для Капт, МЦЛ и профилей
- `tier_1_category_id`, `tier_2_category_id`, `tier_3_category_id` — категории Discord для личных профилей по тиру

ID можно передавать как чистый ID или вставлять mention роли/канала.

## Команды

- `/admin-panel` — создать приватный канал админ-панели и сообщение настроек.
- `/setting set` — сохранить ID роли, канала или категории.
- `/setting list` — показать текущие настройки.
- `/setting delete` — удалить настройку по ключу, в том числе устаревшую.
- `/role-rule` — настроить проверяемую и выдаваемую роль для сценария.
- `/application-panel` — опубликовать панель заявок (Components v2: баннер, текст, статус приёма, кнопка).
- `/application-intake open|close` — открыть или закрыть приём заявок (обновляет панель).
- `/role-panel` — панель с кнопками самовыдачи `family_role_id` и `unverified_role_id` (только админ публикует).
- `/cheat-panel` — опубликовать кнопку заявки на проверку читов.
- `/cheat-remove` — убрать игрока из активной очереди проверки на читы, если очередь зависла или заявка забагалась.
- `/profile-panel` — опубликовать кнопку создания личного профиля.
- `/profile-promote` — изменить тир профиля игрока.
- `/profile-delete` — принудительно удалить профиль (канал, роли тира, БД); только `admin_role_id`.
- `/event-create-capt` — создать Капт (время, сторона, карта, фото и voice опционально).
- `/event-create-mcl` — создать МЦЛ/ВЗЗ (тип, время, телепорт, игроки, фото и voice опционально).
- `/attendance` — посмотреть количество проверок и неявок игрока.

## Сценарии Role Rules

Поддерживаемые сценарии:

- `application_accept` — при принятии заявки выдаются `family_role_id` и `unverified_role_id`; `grant_role` в правиле добавляется как дополнительная роль, если задана.
- `cheat_clean` — `grant_role` выдается после успешной проверки на читы, `check_role` снимается с игрока.

Если правило не задано, бот использует обычные настройки `family_role_id`, `verified_role_id` и `unverified_role_id`.

## Деплой На VPS

Рекомендуемый вариант:

```bash
npm install
npm run build
npm run db:migrate
npm run commands:deploy
npm install -g pm2
pm2 start dist/index.js --name skooba-bot
pm2 save
pm2 startup
```

После обновления кода:

```bash
npm install
npm run build
pm2 restart skooba-bot
```
