import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AUDIT_EVENTS, isKnownPermissionId, PERMISSIONS } from '@bara/shared';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { AppError, ERROR_CODES } from '../../common/errors/app-error';
import { DATA_SOURCE } from '../../database/database.module';
import { updatedRows } from '../../database/query-result';
import { AuditService } from '../audit/audit.service';
import {
  CreateApplicationDto,
  CreateFeatureDto,
  CreateMenuItemDto,
  CreateModuleDto,
  ReorderNavDto,
  UpdateApplicationDto,
  UpdateFeatureDto,
  UpdateMenuItemDto,
  UpdateModuleDto,
} from './dto/misc.dto';

const uuidPipe = new ParseUUIDPipe({ errorHttpStatusCode: 404 });

type NavLevel = 'application' | 'module' | 'feature' | 'menu_item';

const LEVEL_TABLES: Record<NavLevel, string> = {
  application: 'applications',
  module: 'modules',
  feature: 'features',
  menu_item: 'menu_items',
};

const AUDIT_KEYS: Record<NavLevel, { created: string; updated: string; deleted: string }> = {
  application: {
    created: AUDIT_EVENTS.navApplicationCreated,
    updated: AUDIT_EVENTS.navApplicationUpdated,
    deleted: AUDIT_EVENTS.navApplicationDeleted,
  },
  module: {
    created: AUDIT_EVENTS.navModuleCreated,
    updated: AUDIT_EVENTS.navModuleUpdated,
    deleted: AUDIT_EVENTS.navModuleDeleted,
  },
  feature: {
    created: AUDIT_EVENTS.navFeatureCreated,
    updated: AUDIT_EVENTS.navFeatureUpdated,
    deleted: AUDIT_EVENTS.navFeatureDeleted,
  },
  menu_item: {
    created: AUDIT_EVENTS.navMenuItemCreated,
    updated: AUDIT_EVENTS.navMenuItemUpdated,
    deleted: AUDIT_EVENTS.navMenuItemDeleted,
  },
};

interface IdRow {
  id: string;
}

@ApiTags('admin-nav')
@Controller('admin/nav')
export class NavAdminController {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
  ) {}

  @RequirePermission(PERMISSIONS.navManage)
  @Get('tree')
  async fullTree() {
    const [applications, modules, features, menuItems] = await Promise.all([
      this.dataSource.query(
        `SELECT id, identifier, name, icon, description, sort_order, is_active FROM applications
          ORDER BY sort_order, name`,
      ),
      this.dataSource.query(
        `SELECT id, application_id, parent_id, identifier, name, description, sort_order, is_active
           FROM modules ORDER BY sort_order, name`,
      ),
      this.dataSource.query(
        `SELECT id, module_id, identifier, name, description, sort_order, is_active
           FROM features ORDER BY sort_order, name`,
      ),
      this.dataSource.query(
        `SELECT id, key, application_id, module_id, feature_id, parent_id, label_default, i18n_key,
                icon, route_path, required_permission, sort_order, is_active, is_future
           FROM menu_items ORDER BY sort_order, label_default`,
      ),
    ]);
    return { applications, modules, features, menuItems };
  }

  private async createRow(
    auth: AuthContext,
    level: NavLevel,
    columns: string[],
    values: unknown[],
    auditEventKey: string,
    summary: string,
  ) {
    const table = LEVEL_TABLES[level];
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    let rows: IdRow[];
    try {
      rows = (await this.dataSource.query(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders}) RETURNING id`,
        values,
      )) as IdRow[];
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Identifier/kunci sudah digunakan.', 409);
      }
      if ((error as { code?: string }).code === '23503') {
        throw new AppError(ERROR_CODES.validation, 'Referensi induk tidak ditemukan.', 400);
      }
      throw error;
    }
    const id = rows[0]?.id ?? '';
    await this.audit.record({
      eventKey: auditEventKey,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: level,
      entityId: id,
      payload: { [level]: { columns, values } },
    });
    return { id };
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Post('applications')
  async createApplication(@CurrentAuth() auth: AuthContext, @Body() body: CreateApplicationDto) {
    return this.createRow(
      auth,
      'application',
      ['identifier', 'name', 'description', 'icon', 'sort_order', 'is_active'],
      [
        body.identifier,
        body.name,
        body.description ?? null,
        body.icon ?? null,
        body.sortOrder ?? 0,
        body.isActive ?? true,
      ],
      AUDIT_KEYS.application.created,
      `Aplikasi navigasi "${body.name}" dibuat`,
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Post('modules')
  async createModule(@CurrentAuth() auth: AuthContext, @Body() body: CreateModuleDto) {
    return this.createRow(
      auth,
      'module',
      ['application_id', 'parent_id', 'identifier', 'name', 'description', 'sort_order', 'is_active'],
      [
        body.applicationId,
        body.parentId ?? null,
        body.identifier,
        body.name,
        body.description ?? null,
        body.sortOrder ?? 0,
        body.isActive ?? true,
      ],
      AUDIT_KEYS.module.created,
      `Modul navigasi "${body.name}" dibuat`,
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Post('features')
  async createFeature(@CurrentAuth() auth: AuthContext, @Body() body: CreateFeatureDto) {
    return this.createRow(
      auth,
      'feature',
      ['module_id', 'identifier', 'name', 'description', 'sort_order', 'is_active'],
      [
        body.moduleId,
        body.identifier,
        body.name,
        body.description ?? null,
        body.sortOrder ?? 0,
        body.isActive ?? true,
      ],
      AUDIT_KEYS.feature.created,
      `Fitur navigasi "${body.name}" dibuat`,
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Post('menu-items')
  async createMenuItem(@CurrentAuth() auth: AuthContext, @Body() body: CreateMenuItemDto) {
    if (body.requiredPermission && !isKnownPermissionId(body.requiredPermission)) {
      throw new AppError(
        ERROR_CODES.validation,
        `Permission "${body.requiredPermission}" tidak dikenal.`,
        400,
      );
    }
    return this.createRow(
      auth,
      'menu_item',
      [
        'key',
        'application_id',
        'module_id',
        'feature_id',
        'parent_id',
        'label_default',
        'i18n_key',
        'icon',
        'route_path',
        'required_permission',
        'sort_order',
        'is_active',
        'is_future',
      ],
      [
        body.key,
        body.applicationId,
        body.moduleId ?? null,
        body.featureId ?? null,
        body.parentId ?? null,
        body.labelDefault,
        body.i18nKey ?? null,
        body.icon ?? null,
        body.routePath ?? null,
        body.requiredPermission ?? null,
        body.sortOrder ?? 0,
        body.isActive ?? true,
        body.isFuture ?? false,
      ],
      AUDIT_KEYS.menu_item.created,
      `Menu "${body.labelDefault}" dibuat`,
    );
  }

  private async updateRow(
    auth: AuthContext,
    level: NavLevel,
    id: string,
    changes: [string, unknown][],
    auditEventKey: string,
    summary: string,
  ): Promise<IdRow> {
    const table = LEVEL_TABLES[level];
    const values: unknown[] = changes.map(([, value]) => value);
    const setClauses = changes.map(([column], index) => `${column} = $${index + 1}`);
    values.push(id);
    let rows: IdRow[];
    try {
      rows = updatedRows<IdRow>(
        await this.dataSource.query(
          `UPDATE ${table} SET ${setClauses.join(', ')}, updated_at = now() WHERE id = $${values.length} RETURNING id`,
          values,
        ),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw new AppError(ERROR_CODES.conflict, 'Identifier/kunci sudah digunakan.', 409);
      }
      if ((error as { code?: string }).code === '23503') {
        throw new AppError(ERROR_CODES.validation, 'Referensi induk tidak ditemukan.', 400);
      }
      throw error;
    }
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Data navigasi tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: auditEventKey,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: level,
      entityId: id,
      payload: { changes: changes.map(([column, value]) => ({ column, value })) },
    });
    return row;
  }

  private requireChanges(changes: [string, unknown][]): [string, unknown][] {
    if (changes.length === 0) {
      throw new AppError(ERROR_CODES.validation, 'Tidak ada perubahan yang dikirim.', 400);
    }
    return changes;
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Patch('applications/:id')
  async updateApplication(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() body: UpdateApplicationDto,
  ) {
    const changes: [string, unknown][] = [];
    if (body.identifier != null) changes.push(['identifier', body.identifier]);
    if (body.name != null) changes.push(['name', body.name]);
    if (body.description !== undefined) changes.push(['description', body.description]);
    if (body.icon !== undefined) changes.push(['icon', body.icon]);
    if (body.sortOrder != null) changes.push(['sort_order', body.sortOrder]);
    if (body.isActive != null) changes.push(['is_active', body.isActive]);
    return this.updateRow(
      auth,
      'application',
      id,
      this.requireChanges(changes),
      AUDIT_KEYS.application.updated,
      'Aplikasi navigasi diperbarui',
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Patch('modules/:id')
  async updateModule(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() body: UpdateModuleDto,
  ) {
    const changes: [string, unknown][] = [];
    if (body.applicationId != null) changes.push(['application_id', body.applicationId]);
    if (body.parentId !== undefined) changes.push(['parent_id', body.parentId]);
    if (body.identifier != null) changes.push(['identifier', body.identifier]);
    if (body.name != null) changes.push(['name', body.name]);
    if (body.description !== undefined) changes.push(['description', body.description]);
    if (body.sortOrder != null) changes.push(['sort_order', body.sortOrder]);
    if (body.isActive != null) changes.push(['is_active', body.isActive]);
    return this.updateRow(
      auth,
      'module',
      id,
      this.requireChanges(changes),
      AUDIT_KEYS.module.updated,
      'Modul navigasi diperbarui',
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Patch('features/:id')
  async updateFeature(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() body: UpdateFeatureDto,
  ) {
    const changes: [string, unknown][] = [];
    if (body.moduleId != null) changes.push(['module_id', body.moduleId]);
    if (body.identifier != null) changes.push(['identifier', body.identifier]);
    if (body.name != null) changes.push(['name', body.name]);
    if (body.description !== undefined) changes.push(['description', body.description]);
    if (body.sortOrder != null) changes.push(['sort_order', body.sortOrder]);
    if (body.isActive != null) changes.push(['is_active', body.isActive]);
    return this.updateRow(
      auth,
      'feature',
      id,
      this.requireChanges(changes),
      AUDIT_KEYS.feature.updated,
      'Fitur navigasi diperbarui',
    );
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Patch('menu-items/:id')
  async updateMenuItem(
    @CurrentAuth() auth: AuthContext,
    @Param('id', uuidPipe) id: string,
    @Body() body: UpdateMenuItemDto,
  ) {
    if (body.requiredPermission != null && !isKnownPermissionId(body.requiredPermission)) {
      throw new AppError(
        ERROR_CODES.validation,
        `Permission "${body.requiredPermission}" tidak dikenal.`,
        400,
      );
    }
    const changes: [string, unknown][] = [];
    if (body.key != null) changes.push(['key', body.key]);
    if (body.applicationId != null) changes.push(['application_id', body.applicationId]);
    if (body.moduleId !== undefined) changes.push(['module_id', body.moduleId]);
    if (body.featureId !== undefined) changes.push(['feature_id', body.featureId]);
    if (body.parentId !== undefined) changes.push(['parent_id', body.parentId]);
    if (body.labelDefault != null) changes.push(['label_default', body.labelDefault]);
    if (body.i18nKey !== undefined) changes.push(['i18n_key', body.i18nKey]);
    if (body.icon !== undefined) changes.push(['icon', body.icon]);
    if (body.routePath !== undefined) changes.push(['route_path', body.routePath]);
    if (body.requiredPermission !== undefined) {
      changes.push(['required_permission', body.requiredPermission]);
    }
    if (body.sortOrder != null) changes.push(['sort_order', body.sortOrder]);
    if (body.isActive != null) changes.push(['is_active', body.isActive]);
    if (body.isFuture != null) changes.push(['is_future', body.isFuture]);
    return this.updateRow(
      auth,
      'menu_item',
      id,
      this.requireChanges(changes),
      AUDIT_KEYS.menu_item.updated,
      'Menu navigasi diperbarui',
    );
  }

  private async removeRow(
    auth: AuthContext,
    level: NavLevel,
    id: string,
    auditEventKey: string,
    summary: string,
  ) {
    const table = LEVEL_TABLES[level];
    let rows: IdRow[];
    try {
      rows = updatedRows<IdRow>(
        await this.dataSource.query(`DELETE FROM ${table} WHERE id = $1 RETURNING id`, [id]),
      );
    } catch (error) {
      if ((error as { code?: string }).code === '23503') {
        throw new AppError(
          ERROR_CODES.conflict,
          'Data masih direferensikan oleh data navigasi lain.',
          409,
        );
      }
      throw error;
    }
    const row = rows[0];
    if (!row) throw new AppError(ERROR_CODES.notFound, 'Data navigasi tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: auditEventKey,
      severity: 'info',
      summary,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: level,
      entityId: id,
    });
    return { id };
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Delete('applications/:id')
  async deleteApplication(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    const deps = (await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM modules WHERE application_id = $1) AS modules,
         (SELECT count(*)::int FROM menu_items WHERE application_id = $1) AS menu_items`,
      [id],
    )) as { modules: number; menu_items: number }[];
    const dep = deps[0];
    if (dep && (dep.modules > 0 || dep.menu_items > 0)) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Aplikasi masih memiliki ${dep.modules} modul dan ${dep.menu_items} menu. Hapus isinya terlebih dahulu.`,
        409,
      );
    }
    return this.removeRow(auth, 'application', id, AUDIT_KEYS.application.deleted, 'Aplikasi navigasi dihapus');
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Delete('modules/:id')
  async deleteModule(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    const deps = (await this.dataSource.query(
      `SELECT
         (SELECT count(*)::int FROM modules WHERE parent_id = $1) AS child_modules,
         (SELECT count(*)::int FROM features WHERE module_id = $1) AS features,
         (SELECT count(*)::int FROM menu_items WHERE module_id = $1) AS menu_items`,
      [id],
    )) as { child_modules: number; features: number; menu_items: number }[];
    const dep = deps[0];
    if (dep && (dep.child_modules > 0 || dep.features > 0 || dep.menu_items > 0)) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Modul masih memiliki ${dep.child_modules} sub-modul, ${dep.features} fitur, dan ${dep.menu_items} menu.`,
        409,
      );
    }
    return this.removeRow(auth, 'module', id, AUDIT_KEYS.module.deleted, 'Modul navigasi dihapus');
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Delete('features/:id')
  async deleteFeature(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    const deps = (await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM menu_items WHERE feature_id = $1) AS menu_items`,
      [id],
    )) as { menu_items: number }[];
    const dep = deps[0];
    if (dep && dep.menu_items > 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Fitur masih direferensikan oleh ${dep.menu_items} menu.`,
        409,
      );
    }
    return this.removeRow(auth, 'feature', id, AUDIT_KEYS.feature.deleted, 'Fitur navigasi dihapus');
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Delete('menu-items/:id')
  async deleteMenuItem(@CurrentAuth() auth: AuthContext, @Param('id', uuidPipe) id: string) {
    const deps = (await this.dataSource.query(
      `SELECT (SELECT count(*)::int FROM menu_items WHERE parent_id = $1) AS children`,
      [id],
    )) as { children: number }[];
    const dep = deps[0];
    if (dep && dep.children > 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        `Menu masih memiliki ${dep.children} sub-menu. Hapus sub-menu terlebih dahulu.`,
        409,
      );
    }
    return this.removeRow(auth, 'menu_item', id, AUDIT_KEYS.menu_item.deleted, 'Menu navigasi dihapus');
  }

  @RequirePermission(PERMISSIONS.navManage)
  @Put('reorder')
  async reorder(@CurrentAuth() auth: AuthContext, @Body() body: ReorderNavDto) {
    const groups: Record<NavLevel, { ids: string[]; orders: number[] }> = {
      application: { ids: [], orders: [] },
      module: { ids: [], orders: [] },
      feature: { ids: [], orders: [] },
      menu_item: { ids: [], orders: [] },
    };
    for (const item of body.items) {
      const group = groups[item.type as NavLevel];
      if (!group || !/^[0-9a-f-]{36}$/i.test(item.id) || !Number.isInteger(item.sortOrder)) {
        throw new AppError(ERROR_CODES.validation, 'Item reorder tidak valid.', 400);
      }
      group.ids.push(item.id);
      group.orders.push(item.sortOrder);
    }
    let updated = 0;
    for (const level of Object.keys(groups) as NavLevel[]) {
      const { ids, orders } = groups[level];
      if (ids.length === 0) continue;
      const rows = updatedRows<IdRow>(
        await this.dataSource.query(
          `UPDATE ${LEVEL_TABLES[level]} t
              SET sort_order = v.sort_order, updated_at = now()
             FROM unnest($1::uuid[], $2::int[]) AS v(id, sort_order)
            WHERE t.id = v.id
            RETURNING t.id`,
          [ids, orders],
        ),
      );
      updated += rows.length;
    }
    await this.audit.record({
      eventKey: AUDIT_EVENTS.navReordered,
      severity: 'info',
      summary: `${body.items.length} item navigasi diurutkan ulang`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'navigation',
      payload: { requested: body.items.length, updated },
    });
    return { updated };
  }
}
