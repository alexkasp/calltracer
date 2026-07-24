import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { isLang, LANG_COOKIE_NAME } from '../i18n/lang';

const LANG_COOKIE_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

@Controller()
export class LangController {
  @Get('set-lang')
  setLang(
    @Query('lang') lang: string,
    @Query('redirect') redirect: string,
    @Res() res: Response,
  ) {
    if (isLang(lang)) {
      res.cookie(LANG_COOKIE_NAME, lang, {
        maxAge: LANG_COOKIE_MAX_AGE_MS,
        sameSite: 'lax',
      });
    }
    const safeRedirect = redirect && redirect.startsWith('/') ? redirect : '/';
    res.redirect(safeRedirect);
  }
}
