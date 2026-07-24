import { Controller, Get, Query, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { gunzipSync } from 'zlib';
import { VoipmonitorService } from '../services/voipmonitor.service';
import { CalltraceService } from '../services/calltrace.service';

/** Внутренний call-trace id (дайлер "1784891602.0026156" или S2L-хэш) — в отличие от SIP Call-ID/fbasename VoIPmonitor. */
function looksLikeCallTraceId(id: string): boolean {
  return /^\d+\.\d+$/.test(id) || /^[a-f0-9]+$/i.test(id);
}

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
  .wave-timeline { background: #000; border-radius: 6px 6px 0 0; }
  .wave-form { background: #000; }
  .wave-spectrogram { background: #000; border-radius: 0 0 6px 6px; overflow: hidden; }
  .wave-controls { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
  .wave-controls button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 8px 16px; cursor: pointer; font-size: 14px; }
  .wave-controls button:disabled { opacity: 0.5; cursor: default; }
  .wave-time { color: #888; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
  .actions { display: flex; gap: 12px; margin-top: 12px; }
  .actions a { background: #0f172a; border: 1px solid #333; padding: 8px 14px; border-radius: 6px; }
  .error { background: rgba(220, 80, 80, 0.15); border: 1px solid #dc5050; padding: 12px 16px; border-radius: 8px; margin-bottom: 16px; }
`;

@Controller('call-recording')
export class CallRecordingController {
  constructor(
    private readonly voipmonitorService: VoipmonitorService,
    private readonly calltraceService: CalltraceService,
  ) {}

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
  <div class="meta">Поиск pcap-дампа/аудиозаписи в VoIPmonitor. Можно указать SIP Call-ID (fbasename) или call-trace id из дайлера/S2L (например <code>1784891602.0026156</code>) — он резолвится автоматически.</div>
  <form method="GET" action="/call-recording/player">
    <table style="border:0; margin-bottom: 16px;">
      <tr style="border:0;">
        <td style="border:0; padding: 4px 8px 4px 0;">Call-ID:</td>
        <td style="border:0;"><input name="callid" value="${escapeHtml(callid || '')}" placeholder="1784891602.0026156 или SIP Call-ID" required /></td>
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
    let callId = String(callid || '').trim();
    if (!callId) {
      throw new BadRequestException('Query param callid is required');
    }
    const originalQueryId = callId;
    let resolvedCalldate = calldate;
    let traceResolutionNotice: string | null = null;

    // Если передан внутренний call-trace id (дайлер "1784891602.0026156" / S2L), а не SIP Call-ID —
    // резолвим через CalltraceService (парсит лог Convolo, ищет звонок в VoIPmonitor по номерам/времени).
    if (looksLikeCallTraceId(callId)) {
      const traceId = callId;
      try {
        const trace = await this.calltraceService.getCallTrace(traceId);
        const data: any = trace?.data;
        if (data?.sipCallId) {
          callId = data.sipCallId;
          if (!resolvedCalldate && data?.calldate) resolvedCalldate = data.calldate;
        } else {
          traceResolutionNotice = `Call-ID "${traceId}" похож на внутренний call-trace id, но звонок в VoIPmonitor по нему не найден (см. /calltrace/${encodeURIComponent(traceId)}).`;
        }
      } catch (error: any) {
        traceResolutionNotice = `Не удалось распознать "${traceId}" как call-trace id: ${error?.message || error}`;
      }
    }

    const fdatefrom = resolvedCalldate ? `${resolvedCalldate} 00:00:00` : '1970-01-01T00:00:00';

    let vmCall: any = null;
    let lookupError: string | null = null;
    try {
      const response = await this.voipmonitorService.getCalls({ limit: 1, fdatefrom, fcallid: callId });
      vmCall = response?.results?.[0] ?? null;
    } catch (error: any) {
      lookupError = error?.message || 'Ошибка поиска звонка в VoIPmonitor';
    }

    const cdrId = vmCall?.ID ? String(vmCall.ID) : '';
    const calldateParam = resolvedCalldate ? `&calldate=${encodeURIComponent(resolvedCalldate)}` : '';

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

    // RTCP-отчёт: агрегаты из CDR (jitter/loss/MOS уже посчитаны VoIPmonitor по реальным RTCP SR/RR) + разбивка по потокам (SSRC)
    const totalReceived = streams.reduce((sum, s) => sum + (Number(s.received) || 0), 0);
    const totalLost = streams.reduce((sum, s) => sum + (Number(s.loss) || 0), 0);
    const totalPackets = totalReceived + totalLost;
    const overallLossPct = totalPackets > 0 ? (totalLost / totalPackets) * 100 : null;

    const rtcpSummaryTable = vmCall
      ? `<table>
        <tr><th>MOS (min)</th><td>${escapeHtml(String(vmCall.mos_min ?? '—'))}</td></tr>
        <tr><th>Jitter (avg)</th><td>${escapeHtml(String(vmCall.jitter ?? '—'))} мс</td></tr>
        <tr><th>Packet loss</th><td>${vmCall.packet_loss_perc != null ? escapeHtml(String(vmCall.packet_loss_perc)) + '%' : '—'} (${escapeHtml(String(vmCall.lost ?? totalLost ?? '—'))} потеряно)</td></tr>
        <tr><th>Всего RTP-пакетов</th><td>${totalPackets || '—'}${totalPackets ? ` (получено ${totalReceived}, потеряно ${totalLost}${overallLossPct != null ? `, ${overallLossPct.toFixed(2)}%` : ''})` : ''}</td></tr>
      </table>`
      : '<p class="meta">Нет данных для RTCP-отчёта — звонок не найден в CDR.</p>';

    const rtcpStreamsTable = streams.length
      ? `<table>
        <thead><tr><th>#</th><th>Направление</th><th>SSRC</th><th>Пакетов получено</th><th>Потеряно</th><th>Loss %</th><th>Jitter max</th><th>Длительность</th></tr></thead>
        <tbody>${streams
          .map((s) => {
            const received = Number(s.received) || 0;
            const loss = Number(s.loss) || 0;
            const lossPct = received + loss > 0 ? (loss / (received + loss)) * 100 : 0;
            const jitterMs = s.maxjitter_mult10 != null ? (Number(s.maxjitter_mult10) / 10).toFixed(1) : '—';
            return `<tr>
              <td>${escapeHtml(String(s.index ?? '—'))}</td>
              <td>${escapeHtml(String(s.saddr ?? ''))}:${escapeHtml(String(s.sport ?? ''))} → ${escapeHtml(String(s.daddr ?? ''))}:${escapeHtml(String(s.dport ?? ''))}</td>
              <td>${escapeHtml(String(s.ssrc ?? '—'))}</td>
              <td>${received}</td>
              <td>${loss}</td>
              <td>${lossPct.toFixed(2)}%</td>
              <td>${jitterMs} мс</td>
              <td>${escapeHtml(String(s.duration ?? '—'))} сек</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table>`
      : '<p class="meta">Нет данных о RTP-потоках для разбивки по SSRC.</p>';

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
      ? `<div class="error">Звонок не найден в CDR VoIPmonitor по этому Call-ID${resolvedCalldate ? '' : ' (искали без даты — попробуйте указать дату звонка)'}${lookupError ? `: ${escapeHtml(lookupError)}` : ''}. Аудио и pcap всё равно попробуем получить напрямую по Call-ID.</div>`
      : '';
    const traceNotice = traceResolutionNotice
      ? `<div class="error">${escapeHtml(traceResolutionNotice)}</div>`
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
  <div class="meta">Call-ID: ${escapeHtml(callId)}${originalQueryId !== callId ? ` (по call-trace id ${escapeHtml(originalQueryId)})` : ''} · <a href="/call-recording">← новый поиск</a></div>

  ${traceNotice}
  ${notFoundNotice}

  ${vmCall ? `<section><h2>Информация о звонке</h2><table>${metaRows}</table></section>` : ''}

  <section>
    <h2>RTP-поток (аудио)</h2>
    <p class="meta" style="margin-bottom: 12px;">Волна и спектрограмма строятся в браузере (wavesurfer.js) — загрузка занимает ~10–15 сек.</p>
    <div class="player-box">
      <div id="wave-timeline" class="wave-timeline"></div>
      <div id="wave-form" class="wave-form"></div>
      <div id="wave-spectrogram" class="wave-spectrogram"></div>
      <div class="wave-controls">
        <button id="wave-play-btn" disabled>▶ Загрузка…</button>
        <span id="wave-time" class="wave-time">0:00 / 0:00</span>
      </div>
      <div class="actions">
        <a href="${audioSrc}&ogg=1">Скачать OGG</a>
        <a href="${pcapHref}">Скачать PCAP</a>
      </div>
    </div>
  </section>

  <section>
    <h2>RTCP-отчёт</h2>
    ${rtcpSummaryTable}
    <h3 style="font-size: 1rem; color: #a78bfa; margin: 16px 0 8px;">По потокам (SSRC)</h3>
    ${rtcpStreamsTable}
  </section>

  <section>
    <h2>RTP-потоки (сырые данные)</h2>
    <details>
      <summary style="cursor: pointer; color: #7c3aed; margin-bottom: 8px;">Показать все поля allrtpstreams</summary>
      ${streamsTable}
    </details>
  </section>

  <script type="module">
    import WaveSurfer from 'https://unpkg.com/wavesurfer.js@7/dist/wavesurfer.esm.js';
    import Timeline from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/timeline.esm.js';
    import Spectrogram from 'https://unpkg.com/wavesurfer.js@7/dist/plugins/spectrogram.esm.js';

    const playBtn = document.getElementById('wave-play-btn');
    const timeEl = document.getElementById('wave-time');

    const formatTime = (s) => {
      const m = Math.floor(s / 60);
      const sec = Math.floor(s % 60).toString().padStart(2, '0');
      return \`\${m}:\${sec}\`;
    };

    const ws = WaveSurfer.create({
      container: '#wave-form',
      height: 80,
      waveColor: '#5aa3f0',
      progressColor: '#2f6fd6',
      cursorColor: '#f59e0b',
      url: ${JSON.stringify(audioSrc)},
      plugins: [
        Timeline.create({
          container: '#wave-timeline',
          height: 20,
          primaryColor: '#f59e0b',
          primaryFontColor: '#f59e0b',
          secondaryFontColor: '#666',
        }),
      ],
    });

    ws.registerPlugin(
      Spectrogram.create({
        container: '#wave-spectrogram',
        labels: true,
        height: 200,
        splitChannels: false,
      }),
    );

    ws.on('ready', () => {
      playBtn.disabled = false;
      playBtn.textContent = '▶ Play';
      timeEl.textContent = \`0:00 / \${formatTime(ws.getDuration())}\`;
    });
    ws.on('play', () => { playBtn.textContent = '⏸ Pause'; });
    ws.on('pause', () => { playBtn.textContent = '▶ Play'; });
    ws.on('timeupdate', (t) => {
      timeEl.textContent = \`\${formatTime(t)} / \${formatTime(ws.getDuration())}\`;
    });
    ws.on('error', (err) => {
      playBtn.textContent = 'Ошибка загрузки аудио';
      console.error('wavesurfer error', err);
    });
    playBtn.addEventListener('click', () => ws.playPause());
  </script>
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
