import type { Lang } from '../i18n/lang';
import { t } from '../i18n/translate';

/**
 * Общая шапка для всех HTML-страниц (кроме /login — там свой мини-хедер).
 * Инлайн-стили специально, чтобы не зависеть от <style> конкретной страницы.
 */
export function renderSiteHeader(lang: Lang, currentPath: string): string {
  const redirect = encodeURIComponent(currentPath || '/');
  const langLink = (code: Lang, label: string) =>
    `<a href="/set-lang?lang=${code}&redirect=${redirect}" style="color:${lang === code ? '#eaeaea' : '#7c3aed'};text-decoration:none;font-weight:${lang === code ? 'bold' : 'normal'};">${label}</a>`;

  return `<div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;margin-bottom:20px;border-bottom:1px solid #333;font-family:system-ui,-apple-system,sans-serif;">
    <a href="/" style="color:#a78bfa;text-decoration:none;font-weight:bold;font-size:1rem;">← CallTracer</a>
    <div style="display:flex;align-items:center;gap:14px;font-size:0.85rem;">
      <span style="display:flex;gap:6px;">${langLink('ru', 'RU')}<span style="color:#444;">·</span>${langLink('en', 'EN')}<span style="color:#444;">·</span>${langLink('ar', 'AR')}</span>
      <a href="/logout" style="color:#7c3aed;text-decoration:none;">${t(lang, 'nav.logout')}</a>
    </div>
  </div>`;
}
