import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

/**
 * Переменные окружения:
 * - TELEGRAM_BOT_TOKEN — токен бота (обязателен для отправки)
 * - TELEGRAM_CHAT_ID — чат по умолчанию (алерты и отчёты, если не заданы отдельные)
 * - TELEGRAM_CHAT_ID_ALERTS — чат только для алертов (опционально)
 * - TELEGRAM_CHAT_ID_REPORTS — чат только для отчётов (опционально)
 */

export type TelegramAlertPayload = {
  level: 'warning' | 'critical';
  source: 'dialer' | 's2l';
  slot: number;
  currentTotal5: number;
  currentFailRate5: number;
  avg: number | null;
  std: number | null;
};

@Injectable()
export class TelegramNotifyService {
  private readonly logger = new Logger(TelegramNotifyService.name);
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly chatIdAlerts: string | null;
  private readonly chatIdReports: string | null;
  private readonly enabled: boolean;

  constructor(private readonly httpService: HttpService) {
    const token = process.env.TELEGRAM_BOT_TOKEN ?? '';
    const chat = process.env.TELEGRAM_CHAT_ID ?? '';
    this.botToken = String(token).trim();
    this.chatId = String(chat).trim();
    this.chatIdAlerts = (process.env.TELEGRAM_CHAT_ID_ALERTS ?? '').trim() || null;
    this.chatIdReports = (process.env.TELEGRAM_CHAT_ID_REPORTS ?? '').trim() || null;
    this.enabled = Boolean(this.botToken && (this.chatId || this.chatIdAlerts || this.chatIdReports));
    if (!this.enabled && (process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_CHAT_ID)) {
      this.logger.warn('Telegram: bot token or chat id missing, notifications disabled');
    }
  }

  private getChatId(kind: 'default' | 'alerts' | 'reports'): string | null {
    if (kind === 'alerts' && this.chatIdAlerts) return this.chatIdAlerts;
    if (kind === 'reports' && this.chatIdReports) return this.chatIdReports;
    return this.chatId || null;
  }

  private formatSlotInterval(slot: number): string {
    const start = slot * 30;
    const end = (start + 30) % (24 * 60);
    const pad = (n: number) => String(n).padStart(2, '0');
    const sh = Math.floor(start / 60);
    const sm = start % 60;
    const eh = Math.floor(end / 60);
    const em = end % 60;
    return `${pad(sh)}:${pad(sm)}–${pad(eh)}:${pad(em)}`;
  }

  /**
   * Отправить произвольное сообщение в Telegram.
   */
  async sendMessage(text: string, kind: 'default' | 'alerts' | 'reports' = 'default'): Promise<boolean> {
    if (!this.enabled) return false;
    const chatId = this.getChatId(kind);
    if (!chatId) return false;
    const url = `${TELEGRAM_API_BASE}${this.botToken}/sendMessage`;
    try {
      await firstValueFrom(
        this.httpService.post(
          url,
          {
            chat_id: chatId,
            text,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          },
          { timeout: 10000 },
        ),
      );
      return true;
    } catch (err: any) {
      this.logger.warn('Telegram sendMessage failed', { message: err?.message, chatId: kind });
      return false;
    }
  }

  /**
   * Отправить уведомление об алерте (fail rate).
   */
  async sendAlert(payload: TelegramAlertPayload): Promise<boolean> {
    const pct = (payload.currentFailRate5 * 100).toFixed(1);
    const avgStr = payload.avg != null ? ((payload.avg * 100).toFixed(1) + '%') : '—';
    const interval = this.formatSlotInterval(payload.slot);
    const text =
      `🚨 <b>Call Monitor: ${payload.level.toUpperCase()}</b>\n` +
      `Источник: ${payload.source === 'dialer' ? 'Dialer' : 'S2L'}\n` +
      `Интервал (сервер): ${interval} (slot ${payload.slot})\n` +
      `Звонков за 5 мин: ${payload.currentTotal5}\n` +
      `Fail rate: ${pct}% (норма по слоту: ${avgStr})\n` +
      `Время: ${new Date().toISOString()}`;
    return this.sendMessage(text, 'alerts');
  }

  /**
   * Отправить уведомление о снятии алерта (RESOLVED).
   */
  async sendAlertResolved(source: 'dialer' | 's2l', slot: number, currentTotal5: number, currentFailRate5: number): Promise<boolean> {
    const pct = (currentFailRate5 * 100).toFixed(1);
    const interval = this.formatSlotInterval(slot);
    const text =
      `✅ <b>Call Monitor: RESOLVED</b>\n` +
      `Источник: ${source === 'dialer' ? 'Dialer' : 'S2L'}\n` +
      `Интервал (сервер): ${interval} (slot ${slot})\n` +
      `Звонков за 5 мин: ${currentTotal5}, fail rate: ${pct}%\n` +
      `Время: ${new Date().toISOString()}`;
    return this.sendMessage(text, 'alerts');
  }

  /**
   * Отправить текстовый отчёт (сводка за период, отклонения по юзерам и т.д.).
   */
  async sendReport(text: string): Promise<boolean> {
    return this.sendMessage(text, 'reports');
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Отчёт только по проблемным звонкам SBCtelco (MOS ниже 4) внутри батча; остальные звонки уже сохранены в БД.
   */
  async sendSbcLowMosReport(
    entries: Array<{ id: string; calling: string | null; called: string | null; mos: number }>,
  ): Promise<boolean> {
    if (!this.enabled || entries.length === 0) return false;
    const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines: string[] = [
      '<b>📉 SBCtelco: низкий MOS (&lt; 4)</b>',
      `Сохранено записей: ${entries.length}`,
      `${new Date().toISOString().slice(0, 19)}Z`,
      '',
    ];
    for (const e of entries) {
      lines.push(
        `• <code>${esc(e.id)}</code> MOS <b>${e.mos}</b> · ${esc(e.calling ?? '—')} → ${esc(e.called ?? '—')}`,
      );
    }
    const text = lines.join('\n');
    return this.sendReport(text.length > 4000 ? text.slice(0, 3997) + '...' : text);
  }
}
