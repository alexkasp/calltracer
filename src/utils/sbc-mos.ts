/**
 * Первое значение MOS из trace_info (строка вида "MOS: 4.3 codec ideal MOS 4.3, ...").
 * Ищет в поле trace_info звонка и в call_traces[].trace_info.
 */
export function parseMosFromCallData(callData: unknown): number | null {
  const c = callData as Record<string, unknown> | null | undefined;
  const chunks: string[] = [];
  if (typeof c?.trace_info === 'string') chunks.push(c.trace_info);
  const traces = c?.call_traces;
  if (traces && typeof traces === 'object') {
    for (const v of Object.values(traces)) {
      if (v && typeof v === 'object' && typeof (v as { trace_info?: string }).trace_info === 'string') {
        chunks.push((v as { trace_info: string }).trace_info);
      }
    }
  }
  const combined = chunks.join(' ');
  const m = combined.match(/MOS:\s*([\d.]+)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return Number.isFinite(n) ? n : null;
}
