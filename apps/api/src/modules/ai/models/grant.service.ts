import { Inject, Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  type GrantTarget,
  type ModelGrantDto,
  type QuotaPeriod,
  type ReachDto,
} from '@bara/shared';
import { DataSource } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { DATA_SOURCE } from '../../../database/database.module';
import { updatedRows } from '../../../database/query-result';
import { OrgReachService, type OrgReach } from '../../rbac/org-reach.service';
import { ModelCatalogService } from './model-catalog.service';

export interface GrantInput {
  targetType: GrantTarget;
  targetId: string | null;
  includeSubDepartments?: boolean;
  modelId: string;
  tokenLimit: number | null;
  period: QuotaPeriod;
  note?: string | null;
}

export interface GrantPatch {
  tokenLimit?: number | null;
  period?: QuotaPeriod;
  includeSubDepartments?: boolean;
  note?: string | null;
}

interface GrantDbRow {
  id: string;
  target_type: GrantTarget;
  target_id: string | null;
  include_sub_departments: boolean;
  model_id: string;
  model_name: string;
  is_default: boolean;
  token_limit: string | null;
  period: QuotaPeriod;
  granted_scope: 'admin' | 'leader';
  note: string | null;
  created_by: string;
  created_by_name: string | null;
  created_at: Date | string;
  target_name: string | null;
}

type Caller = { scope: 'admin'; userId: string } | { scope: 'leader'; userId: string; reach: OrgReach };

function blocked(message: string): AppError {
  return new AppError(ERROR_CODES.escalationBlocked, message, 403);
}

/** Izin model per orang / departemen / agent / semua orang (docs/LLM-MultiModel-requirement.md §4.2, §5). */
@Injectable()
export class GrantService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly catalog: ModelCatalogService,
    private readonly orgReach: OrgReachService,
  ) {}

  /** Admin = scope global (atau superadmin); selain itu leader dengan jangkauan kepala departemen. */
  async caller(auth: AuthContext): Promise<Caller> {
    const decision = auth.effective.decisions.get(PERMISSIONS.modelsGrantManage);
    if (auth.user.isSuperadmin || decision?.scope === 'global') return { scope: 'admin', userId: auth.user.id };
    return {
      scope: 'leader',
      userId: auth.user.id,
      reach: await this.orgReach.reach(auth.user.id, { includeSubordinateAgents: true }),
    };
  }

  private inReach(caller: Caller, targetType: GrantTarget, targetId: string | null): boolean {
    if (caller.scope === 'admin') return true;
    switch (targetType) {
      case 'user':
        return Boolean(targetId) && caller.reach.userIds.includes(targetId!);
      case 'department':
        return Boolean(targetId) && caller.reach.departmentIds.includes(targetId!);
      case 'agent':
        return Boolean(targetId) && caller.reach.agentIds.includes(targetId!);
      default:
        return false;
    }
  }

  private async rows(where = 'TRUE', params: unknown[] = []): Promise<GrantDbRow[]> {
    return (await this.dataSource.query(
      `SELECT g.*, m.display_name AS model_name, m.is_default, cu.display_name AS created_by_name,
              CASE g.target_type
                WHEN 'user' THEN tu.display_name
                WHEN 'department' THEN td.name
                WHEN 'agent' THEN ta.name || ' · ' || COALESCE(ao.display_name, '?')
                ELSE 'Semua orang'
              END AS target_name
         FROM ai_model_grants g
         JOIN ai_models m ON m.id = g.model_id
         LEFT JOIN users cu ON cu.id = g.created_by
         LEFT JOIN users tu ON g.target_type = 'user' AND tu.id = g.target_id
         LEFT JOIN departments td ON g.target_type = 'department' AND td.id = g.target_id
         LEFT JOIN agents ta ON g.target_type = 'agent' AND ta.id = g.target_id
         LEFT JOIN users ao ON ao.id = ta.owner_user_id
        WHERE ${where}
        ORDER BY g.created_at DESC`,
      params,
    )) as GrantDbRow[];
  }

  private toDto(row: GrantDbRow, caller: Caller): ModelGrantDto {
    const inReach = this.inReach(caller, row.target_type, row.target_id);
    return {
      id: row.id,
      targetType: row.target_type,
      targetId: row.target_id,
      targetName: row.target_name ?? '(dihapus)',
      includeSubDepartments: row.include_sub_departments,
      modelId: row.model_id,
      modelName: row.model_name,
      tokenLimit: row.token_limit === null ? null : Number(row.token_limit),
      period: row.period,
      grantedScope: row.granted_scope,
      note: row.note,
      createdBy: row.created_by,
      createdByName: row.created_by_name ?? '?',
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      editable: caller.scope === 'admin' || (row.granted_scope === 'leader' && inReach),
      outOfReach: caller.scope === 'leader' && !inReach,
      notApplicable: row.is_default,
    };
  }

  async list(auth: AuthContext, filter: { targetType?: GrantTarget; targetId?: string; modelId?: string }): Promise<ModelGrantDto[]> {
    const caller = await this.caller(auth);
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filter.targetType) {
      params.push(filter.targetType);
      conditions.push(`g.target_type = $${params.length}`);
    }
    if (filter.targetId) {
      params.push(filter.targetId);
      conditions.push(`g.target_id = $${params.length}`);
    }
    if (filter.modelId) {
      params.push(filter.modelId);
      conditions.push(`g.model_id = $${params.length}`);
    }
    const rows = await this.rows(conditions.join(' AND ') || 'TRUE', params);
    return rows
      .filter(
        (row) =>
          caller.scope === 'admin' ||
          this.inReach(caller, row.target_type, row.target_id) ||
          (row.granted_scope === 'leader' && row.created_by === caller.userId),
      )
      .map((row) => this.toDto(row, caller));
  }

  private async validate(caller: Caller, input: GrantInput): Promise<void> {
    if ((input.targetType === 'everyone') !== (input.targetId === null)) {
      throw new AppError(ERROR_CODES.validation, 'Target izin tidak valid.', 400);
    }
    const model = await this.catalog.get(input.modelId);
    if (model.isDefault) {
      throw new AppError(ERROR_CODES.conflict, 'Model bawaan sudah terbuka untuk semua tanpa batas.', 409);
    }
    if (model.status !== 'enabled') {
      throw new AppError(ERROR_CODES.conflict, 'Hanya model aktif yang dapat diberikan.', 409);
    }
    if (caller.scope === 'leader') {
      if (input.targetType === 'everyone') throw blocked('Leader tidak dapat memberi izin ke semua orang.');
      if (input.targetType === 'user' && input.targetId === caller.userId) {
        throw blocked('Anda tidak dapat memberi izin model kepada diri sendiri.');
      }
      if (!this.inReach(caller, input.targetType, input.targetId)) {
        throw blocked('Target berada di luar jangkauan Anda.');
      }
      if (!model.leaderGrantable) throw blocked('Model ini hanya dapat diberikan oleh admin.');
    }
    if (input.targetType === 'agent') {
      const rows = (await this.dataSource.query(`SELECT is_template FROM agents WHERE id = $1`, [input.targetId])) as {
        is_template: boolean;
      }[];
      if (!rows[0] || rows[0].is_template) {
        throw new AppError(ERROR_CODES.validation, 'Izin agent hanya untuk agent pribadi.', 400);
      }
    }
  }

  async create(auth: AuthContext, input: GrantInput): Promise<ModelGrantDto> {
    const caller = await this.caller(auth);
    await this.validate(caller, input);
    let id: string;
    try {
      const rows = (await this.dataSource.query(
        `INSERT INTO ai_model_grants
           (target_type, target_id, include_sub_departments, model_id, token_limit, period,
            granted_scope, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          input.targetType,
          input.targetId,
          input.includeSubDepartments ?? true,
          input.modelId,
          input.tokenLimit,
          input.period,
          caller.scope,
          input.note?.trim() || null,
          caller.userId,
        ],
      )) as { id: string }[];
      id = rows[0]!.id;
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(
          ERROR_CODES.conflict,
          'Izin untuk target, model, dan periode ini sudah ada. Ubah izin yang ada.',
          409,
        );
      }
      throw error;
    }
    await this.catalog.bump();
    return this.toDto((await this.rows('g.id = $1', [id]))[0]!, caller);
  }

  private async editable(auth: AuthContext, id: string): Promise<{ caller: Caller; row: GrantDbRow }> {
    const caller = await this.caller(auth);
    const row = (await this.rows('g.id = $1', [id]))[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Izin tidak ditemukan.', 404);
    if (!this.toDto(row, caller).editable) {
      throw blocked(row.granted_scope === 'admin' ? 'Izin ini diatur admin.' : 'Izin ini di luar jangkauan Anda.');
    }
    return { caller, row };
  }

  async update(auth: AuthContext, id: string, patch: GrantPatch): Promise<ModelGrantDto> {
    const { caller } = await this.editable(auth, id);
    const sets: string[] = [];
    const params: unknown[] = [id, auth.user.id];
    const add = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (patch.tokenLimit !== undefined) add('token_limit', patch.tokenLimit);
    if (patch.period !== undefined) add('period', patch.period);
    if (patch.includeSubDepartments !== undefined) add('include_sub_departments', patch.includeSubDepartments);
    if (patch.note !== undefined) add('note', patch.note?.trim() || null);
    if (sets.length > 0) {
      try {
        await this.dataSource.query(
          `UPDATE ai_model_grants SET ${sets.join(', ')}, updated_by = $2, updated_at = now() WHERE id = $1`,
          params,
        );
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new AppError(ERROR_CODES.conflict, 'Sudah ada izin lain dengan periode ini.', 409);
        }
        throw error;
      }
      await this.catalog.bump();
    }
    return this.toDto((await this.rows('g.id = $1', [id]))[0]!, caller);
  }

  async remove(auth: AuthContext, id: string): Promise<ModelGrantDto> {
    const { caller, row } = await this.editable(auth, id);
    updatedRows(await this.dataSource.query(`DELETE FROM ai_model_grants WHERE id = $1`, [id]));
    await this.catalog.bump();
    return this.toDto(row, caller);
  }

  /** Daftar target untuk pemilih (departemen, orang, agent pribadi). */
  async reach(auth: AuthContext): Promise<ReachDto> {
    const caller = await this.caller(auth);
    const global = caller.scope === 'admin';
    const departments = (await this.dataSource.query(
      `SELECT id, name, parent_id FROM departments
        WHERE is_active AND ($1::boolean OR id = ANY($2::uuid[])) ORDER BY name`,
      [global, global ? [] : caller.reach.departmentIds],
    )) as { id: string; name: string; parent_id: string | null }[];
    const users = (await this.dataSource.query(
      `SELECT u.id, u.display_name, u.job_title, u.department_id, d.name AS department_name
         FROM users u LEFT JOIN departments d ON d.id = u.department_id
        WHERE u.status = 'active' AND ($1::boolean OR u.id = ANY($2::uuid[])) ORDER BY u.display_name`,
      [global, global ? [] : caller.reach.userIds],
    )) as { id: string; display_name: string; job_title: string | null; department_id: string | null; department_name: string | null }[];
    const agents = (await this.dataSource.query(
      `SELECT a.id, a.name, a.owner_user_id, u.display_name AS owner_name
         FROM agents a JOIN users u ON u.id = a.owner_user_id
        WHERE NOT a.is_template AND a.status = 'active' AND ($1::boolean OR a.id = ANY($2::uuid[]))
        ORDER BY u.display_name, a.name`,
      [global, global ? [] : caller.reach.agentIds],
    )) as { id: string; name: string; owner_user_id: string; owner_name: string }[];
    return {
      global,
      departments: departments.map((d) => ({ id: d.id, name: d.name, parentId: d.parent_id })),
      users: users.map((u) => ({
        id: u.id,
        name: u.display_name,
        jobTitle: u.job_title,
        departmentId: u.department_id,
        departmentName: u.department_name,
      })),
      agents: agents.map((a) => ({ id: a.id, name: a.name, ownerUserId: a.owner_user_id, ownerName: a.owner_name })),
    };
  }

  /** Pengguna yang boleh dilihat efektifnya oleh pemanggil. */
  async assertUserInReach(auth: AuthContext, userId: string): Promise<void> {
    const caller = await this.caller(auth);
    if (caller.scope === 'admin' || userId === auth.user.id) return;
    if (!caller.reach.userIds.includes(userId)) throw blocked('Pengguna di luar jangkauan Anda.');
  }
}
