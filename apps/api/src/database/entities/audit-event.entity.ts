import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { AuditSeverity } from '@bara/shared';

@Entity('audit_events')
export class AuditEvent {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  occurredAt: Date;

  @Column({ type: 'enum', enum: ['info', 'warn', 'critical'], default: 'info' })
  severity: AuditSeverity;

  @Index()
  @Column({ type: 'varchar', length: 100 })
  eventKey: string;

  @Column({ type: 'text' })
  summary: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  actorUserId: string | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  actorLabel: string | null;

  @Column({ type: 'varchar', length: 45, nullable: true })
  actorIp: string | null;

  @Column({ type: 'text', nullable: true })
  actorUserAgent: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  requestId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 100, nullable: true })
  entityType: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  entityId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  payload: Record<string, unknown>;
}
