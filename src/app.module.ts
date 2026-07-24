import './polyfill';
import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import Redis from 'ioredis';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { CalltraceController } from './controllers/calltrace.controller';
import { CalltraceService } from './services/calltrace.service';
import { VoipmonitorController } from './controllers/voipmonitor.controller';
import { VoipmonitorService } from './services/voipmonitor.service';
import { CallRecordingController } from './controllers/call-recording.controller';
import { SbctelcoController } from './controllers/sbctelco.controller';
import { SbctelcoService } from './services/sbctelco.service';
import { SbctelcoCronService } from './services/sbctelco-cron.service';
import { Sbctrace } from './entities/sbctrace.entity';
import { CallMonitorState } from './entities/call-monitor-state.entity';
import { User } from './entities/user.entity';
import { CallMonitorService } from './services/call-monitor.service';
import { CallMonitorCronService } from './services/call-monitor-cron.service';
import { CallMonitorController } from './controllers/call-monitor.controller';
import { TelegramNotifyService } from './services/telegram-notify.service';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { AuthGuard } from './guards/auth.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
    TypeOrmModule.forRootAsync({
      useFactory: (config: ConfigService) => ({
        type: 'mysql',
        host: String(
          config.get('MANAGER_DB_HOST') ??
            process.env.MANAGER_DB_HOST ??
            '127.0.0.1',
        ).trim(),
        port: parseInt(
          String(
            config.get('MANAGER_DB_PORT') ??
              process.env.MANAGER_DB_PORT ??
              '3306',
          ).trim(),
          10,
        ),
        username: String(
          config.get('MANAGER_DB_USERNAME') ??
            process.env.MANAGER_DB_USERNAME ??
            'root',
        ).trim(),
        password: String(
          config.get('MANAGER_DB_PASSWORD') ??
            process.env.MANAGER_DB_PASSWORD ??
            '',
        ).trim(),
        database: String(
          config.get('MANAGER_DB_DATABASE') ??
            process.env.MANAGER_DB_DATABASE ??
            'sbclogs',
        ).trim(),
        timezone: 'Z', // хранить и читать даты в UTC
        entities: [Sbctrace, CallMonitorState, User],
        synchronize: true, // создаёт таблицы и обновляет схему при изменении полей сущности
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forFeature([Sbctrace, CallMonitorState, User]),
    HttpModule,
  ],
  controllers: [
    AppController,
    AuthController,
    CalltraceController,
    VoipmonitorController,
    CallRecordingController,
    SbctelcoController,
    CallMonitorController,
  ],
  providers: [
    AppService,
    AuthService,
    CalltraceService,
    VoipmonitorService,
    SbctelcoService,
    SbctelcoCronService,
    CallMonitorService,
    CallMonitorCronService,
    TelegramNotifyService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
          password: process.env.REDIS_PASSWORD || undefined,
        });
      },
    },
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
