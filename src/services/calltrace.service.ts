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
        .map((line) => {
          // Улучшаем читаемость events - форматируем строки вида "2026-01-26 09:42:03.717Z 97124940699 -> 0551870279 s4y1 thr sent to SBC"
          const eventMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+([^\s]+)\s+->\s+([^\s]+)\s+(.+)$/);
          if (eventMatch) {
            return `  ${eventMatch[1]} | From: ${eventMatch[2]} -> To: ${eventMatch[3]} | ${eventMatch[4]}`;
          }
          return line;
        })
        .join('\n');

      const events = `--- EVENTS ---\n${cleanedEventsSection.trim()}\n---`;
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

        // Переменные для хранения номеров A и B и времени текущего INVITE
        let currentCallTime: string | null = null;
        let currentCallerA: string | null = null;
        let currentCalledB: string | null = null;

        for (const line of logLines) {
          const trimmed = line.trim();

          // Встречаем новый INVITE — начинаем/перезапускаем накопление
          if (trimmed.startsWith('INVITE sip:')) {
            // Упрощаем INVITE строку для лучшей читаемости
            const inviteLineMatch = line.match(/INVITE sip:([^@]+)@([^\s]+)/);
            if (inviteLineMatch) {
              const sipUri = inviteLineMatch[1];
              const domain = inviteLineMatch[2];
              // Извлекаем номера из URI если есть
              const uriMatch = sipUri.match(/thr_([^_]+)_([^_]+)_([^@]+)/);
              if (uriMatch) {
                out.push(`--- NEW CALL INVITE ---`);
                out.push(`  From: ${uriMatch[1]} -> To: ${uriMatch[2]}`);
                out.push(`  Domain: ${domain}`);
                out.push(`  Call ID: ${uriMatch[3]}`);
                out.push(`---`);
              } else {
                out.push(`--- NEW CALL INVITE: ${sipUri}@${domain} ---`);
              }
            } else {
              // Убираем \r и оставляем как есть если не удалось распарсить
              out.push(line.replace(/\r/g, ''));
            }
            capture = true;
            foundInviteInLog = true;
            
            // Извлекаем время из строки (формат: YYYY-MM-DD HH:mm:ss.SSS)
            const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
            if (timeMatch) {
              currentCallTime = timeMatch[1];
            }
            
            // Извлекаем номера A и B из строки INVITE sip:thr_%s_A_B_callId@domain
            // Формат: INVITE sip:thr_97124940699_0585254194_a6ed1afa1fa14ca013b4443170a1baae@pbx15.convolo.ai
            const inviteMatch = line.match(/INVITE sip:thr_([^_]+)_([^_]+)_([^@]+)@/);
            if (inviteMatch) {
              // inviteMatch[1] - первый номер (A), inviteMatch[2] - второй номер (B), inviteMatch[3] - callId
              let callerA = inviteMatch[1];
              let calledB = inviteMatch[2];
              
              // Если номер начинается с 971, заменяем на 0
              if (callerA.startsWith('971')) {
                callerA = '0' + callerA.substring(3);
              }
              if (calledB.startsWith('971')) {
                calledB = '0' + calledB.substring(3);
              }
              
              currentCallerA = callerA;
              currentCalledB = calledB;
              
              this.logger.debug('Extracted call numbers from INVITE', {
                originalA: inviteMatch[1],
                originalB: inviteMatch[2],
                callerA: currentCallerA,
                calledB: currentCalledB,
                callTime: currentCallTime,
              });
            }
            
            continue;
          }

          if (
            capture &&
            line.includes('Sent event to JS onPhoneEvent with params') &&
            (line.includes('name = Call.Failed') ||
              line.includes('name = Call.AudioStarted') ||
              line.includes('name = Call.Connected'))
          ) {
            // Извлекаем ключевые поля из события для упрощения вывода
            const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
            const time = timeMatch ? timeMatch[1] : '';
            const nameMatch = line.match(/name\s*=\s*([^,;]+)/);
            const eventName = nameMatch ? nameMatch[1].trim() : '';
            const sipCallIdMatch = line.match(/sipCallId\s*=\s*([^,;\]\s}]+)/);
            const eventSipCallId = sipCallIdMatch ? sipCallIdMatch[1] : '';
            const codeMatch = line.match(/code\s*=\s*(\d+)/);
            const code = codeMatch ? codeMatch[1] : '';
            const reasonMatch = line.match(/reason\s*=\s*([^,;\]\s}]+)/);
            const reason = reasonMatch ? reasonMatch[1].trim() : '';
            
            // Формируем упрощенную строку события
            const simplifiedEvent = [
              time,
              `Event: ${eventName}`,
              eventSipCallId ? `sipCallId: ${eventSipCallId}` : '',
              code ? `code: ${code}` : '',
              reason ? `reason: ${reason}` : '',
            ].filter(Boolean).join(' | ');
            out.push(simplifiedEvent);

            // Для Call.Failed извлекаем sipCallId (если есть) или используем номера A и B для поиска
            if (line.includes('name = Call.Failed')) {
              const m = line.match(/sipCallId\s*=\s*([^,;\]\s}]+)/);
              const failedSipCallId = m?.[1];
              
              const dateMatch = line.match(/^(\d{4}-\d{2}-\d{2})/);
              const fdatefrom = dateMatch ? `${dateMatch[1]}T00:00:00` : fallbackFdatefrom;
              
              let vmCall: any | null = null;
              const cacheKey = failedSipCallId || `failed_${currentCallerA}_${currentCalledB}`;
              
              // Проверяем кэш
              let cachedCall = voipCache.get(cacheKey);
              if (cachedCall !== undefined) {
                vmCall = cachedCall;
              } else {
                try {
                  if (!fdatefrom) {
                    this.logger.warn('Cannot query VoIPmonitor for Call.Failed without fdatefrom', {
                      callId,
                      sipCallId: failedSipCallId,
                      callerA: currentCallerA,
                      calledB: currentCalledB,
                    });
                    vmCall = null;
                    out.push(`VOIPMONITOR Call.Failed error {"message":"missing fdatefrom"}`);
                  } else {
                    if (failedSipCallId) {
                      // Ищем по sipCallId
                      vmCall = await this.voipmonitorService.findCallBySipCallIdWithDate(
                        failedSipCallId,
                        fdatefrom,
                      );
                    } else if (currentCallerA && currentCalledB) {
                      // Ищем по номерам A и B
                      const response = await this.voipmonitorService.getCalls({
                        limit: 1,
                        start: 0,
                        fdatefrom,
                        fcaller: currentCallerA,
                        fcalled: currentCalledB,
                        fcallerd_type: 1, // точное совпадение
                      });
                      vmCall = response?.results?.[0] || null;
                    }
                  }
                } catch (e) {
                  this.logger.error('Failed to find call in VoIPmonitor for Call.Failed', {
                    callId,
                    sipCallId: failedSipCallId,
                    callerA: currentCallerA,
                    calledB: currentCalledB,
                    error: e?.message,
                  });
                  vmCall = null;
                  const errorJson = JSON.stringify({
                    message: e?.message,
                    status: e?.status,
                    response: e?.response,
                  }).replace(/\\"/g, '"');
                  out.push(`VOIPMONITOR Call.Failed error ${errorJson}`);
                }
                voipCache.set(cacheKey, vmCall);
              }
              
              // Вставляем результат в лог в структурированном формате
              if (vmCall) {
                const searchInfo = failedSipCallId 
                  ? `sipCallId: ${failedSipCallId}` 
                  : `caller: ${currentCallerA}, called: ${currentCalledB}`;
                out.push(`--- VOIPMONITOR Call.Failed [${searchInfo}] ---`);
                out.push(`  ID: ${vmCall.ID || 'N/A'}`);
                out.push(`  Time: ${vmCall.calldate || 'N/A'} - ${vmCall.callend || 'N/A'} (duration: ${vmCall.duration || 'N/A'})`);
                out.push(`  Caller: ${vmCall.caller || 'N/A'} -> Called: ${vmCall.called || 'N/A'}`);
                out.push(`  IPs: ${vmCall.sipcallerip || 'N/A'}:${vmCall.sipcallerport || 'N/A'} -> ${vmCall.sipcalledip || 'N/A'}:${vmCall.sipcalledport || 'N/A'}`);
                out.push(`  Result: ${vmCall.lastSIPresponseNum || 'N/A'} ${vmCall.lastSIPresponse || ''} | Who hung up: ${vmCall.whohanged || 'N/A'}`);
                if (vmCall.lost || vmCall.jitter || vmCall.mos_min) {
                  out.push(`  Quality: lost=${vmCall.lost || 0} packets, jitter=${vmCall.jitter || 0}ms, MOS=${vmCall.mos_min || 'N/A'}, packet_loss=${vmCall.packet_loss_perc || 0}%`);
                }
                if (vmCall.a_codec || vmCall.b_codec) {
                  out.push(`  Codecs: A=${vmCall.a_codec || 'N/A'}, B=${vmCall.b_codec || 'N/A'}`);
                }
                out.push(`---`);
              } else {
                const searchInfo = failedSipCallId 
                  ? `sipCallId: ${failedSipCallId}` 
                  : `caller: ${currentCallerA}, called: ${currentCalledB}`;
                out.push(`--- VOIPMONITOR Call.Failed [${searchInfo}] --- NOT FOUND ---`);
              }
            }

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

                // Вставляем в общий лог сразу после Call.Connected в структурированном формате
                if (vmCall) {
                  out.push(`--- VOIPMONITOR Call.Connected [sipCallId: ${connectedSipCallId}] ---`);
                  out.push(`  ID: ${vmCall.ID || 'N/A'}`);
                  out.push(`  Time: ${vmCall.calldate || 'N/A'} - ${vmCall.callend || 'N/A'} (duration: ${vmCall.duration || 'N/A'})`);
                  out.push(`  Caller: ${vmCall.caller || 'N/A'} -> Called: ${vmCall.called || 'N/A'}`);
                  out.push(`  IPs: ${vmCall.sipcallerip || 'N/A'}:${vmCall.sipcallerport || 'N/A'} -> ${vmCall.sipcalledip || 'N/A'}:${vmCall.sipcalledport || 'N/A'}`);
                  out.push(`  Result: ${vmCall.lastSIPresponseNum || 'N/A'} ${vmCall.lastSIPresponse || ''} | Who hung up: ${vmCall.whohanged || 'N/A'}`);
                  if (vmCall.lost || vmCall.jitter || vmCall.mos_min) {
                    out.push(`  Quality: lost=${vmCall.lost || 0} packets, jitter=${vmCall.jitter || 0}ms, MOS=${vmCall.mos_min || 'N/A'}, packet_loss=${vmCall.packet_loss_perc || 0}%`);
                  }
                  if (vmCall.a_codec || vmCall.b_codec) {
                    out.push(`  Codecs: A=${vmCall.a_codec || 'N/A'}, B=${vmCall.b_codec || 'N/A'}`);
                  }
                  out.push(`---`);
                  
                  // Дополнительный поиск по номерам A и B, если они есть
                  if (currentCallerA && currentCalledB && vmCall.duration) {
                    try {
                      // Преобразуем длительность из "01:13" в секунды (73)
                      const durationStr = vmCall.duration;
                      const durationMatch = durationStr.match(/(\d+):(\d+)/);
                      let durationSeconds = 0;
                      if (durationMatch) {
                        const minutes = parseInt(durationMatch[1], 10);
                        const seconds = parseInt(durationMatch[2], 10);
                        durationSeconds = minutes * 60 + seconds;
                      }
                      
                      // Вычисляем фильтры по длительности
                      const fdurationgt = Math.max(0, durationSeconds - 5);
                      const fdurationlt = durationSeconds + 5;
                      
                      // Преобразуем время звонка (+7 часов)
                      let searchFdatefrom = fdatefrom;
                      if (vmCall.calldate) {
                        // Формат: "2026-01-26 09:42:41"
                        const calldateMatch = vmCall.calldate.match(/(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}):(\d{2})/);
                        if (calldateMatch) {
                          const date = calldateMatch[1];
                          let hour = parseInt(calldateMatch[2], 10);
                          const minute = calldateMatch[3];
                          const second = calldateMatch[4];
                          
                          // Добавляем 3 часа
                          hour = (hour + 3) % 24;
                          const hourStr = hour.toString().padStart(2, '0');
                          searchFdatefrom = `${date}T${hourStr}:${minute}:${second}`;
                        }
                      }
                      
                      // Ищем звонок по номерам A и B с фильтрами по времени и длительности
                      const abCallCacheKey = `ab_${currentCallerA}_${currentCalledB}_${searchFdatefrom}_${fdurationgt}_${fdurationlt}`;
                      let abVmCall = voipCache.get(abCallCacheKey);
                      
                      if (abVmCall === undefined) {
                        if (searchFdatefrom) {
                          const abResponse = await this.voipmonitorService.getCalls({
                            limit: 1,
                            start: 0,
                            fdatefrom: searchFdatefrom,
                            fcaller: currentCallerA,
                            fcalled: currentCalledB,
                            fcallerd_type: 1,
                            fdurationgt,
                            fdurationlt,
                          });
                          abVmCall = abResponse?.results?.[0] || null;
                        } else {
                          abVmCall = null;
                        }
                        voipCache.set(abCallCacheKey, abVmCall);
                      }
                      
                      // Выводим результат поиска по A и B в структурированном формате
                      if (abVmCall) {
                        out.push(`--- VOIPMONITOR Additional Search [caller: ${currentCallerA}, called: ${currentCalledB}] ---`);
                        out.push(`  ID: ${abVmCall.ID || 'N/A'}`);
                        out.push(`  Time: ${abVmCall.calldate || 'N/A'} - ${abVmCall.callend || 'N/A'} (duration: ${abVmCall.duration || 'N/A'})`);
                        out.push(`  Caller: ${abVmCall.caller || 'N/A'} -> Called: ${abVmCall.called || 'N/A'}`);
                        out.push(`  IPs: ${abVmCall.sipcallerip || 'N/A'}:${abVmCall.sipcallerport || 'N/A'} -> ${abVmCall.sipcalledip || 'N/A'}:${abVmCall.sipcalledport || 'N/A'}`);
                        out.push(`  Result: ${abVmCall.lastSIPresponseNum || 'N/A'} ${abVmCall.lastSIPresponse || ''} | Who hung up: ${abVmCall.whohanged || 'N/A'}`);
                        if (abVmCall.lost || abVmCall.jitter || abVmCall.mos_min) {
                          out.push(`  Quality: lost=${abVmCall.lost || 0} packets, jitter=${abVmCall.jitter || 0}ms, MOS=${abVmCall.mos_min || 'N/A'}, packet_loss=${abVmCall.packet_loss_perc || 0}%`);
                        }
                        if (abVmCall.a_codec || abVmCall.b_codec) {
                          out.push(`  Codecs: A=${abVmCall.a_codec || 'N/A'}, B=${abVmCall.b_codec || 'N/A'}`);
                        }
                        out.push(`---`);
                      } else {
                        out.push(`--- VOIPMONITOR Additional Search [caller: ${currentCallerA}, called: ${currentCalledB}] --- NOT FOUND ---`);
                      }
                    } catch (e) {
                      this.logger.error('Failed to find call in VoIPmonitor by A/B numbers', {
                        callId,
                        callerA: currentCallerA,
                        calledB: currentCalledB,
                        error: e?.message,
                      });
                      const errorJson = JSON.stringify({
                        message: e?.message,
                        status: e?.status,
                        response: e?.response,
                      }).replace(/\\"/g, '"');
                      out.push(`VOIPMONITOR caller=${currentCallerA} called=${currentCalledB} error ${errorJson}`);
                    }
                  }
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

      // Важно: не возвращаем сырой debug/log (иначе в ответе снова будет "полный лог")
      // Заменяем строковые \n на реальные переносы строк
      const processedEvents = events ? events.replace(/\\n/g, '\n') : events;
      const processedLog = filteredLog ? filteredLog.replace(/\\n/g, '\n') : filteredLog;
      
      return {
        success: data?.success ?? true,
        events: processedEvents,
        ...(processedLog ? { log: processedLog } : {}),
        ...(sipCallId ? { sipCallId } : {}),
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
