import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';

@Controller()
export class AppController {
  @Get()
  home(@Res({ passthrough: true }) res?: Response) {
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CallTracer</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 900px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
    h1 { font-size: 1.6rem; margin: 0; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 28px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .logout { font-size: 0.85rem; }
    .card { background: #16213e; padding: 20px 24px; border-radius: 10px; margin-bottom: 16px; }
    .card h2 { font-size: 1.1rem; color: #a78bfa; margin: 0 0 8px; }
    .card p { margin: 0 0 14px; color: #ccc; font-size: 0.92rem; line-height: 1.5; }
    .card .links { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
    .card .links a { background: #0f172a; border: 1px solid #333; padding: 6px 12px; border-radius: 6px; font-size: 0.85rem; }
    form.inline { display: flex; gap: 8px; }
    form.inline input { background: #0f172a; color: #eaeaea; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; flex: 1; font-size: 14px; }
    form.inline button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <h1>CallTracer</h1>
    <a class="logout" href="/logout">Выйти</a>
  </div>
  <div class="meta">Трассировка звонков и мониторинг метрик — Convolo (Dialer, S2L), VoIPmonitor, SBCtelco.</div>

  <div class="card">
    <h2>🎧 Прослушивание звонка</h2>
    <p>Найти звонок по Call-ID и прослушать запись: волна + спектрограмма, RTCP-отчёт (MOS, jitter, packet loss), скачивание WAV/OGG/PCAP. Принимает как SIP Call-ID, так и id из дайлера/S2L (например <code>1784891602.0026156</code>) — резолвится автоматически.</p>
    <form class="inline" method="GET" action="/call-recording/player">
      <input type="text" name="callid" placeholder="Call-ID (SIP или дайлер/S2L)" required />
      <button type="submit">Открыть</button>
    </form>
  </div>

  <div class="card">
    <h2>📋 Трассировка звонка</h2>
    <p>Полный разбор звонка по id дайлера (<code>X.Y</code>) или S2L: события, найденный CDR VoIPmonitor, SIP-история, SBCtelco (обе ноги, если применимо).</p>
    <form class="inline" method="GET" action="#" onsubmit="window.location.href = '/calltrace/' + encodeURIComponent(this.callId.value); return false;">
      <input type="text" name="callId" placeholder="Call-ID дайлера/S2L (например 1784891602.0026156)" required />
      <button type="submit">Открыть</button>
    </form>
  </div>

  <div class="card">
    <h2>📊 Мониторинг звонков</h2>
    <p>Dialer/S2L: Call Success Rate, звонков и неуспешных в минуту, EMA по слотам, алерты по fail rate, недельные отчёты.</p>
    <div class="links">
      <a href="/call-monitor/calls">Звонки</a>
      <a href="/call-monitor/csr">CSR</a>
      <a href="/call-monitor/calls-per-min">Звонков/мин</a>
      <a href="/call-monitor/unsuccess-per-min">Неуспешных/мин</a>
      <a href="/call-monitor/deviation-summary">Отклонения</a>
      <a href="/call-monitor/alerts">Alerts</a>
    </div>
  </div>

  <div class="card">
    <h2>☎️ SBCtelco</h2>
    <p>Прямой запрос активных/завершённых звонков SBCtelco (<code>call_trace</code>) и поиск в истории (<code>sbctrace</code>) по номерам/времени.</p>
    <div class="links">
      <a href="/sbctelco/call_trace">Активные звонки</a>
    </div>
    <p style="margin-top: -4px;">Поиск в истории: <code>/sbctelco/sbctrace/search?calling=...&amp;called=...</code> (нужен хотя бы один параметр фильтра).</p>
  </div>

  <div class="card">
    <h2>🔎 VoIPmonitor CDR</h2>
    <p>Прямой доступ к CDR VoIPmonitor (JSON API). Обязателен параметр <code>fdatefrom</code>; опционально <code>fcaller</code>, <code>fcalled</code>, <code>fcallid</code>, <code>fcallerd_type=1</code> (точное совпадение по номеру).</p>
    <div class="links">
      <a href="/voipmonitor/calls?fdatefrom=${new Date().toISOString().slice(0, 10)}+00:00:00&limit=10">Звонки за сегодня</a>
    </div>
  </div>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }
}
