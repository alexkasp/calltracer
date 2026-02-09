import { Injectable, NotFoundException, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { VoipmonitorService } from './voipmonitor.service';
import { SbctelcoService } from './sbctelco.service';

@Injectable()
export class CalltraceService {
  private readonly logger = new Logger(CalltraceService.name);
  private readonly apiKey = 'f4cafb7d17a74ce5b082535ecc108533';
  private readonly ipmaxiApiUrl = 'https://api.ipmaxi.convolo.ai/api/v1/get-call-ai-log';
  private readonly leadsApiUrl = 'https://api.leads.convolo.ai/api/v1/calls/log';

  constructor(
    private readonly httpService: HttpService,
    private readonly voipmonitorService: VoipmonitorService,
    private readonly sbctelcoService: SbctelcoService,
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

  /**
   * Формирует URL для поиска звонка в VoIPmonitor по номерам A и B
   */
  private buildVoipmonitorSearchUrl(params: {
    fdatefrom: string;
    fcaller: string;
    fcalled: string;
    fcallerd_type?: number;
    fdurationgt?: number;
    fdurationlt?: number;
    limit?: number;
    start?: number;
  }): string {
    const {
      fdatefrom,
      fcaller,
      fcalled,
      fcallerd_type = 1,
      fdurationgt,
      fdurationlt,
      limit = 1,
      start = 0,
    } = params;

    const queryParams = new URLSearchParams({
      task: 'LISTING',
      module: 'CDR',
      limit: limit.toString(),
      start: start.toString(),
      fdatefrom,
      fcaller,
      fcalled,
      fcallerd_type: fcallerd_type.toString(),
    });

    if (fdurationgt !== undefined) {
      queryParams.append('fdurationgt', fdurationgt.toString());
    }
    if (fdurationlt !== undefined) {
      queryParams.append('fdurationlt', fdurationlt.toString());
    }

    return `https://voipmonitor.brightcall.ai/php/model/sql.php?${queryParams.toString()}`;
  }

  private async formatLog(callType: string, callId: string, data: any): Promise<any> {
    switch (callType) {
      case 'S2L':
      case 'dialer':
        // Один и тот же обработчик (events + log с VoIPmonitor, sbctelco, INVITE и т.д.); callType сохраняем для доработок под тип
        const result = await this.formatS2LLog(callId, data);
        return result && typeof result === 'object' ? { ...result, callType } : result;
      default:
        return data;
    }
  }

  private async formatS2LLog(callId: string, data: any): Promise<any> {
    // Для S2L: debug.log или log; для дайлера (ipmaxi API): pbxLog
    try {
      const logText = data?.debug?.log || data?.log || data?.pbxLog || '';
      
      if (!logText) {
        this.logger.warn('No log text found in S2L response');
        return data;
      }

      // Ищем начало секции events (в дайлере pbxLog секции events: нет — весь текст считаем логом)
      const eventsIndex = logText.indexOf('events:');
      const hasEventsSection = eventsIndex !== -1;
      const logSectionIndex = hasEventsSection ? logText.indexOf('\n\n log', eventsIndex) : -1;

      let eventsSection: string;
      let logSection: string | null = null;
      if (hasEventsSection) {
        if (logSectionIndex !== -1) {
          eventsSection = logText.substring(eventsIndex, logSectionIndex);
          logSection = logText.substring(logSectionIndex);
        } else {
          eventsSection = logText.substring(eventsIndex);
        }
      } else {
        // Нет секции events (например, дайлер pbxLog) — весь текст как секция log
        eventsSection = '';
        logSection = logText;
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
        const sipHistoryCache = new Map<string, string | null>();
        const sbctelcoCache = new Map<string, string | null>();

        const truncateText = (text: string, maxChars: number) => {
          if (!text) return '';
          if (text.length <= maxChars) return text;
          return `${text.slice(0, maxChars)}\n... [truncated ${text.length - maxChars} chars] ...`;
        };

        const appendSbctelcoTrace = async (calling: string, called: string) => {
          if (!calling || !called) return;
          const cacheKey = `sbctelco_${calling}_${called}`;

          let cached = sbctelcoCache.get(cacheKey);
          if (cached === undefined) {
            try {
              const raw = await this.sbctelcoService.getCallTrace({
                nb_result: 2,
                calling,
                called,
                recursive: 'yes',
              });
              const text = this.sbctelcoService.formatCallTraceText(raw);
              cached = truncateText(text, 100000);
            } catch (e: any) {
              this.logger.error('Failed to fetch SBCtelco call_trace', {
                callId,
                calling,
                called,
                error: e?.message,
              });
              const errorJson = JSON.stringify({
                message: e?.message,
                status: e?.status,
                response: e?.response,
              }).replace(/\\"/g, '"');
              cached = `ERROR ${errorJson}`;
            }
            sbctelcoCache.set(cacheKey, cached);
          }

          if (cached) {
            out.push(`--- SBCTELCO [calling: ${calling} -> called: ${called}] ---`);
            out.push(cached);
            out.push(`---`);
          }
        };

        const appendSipHistory = async (vmCall: any, header: string) => {
          const id = vmCall?.ID;
          if (!id) return;

          const idStr = String(id);
          const cacheKey = `sip_history_${idStr}`;

          let cached = sipHistoryCache.get(cacheKey);
          if (cached === undefined) {
            try {
              const raw = await this.voipmonitorService.getSipHistoryBriefDataById(idStr);
              // keep it bounded for response size (JSON can be big)
              cached = truncateText(raw, 8000);
            } catch (e: any) {
              this.logger.error('Failed to fetch VoIPmonitor SIP history', {
                callId,
                voipmonitorId: idStr,
                error: e?.message,
              });
              const errorJson = JSON.stringify({
                message: e?.message,
                status: e?.status,
                response: e?.response,
              }).replace(/\\"/g, '"');
              cached = `ERROR ${errorJson}`;
            }
            sipHistoryCache.set(cacheKey, cached);
          }

          if (cached) {
            out.push(`--- VOIPMONITOR SIP HISTORY [${header}] ---`);
            out.push(cached);
            out.push(`---`);
          }
        };

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
        // agentNumber из callParams/resultCallGroups
        const agentNumbersFull = new Set<string>();
        // индекс: последние 6 цифр -> полный agentNumber (первое найденное)
        const agentByLast6 = new Map<string, string>();
        // Ожидающий блок для формата sip:number@domain (INVITE уже видели, ждём f: для номера A)
        let pendingInviteSimple: { called: string; provider: string } | null = null;
        // Флаг: после "Notify sending to LeadCM" перед следующим INVITE вывести "call to client"
        let call2client = false;
        let call2clientCapture = false;
        // Флаг: видели "Notify sending to LeadCM"; сбрасывается после обнаружения INVITE в блоке Sent/Received
        let informLeadCall = false;
        // Для формата 2: следующая строка после "дата время Sent" или "Received:" идёт в вывод
        let addNextLineAfterSentReceived = false;

        const parseFromHeader = (line: string): string | null => {
          if (!line.includes('f:')) return null;
          const quoted = line.match(/f:\s*"([^"]+)"/);
          if (quoted) return quoted[1];
          const sipAngle = line.match(/<sip:([^@]+)@/);
          if (sipAngle) return sipAngle[1];
          return null;
        };

        const normalizeNumber = (n: string): string => {
          if (!n) return n;
          let out = n;
          // If number starts with 971, replace with 0
          if (out.startsWith('971')) out = '0' + out.substring(3);
          return out;
        };

        // Если To совпадает с agentNumber по последним 6 цифрам — выводим полный agentNumber
        const expandToIfAgent = (to: string): string => {
          if (!to) return to;
          const digits = to.replace(/\D/g, '');
          if (digits.length >= 6) {
            const last6 = digits.slice(-6);
            const full = agentByLast6.get(last6);
            if (full) return full;
          }
          return to;
        };

        // Разбор INVITE: формат 1 — sip:строка1_строка2_строка3_...@pbx... → A=строка2, B=строка3; формат 2 — sip:строка1@строка2 → B=строка1, домен=строка2, A из следующей строки f:
        const parseInviteLine = (
          userpart: string,
          domain: string,
        ): { format: 1; callerA: string; calledB: string; provider: string } | { format: 2; calledB: string; domain: string } | null => {
          if (!userpart || !domain) return null;
          const domainLower = domain.toLowerCase();
          const hasUnderscore = userpart.includes('_');
          if (hasUnderscore && domainLower.startsWith('pbx')) {
            const parts = userpart.split('_').filter((p) => p.length > 0);
            if (parts.length >= 3) {
              return {
                format: 1,
                provider: parts[0],
                callerA: parts[1],
                calledB: parts[2],
              };
            }
          }
          return { format: 2, calledB: userpart, domain };
        };

        // Первый проход: связь sipCallId -> { callerA, calledB } из INVITE (только формат 1)
        const inviteBySipCallId = new Map<string, { callerA: string; calledB: string }>();
        let lastInviteNumbers: { callerA: string; calledB: string } | null = null;
        const pendingSipCallIds: string[] = [];
        for (const line of logLines) {
          const inviteMatch = line.match(/INVITE sip:([^@\s]+)@([^\s]+)/);
          if (inviteMatch) {
            const userpart = inviteMatch[1];
            const domain = inviteMatch[2];
            const parsed = parseInviteLine(userpart, domain);
            if (parsed?.format === 1) {
              lastInviteNumbers = {
                callerA: normalizeNumber(parsed.callerA),
                calledB: normalizeNumber(parsed.calledB),
              };
              for (const id of pendingSipCallIds) {
                inviteBySipCallId.set(id, lastInviteNumbers);
              }
              pendingSipCallIds.length = 0;
            }
          }
          if (
            line.includes('Sent event to JS onPhoneEvent with params') &&
            (line.includes('name = Call.Failed') ||
              line.includes('name = Call.Connected') ||
              line.includes('name = Call.Disconnected'))
          ) {
            const sipCallIdMatch = line.match(/sipCallId\s*=\s*([^,;\]\s}]+)/);
            if (sipCallIdMatch) {
              pendingSipCallIds.push(sipCallIdMatch[1]);
            }
          }
        }
        // Связываем оставшиеся sipCallId с последним INVITE
        if (lastInviteNumbers) {
          for (const id of pendingSipCallIds) {
            inviteBySipCallId.set(id, lastInviteNumbers);
          }
        }

        for (const line of logLines) {
          const trimmed = line.trim();

          if (line.includes('Notify sending to LeadCM')) {
            call2client = true;
            call2clientCapture = true;
            informLeadCall = true;
            continue;
          }

          // Строки с "Terminating request" и "VoxEngine.terminate" — добавляем в вывод
          if (line.includes('Terminating request') && line.includes('VoxEngine.terminate')) {
            out.push(line.replace(/\r/g, ''));
          }

          // Строки с "[DEBUG] callFailed" — добавляем в вывод
          if (line.includes('[DEBUG] callFailed')) {
            out.push(line.replace(/\r/g, ''));
          }

          // Строки с "Sent event to JS VoxEngine.customData with params" — добавляем в вывод
          if (line.includes('Sent event to JS VoxEngine.customData with params')) {
            const raw = line.replace(/\r/g, '');

            // Извлекаем leadPhone и leadProvider (страна + первый провайдер) и выводим только их
            // Пример в логе:
            // [{"leadPhone":"41793337853","leadProvider":["Switzerland",[["didlogic","41523999999"], ... ]]]
            const phoneMatch = raw.match(/"leadPhone"\s*:\s*"([^"]+)"/);
            const providerMatch = raw.match(
              /"leadProvider"\s*:\s*\[\s*"([^"]+)"\s*,\s*\[\s*\[\s*"([^"]+)"\s*,\s*"([^"]+)"\s*\]/,
            );

            if (phoneMatch && providerMatch) {
              const leadPhone = phoneMatch[1];
              const country = providerMatch[1];
              const providerName = providerMatch[2];
              const providerNumber = providerMatch[3];
              out.push(
                `callParams: leadPhone ${leadPhone}, leadProvider:["${country}",[["${providerName}","${providerNumber}"]`,
              );
            }

            // resultCallGroups: вытаскиваем список агентов (agentNumber + agentName)
            // Пример:
            // "resultCallGroups":[[[24916,"971505721141",0,"Zemfira Agabekova","zemfira@..."]], ...]
            const agents: Array<{ number: string; name: string }> = [];
            const agentRe = /\[\s*\[\s*\d+\s*,\s*"([^"]+)"\s*,\s*\d+\s*,\s*"([^"]+)"/g;
            let m: RegExpExecArray | null;
            while ((m = agentRe.exec(raw)) !== null) {
              agents.push({ number: m[1], name: m[2] });
            }
            if (agents.length > 0) {
              const seen = new Set<string>();
              for (const a of agents) {
                const fullDigits = a.number?.replace(/\D/g, '');
                if (fullDigits) {
                  agentNumbersFull.add(fullDigits);
                  if (fullDigits.length >= 6) {
                    const last6 = fullDigits.slice(-6);
                    if (!agentByLast6.has(last6)) agentByLast6.set(last6, fullDigits);
                  }
                }
                const key = `${a.number}::${a.name}`;
                if (seen.has(key)) continue;
                seen.add(key);
                out.push(`agentNumber ${a.number} agentName ${a.name}`);
              }
              continue;
            }

            // fallback: просто переименуем префикс
            if (!(phoneMatch && providerMatch)) {
              out.push(
                raw.replace(
                  'Sent event to JS VoxEngine.customData with params',
                  'callParams:',
                ),
              );
            }
          }

          // Следующая строка после "дата время Sent:" или "Received:" — добавляем в вывод; если это INVITE — выводим TRY TO CALL LEAD и сбрасываем informLeadCall
          if (addNextLineAfterSentReceived) {
            const isInviteLine = /INVITE sip:([^@\s]+)@([^\s]+)/.test(line);
            if (isInviteLine && informLeadCall) {
              out.push('TRY TO CALL LEAD');
              informLeadCall = false;
            }
            out.push(line.replace(/\r/g, ''));
            addNextLineAfterSentReceived = false;
             if(!isInviteLine)
               continue;
          }

          // До name = Call.Connected/Failed сохраняем строки "дата время Sent:" или "Received:" и следующую за ними только если уже видели Notify (informLeadCall)
          if (call2clientCapture) {
            if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?\s+(Sent:|Received:)\s*$/.test(trimmed)) {
              out.push(line.replace(/\r/g, ''));
              addNextLineAfterSentReceived = true;
              continue;
            }
            if (line.includes('name = Call.Connected') || line.includes('name = Call.Disconnected')) {
              call2clientCapture = false;
            }
          }

          // Начало SIP TRACE блока — выводим ожидающий блок без From (если есть), затем включаем захват
          if (trimmed.includes('-----BEGIN SIP TRACE')) {
            if (pendingInviteSimple) {
              if (call2client) {
                out.push(`--- call to client ---`);
                call2client = false;
              }
              out.push(`--- NEW CALL INVITE ---`);
              out.push(`  Called: ${pendingInviteSimple.called}`);
              out.push(`  Provider: ${pendingInviteSimple.provider}`);
              out.push(`---`);
              pendingInviteSimple = null;
            }
            capture = true;
            foundInviteInLog = true;
            continue;
          }

          // В блоке SIP TRACE — строка f: (From): номер A только для формата 2 (sip:строка1@строка2), не перезаписывать A из формата 1
          if (capture) {
            const fromNumber = parseFromHeader(line);
            if (fromNumber != null && pendingInviteSimple) {
              currentCallerA = normalizeNumber(fromNumber);
              if (call2client) {
                call2client = false;
              }
              const displayTo = expandToIfAgent(pendingInviteSimple.called);
              out.push(`--- NEW CALL INVITE ---`);
              out.push(`  From: ${currentCallerA} -> To: ${displayTo}`);
              out.push(`  Provider: ${pendingInviteSimple.provider}`);
              out.push(`---`);
              pendingInviteSimple = null;
              continue;
            }
          }

          // В блоке SIP TRACE — строка "Sent:" не выводим
          if (capture && trimmed.includes('Sent:')) {
            continue;
          }

          // Встречаем INVITE sip: — формат 1 (строка1_строка2_строка3_...@pbx...) или формат 2 (строка1@строка2, A из следующей строки f:)
          const inviteMatch = line.match(/INVITE sip:([^@\s]+)@([^\s]+)/);
          if (inviteMatch) {
            const userpart = inviteMatch[1];
            const domain = inviteMatch[2];
            const parsed = parseInviteLine(userpart, domain);
            if (parsed?.format === 1) {
              pendingInviteSimple = null; // A уже из INVITE; не перезаписывать из последующей строки f:
              if (call2client) {
                out.push(`--- call to client ---`);
                call2client = false;
              }
              const displayTo = expandToIfAgent(parsed.calledB);
              out.push(`--- NEW CALL INVITE ---`);
              out.push(`  From: ${parsed.callerA} -> To: ${displayTo}`);
              out.push(`  Domain: ${domain}`);
              out.push(`  Provider: ${parsed.provider}`);
              out.push(`---`);
              currentCallerA = normalizeNumber(parsed.callerA);
              currentCalledB = normalizeNumber(parsed.calledB);
            } else if (parsed?.format === 2) {
              // Формат sip:строка1@строка2 — B=строка1, домен=строка2, A из следующей строки f:
              pendingInviteSimple = { called: parsed.calledB, provider: parsed.domain };
              currentCalledB = normalizeNumber(parsed.calledB);
            }
            capture = true;
            foundInviteInLog = true;

            const timeMatch = line.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?)/);
            if (timeMatch) {
              currentCallTime = timeMatch[1];
            }

            continue;
          }

          if (
            capture &&
            line.includes('Sent event to JS onPhoneEvent with params') &&
            (line.includes('name = Call.Failed') ||
              line.includes('name = Call.AudioStarted') ||
              line.includes('name = Call.Connected') ||
              line.includes('name = Call.Disconnected'))
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
                      const searchUrl = this.buildVoipmonitorSearchUrl({
                        fdatefrom,
                        fcaller: currentCallerA,
                        fcalled: currentCalledB,
                        fcallerd_type: 1, // точное совпадение
                      });
                      const response = await this.voipmonitorService.getCalls({
                        limit: 1,
                        start: 0,
                        fdatefrom,
                        fcaller: currentCallerA,
                        fcalled: currentCalledB,
                        fcallerd_type: 1, // точное совпадение
                      });
                      vmCall = response?.results?.[0] || null;
                      // Нашли по A/B => дополнительно ищем в SBCtelco
                      if (vmCall) {
                        await appendSbctelcoTrace(currentCallerA, currentCalledB);
                      } else {
                        // Звонок не найден - добавляем предупреждение с URL
                        out.push(`--- Call not found in VoIPmonitor ---`);
                        out.push(`⚠️  WARNING: Call not found in VoIPmonitor by A/B numbers`);
                        out.push(`   Search URL: ${searchUrl}`);
                        out.push(`   Parameters: fdatefrom=${fdatefrom}, fcaller=${currentCallerA}, fcalled=${currentCalledB}, fcallerd_type=1`);
                        out.push(`---`);
                      }
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
                const displayNumbers = failedSipCallId ? inviteBySipCallId.get(failedSipCallId) : null;
                const displayCaller = (displayNumbers?.callerA ?? (currentCallerA && currentCalledB ? currentCallerA : null)) ?? (vmCall.caller || 'N/A');
                const displayCalled = (displayNumbers?.calledB ?? (currentCallerA && currentCalledB ? currentCalledB : null)) ?? (vmCall.called || 'N/A');
                const searchInfo = failedSipCallId 
                  ? `sipCallId: ${failedSipCallId}` 
                  : `caller: ${currentCallerA}, called: ${currentCalledB}`;
                out.push(`--- VOIPMONITOR Call.Failed [${searchInfo}] ---`);
                out.push(`  ID: ${vmCall.ID || 'N/A'}`);
                out.push(`  Time: ${vmCall.calldate || 'N/A'} - ${vmCall.callend || 'N/A'} (duration: ${vmCall.duration || 'N/A'})`);
                out.push(`  Caller: ${displayCaller} -> Called: ${displayCalled}`);
                out.push(`  IPs: ${vmCall.sipcallerip || 'N/A'}:${vmCall.sipcallerport || 'N/A'} -> ${vmCall.sipcalledip || 'N/A'}:${vmCall.sipcalledport || 'N/A'}`);
                out.push(`  Result: ${vmCall.lastSIPresponseNum || 'N/A'} ${vmCall.lastSIPresponse || ''} | Who hung up: ${vmCall.whohanged || 'N/A'}`);
                if (vmCall.lost || vmCall.jitter || vmCall.mos_min) {
                  out.push(`  Quality: lost=${vmCall.lost || 0} packets, jitter=${vmCall.jitter || 0}ms, MOS=${vmCall.mos_min || 'N/A'}, packet_loss=${vmCall.packet_loss_perc || 0}%`);
                }
                if (vmCall.a_codec || vmCall.b_codec) {
                  out.push(`  Codecs: A=${vmCall.a_codec || 'N/A'}, B=${vmCall.b_codec || 'N/A'}`);
                }
                out.push(`---`);

                await appendSipHistory(vmCall, `Call.Failed id=${vmCall.ID || 'N/A'}`);
                
                // Дополнительный поиск по номерам A и B (без фильтров по длительности)
                if (failedSipCallId && currentCallerA && currentCalledB) {
                  try {
                    // Преобразуем время звонка (+3 часа)
                    let searchFdatefrom = fdatefrom;
                    if (vmCall.calldate) {
                      // Формат: "2026-01-26 09:42:03"
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
                    
                    // Ищем звонок по номерам A и B БЕЗ фильтров по длительности
                    const abCallCacheKey = `ab_failed_${currentCallerA}_${currentCalledB}_${searchFdatefrom}`;
                    let abVmCall = voipCache.get(abCallCacheKey);
                    
                    if (abVmCall === undefined) {
                      if (searchFdatefrom) {
                        const abSearchUrl = this.buildVoipmonitorSearchUrl({
                          fdatefrom: searchFdatefrom,
                          fcaller: currentCallerA,
                          fcalled: currentCalledB,
                          fcallerd_type: 1,
                          // НЕ добавляем fdurationgt и fdurationlt
                        });
                        const abResponse = await this.voipmonitorService.getCalls({
                          limit: 1,
                          start: 0,
                          fdatefrom: searchFdatefrom,
                          fcaller: currentCallerA,
                          fcalled: currentCalledB,
                          fcallerd_type: 1,
                          // НЕ добавляем fdurationgt и fdurationlt
                        });
                        abVmCall = abResponse?.results?.[0] || null;
                        // Сохраняем URL в кэш для вывода, если не найден
                        if (!abVmCall) {
                          voipCache.set(`${abCallCacheKey}_url`, abSearchUrl);
                        }
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
                      out.push(`  Caller: ${currentCallerA && currentCalledB ? currentCallerA : (abVmCall.caller || 'N/A')} -> Called: ${currentCallerA && currentCalledB ? currentCalledB : (abVmCall.called || 'N/A')}`);
                      out.push(`  IPs: ${abVmCall.sipcallerip || 'N/A'}:${abVmCall.sipcallerport || 'N/A'} -> ${abVmCall.sipcalledip || 'N/A'}:${abVmCall.sipcalledport || 'N/A'}`);
                      out.push(`  Result: ${abVmCall.lastSIPresponseNum || 'N/A'} ${abVmCall.lastSIPresponse || ''} | Who hung up: ${abVmCall.whohanged || 'N/A'}`);
                      if (abVmCall.lost || abVmCall.jitter || abVmCall.mos_min) {
                        out.push(`  Quality: lost=${abVmCall.lost || 0} packets, jitter=${abVmCall.jitter || 0}ms, MOS=${abVmCall.mos_min || 'N/A'}, packet_loss=${abVmCall.packet_loss_perc || 0}%`);
                      }
                      if (abVmCall.a_codec || abVmCall.b_codec) {
                        out.push(`  Codecs: A=${abVmCall.a_codec || 'N/A'}, B=${abVmCall.b_codec || 'N/A'}`);
                      }
                      out.push(`---`);

                      await appendSipHistory(abVmCall, `Additional Search id=${abVmCall.ID || 'N/A'}`);
                      // Нашли по A/B => дополнительно ищем в SBCtelco
                      if (currentCallerA && currentCalledB) {
                        await appendSbctelcoTrace(currentCallerA, currentCalledB);
                      }
                    } else {
                      const cachedUrl = voipCache.get(`${abCallCacheKey}_url`) as string;
                      const abSearchUrl = cachedUrl || this.buildVoipmonitorSearchUrl({
                        fdatefrom: searchFdatefrom || fdatefrom,
                        fcaller: currentCallerA,
                        fcalled: currentCalledB,
                        fcallerd_type: 1,
                      });
                      out.push(`--- VOIPMONITOR Additional Search [caller: ${currentCallerA}, called: ${currentCalledB}] --- NOT FOUND ---`);
                      out.push(`⚠️  WARNING: Call not found in VoIPmonitor by A/B numbers`);
                      out.push(`   Search URL: ${abSearchUrl}`);
                      out.push(`   Parameters: fdatefrom=${searchFdatefrom || fdatefrom}, fcaller=${currentCallerA}, fcalled=${currentCalledB}, fcallerd_type=1`);
                      out.push(`---`);
                    }
                  } catch (e) {
                    this.logger.error('Failed to find call in VoIPmonitor by A/B numbers for Call.Failed', {
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
                const searchInfo = failedSipCallId 
                  ? `sipCallId: ${failedSipCallId}` 
                  : `caller: ${currentCallerA}, called: ${currentCalledB}`;
                out.push(`--- Call not found in VoIPmonitor ---`);
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
                  const displayNumbersConnected = inviteBySipCallId.get(connectedSipCallId);
                  const displayCallerConnected = (displayNumbersConnected?.callerA ?? (currentCallerA && currentCalledB ? currentCallerA : null)) ?? (vmCall.caller || 'N/A');
                  const displayCalledConnected = (displayNumbersConnected?.calledB ?? (currentCallerA && currentCalledB ? currentCalledB : null)) ?? (vmCall.called || 'N/A');
                  out.push(`--- VOIPMONITOR Call.Connected [sipCallId: ${connectedSipCallId}] ---`);
                  out.push(`  ID: ${vmCall.ID || 'N/A'}`);
                  out.push(`  Time: ${vmCall.calldate || 'N/A'} - ${vmCall.callend || 'N/A'} (duration: ${vmCall.duration || 'N/A'})`);
                  out.push(`  Caller: ${displayCallerConnected} -> Called: ${displayCalledConnected}`);
                  out.push(`  IPs: ${vmCall.sipcallerip || 'N/A'}:${vmCall.sipcallerport || 'N/A'} -> ${vmCall.sipcalledip || 'N/A'}:${vmCall.sipcalledport || 'N/A'}`);
                  out.push(`  Result: ${vmCall.lastSIPresponseNum || 'N/A'} ${vmCall.lastSIPresponse || ''} | Who hung up: ${vmCall.whohanged || 'N/A'}`);
                  if (vmCall.lost || vmCall.jitter || vmCall.mos_min) {
                    out.push(`  Quality: lost=${vmCall.lost || 0} packets, jitter=${vmCall.jitter || 0}ms, MOS=${vmCall.mos_min || 'N/A'}, packet_loss=${vmCall.packet_loss_perc || 0}%`);
                  }
                  if (vmCall.a_codec || vmCall.b_codec) {
                    out.push(`  Codecs: A=${vmCall.a_codec || 'N/A'}, B=${vmCall.b_codec || 'N/A'}`);
                  }
                  out.push(`---`);

                  await appendSipHistory(vmCall, `Call.Connected id=${vmCall.ID || 'N/A'}`);
                  
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
                          const abSearchUrl = this.buildVoipmonitorSearchUrl({
                            fdatefrom: searchFdatefrom,
                            fcaller: currentCallerA,
                            fcalled: currentCalledB,
                            fcallerd_type: 1,
                            fdurationgt,
                            fdurationlt,
                          });
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
                          // Сохраняем URL в кэш для вывода, если не найден
                          if (!abVmCall) {
                            voipCache.set(`${abCallCacheKey}_url`, abSearchUrl);
                          }
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
                        out.push(`  Caller: ${currentCallerA && currentCalledB ? currentCallerA : (abVmCall.caller || 'N/A')} -> Called: ${currentCallerA && currentCalledB ? currentCalledB : (abVmCall.called || 'N/A')}`);
                        out.push(`  IPs: ${abVmCall.sipcallerip || 'N/A'}:${abVmCall.sipcallerport || 'N/A'} -> ${abVmCall.sipcalledip || 'N/A'}:${abVmCall.sipcalledport || 'N/A'}`);
                        out.push(`  Result: ${abVmCall.lastSIPresponseNum || 'N/A'} ${abVmCall.lastSIPresponse || ''} | Who hung up: ${abVmCall.whohanged || 'N/A'}`);
                        if (abVmCall.lost || abVmCall.jitter || abVmCall.mos_min) {
                          out.push(`  Quality: lost=${abVmCall.lost || 0} packets, jitter=${abVmCall.jitter || 0}ms, MOS=${abVmCall.mos_min || 'N/A'}, packet_loss=${abVmCall.packet_loss_perc || 0}%`);
                        }
                        if (abVmCall.a_codec || abVmCall.b_codec) {
                          out.push(`  Codecs: A=${abVmCall.a_codec || 'N/A'}, B=${abVmCall.b_codec || 'N/A'}`);
                        }
                        out.push(`---`);

                        await appendSipHistory(abVmCall, `Additional Search id=${abVmCall.ID || 'N/A'}`);
                        // Нашли по A/B => дополнительно ищем в SBCtelco
                        if (currentCallerA && currentCalledB) {
                          await appendSbctelcoTrace(currentCallerA, currentCalledB);
                        }
                      } else {
                        const cachedUrl = voipCache.get(`${abCallCacheKey}_url`) as string;
                        const abSearchUrl = cachedUrl || this.buildVoipmonitorSearchUrl({
                          fdatefrom: searchFdatefrom || fdatefrom,
                          fcaller: currentCallerA,
                          fcalled: currentCalledB,
                          fcallerd_type: 1,
                          fdurationgt,
                          fdurationlt,
                        });
                        out.push(`--- VOIPMONITOR Additional Search [caller: ${currentCallerA}, called: ${currentCalledB}] --- NOT FOUND ---`);
                        out.push(`⚠️  WARNING: Call not found in VoIPmonitor by A/B numbers`);
                        out.push(`   Search URL: ${abSearchUrl}`);
                        const params = [
                          `fdatefrom=${searchFdatefrom || fdatefrom}`,
                          `fcaller=${currentCallerA}`,
                          `fcalled=${currentCalledB}`,
                          `fcallerd_type=1`,
                        ];
                        if (fdurationgt !== undefined) params.push(`fdurationgt=${fdurationgt}`);
                        if (fdurationlt !== undefined) params.push(`fdurationlt=${fdurationlt}`);
                        out.push(`   Parameters: ${params.join(', ')}`);
                        out.push(`---`);
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

        if (pendingInviteSimple) {
          if (call2client) {
            out.push(`--- call to client ---`);
            call2client = false;
          }
          out.push(`--- NEW CALL INVITE ---`);
          out.push(`  Called: ${pendingInviteSimple.called}`);
          out.push(`  Provider: ${pendingInviteSimple.provider}`);
          out.push(`---`);
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
