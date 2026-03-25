import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { CallMonitorService } from '../services/call-monitor.service';

/** Общая навигация по разделам мониторинга (для шапки всех HTML-страниц). */
const MONITOR_NAV =
  '<a href="/call-monitor/calls">Звонки</a> · ' +
  '<a href="/call-monitor/csr">CSR</a> · ' +
  '<a href="/call-monitor/calls-per-min">Звонков/мин</a> · ' +
  '<a href="/call-monitor/unsuccess-per-min">Неуспешных/мин</a> · ' +
  '<a href="/call-monitor/deviation-summary">Отклонения по юзерам</a> · ' +
  '<a href="/call-monitor/weekly-report">Отчёт за недели</a> · ' +
  '<a href="/call-monitor/weekly-change-report">Отчёт за 4 нед.</a> · ' +
  '<a href="/call-monitor/slot-ema">Slot EMA</a> · ' +
  '<a href="/call-monitor/slot-ema-user">Slot EMA (юзер)</a> · ' +
  '<a href="/call-monitor/alerts">Alerts</a>';

@Controller('call-monitor')
export class CallMonitorController {
  constructor(private readonly callMonitorService: CallMonitorService) {}

  @Get('slot-ema')
  async getSlotEma(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.callMonitorService.getSlotEmaAll();

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slot EMA</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>EMA по слотам (30 мин)</h1>
  <div class="meta">текущий slot: ${data.slot} · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  <h2>Dialer</h2>
  <pre>${escapeHtml(JSON.stringify(data.dialer, null, 2))}</pre>
  <h2>S2L</h2>
  <pre>${escapeHtml(JSON.stringify(data.s2l, null, 2))}</pre>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Резюме отклонения fail_rate по пользователям: кто отклонился от своей слотовой нормы на ≥ threshold%.
   * threshold — в процентных пунктах (по умолчанию 20).
   */
  @Get('deviation-summary')
  async getDeviationSummary(
    @Query('threshold') thresholdParam?: string,
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const thresholdPct = Math.max(0, Math.min(100, parseInt(String(thresholdParam ?? '20'), 10) || 20));
    const data = await this.callMonitorService.getDeviationSummary(thresholdPct);

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const row = (
      r: { userId: string; currentTotal: number; currentFailed: number; currentFailRate: number; avgFailRate: number | null; deviationPct: number | null; aboveThreshold: boolean },
    ) =>
      `<tr class="${r.aboveThreshold ? 'above' : ''}"><td>${escapeHtml(r.userId)}</td><td>${r.currentTotal}</td><td>${r.currentFailed}</td><td>${(r.currentFailRate * 100).toFixed(1)}%</td><td>${r.avgFailRate != null ? (r.avgFailRate * 100).toFixed(1) + '%' : '—'}</td><td>${r.deviationPct != null ? (r.deviationPct >= 0 ? '+' : '') + r.deviationPct.toFixed(1) + ' п.п.' : '—'}</td><td>${r.aboveThreshold ? 'да' : ''}</td></tr>`;

    const summaryDialer =
      data.aboveThresholdDialer.length > 0
        ? data.aboveThresholdDialer
          .map(
            (r) =>
              `${escapeHtml(r.userId)}: +${r.deviationPct.toFixed(1)} п.п. (текущий ${(r.currentFailRate * 100).toFixed(1)}%, норма ${(r.avgFailRate * 100).toFixed(1)}%)`,
          )
          .join('; ')
        : 'нет';
    const summaryS2l =
      data.aboveThresholdS2l.length > 0
        ? data.aboveThresholdS2l
          .map(
            (r) =>
              `${escapeHtml(r.userId)}: +${r.deviationPct.toFixed(1)} п.п. (текущий ${(r.currentFailRate * 100).toFixed(1)}%, норма ${(r.avgFailRate * 100).toFixed(1)}%)`,
          )
          .join('; ')
        : 'нет';

    const noCallsDialerStr =
      data.noCallsIn5MinDialer.length > 0
        ? data.noCallsIn5MinDialer
          .map(
            (r) =>
              `${escapeHtml(r.userId)} (норма по слоту: ${r.avgTotal.toFixed(1)} звонков, fail ${(r.avgFailRate * 100).toFixed(1)}%)`,
          )
          .join('; ')
        : 'нет';
    const noCallsS2lStr =
      data.noCallsIn5MinS2l.length > 0
        ? data.noCallsIn5MinS2l
          .map(
            (r) =>
              `${escapeHtml(r.userId)} (норма по слоту: ${r.avgTotal.toFixed(1)} звонков, fail ${(r.avgFailRate * 100).toFixed(1)}%)`,
          )
          .join('; ')
        : 'нет';

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Резюме отклонений по пользователям</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
    tr.above { background: rgba(220, 80, 80, 0.15); }
    .resume { background: #16213e; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Резюме: отклонение ≥${data.thresholdPct}% по пользователям</h1>
  <div class="meta">slot ${data.slot}, окно ${data.windowMinutes} мин · порог ${data.thresholdPct} п.п. · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>

  <section>
    <h2>Пользователи с отклонением ≥${data.thresholdPct} п.п.</h2>
    <div class="resume"><strong>Dialer:</strong> ${summaryDialer}</div>
    <div class="resume"><strong>S2L:</strong> ${summaryS2l}</div>
  </section>

  <section>
    <h2>Без звонков за 5 мин (были за 60 мин, по слоту есть EMA)</h2>
    <p class="meta">Пользователи, у которых в отчёте за последние 5 мин звонков не было; для них не считаем fail rate, но показываем норму по слоту.</p>
    <div class="resume"><strong>Dialer:</strong> ${noCallsDialerStr}</div>
    <div class="resume"><strong>S2L:</strong> ${noCallsS2lStr}</div>
  </section>

  <section>
    <h2>Dialer (все пользователи за последние ${data.windowMinutes} мин)</h2>
    <table>
      <thead><tr><th>userId</th><th>Звонков</th><th>Неуспешных</th><th>Текущий fail %</th><th>Норма (слот)</th><th>Отклонение (п.п.)</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.dialer.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
  <section>
    <h2>S2L (все пользователи за последние ${data.windowMinutes} мин)</h2>
    <table>
      <thead><tr><th>userId</th><th>Звонков</th><th>Неуспешных</th><th>Текущий fail %</th><th>Норма (слот)</th><th>Отклонение (п.п.)</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.s2l.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  @Get('slot-ema-user')
  async getSlotEmaUser(
    @Query('userId') userId?: string,
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const uid = String(userId ?? '').trim();
    const data = await this.callMonitorService.getSlotEmaByUser(uid);

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Slot EMA (user)</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.4; }
    input { background: #0f172a; color: #eaeaea; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; width: 280px; }
    button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>EMA по слотам (userId)</h1>
  <div class="meta">текущий slot: ${data.slot} · <a href="?userId=${encodeURIComponent(uid)}&format=json">JSON</a> · ${MONITOR_NAV}</div>
  <form method="GET" action="/call-monitor/slot-ema-user" style="margin-bottom: 16px;">
    <input name="userId" value="${escapeHtml(uid)}" placeholder="userId" />
    <button type="submit">Показать</button>
  </form>
  <h2>Dialer</h2>
  <pre>${escapeHtml(JSON.stringify(data.dialer, null, 2))}</pre>
  <h2>S2L</h2>
  <pre>${escapeHtml(JSON.stringify(data.s2l, null, 2))}</pre>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Отчёт за 4 недели: изменение звонков по пользователям. В отчёт попадают клиенты,
   * у которых разница между макс. числом звонков за 4 недели и последней неделей > threshold% от последней недели.
   */
  @Get('weekly-change-report')
  async getWeeklyChangeReport(
    @Query('threshold') thresholdParam?: string,
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const thresholdPct = Math.max(0, Math.min(100, parseInt(String(thresholdParam ?? '20'), 10) || 20));
    const data = await this.callMonitorService.getWeeklyChangeReport4Weeks(thresholdPct);

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const weekLabels = data.weekKeys.map((w, i) => (i === 0 ? `${w} (посл.)` : w));
    const row = (
      r: { userId: string; last4Weeks: number[]; max: number; lastWeek: number; diff: number; diffPct: number | null; aboveThreshold: boolean },
    ) =>
      `<tr class="${r.aboveThreshold ? 'above' : ''}"><td>${escapeHtml(r.userId)}</td>${r.last4Weeks.map((n) => `<td>${n}</td>`).join('')}<td>${r.max}</td><td>${r.lastWeek}</td><td>${r.diff}</td><td>${r.diffPct != null ? r.diffPct.toFixed(1) + '%' : '—'}</td><td>${r.aboveThreshold ? 'да' : ''}</td></tr>`;

    const summaryDialer =
      data.aboveThresholdDialer.length > 0
        ? data.aboveThresholdDialer
          .map((r) => `${escapeHtml(r.userId)}: макс ${r.max}, последняя нед. ${r.lastWeek} (−${r.diffPct.toFixed(0)}%)`)
          .join('; ')
        : 'нет';
    const summaryS2l =
      data.aboveThresholdS2l.length > 0
        ? data.aboveThresholdS2l
          .map((r) => `${escapeHtml(r.userId)}: макс ${r.max}, последняя нед. ${r.lastWeek} (−${r.diffPct.toFixed(0)}%)`)
          .join('; ')
        : 'нет';

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Отчёт за 4 недели — изменение по пользователям</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; font-size: 0.9rem; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
    tr.above { background: rgba(220, 80, 80, 0.15); }
    .resume { background: #16213e; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
  </style>
</head>
<body>
  <h1>Отчёт за 4 недели: изменение звонков по пользователям</h1>
  <div class="meta">Недели: ${data.weekKeys.join(' → ')} · порог: разница &gt; ${data.thresholdPct}% от последней недели · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>

  <section>
    <h2>Клиенты с падением ≥${data.thresholdPct}% от последней недели</h2>
    <div class="resume"><strong>Dialer:</strong> ${summaryDialer}</div>
    <div class="resume"><strong>S2L:</strong> ${summaryS2l}</div>
  </section>

  <section>
    <h2>Dialer</h2>
    <table>
      <thead><tr><th>userId</th>${weekLabels.map((w) => `<th>${escapeHtml(w)}</th>`).join('')}<th>Макс</th><th>Посл. нед.</th><th>Разница</th><th>% от последней</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.dialer.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
  <section>
    <h2>S2L</h2>
    <table>
      <thead><tr><th>userId</th>${weekLabels.map((w) => `<th>${escapeHtml(w)}</th>`).join('')}<th>Макс</th><th>Посл. нед.</th><th>Разница</th><th>% от последней</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.s2l.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Отчёт за недели по пользователю: звонков за каждую неделю мониторинга (хранится в БД).
   */
  @Get('weekly-report')
  async getWeeklyReport(
    @Query('userId') userId?: string,
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const uid = String(userId ?? '').trim();
    const data = await this.callMonitorService.getWeeklyReportByUser(uid);

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const table = (rows: Array<{ week: string; total: number; failed: number; lastUpdated: string }>) =>
      rows.length === 0
        ? '<p>Нет данных за недели.</p>'
        : `<table>
      <thead><tr><th>Неделя (пн)</th><th>Всего</th><th>Неуспешных</th><th>Обновлено</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.week)}</td><td>${r.total}</td><td>${r.failed}</td><td>${escapeHtml(r.lastUpdated)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>`;

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Отчёт за недели</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
    input { background: #0f172a; color: #eaeaea; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; width: 280px; }
    button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  </style>
</head>
<body>
  <h1>Отчёт за недели по пользователю</h1>
  <div class="meta">Данные накапливаются при каждом запуске крона (звонки за 60 мин приписываются неделе по дате начала) · <a href="?userId=${encodeURIComponent(uid)}&format=json">JSON</a> · ${MONITOR_NAV}</div>
  <form method="GET" action="/call-monitor/weekly-report" style="margin-bottom: 24px;">
    <input name="userId" value="${escapeHtml(uid)}" placeholder="userId" />
    <button type="submit">Показать</button>
  </form>
  <section>
    <h2>Dialer</h2>
    ${table(data.dialer)}
  </section>
  <section>
    <h2>S2L</h2>
    ${table(data.s2l)}
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  @Get('alerts')
  async getAlerts(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.callMonitorService.getState<Record<string, unknown>>('call_monitor_alerts_snapshot_v1');

    // Если снапшота ещё нет — просто покажем текущие состояния из state по ключам (минимально)
    const dialer = await this.callMonitorService.getState<unknown>('dialer_failrate_alert_state_v1');
    const s2l = await this.callMonitorService.getState<unknown>('s2l_failrate_alert_state_v1');
    const out = { dialer, s2l, snapshot: data ?? null };

    if (format === 'json') {
      res?.type('application/json');
      return out;
    }
    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return out;
    }
    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Call Monitor Alerts</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>Alerts</h1>
  <div class="meta"><a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  <h2>Dialer</h2>
  <pre>${escapeHtml(JSON.stringify(out.dialer, null, 2))}</pre>
  <h2>S2L</h2>
  <pre>${escapeHtml(JSON.stringify(out.s2l, null, 2))}</pre>
</body>
</html>`;
    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Отправить в Telegram отчёт по звонкам за последний 1 час (для теста чата).
   * POST /call-monitor/send-hourly-report-to-telegram
   */
  @Post('send-hourly-report-to-telegram')
  async sendHourlyReportToTelegram(@Res({ passthrough: true }) res?: Response) {
    const sent = await this.callMonitorService.sendHourlyReportToTelegram();
    res?.type('application/json');
    return { sent };
  }

  /**
   * Отправить сводный отчёт в Telegram (отклонения по юзерам, падение за 4 нед.).
   * POST /call-monitor/send-report-to-telegram
   */
  @Post('send-report-to-telegram')
  async sendReportToTelegram(@Res({ passthrough: true }) res?: Response) {
    const sent = await this.callMonitorService.sendReportToTelegram();
    res?.type('application/json');
    return { sent };
  }

  /**
   * Информация по звонкам: статистика Dialer (последние 5 мин) + звонки S2L (последние 5 мин).
   * Параметры: format=json — JSON; иначе HTML для браузера.
   */
  @Get('calls')
  async getCalls(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.callMonitorService.getCallsData();

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }

    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const dialerStr = typeof data.dialer === 'object'
      ? JSON.stringify(data.dialer, null, 2)
      : String(data.dialer ?? '—');
    const s2lStr = typeof data.s2l === 'object'
      ? JSON.stringify(data.s2l, null, 2)
      : String(data.s2l ?? '—');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Мониторинг звонков</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    section h2 { font-size: 1.1rem; color: #a78bfa; margin-bottom: 8px; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.4; }
  </style>
</head>
<body>
  <h1>Мониторинг звонков</h1>
  <div class="meta">Dialer и S2L: последние 5 мин · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  <section>
    <h2>Dialer (статистика)</h2>
    <pre>${escapeHtml(dialerStr)}</pre>
  </section>
  <section>
    <h2>S2L (звонки)</h2>
    <pre>${escapeHtml(s2lStr)}</pre>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Call Success Rate (CSR) — процент успешных звонков за скользящие окна 5/15/60 минут.
   * По каждому типу (Dialer, S2L): разбивка по callStatus и CSR.
   */
  @Get('csr')
  async getCsr(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.callMonitorService.getCsr();

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }

    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CSR — Call Success Rate</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1200px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    section h2 { font-size: 1.1rem; color: #a78bfa; margin-bottom: 8px; }
    pre { background: #16213e; padding: 16px; border-radius: 8px; overflow: auto; font-size: 13px; line-height: 1.4; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
    .csr { font-weight: bold; color: #86efac; }
  </style>
</head>
<body>
  <h1>Call Success Rate (CSR)</h1>
  <div class="meta">Скользящие окна 5 / 15 / 60 мин · по callStatus · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  <section>
    <h2>Dialer</h2>
    <table>
      <thead><tr><th>Окно</th><th>Всего</th><th>Успешных</th><th>CSR %</th><th>Неуспешных</th><th>Неуспешных %</th><th>По статусам</th></tr></thead>
      <tbody>
        ${[5, 15, 60].map((w) => {
          const s = data.dialer[String(w)];
          if (!s) return `<tr><td>${w} мин</td><td colspan="6">—</td></tr>`;
          const byStr = Object.entries(s.byStatus).map(([k, v]) => `${k}: ${v}`).join(', ');
          return `<tr><td>${w} мин</td><td>${s.total}</td><td>${s.successCount}</td><td class="csr">${s.csr}%</td><td>${(s as any).failedCount ?? 0}</td><td>${(s as any).failedPercent ?? 0}%</td><td>${escapeHtml(byStr)}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>
  <section>
    <h2>S2L</h2>
    <table>
      <thead><tr><th>Окно</th><th>Всего</th><th>Успешных</th><th>CSR %</th><th>Неуспешных</th><th>Неуспешных %</th><th>По статусам</th></tr></thead>
      <tbody>
        ${[5, 15, 60].map((w) => {
          const s = data.s2l[String(w)];
          if (!s) return `<tr><td>${w} мин</td><td colspan="6">—</td></tr>`;
          const byStr = Object.entries(s.byStatus).map(([k, v]) => `${k}: ${v}`).join(', ');
          return `<tr><td>${w} мин</td><td>${s.total}</td><td>${s.successCount}</td><td class="csr">${s.csr}%</td><td>${(s as any).failedCount ?? 0}</td><td>${(s as any).failedPercent ?? 0}%</td><td>${escapeHtml(byStr)}</td></tr>`;
        }).join('')}
      </tbody>
    </table>
  </section>
  <section>
    <h2>JSON</h2>
    <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Звонков в единицу времени (в минуту): среднее и отклонение по каждому типу (Dialer, S2L).
   * Данные накапливаются при каждом запуске крона (окно 5 мин).
   */
  @Get('calls-per-min')
  async getCallsPerMin(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const data = await this.callMonitorService.getCallsPerMinStats();

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }

    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatSlot = (slot: number): string => {
      const start = slot * 30;
      const end = (start + 30) % (24 * 60);
      const pad = (n: number) => String(n).padStart(2, '0');
      const sh = Math.floor(start / 60);
      const sm = start % 60;
      const eh = Math.floor(end / 60);
      const em = end % 60;
      return `slot ${slot} (${pad(sh)}:${pad(sm)}–${pad(eh)}:${pad(em)})`;
    };

    const slotInfo = typeof (data as any)?.slot === 'number' ? formatSlot((data as any).slot) : 'slot —';

    const WINDOW_MIN = 5;
    const row = (type: string, s: typeof data.dialer) => {
      const currentInfo = s.currentCount != null ? `${s.currentCount} за ${WINDOW_MIN} мин` : '—';
      const currentRate = s.currentCount != null ? s.currentCount / WINDOW_MIN : null;
      const currentRateStr = currentRate != null ? currentRate.toFixed(2) : '—';
      // Отклонение: положительное — звонков стало больше, отрицательное — меньше (текущий rate − среднее)
      const delta = currentRate != null && typeof s.avg === 'number' ? currentRate - s.avg : null;
      const deltaStr = delta != null ? (delta >= 0 ? `+${delta.toFixed(2)}` : delta.toFixed(2)) : '—';
      return `<tr><td>${escapeHtml(type)}</td><td>${s.avg}</td><td>${currentRateStr}</td><td>${deltaStr}</td><td>${s.n}</td><td>${currentInfo}</td><td>${s.lastUpdated ?? '—'}</td></tr>`;
    };

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Звонков в минуту — среднее и отклонение</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    section h2 { font-size: 1.1rem; color: #a78bfa; margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
    .avg { font-weight: bold; color: #86efac; }
  </style>
</head>
<body>
  <h1>Звонков в минуту (по типу)</h1>
  <div class="meta">${escapeHtml(slotInfo)} · среднее (история по крону для этого слота) и текущий rate за окно 5 мин; отклонение = текущий − среднее (отрицательное — звонков меньше, положительное — больше) · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  <section>
    <table>
      <thead><tr><th>Тип</th><th>Среднее (история)</th><th>Текущий (звонков/мин)</th><th>Отклонение</th><th>Измерений (n)</th><th>Текущее за окно</th><th>Обновлено</th></tr></thead>
      <tbody>
        ${row('Dialer', data.dialer)}
        ${row('S2L', data.s2l)}
      </tbody>
    </table>
  </section>
  <section>
    <h2>JSON</h2>
    <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  /**
   * Неуспешных звонков в минуту: среднее и отклонение по окнам 5/15/60 и по типам (all, outgoing_missed, no_answer, failed).
   * ?refresh=1 — перед ответом один раз обновить статистику из API (если крон выключен).
   */
  @Get('unsuccess-per-min')
  async getUnsuccessPerMin(
    @Query('format') format?: string,
    @Query('refresh') refresh?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (refresh === '1' || refresh === 'true') {
      await this.callMonitorService.run();
    }
    const data = await this.callMonitorService.getUnsuccessPerMinStats();

    if (format === 'json') {
      res?.type('application/json');
      return data;
    }

    const acceptHeader = req?.headers?.accept || '';
    if (acceptHeader.includes('application/json')) {
      res?.type('application/json');
      return data;
    }

    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const formatSlot = (slot: number): string => {
      const start = slot * 30;
      const end = (start + 30) % (24 * 60);
      const pad = (n: number) => String(n).padStart(2, '0');
      const sh = Math.floor(start / 60);
      const sm = start % 60;
      const eh = Math.floor(end / 60);
      const em = end % 60;
      return `slot ${slot} (${pad(sh)}:${pad(sm)}–${pad(eh)}:${pad(em)})`;
    };
    const slotInfo = typeof (data as any)?.slot === 'number' ? formatSlot((data as any).slot) : 'slot —';

    const types = ['all', 'outgoing_missed', 'no_answer', 'failed'];
    const typeLabels: Record<string, string> = {
      all: 'Все неуспешные',
      outgoing_missed: 'Outgoing missed',
      no_answer: 'No answer',
      failed: 'Failed',
    };

    const row = (source: 'dialer' | 's2l', win: string, t: string) => {
      const s = data[source][win]?.[t];
      if (!s) return '';
      const winNum = parseInt(win, 10) || 1;
      const currentInfo = s.currentCount != null ? `${s.currentCount} за ${winNum} мин` : '—';
      return `<tr><td>${escapeHtml(typeLabels[t] ?? t)}</td><td>${s.avg}</td><td>${s.deviation}</td><td>${s.n}</td><td>${currentInfo}</td><td>${s.lastUpdated ?? '—'}</td></tr>`;
    };

    const section = (title: string, source: 'dialer' | 's2l') => `
  <section>
    <h2>${escapeHtml(title)}</h2>
    ${[5, 15, 60].map((w) => `
    <h3>Окно ${w} мин</h3>
    <table>
      <thead><tr><th>Тип</th><th>Среднее (неуспешных/мин)</th><th>Отклонение</th><th>n</th><th>Текущее за окно</th><th>Обновлено</th></tr></thead>
      <tbody>${types.map((t) => row(source, String(w), t)).join('')}</tbody>
    </table>
    `).join('')}
  </section>`;

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Неуспешных в минуту</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1000px; margin: 0 auto; }
    h1 { font-size: 1.5rem; margin-bottom: 8px; }
    h3 { font-size: 1rem; color: #a78bfa; margin: 16px 0 8px; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
    section { margin-bottom: 24px; }
    section h2 { font-size: 1.1rem; color: #a78bfa; margin-bottom: 8px; }
    table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
    th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
    th { background: #16213e; color: #a78bfa; }
  </style>
</head>
<body>
  <h1>Неуспешных звонков в минуту</h1>
  <div class="meta">${escapeHtml(slotInfo)} · среднее и отклонение по окнам 5/15/60 для этого слота; при отсутствии сохранённой истории среднее и «текущее за окно» считаются по данным API (отклонение = 0) · <a href="?refresh=1">Обновить из API</a> · <a href="?format=json">JSON</a> · ${MONITOR_NAV}</div>
  ${section('Dialer', 'dialer')}
  ${section('S2L', 's2l')}
  <section>
    <h2>JSON</h2>
    <pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }
}
