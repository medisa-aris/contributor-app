/** Ringkasan Beranda. Setiap bagian hanya dikirim bila pemanggil punya izin yang sesuai. */
export interface DashboardTaskCountsDto {
  queued: number;
  running: number;
  action: number;
  done: number;
  stopped: number;
  total: number;
}

export interface DashboardDocumentCountsDto {
  indexed: number;
  pending: number;
  failed: number;
  sources: number;
}

export interface DashboardAgentCountsDto {
  active: number;
  requiresApproval: number;
  tools: number;
}

export interface DashboardHighlightDto {
  kind: 'taskDone' | 'taskFailed' | 'document';
  title: string;
  at: string;
  routePath: string;
}

export interface DashboardSummaryDto {
  tasks?: DashboardTaskCountsDto;
  documents?: DashboardDocumentCountsDto;
  agents?: DashboardAgentCountsDto;
  approvals?: { pending: number };
  highlights: DashboardHighlightDto[];
}

export type NotificationKind = 'approval' | 'taskAction' | 'taskDone' | 'taskFailed' | 'documentFailed';

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  title: string;
  createdAt: string;
  routePath: string;
}
