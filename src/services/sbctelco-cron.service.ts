import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { SbctelcoService } from './sbctelco.service';

@Injectable()
export class SbctelcoCronService {
  private readonly logger = new Logger(SbctelcoCronService.name);

  /**
   * Общий замок на оба забора из SBC. WebPortal SBC (tbweb/ruby) однопоточный, а
   * call_trace с recursive=yes — дорогой запрос. Без замка длинный прогон наслаивался
   * на следующий по расписанию: запросы копились и загоняли WebPortal в полку по CPU.
   * Замок общий для Active и Inactive — одновременно в SBC не ходим никогда.
   */
  private running: { job: string; startedAt: number } | null = null;

  constructor(
    private readonly sbctelcoService: SbctelcoService,
    private readonly configService: ConfigService,
  ) {}

  private isFetchEnabled(): boolean {
    const enabled = this.configService.get<string>('SBC_CRON_FETCH_ENABLED');
    return enabled !== 'false' && enabled !== '0';
  }

  /** Выполняет fn, только если другой забор из SBC не идёт прямо сейчас. */
  private async withPollLock(
    job: string,
    fn: () => Promise<void>,
  ): Promise<void> {
    if (this.running) {
      const heldSec = Math.round((Date.now() - this.running.startedAt) / 1000);
      this.logger.warn(
        `Sbctelco cron (${job}): пропуск — ${this.running.job} выполняется уже ${heldSec} с`,
      );
      return;
    }
    this.running = { job, startedAt: Date.now() };
    try {
      await fn();
    } finally {
      this.running = null;
    }
  }

  /** Раз в минуту: active snapshot — обновить/сохранить все активные звонки (если SBC_CRON_FETCH_ENABLED=true) */
  @Cron('* * * * *')
  async handleActiveSnapshot() {
    if (!this.isFetchEnabled()) return;
    await this.withPollLock('Active', async () => {
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
        this.logger.warn(
          'Sbctelco cron (Active): ошибка при загрузке звонков',
          { message: err?.message },
        );
      }
    });
  }

  /**
   * Каждые 5 минут: inactive overlap. Смещён на :02, чтобы не стартовать в одну секунду
   * с ежеминутным Active snapshot. Окно считает SbctelcoService (от конца прошлого
   * успешного окна минус перекрытие), поэтому пропуск прогона не теряет звонки.
   */
  @Cron('2-59/5 * * * *')
  async handleInactiveOverlap() {
    if (!this.isFetchEnabled()) return;
    await this.withPollLock('Inactive', async () => {
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
    });
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
