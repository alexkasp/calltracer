import { Controller, Get, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CalltraceService } from '../services/calltrace.service';

@Controller('calltrace')
export class CalltraceController {
  constructor(private readonly calltraceService: CalltraceService) {}

  @Get(':id')
  async getCallTrace(
    @Param('id') id: string,
    @Query('format') format?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result = await this.calltraceService.getCallTrace(id);

    if (format === 'text') {
      const data: any = result?.data ?? {};
      const parts: string[] = [];
      parts.push(`callId: ${result?.callId ?? ''}`);
      parts.push(`callType: ${result?.callType ?? ''}`);

      if (typeof data?.events === 'string' && data.events.trim()) {
        parts.push('');
        parts.push(data.events);
      }
      if (typeof data?.log === 'string' && data.log.trim()) {
        parts.push('');
        parts.push(data.log);
      }

      res?.type('text/plain; charset=utf-8');
      return parts.join('\n');
    }

    return result;
  }
}
