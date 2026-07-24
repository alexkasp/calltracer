import type { Lang } from './lang';
import { translations } from './translations';

/**
 * Перевод по ключу с опциональной подстановкой {var}. Если ключа нет в выбранном языке —
 * fallback на ru, если нет и там — возвращает сам ключ (чтобы не падать, но заметить пробел).
 */
export function t(
  lang: Lang,
  key: string,
  vars?: Record<string, string | number>,
): string {
  const dict = translations[lang] ?? translations.ru;
  let value = dict[key] ?? translations.ru[key] ?? key;

  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      value = value.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }

  return value;
}
