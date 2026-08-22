export type Track = "coding" | "math" | "generic" | "unknown";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "capped" | "unknown";
export type EventState = "queued" | "planning" | "running" | "completed" | "failed" | "capped" | "unknown";
/** `null` means the source did not collect this measurement; it is never a stand-in for zero. */
export type ObservedNumber = number | null;

export type EventKind =
  | "run.created"
  | "run.started"
  | "plan.created"
  | "task.created"
  | "task.assigned"
  | "task.started"
  | "task.completed"
  | "task.failed"
  | "aggregation.started"
  | "aggregation.completed"
  | "run.capped"
  | "run.failed"
  | "run.completed"
  | "evidence.attached"
  | "unknown";

export interface TokenUsage {
  input: ObservedNumber;
  output: ObservedNumber;
  reasoning: ObservedNumber;
  cachedInput: ObservedNumber;
  normalizedCost: ObservedNumber;
}

export interface ArgusEvent {
  eventId: string;
  runId: string;
  parentEventId?: string | null;
  track: Track;
  wave?: number | null;
  taskId?: string | null;
  taskTitle?: string | null;
  dependsOnTaskIds?: string[];
  agentId?: string | null;
  agentRole?: string | null;
  model?: string | null;
  kind: EventKind;
  state: EventState;
  decision: string;
  artifactRef?: string | null;
  candidateStatus?: "selected" | "rejected" | "observed" | "none";
  tokens: TokenUsage;
  durationMs: ObservedNumber;
  squadConfigHash?: string | null;
  submissionJsonHash?: string | null;
  promptHash?: string | null;
  timestamp: string;
  raw?: Record<string, unknown> | null;
}

export interface ModelUsage extends TokenUsage {
  model: string;
  calls: ObservedNumber;
  latencyMs: ObservedNumber;
  contextWindowTokens?: number | null;
}

export interface ArgusRunTaskDetail {
  taskId: string;
  title: string;
  agentId: string | null;
  agentName: string | null;
  status: string;
  output: string | null;
  error: string | null;
  durationMs: ObservedNumber;
  tokens: Pick<TokenUsage, "input" | "output">;
  priority: string | null;
  description: string | null;
  createdBy: string | null;
  dependsOnTaskIds: string[];
  artifacts: string[];
  result: string | null;
  retryCount: ObservedNumber;
  maxRetries: ObservedNumber;
  startedAt: string | null;
  completedAt: string | null;
  markdown: string | null;
}

export interface ArgusRunConsoleEntry {
  timestamp: string;
  level: string;
  agentId: string;
  message: string;
}

export interface ArgusRunDetail {
  executionId: string;
  squadId: string | null;
  squadName: string | null;
  request: string | null;
  planTitle: string | null;
  startedAt: string;
  completedAt: string | null;
  tasks: ArgusRunTaskDetail[];
  console: ArgusRunConsoleEntry[];
  reportMarkdown: string | null;
}

export interface ArgusRun {
  runId: string;
  portalRunId?: string | null;
  source: "portal" | "aigo" | "merged" | "demo";
  track: Track;
  dataset: string | null;
  itemId?: string | null;
  status: RunStatus;
  score: number | null;
  finalAnswer: string | null;
  outcome: "graded" | "extraction_failed" | "capped" | "grader_error" | "infrastructure_failed" | "unknown";
  failure: {
    itemStatus: "ok" | "capped_tokens" | "capped_wallclock" | "error" | "unknown";
    kind: "infrastructure" | "upstream_error" | "token_cap" | "wallclock_cap" | "runner" | "unknown";
    owner: "team" | "policy" | "configuration" | "organizer" | "unknown";
    secondaryTags: string[];
    message: string;
  } | null;
  caps: {
    runTokens: number | null;
    itemWallclockSeconds: number | null;
    usedTokens: ObservedNumber;
    elapsedMs: ObservedNumber;
  };
  totals: TokenUsage & { latencyMs: ObservedNumber };
  modelUsage: ModelUsage[];
  hashes: Record<string, string | null>;
  compliance: Record<string, boolean | null>;
  events: ArgusEvent[];
  detail?: ArgusRunDetail | null;
  rawEvidenceRefs: string[];
  importedAt: string;
}

export type ArgusEvidenceSource = "aigo" | "portal" | "argus";

export interface ArgusEvidenceRecord {
  evidenceId: string;
  source: ArgusEvidenceSource;
  protocol: string;
  emittedAt?: string | null;
  receivedAt: string;
  fields: string[];
  reference: string;
}

export interface ArgusEvidenceLink {
  linkId: string;
  fromEvidenceId: string;
  toEvidenceId: string;
  relation: "same_evaluated_item" | "same_execution" | "derived_view";
  linkedAt: string;
}

export interface ArgusBatchSettings {
  maxConcurrentTasks: number | null;
  maxTasks: number | null;
  taskTimeoutSeconds: number | null;
  directRequestByteLimit: number | null;
}

export interface ArgusBatchItem {
  itemKey: string;
  trace: ArgusRun;
  evidence: ArgusEvidenceRecord[];
  links: ArgusEvidenceLink[];
}

export interface ArgusBatch {
  batchId: string;
  name: string;
  source: "demo" | "imported";
  settings: ArgusBatchSettings;
  items: ArgusBatchItem[];
  createdAt: string;
  completedAt: string | null;
}

export interface PortalModelUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  requests: number;
  totalTokens: number;
}

export interface PortalTrackResult {
  track: Exclude<Track, "unknown">;
  accuracy: number;
  graded: number;
  items: number;
  excluded: number;
  weight: number;
}

export interface PortalBatchRunReport {
  reportId: string;
  source: "portal";
  team: string;
  runName: string;
  status: RunStatus;
  score: number;
  scoredItems: number;
  totalItems: number;
  executionTimeMs: number;
  tokens: {
    input: number;
    output: number;
    total: number;
  };
  caps: {
    wallClockSeconds: number | null;
    tokenLimit: number | null;
  };
  postedAt: string;
  modelUsage: PortalModelUsage[];
  trackResults: PortalTrackResult[];
  evidence: {
    protocol: "Run-details JSON export" | "Portal run detail capture";
    receivedAt: string | null;
    reference: string;
  };
}
