import { createRouter, createWebHistory } from 'vue-router';
import AppShell from '@/layouts/AppShell.vue';
import { appI18n } from '@/i18n';
import { useAuthStore } from '@/stores/auth.store';
import { useNavigationStore } from '@/stores/navigation.store';
import { useToastStore } from '@/stores/toast.store';

declare module 'vue-router' {
  interface RouteMeta {
    public?: boolean;
    guestOnly?: boolean;
    titleKey?: string;
    permission?: string;
    navPath?: string;
  }
}

function admin(
  path: string,
  name: string,
  component: () => Promise<unknown>,
  permission: string,
) {
  const staticPath = path.includes(':') ? path.slice(0, path.indexOf(':')).replace(/\/$/, '') : path;
  return { path, name, component, meta: { permission, navPath: `/${staticPath}` } };
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true, guestOnly: true, titleKey: 'login.title' },
    },
    {
      path: '/showcase',
      name: 'showcase',
      component: () => import('@/views/ShowcaseView.vue'),
      meta: { public: true, titleKey: 'showcase.title' },
    },
    {
      path: '/',
      component: AppShell,
      children: [
        {
          path: '',
          name: 'home',
          component: () => import('@/views/HomeView.vue'),
        },
        admin('administration/users', 'admin-users', () => import('@/views/admin/UsersAdminView.vue'), 'rbac.users.read'),
        admin('administration/users/:id', 'admin-user-detail', () => import('@/views/admin/UserDetailAdminView.vue'), 'rbac.users.read'),
        admin('administration/groups', 'admin-groups', () => import('@/views/admin/GroupsAdminView.vue'), 'rbac.groups.read'),
        admin('administration/groups/:id', 'admin-group-detail', () => import('@/views/admin/GroupDetailAdminView.vue'), 'rbac.groups.read'),
        admin('administration/departments', 'admin-departments', () => import('@/views/admin/DepartmentsAdminView.vue'), 'rbac.departments.read'),
        admin('administration/roles', 'admin-roles', () => import('@/views/admin/RolesAdminView.vue'), 'rbac.roles.read'),
        admin('administration/roles/:id', 'admin-role-detail', () => import('@/views/admin/RoleDetailAdminView.vue'), 'rbac.roles.read'),
        admin('administration/permissions', 'admin-permissions', () => import('@/views/admin/PermissionsAdminView.vue'), 'rbac.permissions.read'),
        admin('administration/policies', 'admin-policies', () => import('@/views/admin/PoliciesAdminView.vue'), 'rbac.policies.read'),
        admin(
          'administration/effective-permissions',
          'admin-effective-permissions',
          () => import('@/views/admin/EffectivePermissionsAdminView.vue'),
          'rbac.effective.inspect',
        ),
        admin('administration/authz-test', 'admin-authz-test', () => import('@/views/admin/AuthzTestAdminView.vue'), 'rbac.authz.test'),
        admin('administration/audit', 'admin-audit', () => import('@/views/admin/AuditAdminView.vue'), 'audit.logs.read'),
        admin('administration/navigation', 'admin-navigation', () => import('@/views/admin/NavigationAdminView.vue'), 'nav.manage'),
        admin('administration/config', 'admin-config', () => import('@/views/admin/ConfigAdminView.vue'), 'config.read'),
        admin('administration/sessions', 'admin-sessions', () => import('@/views/admin/SessionsAdminView.vue'), 'security.sessions.manage'),
        admin('administration/providers', 'admin-providers', () => import('@/views/admin/ProvidersAdminView.vue'), 'providers.health.read'),
        {
          path: 'workspace',
          name: 'workspace',
          component: () => import('@/views/WorkspaceLandingView.vue'),
          meta: { navPath: '/workspace' },
        },
        admin('workspace/second-brain', 'workspace-second-brain', () => import('@/views/SecondBrainView.vue'), 'ai.secondbrain.query'),
        admin('workspace/counterpart', 'workspace-counterpart', () => import('@/views/CounterpartView.vue'), 'ai.counterpart.analyze'),
        admin('workspace/subordinate', 'workspace-subordinate', () => import('@/views/SubordinateView.vue'), 'ai.subordinate.execute'),
        admin('workspace/history', 'workspace-history', () => import('@/views/WorkspaceHistoryView.vue'), 'ai.workspace.history.read'),
        admin('workspace/mind-map', 'workspace-mind-map', () => import('@/views/MindMapView.vue'), 'ai.mindmap.team.read'),
        admin('knowledge/documents', 'knowledge-documents', () => import('@/views/knowledge/KnowledgeDocumentsView.vue'), 'knowledge.documents.read'),
        admin('knowledge/collections', 'knowledge-collections', () => import('@/views/knowledge/KnowledgeCollectionsView.vue'), 'knowledge.collections.read'),
        admin('knowledge/search', 'knowledge-search', () => import('@/views/knowledge/KnowledgeSearchView.vue'), 'knowledge.search.use'),
        admin('agents', 'agents-catalog', () => import('@/views/agents/AgentsCatalogView.vue'), 'agents.view'),
        admin('agents/definitions', 'agent-definitions', () => import('@/views/agents/AgentDefinitionsView.vue'), 'agents.view'),
        admin('agents/operations', 'agent-operations', () => import('@/views/agents/AgentOperationsView.vue'), 'agents.execute'),
        admin('agents/approvals', 'agent-approvals', () => import('@/views/agents/AgentApprovalsView.vue'), 'agents.approve'),
        admin('integrations', 'integrations-overview', () => import('@/views/integrations/IntegrationsOverviewView.vue'), 'integrations.view'),
        admin('integrations/oauth/callback', 'integrations-oauth-callback', () => import('@/views/integrations/McpOauthCallbackView.vue'), 'integrations.configure'),
        admin('integrations/credentials', 'integrations-credentials', () => import('@/views/integrations/IntegrationsCredentialsView.vue'), 'integrations.view'),
        {
          path: ':pathMatch(.*)*',
          name: 'coming-soon',
          component: () => import('@/views/ComingSoonView.vue'),
        },
      ],
    },
  ],
  scrollBehavior: () => ({ top: 0 }),
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  if (!auth.ready) await auth.fetchMe();

  if (to.meta.public === true) {
    if (to.meta.guestOnly === true && auth.authenticated) return { name: 'home' };
    return true;
  }

  if (!auth.authenticated) {
    return {
      name: 'login',
      query: to.fullPath === '/' ? {} : { redirect: to.fullPath },
    };
  }

  if (to.meta.permission && !auth.can(to.meta.permission)) {
    useToastStore().push(
      { variant: 'danger', title: appI18n.global.t('errors.forbidden') },
      6000,
    );
    return { name: 'home' };
  }

  const navigation = useNavigationStore();
  if (!navigation.loaded) {
    try {
      await navigation.load();
    } catch {
      // halaman tetap dirender; daftar navigasi tampil kosong sampai muat berhasil
    }
  }
  return true;
});
