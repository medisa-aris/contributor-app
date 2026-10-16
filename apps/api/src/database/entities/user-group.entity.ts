import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('user_groups')
export class UserGroup {
  @PrimaryColumn({ type: 'uuid' })
  userId: string;

  @Index()
  @PrimaryColumn({ type: 'uuid' })
  groupId: string;

  @Column({ type: 'uuid', nullable: true })
  createdBy: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
