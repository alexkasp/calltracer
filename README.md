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

### Прослушивание звонков (`CallRecordingController`)

- Поиск pcap-дампа/аудиозаписи звонка в VoIPmonitor по SIP Call-ID через `HTTP API 2` (`/php/api.php`, авторизация `user`/`password`, отдельно от сессионного `sql.php`).
- `GET /call-recording` — форма (Call-ID + опционально дата звонка).
- `GET /call-recording/player?callid=…&calldate=…` — страница с метаданными звонка (из CDR, если найден), HTML5-плеером RTP-потока и ссылками на скачивание.
- `GET /call-recording/audio?cdrId=…` или `?callid=…&calldate=…` — проксирует WAV/OGG (`getVoiceRecording`) для `<audio>`.
- `GET /call-recording/pcap?cdrId=…` или `?callid=…` — отдаёт pcap/zip (`getPCAP`) как файл для скачивания.
- Если `cdrId` неизвестен (звонок не нашёлся в CDR), аудио/pcap запрашиваются напрямую по `callId` с `cidMerge=true` (склейка нескольких плеч).

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

### Прочие HTTP-эндпоинты

#### Трассировка (`CalltraceController`)

| Путь | Назначение |
|------|------------|
| `GET /calltrace/:id` | Трассировка звонка по ID (dialer `X.Y` или S2L). HTML по умолчанию; `?format=json` — сырые данные (`callId`, `callType`, `events`, `log`, `sipCallId`); `?format=text` — events+log без HTML |

#### VoIPmonitor (`VoipmonitorController`)

| Путь | Назначение |
|------|------------|
| `GET /voipmonitor/calls` | CDR LISTING из VoIPmonitor. Обязателен `fdatefrom`; опционально `start`, `limit`, `fdateto`, `fcaller`, `fcalled`, `fcallerd_type`, `fcallid` — всегда JSON |

#### SBCtelco (`SbctelcoController`)

| Путь | Назначение |
|------|------------|
| `GET /sbctelco/fetch-and-save` | Забрать звонки SBCtelco за последние 2 мин и сохранить новые (по id) в `sbctrace` |
| `GET /sbctelco/sbctrace/search` | Поиск в `sbctrace` по `calling`/`called`/`timestamp_after`/`timestamp_before` (нужен хотя бы один фильтр), `limit`. Текст по умолчанию, `?format=json` — JSON |
| `GET /sbctelco/sbctrace/:id` | Лог конкретной записи `sbctrace` по id. Текст по умолчанию, `?format=json` — JSON |
| `GET /sbctelco/call_trace` | Прямой запрос `call_trace` к SBCtelco (`nb_result`, `called`, `calling`, `recursive`). `save=1` — сохранить результат в `sbctrace` (в JSON-ответе добавятся `_saved`/`_savedIds`/`_lowMosCount`). HTML по умолчанию, `?format=text` / `?format=json` — альтернативные форматы |

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

## Деплой на прод-сервер

Прод крутится на `dev.uae` (host `app02d`), каталог `/var/calltracer`, каталог и `.git` принадлежат `root` — свой пользователь работает через `sudo`. Процессом управляет общий PM2-демон (там же ещё несколько несвязанных сервисов), поэтому рестартовать нужно **точечно по имени/id**, не всем PM2 сразу.

```bash
# на сервере, от своего пользователя (не root)
cd /var/calltracer
sudo git pull origin main
sudo /root/.nvm/versions/node/v22.21.1/bin/npm ci
sudo /root/.nvm/versions/node/v22.21.1/bin/npm run build
sudo /root/.nvm/versions/node/v22.21.1/bin/pm2 restart calltracer
```

Особенности:

- `ecosystem.config.cjs` **не в git** (сознательно, см. `.gitignore`) — на сервере в нём указан `interpreter` на Node v22 (nvm), локальный файл в репозитории — только заготовка для разработки. Не перезаписывать по аналогии с origin.
- `/root` закрыт для чужих пользователей (`550`), поэтому `node`/`npm`/`pm2` из-под nvm доступны только через `sudo` с полным путём. Если настроены алиасы (`node22`, `npm22`, `pm2`) в `~/.bashrc` — можно короче: `pm2 restart calltracer`.
- Перед `git pull` стоит проверить `git status`/`git log` — репозиторий уже попадал в состояние зависшего `rebase` (правился вручную на сервере в обход обычного flow); в норме `main` должен быть чистым и совпадать с `origin/main`.
- Локально (машина разработчика) — обычный flow: закоммитить, запушить в `origin/main`, дальше деплой на сервере как выше.
