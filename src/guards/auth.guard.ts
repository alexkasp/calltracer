import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService, SESSION_COOKIE_NAME } from '../services/auth.service';

const PUBLIC_PATHS = new Set(['/login', '/logout', '/set-lang']);

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
  constructor(private readonly authService: AuthService) {}

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

    const redirect = encodeURIComponent(req.originalUrl || '/');
    res.redirect(`/login?redirect=${redirect}`);
    return false;
  }
}
