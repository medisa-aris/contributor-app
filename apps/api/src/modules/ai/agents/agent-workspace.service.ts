import { randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { AUDIT_EVENTS } from '@bara/shared';
import { DataSource, type EntityManager } from 'typeorm';
import { AppError, ERROR_CODES } from '../../../common/errors/app-error';
import type { AuthContext } from '../../../common/types/auth-context';
import { DATA_SOURCE } from '../../../database/database.module';
import { updatedRows } from '../../../database/query-result';
import { AuditService } from '../../audit/audit.service';
import type { ConnectorAttachment } from '../../connectors/connector-tools.service';
import { ConnectorsService } from '../../connectors/connectors.service';
import { ChatToolsService } from '../chat-tools.service';
import type {
  AgentGroupDto,
  FromTemplateDto,
  PersonalAgentDto,
  SkillDto,
  UpdatePersonalAgentDto,
  UpdateSkillDto,
} from './dto/agents.dto';

export interface PersonalAgentRow {
  id: string;
  name: string;
  description: string | null;
  avatar_color: string | null;
  responsibilities: string | null;
  instruction: string;
  boundaries: string | null;
  memory: string | null;
  status: 'active' | 'inactive';
  template_id: string | null;
  template_name: string | null;
  task_count: number;
  created_at: string;
  updated_at: string;
  skills: { id: string; name: string }[];
  connectors: (ConnectorAttachment & { name: string; engine: string; granted: boolean })[];
}

export interface AgentTemplateRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  instruction: string;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  instructions: string;
  is_global: boolean;
  agent_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgentGroupRow {
  id: string;
  name: string;
  description: string | null;
  mode: 'delegate' | 'discussion';
  leader_agent_id: string;
  max_rounds: number;
  members: { id: string; name: string; avatar_color: string | null; position: number }[];
  task_count: number;
  created_at: string;
  updated_at: string;
}

const AGENT_COLORS = [
  '#0f766e',
  '#2563eb',
  '#7c3aed',
  '#c2410c',
  '#be123c',
  '#15803d',
  '#a16207',
  '#0e7490',
];

const AGENT_SELECT = `
  SELECT a.id, a.name, a.description, a.avatar_color, a.responsibilities, a.instruction, a.boundaries,
         a.memory, a.status, a.template_id, t.name AS template_name, a.created_at, a.updated_at,
         (SELECT count(*)::int FROM ai_tasks k WHERE k.agent_id = a.id) AS task_count,
         COALESCE((SELECT json_agg(json_build_object('id', s.id, 'name', s.name) ORDER BY s.name)
                     FROM agent_skills ak JOIN skills s ON s.id = ak.skill_id WHERE ak.agent_id = a.id), '[]') AS skills,
         COALESCE((SELECT json_agg(json_build_object('connectorType', c.connector_type, 'connectorId', c.connector_id,
                                                     'access', c.access))
                     FROM agent_connectors c WHERE c.agent_id = a.id), '[]') AS connectors
    FROM agents a
    LEFT JOIN agents t ON t.id = a.template_id`;

const GROUP_SELECT = `
  SELECT g.id, g.name, g.description, g.mode, g.leader_agent_id, g.max_rounds, g.created_at, g.updated_at,
         (SELECT count(*)::int FROM ai_tasks k WHERE k.group_id = g.id AND k.parent_task_id IS NULL) AS task_count,
         COALESCE((SELECT json_agg(json_build_object('id', a.id, 'name', a.name, 'avatar_color', a.avatar_color,
                                                     'position', m.position) ORDER BY m.position)
                     FROM agent_group_members m JOIN agents a ON a.id = m.agent_id WHERE m.group_id = g.id), '[]') AS members
    FROM agent_groups g`;

/**
 * Agent pribadi, skill, dan grup agent milik pengguna (mode Subordinate).
 * Semua operasi dibatasi ke pemilik; konektor dibatasi ke grant admin.
 */
@Injectable()
export class AgentWorkspaceService {
  constructor(
    @Inject(DATA_SOURCE) private readonly dataSource: DataSource,
    private readonly audit: AuditService,
    private readonly connectors: ConnectorsService,
    private readonly chatTools: ChatToolsService,
  ) {}

  // ───────────────────────── Agent ─────────────────────────

  async templates(): Promise<AgentTemplateRow[]> {
    return (await this.dataSource.query(
      `SELECT id, code, name, description, instruction FROM agents
        WHERE is_template AND owner_user_id IS NULL AND status = 'active' ORDER BY name`,
    )) as AgentTemplateRow[];
  }

  private async annotate(userId: string, rows: PersonalAgentRow[]): Promise<PersonalAgentRow[]> {
    if (rows.every((row) => row.connectors.length === 0)) return rows;
    const available = await this.connectors.availableFor(userId);
    return rows.map((row) => ({
      ...row,
      connectors: row.connectors.map((item) => {
        const match = available.find(
          (a) => a.connectorType === item.connectorType && a.connectorId === item.connectorId,
        );
        return {
          ...item,
          name: match?.name ?? '(akses dicabut)',
          engine: match?.engine ?? '',
          granted: Boolean(match),
        };
      }),
    }));
  }

  async listAgents(userId: string): Promise<PersonalAgentRow[]> {
    const rows = (await this.dataSource.query(
      `${AGENT_SELECT} WHERE a.owner_user_id = $1 ORDER BY a.name`,
      [userId],
    )) as PersonalAgentRow[];
    return this.annotate(userId, rows);
  }

  async agent(userId: string, agentId: string): Promise<PersonalAgentRow> {
    const rows = (await this.dataSource.query(
      `${AGENT_SELECT} WHERE a.id = $1 AND a.owner_user_id = $2`,
      [agentId, userId],
    )) as PersonalAgentRow[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Agent tidak ditemukan.', 404);
    return (await this.annotate(userId, rows))[0]!;
  }

  private async assertSkills(userId: string, skillIds: string[]): Promise<void> {
    if (skillIds.length === 0) return;
    const rows = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM skills WHERE id = ANY($1::uuid[]) AND (owner_user_id IS NULL OR owner_user_id = $2)`,
      [skillIds, userId],
    )) as { n: number }[];
    if ((rows[0]?.n ?? 0) !== new Set(skillIds).size) {
      throw new AppError(
        ERROR_CODES.validation,
        'Ada skill yang tidak ditemukan atau bukan milik Anda.',
        400,
      );
    }
  }

  private async replaceRelations(
    manager: EntityManager,
    agentId: string,
    skillIds: string[] | undefined,
    connectors: ConnectorAttachment[] | undefined,
  ): Promise<void> {
    if (skillIds) {
      await manager.query(`DELETE FROM agent_skills WHERE agent_id = $1`, [agentId]);
      for (const skillId of new Set(skillIds)) {
        await manager.query(`INSERT INTO agent_skills (agent_id, skill_id) VALUES ($1, $2)`, [
          agentId,
          skillId,
        ]);
      }
    }
    if (connectors) {
      await manager.query(`DELETE FROM agent_connectors WHERE agent_id = $1`, [agentId]);
      for (const item of connectors) {
        await manager.query(
          `INSERT INTO agent_connectors (agent_id, connector_type, connector_id, access) VALUES ($1, $2, $3, $4)`,
          [agentId, item.connectorType, item.connectorId, item.access],
        );
      }
    }
  }

  private async validConnectors(userId: string, items: ConnectorAttachment[] | undefined) {
    if (!items) return undefined;
    if (items.length === 0) return [];
    return this.chatTools.validate(items, await this.connectors.availableFor(userId));
  }

  async createAgent(
    auth: AuthContext,
    dto: PersonalAgentDto,
    templateId: string | null = null,
  ): Promise<PersonalAgentRow> {
    await this.assertSkills(auth.user.id, dto.skillIds ?? []);
    const connectors = await this.validConnectors(auth.user.id, dto.connectors);
    const count = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM agents WHERE owner_user_id = $1`,
      [auth.user.id],
    )) as { n: number }[];
    if ((count[0]?.n ?? 0) >= 30) {
      throw new AppError(ERROR_CODES.validation, 'Batas 30 agent per pengguna tercapai.', 400);
    }
    const id = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `INSERT INTO agents (code, name, description, instruction, owner_user_id, is_template, template_id,
                             avatar_color, responsibilities, boundaries, memory)
         VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9, $10) RETURNING id`,
        [
          `pa-${randomBytes(6).toString('hex')}`,
          dto.name.trim(),
          dto.description?.trim() || null,
          dto.instruction.trim(),
          auth.user.id,
          templateId,
          dto.avatarColor ?? AGENT_COLORS[(count[0]?.n ?? 0) % AGENT_COLORS.length],
          dto.responsibilities?.trim() || null,
          dto.boundaries?.trim() || null,
          dto.memory?.trim() || null,
        ],
      )) as { id: string }[];
      await this.replaceRelations(manager, rows[0]!.id, dto.skillIds ?? [], connectors ?? []);
      return rows[0]!.id;
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.personalAgentCreated,
      severity: 'info',
      summary: `Membuat agent pribadi "${dto.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: id,
      payload: {
        templateId,
        connectors: connectors?.length ?? 0,
        skills: dto.skillIds?.length ?? 0,
      },
    });
    return this.agent(auth.user.id, id);
  }

  async fromTemplate(auth: AuthContext, dto: FromTemplateDto): Promise<PersonalAgentRow> {
    const template = (await this.templates()).find((item) => item.id === dto.templateId);
    if (!template) throw new AppError(ERROR_CODES.notFound, 'Template tidak ditemukan.', 404);
    return this.createAgent(
      auth,
      {
        name: dto.name?.trim() || template.name,
        description: template.description ?? undefined,
        responsibilities: template.description ?? undefined,
        instruction: template.instruction,
      },
      template.id,
    );
  }

  async updateAgent(
    auth: AuthContext,
    agentId: string,
    dto: UpdatePersonalAgentDto,
  ): Promise<PersonalAgentRow> {
    await this.agent(auth.user.id, agentId);
    if (dto.skillIds) await this.assertSkills(auth.user.id, dto.skillIds);
    const connectors = await this.validConnectors(auth.user.id, dto.connectors);
    const sets: string[] = [];
    const params: unknown[] = [agentId];
    const push = (column: string, value: unknown) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };
    if (dto.name !== undefined) push('name', dto.name.trim());
    if (dto.description !== undefined) push('description', dto.description.trim() || null);
    if (dto.avatarColor !== undefined) push('avatar_color', dto.avatarColor);
    if (dto.responsibilities !== undefined)
      push('responsibilities', dto.responsibilities.trim() || null);
    if (dto.instruction !== undefined) push('instruction', dto.instruction.trim());
    if (dto.boundaries !== undefined) push('boundaries', dto.boundaries.trim() || null);
    if (dto.memory !== undefined) push('memory', dto.memory.trim() || null);
    if (dto.status !== undefined) push('status', dto.status);
    await this.dataSource.transaction(async (manager) => {
      if (sets.length > 0) {
        await manager.query(
          `UPDATE agents SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
          params,
        );
      }
      await this.replaceRelations(manager, agentId, dto.skillIds, connectors);
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.personalAgentUpdated,
      severity: 'info',
      summary: `Mengubah agent pribadi ${agentId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: agentId,
      payload: { fields: Object.keys(dto) },
    });
    return this.agent(auth.user.id, agentId);
  }

  async removeAgent(auth: AuthContext, agentId: string): Promise<void> {
    const agent = await this.agent(auth.user.id, agentId);
    const running = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM ai_tasks WHERE agent_id = $1 AND status IN ('running', 'validating')`,
      [agentId],
    )) as { n: number }[];
    if ((running[0]?.n ?? 0) > 0) {
      throw new AppError(
        ERROR_CODES.conflict,
        'Agent sedang menjalankan tugas. Batalkan tugasnya dahulu.',
        409,
      );
    }
    await this.dataSource.query(`DELETE FROM agents WHERE id = $1 AND owner_user_id = $2`, [
      agentId,
      auth.user.id,
    ]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.personalAgentDeleted,
      severity: 'info',
      summary: `Menghapus agent pribadi "${agent.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent',
      entityId: agentId,
      payload: {},
    });
  }

  // ───────────────────────── Skill ─────────────────────────

  async listSkills(userId: string): Promise<SkillRow[]> {
    return (await this.dataSource.query(
      `SELECT s.id, s.name, s.description, s.instructions, (s.owner_user_id IS NULL) AS is_global,
              (SELECT count(*)::int FROM agent_skills ak JOIN agents a ON a.id = ak.agent_id
                WHERE ak.skill_id = s.id AND a.owner_user_id = $1) AS agent_count,
              s.created_at, s.updated_at
         FROM skills s
        WHERE s.owner_user_id IS NULL OR s.owner_user_id = $1
        ORDER BY (s.owner_user_id IS NULL), s.name`,
      [userId],
    )) as SkillRow[];
  }

  private async ownSkill(userId: string, skillId: string): Promise<SkillRow> {
    const skill = (await this.listSkills(userId)).find((item) => item.id === skillId);
    if (!skill) throw new AppError(ERROR_CODES.notFound, 'Skill tidak ditemukan.', 404);
    if (skill.is_global)
      throw new AppError(ERROR_CODES.forbidden, 'Skill global hanya dapat diubah admin.', 403);
    return skill;
  }

  async createSkill(auth: AuthContext, dto: SkillDto): Promise<SkillRow> {
    const rows = (await this.dataSource.query(
      `INSERT INTO skills (owner_user_id, name, description, instructions) VALUES ($1, $2, $3, $4) RETURNING id`,
      [auth.user.id, dto.name.trim(), dto.description.trim(), dto.instructions.trim()],
    )) as { id: string }[];
    await this.audit.record({
      eventKey: AUDIT_EVENTS.skillCreated,
      severity: 'info',
      summary: `Membuat skill "${dto.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'skill',
      entityId: rows[0]!.id,
      payload: {},
    });
    return this.ownSkill(auth.user.id, rows[0]!.id);
  }

  async updateSkill(auth: AuthContext, skillId: string, dto: UpdateSkillDto): Promise<SkillRow> {
    await this.ownSkill(auth.user.id, skillId);
    await this.dataSource.query(
      `UPDATE skills SET name = COALESCE($2, name), description = COALESCE($3, description),
              instructions = COALESCE($4, instructions), updated_at = now()
        WHERE id = $1 AND owner_user_id = $5`,
      [
        skillId,
        dto.name?.trim() ?? null,
        dto.description?.trim() ?? null,
        dto.instructions?.trim() ?? null,
        auth.user.id,
      ],
    );
    await this.audit.record({
      eventKey: AUDIT_EVENTS.skillUpdated,
      severity: 'info',
      summary: `Mengubah skill ${skillId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'skill',
      entityId: skillId,
      payload: { fields: Object.keys(dto) },
    });
    return this.ownSkill(auth.user.id, skillId);
  }

  async removeSkill(auth: AuthContext, skillId: string): Promise<void> {
    const skill = await this.ownSkill(auth.user.id, skillId);
    await this.dataSource.query(`DELETE FROM skills WHERE id = $1 AND owner_user_id = $2`, [
      skillId,
      auth.user.id,
    ]);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.skillDeleted,
      severity: 'info',
      summary: `Menghapus skill "${skill.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'skill',
      entityId: skillId,
      payload: {},
    });
  }

  // ───────────────────────── Grup ─────────────────────────

  async listGroups(userId: string): Promise<AgentGroupRow[]> {
    return (await this.dataSource.query(
      `${GROUP_SELECT} WHERE g.owner_user_id = $1 ORDER BY g.name`,
      [userId],
    )) as AgentGroupRow[];
  }

  async group(userId: string, groupId: string): Promise<AgentGroupRow> {
    const rows = (await this.dataSource.query(
      `${GROUP_SELECT} WHERE g.id = $1 AND g.owner_user_id = $2`,
      [groupId, userId],
    )) as AgentGroupRow[];
    if (!rows[0]) throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);
    return rows[0];
  }

  /** Leader wajib anggota; minimal dua agent; semua milik pengguna. */
  private async normalizeMembers(userId: string, dto: AgentGroupDto): Promise<string[]> {
    const members = [
      dto.leaderAgentId,
      ...dto.memberAgentIds.filter((id) => id !== dto.leaderAgentId),
    ];
    const unique = [...new Set(members)];
    if (unique.length < 2) {
      throw new AppError(
        ERROR_CODES.validation,
        'Grup membutuhkan Leader dan minimal satu anggota lain.',
        400,
      );
    }
    const owned = (await this.dataSource.query(
      `SELECT count(*)::int AS n FROM agents WHERE id = ANY($1::uuid[]) AND owner_user_id = $2`,
      [unique, userId],
    )) as { n: number }[];
    if ((owned[0]?.n ?? 0) !== unique.length) {
      throw new AppError(ERROR_CODES.validation, 'Semua anggota grup harus agent milik Anda.', 400);
    }
    return unique;
  }

  async createGroup(auth: AuthContext, dto: AgentGroupDto): Promise<AgentGroupRow> {
    const members = await this.normalizeMembers(auth.user.id, dto);
    const id = await this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `INSERT INTO agent_groups (owner_user_id, name, description, mode, leader_agent_id, max_rounds)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          auth.user.id,
          dto.name.trim(),
          dto.description?.trim() || null,
          dto.mode,
          dto.leaderAgentId,
          dto.maxRounds ?? 3,
        ],
      )) as { id: string }[];
      for (const [position, agentId] of members.entries()) {
        await manager.query(
          `INSERT INTO agent_group_members (group_id, agent_id, position) VALUES ($1, $2, $3)`,
          [rows[0]!.id, agentId, position],
        );
      }
      return rows[0]!.id;
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentGroupCreated,
      severity: 'info',
      summary: `Membuat grup agent "${dto.name}" (${dto.mode})`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent_group',
      entityId: id,
      payload: { members: members.length },
    });
    return this.group(auth.user.id, id);
  }

  async updateGroup(
    auth: AuthContext,
    groupId: string,
    dto: AgentGroupDto,
  ): Promise<AgentGroupRow> {
    await this.group(auth.user.id, groupId);
    const members = await this.normalizeMembers(auth.user.id, dto);
    await this.dataSource.transaction(async (manager) => {
      await manager.query(
        `UPDATE agent_groups SET name = $2, description = $3, mode = $4, leader_agent_id = $5, max_rounds = $6,
                updated_at = now() WHERE id = $1`,
        [
          groupId,
          dto.name.trim(),
          dto.description?.trim() || null,
          dto.mode,
          dto.leaderAgentId,
          dto.maxRounds ?? 3,
        ],
      );
      await manager.query(`DELETE FROM agent_group_members WHERE group_id = $1`, [groupId]);
      for (const [position, agentId] of members.entries()) {
        await manager.query(
          `INSERT INTO agent_group_members (group_id, agent_id, position) VALUES ($1, $2, $3)`,
          [groupId, agentId, position],
        );
      }
    });
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentGroupUpdated,
      severity: 'info',
      summary: `Mengubah grup agent ${groupId}`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent_group',
      entityId: groupId,
      payload: {},
    });
    return this.group(auth.user.id, groupId);
  }

  async removeGroup(auth: AuthContext, groupId: string): Promise<void> {
    const group = await this.group(auth.user.id, groupId);
    const deleted = updatedRows<{ id: string }>(
      await this.dataSource.query(
        `DELETE FROM agent_groups WHERE id = $1 AND owner_user_id = $2 RETURNING id`,
        [groupId, auth.user.id],
      ),
    );
    if (deleted.length === 0)
      throw new AppError(ERROR_CODES.notFound, 'Grup tidak ditemukan.', 404);
    await this.audit.record({
      eventKey: AUDIT_EVENTS.agentGroupDeleted,
      severity: 'info',
      summary: `Menghapus grup agent "${group.name}"`,
      actorUserId: auth.user.id,
      actorLabel: auth.user.email,
      actorIp: auth.session.ip,
      entityType: 'agent_group',
      entityId: groupId,
      payload: {},
    });
  }
}
