/**
 * Имитация фрагмента ответа SBCtelco со звонком с очень низким MOS (ниже 2).
 * База данных не используется.
 *
 * Запуск из корня проекта:
 *   npm run simulate:sbc-low-mos
 *
 * Опционально отправить тест в Telegram (те же переменные, что у бота):
 *   SBC_SIMULATE_SEND_TELEGRAM=1 npm run simulate:sbc-low-mos
 */
import * as fs from 'fs';
import * as path from 'path';
import axios from 'axios';
import { parseMosFromCallData } from '../src/utils/sbc-mos';

function loadDotEnvFromProjectRoot(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

loadDotEnvFromProjectRoot();

/** Преднамеренно не существующий id, чтобы случайно не пересечься с реальными ключами в логах */
const TEST_CALL_ID = '0xSIMULATED_TEST_LOW_MOS';

const mockCallTraceResponse: Record<string, unknown> = {
  '***meta***': { version: 'simulate' },
  [TEST_CALL_ID]: {
    called: '79990001122',
    calling: '74951234567',
    timestamp: Date.now(),
    leg_id: 'sim-leg',
    call_traces: {
      step1: {
        order: 1,
        direction: '1',
        trace_info: 'MOS: 1.75 codec ideal MOS 1.75, Network quality: 40%',
        trace_tooltip: 'simulate',
      },
    },
  },
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function main(): Promise<void> {
  const callData = mockCallTraceResponse[TEST_CALL_ID];
  const mos = parseMosFromCallData(callData);

  console.log('=== SBC simulate: низкий MOS (тест, без записи в БД) ===\n');
  console.log('Call-ID (фиктивный):', TEST_CALL_ID);
  console.log('Распарсенный MOS:', mos);

  if (mos === null) {
    console.error('Ошибка: MOS не распарсился из моковых данных.');
    process.exit(1);
  }

  if (mos >= 2) {
    console.warn('Предупреждение: для сценария «MOS < 2» ожидалось значение ниже 2.');
  }

  const calling = String((callData as { calling?: string }).calling ?? '—');
  const called = String((callData as { called?: string }).called ?? '—');

  console.log('\nВ проде для такого батча:');
  console.log('- запись попала бы в sbctrace с полем mos =', mos);
  console.log('- в Telegram ушёл бы отчёт по звонкам с MOS < 4 (этот звонок в списке).');
  console.log('\nЭтот скрипт базу данных не трогает.\n');

  const send =
    process.env.SBC_SIMULATE_SEND_TELEGRAM === '1' ||
    process.env.SBC_SIMULATE_SEND_TELEGRAM === 'true';
  if (send) {
    const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
    const chatId =
      process.env.TELEGRAM_CHAT_ID_REPORTS?.trim() ||
      process.env.TELEGRAM_CHAT_ID?.trim();
    if (!token || !chatId) {
      console.error(
        'SBC_SIMULATE_SEND_TELEGRAM=1: задайте TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID или TELEGRAM_CHAT_ID_REPORTS',
      );
      process.exit(1);
    }
    const text =
      `<b>🧪 SBC simulate (без БД)</b>\n` +
      `Тестовый звонок MOS &lt; 2: <code>${escapeHtml(TEST_CALL_ID)}</code>\n` +
      `MOS: <b>${mos}</b>\n` +
      `${escapeHtml(calling)} → ${escapeHtml(called)}`;
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    await axios.post(
      url,
      {
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      },
      { timeout: 10000 },
    );
    console.log('Тестовое сообщение отправлено в Telegram.');
  } else {
    console.log(
      'Чтобы отправить тест в Telegram: SBC_SIMULATE_SEND_TELEGRAM=1 npm run simulate:sbc-low-mos',
    );
  }
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
