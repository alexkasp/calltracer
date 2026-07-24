/**
 * Генерирует bcrypt-хэш пароля для ручного добавления пользователя в таблицу `users`.
 *
 * Запуск из корня проекта:
 *   npm run hash-password -- 'мойпароль123'
 *
 * Дальше вставить пользователя в БД (см. README, раздел «Добавление пользователей»).
 */
import * as bcrypt from 'bcryptjs';

async function main() {
  const password = process.argv[2];
  if (!password) {
    console.error("Usage: npm run hash-password -- '<password>'");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);
  console.log(hash);
}

main();
