import { Injectable, CanActivate, ExecutionContext, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE_NAME } from '../services/auth.service';

const PUBLIC_PATHS = new Set(['/login', '/logout', '/set-lang']);

// Доверенные сети, для которых не требуется логин куки-сессией (например AI-агент, работающий
// на том же хосте dev.uae и обращающийся напрямую к порту сервиса). Настраивается через
// AUTH_TRUSTED_CIDRS (список через запятую), значение по умолчанию — loopback + LAN-подсеть
// самого dev.uae (172.21.123.0/24) + локальные docker-бриджи этого хоста (172.17-19.0.0/16, см.
// `ip addr` на dev.uae). Приложение не стоит за реверс-прокси (trust proxy не включён), поэтому
// используем req.socket.remoteAddress — реальный TCP-адрес, а не заголовки, которые мог бы
// подделать клиент.
const DEFAULT_TRUSTED_CIDRS =
  '127.0.0.1/32,::1/128,172.21.123.0/24,172.17.0.0/16,172.18.0.0/16,172.19.0.0/16';

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

function ipv4ToInt(ip: string): number | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = [m[1], m[2], m[3], m[4]].map(Number);
  if (parts.some((p) => p < 0 || p > 255)) return null;
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

/** Node отдаёт адреса dual-stack сокетов в виде "::ffff:1.2.3.4" — снимаем IPv6-обёртку. */
function normalizeIp(ip: string): string {
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  return mapped ? mapped[1] : ip;
}

function isIpInCidr(ip: string, cidr: string): boolean {
  const normalizedIp = normalizeIp(ip.trim());
  const [range, prefixStr] = cidr.trim().split('/');
  if (range.includes(':')) {
    // IPv6 (например "::1" или "::1/128") — поддерживаем только точное совпадение, префиксную
    // арифметику не считаем: единственный реальный кейс здесь — IPv6-loopback, а не подсети.
    return normalizedIp === range;
  }
  if (!prefixStr) {
    // Без маски — точное совпадение
    return normalizedIp === range;
  }
  const ipInt = ipv4ToInt(normalizedIp);
  const rangeInt = ipv4ToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  const prefix = Number(prefixStr);
  if (!Number.isFinite(prefix) || prefix < 0 || prefix > 32) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

function parseTrustedCidrs(): string[] {
  const raw = process.env.AUTH_TRUSTED_CIDRS || DEFAULT_TRUSTED_CIDRS;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private readonly trustedCidrs = parseTrustedCidrs();

  constructor(private readonly authService: AuthService) {}

  private getClientIp(req: Request): string {
    return req.socket?.remoteAddress || req.ip || '';
  }

  private isTrustedIp(req: Request): boolean {
    const ip = this.getClientIp(req);
    if (!ip) return false;
    return this.trustedCidrs.some((cidr) => isIpInCidr(ip, cidr));
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

    if (this.isTrustedIp(req)) {
      const ip = this.getClientIp(req);
      this.logger.log('Bypassing login for trusted local IP', {
        ip,
        path: req.path,
      });
      (req as Request & { user?: { uid: number; username: string } }).user = {
        uid: 0,
        username: `local-trusted(${ip})`,
      };
      return true;
    }

    const redirect = encodeURIComponent(req.originalUrl || '/');
    res.redirect(`/login?redirect=${redirect}`);
    return false;
  }
}
