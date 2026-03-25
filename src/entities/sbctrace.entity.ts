import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
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

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'leg_id' })
  legId: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true, name: 'call_id' })
  callId: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true, name: 'call_state' })
  callState: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'terminate_reason' })
  terminateReason: string | null;

  /** Время звонка из поля timestamp ответа SBCtelco */
  @Column({ type: 'datetime', nullable: true, name: 'call_timestamp' })
  callTimestamp: Date | null;

  /** Время ответа/соединения из connect_timestamp (если было) */
  @Column({ type: 'datetime', nullable: true, name: 'connect_timestamp' })
  connectTimestamp: Date | null;

  /** Общая длительность звонка (секунды), если передаётся SBCtelco */
  @Column({ type: 'int', nullable: true, name: 'call_duration_sec' })
  callDurationSec: number | null;

  /** Длительность разговора (секунды): end_timestamp - connect_timestamp (если удалось вычислить) */
  @Column({ type: 'int', nullable: true, name: 'talk_duration_sec' })
  talkDurationSec: number | null;

  @Column({ type: 'datetime', nullable: true, name: 'last_seen_at' })
  lastSeenAt: Date | null;

  @Column({ type: 'datetime', nullable: true, name: 'end_timestamp' })
  endTimestamp: Date | null;

  /** Первое значение MOS из trace_info (например "MOS: 4.3 ..."); null если в данных нет MOS */
  @Column({ type: 'double', nullable: true })
  mos: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
