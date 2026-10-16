import {
  evaluateAll,
  evaluatePermission,
  type PolicyAssignment,
  type PolicyInput,
  type PolicyRecord,
} from '../../src/modules/rbac/policy-engine';

const assignment = (over: Partial<PolicyAssignment> = {}): PolicyAssignment => ({
  source: 'user',
  sourceId: 'u1',
  roleId: 'r1',
  roleCode: 'staf',
  roleName: 'Staf',
  dataScope: 'own',
  departmentId: null,
  ...over,
});

const policy = (over: Partial<PolicyRecord> = {}): PolicyRecord => ({
  id: 'p1',
  name: 'Policy Uji',
  effect: 'deny',
  subjectType: 'user',
  subjectId: 'u1',
  permissionPattern: 'knowledge.*',
  resourceType: null,
  resourceId: null,
  priority: 0,
  conditions: {},
  ...over,
});

const input = (over: Partial<PolicyInput> = {}): PolicyInput => ({
  userId: 'u1',
  groupIds: ['g1'],
  isSuperadmin: false,
  assignments: [assignment()],
  rolePermissions: new Map([['r1', ['knowledge.documents.read']]]),
  policies: [],
  ...over,
});

describe('policy engine', () => {
  it('menolak secara default saat tidak ada role yang memberikan izin', () => {
    const decision = evaluatePermission(
      input({ assignments: [], rolePermissions: new Map() }),
      'knowledge.documents.read',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('no_role_grant');
    expect(decision.scope).toBeNull();
  });

  it('memberi izin lewat role dan menghitung scope terluas', () => {
    const i = input({
      assignments: [
        assignment({ dataScope: 'own' }),
        assignment({
          roleId: 'r2',
          source: 'group',
          sourceId: 'g1',
          dataScope: 'department',
          departmentId: 'd1',
        }),
      ],
      rolePermissions: new Map([
        ['r1', ['knowledge.documents.read']],
        ['r2', ['knowledge.documents.read']],
      ]),
    });
    const decision = evaluatePermission(i, 'knowledge.documents.read');
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('role_grant');
    expect(decision.scope).toBe('department');
  });

  it('selalu mengizinkan superadmin', () => {
    const decision = evaluatePermission(
      input({ isSuperadmin: true, assignments: [] }),
      'rbac.roles.manage',
    );
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe('superadmin');
  });

  it('policy deny menimpa role grant termasuk pola wildcard', () => {
    const decision = evaluatePermission(
      input({ policies: [policy()] }),
      'knowledge.documents.read',
    );
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe('policy_deny');
  });

  it('policy deny berlaku untuk subject group', () => {
    const i = input({ policies: [policy({ subjectType: 'group', subjectId: 'g1' })] });
    expect(evaluatePermission(i, 'knowledge.documents.read').allowed).toBe(false);
  });

  it('policy deny tidak mengenai user lain', () => {
    const i = input({ policies: [policy({ subjectId: 'u9' })] });
    expect(evaluatePermission(i, 'knowledge.documents.read').allowed).toBe(true);
  });

  it('policy allow dengan kondisi ownership gagal bila bukan pemilik', () => {
    const i = input({ policies: [policy({ effect: 'allow', conditions: { ownership: true } })] });
    const asOwner = evaluatePermission(i, 'knowledge.documents.read', { resourceOwnerId: 'u1' });
    const asOther = evaluatePermission(i, 'knowledge.documents.read', { resourceOwnerId: 'u2' });
    expect(asOwner.allowed).toBe(true);
    expect(asOther.allowed).toBe(false);
    expect(asOther.reason).toBe('ownership_required');
  });

  it('policy berbatasan resource hanya berlaku untuk resource yang cocok', () => {
    const i = input({ policies: [policy({ resourceType: 'department', resourceId: 'd9' })] });
    expect(
      evaluatePermission(i, 'knowledge.documents.read', {
        resourceType: 'user',
        resourceId: 'u2',
      }).allowed,
    ).toBe(true);
    expect(
      evaluatePermission(i, 'knowledge.documents.read', {
        resourceType: 'department',
        resourceId: 'd9',
      }).allowed,
    ).toBe(false);
  });

  it('evaluateAll mengembalikan keputusan untuk setiap izin yang diminta', () => {
    const map = evaluateAll(input(), ['knowledge.documents.read', 'rbac.roles.manage']);
    expect(map.size).toBe(2);
    expect(map.get('knowledge.documents.read')?.allowed).toBe(true);
    expect(map.get('rbac.roles.manage')?.allowed).toBe(false);
  });
});
