import {
  Controller,
  Get,
  Query,
  Req,
  Res,
  BadRequestException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { gunzipSync } from 'zlib';
import { VoipmonitorService } from '../services/voipmonitor.service';
import { renderSiteHeader } from '../utils/site-header';
import { renderLoadingShell } from '../utils/loading-shell';
import { CalltraceService } from '../services/calltrace.service';
import { resolveLang } from '../i18n/lang';
import { t } from '../i18n/translate';

/** Внутренний call-trace id (дайлер "1784891602.0026156" или S2L-хэш) — в отличие от SIP Call-ID/fbasename VoIPmonitor. */
function looksLikeCallTraceId(id: string): boolean {
  return /^\d+\.\d+$/.test(id) || /^[a-f0-9]+$/i.test(id);
}

/**
 * VoIPmonitor api.php всегда отдаёт Content-Type: application/octet-stream для pcap,
 * независимо от того, gzip это, zip (склеенные плечи) или сырой pcap — поэтому
 * реальный формат определяем по magic-байтам, а не по заголовку ответа.
 */
function unwrapPcap(data: Buffer): {
  data: Buffer;
  ext: string;
  contentType: string;
} {
  const isGzip = data.length >= 2 && data[0] === 0x1f && data[1] === 0x8b;
  if (isGzip) {
    return {
      data: gunzipSync(data),
      ext: 'pcap',
      contentType: 'application/vnd.tcpdump.pcap',
    };
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
  form(
    @Query('callid') callid?: string,
    @Query('calldate') calldate?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const lang = resolveLang(req);
    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'recording.formTitle')}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  ${renderSiteHeader(lang, req?.originalUrl || '/call-recording')}
  <h1>${t(lang, 'recording.formH1')}</h1>
  <div class="meta">${t(lang, 'recording.formDescription', { example: '<code>1784891602.0026156</code>' })}</div>
  <form method="GET" action="/call-recording/player">
    <table style="border:0; margin-bottom: 16px;">
      <tr style="border:0;">
        <td style="border:0; padding: 4px 8px 4px 0;">${t(lang, 'recording.callIdLabel')}</td>
        <td style="border:0;"><input name="callid" value="${escapeHtml(callid || '')}" placeholder="${t(lang, 'recording.callIdPlaceholder')}" required /></td>
      </tr>
      <tr style="border:0;">
        <td style="border:0; padding: 4px 8px 4px 0;">${t(lang, 'recording.calldateLabel')}</td>
        <td style="border:0;"><input type="date" name="calldate" value="${escapeHtml(calldate || '')}" /></td>
      </tr>
    </table>
    <button type="submit">${t(lang, 'recording.searchSubmit')}</button>
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
    @Query('leg') legParam?: string,
    @Query('_async') asyncFlag?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const lang = resolveLang(req);
    let callId = String(callid || '').trim();
    if (!callId) {
      throw new BadRequestException(t(lang, 'recording.callIdRequired'));
    }

    // Поиск в VoIPmonitor/SBCtelco/Convolo может занимать несколько секунд — сначала отдаём
    // лёгкую заглушку с прогресс-баром, реальный HTML подгружается через fetch (см. loading-shell.ts).
    if (!asyncFlag) {
      res?.type('text/html; charset=utf-8');
      const currentUrl = req?.originalUrl || '/call-recording/player';
      const sep = currentUrl.includes('?') ? '&' : '?';
      return renderLoadingShell(
        lang,
        currentUrl,
        `${currentUrl}${sep}_async=1`,
      );
    }

    const originalQueryId = callId;
    let resolvedCalldate = calldate;
    let traceResolutionNotice: string | null = null;
    // Плечи callback-звонка (S2L "заказ звонка"): звонок агенту и звонок лиду — два отдельных
    // sipCallId в VoIPmonitor для одного и того же trace id. Если их больше одного, показываем
    // в верху страницы меню "Call to agent"/"Call to lead" и переключаемся между ними по ?leg=.
    let legs: Array<{ label: 'agent' | 'lead'; sipCallId: string }> = [];
    let selectedLeg: string | null = null;

    // Если передан внутренний call-trace id (дайлер "1784891602.0026156" / S2L), а не SIP Call-ID —
    // резолвим через CalltraceService (парсит лог Convolo, ищет звонок в VoIPmonitor по номерам/времени).
    if (looksLikeCallTraceId(callId)) {
      const traceId = callId;
      try {
        const trace = await this.calltraceService.getCallTrace(traceId);
        const data: any = trace?.data;
        if (Array.isArray(data?.legs) && data.legs.length > 1) {
          legs = data.legs;
          selectedLeg =
            legParam && legs.some((l) => l.label === legParam)
              ? legParam
              : legs[0].label;
          callId = legs.find((l) => l.label === selectedLeg)!.sipCallId;
          if (!resolvedCalldate && data?.calldate)
            resolvedCalldate = data.calldate;
        } else if (data?.sipCallId) {
          callId = data.sipCallId;
          if (!resolvedCalldate && data?.calldate)
            resolvedCalldate = data.calldate;
        } else {
          traceResolutionNotice = t(lang, 'recording.traceNotFoundNotice', {
            traceId,
            link: `/calltrace/${encodeURIComponent(traceId)}`,
          });
        }
      } catch (error: any) {
        traceResolutionNotice = t(lang, 'recording.traceParseError', {
          traceId,
          error: error?.message || error,
        });
      }
    }

    const fdatefrom = resolvedCalldate
      ? `${resolvedCalldate} 00:00:00`
      : '1970-01-01T00:00:00';

    let vmCall: any = null;
    let lookupError: string | null = null;
    try {
      const response = await this.voipmonitorService.getCalls({
        limit: 1,
        fdatefrom,
        fcallid: callId,
      });
      vmCall = response?.results?.[0] ?? null;
    } catch (error: any) {
      lookupError = error?.message || t(lang, 'recording.vmSearchError');
    }

    const cdrId = vmCall?.ID ? String(vmCall.ID) : '';
    const calldateParam = resolvedCalldate
      ? `&calldate=${encodeURIComponent(resolvedCalldate)}`
      : '';

    const audioSrc = cdrId
      ? `/call-recording/audio?cdrId=${encodeURIComponent(cdrId)}`
      : `/call-recording/audio?callid=${encodeURIComponent(callId)}${calldateParam}`;
    const pcapHref = cdrId
      ? `/call-recording/pcap?cdrId=${encodeURIComponent(cdrId)}`
      : `/call-recording/pcap?callid=${encodeURIComponent(callId)}${calldateParam}`;

    const streams: any[] = Array.isArray(vmCall?.allrtpstreams)
      ? vmCall.allrtpstreams
      : [];
    const streamsTable = streams.length
      ? `<table>
        <thead><tr>${Object.keys(streams[0])
          .map((k) => `<th>${escapeHtml(k)}</th>`)
          .join('')}</tr></thead>
        <tbody>${streams
          .map(
            (s) =>
              `<tr>${Object.values(s)
                .map((v) => `<td>${escapeHtml(String(v ?? ''))}</td>`)
                .join('')}</tr>`,
          )
          .join('')}</tbody>
      </table>`
      : `<p class="meta">${t(lang, 'recording.noStreamsData')}</p>`;

    // RTCP-отчёт: агрегаты из CDR (jitter/loss/MOS уже посчитаны VoIPmonitor по реальным RTCP SR/RR) + разбивка по потокам (SSRC)
    const totalReceived = streams.reduce(
      (sum, s) => sum + (Number(s.received) || 0),
      0,
    );
    const totalLost = streams.reduce(
      (sum, s) => sum + (Number(s.loss) || 0),
      0,
    );
    const totalPackets = totalReceived + totalLost;
    const overallLossPct =
      totalPackets > 0 ? (totalLost / totalPackets) * 100 : null;
    const msUnit = t(lang, 'rtcp.ms');
    const secUnit = t(lang, 'rtcp.sec');

    const rtcpSummaryTable = vmCall
      ? `<table>
        <tr><th>${t(lang, 'rtcp.mosMin')}</th><td>${escapeHtml(String(vmCall.mos_min ?? '—'))}</td></tr>
        <tr><th>${t(lang, 'rtcp.jitterAvg')}</th><td>${escapeHtml(String(vmCall.jitter ?? '—'))} ${msUnit}</td></tr>
        <tr><th>${t(lang, 'rtcp.packetLoss')}</th><td>${vmCall.packet_loss_perc != null ? escapeHtml(String(vmCall.packet_loss_perc)) + '%' : '—'} (${escapeHtml(String(vmCall.lost ?? totalLost ?? '—'))} ${t(lang, 'rtcp.lost')})</td></tr>
        <tr><th>${t(lang, 'rtcp.totalPackets')}</th><td>${totalPackets || '—'}${totalPackets ? ` (${t(lang, 'rtcp.received')} ${totalReceived}, ${t(lang, 'rtcp.lost')} ${totalLost}${overallLossPct != null ? `, ${overallLossPct.toFixed(2)}%` : ''})` : ''}</td></tr>
      </table>`
      : `<p class="meta">${t(lang, 'rtcp.noData')}</p>`;

    const rtcpStreamsTable = streams.length
      ? `<table>
        <thead><tr><th>${t(lang, 'rtcp.col.index')}</th><th>${t(lang, 'rtcp.col.direction')}</th><th>${t(lang, 'rtcp.col.ssrc')}</th><th>${t(lang, 'rtcp.col.received')}</th><th>${t(lang, 'rtcp.col.lost')}</th><th>${t(lang, 'rtcp.col.lossPct')}</th><th>${t(lang, 'rtcp.col.jitterMax')}</th><th>${t(lang, 'rtcp.col.duration')}</th></tr></thead>
        <tbody>${streams
          .map((s) => {
            const received = Number(s.received) || 0;
            const loss = Number(s.loss) || 0;
            const lossPct =
              received + loss > 0 ? (loss / (received + loss)) * 100 : 0;
            const jitterMs =
              s.maxjitter_mult10 != null
                ? (Number(s.maxjitter_mult10) / 10).toFixed(1)
                : '—';
            return `<tr>
              <td>${escapeHtml(String(s.index ?? '—'))}</td>
              <td>${escapeHtml(String(s.saddr ?? ''))}:${escapeHtml(String(s.sport ?? ''))} → ${escapeHtml(String(s.daddr ?? ''))}:${escapeHtml(String(s.dport ?? ''))}</td>
              <td>${escapeHtml(String(s.ssrc ?? '—'))}</td>
              <td>${received}</td>
              <td>${loss}</td>
              <td>${lossPct.toFixed(2)}%</td>
              <td>${jitterMs} ${msUnit}</td>
              <td>${escapeHtml(String(s.duration ?? '—'))} ${secUnit}</td>
            </tr>`;
          })
          .join('')}</tbody>
      </table>`
      : `<p class="meta">${t(lang, 'rtcp.noStreamsForBreakdown')}</p>`;

    const metaRows = vmCall
      ? `
        <tr><th>${t(lang, 'recording.field.cdrId')}</th><td>${escapeHtml(cdrId || '—')}</td></tr>
        <tr><th>${t(lang, 'recording.field.calldate')}</th><td>${escapeHtml(vmCall.calldate || '—')}</td></tr>
        <tr><th>${t(lang, 'recording.field.caller')}</th><td>${escapeHtml(vmCall.caller || '—')}</td></tr>
        <tr><th>${t(lang, 'recording.field.called')}</th><td>${escapeHtml(vmCall.called || '—')}</td></tr>
        <tr><th>${t(lang, 'recording.field.duration')}</th><td>${escapeHtml(String(vmCall.duration ?? '—'))} ${secUnit}</td></tr>
        <tr><th>${t(lang, 'recording.field.codec')}</th><td>${escapeHtml(vmCall.a_codec || '—')} / ${escapeHtml(vmCall.b_codec || '—')}</td></tr>
        <tr><th>${t(lang, 'recording.field.mosMin')}</th><td>${escapeHtml(String(vmCall.mos_min ?? '—'))}</td></tr>
        <tr><th>${t(lang, 'recording.field.sipResponse')}</th><td>${escapeHtml(vmCall.lastSIPresponse || '—')}</td></tr>
      `
      : '';

    const notFoundNotice =
      !vmCall && !lookupError
        ? `<div class="error">${t(lang, 'recording.notFoundNotice', {
            dateHint: resolvedCalldate
              ? ''
              : t(lang, 'recording.notFoundDateHint'),
          })}</div>`
        : '';
    const searchErrorNotice = lookupError
      ? `<div class="error">${t(lang, 'recording.searchErrorNotice')}</div>`
      : '';
    const traceNotice = traceResolutionNotice
      ? `<div class="error">${escapeHtml(traceResolutionNotice)}</div>`
      : '';

    // Ссылка на разбор лога звонка (calltrace) — только когда искали по внутреннему trace id
    // (дайлер/S2L), а не по "сырому" SIP Call-ID, иначе /calltrace/:id не найдёт такой лог.
    const calltraceLink = looksLikeCallTraceId(originalQueryId)
      ? `<a href="/calltrace/${encodeURIComponent(originalQueryId)}">${t(lang, 'recording.viewCallTrace')}</a>`
      : '';

    const legsMenu = legs.length
      ? `<div class="meta" style="margin-bottom: 16px;">${legs
          .map((l) => {
            const params = new URLSearchParams({
              callid: originalQueryId,
              leg: l.label,
            });
            if (resolvedCalldate) params.set('calldate', resolvedCalldate);
            const isActive = l.label === selectedLeg;
            const label = t(
              lang,
              l.label === 'lead' ? 'recording.legLead' : 'recording.legAgent',
            );
            return `<a href="/call-recording/player?${params.toString()}" style="${isActive ? 'font-weight: 700; color: #eaeaea; border-bottom: 2px solid #7c3aed;' : ''} margin-right: 16px; padding-bottom: 2px;">${label}</a>`;
          })
          .join('')}</div>`
      : '';

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'recording.playerTitle', { id: escapeHtml(callId) })}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  ${renderSiteHeader(lang, req?.originalUrl || '/call-recording/player')}
  <h1>${t(lang, 'recording.playerH1')}</h1>
  <div class="meta">Call-ID: ${escapeHtml(callId)}${originalQueryId !== callId ? t(lang, 'recording.byTraceId', { id: escapeHtml(originalQueryId) }) : ''} · <a href="/call-recording">${t(lang, 'recording.newSearch')}</a>${calltraceLink ? ` · ${calltraceLink}` : ''}</div>

  ${legsMenu}
  ${traceNotice}
  ${searchErrorNotice}
  ${notFoundNotice}

  ${vmCall ? `<section><h2>${t(lang, 'recording.callInfoTitle')}</h2><table>${metaRows}</table></section>` : ''}

  <section>
    <h2>${t(lang, 'recording.audioSectionTitle')}</h2>
    <p class="meta" style="margin-bottom: 12px;">${t(lang, 'recording.audioLoadHint')}</p>
    <div class="player-box">
      <div id="wave-timeline" class="wave-timeline"></div>
      <div id="wave-form" class="wave-form"></div>
      <div id="wave-spectrogram" class="wave-spectrogram"></div>
      <div class="wave-controls">
        <button id="wave-play-btn" disabled>${t(lang, 'recording.loadingBtn')}</button>
        <span id="wave-time" class="wave-time">0:00 / 0:00</span>
      </div>
      <div class="actions">
        <a href="${audioSrc}&ogg=1">${t(lang, 'recording.downloadOgg')}</a>
        <a href="${pcapHref}">${t(lang, 'recording.downloadPcap')}</a>
      </div>
    </div>
  </section>

  <section>
    <h2>${t(lang, 'rtcp.title')}</h2>
    ${rtcpSummaryTable}
    <h3 style="font-size: 1rem; color: #a78bfa; margin: 16px 0 8px;">${t(lang, 'rtcp.byStreams')}</h3>
    ${rtcpStreamsTable}
  </section>

  <section>
    <h2>${t(lang, 'recording.rawStreamsTitle')}</h2>
    <details>
      <summary style="cursor: pointer; color: #7c3aed; margin-bottom: 8px;">${t(lang, 'recording.showRawFields')}</summary>
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
      playBtn.textContent = ${JSON.stringify(t(lang, 'recording.playBtn'))};
      timeEl.textContent = \`0:00 / \${formatTime(ws.getDuration())}\`;
    });
    ws.on('play', () => { playBtn.textContent = ${JSON.stringify(t(lang, 'recording.pauseBtn'))}; });
    ws.on('pause', () => { playBtn.textContent = ${JSON.stringify(t(lang, 'recording.playBtn'))}; });
    ws.on('timeupdate', (t) => {
      timeEl.textContent = \`\${formatTime(t)} / \${formatTime(ws.getDuration())}\`;
    });
    ws.on('error', (err) => {
      playBtn.textContent = ${JSON.stringify(t(lang, 'recording.audioLoadError'))};
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
    @Req() req?: Request,
    @Res() res?: Response,
  ) {
    const lang = resolveLang(req);
    if (!cdrId && !callid) {
      throw new BadRequestException(t(lang, 'recording.cdrOrCallidRequired'));
    }

    const { data, contentType } =
      await this.voipmonitorService.getVoiceRecording({
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
  async pcap(
    @Query('cdrId') cdrId?: string,
    @Query('callid') callid?: string,
    @Req() req?: Request,
    @Res() res?: Response,
  ) {
    const lang = resolveLang(req);
    if (!cdrId && !callid) {
      throw new BadRequestException(t(lang, 'recording.cdrOrCallidRequired'));
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
