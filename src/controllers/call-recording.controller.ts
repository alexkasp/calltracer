import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { gunzipSync } from 'zlib';
import { VoipmonitorService } from '../services/voipmonitor.service';

/**
 * VoIPmonitor api.php всегда отдаёт Content-Type: application/octet-stream для pcap,
 * независимо от того, gzip это, zip (склеенные плечи) или сырой pcap — поэтому
 * реальный формат определяем по magic-байтам, а не по заголовку ответа.
 */
function unwrapPcap(data: Buffer): { data: Buffer; ext: string; contentType: string } {
  const isGzip = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (isGzip) {
    return { data: gunzipSync(data), ext: 'pcap', contentType: 'application/vnd.tcpdump.pcap' };
  }
  const isZip = data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
  if (isZip) {
    return { data, ext: 'zip', contentType: 'application/zip' };
  }
  return { data, ext: 'pcap', contentType: 'application/vnd.tcpdump.pcap' };
}

const escapeHtml = (text: string): string =>
  (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const PAGE_STYLE = `
  body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1000px; margin: 0 auto; }
  h1 { font-size: 1.5rem; margin-bottom: 8px; }
  .meta { color: #888; font-size: 0.9rem; margin-bottom: 24px; }
  a { color: #7c3aed; text-decoration: none; }
  a:hover { text-decoration: underline; }
  section { margin-bottom: 24px; }
  section h2 { font-size: 1.1rem; color: #a78bfa; margin-bottom: 8px; }
  table { border-collapse: collapse; width: 100%; margin-bottom: 16px; }
  th, td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
  th { background: #16213e; color: #a78bfa; }
  input { background: #0f172a; color: #eaeaea; border: 1px solid #333; border-radius: 6px; padding: 8px 10px; width: 320px; }
  button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 8px 12px; cursor: pointer; }
  .player-box { background: #16213e; padding: 20px; border-radius: 8px; margin-bottom: 16px; }
  .player-box audio { width: 100%; }
  .actions { display: flex; gap: 12px; margin-top: 12px; }
  .actions a { background: #0f172a; border: 1px solid #333; padding: 8px 14px; border-radius: 6px; }
  .error { background: rgba(220, 80, 80, 0.15); border: 1px solid #dc5050; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
`;

@Controller('call-recording')
export class CallRecordingController {
  constructor(private readonly voipmonitorService: VoipmonitorService) {}

  @Get()
  form(@Query('callid') callid?: string, @Query('calldate') calldate?: string, @Res({ passthrough: true }) res?: Response) {
    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Прослушивание звонка (RTP)</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>Прослушивание звонка по Call-ID</h1>
  <div class="meta">Поиск pcap-дампа/аудиозаписи в VoIPmonitor по SIP Call-ID</div>
  <form method="GET" action="/call-recording/player">
    <table style="border:0; margin-bottom: 16px;">
      <tr style="border:0;">
        <td style="border:0; padding: 4px 8px 4px 0;">Call-ID:</td>
        <td style="border:0;"><input name="callid" value="${escapeHtml(callid || '')}" placeholder="например 1234567890@sip.example.com" required /></td>
      </tr>
      <tr style="border:0;">
        <td style="border:0; padding: 4px 8px 4px 0;">Дата звонка (опц.):</td>
        <td style="border:0;"><input type="date" name="calldate" value="${escapeHtml(calldate || '')}" /></td>
      </tr>
    </table>
    <button type="submit">Найти и прослушать</button>
  </form>
</body>
</html>`;
    res?.type('text/html; charset=utf-8');
    return html;
  }

  @Get('player')
  async player(
    @Query('callid') callid?: string,
    @Query('calldate') calldate?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const callId = String(callid || '').trim();
    if (!callId) {
      throw new BadRequestException('Query param callid is required');
    }

    const fdatefrom = calldate ? `${calldate} 00:00:00` : '1970-01-01T00:00:00';

    let vmCall: any = null;
    let lookupError: string | null = null;
    try {
      const response = await this.voipmonitorService.getCalls({ limit: 1, fdatefrom, fcallid: callId });
      vmCall = response?.results?.[0] ?? null;
    } catch (error: any) {
      lookupError = error?.message || 'Ошибка поиска звонка в VoIPmonitor';
    }

    const cdrId = vmCall?.ID ? String(vmCall.ID) : '';
    const calldateParam = calldate ? `&calldate=${encodeURIComponent(calldate)}` : '';

    const audioSrc = cdrId
      ? `/call-recording/audio?cdrId=${encodeURIComponent(cdrId)}`
      : `/call-recording/audio?callid=${encodeURIComponent(callId)}${calldateParam}`;
    const pcapHref = cdrId
      ? `/call-recording/pcap?cdrId=${encodeURIComponent(cdrId)}`
      : `/call-recording/pcap?callid=${encodeURIComponent(callId)}${calldateParam}`;

    const streams: any[] = Array.isArray(vmCall?.allrtpstreams) ? vmCall.allrtpstreams : [];
    const streamsTable = streams.length
      ? `<table>
        <thead><tr>${Object.keys(streams[0]).map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
        <tbody>${streams
          .map((s) => `<tr>${Object.values(s).map((v) => `<td>${escapeHtml(String(v ?? ''))}</td>`).join('')}</tr>`)
          .join('')}</tbody>
      </table>`
      : '<p class="meta">Нет данных о RTP-потоках (allrtpstreams) для этого звонка.</p>';

    const metaRows = vmCall
      ? `
        <tr><th>ID (cdrId)</th><td>${escapeHtml(cdrId || '—')}</td></tr>
        <tr><th>Дата звонка</th><td>${escapeHtml(vmCall.calldate || '—')}</td></tr>
        <tr><th>Caller</th><td>${escapeHtml(vmCall.caller || '—')}</td></tr>
        <tr><th>Called</th><td>${escapeHtml(vmCall.called || '—')}</td></tr>
        <tr><th>Длительность</th><td>${escapeHtml(String(vmCall.duration ?? '—'))} сек</td></tr>
        <tr><th>Codec (A/B)</th><td>${escapeHtml(vmCall.a_codec || '—')} / ${escapeHtml(vmCall.b_codec || '—')}</td></tr>
        <tr><th>MOS min</th><td>${escapeHtml(String(vmCall.mos_min ?? '—'))}</td></tr>
        <tr><th>SIP response</th><td>${escapeHtml(vmCall.lastSIPresponse || '—')}</td></tr>
      `
      : '';

    const notFoundNotice = !vmCall
      ? `<div class="error">Звонок не найден в CDR VoIPmonitor по этому Call-ID${calldate ? '' : ' (искали без даты — попробуйте указать дату звонка)'}${lookupError ? `: ${escapeHtml(lookupError)}` : ''}. Аудио и pcap всё равно попробуем получить напрямую по Call-ID.</div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Звонок ${escapeHtml(callId)}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <h1>Прослушивание звонка</h1>
  <div class="meta">Call-ID: ${escapeHtml(callId)} · <a href="/call-recording">← новый поиск</a></div>

  ${notFoundNotice}

  ${vmCall ? `<section><h2>Информация о звонке</h2><table>${metaRows}</table></section>` : ''}

  <section>
    <h2>RTP-поток (аудио)</h2>
    <div class="player-box">
      <audio controls preload="none" src="${audioSrc}">Браузер не поддерживает аудио-плеер.</audio>
      <div class="actions">
        <a href="${audioSrc}&ogg=1">Скачать OGG</a>
        <a href="${pcapHref}">Скачать PCAP</a>
      </div>
    </div>
  </section>

  <section>
    <h2>RTP-потоки (метаданные)</h2>
    ${streamsTable}
  </section>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  @Get('audio')
  async audio(
    @Query('cdrId') cdrId?: string,
    @Query('callid') callid?: string,
    @Query('calldate') calldate?: string,
    @Query('ogg') ogg?: string,
    @Res() res?: Response,
  ) {
    if (!cdrId && !callid) {
      throw new BadRequestException('cdrId or callid is required');
    }

    const { data, contentType } = await this.voipmonitorService.getVoiceRecording({
      cdrId: cdrId || undefined,
      callId: !cdrId ? callid : undefined,
      calldate: !cdrId ? calldate : undefined,
      // Внимание: VoIPmonitor api.php падает с HTTP 500, если передать cidInterval вместе с cidMerge —
      // cidMerge сам по себе уже склеивает плечи, cidInterval не нужен (см. тестирование).
      cidMerge: !cdrId ? true : undefined,
      ogg: ogg === '1' || ogg === 'true',
    });

    res!.set('Content-Type', contentType || 'audio/wav');
    res!.set('Cache-Control', 'private, max-age=3600');
    res!.send(data);
  }

  @Get('pcap')
  async pcap(@Query('cdrId') cdrId?: string, @Query('callid') callid?: string, @Res() res?: Response) {
    if (!cdrId && !callid) {
      throw new BadRequestException('cdrId or callid is required');
    }

    const { data: rawData } = await this.voipmonitorService.getPcapDump({
      cdrId: cdrId || undefined,
      callId: !cdrId ? callid : undefined,
      // См. комментарий в audio(): cidInterval вместе с cidMerge валит VoIPmonitor api.php (HTTP 500).
      cidMerge: !cdrId ? true : undefined,
    });

    const { data, ext, contentType } = unwrapPcap(rawData);
    const filename = `call_${cdrId || callid}.${ext}`;

    res!.set('Content-Type', contentType);
    res!.set('Content-Disposition', `attachment; filename="${filename}"`);
    res!.send(data);
  }
}
