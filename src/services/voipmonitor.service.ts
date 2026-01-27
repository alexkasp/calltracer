import { Injectable, Logger, HttpException, HttpStatus, Inject, BadRequestException } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import Redis from 'ioredis';
import { firstValueFrom } from 'rxjs';

@Injectable()
export class VoipmonitorService {
  private readonly logger = new Logger(VoipmonitorService.name);
  private readonly voipmonitorUrl = 'https://voipmonitor.brightcall.ai';
  private readonly username = 'a.salikhov';
  private readonly password = 'XHnex1PQxIKXc6whclj3zZBZ256aOwPN';
  private readonly sessionKey = 'voipmonitor:sessionId';
  private readonly sessionTtl = 3600; // 1 час в секундах

  constructor(
    private readonly httpService: HttpService,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  private pickDiagnosticFields(r: any) {
    // Оставляем только ключевые поля для диагностики (без HTML-полей вроде caller2/called2/menu и т.п.)
    return {
      // identity / time
      ID: r?.ID,
      cdr_ID: r?.cdr_ID ?? r?.ID,
      calldate: r?.calldate,
      callend: r?.callend,
      duration: r?.duration,
      connect_duration: r?.connect_duration ?? r?._connect_duration,
      progress_time: r?.progress_time,
      first_rtp_time: r?.first_rtp_time,

      // who / where
      caller: r?.caller,
      caller_domain: r?.caller_domain,
      called: r?.called,
      called_domain: r?.called_domain,
      sipcallerip: r?.sipcallerip,
      sipcallerport: r?.sipcallerport,
      sipcalledip: r?.sipcalledip,
      sipcalledport: r?.sipcalledport,
      sensorname: r?.sensorname,
      id_sensor: r?.id_sensor,

      // signaling result
      whohanged: r?.whohanged,
      bye: r?.bye,
      lastSIPresponseNum: r?.lastSIPresponseNum,
      lastSIPresponse: r?.lastSIPresponse ?? r?.sipresponse,
      reason_q850_cause: r?.reason_q850_cause,
      reason_sip_cause: r?.reason_sip_cause,

      // RTP / quality (сводка)
      lost: r?.lost,
      a_lost: r?.a_lost,
      b_lost: r?.b_lost,
      jitter: r?.jitter,
      jitter_mult10: r?.jitter_mult10,
      mos_min: r?.mos_min,
      mos_min_mult10: r?.mos_min_mult10,
      packet_loss_perc: r?.packet_loss_perc,
      packet_loss_perc_mult1000: r?.packet_loss_perc_mult1000,

      // codec / UA
      a_codec: r?.a_codec,
      b_codec: r?.b_codec,
      a_ua: r?.a_ua,
      b_ua: r?.b_ua,

      // useful ids / links
      fbasename: r?.fbasename ?? r?.fbasename_orig,
      allsiprequests: r?.allsiprequests,
      allrtpstreams: r?.allrtpstreams,
    };
  }

  private formatCallsResponse(raw: any) {
    const results: any[] = Array.isArray(raw?.results)
      ? raw.results
      : Array.isArray(raw?.data)
        ? raw.data
        : [];

    return {
      success: raw?.success ?? true,
      total: raw?.total ?? (typeof raw?.total === 'string' ? raw.total : String(results.length)),
      deferTotal: raw?.deferTotal ?? false,
      vmVersion: raw?._vm_version,
      results: results.map((r) => this.pickDiagnosticFields(r)),
    };
  }

  async getSessionId(): Promise<string> {
    // Для отладки/совместимости можно зафиксировать PHPSESSID через env,
    // чтобы поведение было идентично ручному curl.
    const forced = process.env.VOIPMONITOR_PHPSESSID;
    if (forced) {
      this.logger.warn('Using VOIPMONITOR_PHPSESSID from env (forced session)', {
        sessionIdPrefix: `${forced.slice(0, 6)}...`,
      });
      return String(forced);
    }

    // Пытаемся получить sessionId из Redis
    const cachedSessionId = await this.redis.get(this.sessionKey);
    if (cachedSessionId) {
      this.logger.debug('Using cached sessionId from Redis', {
        cachedSessionId,
        type: typeof cachedSessionId,
        length: cachedSessionId?.length,
      });
      // Убеждаемся, что это строка
      const sessionIdStr = String(cachedSessionId);
      if (sessionIdStr === '[object Object]' || sessionIdStr === '' || sessionIdStr.length < 10) {
        this.logger.warn('Invalid sessionId in Redis cache, clearing and re-login', {
          cachedSessionId,
          sessionIdStr,
          type: typeof cachedSessionId,
        });
        await this.redis.del(this.sessionKey);
        return this.login();
      }
      return sessionIdStr;
    }

    // Если нет в кэше, выполняем авторизацию
    return this.login();
  }

  async login(): Promise<string> {
    const url = `${this.voipmonitorUrl}/php/model/sql.php?module=bypass_login&user=${this.username}&pass=${this.password}`;

    try {
      // Не логируем пароль, хотя он в query string
      this.logger.log('VoIPmonitor login request', {
        baseUrl: this.voipmonitorUrl,
        module: 'bypass_login',
        user: this.username,
      });

      const response = await firstValueFrom(
        this.httpService.post(url, {}, {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }),
      );

      // Извлекаем sessionId из ответа - может быть в поле sessionId или сам response.data
      let sessionId: string;
      if (typeof response.data === 'string') {
        sessionId = response.data;
      } else if (response.data?.SID && typeof response.data.SID === 'string') {
        sessionId = response.data.SID;
      } else {
        // Пытаемся преобразовать в строку
        sessionId = String(response.data || '');
      }

      if (!sessionId || sessionId === '[object Object]' || sessionId === '') {
        this.logger.error('No valid sessionId in response', { 
          responseData: response.data,
          responseDataType: typeof response.data,
        });
        throw new HttpException(
          'Failed to get sessionId from VoIPmonitor',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Сохраняем sessionId в Redis
      await this.redis.setex(this.sessionKey, this.sessionTtl, sessionId);
      this.logger.log('Successfully logged in and cached sessionId', { sessionId });

      return sessionId;
    } catch (error) {
      this.logger.error('Error during VoIPmonitor login', {
        url,
        error: {
          message: error.message,
          code: error.code,
          response: {
            status: error.response?.status,
            statusText: error.response?.statusText,
            data: error.response?.data,
          },
        },
      });

      throw new HttpException(
        error.response?.data?.message || 'Failed to login to VoIPmonitor',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async getCalls(params: {
    limit?: number;
    start?: number;
    fdatefrom?: string;
    fdateto?: string;
    fcaller?: string;
    fcalled?: string;
    fcallerd_type?: number;
    fcallid?: string;
    fbasename?: string;
  } = {}): Promise<any> {
    const {
      limit = 10,
      start = 0,
      fdatefrom,
      fdateto,
      fcaller,
      fcalled,
      fcallerd_type,
      fcallid,
      fbasename,
    } = params;

    // VoIPmonitor API требует fdatefrom, иначе возвращает ошибку
    if (!fdatefrom) {
      throw new BadRequestException('fdatefrom is required for VoIPmonitor CDR LISTING');
    }

    let sessionId = await this.getSessionId();
    
    // Убеждаемся, что sessionId - строка (на случай если getSessionId вернул что-то другое)
    if (typeof sessionId !== 'string') {
      this.logger.warn('sessionId is not a string, converting', { 
        sessionId, 
        type: typeof sessionId 
      });
      sessionId = String(sessionId || '');
    }

    const queryParams = new URLSearchParams({
      task: 'LISTING',
      module: 'CDR',
      limit: limit.toString(),
      start: start.toString(),
    });

    queryParams.append('fdatefrom', fdatefrom);
    if (fdateto) {
      queryParams.append('fdateto', fdateto);
    }
    if (fcaller) {
      queryParams.append('fcaller', fcaller);
    }
    if (fcalled) {
      queryParams.append('fcalled', fcalled);
    }
    if (fcallerd_type !== undefined) {
      queryParams.append('fcallerd_type', fcallerd_type.toString());
    }
    if (fcallid) {
      queryParams.append('fcallid', fcallid);
    }
    if (fbasename) {
      queryParams.append('fbasename', fbasename);
    }

    const url = `${this.voipmonitorUrl}/php/model/sql.php?${queryParams.toString()}`;
    const fullUrlWithCookie = `${url}`;
    // Убеждаемся, что sessionId - строка
    const sessionIdStr = String(sessionId || '');
    const curlCommand = `curl -X POST --cookie "PHPSESSID=${sessionIdStr}" '${url}'`;

    try {
      this.logger.log('VoIPmonitor API request (CDR LISTING)', {
        url: fullUrlWithCookie,
        curlCommand,
        sessionId: sessionIdStr,
        limit,
        start,
        fdatefrom,
        fdateto,
        fcaller,
        fcalled,
        fcallerd_type,
        fcallid,
        fbasename,
      });

      const response = await firstValueFrom(
        this.httpService.post(
          url,
          {},
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Accept: 'application/json',
              Cookie: `PHPSESSID=${sessionIdStr}`,
            },
          },
        ),
      );

      // Если VoIPmonitor вернул не JSON (например HTML/redirect), фиксируем это как ошибку
      if (!response?.data || typeof response.data !== 'object') {
        const snippet =
          typeof response?.data === 'string'
            ? response.data.slice(0, 300)
            : JSON.stringify(response?.data).slice(0, 300);
        this.logger.error('VoIPmonitor returned non-JSON response', {
          url: fullUrlWithCookie,
          curlCommand,
          sessionId: sessionIdStr,
          snippet,
        });
        throw new HttpException('VoIPmonitor returned non-JSON response', HttpStatus.BAD_GATEWAY);
      }

      const formatted = this.formatCallsResponse(response.data);

      this.logger.debug('Successfully fetched calls from VoIPmonitor', {
        callsCount: formatted.results?.length || 0,
      });

      this.logger.log('VoIPmonitor API response (CDR LISTING)', {
        url: fullUrlWithCookie,
        curlCommand,
        sessionId: sessionIdStr,
        total: formatted.total,
        resultsCount: formatted.results?.length || 0,
        vmVersion: formatted.vmVersion,
      });

      return formatted;
    } catch (error) {
      this.logger.error('Error fetching calls from VoIPmonitor', {
        url: fullUrlWithCookie,
        curlCommand,
        sessionId: sessionIdStr,
        params,
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

      // Если ошибка авторизации, удаляем sessionId из кэша
      if (error.response?.status === 401 || error.response?.status === 403) {
        this.logger.warn('Session expired, clearing cache');
        await this.redis.del(this.sessionKey);
      }

      throw new HttpException(
        error.response?.data?.message || 'Failed to fetch calls from VoIPmonitor',
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async findCallBySipCallId(sipCallId: string): Promise<any | null> {
    if (!sipCallId) return null;

    // Ищем по callerId в VoIPmonitor через параметр fcallid (как в curl)
    const response = await this.getCalls({
      limit: 1,
      start: 0,
      // NOTE: fdatefrom обязателен, передаётся вызывающей стороной
      // здесь оставляем заглушку, чтобы сигнатура компилировалась — фактически метод должен вызываться с fdatefrom
      // (см. перегрузку ниже)
      fdatefrom: '1970-01-01T00:00:00',
      fcallid: sipCallId,
    });

    const first = response?.results?.[0] ?? null;
    return first;
  }

  async findCallBySipCallIdWithDate(sipCallId: string, fdatefrom: string): Promise<any | null> {
    if (!sipCallId) return null;
    if (!fdatefrom) {
      throw new BadRequestException('fdatefrom is required to find VoIPmonitor call by sipCallId');
    }

    const response = await this.getCalls({
      limit: 1,
      start: 0,
      fdatefrom,
      fcallid: sipCallId,
    });

    return response?.results?.[0] ?? null;
  }
}
