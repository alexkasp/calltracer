import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

/**
 * Пользователи для входа в веб-интерфейс calltracer. Добавляются вручную в БД
 * (см. README, раздел «Добавление пользователей») — self-signup не предусмотрен.
 */
@Entity('users')
export class User {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  @Column({ type: 'varchar', length: 64, unique: true })
  username: string;

  /** bcrypt-хэш пароля — никогда не хранить пароль в открытом виде */
  @Column({ name: 'password_hash', type: 'varchar', length: 255 })
  passwordHash: string;

  @Column({ type: 'boolean', default: true })
  active: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
