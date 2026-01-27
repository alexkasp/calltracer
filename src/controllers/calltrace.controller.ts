import { Controller, Get, Param } from '@nestjs/common';
import { CalltraceService } from '../services/calltrace.service';

@Controller('calltrace')
export class CalltraceController {
  constructor(private readonly calltraceService: CalltraceService) {}

  @Get(':id')
  async getCallTrace(@Param('id') id: string) {
    return this.calltraceService.getCallTrace(id);
  }
}
