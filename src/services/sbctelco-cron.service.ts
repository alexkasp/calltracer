import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SbctelcoService } from './sbctelco.service';

@Injectable()
export class SbctelcoCronService {
  private readonly logger = new Logger(SbctelcoCronService.name);

  constructor(
    private readonly sbctelcoService: SbctelcoService,
    private readonly configService: ConfigService,
  ) {}

  /** Раз в минуту: active snapshot — обновить/сохранить все активные звонки (если SBC_CRON_FETCH_ENABLED=true) */
  @Cron('* * * * *')
  async handleActiveSnapshot() {
    const enabled = this.configService.get<string>('SBC_CRON_FETCH_ENABLED');
    if (enabled === 'false' || enabled === '0') return;
    try {
      const { saved, ids } =
        await this.sbctelcoService.fetchAndUpsertActiveSnapshot();
      if (saved > 0) {
        this.logger.log(
          `Sbctelco cron (Active): обновлено/добавлено ${saved} звонков`,
          { ids },
        );
      }
    } catch (err: any) {
      this.logger.warn('Sbctelco cron (Active): ошибка при загрузке звонков', {
        message: err?.message,
      });
    }
  }

  /** Каждые 5 минут: inactive overlap (now-15m..now) и сохранение новых id за последние 15 минут */
  @Cron('*/5 * * * *')
  async handleInactiveOverlap() {
    const enabled = this.configService.get<string>('SBC_CRON_FETCH_ENABLED');
    if (enabled === 'false' || enabled === '0') return;
    try {
      const { added, ids } =
        await this.sbctelcoService.fetchAndSaveInactiveWithOverlap();
      if (added > 0) {
        this.logger.log(
          `Sbctelco cron (Inactive overlap): добавлено ${added} звонков`,
          { ids },
        );
      }
    } catch (err: any) {
      this.logger.warn(
        'Sbctelco cron (Inactive overlap): ошибка при загрузке звонков',
        { message: err?.message },
      );
    }
  }

  /**
   * Каждые 20 минут: догоняющий проход за последние 3 часа — забирает звонки, потерянные
   * из-за таймаутов API/оборванных пачек, и финализирует записи, застрявшие в Active.
   */
  @Cron('*/20 * * * *')
  async handleReconcile() {
    const enabled = this.configService.get<string>('SBC_CRON_FETCH_ENABLED');
    if (enabled === 'false' || enabled === '0') return;
    try {
      const { scanned, saved, stuckActiveFixed } =
        await this.sbctelcoService.reconcileRecentCalls(3);
      if (saved > 0) {
        this.logger.log(
          `Sbctelco cron (Reconcile): просмотрено ${scanned}, сохранено/обновлено ${saved}, снято с зависшего Active ${stuckActiveFixed}`,
        );
      }
    } catch (err: any) {
      this.logger.warn('Sbctelco cron (Reconcile): ошибка', {
        message: err?.message,
      });
    }
  }

  /** Раз в сутки (3:00): удалить из sbctrace звонки старше 5 дней */
  @Cron('0 3 * * *')
  async handleDeleteOlderThanFiveDays() {
    try {
      const deleted = await this.sbctelcoService.deleteOlderThanFiveDays();
      if (deleted > 0) {
        this.logger.log(
          `Sbctelco cron: удалено ${deleted} записей старше 5 дней из sbctrace`,
        );
      }
    } catch (err: any) {
      this.logger.warn('Sbctelco cron: ошибка при удалении старых звонков', {
        message: err?.message,
      });
    }
  }
}
