import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/** Baris tunggal (id=1) berisi versi cache RBAC untuk invalidasi instan. */
@Entity('rbac_meta')
export class RbacMeta {
  @PrimaryColumn({ type: 'smallint' })
  id: number;

  @Column({ type: 'int', default: 1 })
  version: number;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
