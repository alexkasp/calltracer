import type { Request } from 'express';

export type Lang = 'ru' | 'en' | 'ar';

export const LANGS: Lang[] = ['ru', 'en', 'ar'];
export const DEFAULT_LANG: Lang = 'en';
export const LANG_COOKIE_NAME = 'calltracer_lang';

export function isLang(value: unknown): value is Lang {
  return typeof value === 'string' && (LANGS as string[]).includes(value);
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

/** Определяет язык запроса: ?lang=xx (приоритет) -> кука calltracer_lang -> en по умолчанию. */
export function resolveLang(req?: Request): Lang {
  const queryLang = req?.query?.lang;
  if (isLang(queryLang)) return queryLang;

  const cookies = parseCookies(req?.headers?.cookie);
  const cookieLang = cookies[LANG_COOKIE_NAME];
  if (isLang(cookieLang)) return cookieLang;

  return DEFAULT_LANG;
}
