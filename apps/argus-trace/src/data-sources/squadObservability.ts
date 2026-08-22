export interface SquadTokenUsage {
  promptTokens: number;
  completionTokens: number;
}

export interface SquadIdentity {
  appVersion: string;
  initializedAt: string | null;
  squadId: string;
  squadName: string;
}

export interface SquadWorkspaceStatus extends SquadIdentity {
  ready: boolean;
  requiredFiles: Array<{ path: string; available: boolean }>;
}

export interface SquadHistoryTask {
  taskId: string;
  title: string;
  agentId: string;
  agentName: string;
  status: string;
  output: string | null;
  error: string | null;
  durationMs: number;
  tokenUsage: SquadTokenUsage;
}

export interface SquadExecutionHistory {
  executionId: string;
  squadId: string;
  squadName: string;
  request: string;
  planTitle: string;
  tasks: SquadHistoryTask[];
  finalResult: string | null;
  status: string;
  totalTokenUsage: SquadTokenUsage;
  perAgentTokenUsage: Record<string, SquadTokenUsage>;
  durationMs: number;
  artifacts: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface SquadExecutionIndexEntry {
  executionId: string;
  squadId: string;
  startedAt: string;
  lastUpdatedAt: string;
  entryCount: number;
}

export interface SquadEvent {
  /** AI:GO 1.12.1 persists this event key as an integer. */
  id: string | number;
  eventType: string;
  timestamp: string;
  squadId: string;
  payload: Record<string, unknown>;
}

export interface SquadConsoleEntry {
  timestamp: string;
  level: string;
  agentId: string;
  message: string;
}

export interface SquadTaskSummary {
  id: string;
  squadId: string;
  planId: string | null;
  title: string;
  status: string;
  priority: string | null;
  assignedTo: string | null;
  dependsOn: string[];
  createdAt: string | null;
  completedAt: string | null;
}

export interface SquadTaskDetail extends SquadTaskSummary {
  description: string | null;
  createdBy: string | null;
  result: string | null;
  error: string | null;
  artifacts: string[];
  tokenUsage: number | null;
  retryCount: number | null;
  maxRetries: number | null;
  startedAt: string | null;
}

export interface SquadTaskRecord {
  summary: SquadTaskSummary;
  detail: SquadTaskDetail;
  markdown: string | null;
}

export interface SquadTaskGraph {
  squadId: string;
  nodes: SquadTaskSummary[];
  edges: Array<{ fromTaskId: string; toTaskId: string }>;
}

export interface SquadTaskCounts {
  squadId: string;
  total: number;
  byStatus: Record<string, number>;
}

export interface SquadAnalytics {
  executionCount: number;
  executionStatusCounts: Record<string, number>;
  taskCount: number;
  taskStatusCounts: Record<string, number>;
  totalDurationMs: number;
  totalTokenUsage: SquadTokenUsage;
  perAgentTokenUsage: Record<string, SquadTokenUsage>;
}

export interface SquadTaskQuery {
  squadId?: string;
  statuses?: string[];
}

/**
 * The source boundary shared by the fixture-only web build and the Tauri app.
 * UI code should consume this interface, never a filesystem path or a transport.
 */
export interface SquadObservabilityDataSource {
  getWorkspaceStatus(): Promise<SquadWorkspaceStatus>;
  listExecutionHistory(): Promise<SquadExecutionHistory[]>;
  listExecutionIndex(): Promise<SquadExecutionIndexEntry[]>;
  listEvents(): Promise<SquadEvent[]>;
  getExecutionLog(executionId: string): Promise<SquadConsoleEntry[]>;
  getExecutionReport(executionId: string): Promise<string | null>;
  getSquadAnalytics(): Promise<SquadAnalytics>;
  listSquadTasks(query?: SquadTaskQuery): Promise<SquadTaskSummary[]>;
  getSquadTask(taskId: string): Promise<SquadTaskRecord | null>;
  getSquadTaskGraph(squadId?: string): Promise<SquadTaskGraph>;
  listAllSquadTaskCounts(): Promise<SquadTaskCounts[]>;
  listWorkspaceFiles(relativePath?: string): Promise<string[]>;
  readWorkspaceFile(relativePath: string): Promise<string>;
}
