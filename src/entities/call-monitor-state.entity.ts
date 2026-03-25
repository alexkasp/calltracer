import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Служебные данные сервиса мониторинга звонков.
 * Хранит произвольные ключ-значение (key + value в JSON) для использования между запусками крона.
 */
@Entity('call_monitor_state')
export class CallMonitorState {
  @PrimaryGeneratedColumn({ type: 'int' })
  id: number;

  /** Ключ (например: last_run_at, last_call_id, config и т.д.) */
  @Column({ type: 'varchar', length: 128, unique: true })
  key: string;

  /** Значение в виде JSON (объект или примитив) */
  @Column({ type: 'json', nullable: true })
  value: unknown;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
