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

  /** Раз в минуту: забрать звонки за последнюю минуту и добавить новые в БД (если SBC_CRON_FETCH_ENABLED=true) */
  @Cron('* * * * *')
  async handleFetchLastMinute() {
    const enabled = this.configService.get<string>('SBC_CRON_FETCH_ENABLED');
    if (enabled === 'false' || enabled === '0') return;
    try {
      const { added, ids } = await this.sbctelcoService.fetchAndSaveNewCallsFromLastMinute();
      if (added > 0) {
        this.logger.log(`Sbctelco cron: добавлено ${added} звонков в БД`, { ids });
      }
    } catch (err: any) {
      this.logger.warn('Sbctelco cron: ошибка при загрузке звонков', { message: err?.message });
    }
  }

  /** Раз в сутки (3:00): удалить из sbctrace звонки старше 5 дней */
  @Cron('0 3 * * *')
  async handleDeleteOlderThanFiveDays() {
    try {
      const deleted = await this.sbctelcoService.deleteOlderThanFiveDays();
      if (deleted > 0) {
        this.logger.log(`Sbctelco cron: удалено ${deleted} записей старше 5 дней из sbctrace`);
      }
    } catch (err: any) {
      this.logger.warn('Sbctelco cron: ошибка при удалении старых звонков', { message: err?.message });
    }
  }
}
