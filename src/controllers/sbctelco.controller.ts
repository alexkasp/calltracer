import { Controller, Get, Query, Res, Req } from '@nestjs/common';
import type { Response, Request } from 'express';
import { SbctelcoService } from '../services/sbctelco.service';

@Controller('sbctelco')
export class SbctelcoController {
  constructor(private readonly sbctelcoService: SbctelcoService) {}

  @Get('call_trace')
  async getCallTrace(
    @Query('nb_result') nb_result?: string,
    @Query('called') called?: string,
    @Query('calling') calling?: string,
    @Query('recursive') recursive?: string,
    @Query('format') format?: string,
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

