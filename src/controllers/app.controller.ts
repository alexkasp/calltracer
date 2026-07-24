import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveLang } from '../i18n/lang';
import { t } from '../i18n/translate';
import { renderSiteHeader } from '../utils/site-header';

@Controller()
export class AppController {
  @Get()
  home(@Req() req?: Request, @Res({ passthrough: true }) res?: Response) {
    const lang = resolveLang(req);
    const today = new Date().toISOString().slice(0, 10);

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CallTracer</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 900px; margin: 0 auto; }
    h1 { font-size: 1.6rem; margin: 0; }
    .meta { color: #888; font-size: 0.9rem; margin-bottom: 28px; }
    a { color: #7c3aed; text-decoration: none; }
    a:hover { text-decoration: underline; }
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
  ${renderSiteHeader(lang, req?.originalUrl || '/')}
  <div class="meta">${t(lang, 'home.tagline')}</div>

  <div class="card">
    <h2>${t(lang, 'home.recording.title')}</h2>
    <p>${t(lang, 'home.recording.description', { example: '<code>1784891602.0026156</code>' })}</p>
    <form class="inline" method="GET" action="/call-recording/player">
      <input type="text" name="callid" placeholder="${t(lang, 'home.recording.placeholder')}" required />
      <button type="submit">${t(lang, 'common.open')}</button>
    </form>
  </div>

  <div class="card">
    <h2>${t(lang, 'home.trace.title')}</h2>
    <p>${t(lang, 'home.trace.description', { format: '<code>X.Y</code>' })}</p>
    <form class="inline" method="GET" action="#" onsubmit="window.location.href = '/calltrace/' + encodeURIComponent(this.callId.value); return false;">
      <input type="text" name="callId" placeholder="${t(lang, 'home.trace.placeholder')}" required />
      <button type="submit">${t(lang, 'common.open')}</button>
    </form>
  </div>

  <div class="card">
    <h2>${t(lang, 'home.monitor.title')}</h2>
    <p>${t(lang, 'home.monitor.description')}</p>
    <div class="links">
      <a href="/call-monitor/calls">${t(lang, 'home.monitor.calls')}</a>
      <a href="/call-monitor/csr">CSR</a>
      <a href="/call-monitor/calls-per-min">${t(lang, 'home.monitor.callsPerMin')}</a>
      <a href="/call-monitor/unsuccess-per-min">${t(lang, 'home.monitor.unsuccessPerMin')}</a>
      <a href="/call-monitor/deviation-summary">${t(lang, 'home.monitor.deviation')}</a>
      <a href="/call-monitor/alerts">Alerts</a>
    </div>
  </div>

  <div class="card">
    <h2>${t(lang, 'home.sbctelco.title')}</h2>
    <p>${t(lang, 'home.sbctelco.description', { callTrace: '<code>call_trace</code>', sbctrace: '<code>sbctrace</code>' })}</p>
    <div class="links">
      <a href="/sbctelco/call_trace">${t(lang, 'home.sbctelco.activeCalls')}</a>
    </div>
    <p style="margin-top: -4px;">${t(lang, 'home.sbctelco.searchHint', { url: '<code>/sbctelco/sbctrace/search?calling=...&amp;called=...</code>' })}</p>
  </div>

  <div class="card">
    <h2>${t(lang, 'home.voipmonitor.title')}</h2>
    <p>${t(lang, 'home.voipmonitor.description', { fdatefrom: '<code>fdatefrom</code>', fcaller: '<code>fcaller</code>', fcalled: '<code>fcalled</code>', fcallid: '<code>fcallid</code>', fcallerdType: '<code>fcallerd_type=1</code>' })}</p>
    <div class="links">
      <a href="/voipmonitor/calls?fdatefrom=${today}+00:00:00&limit=10">${t(lang, 'home.voipmonitor.todayCalls')}</a>
    </div>
  </div>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }
}
