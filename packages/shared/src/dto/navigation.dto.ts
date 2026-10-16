export interface NavMenuItemDto {
  id: string;
  key: string;
  label: string;
  i18nKey: string | null;
  icon: string | null;
  routePath: string | null;
  isFuture: boolean;
  children: NavMenuItemDto[];
}

export interface NavModuleDto {
  id: string;
  identifier: string;
  name: string;
  description: string | null;
  items: NavMenuItemDto[];
}

export interface NavApplicationDto {
  id: string;
  identifier: string;
  name: string;
  icon: string | null;
  items: NavMenuItemDto[];
  modules: NavModuleDto[];
}
