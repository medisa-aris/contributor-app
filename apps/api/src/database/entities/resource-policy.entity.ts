import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { PolicyEffect, PolicySubjectType } from '@contributor/shared';

@Entity('resource_policies')
export class ResourcePolicy {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'enum', enum: ['allow', 'deny'] })
  effect: PolicyEffect;

  @Column({ type: 'enum', enum: ['user', 'group', 'role'] })
  subjectType: PolicySubjectType;

  @Index()
  @Column({ type: 'uuid' })
  subjectId: string;

  /** Full permission identifier or trailing wildcard such as knowledge.* */
  @Column({ type: 'varchar', length: 150 })
  permissionPattern: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  resourceType: string | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  resourceId: string | null;

  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  conditions: Record<string, unknown>;

  @Column({ type: 'int', default: 0 })
  priority: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
