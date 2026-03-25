import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { firstValueFrom } from 'rxjs';
import { Sbctrace } from '../entities/sbctrace.entity';
import { TelegramNotifyService } from './telegram-notify.service';
import { parseMosFromCallData } from '../utils/sbc-mos';

type SbctelcoCallTraceParams = {
  nb_result?: number;
  page?: number;
  called?: string;
  calling?: string;
  recursive?: string; // yes/no
  /** SIP Call-ID — поиск звонка по call_id (например из VoIPmonitor) */
  call_id?: string;
  /** Поиск по номеру ноги (leg_id), например other_leg_id из ответа по call_id) */
  leg_id?: string;
  /** DateTime в формате YYYY-MM-DD HH:MM:SS — фильтр звонков после этого времени */
  start?: string;
  /** DateTime в формате YYYY-MM-DD HH:MM:SS — фильтр звонков до этого времени (рекомендуется задавать) */
  end?: string;
  /** Состояние звонка, например Inactive */
  call_state?: string;
};

/** Лимит звонков для запросов по крону и fetch-and-save */
const SBC_FETCH_LIMIT = 1000;
const FETCH_WINDOW_MINUTES = 15;
const ID_DEDUP_WINDOW_MINUTES = 15;
const FETCH_WINDOW_MS = FETCH_WINDOW_MINUTES * 60 * 1000;
const ID_DEDUP_WINDOW_MS = ID_DEDUP_WINDOW_MINUTES * 60 * 1000;

@Injectable()
export class SbctelcoService {
  private readonly logger = new Logger(SbctelcoService.name);

  /** Лимит звонков при запросе за последние 2 минуты (крон и fetch-and-save) */
  readonly fetchLimit = SBC_FETCH_LIMIT;

  private readonly MOS_ALERT_THRESHOLD = (() => {
    const v = String(process.env.SBC_MOS_ALERT_THRESHOLD ?? '4').trim().replace(',', '.');
    const n = Number(v);
    return Number.isFinite(n) ? n : 4;
  })();

  private readonly baseUrl = process.env.SBCTELCO_BASE_URL || 'http://172.24.121.150:12358';
  private readonly username = process.env.SBCTELCO_USER || 'rouser';
  private readonly password = process.env.SBCTELCO_PASS || 'Ro@Sip4u2025';

  constructor(
    private readonly httpService: HttpService,
    @InjectRepository(Sbctrace) private readonly sbctraceRepo: Repository<Sbctrace>,
    private readonly telegramNotify: TelegramNotifyService,
  ) {}

  async getCallTrace(params: SbctelcoCallTraceParams) {
    const { nb_result = 2, page, called, calling, recursive = 'yes', call_id, leg_id, start, end, call_state } = params || {};

    const qs = new URLSearchParams();
    qs.set('nb_result', String(nb_result));
    if (page != null) qs.set('page', String(page));
    if (called) qs.set('called', called);
    if (calling) qs.set('calling', calling);
    if (recursive) qs.set('recursive', recursive);
    if (call_id) qs.set('call_id', call_id);
    if (leg_id) qs.set('leg_id', leg_id);
    if (start) qs.set('start', start);
    if (end) qs.set('end', end);
    if (call_state) qs.set('call_state', call_state);

    const url = `${this.baseUrl}/call_trace?${qs.toString()}`;
    const curlCommand = `curl -X GET "${url}" -u ${this.username}:*** -H "Content-Type: application/json"`;

    try {
      this.logger.log('SBCtelco call_trace request', {
        url,
        curlCommand,
        nb_result,
        page,
        called,
        calling,
        recursive,
        call_id,
        leg_id,
        start,
        end,
        call_state,
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
      return this.parseSbcDateTime(ts);
    }
    return null;
  }

  private parseConnectTimestamp(callData: any): Date | null {
    const ts = callData?.connect_timestamp;
    if (ts == null) return null;
    if (typeof ts === 'number') return new Date(ts > 1e10 ? ts : ts * 1000);
    if (typeof ts === 'string') {
      // Часто SBC отдаёт "1970/01/01 04:00:00 +0400" как «нет соединения»
      if (ts.trim().startsWith('1970/01/01')) return null;
      const d = this.parseSbcDateTime(ts);
      // Доп. защита: любые "нулевые" даты считаем отсутствием значения
      if (d && d.getUTCFullYear() <= 1971) return null;
      return d;
    }
    return null;
  }

  /** Формат SBC: "YYYY/MM/DD HH:MM:SS +0400" (или совместимые варианты). */
  private parseSbcDateTime(s: string): Date | null {
    const t = String(s).trim();
    if (!t) return null;
    // "2026/03/25 10:29:15 +0400" -> "2026-03-25T10:29:15+04:00"
    const m = t.match(/^(\d{4})\/(\d{2})\/(\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\.\d+)?\s+([+-]\d{2})(\d{2})$/);
    if (m) {
      const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}${m[5]}:${m[6]}`;
      const d = new Date(iso);
      return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  private getEndTimestampFromCallData(callData: any): Date | null {
    const traces = callData?.call_traces;
    if (!traces || typeof traces !== 'object') return null;
    let best: Date | null = null;
    for (const v of Object.values(traces)) {
      if (!v || typeof v !== 'object') continue;
      const ts = (v as any).timestamp;
      if (typeof ts !== 'string') continue;
      const d = this.parseSbcDateTime(ts);
      if (!d) continue;
      if (!best || d.getTime() > best.getTime()) best = d;
    }
    return best;
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

  /** Параметр start для запроса «звонки за последние 10 минут» в UTC+4 */
  getStartParamLastTenMinutes(): string {
    return this.formatStartParamUtc4(new Date(Date.now() - FETCH_WINDOW_MS));
  }

  /** Параметры start/end для overlap-окна за последние 15 минут (UTC+4). */
  getStartEndParamsLastFifteenMinutes(): { start: string; end: string } {
    return {
      start: this.formatStartParamUtc4(new Date(Date.now() - FETCH_WINDOW_MS)),
      end: this.formatStartParamUtc4(new Date()),
    };
  }

  /** @deprecated Используйте getStartParamLastTenMinutes. Параметр start для запроса «звонки за последние 2 минуты» в UTC+4 */
  getStartParamLastTwoMinutes(): string {
    return this.formatStartParamUtc4(new Date(Date.now() - 2 * 60 * 1000));
  }

  /** Параметр start для запроса «звонки за последние 5 минут» в UTC+4 */
  getStartParamLastFiveMinutes(): string {
    return this.formatStartParamUtc4(new Date(Date.now() - 5 * 60 * 1000));
  }

  /**
   * Для времени звонка из лога возвращает start (минус 5 мин) и end (плюс 1 мин) в UTC+4 для API SBCtelco.
   * callTime — строка даты/времени (например "2026-02-09 08:29:07.319" или "2026-01-26 09:42:41").
   */
  getStartEndForCallTime(callTime: string): { start: string; end: string } | null {
    const d = new Date(callTime.trim());
    if (Number.isNaN(d.getTime())) return null;
    const start = this.formatStartParamUtc4(new Date(d.getTime() - 5 * 60 * 1000));
    const end = this.formatStartParamUtc4(new Date(d.getTime() + 1 * 60 * 1000));
    return { start, end };
  }

  /**
   * Забрать у SBCtelco звонки за последние 10 минут (параметр start).
   * Сохранить в БД только те id, которые не сохранялись в sbctrace за последние 15 минут.
   * Возвращает количество добавленных записей.
   */
  async fetchAndSaveNewCallsFromLastMinute(): Promise<{ added: number; ids: string[] }> {
    const start = this.getStartParamLastTenMinutes();
    return this.fetchAndSaveNewCallsFromStart(start);
  }

  /** Active snapshot: раз в минуту обновить/сохранить все активные звонки (с пагинацией). */
  async fetchAndUpsertActiveSnapshot(): Promise<{ saved: number; ids: string[] }> {
    const raw = await this.getCallTraceAllPages({
      nb_result: this.fetchLimit,
      recursive: 'yes',
      call_state: 'Active',
    });
    return this.saveTracesFromResponse(raw, { defaultState: 'Active', notifyLowMos: false });
  }

  /** Inactive overlap: за окно последних 15 минут, только id не сохранённые за последние 15 минут. */
  async fetchAndSaveInactiveWithOverlap(): Promise<{ added: number; ids: string[] }> {
    const { start, end } = this.getStartEndParamsLastFifteenMinutes();
    const raw = await this.getCallTraceAllPages({
      nb_result: this.fetchLimit,
      recursive: 'yes',
      start,
      end,
      call_state: 'Inactive',
    });
    return this.filterAndSaveByRecentIds(raw, 'Inactive');
  }

  /**
   * Забрать у SBCtelco звонки за последние 2 минуты (параметр start) и сохранить в БД только новые (по id).
   * @deprecated Используйте fetchAndSaveNewCallsFromLastMinute.
   */
  async fetchAndSaveNewCallsFromLastTwoMinutes(): Promise<{ added: number; ids: string[] }> {
    const start = this.getStartParamLastTwoMinutes();
    return this.fetchAndSaveNewCallsFromStart(start);
  }

  /**
   * Забрать у SBCtelco звонки за последние 5 минут (параметр start) и сохранить в БД только новые (по id).
   * Возвращает количество добавленных записей.
   */
  async fetchAndSaveNewCallsFromLastFiveMinutes(): Promise<{ added: number; ids: string[] }> {
    const start = this.getStartParamLastFiveMinutes();
    return this.fetchAndSaveNewCallsFromStart(start);
  }

  private async fetchAndSaveNewCallsFromStart(start: string): Promise<{ added: number; ids: string[] }> {
    const raw = await this.getCallTraceAllPages({
      nb_result: this.fetchLimit,
      recursive: 'yes',
      start,
      call_state: 'Inactive',
    });
    return this.filterAndSaveByRecentIds(raw, 'Inactive');
  }

  private async filterAndSaveByRecentIds(
    raw: Record<string, unknown>,
    defaultState: 'Active' | 'Inactive',
  ): Promise<{ added: number; ids: string[] }> {
    const meta = raw?.['***meta***'];
    const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');
    if (callKeys.length === 0) return { added: 0, ids: [] };
    const cutoff = new Date(Date.now() - ID_DEDUP_WINDOW_MS);
    const recentlySaved = await this.sbctraceRepo
      .createQueryBuilder('s')
      .select('s.id', 'id')
      .where('s.id IN (:...ids)', { ids: callKeys })
      .andWhere('s.created_at >= :cutoff', { cutoff })
      .getRawMany<{ id: string }>();
    const recentSet = new Set(recentlySaved.map((r) => r.id));
    const newIds = callKeys.filter((id) => !recentSet.has(id));
    if (newIds.length === 0) return { added: 0, ids: [] };
    const rawFiltered: Record<string, unknown> = { ...(meta != null && { '***meta***': meta }) };
    for (const id of newIds) rawFiltered[id] = raw[id];
    const { saved, ids } = await this.saveTracesFromResponse(rawFiltered, { defaultState });
    return { added: saved, ids };
  }

  /** Считывает все страницы call_trace (page=1..N), пока размер страницы == nb_result. */
  private async getCallTraceAllPages(baseParams: SbctelcoCallTraceParams): Promise<Record<string, unknown>> {
    const limit = baseParams.nb_result ?? this.fetchLimit;
    const merged: Record<string, unknown> = {};
    let page = 1;
    while (true) {
      const raw = await this.getCallTrace({ ...baseParams, page });
      if (page === 1 && raw?.['***meta***'] != null) merged['***meta***'] = raw['***meta***'];
      const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');
      for (const key of callKeys) merged[key] = raw[key];
      if (callKeys.length < limit) break;
      page += 1;
      if (page > 100) break;
    }
    return merged;
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
   * Разобрать ответ call_trace и сохранить каждый звонок в sbctrace (независимо от MOS).
   * Поле mos — первое распарсенное значение из trace_info; если MOS нет в данных — null.
   * Если в батче есть звонки с MOS ниже порога, после сохранения отправляется отчёт в Telegram.
   * id записи = id звонка из JSON (например 0x0E47AC0F).
   */
  private resolveRecordId(rawKey: string, callData: any): string {
    const legId = callData?.leg_id != null ? String(callData.leg_id) : null;
    const callId = callData?.call_id != null ? String(callData.call_id) : null;
    const base = legId ? `leg:${legId}` : callId ? `call:${callId}` : `raw:${rawKey}`;
    return base.slice(0, 64);
  }

  async saveTracesFromResponse(
    raw: Record<string, unknown>,
    opts?: { defaultState?: 'Active' | 'Inactive'; notifyLowMos?: boolean },
  ): Promise<{
    saved: number;
    ids: string[];
    lowMosEntries: Array<{ id: string; calling: string | null; called: string | null; mos: number }>;
  }> {
    const meta = raw?.['***meta***'];
    const callKeys = Object.keys(raw).filter((k) => k !== '***meta***');
    const saved: Sbctrace[] = [];
    const lowMosEntries: Array<{ id: string; calling: string | null; called: string | null; mos: number }> = [];
    for (const callId of callKeys) {
      const callData = raw[callId];
      if (!callData || typeof callData !== 'object') continue;
      const mos = parseMosFromCallData(callData);
      const recordId = this.resolveRecordId(callId, callData);
      const payload: Record<string, unknown> = { ...(meta != null && { '***meta***': meta }), [callId]: callData };
      const called = (callData as any)?.called;
      const calling = (callData as any)?.calling;
      const legId = (callData as any)?.leg_id;
      const externalCallId = (callData as any)?.call_id;
      const state = (callData as any)?.call_state ?? opts?.defaultState ?? null;
      const terminateReason = (callData as any)?.terminate_reason ?? null;
      const callTimestamp = this.parseCallTimestamp(callData);
      const connectTimestamp = this.parseConnectTimestamp(callData);
      const endTimestampFromTraces = this.getEndTimestampFromCallData(callData);
      const callDurationRaw = (callData as any)?.call_duration;
      // В ответах SBCtelco поле call_duration соответствует времени разговора (talk time), а не общей длительности звонка.
      const talkDurationFromFieldSec =
        callDurationRaw == null ? null : Number.isFinite(Number(callDurationRaw)) ? Math.floor(Number(callDurationRaw)) : null;
      const existing = await this.sbctraceRepo
        .createQueryBuilder('s')
        .where('s.id = :id', { id: recordId })
        .orWhere(legId != null ? 's.leg_id = :legId' : '1=0', { legId: legId != null ? String(legId) : '' })
        .orWhere(externalCallId != null ? 's.call_id = :callId' : '1=0', {
          callId: externalCallId != null ? String(externalCallId) : '',
        })
        .orderBy('s.created_at', 'DESC')
        .getOne();
      const entity = existing ?? this.sbctraceRepo.create({ id: recordId });
      entity.payload = payload;
      entity.called = called != null ? String(called) : null;
      entity.calling = calling != null ? String(calling) : null;
      entity.legId = legId != null ? String(legId) : null;
      entity.callId = externalCallId != null ? String(externalCallId) : null;
      entity.callState = state != null ? String(state) : entity.callState ?? null;
      entity.terminateReason = terminateReason != null ? String(terminateReason) : entity.terminateReason ?? null;
      entity.callTimestamp = callTimestamp;
      entity.connectTimestamp = connectTimestamp;
      entity.lastSeenAt = new Date();
      entity.endTimestamp =
        String(entity.callState).toLowerCase() === 'inactive'
          ? endTimestampFromTraces ?? entity.endTimestamp ?? new Date()
          : entity.endTimestamp ?? null;
      // Общая длительность звонка: end - start (если обе даты известны)
      entity.callDurationSec =
        entity.endTimestamp && entity.callTimestamp
          ? Math.max(0, Math.floor((entity.endTimestamp.getTime() - entity.callTimestamp.getTime()) / 1000))
          : entity.callDurationSec ?? null;
      // Длительность разговора: из call_duration, иначе end - connect
      entity.talkDurationSec =
        talkDurationFromFieldSec != null
          ? talkDurationFromFieldSec
          : entity.endTimestamp && entity.connectTimestamp
            ? Math.max(0, Math.floor((entity.endTimestamp.getTime() - entity.connectTimestamp.getTime()) / 1000))
            : entity.talkDurationSec ?? null;
      entity.mos = mos;
      saved.push(await this.sbctraceRepo.save(entity));
      if (
        mos != null &&
        mos < this.MOS_ALERT_THRESHOLD &&
        (!existing || existing.mos == null || existing.mos >= this.MOS_ALERT_THRESHOLD)
      ) {
        lowMosEntries.push({
          id: entity.id,
          calling: calling != null ? String(calling) : null,
          called: called != null ? String(called) : null,
          mos,
        });
      }
    }
    const shouldNotify = opts?.notifyLowMos !== false;
    if (shouldNotify && lowMosEntries.length > 0) {
      await this.telegramNotify.sendSbcLowMosReport(
        lowMosEntries.map((e) => ({
          id: e.id,
          calling: e.calling,
          called: e.called,
          mos: e.mos,
        })),
      );
    }
    return { saved: saved.length, ids: saved.map((e) => e.id), lowMosEntries };
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

