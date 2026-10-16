import {
  checkLastSuperadmin,
  checkRoleGrant,
  type ActorSummary,
} from '../../src/modules/rbac/escalation.service';

type Intent = Parameters<typeof checkRoleGrant>[1];

const actor = (over: Partial<ActorSummary> = {}): ActorSummary => ({
  userId: 'actor',
  isSuperadmin: false,
  hasPermission: () => false,
  scopeFor: () => null,
  ...over,
});

const intent = (over: Partial<Intent> = {}): Intent => ({
  subjectIsSelf: false,
  roleCode: 'manager',
  roleIsSystem: false,
  rolePermissions: ['knowledge.documents.read'],
  dataScope: 'own',
  ...over,
});

describe('aturan anti-escalation', () => {
  it('superadmin boleh memberikan role administrator', () => {
    const v = checkRoleGrant(
      actor({ isSuperadmin: true }),
      intent({ roleCode: 'administrator', roleIsSystem: true }),
    );
    expect(v).toEqual([]);
  });

  it('menolak self-modification bahkan untuk superadmin', () => {
    const v = checkRoleGrant(actor({ isSuperadmin: true }), intent({ subjectIsSelf: true }));
    expect(v.map((x) => x.code)).toContain('self_modification');
  });

  it('non-superadmin tidak boleh memberikan role administrator', () => {
    const v = checkRoleGrant(actor(), intent({ roleCode: 'administrator', roleIsSystem: true }));
    expect(v.map((x) => x.code)).toContain('system_role_requires_superadmin');
  });

  it('menolak bila aktor tidak memiliki salah satu izin role', () => {
    const v = checkRoleGrant(actor({ hasPermission: () => false }), intent());
    expect(v.map((x) => x.code)).toContain('permission_subset');
  });

  it('menolak scope yang melebihi scope aktor', () => {
    const v = checkRoleGrant(
      actor({ hasPermission: () => true, scopeFor: () => 'own' }),
      intent({ dataScope: 'department' }),
    );
    expect(v.map((x) => x.code)).toContain('scope_exceeded');
  });

  it('mengizinkan bila izin dan scope aktor mencukupi', () => {
    const v = checkRoleGrant(
      actor({ hasPermission: () => true, scopeFor: () => 'global' }),
      intent({ dataScope: 'department' }),
    );
    expect(v).toEqual([]);
  });

  it('melindungi superadmin terakhir', () => {
    expect(checkLastSuperadmin(true, 1, true).map((x) => x.code)).toContain('last_superadmin');
    expect(checkLastSuperadmin(true, 2, true)).toEqual([]);
    expect(checkLastSuperadmin(true, 1, false)).toEqual([]);
  });
});
