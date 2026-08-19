/**
 * Разбор строки решения о маршрутизации из call_traces SBC. Формат (проверен на живых данных):
 *
 *   Routing: [SrcNap=NAP_P1S1_BRIGHTCALL, Calling=044973623, Called=00359897796557] found 1 matching route: PBXS2Y1_toEEGSIP01
 *
 * Ценна по двум причинам:
 *  1) число найденных маршрутов — единственный достоверный признак «маршрут не найден»
 *     (found 0 matching route). Пустые поля записи таким признаком НЕ являются: у застрявших
 *     в начале звонков маршрут как раз найден, просто запись не успела заполниться.
 *  2) номера Calling/Called здесь есть даже тогда, когда верхнеуровневые поля звонка ещё пустые —
 *     иначе такой звонок вообще нельзя найти по номеру.
 */
export type SbcRoutingDecision = {
  srcNap: string | null;
  calling: string | null;
  called: string | null;
  matchedRoutes: number | null;
  routeName: string | null;
};

const ROUTING_RE =
  /Routing:\s*\[([^\]]*)\]\s*found\s+(\d+)\s+matching\s+route(?:s)?(?:\s*:\s*(\S+))?/i;

function collectTraceInfos(callData: unknown): string[] {
  const c = callData as Record<string, unknown> | null | undefined;
  const chunks: string[] = [];
  if (typeof c?.trace_info === 'string') chunks.push(c.trace_info);
  const traces = c?.call_traces;
  if (traces && typeof traces === 'object') {
    for (const v of Object.values(traces)) {
      const info = (v as { trace_info?: unknown } | null)?.trace_info;
      if (typeof info === 'string') chunks.push(info);
    }
  }
  return chunks;
}

export function parseRoutingDecision(
  callData: unknown,
): SbcRoutingDecision | null {
  for (const chunk of collectTraceInfos(callData)) {
    const m = chunk.match(ROUTING_RE);
    if (!m) continue;
    const inner = m[1] ?? '';
    const field = (name: string): string | null => {
      const fm = inner.match(new RegExp(`${name}\\s*=\\s*([^,\\]]*)`, 'i'));
      const v = fm?.[1]?.trim();
      return v ? v : null;
    };
    return {
      srcNap: field('SrcNap'),
      calling: field('Calling'),
      called: field('Called'),
      matchedRoutes: Number(m[2]),
      routeName: m[3] ? m[3].replace(/[.,;]+$/, '') : null,
    };
  }
  return null;
}
