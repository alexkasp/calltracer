import {
  Injectable,
  CanActivate,
  ExecutionContext,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import * as crypto from 'crypto';
import { AuthService, SESSION_COOKIE_NAME } from '../services/auth.service';

const PUBLIC_PATHS = new Set(['/login', '/logout', '/set-lang']);

/**
 * Доступ для машинных клиентов (AI-агент и т.п.) — по общему секрету из env AGENT_API_TOKEN,
 * передаётся как заголовок `X-Api-Key: <token>`, `Authorization: Bearer <token>` либо, для
 * совсем простых клиентов, query-параметром `?api_key=<token>`.
 *
 * ВАЖНО: раньше здесь был обход логина по IP/подсети (loopback + LAN + docker-бриджи).
 * Это оказалось дырой: сервис стоит за реверс-прокси, поэтому req.socket.remoteAddress для
 * ЛЮБОГО запроса из интернета — это адрес прокси, который попадал в доверенную подсеть, и
 * весь сервис открывался без логина (проверено снаружи на calltracer.brightcall.ai:
 * /call-monitor/calls отдавал данные анониму). По IP машинного клиента здесь отличить нельзя
 * в принципе — только по секрету, поэтому IP-обход удалён полностью и возвращать его нельзя.
 */
function parseBearer(header?: string): string | undefined {
  if (!header) return undefined;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : undefined;
}

function safeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) {
      try {
        out[key] = decodeURIComponent(value);
      } catch {
        out[key] = value;
      }
    }
  }
  return out;
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(private readonly authService: AuthService) {}

  /** Токен машинного клиента из запроса: заголовок или query-параметр. */
  private extractToken(req: Request): string | undefined {
    const headers = req.headers || {};
    const apiKeyHeader = headers['x-api-key'];
    if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim())
      return apiKeyHeader.trim();

    const bearer = parseBearer(
      typeof headers.authorization === 'string' ? headers.authorization : '',
    );
    if (bearer) return bearer;

    const q = (req.query as Record<string, unknown> | undefined)?.api_key;
    if (typeof q === 'string' && q.trim()) return q.trim();

    return undefined;
  }

  private isValidAgentToken(req: Request): boolean {
    const expected = String(process.env.AGENT_API_TOKEN ?? '').trim();
    // Токен не настроен — машинный доступ выключен полностью (никакого обхода по умолчанию)
    if (!expected) return false;
    const provided = this.extractToken(req);
    if (!provided) return false;
    return safeEquals(provided, expected);
  }

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const res = context.switchToHttp().getResponse<Response>();

    if (PUBLIC_PATHS.has(req.path)) {
      return true;
    }

    const cookies = parseCookies(req.headers.cookie);
    const session = this.authService.verifySessionCookie(
      cookies[SESSION_COOKIE_NAME],
    );
    if (session) {
      (req as Request & { user?: typeof session }).user = session;
      return true;
    }

    if (this.isValidAgentToken(req)) {
      (req as Request & { user?: { uid: number; username: string } }).user = {
        uid: 0,
        username: 'api-token',
      };
      return true;
    }

    const redirect = encodeURIComponent(req.originalUrl || '/');
    res.redirect(`/login?redirect=${redirect}`);
    return false;
  }
}
