import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { ConfigService } from '@nestjs/config';
import { CallMonitorService } from './call-monitor.service';

@Injectable()
export class CallMonitorCronService {
  private readonly logger = new Logger(CallMonitorCronService.name);

  constructor(
    private readonly callMonitorService: CallMonitorService,
    private readonly configService: ConfigService,
  ) {}

  /** Запуск мониторинга звонков по крону (периодичность задаётся в .env: CALL_MONITOR_CRON_ENABLED, по умолчанию раз в 5 минут) */
  @Cron('*/5 * * * *')
  async handleRun() {
    const enabled = this.configService.get<string>('CALL_MONITOR_CRON_ENABLED');
    if (enabled === 'false' || enabled === '0') return;
    try {
      await this.callMonitorService.run();
    } catch (err: any) {
      this.logger.warn('CallMonitor cron error', { message: err?.message });
    }
  }
}
