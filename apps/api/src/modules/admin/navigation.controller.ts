import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { DataSource } from 'typeorm';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import type { AuthContext } from '../../common/types/auth-context';
import { DATA_SOURCE } from '../../database/database.module';

interface AppRow {
  id: string;
  identifier: string;
  name: string;
  icon: string | null;
  sort_order: number;
}

interface ModuleRow {
  id: string;
  application_id: string;
  identifier: string;
  name: string;
  description: string | null;
  sort_order: number;
}

interface ItemRow {
  id: string;
  application_id: string;
  module_id: string | null;
  feature_id: string | null;
  parent_id: string | null;
  label_default: string;
  i18n_key: string | null;
  icon: string | null;
  route_path: string | null;
  required_permission: string | null;
  sort_order: number;
  is_future: boolean;
}

interface NavItemNode {
  id: string;
  key: string;
  label: string;
  i18nKey: string | null;
  icon: string | null;
  routePath: string | null;
  isFuture: boolean;
  children: NavItemNode[];
}

function buildItemTree(rows: ItemRow[]): NavItemNode[] {
  const byId = new Map<string, NavItemNode>();
  for (const row of rows) {
    byId.set(row.id, {
      id: row.id,
      key: row.i18n_key ?? row.label_default,
      label: row.label_default,
      i18nKey: row.i18n_key,
      icon: row.icon,
      routePath: row.route_path,
      isFuture: row.is_future,
      children: [],
    });
  }
  const roots: NavItemNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    if (row.parent_id && byId.has(row.parent_id)) {
      byId.get(row.parent_id)!.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

/** Navigasi dinamis untuk pengguna: hanya menu yang izinnya dimiliki yang tampil. */
@ApiTags('navigation')
@Controller('navigation')
export class NavigationController {
  constructor(@Inject(DATA_SOURCE) private readonly dataSource: DataSource) {}

  @Get()
  async tree(@CurrentAuth() auth: AuthContext) {
    const [apps, modules, items] = await Promise.all([
      this.dataSource.query(
        `SELECT id, identifier, name, icon, sort_order FROM applications
          WHERE is_active = true ORDER BY sort_order, name`,
      ) as Promise<AppRow[]>,
      this.dataSource.query(
        `SELECT id, application_id, identifier, name, description, sort_order FROM modules
          WHERE is_active = true ORDER BY sort_order, name`,
      ) as Promise<ModuleRow[]>,
      this.dataSource.query(
        `SELECT id, application_id, module_id, feature_id, parent_id, label_default,
                i18n_key, icon, route_path, required_permission, sort_order, is_future
           FROM menu_items
          WHERE is_active = true
          ORDER BY sort_order, label_default`,
      ) as Promise<ItemRow[]>,
    ]);

    const allowed = auth.effective.allowed;
    const visible = items.filter(
      (item) => !item.required_permission || allowed.has(item.required_permission),
    );

    return apps
      .map((app) => {
        const appItems = visible.filter((i) => i.application_id === app.id);
        const appLevelItems = buildItemTree(appItems.filter((i) => i.module_id === null));
        const appModules = modules
          .filter((m) => m.application_id === app.id)
          .map((module) => {
            const moduleItems = appItems.filter((i) => i.module_id === module.id);
            return {
              id: module.id,
              identifier: module.identifier,
              name: module.name,
              description: module.description,
              items: buildItemTree(moduleItems),
            };
          })
          .filter((module) => module.items.length > 0);
        return {
          id: app.id,
          identifier: app.identifier,
          name: app.name,
          icon: app.icon,
          items: appLevelItems,
          modules: appModules,
        };
      })
      .filter((app) => app.items.length > 0 || app.modules.length > 0);
  }
}
