import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HttpModule } from '@nestjs/axios';
import Redis from 'ioredis';
import { AppController } from './controllers/app.controller';
import { AppService } from './services/app.service';
import { CalltraceController } from './controllers/calltrace.controller';
import { CalltraceService } from './services/calltrace.service';
import { VoipmonitorController } from './controllers/voipmonitor.controller';
import { VoipmonitorService } from './services/voipmonitor.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    HttpModule,
  ],
  controllers: [AppController, CalltraceController, VoipmonitorController],
  providers: [
    AppService,
    CalltraceService,
    VoipmonitorService,
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
  ],
})
export class AppModule {}
