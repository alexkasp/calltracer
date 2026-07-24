import { Controller, Get, Post, Body, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  AuthService,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../services/auth.service';
import { resolveLang, type Lang } from '../i18n/lang';
import { t } from '../i18n/translate';

const escapeHtml = (text: string): string =>
  (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const langSwitcher = (lang: Lang, redirectPath: string): string => {
  const redirect = encodeURIComponent(redirectPath || '/login');
  const link = (code: Lang, label: string) =>
    `<a href="/set-lang?lang=${code}&redirect=${redirect}" style="color:${lang === code ? '#eaeaea' : '#7c3aed'};text-decoration:none;font-weight:${lang === code ? 'bold' : 'normal'};">${label}</a>`;
  return `<div style="display:flex;justify-content:center;gap:8px;margin-bottom:16px;font-size:0.85rem;">${link('ru', 'RU')}<span style="color:#444;">·</span>${link('en', 'EN')}<span style="color:#444;">·</span>${link('ar', 'AR')}</div>`;
};

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  loginPage(
    @Query('error') error?: string,
    @Query('redirect') redirect?: string,
    @Req() req?: Request,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const lang = resolveLang(req);
    const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '';
    const currentPath = req?.originalUrl || '/login';

    const html = `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'login.title')}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
    .login-box { background: #16213e; padding: 32px; border-radius: 10px; width: 100%; max-width: 340px; }
    h1 { font-size: 1.3rem; margin: 0 0 20px; text-align: center; }
    label { display: block; font-size: 0.85rem; color: #888; margin-bottom: 4px; }
    input { background: #0f172a; color: #eaeaea; border: 1px solid #333; border-radius: 6px; padding: 10px 12px; width: 100%; box-sizing: border-box; margin-bottom: 16px; font-size: 14px; }
    button { background: #7c3aed; color: white; border: 0; border-radius: 6px; padding: 10px 12px; cursor: pointer; width: 100%; font-size: 14px; }
    button:hover { background: #6d28d9; }
    .error { background: rgba(220, 80, 80, 0.15); border: 1px solid #dc5050; padding: 10px 12px; border-radius: 6px; margin-bottom: 16px; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="login-box">
    ${langSwitcher(lang, currentPath)}
    <h1>CallTracer</h1>
    ${error ? `<div class="error">${t(lang, 'login.error')}</div>` : ''}
    <form method="POST" action="/login">
      <label for="username">${t(lang, 'login.username')}</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">${t(lang, 'login.password')}</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required />
      <input type="hidden" name="redirect" value="${escapeHtml(safeRedirect)}" />
      <button type="submit">${t(lang, 'login.submit')}</button>
    </form>
  </div>
</body>
</html>`;

    res?.type('text/html; charset=utf-8');
    return html;
  }

  @Post('login')
  async login(
    @Body('username') username: string,
    @Body('password') password: string,
    @Body('redirect') redirect: string,
    @Res() res: Response,
  ) {
    const user = await this.authService.validateUser(
      String(username || '').trim(),
      String(password || ''),
    );
    const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '';

    if (!user) {
      const qs = safeRedirect
        ? `&redirect=${encodeURIComponent(safeRedirect)}`
        : '';
      res.redirect(`/login?error=1${qs}`);
      return;
    }

    const cookieValue = this.authService.createSessionCookie(user);
    res.cookie(SESSION_COOKIE_NAME, cookieValue, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: SESSION_TTL_MS,
    });
    res.redirect(safeRedirect || '/');
  }

  @Get('logout')
  logoutGet(@Res() res: Response) {
    this.doLogout(res);
  }

  @Post('logout')
  logoutPost(@Res() res: Response) {
    this.doLogout(res);
  }

  private doLogout(res: Response) {
    res.clearCookie(SESSION_COOKIE_NAME);
    res.redirect('/login');
  }
}
