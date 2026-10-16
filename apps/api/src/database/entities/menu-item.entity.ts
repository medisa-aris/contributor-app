import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Application } from './application.entity';
import { Feature } from './feature.entity';
import { NavModule } from './module.entity';

@Entity('menu_items')
export class MenuItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 150, unique: true })
  key: string;

  @Column({ type: 'varchar', length: 150 })
  labelDefault: string;

  @Column({ type: 'varchar', length: 150, nullable: true })
  i18nKey: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  icon: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  routePath: string | null;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  parentId: string | null;

  @ManyToOne(() => MenuItem, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'parent_id' })
  parent?: MenuItem | null;

  @Index()
  @Column({ type: 'uuid' })
  applicationId: string;

  @ManyToOne(() => Application, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'application_id' })
  application?: Application;

  @Column({ type: 'uuid', nullable: true })
  moduleId: string | null;

  @ManyToOne(() => NavModule, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'module_id' })
  module?: NavModule | null;

  @Column({ type: 'uuid', nullable: true })
  featureId: string | null;

  @ManyToOne(() => Feature, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'feature_id' })
  feature?: Feature | null;

  /** Identitas izin (atau wildcard akhir) yang diperlukan; NULL = semua user login. */
  @Column({ type: 'varchar', length: 150, nullable: true })
  requiredPermission: string | null;

  @Column({ type: 'int', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** Menandai menu yang fiturnya direncanakan tetapi belum diimplementasikan. */
  @Column({ type: 'boolean', default: false })
  isFuture: boolean;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
