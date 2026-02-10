/**
 * Полифилл globalThis.crypto для Node.js 18 на продакшн-сервере.
 * @nestjs/typeorm использует crypto.randomUUID(), который в части окружений Node 18 недоступен глобально.
 */
import { webcrypto } from 'node:crypto';
if (typeof globalThis.crypto === 'undefined') {
  (globalThis as any).crypto = webcrypto;
}
