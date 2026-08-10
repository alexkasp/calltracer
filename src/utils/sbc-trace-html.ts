/**
 * Экспорт SBC call trace в HTML-файл в формате TelcoBridges ("Exported trace" из веб-морды
 * SBC TelcoPro) — та же структура, что у файла, который выгружает сам SBC: fieldset Summary
 * с таблицами Incoming/Outgoing legs + "лестница" сообщений (table.call_trace, 6 колонок:
 * время | сообщение левого плеча | стрелка | application | стрелка | сообщение правого плеча),
 * цвета плеч и CSS-классы 1-в-1 с вендорскими. Отличие от оригинала — тултипы через нативный
 * title= вместо wz_tooltip.js, чтобы файл был самодостаточным без JS.
 *
 * Источник данных — raw-ответ SBCtelco /call_trace (он же payload в БД sbclogs.sbctrace):
 * объект { "<key>": { leg_id, nap, protocol, connect_timestamp, timestamp, calling, called,
 * terminate_reason, call_duration, route, call_id, call_traces: { "<key>": { order, timestamp,
 * direction ('1'|'2'), leg, trace_info, trace_tooltip } } }, "***meta***": { version } }.
 */

type SbcTraceItem = {
  order: number;
  timestamp: string;
  direction: string;
  trace_info: string;
  trace_tooltip: string;
};

type SbcLeg = {
  key: string;
  legId: string;
  nap: string;
  protocol: string;
  connectTimestamp: string;
  timestamp: string;
  calling: string;
  called: string;
  terminateReason: string;
  callDuration: string;
  callId: string;
  traces: SbcTraceItem[];
  incoming: boolean;
  mos: string;
  networkQuality: string;
};

const escapeHtml = (text: string): string =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

/** trace_info может содержать многострочный SDP — переносим как <br/>, как в оригинале. */
const infoToHtml = (text: string): string =>
  escapeHtml(text).replace(/\r?\n/g, '<br/>');

function parseLegs(raw: any): SbcLeg[] {
  if (!raw || typeof raw !== 'object') return [];
  const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');

  const legs: SbcLeg[] = [];
  for (const key of callKeys) {
    const call = raw[key];
    if (!call || typeof call !== 'object') continue;

    const tracesObj = call.call_traces;
    const traces: SbcTraceItem[] = [];
    if (tracesObj && typeof tracesObj === 'object') {
      for (const [tk, t] of Object.entries(tracesObj) as Array<[string, any]>) {
        if (tk === '***meta***' || !t || typeof t !== 'object') continue;
        if (t.order === undefined) continue;
        traces.push({
          order: Number(t.order),
          timestamp: t.timestamp ? String(t.timestamp) : '',
          direction: t.direction !== undefined ? String(t.direction) : '',
          trace_info: t.trace_info ? String(t.trace_info) : '',
          trace_tooltip: t.trace_tooltip ? String(t.trace_tooltip) : '',
        });
      }
    }
    traces.sort((a, b) => a.order - b.order);

    // Плечо входящее/исходящее: по тултипу первого сетевого сообщения ("New call in"/"New call out")
    let incoming = false;
    for (const t of traces) {
      const tip = t.trace_tooltip.trim();
      if (/^New call in\b/i.test(tip)) {
        incoming = true;
        break;
      }
      if (/^New call out\b/i.test(tip)) {
        incoming = false;
        break;
      }
    }

    // MOS и Network quality из финальной статистики плеча
    let mos = '';
    let networkQuality = '';
    for (const t of traces) {
      const m = t.trace_info.match(
        /MOS:\s*([\d.]+).*?Network quality:\s*(\d+)\s*%/s,
      );
      if (m) {
        mos = m[1];
        networkQuality = m[2];
      }
    }

    legs.push({
      key,
      legId: call.leg_id != null ? String(call.leg_id) : key,
      nap: call.nap != null ? String(call.nap) : '',
      protocol: call.protocol != null ? String(call.protocol) : '',
      connectTimestamp:
        call.connect_timestamp != null ? String(call.connect_timestamp) : '',
      timestamp: call.timestamp != null ? String(call.timestamp) : '',
      calling: call.calling != null ? String(call.calling) : '',
      called: call.called != null ? String(call.called) : '',
      terminateReason:
        call.terminate_reason != null ? String(call.terminate_reason) : '',
      callDuration:
        call.call_duration != null ? String(call.call_duration) : '',
      callId: call.call_id != null ? String(call.call_id) : '',
      traces,
      incoming,
      mos,
      networkQuality,
    });
  }

  // Входящие плечи первыми (слева на лестнице), внутри группы — по времени начала
  legs.sort((a, b) => {
    if (a.incoming !== b.incoming) return a.incoming ? -1 : 1;
    return a.timestamp.localeCompare(b.timestamp);
  });
  return legs;
}

function parseTs(ts: string): number | null {
  if (!ts) return null;
  // Формат SBC "2026/08/06 12:37:51.156" и ISO-варианты
  const normalized = ts.replace(
    /^(\d{4})\/(\d{2})\/(\d{2})\s+/,
    '$1-$2-$3T',
  );
  const ms = Date.parse(normalized);
  return Number.isNaN(ms) ? null : ms;
}

function summaryTable(legs: SbcLeg[]): string {
  if (!legs.length) return '';
  const rows = legs
    .map(
      (leg, i) => `
          <tr class="call_trace_color_${legs.indexOf(leg) % 10}">
            <td>${escapeHtml(leg.legId)}</td>
            <td>${escapeHtml(leg.nap)}</td>
            <td>${escapeHtml(leg.protocol)}</td>
            <td>${escapeHtml(leg.connectTimestamp)}</td>
            <td>${escapeHtml(leg.callDuration)}</td>
            <td>${escapeHtml(leg.terminateReason)}</td>
            <td>${escapeHtml(leg.mos || '-')}</td>
            <td>${escapeHtml(leg.networkQuality || '-')}</td>
          </tr>`,
    )
    .join('');
  return `
<table>
  <tr>
    <td>
      <table>
        <tr>
          <th>Leg id</th>
          <th>NAP</th>
          <th>Protocol</th>
          <th>Connect</th>
          <th>Duration</th>
          <th>Reason</th>
          <th>MOS</th>
          <th>Network quality</th>
        </tr>${rows}
      </table>
    </td>
  </tr>
</table>`;
}

export function renderSbcTraceHtml(raw: any, requestedCallId?: string): string {
  const meta = raw?.['***meta***'];
  const legs = parseLegs(raw);
  const incomingLegs = legs.filter((l) => l.incoming);
  const outgoingLegs = legs.filter((l) => !l.incoming);

  // Общая лента: все trace-строки всех плеч, отсортированные по времени (внутри равного
  // времени — по порядку в своём плече)
  type TimelineItem = { legIndex: number; item: SbcTraceItem };
  const timeline: TimelineItem[] = [];
  legs.forEach((leg, legIndex) => {
    for (const item of leg.traces) timeline.push({ legIndex, item });
  });
  timeline.sort((a, b) => {
    const cmp = a.item.timestamp.localeCompare(b.item.timestamp);
    if (cmp !== 0) return cmp;
    if (a.legIndex !== b.legIndex) return a.legIndex - b.legIndex;
    return a.item.order - b.item.order;
  });

  const baseTsStr = timeline.find((t) => t.item.timestamp)?.item.timestamp;
  const baseTs = baseTsStr ? parseTs(baseTsStr) : null;

  const bodyRows: string[] = [];
  let lastTimestamp = '';
  const emptyTds = (n: number) => '<td></td>'.repeat(n);

  for (const { legIndex, item } of timeline) {
    const color = `call_trace_color_${legIndex % 10}`;

    // Строка времени — при смене таймстампа (относительные секунды, абсолют в title)
    if (item.timestamp && item.timestamp !== lastTimestamp) {
      lastTimestamp = item.timestamp;
      const ms = parseTs(item.timestamp);
      const rel =
        ms !== null && baseTs !== null
          ? `${((ms - baseTs) / 1000).toFixed(3)}s`
          : item.timestamp;
      bodyRows.push(
        `<tr><td class="call_trace_time ${color}_time"><p title="${escapeHtml(item.timestamp)}">${escapeHtml(rel)}</p></td>${emptyTds(2)}<td class="application"></td>${emptyTds(2)}</tr>`,
      );
    }

    const isNetworkMsg =
      item.trace_tooltip.trim() !== '' &&
      (item.direction === '1' || item.direction === '2');

    if (isNetworkMsg) {
      // Сетевое сообщение: входящее плечо — слева от application, остальные — справа
      const msgCell = `<td class="call_trace_network_msg ${color}"><p title="${escapeHtml(item.trace_tooltip)}">${infoToHtml(item.trace_info)}</p></td>`;
      const arrow = item.direction === '1' ? '=&gt;' : '&lt;=';
      const arrowCell = `<td class="arrow"><p>${arrow}</p></td>`;
      if (legs[legIndex]?.incoming) {
        bodyRows.push(
          `<tr><td></td>${msgCell}${arrowCell}<td class="application"></td>${emptyTds(2)}</tr>`,
        );
      } else {
        bodyRows.push(
          `<tr>${emptyTds(3)}<td class="application"></td>${arrowCell}${msgCell}</tr>`,
        );
      }
    } else {
      // Application-строка (SDP, routing, call-id, статистика и т.п.)
      const title = item.trace_tooltip.trim()
        ? ` title="${escapeHtml(item.trace_tooltip)}"`
        : '';
      bodyRows.push(
        `<tr>${emptyTds(3)}<td class="application ${color}"><p${title}>${infoToHtml(item.trace_info)}</p></td>${emptyTds(2)}</tr>`,
      );
    }
  }

  const title = `Exported trace${requestedCallId ? ` — ${escapeHtml(requestedCallId)}` : ''}`;

  return `<!doctype html>
<html lang="en">
  <head>
    <title>${title}</title>
    <meta http-equiv="Content-Type" content="text/html; charset=utf-8" />
    <style type="text/css">
body {
  font-family: Verdana, Geneva, sans-serif;
  font-size: 13px;
  color: #0C3A56;
  margin: 10px;
}

fieldset {
  border: 1px solid #0C3A56;
  margin-bottom: 10px;
}

legend {
  font-weight: bold;
}

.call_trace_legend h3 {
  margin: 8px 0 4px 0;
  font-size: 100%;
}

.call_trace_legend th {
  text-align: left;
  padding: 2px 10px 2px 5px;
  background-color: #d3d3d3;
}

.call_trace_legend td {
  padding: 2px 10px 2px 5px;
}

table.call_trace {
  margin: 25px 5px 5px 5px;
  padding: 5px;
  border-collapse: collapse;
}

table.call_trace p {
  margin: 3px;
  word-wrap: break-word;
}

table.call_trace th {
  padding: 0px 5px 20px 5px;
  font-weight: normal;
  text-align: left;
}

table.call_trace th.time {
  font-weight: bold;
}

table.call_trace td.call_trace_time {
  font-size: 75%;
  padding-right: 20px;
  white-space: nowrap;
}

table.call_trace td.application {
  border-left: 3px solid #777777;
  border-right: 3px solid #777777;
  padding: 0px 25px 0px 25px;
  width: auto;
  font-size: 75%;
}

table.call_trace td.arrow {
  padding: 0px 15px 0px 15px;
}

table.call_trace td.call_trace_network_msg {
  font-size: 85%;
  border: 1px solid #DAE1E4;
  padding: 0px 10px 0px 10px;
  width: 50px;
  white-space: nowrap;
}

.call_trace_color_0 { background-color: #eeeeee; }
.call_trace_color_0_time { color: #000000; }
.call_trace_color_1 { background-color: #ccffcc; }
.call_trace_color_1_time { color: #000000; }
.call_trace_color_2 { background-color: #ffdebc; }
.call_trace_color_2_time { color: #000000; }
.call_trace_color_3 { background-color: #ccffff; }
.call_trace_color_3_time { color: #000000; }
.call_trace_color_4 { background-color: #ffffcc; }
.call_trace_color_4_time { color: #000000; }
.call_trace_color_5 { background-color: #ffccff; }
.call_trace_color_5_time { color: #000000; }
.call_trace_color_6 { background-color: #ccccff; }
.call_trace_color_6_time { color: #000000; }
.call_trace_color_7 { background-color: #a9ecec; }
.call_trace_color_7_time { color: #000000; }
.call_trace_color_8 { background-color: #efef89; }
.call_trace_color_8_time { color: #000000; }
.call_trace_color_9 { background-color: #d9d9d9; }
.call_trace_color_9_time { color: #000000; }
    </style>
  </head>
  <body>
    <div id="container">
      <div id="content_export">
        <div id="panel_main">
          <div id="panel_content">
            <div id="trace_data" class="call_trace">

  <fieldset>
    <legend>Summary:</legend>
${meta?.version ? `    <p style="font-size: 75%; margin: 2px 0;">SBC version: ${escapeHtml(String(meta.version))}</p>\n` : ''}
    <div class="call_trace_legend">
      <h3>Incoming</h3>
      ${summaryTable(incomingLegs)}
    </div>
    <div class="call_trace_legend">
      <h3>Outgoing</h3>
      ${summaryTable(outgoingLegs)}
    </div>
  </fieldset>

  <table class="call_trace" width="auto">
    <tr>
      <th class="time">Time: </th>
      <th colspan="5">${escapeHtml(baseTsStr || '')}</th>
    </tr>
${bodyRows.map((r) => `    ${r}`).join('\n')}
  </table>

</div>
          </div>
        </div>
      </div>
    </div>
  </body>
</html>`;
}
