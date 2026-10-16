import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, PERMISSIONS } from '@contributor/shared';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import { EffectivePermissionsService } from '../rbac/effective-permissions.service';
import { CreateDepartmentDto, UpdateDepartmentDto } from './dto/rbac.dto';

interface DepartmentRow {
  id: string;
  name: string;
  code: string;
  parent_id: string | null;
  user_count: number;
}

interface DepartmentNode extends DepartmentRow {
  children: DepartmentNode[];
}

@Injectable()
export class DepartmentsService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly effective: EffectivePermissionsService,
    private readonly audit: AuditService,
  ) {}

  async tree(): Promise<DepartmentNode[]> {
    const rows = (await this.dataSource.query(
      `SELECT d.id, d.name, d.code, d.parent_id,
              (SELECT count(*)::int FROM users u WHERE u.department_id = d.id) AS user_count
         FROM departments d
        ORDER BY d.name`,
    )) as DepartmentRow[];
    const byId = new Map<string, DepartmentNode>();
    for (const row of rows) byId.set(row.id, { ...row, children: [] });
    const roots: DepartmentNode[] = [];
    for (const node of byId.values()) {
      if (node.parent_id && byId.has(node.parent_id)) {
        byId.get(node.parent_id)!.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  }

  private async auditEvent(
    auth: AuthContext,
    eventKey: string,
    summary: string,
    entityId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      eventKey,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'department',
      entityId,
      payload,
    });
  }

  private async subtreeIds(departmentId: string): Promise<string[]> {
    const rows = (await this.dataSource.query(
      `WITH RECURSIVE sub AS (
         SELECT id FROM departments WHERE id = $1
         UNION ALL
         SELECT d.id FROM departments d JOIN sub s ON d.parent_id = s.id
       )
       SELECT id FROM sub`,
      [departmentId],
    )) as { id: string }[];
    return rows.map((r) => r.id);
  }

  async create(auth: AuthContext, dto: CreateDepartmentDto) {
    if (dto.parentId) {
      const parent = (await this.dataSource.query('SELECT id FROM departments WHERE id = $1', [
        dto.parentId,
      ])) as { id: string }[];
      if (parent.length === 0) throw new AppError(ERROR_CODES.notFound, 'Induk departemen tidak ditemukan.', 404);
    }
    let rows: { id: string }[];
    try {
      rows = (await this.dataSource.query(
        `INSERT INTO departments (name, code, parent_id) VALUES ($1, $2, $3::uuid) RETURNING id`,
        [dto.name, dto.code, dto.parentId ?? null],
      )) as { id: string }[];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Kode departemen sudah digunakan.', 409);
      }
      throw error;
    }
    const id = rows[0]?.id ?? '';
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.departmentCreated, `Membuat departemen ${dto.name}`, id, {
      name: dto.name,
      code: dto.code,
      parentId: dto.parentId ?? null,
    });
    return this.tree();
  }

  async update(auth: AuthContext, departmentId: string, dto: UpdateDepartmentDto) {
    const exists = (await this.dataSource.query('SELECT id, name FROM departments WHERE id = $1', [
      departmentId,
    ])) as { id: string; name: string }[];
    if (exists.length === 0) throw new AppError(ERROR_CODES.notFound, 'Departemen tidak ditemukan.', 404);

    if (dto.parentId !== undefined && dto.parentId !== null) {
      if (dto.parentId === departmentId) {
        throw new AppError(ERROR_CODES.validation, 'Departemen tidak dapat menjadi induk dirinya sendiri.', 400);
      }
      const subtree = await this.subtreeIds(departmentId);
      if (subtree.includes(dto.parentId)) {
        throw new AppError(ERROR_CODES.validation, 'Induk tidak boleh berada di dalam subtree departemen ini.', 400);
      }
    }

    const sets: string[] = [];
    const params: unknown[] = [departmentId];
    if (dto.name !== undefined) {
      params.push(dto.name);
      sets.push(`name = $${params.length}`);
    }
    if (dto.code !== undefined) {
      params.push(dto.code);
      sets.push(`code = $${params.length}`);
    }
    if (dto.parentId !== undefined) {
      params.push(dto.parentId);
      sets.push(`parent_id = $${params.length}::uuid`);
    }
    if (sets.length > 0) {
      sets.push('updated_at = now()');
      try {
        await this.dataSource.query(`UPDATE departments SET ${sets.join(', ')} WHERE id = $1`, params);
      } catch (error) {
        if ((error as { code?: string }).code === '23505') {
          throw new AppError(ERROR_CODES.conflict, 'Kode departemen sudah digunakan.', 409);
        }
        throw error;
      }
      await this.effective.bumpVersion();
      await this.auditEvent(auth, AUDIT_EVENTS.departmentUpdated, `Memperbarui departemen ${exists[0]!.name}`, departmentId, {
        name: dto.name,
        code: dto.code,
        parentId: dto.parentId,
      });
    }
    return this.tree();
  }

  async remove(auth: AuthContext, departmentId: string) {
    const exists = (await this.dataSource.query('SELECT id, name FROM departments WHERE id = $1', [
      departmentId,
    ])) as { id: string; name: string }[];
    if (exists.length === 0) throw new AppError(ERROR_CODES.notFound, 'Departemen tidak ditemukan.', 404);
    const usage = (await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM departments WHERE parent_id = $1) AS children,
              (SELECT count(*)::int FROM users WHERE department_id = $1) AS users`,
      [departmentId],
    )) as { children: number; users: number }[];
    if ((usage[0]?.children ?? 0) > 0) {
      throw new AppError(ERROR_CODES.conflict, 'Departemen masih memiliki sub-departemen.', 409);
    }
    if ((usage[0]?.users ?? 0) > 0) {
      throw new AppError(ERROR_CODES.conflict, 'Departemen masih memiliki pengguna.', 409);
    }
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(`DELETE FROM departments WHERE id = $1 RETURNING id`, [departmentId]),
    );
    if (deleted.length === 0) throw new AppError(ERROR_CODES.notFound, 'Departemen tidak ditemukan.', 404);
    await this.effective.bumpVersion();
    await this.auditEvent(auth, AUDIT_EVENTS.departmentDeleted, `Menghapus departemen ${exists[0]!.name}`, departmentId, {});
    return this.tree();
  }
}

@ApiTags('admin-departments')
@Controller('admin/departments')
export class DepartmentsController {
  constructor(private readonly departments: DepartmentsService) {}

  @RequirePermission(PERMISSIONS.departmentsRead)
  @Get()
  tree() {
    return this.departments.tree();
  }

  @RequirePermission(PERMISSIONS.departmentsManage)
  @Post()
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateDepartmentDto) {
    return this.departments.create(auth, dto);
  }

  @RequirePermission(PERMISSIONS.departmentsManage)
  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
    @Body() dto: UpdateDepartmentDto,
  ) {
    return this.departments.update(auth, id, dto);
  }

  @RequirePermission(PERMISSIONS.departmentsManage)
  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', new ParseUUIDPipe({ errorHttpStatusCode: 404 })) id: string,
  ) {
    return this.departments.remove(auth, id);
  }
}
