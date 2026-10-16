import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('permissions')
export class Permission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Stable identifier such as rbac.roles.manage — never renamed. */
  @Column({ type: 'varchar', length: 150, unique: true })
  identifier: string;

  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  applicationId: string | null;

  @Column({ type: 'uuid', nullable: true })
  moduleId: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  featureId: string | null;

  @Column({ type: 'boolean', default: true })
  isSystem: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
