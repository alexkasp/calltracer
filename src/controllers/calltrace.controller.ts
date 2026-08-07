import { Controller, Get, Param, Query, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { CalltraceService } from '../services/calltrace.service';
import { renderSiteHeader } from '../utils/site-header';
import { renderLoadingShell } from '../utils/loading-shell';
import { resolveLang } from '../i18n/lang';
import { t } from '../i18n/translate';

@Controller('calltrace')
export class CalltraceController {
  constructor(private readonly calltraceService: CalltraceService) {}

  @Get(':id')
  async getCallTrace(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Query('_async') asyncFlag?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const lang = resolveLang(req);

    // API-клиенты (curl/агенты без JS) шлют Accept: application/json и не могут выполнить
    // fetch+document.write из loading-shell — раньше эта проверка стояла ниже, ПОСЛЕ отдачи
    // HTML-заглушки, и поэтому никогда не срабатывала: такой клиент получал заглушку с прогресс-
    // баром вместо данных и не мог их прочитать.
    const acceptHeader = req?.headers?.accept || '';
    const isApiRequest =
      format === 'json' || acceptHeader.includes('application/json');

    // Разбор лога (VoIPmonitor/SBCtelco) может занимать несколько секунд — сначала отдаём
    // лёгкую заглушку с прогресс-баром, реальный HTML подгружается через fetch (см. loading-shell.ts).
    // Только для браузерной навигации — API-клиентов с этим сразу пропускаем к данным.
    if (!format && !asyncFlag && !isApiRequest) {
      res?.type('text/html; charset=utf-8');
      const currentUrl =
        req?.originalUrl || `/calltrace/${encodeURIComponent(id)}`;
      const sep = currentUrl.includes('?') ? '&' : '?';
      return renderLoadingShell(
        lang,
        currentUrl,
        `${currentUrl}${sep}_async=1`,
      );
    }

    const result = await this.calltraceService.getCallTrace(id);
    const data: any = result?.data ?? {};

    // Если явно запрошен JSON формат
    if (isApiRequest) {
      res?.type('application/json');
      return result;
    }

    // Если явно запрошен текстовый формат
    if (format === 'text') {
      const parts: string[] = [];
      parts.push(`callId: ${result?.callId ?? ''}`);
      parts.push(`callType: ${result?.callType ?? ''}`);

      if (typeof data?.events === 'string' && data.events.trim()) {
        parts.push('');
        parts.push(data.events);
      }
      if (typeof data?.log === 'string' && data.log.trim()) {
        parts.push('');
        parts.push(data.log);
      }

      res?.type('text/plain; charset=utf-8');
      return parts.join('\n');
    }

    // HTML форматирование для браузера
    const escapeHtml = (text: string): string => {
      return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    };

    const formatText = (text: string): string => {
      return escapeHtml(text)
        .replace(/\n/g, '<br>')
        .replace(
          /--- ([^-]+) ---/g,
          '<strong style="color: #2563eb;">--- $1 ---</strong>',
        )
        .replace(
          /(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/g,
          '<span style="color: #059669;">$1</span>',
        )
        .replace(
          /(Event: [^|]+)/g,
          '<span style="color: #dc2626; font-weight: bold;">$1</span>',
        )
        .replace(
          /(sipCallId: [^\s|]+)/g,
          '<span style="color: #7c3aed;">$1</span>',
        )
        .replace(/(ID: \d+)/g, '<span style="color: #ea580c;">$1</span>')
        .replace(
          /(From: [^->]+ -> To: [^\n]+)/g,
          '<span style="color: #0891b2;">$1</span>',
        );
    };

    let html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Call Trace: ${escapeHtml(result?.callId || '')}</title>
  <style>
    body {
      font-family: 'Monaco', 'Menlo', 'Ubuntu Mono', 'Consolas', 'source-code-pro', monospace;
      font-size: 13px;
      line-height: 1.6;
      max-width: 1400px;
      margin: 0 auto;
      padding: 20px;
      background-color: #1e1e1e;
      color: #d4d4d4;
    }
    .header {
      background-color: #2d2d2d;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 20px;
      border-left: 4px solid #2563eb;
    }
    .header h1 {
      margin: 0 0 10px 0;
      color: #ffffff;
      font-size: 18px;
    }
    .header-info {
      color: #a0a0a0;
      font-size: 12px;
    }
    .section {
      background-color: #252526;
      padding: 15px;
      border-radius: 5px;
      margin-bottom: 15px;
      border-left: 4px solid #059669;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .section-title {
      color: #4ade80;
      font-weight: bold;
      margin-bottom: 10px;
      font-size: 14px;
      text-transform: uppercase;
    }
    .content {
      color: #d4d4d4;
    }
    a {
      color: #60a5fa;
      text-decoration: none;
    }
    a:hover {
      text-decoration: underline;
    }
  </style>
</head>
<body>
  ${renderSiteHeader(lang, req?.originalUrl || '/')}
  <div class="header">
    <h1>${t(lang, 'calltrace.title')}</h1>
    <div class="header-info">
      <strong>${t(lang, 'calltrace.callId')}</strong> ${escapeHtml(result?.callId || '')}<br>
      <strong>${t(lang, 'calltrace.callType')}</strong> ${escapeHtml(result?.callType || t(lang, 'calltrace.unknown'))}<br>
      ${data?.sipCallId ? `<strong>${t(lang, 'calltrace.sipCallId')}</strong> ${escapeHtml(data.sipCallId)}<br>` : ''}
      <strong>${t(lang, 'calltrace.format')}</strong> <a href="?format=json">JSON</a> | <a href="?format=text">Text</a>
    </div>
  </div>`;

    if (typeof data?.events === 'string' && data.events.trim()) {
      html += `
  <div class="section">
    <div class="section-title">${t(lang, 'calltrace.events')}</div>
    <div class="content">${formatText(data.events)}</div>
  </div>`;
    }

    if (typeof data?.log === 'string' && data.log.trim()) {
      html += `
  <div class="section">
    <div class="section-title">${t(lang, 'calltrace.log')}</div>
    <div class="content">${formatText(data.log)}</div>
  </div>`;
    }

    html += `
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }
}
