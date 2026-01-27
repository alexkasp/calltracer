import { Injectable, NotFoundException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VoipmonitorService } from './voipmonitor.service';

@Injectable()
export class CalltraceService {
  private readonly logger = new Logger(CalltraceService.name);
  private readonly apiKey = 'f4cafb7d17a74ce5b082535ecc108533';
  private readonly ipmaxiApiUrl = 'https://api.ipmaxi.convolo.ai/api/v1/get-call-ai-log';
  private readonly leadsApiUrl = 'https://api.leads.convolo.ai/api/v1/calls/log';

  constructor(
    private readonly httpService: HttpService,
    private readonly voipmonitorService: VoipmonitorService,
  ) {}

  private getCallType(callId: string): string {
    if (!callId) {
      return 'unknown';
    }

    // Если ID содержит точку и только цифры - это dialer
    if (/^\d+\.\d+$/.test(callId)) {
      return 'dialer';
    }

    // Если ID содержит только цифры и буквы без точки - это S2L
    if (/^[a-f0-9]+$/i.test(callId) && !callId.includes('.')) {
      return 'S2L';
    }

    return 'unknown';
  }

  private async formatLog(callType: string, callId: string, data: any): Promise<any> {
    // По умолчанию возвращаем данные как есть
    switch (callType) {
      case 'S2L':
        // Можно добавить специфичное форматирование для S2L
        return this.formatS2LLog(callId, data);
      case 'dialer':
        // Можно добавить специфичное форматирование для dialer
        return this.formatDialerLog(data);
      default:
        // По умолчанию возвращаем как есть
        return data;
    }
  }

  private async formatS2LLog(callId: string, data: any): Promise<any> {
    // Для S2L извлекаем только секцию events до "\n\n log"
    try {
      const logText = data?.debug?.log || data?.log || '';
      
      if (!logText) {
        this.logger.warn('No log text found in S2L response');
        return data;
      }

      // Ищем начало секции events
      const eventsIndex = logText.indexOf('events:');
      if (eventsIndex === -1) {
        this.logger.warn('No events section found in S2L log');
        return data;
      }

      // Ищем конец секции events (начало секции log)
      const logSectionIndex = logText.indexOf('\n\n log', eventsIndex);
      
      let eventsSection: string;
      let logSection: string | null = null;
      if (logSectionIndex !== -1) {
        // Извлекаем секцию events до "\n\n log"
        eventsSection = logText.substring(eventsIndex, logSectionIndex);
        // Секция log начинается с "\n\n log" и идет до конца
        logSection = logText.substring(logSectionIndex);
      } else {
        // Если секция log не найдена, берем всё от events до конца
        eventsSection = logText.substring(eventsIndex);
      }

      // Убираем из секции events строки, в которых есть "null -> null"
      const cleanedEventsSection = eventsSection
        .split('\n')
        .filter((line) => !line.includes('null -> null'))
        .join('\n');

      const events = cleanedEventsSection.trim();
      const eventsDateMatch = events.match(/(\d{4}-\d{2}-\d{2})/);
      const fallbackFdatefrom = eventsDateMatch ? `${eventsDateMatch[1]}T00:00:00` : undefined;

      // Секция log: оставляем INVITE sip + связанные "Sent event to JS onPhoneEvent with params"
      let filteredLog: string | undefined;
      let sipCallId: string | undefined;
      if (logSection) {
        const logLines = logSection.split('\n');
        const out: string[] = [];
        let capture = false;
        let foundInviteInLog = false;
        const voipCache = new Map<string, any | null>();

        // Сохраняем заголовок "log:" (или "log") если есть
        const firstNonEmpty = logLines.find((l) => l.trim().length > 0);
        if (firstNonEmpty && (firstNonEmpty.trim() === 'log:' || firstNonEmpty.trim() === 'log')) {
          out.push(firstNonEmpty.trim());
        } else if (logLines.length > 0 && logLines[0].trim() === '') {
          // часто секция начинается с пустой строки, а затем " log:" — найдём её ниже
        }

        for (const line of logLines) {
          const trimmed = line.trim();

          // Встречаем новый INVITE — начинаем/перезапускаем накопление
          if (trimmed.startsWith('INVITE sip:')) {
            out.push(line);
            capture = true;
            foundInviteInLog = true;
            continue;
          }

          if (
            capture &&
            line.includes('Sent event to JS onPhoneEvent with params') &&
            (line.includes('name = Call.Failed') ||
              line.includes('name = Call.AudioStarted') ||
              line.includes('name = Call.Connected'))
          ) {
            out.push(line);

            // Для Call.Connected извлекаем sipCallId и добавляем найденный звонок из VoIPmonitor
            if (line.includes('name = Call.Connected')) {
              const m = line.match(/sipCallId\s*=\s*([^,;\]\s}]+)/);
              const connectedSipCallId = m?.[1];
              if (connectedSipCallId) {
                // сохраняем первый sipCallId для верхнеуровневого поля (как раньше)
                if (!sipCallId) sipCallId = connectedSipCallId;

                const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2})/);
                const fdatefrom = dateMatch ? `${dateMatch[1]}T00:00:00` : fallbackFdatefrom;

                // Достаём звонок из VoIPmonitor (с кэшем, чтобы не дергать API повторно)
                let vmCall: any | null | undefined = voipCache.get(connectedSipCallId);
                if (vmCall === undefined) {
                  try {
                    if (!fdatefrom) {
                      this.logger.warn('Cannot query VoIPmonitor without fdatefrom (no date found in logs)', {
                        callId,
                        sipCallId: connectedSipCallId,
                      });
                      vmCall = null;
                      out.push(`VOIPMONITOR sipCallId=${connectedSipCallId} error {"message":"missing fdatefrom"}`);
                    } else {
                      vmCall = await this.voipmonitorService.findCallBySipCallIdWithDate(
                        connectedSipCallId,
                        fdatefrom,
                      );
                    }
                  } catch (e) {
                    this.logger.error('Failed to find call in VoIPmonitor by sipCallId', {
                      callId,
                      sipCallId: connectedSipCallId,
                      error: e?.message,
                    });
                    vmCall = null;
                    // Используем компактный JSON и убираем экранирование
                    const errorJson = JSON.stringify({
                      message: e?.message,
                      status: e?.status,
                      response: e?.response,
                    }).replace(/\\"/g, '"');
                    out.push(`VOIPMONITOR sipCallId=${connectedSipCallId} error ${errorJson}`);
                  }
                  voipCache.set(connectedSipCallId, vmCall);
                }

                // Вставляем в общий лог сразу после Call.Connected
                if (vmCall) {
                  // Формируем строку с ключевыми полями без экранирования
                  const fields = [
                    `ID=${vmCall.ID || ''}`,
                    `calldate=${vmCall.calldate || ''}`,
                    `callend=${vmCall.callend || ''}`,
                    `duration=${vmCall.duration || ''}`,
                    `caller=${vmCall.caller || ''}`,
                    `called=${vmCall.called || ''}`,
                    `sipcallerip=${vmCall.sipcallerip || ''}`,
                    `sipcalledip=${vmCall.sipcalledip || ''}`,
                    `whohanged=${vmCall.whohanged || ''}`,
                    `lastSIPresponseNum=${vmCall.lastSIPresponseNum || ''}`,
                    `lost=${vmCall.lost || ''}`,
                    `jitter=${vmCall.jitter || ''}`,
                    `mos_min=${vmCall.mos_min || ''}`,
                    `packet_loss_perc=${vmCall.packet_loss_perc || ''}`,
                    `a_codec=${vmCall.a_codec || ''}`,
                    `b_codec=${vmCall.b_codec || ''}`,
                  ].filter(f => f.split('=')[1] !== '').join(' ');
                  out.push(`VOIPMONITOR sipCallId=${connectedSipCallId} ${fields}`);
                } else {
                  out.push(`VOIPMONITOR sipCallId=${connectedSipCallId} not found`);
                }
              }
            }
          }
        }

        if (foundInviteInLog && out.length > 0) {
          filteredLog = out.join('\n').trim();
        }
      }

      // Если нашли sipCallId (Call.Connected) — ищем звонок в VoIPmonitor и добавляем в ответ
      let voipmonitorCall: any | null = null;
      if (sipCallId) {
        try {
          if (fallbackFdatefrom) {
            voipmonitorCall = await this.voipmonitorService.findCallBySipCallIdWithDate(sipCallId, fallbackFdatefrom);
          } else {
            voipmonitorCall = null;
          }
        } catch (e) {
          this.logger.error('Failed to find call in VoIPmonitor by sipCallId', {
            callId,
            sipCallId,
            error: e?.message,
          });
        }
      }

      // Важно: не возвращаем сырой debug/log (иначе в ответе снова будет "полный лог")
      return {
        success: data?.success ?? true,
        events,
        ...(filteredLog ? { log: filteredLog } : {}),
        ...(sipCallId ? { sipCallId } : {}),
        ...(sipCallId ? { voipmonitorCall } : {}),
      };
    } catch (error) {
      this.logger.error('Error formatting S2L log', {
        error: error.message,
        data,
      });
      // В случае ошибки возвращаем исходные данные
      return data;
    }
  }

  private formatDialerLog(data: any): any {
    // По умолчанию для dialer возвращаем данные как есть
    // Здесь можно добавить специфичное форматирование при необходимости
    return data;
  }

  private getApiUrl(callId: string): string {
    // Если callId содержит точку (формат: 1769423875.1860), используем ipmaxi API
    // Если callId без точки (формат: e5dda4626ae0e6b685765fc4490ac9ed), используем leads API
    if (callId.includes('.')) {
      return `${this.ipmaxiApiUrl}/${callId}?api-key=${this.apiKey}`;
    } else {
      return `${this.leadsApiUrl}/${callId}?api-key=${this.apiKey}`;
    }
  }

  async getCallTrace(callId: string) {
    const url = this.getApiUrl(callId);
    
    try {
      const response = await firstValueFrom(this.httpService.get(url));
      
      // Проверяем, если API вернул success: false, значит звонок не найден
      if (response.data?.success === false) {
        this.logger.warn('Call not found in API response', {
          callId,
          url,
          responseData: response.data,
        });
        throw new NotFoundException(response.data?.debug || 'call not found');
      }
      
      // Определяем тип звонка
      const callType = this.getCallType(callId);
      
      // Форматируем ответ в зависимости от типа
      const formattedData = await this.formatLog(callType, callId, response.data);
      
      return {
        callId,
        callType,
        data: formattedData,
      };
    } catch (error) {
      // Если это уже NotFoundException, пробрасываем дальше
      if (error instanceof NotFoundException) {
        throw error;
      }
      // Детальное логирование ошибки от API
      this.logger.error('Error fetching call log from API', {
        callId,
        url,
        error: {
          message: error.message,
          code: error.code,
          response: {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
            headers: error.response?.headers,
          },
          request: {
            method: error.request?.method,
            url: error.request?.url,
            headers: error.request?.headers,
          },
        },
      });

      if (error.response?.status === 404) {
        throw new NotFoundException('call not found');
      }
      
      throw new HttpException(
        error.response?.data?.message || 'Failed to fetch call log',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
