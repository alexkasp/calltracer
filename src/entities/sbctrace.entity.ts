import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('sbctrace')
export class Sbctrace {
  /** Id звонка из ответа SBCtelco (например 0x0E47AC0F) */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id: string;

  /** Один звонок в формате { ***meta***, [id]: callData } для formatCallTraceText */
  @Column({ type: 'json', nullable: true })
  payload: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  called: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  calling: string | null;

  /** Время звонка из поля timestamp ответа SBCtelco */
  @Column({ type: 'datetime', nullable: true, name: 'call_timestamp' })
  callTimestamp: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
