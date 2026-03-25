import { Injectable, Logger, Optional } from '@nestjs/common';
import { Repository, Like } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { CallMonitorState } from '../entities/call-monitor-state.entity';
import { TelegramNotifyService } from './telegram-notify.service';

/** Тот же API-ключ, что и для получения логов звонков (calltrace) */
const DEFAULT_API_KEY = 'f4cafb7d17a74ce5b082535ecc108533';

/** Статусы, которые считаем успешным звонком (CSR) */
const SUCCESS_STATUSES = new Set([
  'connected', 'completed', 'Answered', 'answer', 'success', 'Success',
  'CONNECTED', 'COMPLETED', 'ANSWERED', 'SUCCESS',
]);

/** Статусы неуспешных звонков (для процента и истории по типам) */
const UNSUCCESS_STATUSES = new Set([
  'outgoing missed', 'no answer', 'failed',
]);

function isUnsuccessStatus(status: string): boolean {
  const n = status.toLowerCase().trim();
  return (
    UNSUCCESS_STATUSES.has(n) ||
    n.includes('outgoing missed') ||
    n.includes('no answer') ||
    n === 'failed'
  );
}

export type CallStatusCounts = {
  total: number;
  successCount: number;
  csr: number; // Call Success Rate, 0..100
  failedCount: number;
  failedPercent: number; // процент неуспешных
  byStatus: Record<string, number>;
};

/** Хранимые в БД статистики «звонков в минуту»: скользящее среднее и m2 для дисперсии (Welford). */
export type CallsPerMinStored = {
  avg: number;
  n: number;
  m2: number;
  lastUpdated: string;
};

/** Результат: среднее и отклонение (стандартное) по типу. */
export type CallsPerMinStats = {
  avg: number;
  deviation: number; // стандартное отклонение (выборочное)
  n: number;
  lastUpdated: string | null;
  /** Текущее количество за окно (из последнего запроса API), если нет сохранённой истории — по нему считается avg */
  currentCount?: number;
};

export type SlotEmaStats = {
  avg_total: number;
  avg_failed: number;
  avg_fail_rate: number; // 0..1
  stddev_fail_rate: number; // 0..1
  samples: number; // ограничиваем до ~N дней (по умолчанию 14)
  lastUpdated: string;
};

export type AlertLevel = 'warning' | 'critical';

export type AlertState = {
  active: boolean;
  level: AlertLevel;
  lastSentAt: string; // ISO
  lastResolvedAt?: string; // ISO
  lastCheckedAt?: string; // ISO
  lastFailRate?: number;
  lastTotalCalls?: number;
  lastSlot?: number;
};

/** Недельная статистика по пользователю (звонков за неделю). */
export type WeeklyStats = {
  total: number;
  failed: number;
  lastUpdated: string;
};

@Injectable()
export class CallMonitorService {
  private readonly logger = new Logger(CallMonitorService.name);
  private readonly apiKey = process.env.CONVOLO_API_KEY || DEFAULT_API_KEY;
  private readonly ipmaxiStatUrl = 'https://api.ipmaxi.convolo.ai/api/v1/partner/stat/calls/recent';
  private readonly leadsCallsRecentUrl = 'https://api.leads.convolo.ai/api/v1/partner/calls/recent';

  private readonly TELEGRAM_ALERTS_ENABLED = (() => {
    const v = String(process.env.CALL_MONITOR_TELEGRAM_ALERTS_ENABLED ?? 'true').trim().toLowerCase();
    return !(v === 'false' || v === '0' || v === 'off' || v === 'no');
  })();

  private readonly EMA_ALPHA = (() => {
    const v = String(process.env.CALL_MONITOR_EMA_ALPHA ?? '0.1').trim();
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 1 ? n : 0.1;
  })();
  private readonly EMA_SAMPLES_CAP = (() => {
    const v = Number(process.env.CALL_MONITOR_EMA_SAMPLES_CAP ?? 14);
    return Number.isFinite(v) && v >= 1 && v <= 365 ? Math.floor(v) : 14;
  })();

  private readonly ALERT_MIN_TOTAL_5MIN = (() => {
    const v = Number(process.env.CALL_MONITOR_ALERT_MIN_TOTAL ?? 5);
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 5;
  })();
  private readonly ALERT_MIN_FAIL_RATE = (() => {
    const v = Number(process.env.CALL_MONITOR_ALERT_MIN_FAIL_RATE ?? 0.15);
    return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.15;
  })();
  private readonly ALERT_K_WARNING = (() => {
    const v = Number(process.env.CALL_MONITOR_ALERT_K_WARNING ?? 2);
    return Number.isFinite(v) && v > 0 ? v : 2;
  })();
  private readonly ALERT_K_CRITICAL = (() => {
    const v = Number(process.env.CALL_MONITOR_ALERT_K_CRITICAL ?? 3);
    return Number.isFinite(v) && v > 0 ? v : 3;
  })();
  private readonly ALERT_COOLDOWN_MIN = (() => {
    const v = Number(process.env.CALL_MONITOR_ALERT_COOLDOWN_MIN ?? 15);
    return Number.isFinite(v) && v >= 1 ? Math.floor(v) : 15;
  })();

  constructor(
    @InjectRepository(CallMonitorState)
    private readonly stateRepo: Repository<CallMonitorState>,
    private readonly httpService: HttpService,
    @Optional() private readonly telegramNotify?: TelegramNotifyService,
  ) {}

  /**
   * Получить значение по ключу из служебных данных.
   */
  async getState<T = unknown>(key: string): Promise<T | null> {
    const row = await this.stateRepo.findOne({ where: { key } });
    return row?.value != null ? (row.value as T) : null;
  }

  /**
   * Записать значение по ключу (создаёт или обновляет запись).
   */
  async setState(key: string, value: unknown): Promise<void> {
    const existing = await this.stateRepo.findOne({ where: { key } });
    if (existing) {
      existing.value = value;
      await this.stateRepo.save(existing);
    } else {
      await this.stateRepo.save(this.stateRepo.create({ key, value }));
    }
  }

  /**
   * Статистика по звонкам Dialer за последние N минут.
   * POST https://api.ipmaxi.convolo.ai/api/v1/partner/stat/calls/recent
   */
  async getDialerCallsRecentStat(minutes: number = 5): Promise<unknown> {
    const url = `${this.ipmaxiStatUrl}?api-key=${this.apiKey}`;
    try {
      const response = await firstValueFrom(
        this.httpService.post(url, { minutes }, {
          headers: { 'Content-Type': 'application/json' },
        }),
      );
      return (response as any)?.data ?? response;
    } catch (err: any) {
      this.logger.warn('getDialerCallsRecentStat failed', {
        minutes,
        message: err?.message,
        status: err?.response?.status,
      });
      throw err;
    }
  }

  /**
   * Звонки S2L за последние N минут.
   * GET https://api.leads.convolo.ai/api/v1/partner/calls/recent?minutes=...
   */
  async getS2LCallsRecent(minutes: number = 5): Promise<unknown> {
    const url = `${this.leadsCallsRecentUrl}?api-key=${this.apiKey}&minutes=${minutes}`;
    try {
      const response = await firstValueFrom(
        this.httpService.get(url),
      );
      return (response as any)?.data ?? response;
    } catch (err: any) {
      this.logger.warn('getS2LCallsRecent failed', {
        minutes,
        message: err?.message,
        status: err?.response?.status,
      });
      throw err;
    }
  }

  /**
   * Получить данные по звонкам: статистика Dialer (5 мин) + звонки S2L (5 мин).
   */
  async getCallsData(): Promise<{
    dialer: unknown;
    s2l: unknown;
  }> {
    const [dialer, s2l] = await Promise.all([
      this.getDialerCallsRecentStat(5),
      this.getS2LCallsRecent(5),
    ]);
    return { dialer, s2l };
  }

  /**
   * Извлечь массив звонков из ответа API (поддержка data/calls/items или вложенного data.calls).
   */
  private extractCallsList(raw: any): Array<{ callStatus?: string }> {
    if (!raw) return [];
    if (Array.isArray(raw)) return raw;
    const arr =
      raw.calls ??
      raw.data?.calls ??
      raw.result?.calls ??
      raw.data ??
      raw.items ??
      raw.list ??
      raw.results;
    return Array.isArray(arr) ? arr : [];
  }

  /**
   * Получить callStatus из элемента звонка (callStatus или call_status).
   */
  private getCallStatus(item: any): string {
    const s = item?.callStatus ?? item?.call_status ?? item?.status ?? '';
    return typeof s === 'string' ? s.trim() : String(s ?? '');
  }

  /**
   * Время начала звонка из элемента (startTime / start_time).
   */
  private getCallStartTime(item: any): Date | null {
    const t = item?.startTime ?? item?.start_time ?? item?.timestamp;
    if (t == null) return null;
    const d = typeof t === 'string' ? new Date(t) : new Date(Number(t));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  /**
   * Оставить только звонки, у которых startTime попадает в последние windowMinutes минут.
   */
  private filterCallsByWindow(
    calls: Array<Record<string, unknown>>,
    windowMinutes: number,
  ): Array<{ callStatus?: string }> {
    if (windowMinutes <= 0) return [];
    const cutoff = Date.now() - windowMinutes * 60 * 1000;
    return calls.filter((item) => {
      const t = this.getCallStartTime(item);
      return t != null && t.getTime() >= cutoff;
    }) as Array<{ callStatus?: string }>;
  }

  /**
   * Посчитать по массиву звонков: разбивка по callStatus, CSR и процент неуспешных.
   */
  computeCsrFromCalls(calls: Array<{ callStatus?: string }>): CallStatusCounts {
    const byStatus: Record<string, number> = {};
    let successCount = 0;
    let failedCount = 0;
    for (const item of calls) {
      const status = this.getCallStatus(item) || '(empty)';
      const normalized = status.toLowerCase().trim();
      byStatus[status] = (byStatus[status] ?? 0) + 1;
      if (SUCCESS_STATUSES.has(status) || SUCCESS_STATUSES.has(normalized)) successCount++;
      else if (isUnsuccessStatus(status)) failedCount++;
    }
    const total = calls.length;
    const csr = total > 0 ? Math.round((successCount / total) * 10000) / 100 : 0;
    const failedPercent = total > 0 ? Math.round((failedCount / total) * 10000) / 100 : 0;
    return { total, successCount, csr, failedCount, failedPercent, byStatus };
  }

  /**
   * CSR по скользящим окнам 5/15/60 минут для Dialer и S2L.
   * Один запрос на тип (за 60 мин), окна считаются по полю startTime.
   */
  async getCsr(): Promise<{
    dialer: Record<string, CallStatusCounts>;
    s2l: Record<string, CallStatusCounts>;
  }> {
    const [dialerRaw, s2lRaw] = await Promise.all([
      this.getDialerCallsRecentStat(60),
      this.getS2LCallsRecent(60),
    ]);
    const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
    const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;

    const dialer: Record<string, CallStatusCounts> = {};
    const s2l: Record<string, CallStatusCounts> = {};
    for (const w of [5, 15, 60]) {
      dialer[String(w)] = this.computeCsrFromCalls(this.filterCallsByWindow(dialerCalls, w));
      s2l[String(w)] = this.computeCsrFromCalls(this.filterCallsByWindow(s2lCalls, w));
    }
    return { dialer, s2l };
  }

  // Legacy keys (без слотов) — оставлены для обратной совместимости чтения
  private readonly CALLS_PER_MIN_KEY_DIALER_LEGACY = 'dialer_calls_per_min_stats';
  private readonly CALLS_PER_MIN_KEY_S2L_LEGACY = 's2l_calls_per_min_stats';

  /**
   * Делим сутки на 48 слотов по 30 минут.
   * slot = (hour * 60 + minute) // 30
   */
  private getSlot(d: Date = new Date()): number {
    const minutes = d.getHours() * 60 + d.getMinutes();
    return Math.floor(minutes / 30);
  }

  private callsPerMinStateKey(source: 'dialer' | 's2l', slot: number): string {
    return `${source}_calls_per_min_stats_slot_${slot}`;
  }

  private slotEmaStateKey(source: 'dialer' | 's2l', slot: number): string {
    return `${source}_slot_${slot}_ema_v1`;
  }

  private slotEmaUserStateKey(source: 'dialer' | 's2l', slot: number, userId: string): string {
    // userId может содержать спецсимволы — кодируем, чтобы ключи были стабильными и безопасными
    const safe = encodeURIComponent(String(userId).trim());
    return `${source}_slot_${slot}_user_${safe}_ema_v1`;
  }

  private slotLastSeenKey(source: 'dialer' | 's2l'): string {
    return `${source}_slot_last_seen_v1`;
  }

  private alertStateKey(source: 'dialer' | 's2l'): string {
    return `${source}_failrate_alert_state_v1`;
  }

  /** Неделя по дате: понедельник в формате YYYY-MM-DD. */
  private getWeekKey(d: Date): string {
    const t = new Date(d);
    t.setHours(0, 0, 0, 0);
    const day = t.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    t.setDate(t.getDate() + diff);
    return t.toISOString().slice(0, 10);
  }

  private weeklyStateKey(source: 'dialer' | 's2l', userId: string, weekKey: string): string {
    const safe = encodeURIComponent(String(userId).trim());
    return `weekly_${source}_${safe}_${weekKey}_v1`;
  }

  private weeklyWeeksListKey(source: 'dialer' | 's2l', userId: string): string {
    const safe = encodeURIComponent(String(userId).trim());
    return `weekly_weeks_${source}_${safe}_v1`;
  }

  private weeklyUsersListKey(source: 'dialer' | 's2l'): string {
    return `weekly_users_list_${source}_v1`;
  }

  /**
   * Ключи последних 4 недель (понедельники): [последняя неделя, 2 недели назад, 3, 4].
   */
  private getLast4WeekKeys(): string[] {
    const out: string[] = [];
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    for (let i = 0; i < 4; i++) {
      out.push(this.getWeekKey(d));
      d.setDate(d.getDate() - 7);
    }
    return out;
  }

  /**
   * Накопить звонки за недели: сгруппировать по (userId, weekKey), добавить к сохранённым в БД.
   * cutoffTime: учитывать только звонки с startTime > cutoffTime (чтобы не дублировать при каждом запуске крона).
   */
  private async aggregateAndSaveWeeklyStats(
    source: 'dialer' | 's2l',
    calls: Array<Record<string, unknown>>,
    cutoffTime: Date | null,
  ): Promise<void> {
    const cutoff = cutoffTime ? cutoffTime.getTime() : 0;
    const byKey = new Map<string, { total: number; failed: number }>();
    for (const c of calls) {
      const t = this.getCallStartTime(c);
      if (!t || t.getTime() <= cutoff) continue;
      const uid = this.getUserId(c);
      if (!uid) continue;
      const weekKey = this.getWeekKey(t);
      const key = `${uid}\t${weekKey}`;
      const cur = byKey.get(key) ?? { total: 0, failed: 0 };
      cur.total += 1;
      if (isUnsuccessStatus(this.getCallStatus(c))) cur.failed += 1;
      byKey.set(key, cur);
    }
    const nowIso = new Date().toISOString();
    const seenUids = new Set<string>();
    for (const [combo, delta] of byKey.entries()) {
      const [uid, weekKey] = combo.split('\t');
      seenUids.add(uid);
      const stateKey = this.weeklyStateKey(source, uid, weekKey);
      const existing = await this.getState<WeeklyStats>(stateKey);
      const total = (existing?.total ?? 0) + delta.total;
      const failed = (existing?.failed ?? 0) + delta.failed;
      await this.setState(stateKey, { total, failed, lastUpdated: nowIso });
      const listKey = this.weeklyWeeksListKey(source, uid);
      const weeks = (await this.getState<string[]>(listKey)) ?? [];
      if (!weeks.includes(weekKey)) {
        weeks.push(weekKey);
        weeks.sort();
        await this.setState(listKey, weeks);
      }
    }
    if (seenUids.size > 0) {
      const usersListKey = this.weeklyUsersListKey(source);
      const users = (await this.getState<string[]>(usersListKey)) ?? [];
      let changed = false;
      for (const uid of seenUids) {
        if (!users.includes(uid)) {
          users.push(uid);
          changed = true;
        }
      }
      if (changed) await this.setState(usersListKey, users);
    }
  }

  async getSlotEmaAll(): Promise<{
    slot: number;
    dialer: Record<string, SlotEmaStats | null>;
    s2l: Record<string, SlotEmaStats | null>;
  }> {
    const slot = this.getSlot();
    const dialer: Record<string, SlotEmaStats | null> = {};
    const s2l: Record<string, SlotEmaStats | null> = {};
    const slots = Array.from({ length: 48 }, (_, i) => i);
    await Promise.all([
      (async () => {
        for (const i of slots) {
          dialer[`slot_${i}`] = await this.getState<SlotEmaStats>(this.slotEmaStateKey('dialer', i));
        }
      })(),
      (async () => {
        for (const i of slots) {
          s2l[`slot_${i}`] = await this.getState<SlotEmaStats>(this.slotEmaStateKey('s2l', i));
        }
      })(),
    ]);
    return { slot, dialer, s2l };
  }

  /**
   * Резюме отклонения fail_rate по пользователям от их слотовой нормы.
   * thresholdPct — порог в процентных пунктах (например 20 = отклонение ≥20 п.п.).
   * Сравнение: текущие 5 мин по пользователю vs EMA по текущему слоту для этого пользователя.
   * В резюме попадают только пользователи, у которых в последние 5 мин был хотя бы один звонок.
   * Отдельно возвращаются пользователи, у которых были звонки за 60 мин, но за 5 мин — 0 (для них fail rate не считается).
   */
  async getDeviationSummary(thresholdPct: number = 20): Promise<{
    slot: number;
    thresholdPct: number;
    windowMinutes: number;
    dialer: Array<{
      userId: string;
      currentTotal: number;
      currentFailed: number;
      currentFailRate: number;
      avgFailRate: number | null;
      deviationPct: number | null;
      aboveThreshold: boolean;
    }>;
    s2l: Array<{
      userId: string;
      currentTotal: number;
      currentFailed: number;
      currentFailRate: number;
      avgFailRate: number | null;
      deviationPct: number | null;
      aboveThreshold: boolean;
    }>;
    aboveThresholdDialer: Array<{ userId: string; deviationPct: number; currentFailRate: number; avgFailRate: number }>;
    aboveThresholdS2l: Array<{ userId: string; deviationPct: number; currentFailRate: number; avgFailRate: number }>;
    /** Пользователи с звонками за 60 мин, но без звонков за 5 мин (по ним есть EMA, но текущий fail rate не определён) */
    noCallsIn5MinDialer: Array<{ userId: string; avgTotal: number; avgFailRate: number }>;
    noCallsIn5MinS2l: Array<{ userId: string; avgTotal: number; avgFailRate: number }>;
  }> {
    const slot = this.getSlot();
    const threshold = thresholdPct / 100;
    const [dialerRaw, s2lRaw] = await Promise.all([
      this.getDialerCallsRecentStat(60),
      this.getS2LCallsRecent(60),
    ]);
    const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
    const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;
    const dialer5 = this.filterCallsByWindow(dialerCalls, 5);
    const s2l5 = this.filterCallsByWindow(s2lCalls, 5);

    const buildPerUser = async (
      calls: Array<Record<string, unknown>>,
      source: 'dialer' | 's2l',
    ): Promise<Array<{
      userId: string;
      currentTotal: number;
      currentFailed: number;
      currentFailRate: number;
      avgFailRate: number | null;
      deviationPct: number | null;
      aboveThreshold: boolean;
    }>> => {
      const byUser = new Map<string, Array<Record<string, unknown>>>();
      for (const c of calls) {
        const uid = this.getUserId(c);
        if (!uid) continue;
        const arr = byUser.get(uid) ?? [];
        arr.push(c);
        byUser.set(uid, arr);
      }
      const result: Array<{
        userId: string;
        currentTotal: number;
        currentFailed: number;
        currentFailRate: number;
        avgFailRate: number | null;
        deviationPct: number | null;
        aboveThreshold: boolean;
      }> = [];
      for (const [uid, userCalls] of byUser.entries()) {
        const { total: currentTotal, failed: currentFailed, failRate: currentFailRate } =
          this.computeFailRateFromCalls(userCalls);
        const ema = await this.getState<SlotEmaStats>(this.slotEmaUserStateKey(source, slot, uid));
        const avgFailRate = ema ? ema.avg_fail_rate : null;
        const deviationPct =
          avgFailRate != null ? (currentFailRate - avgFailRate) * 100 : null;
        const aboveThreshold =
          deviationPct != null && deviationPct >= thresholdPct;
        result.push({
          userId: uid,
          currentTotal,
          currentFailed,
          currentFailRate,
          avgFailRate,
          deviationPct: deviationPct != null ? Math.round(deviationPct * 100) / 100 : null,
          aboveThreshold,
        });
      }
      return result.sort((a, b) => (b.deviationPct ?? -Infinity) - (a.deviationPct ?? -Infinity));
    };

    const dialer = await buildPerUser(dialer5, 'dialer');
    const s2l = await buildPerUser(s2l5, 's2l');
    const aboveThresholdDialer = dialer
      .filter((r) => r.aboveThreshold && r.avgFailRate != null && r.deviationPct != null)
      .map((r) => ({
        userId: r.userId,
        deviationPct: r.deviationPct!,
        currentFailRate: r.currentFailRate,
        avgFailRate: r.avgFailRate!,
      }));
    const aboveThresholdS2l = s2l
      .filter((r) => r.aboveThreshold && r.avgFailRate != null && r.deviationPct != null)
      .map((r) => ({
        userId: r.userId,
        deviationPct: r.deviationPct!,
        currentFailRate: r.currentFailRate,
        avgFailRate: r.avgFailRate!,
      }));

    const userIds5Dialer = new Set(dialer5.map((c) => this.getUserId(c)).filter(Boolean) as string[]);
    const userIds5S2l = new Set(s2l5.map((c) => this.getUserId(c)).filter(Boolean) as string[]);
    const byUser60Dialer = new Map<string, Array<Record<string, unknown>>>();
    const byUser60S2l = new Map<string, Array<Record<string, unknown>>>();
    for (const c of dialerCalls) {
      const uid = this.getUserId(c);
      if (!uid) continue;
      const arr = byUser60Dialer.get(uid) ?? [];
      arr.push(c);
      byUser60Dialer.set(uid, arr);
    }
    for (const c of s2lCalls) {
      const uid = this.getUserId(c);
      if (!uid) continue;
      const arr = byUser60S2l.get(uid) ?? [];
      arr.push(c);
      byUser60S2l.set(uid, arr);
    }
    const noCallsIn5MinDialer: Array<{ userId: string; avgTotal: number; avgFailRate: number }> = [];
    const noCallsIn5MinS2l: Array<{ userId: string; avgTotal: number; avgFailRate: number }> = [];
    for (const uid of byUser60Dialer.keys()) {
      if (userIds5Dialer.has(uid)) continue;
      const ema = await this.getState<SlotEmaStats>(this.slotEmaUserStateKey('dialer', slot, uid));
      if (ema && (ema.avg_total > 0 || ema.samples > 0)) {
        noCallsIn5MinDialer.push({
          userId: uid,
          avgTotal: ema.avg_total,
          avgFailRate: ema.avg_fail_rate,
        });
      }
    }
    for (const uid of byUser60S2l.keys()) {
      if (userIds5S2l.has(uid)) continue;
      const ema = await this.getState<SlotEmaStats>(this.slotEmaUserStateKey('s2l', slot, uid));
      if (ema && (ema.avg_total > 0 || ema.samples > 0)) {
        noCallsIn5MinS2l.push({
          userId: uid,
          avgTotal: ema.avg_total,
          avgFailRate: ema.avg_fail_rate,
        });
      }
    }

    return {
      slot,
      thresholdPct,
      windowMinutes: 5,
      dialer,
      s2l,
      aboveThresholdDialer,
      aboveThresholdS2l,
      noCallsIn5MinDialer,
      noCallsIn5MinS2l,
    };
  }

  /**
   * Отчёт за недели по пользователю: сколько звонков (total, failed) за каждую неделю мониторинга.
   */
  async getWeeklyReportByUser(userId: string): Promise<{
    userId: string;
    dialer: Array<{ week: string; total: number; failed: number; lastUpdated: string }>;
    s2l: Array<{ week: string; total: number; failed: number; lastUpdated: string }>;
  }> {
    const uid = String(userId ?? '').trim();
    const dialerWeeks = (await this.getState<string[]>(this.weeklyWeeksListKey('dialer', uid))) ?? [];
    const s2lWeeks = (await this.getState<string[]>(this.weeklyWeeksListKey('s2l', uid))) ?? [];
    const dialer: Array<{ week: string; total: number; failed: number; lastUpdated: string }> = [];
    const s2l: Array<{ week: string; total: number; failed: number; lastUpdated: string }> = [];
    for (const week of dialerWeeks) {
      const s = await this.getState<WeeklyStats>(this.weeklyStateKey('dialer', uid, week));
      if (s) dialer.push({ week, total: s.total, failed: s.failed, lastUpdated: s.lastUpdated });
    }
    for (const week of s2lWeeks) {
      const s = await this.getState<WeeklyStats>(this.weeklyStateKey('s2l', uid, week));
      if (s) s2l.push({ week, total: s.total, failed: s.failed, lastUpdated: s.lastUpdated });
    }
    dialer.sort((a, b) => a.week.localeCompare(b.week));
    s2l.sort((a, b) => a.week.localeCompare(b.week));
    return { userId: uid, dialer, s2l };
  }

  /**
   * Отчёт за 4 недели: изменение звонков по пользователям.
   * В отчёт попадают клиенты, у которых разница между максимальным числом звонков за 4 недели и последней неделей
   * больше thresholdPct процентов от последней недели (по умолчанию 20%).
   * Условие: (max - lastWeek) > thresholdPct% * lastWeek (или lastWeek = 0 и max > 0).
   */
  async getWeeklyChangeReport4Weeks(thresholdPct: number = 20): Promise<{
    weekKeys: string[];
    thresholdPct: number;
    dialer: Array<{
      userId: string;
      last4Weeks: number[];
      max: number;
      lastWeek: number;
      diff: number;
      diffPct: number | null;
      aboveThreshold: boolean;
    }>;
    s2l: Array<{
      userId: string;
      last4Weeks: number[];
      max: number;
      lastWeek: number;
      diff: number;
      diffPct: number | null;
      aboveThreshold: boolean;
    }>;
    aboveThresholdDialer: Array<{ userId: string; last4Weeks: number[]; max: number; lastWeek: number; diffPct: number }>;
    aboveThresholdS2l: Array<{ userId: string; last4Weeks: number[]; max: number; lastWeek: number; diffPct: number }>;
  }> {
    const weekKeys = this.getLast4WeekKeys();
    const threshold = thresholdPct / 100;

    for (const source of ['dialer', 's2l'] as const) {
      let list = await this.getState<string[]>(this.weeklyUsersListKey(source));
      if (!list || list.length === 0) {
        const prefix = `weekly_weeks_${source}_`;
        const suffix = '_v1';
        const rows = await this.stateRepo.find({ where: { key: Like(prefix + '%') } });
        const userIds = new Set<string>();
        for (const row of rows) {
          const k = String((row as any).key ?? '');
          if (k.startsWith(prefix) && k.endsWith(suffix)) {
            try {
              const encoded = k.slice(prefix.length, k.length - suffix.length);
              userIds.add(decodeURIComponent(encoded));
            } catch {
              // ignore malformed
            }
          }
        }
        list = Array.from(userIds);
        if (list.length > 0) await this.setState(this.weeklyUsersListKey(source), list);
      }
    }

    const build = async (
      source: 'dialer' | 's2l',
    ): Promise<Array<{
      userId: string;
      last4Weeks: number[];
      max: number;
      lastWeek: number;
      diff: number;
      diffPct: number | null;
      aboveThreshold: boolean;
    }>> => {
      const userIds = (await this.getState<string[]>(this.weeklyUsersListKey(source))) ?? [];
      const result: Array<{
        userId: string;
        last4Weeks: number[];
        max: number;
        lastWeek: number;
        diff: number;
        diffPct: number | null;
        aboveThreshold: boolean;
      }> = [];
      for (const uid of userIds) {
        const last4Weeks: number[] = [];
        for (const weekKey of weekKeys) {
          const s = await this.getState<WeeklyStats>(this.weeklyStateKey(source, uid, weekKey));
          last4Weeks.push(s?.total ?? 0);
        }
        const max = Math.max(...last4Weeks);
        const lastWeek = last4Weeks[0] ?? 0;
        const diff = max - lastWeek;
        const diffPct = lastWeek > 0 ? (diff / lastWeek) * 100 : (max > 0 ? 100 : null);
        const aboveThreshold =
          (lastWeek === 0 && max > 0) || (lastWeek > 0 && diff > threshold * lastWeek);
        result.push({
          userId: uid,
          last4Weeks,
          max,
          lastWeek,
          diff,
          diffPct: diffPct != null ? Math.round(diffPct * 100) / 100 : null,
          aboveThreshold,
        });
      }
      return result.sort((a, b) => (b.diffPct ?? 0) - (a.diffPct ?? 0));
    };

    const dialer = await build('dialer');
    const s2l = await build('s2l');
    const aboveThresholdDialer = dialer
      .filter((r) => r.aboveThreshold && r.diffPct != null)
      .map((r) => ({ userId: r.userId, last4Weeks: r.last4Weeks, max: r.max, lastWeek: r.lastWeek, diffPct: r.diffPct! }));
    const aboveThresholdS2l = s2l
      .filter((r) => r.aboveThreshold && r.diffPct != null)
      .map((r) => ({ userId: r.userId, last4Weeks: r.last4Weeks, max: r.max, lastWeek: r.lastWeek, diffPct: r.diffPct! }));

    return {
      weekKeys,
      thresholdPct,
      dialer,
      s2l,
      aboveThresholdDialer,
      aboveThresholdS2l,
    };
  }

  async getSlotEmaByUser(userId: string): Promise<{
    slot: number;
    userId: string;
    dialer: Record<string, SlotEmaStats | null>;
    s2l: Record<string, SlotEmaStats | null>;
  }> {
    const slot = this.getSlot();
    const dialer: Record<string, SlotEmaStats | null> = {};
    const s2l: Record<string, SlotEmaStats | null> = {};
    const slots = Array.from({ length: 48 }, (_, i) => i);
    const uid = String(userId ?? '').trim();
    await Promise.all([
      (async () => {
        for (const i of slots) {
          dialer[`slot_${i}`] = await this.getState<SlotEmaStats>(this.slotEmaUserStateKey('dialer', i, uid));
        }
      })(),
      (async () => {
        for (const i of slots) {
          s2l[`slot_${i}`] = await this.getState<SlotEmaStats>(this.slotEmaUserStateKey('s2l', i, uid));
        }
      })(),
    ]);
    return { slot, userId: uid, dialer, s2l };
  }

  private unsuccessStateKey(
    source: 'dialer' | 's2l',
    windowMin: number,
    failureType: string,
    slot: number,
  ): string {
    return `${source}_unsuccess_${windowMin}_${failureType}_slot_${slot}`;
  }

  private unsuccessStateKeyLegacy(source: 'dialer' | 's2l', windowMin: number, failureType: string): string {
    return `${source}_unsuccess_${windowMin}_${failureType}`;
  }

  private filterCallsByRange(
    calls: Array<Record<string, unknown>>,
    startIncl: Date,
    endExcl: Date,
  ): Array<Record<string, unknown>> {
    const s = startIncl.getTime();
    const e = endExcl.getTime();
    return calls.filter((item) => {
      const t = this.getCallStartTime(item);
      const ms = t?.getTime();
      return ms != null && ms >= s && ms < e;
    });
  }

  private getUserId(item: any): string | null {
    const v = item?.userId ?? item?.user_id ?? item?.user?.id ?? item?.user?.userId ?? null;
    if (v == null) return null;
    const s = typeof v === 'string' ? v.trim() : String(v);
    return s ? s : null;
  }

  private computeFailRateFromCalls(calls: Array<Record<string, unknown>>): { total: number; failed: number; failRate: number } {
    const stat = this.computeCsrFromCalls(calls as Array<{ callStatus?: string }>);
    const total = stat.total;
    const failed = stat.failedCount;
    const failRate = total > 0 ? failed / total : 0;
    return { total, failed, failRate };
  }

  private async updateSlotEmaByKey(
    key: string,
    totalCalls: number,
    failedCalls: number,
  ): Promise<SlotEmaStats> {
    const old = await this.getState<SlotEmaStats>(key);
    const nowIso = new Date().toISOString();
    const newFailRate = totalCalls > 0 ? failedCalls / totalCalls : 0;

    if (!old) {
      const init: SlotEmaStats = {
        avg_total: totalCalls,
        avg_failed: failedCalls,
        avg_fail_rate: newFailRate,
        stddev_fail_rate: 0,
        samples: 1,
        lastUpdated: nowIso,
      };
      await this.setState(key, init);
      return init;
    }

    const alpha = this.EMA_ALPHA;
    const avg_fail_rate = alpha * newFailRate + (1 - alpha) * (old.avg_fail_rate ?? 0);
    const avg_total = alpha * totalCalls + (1 - alpha) * (old.avg_total ?? 0);
    const avg_failed = alpha * failedCalls + (1 - alpha) * (old.avg_failed ?? 0);
    const oldStd = old.stddev_fail_rate ?? 0;
    const stddev_fail_rate = Math.sqrt(
      alpha * Math.pow(newFailRate - avg_fail_rate, 2) + (1 - alpha) * Math.pow(oldStd, 2),
    );

    const updated: SlotEmaStats = {
      avg_total: Math.round(avg_total * 1000) / 1000,
      avg_failed: Math.round(avg_failed * 1000) / 1000,
      avg_fail_rate: Math.round(avg_fail_rate * 100000) / 100000,
      stddev_fail_rate: Math.round(stddev_fail_rate * 100000) / 100000,
      samples: Math.min(this.EMA_SAMPLES_CAP, Math.max(1, Math.floor((old.samples ?? 0) + 1))),
      lastUpdated: nowIso,
    };
    await this.setState(key, updated);
    return updated;
  }

  private async updateSlotEma(
    source: 'dialer' | 's2l',
    slot: number,
    totalCalls: number,
    failedCalls: number,
  ): Promise<SlotEmaStats> {
    return this.updateSlotEmaByKey(this.slotEmaStateKey(source, slot), totalCalls, failedCalls);
  }

  private async maybeFinalizeSlotEmaFrom60m(
    source: 'dialer' | 's2l',
    calls60m: Array<Record<string, unknown>>,
    now: Date,
  ): Promise<void> {
    const currentSlot = this.getSlot(now);
    const lastSeen = await this.getState<number>(this.slotLastSeenKey(source));
    if (typeof lastSeen !== 'number') {
      await this.setState(this.slotLastSeenKey(source), currentSlot);
      return;
    }
    if (lastSeen === currentSlot) return;

    const slotEnd = new Date(now.getTime());
    slotEnd.setMinutes(slotEnd.getMinutes() - (slotEnd.getMinutes() % 30), 0, 0);
    const slotStart = new Date(slotEnd.getTime() - 30 * 60 * 1000);
    const endedSlot = (currentSlot + 47) % 48;

    const callsInSlot = this.filterCallsByRange(calls60m, slotStart, slotEnd);
    const { total, failed } = this.computeFailRateFromCalls(callsInSlot);
    await this.updateSlotEma(source, endedSlot, total, failed);

    // Персональная EMA по каждому userId
    const byUser = new Map<string, Array<Record<string, unknown>>>();
    for (const c of callsInSlot) {
      const uid = this.getUserId(c);
      if (!uid) continue;
      const arr = byUser.get(uid);
      if (arr) arr.push(c);
      else byUser.set(uid, [c]);
    }
    for (const [uid, userCalls] of byUser.entries()) {
      const r = this.computeFailRateFromCalls(userCalls);
      await this.updateSlotEmaByKey(this.slotEmaUserStateKey(source, endedSlot, uid), r.total, r.failed);
    }

    await this.setState(this.slotLastSeenKey(source), currentSlot);
  }

  private async evaluateFailRateAlert(
    source: 'dialer' | 's2l',
    slot: number,
    currentTotal5: number,
    currentFailRate5: number,
  ): Promise<void> {
    const now = new Date();
    const nowMs = now.getTime();
    const stateKey = this.alertStateKey(source);
    const old = await this.getState<AlertState>(stateKey);

    const hist = await this.getState<SlotEmaStats>(this.slotEmaStateKey(source, slot));
    const avg = hist?.avg_fail_rate ?? null;
    const std = hist?.stddev_fail_rate ?? null;

    const enoughVolume = currentTotal5 >= this.ALERT_MIN_TOTAL_5MIN;
    const absMin = currentFailRate5 > this.ALERT_MIN_FAIL_RATE;

    const warningThreshold =
      avg != null && std != null ? avg + this.ALERT_K_WARNING * std : Number.POSITIVE_INFINITY;
    const criticalThreshold =
      avg != null && std != null ? avg + this.ALERT_K_CRITICAL * std : Number.POSITIVE_INFINITY;

    const isCritical = enoughVolume && absMin && currentFailRate5 > criticalThreshold;
    const isWarning = enoughVolume && absMin && currentFailRate5 > warningThreshold;
    const level: AlertLevel | null = isCritical ? 'critical' : isWarning ? 'warning' : null;

    const cooldownOk = (() => {
      if (!old?.lastSentAt) return true;
      const last = new Date(old.lastSentAt).getTime();
      if (!Number.isFinite(last)) return true;
      return nowMs - last >= this.ALERT_COOLDOWN_MIN * 60 * 1000;
    })();

    if (old?.active && !level) {
      this.logger.log('CallMonitor alert RESOLVED', { source, slot, currentTotal5, currentFailRate5, avg, std });
      const next: AlertState = {
        active: false,
        level: old.level ?? 'warning',
        lastSentAt: old.lastSentAt,
        lastResolvedAt: now.toISOString(),
        lastCheckedAt: now.toISOString(),
        lastFailRate: currentFailRate5,
        lastTotalCalls: currentTotal5,
        lastSlot: slot,
      };
      await this.setState(stateKey, next);
      if (this.TELEGRAM_ALERTS_ENABLED && this.telegramNotify?.isEnabled?.()) {
        await this.telegramNotify.sendAlertResolved(source, slot, currentTotal5, currentFailRate5).catch(() => {});
      }
      return;
    }

    if (level && cooldownOk) {
      this.logger.warn('CallMonitor alert TRIGGERED', {
        level,
        source,
        slot,
        currentTotal5,
        currentFailRate5,
        avg,
        std,
        warningThreshold: Number.isFinite(warningThreshold) ? warningThreshold : null,
        criticalThreshold: Number.isFinite(criticalThreshold) ? criticalThreshold : null,
      });
      const next: AlertState = {
        active: true,
        level,
        lastSentAt: now.toISOString(),
        lastCheckedAt: now.toISOString(),
        lastFailRate: currentFailRate5,
        lastTotalCalls: currentTotal5,
        lastSlot: slot,
      };
      await this.setState(stateKey, next);
      if (this.TELEGRAM_ALERTS_ENABLED && this.telegramNotify?.isEnabled?.()) {
        await this.telegramNotify
          .sendAlert({
            level,
            source,
            slot,
            currentTotal5,
            currentFailRate5,
            avg: avg ?? null,
            std: std ?? null,
          })
          .catch(() => {});
      }
      return;
    }

    const next: AlertState = {
      active: old?.active ?? false,
      level: old?.level ?? 'warning',
      lastSentAt: old?.lastSentAt ?? new Date(0).toISOString(),
      lastResolvedAt: old?.lastResolvedAt,
      lastCheckedAt: now.toISOString(),
      lastFailRate: currentFailRate5,
      lastTotalCalls: currentTotal5,
      lastSlot: slot,
    };
    await this.setState(stateKey, next);
  }

  /**
   * Обновить одну серию Welford (среднее + m2) по ключу.
   */
  private async updateWelford(key: string, value: number): Promise<void> {
    const stored = await this.getState<CallsPerMinStored>(key);
    let avg: number;
    let n: number;
    let m2: number;
    if (!stored || typeof stored.n !== 'number' || stored.n < 1) {
      avg = value;
      n = 1;
      m2 = 0;
    } else {
      n = stored.n + 1;
      const delta = value - stored.avg;
      avg = stored.avg + delta / n;
      const delta2 = value - avg;
      m2 = stored.m2 + delta * delta2;
    }
    await this.setState(key, {
      avg: Math.round(avg * 1000) / 1000,
      n,
      m2: Math.round(m2 * 1000) / 1000,
      lastUpdated: new Date().toISOString(),
    });
  }

  /**
   * Обновить статистику «неуспешных в минуту» по окну и типу (all / outgoing_missed / no_answer / failed).
   */
  async updateUnsuccessPerMinStats(
    source: 'dialer' | 's2l',
    windowMinutes: 5 | 15 | 60,
    failureType: 'all' | 'outgoing_missed' | 'no_answer' | 'failed',
    count: number,
  ): Promise<void> {
    if (windowMinutes <= 0) return;
    const rate = count / windowMinutes;
    const slot = this.getSlot();
    const key = this.unsuccessStateKey(source, windowMinutes, failureType, slot);
    await this.updateWelford(key, rate);
  }

  /**
   * Обновить статистику «звонков в единицу времени» (звонков в минуту) для типа.
   * Используется алгоритм Welford для скользящего среднего и дисперсии.
   */
  async updateCallsPerMinStats(
    type: 'dialer' | 's2l',
    callsInWindow: number,
    windowMinutes: number,
  ): Promise<void> {
    if (windowMinutes <= 0) return;
    const callsPerMin = callsInWindow / windowMinutes;
    const slot = this.getSlot();
    const key = this.callsPerMinStateKey(type, slot);
    const stored = await this.getState<CallsPerMinStored>(key);
    let avg: number;
    let n: number;
    let m2: number;
    if (!stored || typeof stored.n !== 'number' || stored.n < 1) {
      avg = callsPerMin;
      n = 1;
      m2 = 0;
    } else {
      n = stored.n + 1;
      const delta = callsPerMin - stored.avg;
      avg = stored.avg + delta / n;
      const delta2 = callsPerMin - avg;
      m2 = stored.m2 + delta * delta2;
    }
    await this.setState(key, {
      avg: Math.round(avg * 1000) / 1000,
      n,
      m2: Math.round(m2 * 1000) / 1000,
      lastUpdated: new Date().toISOString(),
    });
  }

  /** Окно в минутах для статистики «звонков в минуту» (совпадает с кроном). */
  private readonly CALLS_PER_MIN_WINDOW = 5;

  /**
   * Получить среднее и отклонение по звонкам в минуту для каждого типа.
   * Если сохранённых данных нет (n=0), avg и currentCount считаются по текущим данным API за окно 5 мин; отклонение = 0.
   */
  async getCallsPerMinStats(): Promise<{
    slot: number;
    dialer: CallsPerMinStats;
    s2l: CallsPerMinStats;
  }> {
    const w = this.CALLS_PER_MIN_WINDOW;
    const slot = this.getSlot();
    const [dialerRaw, s2lRaw] = await Promise.all([
      this.getDialerCallsRecentStat(w),
      this.getS2LCallsRecent(w),
    ]);
    const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
    const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;
    const currentDialerCount = this.filterCallsByWindow(dialerCalls, w).length;
    const currentS2lCount = this.filterCallsByWindow(s2lCalls, w).length;
    const currentDialerRate = w > 0 ? currentDialerCount / w : 0;
    const currentS2lRate = w > 0 ? currentS2lCount / w : 0;

    const toResult = (
      stored: CallsPerMinStored | null,
      currentCount: number,
      currentRate: number,
    ): CallsPerMinStats => {
      if (!stored || stored.n < 1) {
        return {
          avg: Math.round(currentRate * 1000) / 1000,
          deviation: 0,
          n: 0,
          lastUpdated: null,
          currentCount,
        };
      }
      const variance = stored.n > 1 ? stored.m2 / (stored.n - 1) : 0;
      const deviation = Math.sqrt(variance);
      return {
        avg: stored.avg,
        deviation: Math.round(deviation * 1000) / 1000,
        n: stored.n,
        lastUpdated: stored.lastUpdated ?? null,
        currentCount,
      };
    };

    const [dialerStoredSlot, s2lStoredSlot] = await Promise.all([
      this.getState<CallsPerMinStored>(this.callsPerMinStateKey('dialer', slot)),
      this.getState<CallsPerMinStored>(this.callsPerMinStateKey('s2l', slot)),
    ]);
    // fallback: если слотовой истории ещё нет, читаем legacy-ключи
    const [dialerStoredLegacy, s2lStoredLegacy] = await Promise.all([
      dialerStoredSlot ? Promise.resolve(null) : this.getState<CallsPerMinStored>(this.CALLS_PER_MIN_KEY_DIALER_LEGACY),
      s2lStoredSlot ? Promise.resolve(null) : this.getState<CallsPerMinStored>(this.CALLS_PER_MIN_KEY_S2L_LEGACY),
    ]);
    const dialerStored = dialerStoredSlot ?? dialerStoredLegacy;
    const s2lStored = s2lStoredSlot ?? s2lStoredLegacy;
    return {
      slot,
      dialer: toResult(dialerStored, currentDialerCount, currentDialerRate),
      s2l: toResult(s2lStored, currentS2lCount, currentS2lRate),
    };
  }

  /** Типы неуспешных для хранения (all + по каждому). */
  private readonly UNSUCCESS_TYPES = ['all', 'outgoing_missed', 'no_answer', 'failed'] as const;

  /**
   * Среднее и отклонение по «неуспешных в минуту» по окнам 5/15/60 и по типам.
   * Если сохранённых данных нет (n=0), avg и currentCount считаются по текущим данным API; отклонение = 0.
   */
  async getUnsuccessPerMinStats(): Promise<{
    slot: number;
    dialer: Record<string, Record<string, CallsPerMinStats>>;
    s2l: Record<string, Record<string, CallsPerMinStats>>;
  }> {
    const windows = [5, 15, 60] as const;
    const slot = this.getSlot();
    const dialer: Record<string, Record<string, CallsPerMinStats>> = { '5': {}, '15': {}, '60': {} };
    const s2l: Record<string, Record<string, CallsPerMinStats>> = { '5': {}, '15': {}, '60': {} };

    // Текущие значения по API (без сохранённой истории) — чтобы показывать количество неуспешных
    const [dialerRaw, s2lRaw] = await Promise.all([
      this.getDialerCallsRecentStat(60),
      this.getS2LCallsRecent(60),
    ]);
    const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
    const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;

    const currentDialer: Record<string, Record<string, number>> = { '5': {}, '15': {}, '60': {} };
    const currentS2l: Record<string, Record<string, number>> = { '5': {}, '15': {}, '60': {} };
    for (const w of windows) {
      const dCalls = this.filterCallsByWindow(dialerCalls, w);
      const sCalls = this.filterCallsByWindow(s2lCalls, w);
      const dStat = this.computeCsrFromCalls(dCalls);
      const sStat = this.computeCsrFromCalls(sCalls);
      const dByType = this.countUnsuccessByType(dStat.byStatus);
      const sByType = this.countUnsuccessByType(sStat.byStatus);
      for (const t of this.UNSUCCESS_TYPES) {
        currentDialer[String(w)][t] = t === 'all' ? dStat.failedCount : dByType[t];
        currentS2l[String(w)][t] = t === 'all' ? sStat.failedCount : sByType[t];
      }
    }

    const toResult = (
      stored: CallsPerMinStored | null,
      currentCount: number,
      windowMinutes: number,
    ): CallsPerMinStats => {
      const currentRate = windowMinutes > 0 ? currentCount / windowMinutes : 0;
      if (!stored || stored.n < 1) {
        return {
          avg: Math.round(currentRate * 1000) / 1000,
          deviation: 0,
          n: 0,
          lastUpdated: null,
          currentCount,
        };
      }
      const variance = stored.n > 1 ? stored.m2 / (stored.n - 1) : 0;
      return {
        avg: stored.avg,
        deviation: Math.round(Math.sqrt(variance) * 1000) / 1000,
        n: stored.n,
        lastUpdated: stored.lastUpdated ?? null,
        currentCount,
      };
    };

    for (const w of windows) {
      for (const t of this.UNSUCCESS_TYPES) {
        const keyD = this.unsuccessStateKey('dialer', w, t, slot);
        const keyS = this.unsuccessStateKey('s2l', w, t, slot);
        const keyDLegacy = this.unsuccessStateKeyLegacy('dialer', w, t);
        const keySLegacy = this.unsuccessStateKeyLegacy('s2l', w, t);
        const storedD =
          (await this.getState<CallsPerMinStored>(keyD)) ??
          (await this.getState<CallsPerMinStored>(keyDLegacy));
        const storedS =
          (await this.getState<CallsPerMinStored>(keyS)) ??
          (await this.getState<CallsPerMinStored>(keySLegacy));
        dialer[String(w)][t] = toResult(
          storedD,
          currentDialer[String(w)][t] ?? 0,
          w,
        );
        s2l[String(w)][t] = toResult(
          storedS,
          currentS2l[String(w)][t] ?? 0,
          w,
        );
      }
    }
    return { slot, dialer, s2l };
  }

  /**
   * Подсчёт неуспешных по типам из byStatus (outgoing_missed, no_answer, failed).
   */
  private countUnsuccessByType(byStatus: Record<string, number>): { all: number; outgoing_missed: number; no_answer: number; failed: number } {
    let outgoing_missed = 0;
    let no_answer = 0;
    let failed = 0;
    for (const [status, count] of Object.entries(byStatus)) {
      const n = status.toLowerCase().trim();
      if (n.includes('outgoing missed')) outgoing_missed += count;
      else if (n.includes('no answer')) no_answer += count;
      else if (n === 'failed') failed += count;
    }
    return { all: outgoing_missed + no_answer + failed, outgoing_missed, no_answer, failed };
  }

  /**
   * Отчёт по звонкам за последний 1 час: Dialer и S2L — всего, неуспешных, CSR, разбивка по статусам.
   * Отправляет в настроенный Telegram-чат (для теста).
   */
  async sendHourlyReportToTelegram(): Promise<boolean> {
    if (!this.telegramNotify?.isEnabled?.()) return false;
    try {
      const [dialerRaw, s2lRaw] = await Promise.all([
        this.getDialerCallsRecentStat(60),
        this.getS2LCallsRecent(60),
      ]);
      const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
      const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;
      const dialer60 = this.filterCallsByWindow(dialerCalls, 60);
      const s2l60 = this.filterCallsByWindow(s2lCalls, 60);
      const dStat = this.computeCsrFromCalls(dialer60);
      const sStat = this.computeCsrFromCalls(s2l60);

      const fmt = (stat: CallStatusCounts) =>
        `всего: ${stat.total}, успешных: ${stat.successCount}, неуспешных: ${stat.failedCount}, CSR: ${stat.csr}%, fail: ${stat.failedPercent}%`;
      const byStatusStr = (by: Record<string, number>) =>
        Object.entries(by)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${k}: ${n}`)
          .join('; ') || '—';

      const lines: string[] = [
        '<b>📞 Call Monitor — звонки за 1 час</b>',
        `${new Date().toISOString().slice(0, 19)}Z`,
        '',
        '<b>Dialer</b>',
        fmt(dStat),
        'По статусам: ' + byStatusStr(dStat.byStatus),
        '',
        '<b>S2L</b>',
        fmt(sStat),
        'По статусам: ' + byStatusStr(sStat.byStatus),
      ];
      const text = lines.join('\n');
      const sent = await this.telegramNotify.sendReport(text.length > 4000 ? text.slice(0, 3997) + '...' : text);
      return sent;
    } catch (err: any) {
      this.logger.warn('sendHourlyReportToTelegram error', { message: err?.message });
      return false;
    }
  }

  /**
   * Сформировать и отправить сводный отчёт в Telegram (отклонения по юзерам ≥20%, падение звонков за 4 нед. ≥20%).
   */
  async sendReportToTelegram(): Promise<boolean> {
    if (!this.telegramNotify?.isEnabled?.()) return false;
    try {
      const [deviation, weekly] = await Promise.all([
        this.getDeviationSummary(20),
        this.getWeeklyChangeReport4Weeks(20),
      ]);
      const lines: string[] = [
        '<b>📊 Call Monitor — отчёт</b>',
        `${new Date().toISOString().slice(0, 19)}Z`,
        '',
        '<b>Отклонение fail rate ≥20 п.п. (за 5 мин):</b>',
      ];
      const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      if (deviation.aboveThresholdDialer.length > 0) {
        lines.push('Dialer: ' + deviation.aboveThresholdDialer.map((r) => `${esc(r.userId)} (+${r.deviationPct.toFixed(0)} п.п.)`).join(', '));
      } else lines.push('Dialer: нет');
      if (deviation.aboveThresholdS2l.length > 0) {
        lines.push('S2L: ' + deviation.aboveThresholdS2l.map((r) => `${esc(r.userId)} (+${r.deviationPct.toFixed(0)} п.п.)`).join(', '));
      } else lines.push('S2L: нет');
      lines.push('', '<b>Падение звонков за 4 нед. ≥20%:</b>');
      if (weekly.aboveThresholdDialer.length > 0) {
        lines.push('Dialer: ' + weekly.aboveThresholdDialer.map((r) => `${esc(r.userId)} (макс ${r.max}→${r.lastWeek})`).join(', '));
      } else lines.push('Dialer: нет');
      if (weekly.aboveThresholdS2l.length > 0) {
        lines.push('S2L: ' + weekly.aboveThresholdS2l.map((r) => `${esc(r.userId)} (макс ${r.max}→${r.lastWeek})`).join(', '));
      } else lines.push('S2L: нет');
      const text = lines.join('\n');
      const sent = await this.telegramNotify.sendReport(text.length > 4000 ? text.slice(0, 3997) + '...' : text);
      return sent;
    } catch (err: any) {
      this.logger.warn('sendReportToTelegram error', { message: err?.message });
      return false;
    }
  }

  /**
   * Основной метод мониторинга — вызывается по крону.
   * Обновляет: звонки в минуту; среднее/отклонение неуспешных в минуту по окнам 5/15/60 и по типам.
   */
  async run(): Promise<void> {
    this.logger.log('CallMonitor run started');
    try {
      const lastRun = await this.getState<string>('last_run_at');
      this.logger.debug('Last run', { lastRun });

      const [dialerRaw, s2lRaw] = await Promise.all([
        this.getDialerCallsRecentStat(60),
        this.getS2LCallsRecent(60),
      ]);
      const dialerCalls = this.extractCallsList(dialerRaw) as Array<Record<string, unknown>>;
      const s2lCalls = this.extractCallsList(s2lRaw) as Array<Record<string, unknown>>;
      const now = new Date();
      const slot = this.getSlot(now);

      const windows = [5, 15, 60] as const;
      for (const w of windows) {
        const d5 = this.filterCallsByWindow(dialerCalls, w);
        const s5 = this.filterCallsByWindow(s2lCalls, w);
        const dStat = this.computeCsrFromCalls(d5);
        const sStat = this.computeCsrFromCalls(s5);
        const dByType = this.countUnsuccessByType(dStat.byStatus);
        const sByType = this.countUnsuccessByType(sStat.byStatus);

        await this.updateUnsuccessPerMinStats('dialer', w, 'all', dStat.failedCount);
        await this.updateUnsuccessPerMinStats('dialer', w, 'outgoing_missed', dByType.outgoing_missed);
        await this.updateUnsuccessPerMinStats('dialer', w, 'no_answer', dByType.no_answer);
        await this.updateUnsuccessPerMinStats('dialer', w, 'failed', dByType.failed);
        await this.updateUnsuccessPerMinStats('s2l', w, 'all', sStat.failedCount);
        await this.updateUnsuccessPerMinStats('s2l', w, 'outgoing_missed', sByType.outgoing_missed);
        await this.updateUnsuccessPerMinStats('s2l', w, 'no_answer', sByType.no_answer);
        await this.updateUnsuccessPerMinStats('s2l', w, 'failed', sByType.failed);
      }

      const dialerTotal5 = this.filterCallsByWindow(dialerCalls, 5).length;
      const s2lTotal5 = this.filterCallsByWindow(s2lCalls, 5).length;
      await this.updateCallsPerMinStats('dialer', dialerTotal5, 5);
      await this.updateCallsPerMinStats('s2l', s2lTotal5, 5);

      // Алерты по fail_rate за последние 5 минут (по текущему слоту)
      const d5calls = this.filterCallsByWindow(dialerCalls, 5) as Array<Record<string, unknown>>;
      const s5calls = this.filterCallsByWindow(s2lCalls, 5) as Array<Record<string, unknown>>;
      const d5rate = this.computeFailRateFromCalls(d5calls);
      const s5rate = this.computeFailRateFromCalls(s5calls);
      await this.evaluateFailRateAlert('dialer', slot, d5rate.total, d5rate.failRate);
      await this.evaluateFailRateAlert('s2l', slot, s5rate.total, s5rate.failRate);

      // EMA-история обновляется при завершении 30-мин слота
      await this.maybeFinalizeSlotEmaFrom60m('dialer', dialerCalls, now);
      await this.maybeFinalizeSlotEmaFrom60m('s2l', s2lCalls, now);

      // Накопление по неделям по пользователям (только новые звонки с прошлого run, чтобы не дублировать)
      const lastRunStr = await this.getState<string>('last_run_at');
      const lastRunDate = lastRunStr ? new Date(lastRunStr) : null;
      await this.aggregateAndSaveWeeklyStats('dialer', dialerCalls, lastRunDate);
      await this.aggregateAndSaveWeeklyStats('s2l', s2lCalls, lastRunDate);

      await this.setState('last_run_at', new Date().toISOString());
      this.logger.log('CallMonitor run completed');
    } catch (err: any) {
      this.logger.warn('CallMonitor run error', { message: err?.message });
      throw err;
    }
  }
}
