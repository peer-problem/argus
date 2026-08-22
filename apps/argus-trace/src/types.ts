export type Track = "coding" | "math" | "generic" | "unknown";
export type RunStatus = "queued" | "running" | "completed" | "failed" | "capped" | "unknown";
export type EventState = "queued" | "planning" | "running" | "completed" | "failed" | "capped" | "unknown";

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
  input: number;
  output: number;
  reasoning: number;
  cachedInput: number;
  normalizedCost: number;
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
  durationMs: number;
  timestamp: string;
  raw?: Record<string, unknown> | null;
}

export interface ModelUsage extends TokenUsage {
  model: string;
  calls: number;
  latencyMs: number;
}

export interface ArgusRun {
  runId: string;
  portalRunId?: string | null;
  source: "portal" | "aigo" | "merged" | "demo";
  track: Track;
  dataset: string;
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
    usedTokens: number;
    elapsedMs: number;
  };
  totals: TokenUsage & { latencyMs: number };
  modelUsage: ModelUsage[];
  hashes: Record<string, string | null>;
  compliance: Record<string, boolean | null>;
  events: ArgusEvent[];
  rawEvidenceRefs: string[];
  importedAt: string;
}
