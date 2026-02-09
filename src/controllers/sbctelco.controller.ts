import { Controller, Get, Query, Res, Req, Param } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SbctelcoService } from '../services/sbctelco.service';

@Controller('sbctelco')
export class SbctelcoController {
  constructor(private readonly sbctelcoService: SbctelcoService) {}

  /**
   * Запросить у SBCtelco звонки за последние 2 минуты (параметр start), сохранить в БД только новые (по id) и вернуть отчёт.
   * saved и ids — только реально добавленные записи, не все полученные по запросу.
   */
  @Get('fetch-and-save')
  async fetchAndSave() {
    const { added, ids } = await this.sbctelcoService.fetchAndSaveNewCallsFromLastTwoMinutes();
    return {
      message: 'Сохранено в БД sbclogs.sbctrace (звонки за последние 2 минуты)',
      saved: added,
      ids,
    };
  }

  /**
   * Поиск звонков в sbctrace по calling (caller), called и/или timestamp.
   * Параметры (все опциональны, можно один или несколько): calling, called, timestamp_after, timestamp_before, limit.
   * timestamp_after / timestamp_before — YYYY-MM-DD или YYYY-MM-DD HH:MM:SS (UTC).
   * По умолчанию — текст (как formatCallTraceText); format=json — JSON.
   */
  @Get('sbctrace/search')
  async searchSbctrace(
    @Query('calling') calling?: string,
    @Query('called') called?: string,
    @Query('timestamp_after') timestamp_after?: string,
    @Query('timestamp_before') timestamp_before?: string,
    @Query('limit') limit?: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const hasFilter =
      (calling != null && calling.trim() !== '') ||
      (called != null && called.trim() !== '') ||
      (timestamp_after != null && timestamp_after.trim() !== '') ||
      (timestamp_before != null && timestamp_before.trim() !== '');
    if (!hasFilter) {
      return {
        statusCode: 400,
        message: 'Укажите хотя бы один фильтр: calling, called, timestamp_after или timestamp_before',
      };
    }
    const limitNum = limit ? parseInt(limit, 10) : undefined;
    const items = await this.sbctelcoService.findCalls({
      calling,
      called,
      timestamp_after,
      timestamp_before,
      limit: Number.isNaN(limitNum as number) ? undefined : limitNum,
    });

    if (format === 'json') {
      return {
        total: items.length,
        items: items.map((e) => ({
          id: e.id,
          calling: e.calling,
          called: e.called,
          callTimestamp: e.callTimestamp,
          createdAt: e.createdAt,
          log: this.sbctelcoService.formatCallTraceText(e.payload ?? {}),
        })),
      };
    }

    res?.setHeader('Content-Type', 'text/plain; charset=utf-8');
    const separator = '\n\n--- ---- ----\n\n';
    return items
      .map((e) => this.sbctelcoService.formatCallTraceText(e.payload ?? {}))
      .join(separator);
  }

  /** Лог из БД sbclogs (таблица sbctrace) по id звонка — тот же формат, что и formatCallTraceText */
  @Get('sbctrace/:id')
  async getSbctraceById(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    if (!id || String(id).trim() === '') {
      return { statusCode: 400, message: 'Invalid id' };
    }
    const text = await this.sbctelcoService.getTraceLogById(id.trim());
    if (format === 'json') {
      res?.type('application/json');
      return { id, log: text };
    }
    res?.type('text/plain; charset=utf-8');
    return text;
  }

  @Get('call_trace')
  async getCallTrace(
    @Query('nb_result') nb_result?: string,
    @Query('called') called?: string,
    @Query('calling') calling?: string,
    @Query('recursive') recursive?: string,
    @Query('format') format?: string,
    @Query('save') save?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const params: {
      nb_result?: number;
      called?: string;
      calling?: string;
      recursive?: string;
    } = {};

    if (nb_result) params.nb_result = parseInt(nb_result, 10);
    if (called) params.called = called;
    if (calling) params.calling = calling;
    if (recursive) params.recursive = recursive;

    const raw = await this.sbctelcoService.getCallTrace(params);

    if (save === '1' || save === 'true') {
      await this.sbctelcoService.saveTracesFromResponse(raw);
    }

    if (format === 'text') {
      res?.type('text/plain; charset=utf-8');
      return this.sbctelcoService.formatCallTraceText(raw);
    }

    const acceptHeader = req?.headers?.accept || '';
    const isApiRequest = acceptHeader.includes('application/json') || format === 'json';
    if (isApiRequest) {
      res?.type('application/json');
      return raw;
    }

    // default HTML for browser
    const escapeHtml = (text: string): string =>
      (text || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/\"/g, '&quot;')
        .replace(/'/g, '&#039;');

    const text = this.sbctelcoService.formatCallTraceText(raw);
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SBCtelco call_trace</title>
  <style>
    body { font-family: Monaco, Menlo, Consolas, monospace; background:#1e1e1e; color:#d4d4d4; padding:20px; }
    .header { margin-bottom: 16px; }
    a { color:#60a5fa; text-decoration:none; }
    a:hover { text-decoration:underline; }
    pre { background:#252526; padding:16px; border-radius:6px; overflow:auto; white-space:pre-wrap; }
  </style>
</head>
<body>
  <div class="header">
    <div><strong>SBCtelco call_trace</strong></div>
    <div>Format: <a href="?format=json">JSON</a> | <a href="?format=text">Text</a></div>
  </div>
  <pre>${escapeHtml(text)}</pre>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }
}

