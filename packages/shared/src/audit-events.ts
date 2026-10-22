/** Stable audit event identifiers (dot-separated). */
export const AUDIT_EVENTS = {
  authLoginSuccess: 'auth.login.success',
  authLoginFailed: 'auth.login.failed',
  authLoginLocked: 'auth.login.locked',
  authLoginUnlockedAdmin: 'auth.login.unlocked_admin',
  authLogout: 'auth.logout',
  authLogoutAll: 'auth.logout_all',
  authSessionRevoked: 'auth.session.revoked',
  authPasswordChanged: 'auth.password.changed',
  authPasswordReset: 'auth.password.reset',

  userCreated: 'user.created',
  userUpdated: 'user.updated',
  userStatusChanged: 'user.status_changed',

  roleCreated: 'rbac.role.created',
  roleUpdated: 'rbac.role.updated',
  roleDeleted: 'rbac.role.deleted',
  rolePermissionsUpdated: 'rbac.role.permissions.updated',

  assignmentGranted: 'rbac.assignment.granted',
  assignmentRevoked: 'rbac.assignment.revoked',

  groupCreated: 'rbac.group.created',
  groupUpdated: 'rbac.group.updated',
  groupDeleted: 'rbac.group.deleted',
  groupMembersAdded: 'rbac.group.members.added',
  groupMembersRemoved: 'rbac.group.members.removed',

  departmentCreated: 'rbac.department.created',
  departmentUpdated: 'rbac.department.updated',
  departmentDeleted: 'rbac.department.deleted',

  policyCreated: 'rbac.policy.created',
  policyUpdated: 'rbac.policy.updated',
  policyDeleted: 'rbac.policy.deleted',

  permissionUpdated: 'rbac.permission.updated',
  permissionSynced: 'rbac.permission.synced',

  navApplicationCreated: 'nav.application.created',
  navApplicationUpdated: 'nav.application.updated',
  navApplicationDeleted: 'nav.application.deleted',
  navModuleCreated: 'nav.module.created',
  navModuleUpdated: 'nav.module.updated',
  navModuleDeleted: 'nav.module.deleted',
  navFeatureCreated: 'nav.feature.created',
  navFeatureUpdated: 'nav.feature.updated',
  navFeatureDeleted: 'nav.feature.deleted',
  navMenuItemCreated: 'nav.menu_item.created',
  navMenuItemUpdated: 'nav.menu_item.updated',
  navMenuItemDeleted: 'nav.menu_item.deleted',
  navReordered: 'nav.reordered',

  aiConversationCreated: 'ai.conversation.created',
  aiTaskCreated: 'ai.task.created',
  aiTaskCompleted: 'ai.task.completed',
  aiTaskFailed: 'ai.task.failed',
  aiTaskCancelled: 'ai.task.cancelled',
  aiMindMapViewed: 'ai.mindmap.viewed',

  knowledgeSourceCreated: 'knowledge.source.created',
  knowledgeSourceUpdated: 'knowledge.source.updated',
  knowledgeSourceDeleted: 'knowledge.source.deleted',
  knowledgeDocumentCreated: 'knowledge.document.created',
  knowledgeDocumentUpdated: 'knowledge.document.updated',
  knowledgeDocumentDeleted: 'knowledge.document.deleted',
  knowledgeCollectionCreated: 'knowledge.collection.created',
  knowledgeCollectionUpdated: 'knowledge.collection.updated',
  knowledgeCollectionDeleted: 'knowledge.collection.deleted',
  knowledgeSearchPerformed: 'knowledge.search.performed',

  agentCreated: 'agent.created',
  agentUpdated: 'agent.updated',
  agentDeleted: 'agent.deleted',
  agentTaskExecuted: 'agent.task.executed',
  approvalRequested: 'agent.approval.requested',
  approvalApproved: 'agent.approval.approved',
  approvalRejected: 'agent.approval.rejected',

  mcpServerCreated: 'integration.mcp_server.created',
  mcpServerUpdated: 'integration.mcp_server.updated',
  mcpServerDeleted: 'integration.mcp_server.deleted',
  restConnectorCreated: 'integration.rest_connector.created',
  restConnectorUpdated: 'integration.rest_connector.updated',
  restConnectorDeleted: 'integration.rest_connector.deleted',
  integrationHealthChecked: 'integration.health.checked',

  configUpdated: 'config.updated',

  securityAuthorizationDenied: 'security.authorization.denied',
  securityPrivilegeEscalationBlocked: 'security.privilege_escalation_blocked',

  adminAuthzTestPerformed: 'admin.authz_test.performed',

  systemSeedExecuted: 'system.seed.executed',
  systemBootstrapAdminCreated: 'system.bootstrap.admin_created',
} as const;

export type AuditEventKey = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS];
