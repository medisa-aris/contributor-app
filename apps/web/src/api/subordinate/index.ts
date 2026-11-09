import type { AiTaskStatus } from '@bara/shared';
import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from '@/api/http';
import type { TaskEventRow, TaskRow } from '@/api/ai/types';
import type { ConnectorAccess, ConnectorAttachment, ConnectorType } from '@/api/connectors/types';

export type AgentConnector = ConnectorAttachment & { name: string; engine: string; granted: boolean };

export interface PersonalAgent {
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
  connectors: AgentConnector[];
}

export interface PersonalAgentInput {
  name?: string;
  description?: string;
  avatarColor?: string;
  responsibilities?: string;
  instruction?: string;
  boundaries?: string;
  memory?: string;
  status?: 'active' | 'inactive';
  skillIds?: string[];
  connectors?: { connectorType: ConnectorType; connectorId: string; access: ConnectorAccess }[];
}

export interface AgentTemplate {
  id: string;
  code: string;
  name: string;
  description: string | null;
  instruction: string;
}

export interface Skill {
  id: string;
  name: string;
  description: string;
  instructions: string;
  is_global: boolean;
  agent_count: number;
  created_at: string;
  updated_at: string;
}

export type GroupMode = 'delegate' | 'discussion';

export interface AgentGroup {
  id: string;
  name: string;
  description: string | null;
  mode: GroupMode;
  leader_agent_id: string;
  max_rounds: number;
  members: { id: string; name: string; avatar_color: string | null; position: number }[];
  task_count: number;
  created_at: string;
  updated_at: string;
}

export interface AgentGroupInput {
  name: string;
  description?: string;
  mode: GroupMode;
  leaderAgentId: string;
  memberAgentIds: string[];
  maxRounds?: number;
}

export type AgentTaskRow = TaskRow & {
  agent_id: string | null;
  group_id: string | null;
  parent_task_id: string | null;
  agent_name: string | null;
  agent_color: string | null;
  group_name: string | null;
  group_mode: GroupMode | null;
};

export type AgentTaskDetail = AgentTaskRow & {
  events: TaskEventRow[];
  children: AgentTaskRow[];
};

export const FINAL_STATUSES: readonly AiTaskStatus[] = ['completed', 'failed', 'cancelled'];

export function listAgents(): Promise<PersonalAgent[]> {
  return apiGet<PersonalAgent[]>('/ai/agents');
}

export function listAgentTemplates(): Promise<AgentTemplate[]> {
  return apiGet<AgentTemplate[]>('/ai/agent-templates');
}

export function createAgent(input: PersonalAgentInput): Promise<PersonalAgent> {
  return apiPost<PersonalAgent>('/ai/agents', input);
}

export function createAgentFromTemplate(templateId: string, name?: string): Promise<PersonalAgent> {
  return apiPost<PersonalAgent>('/ai/agents/from-template', { templateId, ...(name ? { name } : {}) });
}

export function updateAgent(id: string, input: PersonalAgentInput): Promise<PersonalAgent> {
  return apiPatch<PersonalAgent>(`/ai/agents/${id}`, input);
}

export function deleteAgent(id: string): Promise<void> {
  return apiDelete<void>(`/ai/agents/${id}`);
}

export function listSkills(): Promise<Skill[]> {
  return apiGet<Skill[]>('/ai/skills');
}

export function createSkill(input: { name: string; description: string; instructions: string }): Promise<Skill> {
  return apiPost<Skill>('/ai/skills', input);
}

export function updateSkill(
  id: string,
  input: { name?: string; description?: string; instructions?: string },
): Promise<Skill> {
  return apiPatch<Skill>(`/ai/skills/${id}`, input);
}

export function deleteSkill(id: string): Promise<void> {
  return apiDelete<void>(`/ai/skills/${id}`);
}

export function listGroups(): Promise<AgentGroup[]> {
  return apiGet<AgentGroup[]>('/ai/agent-groups');
}

export function createGroup(input: AgentGroupInput): Promise<AgentGroup> {
  return apiPost<AgentGroup>('/ai/agent-groups', input);
}

export function updateGroup(id: string, input: AgentGroupInput): Promise<AgentGroup> {
  return apiPut<AgentGroup>(`/ai/agent-groups/${id}`, input);
}

export function deleteGroup(id: string): Promise<void> {
  return apiDelete<void>(`/ai/agent-groups/${id}`);
}

export function createAgentTask(input: {
  instruction: string;
  title?: string;
  agentId?: string;
  groupId?: string;
  webSearch?: boolean;
}): Promise<AgentTaskRow> {
  return apiPost<AgentTaskRow>('/ai/agent-tasks', input);
}

export function agentTaskDetail(id: string, afterEventId = 0): Promise<AgentTaskDetail> {
  return apiGet<AgentTaskDetail>(`/ai/agent-tasks/${id}`, afterEventId ? { afterEventId } : undefined);
}

export function replyAgentTask(id: string, message: string): Promise<AgentTaskRow> {
  return apiPost<AgentTaskRow>(`/ai/agent-tasks/${id}/reply`, { message });
}

export function retryAgentTask(id: string): Promise<AgentTaskRow> {
  return apiPost<AgentTaskRow>(`/ai/agent-tasks/${id}/retry`);
}

export function cancelAgentTask(id: string): Promise<AgentTaskRow> {
  return apiPost<AgentTaskRow>(`/ai/agent-tasks/${id}/cancel`);
}

export function decideAgentTaskApproval(
  taskId: string,
  approvalId: string,
  decision: 'approved' | 'rejected',
  note?: string,
): Promise<AgentTaskRow> {
  return apiPost<AgentTaskRow>(`/ai/agent-tasks/${taskId}/tool-approvals/${approvalId}/decide`, {
    decision,
    ...(note ? { note } : {}),
  });
}
