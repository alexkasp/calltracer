import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { VoipmonitorService } from '../services/voipmonitor.service';

@Controller('voipmonitor')
export class VoipmonitorController {
  constructor(private readonly voipmonitorService: VoipmonitorService) {}

  @Get('calls')
  async getCalls(
    @Query('limit') limit?: string,
    @Query('start') start?: string,
    @Query('fdatefrom') fdatefrom?: string,
    @Query('fdateto') fdateto?: string,
    @Query('fcaller') fcaller?: string,
    @Query('fcalled') fcalled?: string,
    @Query('fcallerd_type') fcallerd_type?: string,
    @Query('fcallid') fcallid?: string,
  ) {
    if (!fdatefrom) {
      throw new BadRequestException('Query param fdatefrom is required');
    }
    const params: {
      limit?: number;
      start?: number;
      fdatefrom?: string;
      fdateto?: string;
      fcaller?: string;
      fcalled?: string;
      fcallerd_type?: number;
      fcallid?: string;
    } = {};

    if (limit) {
      params.limit = parseInt(limit, 10);
    }
    if (start) {
      params.start = parseInt(start, 10);
    }
    if (fdatefrom) {
      params.fdatefrom = fdatefrom;
    }
    if (fdateto) {
      params.fdateto = fdateto;
    }
    if (fcaller) {
      params.fcaller = fcaller;
    }
    if (fcalled) {
      params.fcalled = fcalled;
    }
    if (fcallerd_type) {
      params.fcallerd_type = parseInt(fcallerd_type, 10);
    }
    if (fcallid) {
      params.fcallid = fcallid;
    }

    return this.voipmonitorService.getCalls(params);
  }
}
