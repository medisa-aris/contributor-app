import type { TaskEventRow, TaskRow } from '@/api/ai';

export type AgentRow = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  instruction: string;
  tool_allowlist: string[];
  require_approval: boolean;
  status: 'active' | 'inactive';
  task_count: number | null;
  created_at: string;
  updated_at: string;
};

export type AgentTaskRow = TaskRow & {
  agent_name: string | null;
  requester_email: string | null;
};

export type AgentTaskDetail = TaskRow & {
  events: TaskEventRow[];
  approval: ApprovalRow | null;
};

export type ApprovalRow = {
  id: string;
  task_id: string;
  agent_id: string | null;
  agent_name: string | null;
  requester_id: string;
  requester_email: string | null;
  summary: string;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_by_email: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
};

export type ExecuteAgentResult = {
  task: TaskRow;
  approvalId: string | null;
};

export type DecideResult = {
  approval: ApprovalRow;
  task: TaskRow | null;
};
