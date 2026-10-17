import { apiDelete, apiGet, apiGetPaged, apiPatch, apiPost } from '@/api/http';
import type {
  AgentRow,
  AgentTaskDetail,
  AgentTaskRow,
  ApprovalRow,
  DecideResult,
  ExecuteAgentResult,
} from './types';

export function listAgents(query: { page: number; pageSize: number }) {
  return apiGetPaged<AgentRow>('/agents', query);
}

export function agentDetail(id: string): Promise<AgentRow> {
  return apiGet<AgentRow>(`/agents/${id}`);
}

export function createAgent(input: {
  code: string;
  name: string;
  description?: string;
  instruction: string;
  toolAllowlist: string[];
  requireApproval: boolean;
}): Promise<AgentRow> {
  return apiPost<AgentRow>('/agents', input);
}

export function updateAgent(
  id: string,
  input: {
    name?: string;
    description?: string;
    instruction?: string;
    toolAllowlist?: string[];
    requireApproval?: boolean;
    status?: 'active' | 'inactive';
  },
): Promise<AgentRow> {
  return apiPatch<AgentRow>(`/agents/${id}`, input);
}

export function deleteAgent(id: string): Promise<{ deleted: boolean }> {
  return apiDelete<{ deleted: boolean }>(`/agents/${id}`);
}

export function executeAgent(
  id: string,
  input: { instruction: string; title?: string },
): Promise<ExecuteAgentResult> {
  return apiPost<ExecuteAgentResult>(`/agents/${id}/execute`, input);
}

export function listAgentTasks(query: {
  status?: string;
  agentId?: string;
  page: number;
  pageSize: number;
}) {
  return apiGetPaged<AgentTaskRow>('/agents/tasks', query);
}

export function agentTaskDetail(id: string): Promise<AgentTaskDetail> {
  return apiGet<AgentTaskDetail>(`/agents/tasks/${id}`);
}

export function listApprovals(query: { status?: string; page: number; pageSize: number }) {
  return apiGetPaged<ApprovalRow>('/agents/approvals', query);
}

export function decideApproval(
  id: string,
  input: { decision: 'approved' | 'rejected'; note?: string },
): Promise<DecideResult> {
  return apiPost<DecideResult>(`/agents/approvals/${id}/decide`, input);
}

export * from './types';
