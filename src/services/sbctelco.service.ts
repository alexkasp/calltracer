import { Injectable, HttpException, HttpStatus, Logger, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Sbctrace } from '../entities/sbctrace.entity';

type SbctelcoCallTraceParams = {
  nb_result?: number;
  called?: string;
  calling?: string;
  recursive?: string; // yes/no
  /** DateTime в формате YYYY-MM-DD HH:MM:SS — фильтр звонков после этого времени */
  start?: string;
};

/** Лимит звонков для запросов по крону и fetch-and-save */
const SBC_FETCH_LIMIT = 100;

@Injectable()
export class SbctelcoService {
  private readonly logger = new Logger(SbctelcoService.name);

  /** Лимит звонков при запросе за последние 2 минуты (крон и fetch-and-save) */
  readonly fetchLimit = SBC_FETCH_LIMIT;

  private readonly baseUrl = process.env.SBCTELCO_BASE_URL || 'http://172.24.121.150:12358';
  private readonly username = process.env.SBCTELCO_USER || 'rouser';
  private readonly password = process.env.SBCTELCO_PASS || 'Ro@Sip4u2025';

  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Sbctrace) private readonly sbctraceRepo: Repository<Sbctrace>,
  ) {}

  async getCallTrace(params: SbctelcoCallTraceParams) {
    const { nb_result = 2, called, calling, recursive = 'yes', start } = params || {};

    const qs = new URLSearchParams();
    qs.set('nb_result', String(nb_result));
    if (called) qs.set('called', called);
    if (calling) qs.set('calling', calling);
    if (recursive) qs.set('recursive', recursive);
    if (start) qs.set('start', start);

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
        start,
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

  /** Парсит timestamp из данных звонка (number или string) в Date (UTC). */
  private parseCallTimestamp(callData: any): Date | null {
    const ts = callData?.timestamp;
    if (ts == null) return null;
    if (typeof ts === 'number') return new Date(ts > 1e10 ? ts : ts * 1000);
    if (typeof ts === 'string') {
      const d = new Date(ts);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    return null;
  }

  /** Форматирует Date в строку YYYY-MM-DD HH:MM:SS в поясе UTC+4 для параметра start API SBCtelco */
  private formatStartParamUtc4(date: Date): string {
    const d = new Date(date.getTime() + 4 * 60 * 60 * 1000);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');
    const h = String(d.getUTCHours()).padStart(2, '0');
    const min = String(d.getUTCMinutes()).padStart(2, '0');
    const s = String(d.getUTCSeconds()).padStart(2, '0');
    return `${y}-${m}-${day} ${h}:${min}:${s}`;
  }

  /** Параметр start для запроса «звонки за последние 2 минуты» в UTC+4 */
  getStartParamLastTwoMinutes(): string {
    return this.formatStartParamUtc4(new Date(Date.now() - 2 * 60 * 1000));
  }

  /**
   * Забрать у SBCtelco звонки за последние 2 минуты (параметр start) и сохранить в БД только новые (по id).
   * Возвращает количество добавленных записей.
   */
  async fetchAndSaveNewCallsFromLastTwoMinutes(): Promise<{ added: number; ids: string[] }> {
    const start = this.getStartParamLastTwoMinutes();
    const raw = await this.getCallTrace({
      nb_result: this.fetchLimit,
      recursive: 'yes',
      start,
    });
    const meta = raw?.['***meta***'];
    const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');
    if (callKeys.length === 0) return { added: 0, ids: [] };
    const existing = await this.sbctraceRepo.find({
      where: { id: In(callKeys) },
      select: ['id'],
    });
    const existingSet = new Set(existing.map((r) => r.id));
    const newIds = callKeys.filter((id) => !existingSet.has(id));
    if (newIds.length === 0) return { added: 0, ids: [] };
    const rawFiltered: Record<string, unknown> = { ...(meta != null && { '***meta***': meta }) };
    for (const id of newIds) rawFiltered[id] = raw[id];
    const { saved, ids } = await this.saveTracesFromResponse(rawFiltered);
    return { added: saved, ids };
  }

  /**
   * Удалить из sbctrace все записи старше 5 дней (по call_timestamp, при отсутствии — по created_at).
   * Возвращает количество удалённых записей.
   */
  async deleteOlderThanFiveDays(): Promise<number> {
    const cutoff = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    const result = await this.sbctraceRepo
      .createQueryBuilder()
      .delete()
      .from(Sbctrace)
      .where('(call_timestamp IS NOT NULL AND call_timestamp < :cutoff)', { cutoff })
      .orWhere('(call_timestamp IS NULL AND created_at < :cutoff)', { cutoff })
      .execute();
    return result.affected ?? 0;
  }

  /**
   * Разобрать ответ call_trace и сохранить каждый звонок отдельной записью.
   * id записи = id звонка из JSON (например 0x0E47AC0F).
   */
  async saveTracesFromResponse(raw: Record<string, unknown>): Promise<{ saved: number; ids: string[] }> {
    const meta = raw?.['***meta***'];
    const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');
    const saved: Sbctrace[] = [];
    for (const callId of callKeys) {
      const callData = raw[callId];
      if (!callData || typeof callData !== 'object') continue;
      const payload: Record<string, unknown> = { ...(meta != null && { '***meta***': meta }), [callId]: callData };
      const called = (callData as any)?.called;
      const calling = (callData as any)?.calling;
      const callTimestamp = this.parseCallTimestamp(callData);
      const entity = this.sbctraceRepo.create({
        id: callId,
        payload,
        called: called != null ? String(called) : null,
        calling: calling != null ? String(calling) : null,
        callTimestamp,
      });
      saved.push(await this.sbctraceRepo.save(entity));
    }
    return { saved: saved.length, ids: saved.map((e) => e.id) };
  }

  /**
   * Поиск звонков в sbctrace по calling (caller), called и/или timestamp.
   * Все фильтры опциональны, можно передать любой один или несколько.
   * timestamp_after / timestamp_before — в формате YYYY-MM-DD или YYYY-MM-DD HH:MM:SS (UTC).
   */
  async findCalls(filters: {
    calling?: string;
    called?: string;
    timestamp_after?: string;
    timestamp_before?: string;
    limit?: number;
  }): Promise<Sbctrace[]> {
    const qb = this.sbctraceRepo
      .createQueryBuilder('s')
      .orderBy('s.call_timestamp', 'DESC')
      .addOrderBy('s.created_at', 'DESC')
      .take(Math.min(filters.limit ?? 200, 500));

    if (filters.calling != null && filters.calling.trim() !== '') {
      qb.andWhere('s.calling = :calling', { calling: filters.calling.trim() });
    }
    if (filters.called != null && filters.called.trim() !== '') {
      qb.andWhere('s.called = :called', { called: filters.called.trim() });
    }
    if (filters.timestamp_after != null && filters.timestamp_after.trim() !== '') {
      const d = this.parseTimestampParam(filters.timestamp_after.trim());
      if (d) qb.andWhere('s.call_timestamp >= :tsAfter', { tsAfter: d });
    }
    if (filters.timestamp_before != null && filters.timestamp_before.trim() !== '') {
      const d = this.parseTimestampParam(filters.timestamp_before.trim());
      if (d) qb.andWhere('s.call_timestamp <= :tsBefore', { tsBefore: d });
    }

    return qb.getMany();
  }

  /** Парсит строку даты/времени (YYYY-MM-DD или YYYY-MM-DD HH:MM:SS) в Date (UTC). */
  private parseTimestampParam(s: string): Date | null {
    if (!s) return null;
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /** Получить запись sbctrace по id звонка и вывести такой же лог, как formatCallTraceText */
  async getTraceLogById(id: string): Promise<string> {
    const record = await this.sbctraceRepo.findOne({ where: { id } });
    if (!record) {
      throw new HttpException(`Sbctrace with id ${id} not found`, HttpStatus.NOT_FOUND);
    }
    return this.formatCallTraceText(record.payload ?? {});
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
          if (tooltip.trim() !== '') {
            if (dir === '1') out.push(`${prefix}--------->`);
            else if (dir === '2') out.push(`${prefix}<--------`);
          }
          out.push([info, ts, dir, tooltip, leg].filter((v) => v !== '').join(' | '));
        }
      }

      out.push('');
    });

    return out.join('\n').trim();
  }
}

