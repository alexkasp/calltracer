import { Controller, Get, Post, Body, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import {
  AuthService,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
} from '../services/auth.service';

const escapeHtml = (text: string): string =>
  (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

@Controller()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('login')
  loginPage(
    @Query('error') error?: string,
    @Query('redirect') redirect?: string,
    @Res({ passthrough: true }) res?: Response,
  ) {
    const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '';

    const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Вход — CallTracer</title>
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
    <h1>CallTracer</h1>
    ${error ? '<div class="error">Неверный логин или пароль</div>' : ''}
    <form method="POST" action="/login">
      <label for="username">Логин</label>
      <input type="text" id="username" name="username" autocomplete="username" required autofocus />
      <label for="password">Пароль</label>
      <input type="password" id="password" name="password" autocomplete="current-password" required />
      <input type="hidden" name="redirect" value="${escapeHtml(safeRedirect)}" />
      <button type="submit">Войти</button>
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
