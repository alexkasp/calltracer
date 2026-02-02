import { Injectable, HttpException, HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

type SbctelcoCallTraceParams = {
  nb_result?: number;
  called?: string;
  calling?: string;
  recursive?: string; // yes/no
};

@Injectable()
export class SbctelcoService {
  private readonly logger = new Logger(SbctelcoService.name);

  private readonly baseUrl = process.env.SBCTELCO_BASE_URL || 'http://172.24.121.150:12358';
  private readonly username = process.env.SBCTELCO_USER || 'rouser';
  private readonly password = process.env.SBCTELCO_PASS || 'Ro@Sip4u2025';

  constructor(private readonly httpService: HttpService) {}

  async getCallTrace(params: SbctelcoCallTraceParams) {
    const { nb_result = 2, called, calling, recursive = 'yes' } = params || {};

    if (!called && !calling) {
      throw new BadRequestException('At least one query param is required: called or calling');
    }

    const qs = new URLSearchParams();
    qs.set('nb_result', String(nb_result));
    if (called) qs.set('called', called);
    if (calling) qs.set('calling', calling);
    if (recursive) qs.set('recursive', recursive);

    const url = `${this.baseUrl}/call_trace?${qs.toString()}`;
    const curlCommand = `curl -X GET "${url}" -u ${this.username}:*** -H "Content-Type: application/json"`;

    try {
      this.logger.log('SBCtelco call_trace request', {
        url,
        curlCommand,
        nb_result,
        called,
        calling,
        recursive,
      });

      const response = await firstValueFrom(
        this.httpService.get(url, {
          auth: { username: this.username, password: this.password },
          headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        }),
      );

      const data = (response as any)?.data;
      if (!data || typeof data !== 'object') {
        const snippet =
          typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data || '').slice(0, 300);
        this.logger.error('SBCtelco returned non-JSON response', { url, snippet });
        throw new HttpException('SBCtelco returned non-JSON response', HttpStatus.BAD_GATEWAY);
      }

      return data;
    } catch (error: any) {
      this.logger.error('Error calling SBCtelco call_trace', {
        url,
        error: {
          message: error?.message,
          code: error?.code,
          response: {
            status: error?.response?.status,
            statusText: error?.response?.statusText,
            data: error?.response?.data,
          },
        },
      });

      throw new HttpException(
        'Failed to fetch call trace from SBCtelco',
        error?.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  formatCallTraceText(raw: any): string {
    if (!raw || typeof raw !== 'object') return '';

    // Ответ — объект из N элементов (любые ключи) + ***meta***. Обрабатываем по одному: для каждого — поля звонка, затем call_traces.
    const meta = raw?.['***meta***'];
    const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');

    const sortedKeys = [...callKeys].sort((a, b) => {
      const callA = raw[a];
      const callB = raw[b];
      const tsA = callA?.timestamp ? String(callA.timestamp) : '';
      const tsB = callB?.timestamp ? String(callB.timestamp) : '';
      if (tsA && tsB) return tsA.localeCompare(tsB);
      return String(a).localeCompare(String(b));
    });

    const out: string[] = [];
    out.push('--- SBCTELCO ---');
    if (meta?.version) out.push(`version: ${meta.version}`);
    out.push('');

    sortedKeys.forEach((key, index) => {
      const call = raw[key];
      if (!call || typeof call !== 'object') return;

      const legId = call?.leg_id;
      const prefix = legId != null ? `[${legId}] ` : `[${key}] `;
      out.push(`${prefix}=== Звонок ${index + 1} (${legId ?? key}) ===`);

      // Сначала выводим поля звонка
      const connectTimestamp = call?.connect_timestamp;
      const protocol = call?.protocol;
      const timestamp = call?.timestamp;
      const called = call?.called;
      const terminateReason = call?.terminate_reason;
      const interceptionLeg = call?.interception_leg;
      const nap = call?.nap;
      const callId = call?.call_id;
      const callDuration = call?.call_duration;
      const route = call?.route;
      const calling = call?.calling;

      if (legId != null) out.push(`${prefix}leg_id: ${legId}`);
      if (connectTimestamp != null) out.push(`${prefix}connect_timestamp: ${connectTimestamp}`);
      if (protocol != null) out.push(`${prefix}protocol: ${protocol}`);
      if (timestamp != null) out.push(`${prefix}timestamp: ${timestamp}`);
      if (called != null) out.push(`${prefix}called: ${called}`);
      if (calling != null) out.push(`${prefix}calling: ${calling}`);
      if (terminateReason != null) out.push(`${prefix}terminate_reason: ${terminateReason}`);
      if (interceptionLeg != null) out.push(`${prefix}interception_leg: ${interceptionLeg}`);
      if (nap != null) out.push(`${prefix}nap: ${nap}`);
      if (callId != null) out.push(`${prefix}call_id: ${callId}`);
      if (callDuration != null) out.push(`${prefix}call_duration: ${callDuration}`);
      if (route != null) out.push(`${prefix}route: ${route}`);
      out.push('');

      // Потом сортированный call_traces (исключаем ***meta*** внутри call_traces)
      const traces = call?.call_traces;
      if (traces && typeof traces === 'object') {
        out.push(`${prefix}--- call_traces ---`);
        const traceEntries = Object.entries(traces).filter(
          ([k, t]: [string, any]) => k !== '***meta***' && t && typeof t === 'object' && t.order !== undefined,
        );
        const items = traceEntries
          .map(([, t]) => t)
          .sort((a: any, b: any) => Number(a.order) - Number(b.order));

        for (const t of items as any[]) {
          const ts = t.timestamp ? String(t.timestamp) : '';
          const dir = t.direction !== undefined ? String(t.direction) : '';
          const leg = t.leg ? String(t.leg) : '';
          const info = t.trace_info ? String(t.trace_info) : '';
          const tooltip = t.trace_tooltip ? String(t.trace_tooltip) : '';

          if (!info) continue;
          out.push([info, ts, dir, tooltip, leg].filter((v) => v !== '').join(' | '));
        }
      }

      out.push('');
    });

    return out.join('\n').trim();
  }
}

