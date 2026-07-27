import type { Lang } from '../i18n/lang';
import { t } from '../i18n/translate';
import { renderSiteHeader } from './site-header';

/**
 * Лёгкая HTML-заглушка с прогресс-баром: отдаётся мгновенно, пока тяжёлые страницы
 * (calltrace, call-recording/player) опрашивают медленные внешние сервисы
 * (VoIPmonitor/SBCtelco/Convolo) — без неё вкладка несколько секунд выглядит "зависшей".
 * Реальный HTML подгружается через fetch(dataUrl) и подменяет документ целиком (document.write).
 */
export function renderLoadingShell(
  lang: Lang,
  currentPath: string,
  dataUrl: string,
): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${t(lang, 'common.loadingTitle')}</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #1a1a2e; color: #eaeaea; padding: 20px; max-width: 1000px; margin: 0 auto; }
    #progress-track { position: fixed; top: 0; left: 0; width: 100%; height: 3px; background: rgba(124, 58, 237, 0.15); z-index: 1000; overflow: hidden; }
    #progress-bar { position: absolute; top: 0; left: 0; height: 100%; width: 40%; background: #7c3aed; animation: loading-slide 1.1s ease-in-out infinite; }
    @keyframes loading-slide {
      0% { left: -40%; }
      100% { left: 100%; }
    }
    .loading-hint { color: #888; font-size: 0.95rem; margin-top: 24px; }
    .loading-error { background: rgba(220, 80, 80, 0.15); border: 1px solid #dc5050; padding: 12px 16px; border-radius: 8px; margin-top: 16px; }
  </style>
</head>
<body>
  <div id="progress-track"><div id="progress-bar"></div></div>
  ${renderSiteHeader(lang, currentPath)}
  <p class="loading-hint">${t(lang, 'common.loadingHint')}</p>
  <script>
    fetch(${JSON.stringify(dataUrl)}, { credentials: 'same-origin' })
      .then(async (r) => {
        if (!r.ok) {
          let msg = 'HTTP ' + r.status;
          try {
            const j = await r.clone().json();
            if (j && j.message) msg = j.message;
          } catch (e) {}
          throw new Error(msg);
        }
        return r.text();
      })
      .then((html) => {
        document.open();
        document.write(html);
        document.close();
      })
      .catch((err) => {
        const track = document.getElementById('progress-track');
        if (track) track.style.display = 'none';
        const hint = document.querySelector('.loading-hint');
        if (hint) {
          hint.insertAdjacentHTML(
            'afterend',
            '<div class="loading-error">' + (err && err.message ? err.message : String(err)) + '</div>',
          );
        }
      });
  </script>
</body>
</html>`;
}
