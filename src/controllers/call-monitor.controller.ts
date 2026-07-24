import { Controller, Get, Post, Query, Req, Res } from '@nestjs/common';
import type { Response, Request } from 'express';
import { CallMonitorService } from '../services/call-monitor.service';
import { renderSiteHeader } from '../utils/site-header';
import { resolveLang, type Lang } from '../i18n/lang';
import { t } from '../i18n/translate';

/** Общая навигация по разделам мониторинга (для шапки всех HTML-страниц). */
function monitorNav(lang: Lang): string {
  return (
    `<a href="/call-monitor/calls">${t(lang, 'monitor.nav.calls')}</a> · ` +
    `<a href="/call-monitor/csr">${t(lang, 'monitor.nav.csr')}</a> · ` +
    `<a href="/call-monitor/calls-per-min">${t(lang, 'monitor.nav.callsPerMin')}</a> · ` +
    `<a href="/call-monitor/unsuccess-per-min">${t(lang, 'monitor.nav.unsuccessPerMin')}</a> · ` +
    `<a href="/call-monitor/deviation-summary">${t(lang, 'monitor.nav.deviation')}</a> · ` +
    `<a href="/call-monitor/weekly-report">${t(lang, 'monitor.nav.weeklyReport')}</a> · ` +
    `<a href="/call-monitor/weekly-change-report">${t(lang, 'monitor.nav.weeklyChange')}</a> · ` +
    `<a href="/call-monitor/slot-ema">${t(lang, 'monitor.nav.slotEma')}</a> · ` +
    `<a href="/call-monitor/slot-ema-user">${t(lang, 'monitor.nav.slotEmaUser')}</a> · ` +
    `<a href="/call-monitor/alerts">${t(lang, 'monitor.nav.alerts')}</a>`
  );
}

@Controller('call-monitor')
export class CallMonitorController {
  constructor(private readonly callMonitorService: CallMonitorService) {}

  @Get('slot-ema')
  async getSlotEma(
    @Query('format') format?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const lang = resolveLang(req);
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
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.slotEma.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/slot-ema')}
  <h1>${t(lang, 'monitor.slotEma.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.currentSlot', { slot: data.slot })} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  <h2>${t(lang, 'monitor.dialer')}</h2>
  <pre>${escapeHtml(JSON.stringify(data.dialer, null, 2))}</pre>
  <h2>${t(lang, 'monitor.s2l')}</h2>
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
    const lang = resolveLang(req);
    const thresholdPct = Math.max(
      0,
      Math.min(100, parseInt(String(thresholdParam ?? '20'), 10) || 20),
    );
    const data =
      await this.callMonitorService.getDeviationSummary(thresholdPct);

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

    const row = (r: {
      userId: string;
      currentTotal: number;
      currentFailed: number;
      currentFailRate: number;
      avgFailRate: number | null;
      deviationPct: number | null;
      aboveThreshold: boolean;
    }) =>
      `<tr class="${r.aboveThreshold ? 'above' : ''}"><td>${escapeHtml(r.userId)}</td><td>${r.currentTotal}</td><td>${r.currentFailed}</td><td>${(r.currentFailRate * 100).toFixed(1)}%</td><td>${r.avgFailRate != null ? (r.avgFailRate * 100).toFixed(1) + '%' : '—'}</td><td>${r.deviationPct != null ? (r.deviationPct >= 0 ? '+' : '') + r.deviationPct.toFixed(1) + ' п.п.' : '—'}</td><td>${r.aboveThreshold ? t(lang, 'monitor.yes') : ''}</td></tr>`;

    const summaryDialer =
      data.aboveThresholdDialer.length > 0
        ? data.aboveThresholdDialer
            .map((r) =>
              t(lang, 'monitor.deviation.summaryItem', {
                user: escapeHtml(r.userId),
                pct: r.deviationPct.toFixed(1),
                cur: (r.currentFailRate * 100).toFixed(1),
                avg: (r.avgFailRate * 100).toFixed(1),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');
    const summaryS2l =
      data.aboveThresholdS2l.length > 0
        ? data.aboveThresholdS2l
            .map((r) =>
              t(lang, 'monitor.deviation.summaryItem', {
                user: escapeHtml(r.userId),
                pct: r.deviationPct.toFixed(1),
                cur: (r.currentFailRate * 100).toFixed(1),
                avg: (r.avgFailRate * 100).toFixed(1),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');

    const noCallsDialerStr =
      data.noCallsIn5MinDialer.length > 0
        ? data.noCallsIn5MinDialer
            .map((r) =>
              t(lang, 'monitor.deviation.noCallsItem', {
                user: escapeHtml(r.userId),
                avg: r.avgTotal.toFixed(1),
                pct: (r.avgFailRate * 100).toFixed(1),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');
    const noCallsS2lStr =
      data.noCallsIn5MinS2l.length > 0
        ? data.noCallsIn5MinS2l
            .map((r) =>
              t(lang, 'monitor.deviation.noCallsItem', {
                user: escapeHtml(r.userId),
                avg: r.avgTotal.toFixed(1),
                pct: (r.avgFailRate * 100).toFixed(1),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.deviation.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/deviation-summary')}
  <h1>${t(lang, 'monitor.deviation.h1', { pct: data.thresholdPct })}</h1>
  <div class="meta">${t(lang, 'monitor.deviation.metaLine', { slot: data.slot, win: data.windowMinutes, pct: data.thresholdPct })} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>

  <section>
    <h2>${t(lang, 'monitor.deviation.usersAboveTitle', { pct: data.thresholdPct })}</h2>
    <div class="resume"><strong>${t(lang, 'monitor.dialer')}:</strong> ${summaryDialer}</div>
    <div class="resume"><strong>${t(lang, 'monitor.s2l')}:</strong> ${summaryS2l}</div>
  </section>

  <section>
    <h2>${t(lang, 'monitor.deviation.noCallsTitle')}</h2>
    <p class="meta">${t(lang, 'monitor.deviation.noCallsDesc')}</p>
    <div class="resume"><strong>${t(lang, 'monitor.dialer')}:</strong> ${noCallsDialerStr}</div>
    <div class="resume"><strong>${t(lang, 'monitor.s2l')}:</strong> ${noCallsS2lStr}</div>
  </section>

  <section>
    <h2>${t(lang, 'monitor.deviation.allUsersTitle', { type: t(lang, 'monitor.dialer'), win: data.windowMinutes })}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.userId')}</th><th>${t(lang, 'monitor.col.calls')}</th><th>${t(lang, 'monitor.col.failed')}</th><th>${t(lang, 'monitor.col.currentFailPct')}</th><th>${t(lang, 'monitor.col.slotNorm')}</th><th>${t(lang, 'monitor.col.deviationPP')}</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.dialer.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
  <section>
    <h2>${t(lang, 'monitor.deviation.allUsersTitle', { type: t(lang, 'monitor.s2l'), win: data.windowMinutes })}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.userId')}</th><th>${t(lang, 'monitor.col.calls')}</th><th>${t(lang, 'monitor.col.failed')}</th><th>${t(lang, 'monitor.col.currentFailPct')}</th><th>${t(lang, 'monitor.col.slotNorm')}</th><th>${t(lang, 'monitor.col.deviationPP')}</th><th>≥${data.thresholdPct}%</th></tr></thead>
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
    const lang = resolveLang(req);
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
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.slotEmaUser.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/slot-ema-user')}
  <h1>${t(lang, 'monitor.slotEmaUser.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.currentSlot', { slot: data.slot })} · <a href="?userId=${encodeURIComponent(uid)}&format=json">JSON</a> · ${monitorNav(lang)}</div>
  <form method="GET" action="/call-monitor/slot-ema-user" style="margin-bottom: 16px;">
    <input name="userId" value="${escapeHtml(uid)}" placeholder="userId" />
    <button type="submit">${t(lang, 'monitor.showBtn')}</button>
  </form>
  <h2>${t(lang, 'monitor.dialer')}</h2>
  <pre>${escapeHtml(JSON.stringify(data.dialer, null, 2))}</pre>
  <h2>${t(lang, 'monitor.s2l')}</h2>
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
    const lang = resolveLang(req);
    const thresholdPct = Math.max(
      0,
      Math.min(100, parseInt(String(thresholdParam ?? '20'), 10) || 20),
    );
    const data =
      await this.callMonitorService.getWeeklyChangeReport4Weeks(thresholdPct);

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

    const weekLabels = data.weekKeys.map((w, i) =>
      i === 0 ? `${w}${t(lang, 'monitor.weeklyChange.lastWeekSuffix')}` : w,
    );
    const row = (r: {
      userId: string;
      last4Weeks: number[];
      max: number;
      lastWeek: number;
      diff: number;
      diffPct: number | null;
      aboveThreshold: boolean;
    }) =>
      `<tr class="${r.aboveThreshold ? 'above' : ''}"><td>${escapeHtml(r.userId)}</td>${r.last4Weeks.map((n) => `<td>${n}</td>`).join('')}<td>${r.max}</td><td>${r.lastWeek}</td><td>${r.diff}</td><td>${r.diffPct != null ? r.diffPct.toFixed(1) + '%' : '—'}</td><td>${r.aboveThreshold ? t(lang, 'monitor.yes') : ''}</td></tr>`;

    const summaryDialer =
      data.aboveThresholdDialer.length > 0
        ? data.aboveThresholdDialer
            .map((r) =>
              t(lang, 'monitor.weeklyChange.summaryItem', {
                user: escapeHtml(r.userId),
                max: r.max,
                week: r.lastWeek,
                pct: r.diffPct.toFixed(0),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');
    const summaryS2l =
      data.aboveThresholdS2l.length > 0
        ? data.aboveThresholdS2l
            .map((r) =>
              t(lang, 'monitor.weeklyChange.summaryItem', {
                user: escapeHtml(r.userId),
                max: r.max,
                week: r.lastWeek,
                pct: r.diffPct.toFixed(0),
              }),
            )
            .join('; ')
        : t(lang, 'monitor.none');

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.weeklyChange.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/weekly-change-report')}
  <h1>${t(lang, 'monitor.weeklyChange.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.weeklyChange.metaLine', { weeks: data.weekKeys.join(' → '), pct: data.thresholdPct })} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>

  <section>
    <h2>${t(lang, 'monitor.weeklyChange.dropTitle', { pct: data.thresholdPct })}</h2>
    <div class="resume"><strong>${t(lang, 'monitor.dialer')}:</strong> ${summaryDialer}</div>
    <div class="resume"><strong>${t(lang, 'monitor.s2l')}:</strong> ${summaryS2l}</div>
  </section>

  <section>
    <h2>${t(lang, 'monitor.dialer')}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.userId')}</th>${weekLabels.map((w) => `<th>${escapeHtml(w)}</th>`).join('')}<th>${t(lang, 'monitor.col.max')}</th><th>${t(lang, 'monitor.col.lastWeek')}</th><th>${t(lang, 'monitor.col.diff')}</th><th>${t(lang, 'monitor.col.diffPctOfLast')}</th><th>≥${data.thresholdPct}%</th></tr></thead>
      <tbody>${data.dialer.map((r) => row(r)).join('')}</tbody>
    </table>
  </section>
  <section>
    <h2>${t(lang, 'monitor.s2l')}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.userId')}</th>${weekLabels.map((w) => `<th>${escapeHtml(w)}</th>`).join('')}<th>${t(lang, 'monitor.col.max')}</th><th>${t(lang, 'monitor.col.lastWeek')}</th><th>${t(lang, 'monitor.col.diff')}</th><th>${t(lang, 'monitor.col.diffPctOfLast')}</th><th>≥${data.thresholdPct}%</th></tr></thead>
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
    const lang = resolveLang(req);
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

    const table = (
      rows: Array<{
        week: string;
        total: number;
        failed: number;
        lastUpdated: string;
      }>,
    ) =>
      rows.length === 0
        ? `<p>${t(lang, 'monitor.weeklyReport.noData')}</p>`
        : `<table>
      <thead><tr><th>${t(lang, 'monitor.col.week')}</th><th>${t(lang, 'monitor.col.total')}</th><th>${t(lang, 'monitor.col.failed')}</th><th>${t(lang, 'monitor.col.updated')}</th></tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><td>${escapeHtml(r.week)}</td><td>${r.total}</td><td>${r.failed}</td><td>${escapeHtml(r.lastUpdated)}</td></tr>`,
        )
        .join('')}</tbody>
    </table>`;

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.weeklyReport.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/weekly-report')}
  <h1>${t(lang, 'monitor.weeklyReport.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.weeklyReport.desc')} · <a href="?userId=${encodeURIComponent(uid)}&format=json">JSON</a> · ${monitorNav(lang)}</div>
  <form method="GET" action="/call-monitor/weekly-report" style="margin-bottom: 24px;">
    <input name="userId" value="${escapeHtml(uid)}" placeholder="userId" />
    <button type="submit">${t(lang, 'monitor.showBtn')}</button>
  </form>
  <section>
    <h2>${t(lang, 'monitor.dialer')}</h2>
    ${table(data.dialer)}
  </section>
  <section>
    <h2>${t(lang, 'monitor.s2l')}</h2>
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
    const lang = resolveLang(req);
    const data = await this.callMonitorService.getState<
      Record<string, unknown>
    >('call_monitor_alerts_snapshot_v1');

    // Если снапшота ещё нет — просто покажем текущие состояния из state по ключам (минимально)
    const dialer = await this.callMonitorService.getState<unknown>(
      'dialer_failrate_alert_state_v1',
    );
    const s2l = await this.callMonitorService.getState<unknown>(
      's2l_failrate_alert_state_v1',
    );
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
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.alerts.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/alerts')}
  <h1>${t(lang, 'monitor.alerts.h1')}</h1>
  <div class="meta"><a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  <h2>${t(lang, 'monitor.dialer')}</h2>
  <pre>${escapeHtml(JSON.stringify(out.dialer, null, 2))}</pre>
  <h2>${t(lang, 'monitor.s2l')}</h2>
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
    const lang = resolveLang(req);
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

    const dialerStr =
      typeof data.dialer === 'object'
        ? JSON.stringify(data.dialer, null, 2)
        : String(data.dialer ?? '—');
    const s2lStr =
      typeof data.s2l === 'object'
        ? JSON.stringify(data.s2l, null, 2)
        : String(data.s2l ?? '—');

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.calls.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/calls')}
  <h1>${t(lang, 'monitor.calls.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.calls.metaLine')} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  <section>
    <h2>${t(lang, 'monitor.calls.dialerStatsTitle')}</h2>
    <pre>${escapeHtml(dialerStr)}</pre>
  </section>
  <section>
    <h2>${t(lang, 'monitor.calls.s2lCallsTitle')}</h2>
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
    const lang = resolveLang(req);
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
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.csr.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/csr')}
  <h1>${t(lang, 'monitor.csr.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.csr.metaLine')} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  <section>
    <h2>${t(lang, 'monitor.dialer')}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.window')}</th><th>${t(lang, 'monitor.col.total')}</th><th>${t(lang, 'monitor.col.successful')}</th><th>CSR %</th><th>${t(lang, 'monitor.col.failed')}</th><th>${t(lang, 'monitor.col.failedPct')}</th><th>${t(lang, 'monitor.col.byStatus')}</th></tr></thead>
      <tbody>
        ${[5, 15, 60]
          .map((w) => {
            const s = data.dialer[String(w)];
            if (!s)
              return `<tr><td>${w} ${t(lang, 'monitor.min')}</td><td colspan="6">—</td></tr>`;
            const byStr = Object.entries(s.byStatus)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            return `<tr><td>${w} ${t(lang, 'monitor.min')}</td><td>${s.total}</td><td>${s.successCount}</td><td class="csr">${s.csr}%</td><td>${(s as any).failedCount ?? 0}</td><td>${(s as any).failedPercent ?? 0}%</td><td>${escapeHtml(byStr)}</td></tr>`;
          })
          .join('')}
      </tbody>
    </table>
  </section>
  <section>
    <h2>${t(lang, 'monitor.s2l')}</h2>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.window')}</th><th>${t(lang, 'monitor.col.total')}</th><th>${t(lang, 'monitor.col.successful')}</th><th>CSR %</th><th>${t(lang, 'monitor.col.failed')}</th><th>${t(lang, 'monitor.col.failedPct')}</th><th>${t(lang, 'monitor.col.byStatus')}</th></tr></thead>
      <tbody>
        ${[5, 15, 60]
          .map((w) => {
            const s = data.s2l[String(w)];
            if (!s)
              return `<tr><td>${w} ${t(lang, 'monitor.min')}</td><td colspan="6">—</td></tr>`;
            const byStr = Object.entries(s.byStatus)
              .map(([k, v]) => `${k}: ${v}`)
              .join(', ');
            return `<tr><td>${w} ${t(lang, 'monitor.min')}</td><td>${s.total}</td><td>${s.successCount}</td><td class="csr">${s.csr}%</td><td>${(s as any).failedCount ?? 0}</td><td>${(s as any).failedPercent ?? 0}%</td><td>${escapeHtml(byStr)}</td></tr>`;
          })
          .join('')}
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
    const lang = resolveLang(req);
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

    const slotInfo =
      typeof (data as any)?.slot === 'number'
        ? formatSlot((data as any).slot)
        : t(lang, 'monitor.slotFallback');

    const WINDOW_MIN = 5;
    const row = (type: string, s: typeof data.dialer) => {
      const currentInfo =
        s.currentCount != null
          ? t(lang, 'monitor.forMinutes', {
              n: s.currentCount,
              win: WINDOW_MIN,
            })
          : '—';
      const currentRate =
        s.currentCount != null ? s.currentCount / WINDOW_MIN : null;
      const currentRateStr = currentRate != null ? currentRate.toFixed(2) : '—';
      // Отклонение: положительное — звонков стало больше, отрицательное — меньше (текущий rate − среднее)
      const delta =
        currentRate != null && typeof s.avg === 'number'
          ? currentRate - s.avg
          : null;
      const deltaStr =
        delta != null
          ? delta >= 0
            ? `+${delta.toFixed(2)}`
            : delta.toFixed(2)
          : '—';
      return `<tr><td>${escapeHtml(type)}</td><td>${s.avg}</td><td>${currentRateStr}</td><td>${deltaStr}</td><td>${s.n}</td><td>${currentInfo}</td><td>${s.lastUpdated ?? '—'}</td></tr>`;
    };

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.callsPerMin.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/calls-per-min')}
  <h1>${t(lang, 'monitor.callsPerMin.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.callsPerMin.metaLine', { slotInfo: escapeHtml(slotInfo) })} · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  <section>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.type')}</th><th>${t(lang, 'monitor.col.avgHistory')}</th><th>${t(lang, 'monitor.col.currentRate')}</th><th>${t(lang, 'monitor.col.deviation')}</th><th>${t(lang, 'monitor.col.measurements')}</th><th>${t(lang, 'monitor.col.currentWindow')}</th><th>${t(lang, 'monitor.col.updated')}</th></tr></thead>
      <tbody>
        ${row(t(lang, 'monitor.dialer'), data.dialer)}
        ${row(t(lang, 'monitor.s2l'), data.s2l)}
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
    const lang = resolveLang(req);
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
    const slotInfo =
      typeof (data as any)?.slot === 'number'
        ? formatSlot((data as any).slot)
        : t(lang, 'monitor.slotFallback');

    const types = ['all', 'outgoing_missed', 'no_answer', 'failed'];
    const typeLabels: Record<string, string> = {
      all: t(lang, 'monitor.typeAll'),
      outgoing_missed: t(lang, 'monitor.typeOutgoingMissed'),
      no_answer: t(lang, 'monitor.typeNoAnswer'),
      failed: t(lang, 'monitor.typeFailed'),
    };

    const row = (source: 'dialer' | 's2l', win: string, ty: string) => {
      const s = data[source][win]?.[ty];
      if (!s) return '';
      const winNum = parseInt(win, 10) || 1;
      const currentInfo =
        s.currentCount != null
          ? t(lang, 'monitor.forMinutes', { n: s.currentCount, win: winNum })
          : '—';
      return `<tr><td>${escapeHtml(typeLabels[ty] ?? ty)}</td><td>${s.avg}</td><td>${s.deviation}</td><td>${s.n}</td><td>${currentInfo}</td><td>${s.lastUpdated ?? '—'}</td></tr>`;
    };

    const section = (title: string, source: 'dialer' | 's2l') => `
  <section>
    <h2>${escapeHtml(title)}</h2>
    ${[5, 15, 60]
      .map(
        (w) => `
    <h3>${t(lang, 'monitor.windowMinutes', { w })}</h3>
    <table>
      <thead><tr><th>${t(lang, 'monitor.col.type')}</th><th>${t(lang, 'monitor.col.avgFailedPerMin')}</th><th>${t(lang, 'monitor.col.deviation')}</th><th>n</th><th>${t(lang, 'monitor.col.currentWindow')}</th><th>${t(lang, 'monitor.col.updated')}</th></tr></thead>
      <tbody>${types.map((ty) => row(source, String(w), ty)).join('')}</tbody>
    </table>
    `,
      )
      .join('')}
  </section>`;

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'monitor.unsuccessPerMin.title')}</title>
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
  ${renderSiteHeader(lang, req?.originalUrl || '/call-monitor/unsuccess-per-min')}
  <h1>${t(lang, 'monitor.unsuccessPerMin.h1')}</h1>
  <div class="meta">${t(lang, 'monitor.unsuccessPerMin.metaLine', { slotInfo: escapeHtml(slotInfo) })} · <a href="?refresh=1">${t(lang, 'monitor.refreshFromApi')}</a> · <a href="?format=json">JSON</a> · ${monitorNav(lang)}</div>
  ${section(t(lang, 'monitor.dialer'), 'dialer')}
  ${section(t(lang, 'monitor.s2l'), 's2l')}
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
