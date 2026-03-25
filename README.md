# CallTracer

Сервис на **NestJS** для трассировки звонков и мониторинга метрик по данным Convolo (Dialer, S2L), VoIPmonitor и SBCtelco.

## Основной функционал

### Трассировка звонков (`CalltraceService`)

- Разбор логов **S2L** и **Dialer** (в т.ч. сценарий `dialer-inbound`), извлечение SIP, событий, INVITE на заданные домены (например `sip.se.didlogic.net`).
- Интеграция с **VoIPmonitor**: поиск звонка по SIP Call-ID, поле `fbasename` для поиска в SBCtelco.
- Интеграция с **SBCtelco**: поиск по номерам/времени, по `call_id` (из VoIPmonitor), вторая нога по `other_leg_id` / `leg_id` (поведение настраивается через `SBC_FETCH_OTHER_LEG` в `.env`).
- Логирование условий поиска и исхода («не найдено», найдено по call_id и т.д.).

### Функционал по крону (`@nestjs/schedule`)

Расписание задаётся в сервисах; глобально кроны активны, если в приложении подключён `ScheduleModule` (см. `app.module.ts`).

#### SBCtelco — `SbctelcoCronService`

| Расписание | Что делает |
|------------|------------|
| **Каждую минуту** (`* * * * *`) | Active snapshot: `call_state=Active`, `recursive=yes`, `nb_result=1000` (+ пагинация по `page`) — обновляет/сохраняет текущие активные звонки по ключу `leg_id/call_id`. |
| **Каждые 5 минут** (`*/5 * * * *`) | Inactive overlap: окно `start=now-15m`, `end=now`, `call_state=Inactive`, `recursive=yes`, `nb_result=1000` (+ пагинация). В `sbctrace` сохраняются id, которых не было за последние **15 минут**; для существующих `leg_id/call_id` выполняется update и перевод в завершённые. При `MOS < 4` отправляется Telegram-отчёт. |
| **Раз в сутки в 03:00** (`0 3 * * *`) | Удаление из `sbctrace` записей **старше 5 дней** (очистка истории). |

При ручном сохранении ответа `call_trace` (`save=1`) в JSON при `Accept: application/json` или `format=json` дополнительно: **`_saved`**, **`_savedIds`**, **`_lowMosCount`** (сколько сохранённых строк с **MOS < 4**; Telegram уходит, если таких хотя бы одна).

#### Мониторинг звонков — `CallMonitorCronService`

| Расписание | Что делает |
|------------|------------|
| **Каждые 5 минут** (`*/5 * * * *`) | Вызов `CallMonitorService.run()`: загрузка Dialer/S2L за 60 мин, окна 5/15/60 мин, CSR и статистики «в минуту», слотовая EMA, алерты по fail rate, финализация 30‑мин слотов, недельная агрегация по `userId`, обновление `last_run_at`. Включение: **`CALL_MONITOR_CRON_ENABLED`** не `false`/`0`. |

При выключенном кроне мониторинга данные для отчётов можно обновлять вручную (например `GET …/unsuccess-per-min?refresh=1` или вызовы API без крона).

### Мониторинг звонков (`CallMonitorService`)

- Запросы к API **Dialer** (ipmaxi) и **S2L** (leads): последние N минут звонков.
- **CSR** (Call Success Rate) по скользящим окнам 5 / 15 / 60 минут.
- Статистика **звонков в минуту** и **неуспешных в минуту** (среднее и отклонение по слотам 30 минут, 48 слотов в сутках).
- **EMA** по доле неуспешных по слоту; алерты при превышении порога (объём, K·σ, минимальный fail rate), cooldown и сообщение **RESOLVED**.
- Недельная агрегация звонков по **userId**; отчёт за 4 недели (падение относительно максимума за период).
- Резюме **отклонений fail rate по пользователям** (порог в п.п.).

### Telegram (`TelegramNotifyService`)

- Уведомления об алертах и снятии алерта; в тексте интервал слота указывается как **время на сервере** (например `10:00–10:30 (slot 20)`).
- **SBCtelco / sbctrace:** в Telegram уходит **дополнительное** оповещение только если среди только что сохранённого батча есть звонки с **MOS < 4** (полный набор звонков при этом тоже пишется в БД).
- Ручная отправка отчётов: сводный отчёт, отчёт по звонкам за **1 час** (см. эндпоинты ниже).

### HTTP-эндпоинты мониторинга

Базовый путь: `/call-monitor/…` (HTML и при `?format=json` или `Accept: application/json` — JSON).

| Путь | Назначение |
|------|------------|
| `GET /call-monitor/calls` | Сырые данные Dialer + S2L за 5 мин |
| `GET /call-monitor/csr` | CSR по окнам 5/15/60 мин |
| `GET /call-monitor/calls-per-min` | Звонков в минуту (история по слоту + текущее окно) |
| `GET /call-monitor/unsuccess-per-min` | Неуспешных в минуту по окнам и типам |
| `GET /call-monitor/deviation-summary` | Отклонения fail rate по пользователям |
| `GET /call-monitor/weekly-report?userId=…` | Недели по пользователю |
| `GET /call-monitor/weekly-change-report` | Изменение за 4 недели (порог %) |
| `GET /call-monitor/slot-ema` | EMA по слотам |
| `GET /call-monitor/slot-ema-user?userId=…` | EMA по слотам для пользователя |
| `GET /call-monitor/alerts` | Состояние алертов |
| `POST /call-monitor/send-hourly-report-to-telegram` | Тест: отчёт за 1 час в Telegram |
| `POST /call-monitor/send-report-to-telegram` | Сводный отчёт в Telegram |

На HTML-страницах в шапке — общая навигация по разделам.

### Переменные окружения (фрагмент)

- `CONVOLO_API_KEY` — ключ API Convolo (логи и мониторинг).
- `CALL_MONITOR_CRON_ENABLED` — включение крона мониторинга.
- `CALL_MONITOR_TELEGRAM_ALERTS_ENABLED` — включение Telegram-алертов от Call Monitor (по умолчанию `true`; `false/0/off/no` выключает).
- `SBC_CRON_FETCH_ENABLED`, `SBC_FETCH_OTHER_LEG` — SBCtelco и вывод второй ноги.
- `SBC_MOS_ALERT_THRESHOLD` — порог MOS для алертов по `sbctrace` (по умолчанию `4`; алерт, если MOS < порога).
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` — Telegram; опционально `TELEGRAM_CHAT_ID_ALERTS`, `TELEGRAM_CHAT_ID_REPORTS`.
- Параметры алертов и EMA: `CALL_MONITOR_ALERT_*`, `CALL_MONITOR_EMA_*` и др. (см. код `CallMonitorService`).

## Description

NestJS application (MySQL через TypeORM, HTTP-клиент для внешних API, расписание через `@nestjs/schedule`).

## Installation

```bash
$ npm install
```

## Running the app

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Test

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
