import type { ArgusEvent, ArgusRun, ArgusRunTaskDetail, EventKind, EventState, RunStatus } from "../types.ts";
import type { SquadEvent, SquadExecutionHistory, SquadHistoryTask, SquadObservabilityDataSource, SquadTaskRecord } from "./squadObservability.ts";

type JoinConfidence = "confirmed" | "inferred";

interface EventAssociation {
  confidence: JoinConfidence;
  reason: string;
}

interface EventClassification {
  kind: EventKind;
  state: EventState;
  decision: string;
  taskId: string | null;
  agentState: string | null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValues(value: unknown): string[] {
  return Array.isArray(value) ? value.flatMap((item) => stringValue(item) ?? []) : [];
}

function statusState(status: string | null): EventState {
  const normalized = status?.trim().toLowerCase() ?? "";
  if (/(?:completed|complete|success|succeeded|done|idle)/.test(normalized)) return "completed";
  if (/(?:failed|failure|error)/.test(normalized)) return "failed";
  if (/(?:capped|cancelled|canceled)/.test(normalized)) return "capped";
  if (/(?:running|progress|active)/.test(normalized)) return "running";
  if (/(?:planning|plan)/.test(normalized)) return "planning";
  if (/(?:pending|queued|created)/.test(normalized)) return "queued";
  return "unknown";
}

function runStatus(status: string): RunStatus {
  const state = statusState(status);
  return state === "planning" ? "running" : state;
}

function taskKind(state: EventState): EventKind {
  if (state === "completed") return "task.completed";
  if (state === "failed" || state === "capped") return "task.failed";
  if (state === "running") return "task.started";
  if (state === "queued") return "task.created";
  return "unknown";
}

function eventTimestamp(value: string): number | null {
  const parsed = new Date(value).valueOf();
  return Number.isFinite(parsed) ? parsed : null;
}

function executionWindow(execution: SquadExecutionHistory): [number, number] | null {
  const start = eventTimestamp(execution.startedAt);
  if (start == null) return null;
  const completed = execution.completedAt == null ? null : eventTimestamp(execution.completedAt);
  return [start, completed ?? start + execution.durationMs];
}

function associationFor(event: SquadEvent, execution: SquadExecutionHistory, tasks: Map<string, SquadHistoryTask>): EventAssociation | null {
  const payload = event.payload;
  const executionId = stringValue(payload.executionId);
  const taskId = stringValue(payload.taskId);
  if (executionId === execution.executionId && (taskId == null || tasks.has(taskId))) {
    return { confidence: "confirmed", reason: taskId == null ? "execution ID matched" : "execution ID and task ID matched" };
  }
  if (taskId != null && tasks.has(taskId)) return { confidence: "confirmed", reason: "task ID matched" };

  if (event.eventType !== "squad:agent-state-changed") return null;
  const agentId = stringValue(payload.agentId);
  const window = executionWindow(execution);
  const occurredAt = eventTimestamp(event.timestamp);
  const knownAgent = agentId != null && execution.tasks.some((task) => task.agentId === agentId);
  if (knownAgent && window != null && occurredAt != null && occurredAt >= window[0] && occurredAt <= window[1]) {
    return { confidence: "inferred", reason: "agent ID and execution time window matched; the event has no execution or task ID" };
  }
  return null;
}

function waveByTask(events: SquadEvent[], executionId: string): Map<string, number> {
  const waves = new Map<string, number>();
  for (const event of events) {
    if (stringValue(event.payload.executionId) !== executionId) continue;
    if (event.eventType === "squad:plan-ready") {
      const planWaves = Array.isArray(event.payload.waves) ? event.payload.waves : [];
      planWaves.forEach((wave, index) => stringValues(wave).forEach((taskId) => waves.set(taskId, index)));
    }
    if (event.eventType === "squad:task-wave-started") {
      const waveIndex = finiteNumber(event.payload.waveIndex);
      if (waveIndex != null) stringValues(event.payload.taskIds).forEach((taskId) => waves.set(taskId, waveIndex));
    }
  }
  return waves;
}

function classify(event: SquadEvent, history: SquadExecutionHistory, taskId: string | null): EventClassification {
  const payload = event.payload;
  const eventType = event.eventType;
  if (eventType === "squad:planning-started") return { kind: "run.started", state: "planning", decision: "Planning started.", taskId: null, agentState: null };
  if (eventType === "squad:plan-ready") return { kind: "plan.created", state: "completed", decision: "Plan became ready.", taskId: null, agentState: null };
  if (eventType === "squad:execution-started") return { kind: "run.started", state: "running", decision: "Execution started.", taskId: null, agentState: null };
  if (eventType === "squad:task-wave-started") {
    const wave = finiteNumber(payload.waveIndex);
    return { kind: "task.created", state: "queued", decision: wave == null ? "Task wave started." : `Task wave ${wave + 1} started.`, taskId, agentState: null };
  }
  if (eventType === "squad:task-status-changed") {
    const state = statusState(stringValue(payload.newStatus));
    return { kind: taskKind(state), state, decision: `Task status changed to ${stringValue(payload.newStatus) ?? "unknown"}.`, taskId, agentState: null };
  }
  if (eventType === "squad:task-completed") {
    const success = booleanValue(payload.success);
    const state: EventState = success === true ? "completed" : success === false ? "failed" : "unknown";
    return { kind: taskKind(state), state, decision: success === true ? "Task completed." : success === false ? "Task finished with an error." : "Task completion was recorded.", taskId, agentState: null };
  }
  if (eventType === "squad:agent-state-changed") {
    const agentState = stringValue(payload.state);
    return { kind: "unknown", state: statusState(agentState), decision: `Agent state changed to ${agentState ?? "unknown"}.`, taskId: null, agentState };
  }
  if (eventType === "squad:aggregation-started") return { kind: "aggregation.started", state: "running", decision: "Aggregation started.", taskId: null, agentState: null };
  if (eventType === "squad:execution-completed") {
    const state = runStatus(history.status);
    const kind: EventKind = state === "capped" ? "run.capped" : state === "failed" ? "run.failed" : "run.completed";
    return { kind, state, decision: "Execution completion was recorded.", taskId: null, agentState: null };
  }
  if (eventType === "squad:execution-token-usage" || eventType === "squad:token-usage-update") return { kind: "evidence.attached", state: "running", decision: "Token usage update recorded.", taskId, agentState: null };
  return { kind: "unknown", state: "unknown", decision: `${eventType.replace(/^squad:/, "").replaceAll("-", " ")} recorded.`, taskId, agentState: null };
}

function taskMeasurements(task: SquadHistoryTask | undefined, kind: EventKind) {
  if (task == null || (kind !== "task.completed" && kind !== "task.failed")) {
    return { tokens: { input: null, output: null, reasoning: null, cachedInput: null, normalizedCost: null }, durationMs: null };
  }
  return {
    tokens: { input: task.tokenUsage.promptTokens, output: task.tokenUsage.completionTokens, reasoning: null, cachedInput: null, normalizedCost: null },
    durationMs: task.durationMs
  };
}

function firstFailure(history: SquadExecutionHistory) {
  const failedTask = history.tasks.find((task) => statusState(task.status) === "failed" || task.error != null);
  if (failedTask == null && runStatus(history.status) !== "failed" && runStatus(history.status) !== "capped") return null;
  const message = failedTask?.error ?? `Execution recorded status ${history.status}.`;
  const lower = message.toLowerCase();
  const capped = runStatus(history.status) === "capped" || /token.*cap|wall.?clock.*cap/.test(lower);
  const tokenCap = /token.*cap/.test(lower);
  const wallclockCap = /wall.?clock.*cap/.test(lower);
  return {
    itemStatus: capped ? tokenCap ? "capped_tokens" : wallclockCap ? "capped_wallclock" : "unknown" : "error",
    kind: tokenCap ? "token_cap" : wallclockCap ? "wallclock_cap" : /http|api|backend|service/.test(lower) ? "upstream_error" : "unknown",
    owner: capped ? "policy" : "unknown",
    secondaryTags: failedTask == null ? [] : [`TASK:${failedTask.taskId}`],
    message
  } as const;
}

function sourceEvent(event: SquadEvent, execution: SquadExecutionHistory, tasks: Map<string, SquadHistoryTask>, waves: Map<string, number>, association: EventAssociation, taskId: string | null): ArgusEvent {
  const classification = classify(event, execution, taskId);
  const task = classification.taskId == null ? undefined : tasks.get(classification.taskId);
  const measurements = taskMeasurements(task, classification.kind);
  const agentId = classification.agentState == null ? task?.agentId ?? null : stringValue(event.payload.agentId);
  return {
    eventId: `aigo-event:${String(event.id)}${taskId == null ? "" : `:task:${taskId}`}`,
    runId: execution.executionId,
    parentEventId: null,
    track: "unknown",
    wave: classification.taskId == null ? null : waves.get(classification.taskId) ?? null,
    taskId: classification.taskId,
    taskTitle: stringValue(event.payload.taskTitle) ?? task?.title ?? null,
    dependsOnTaskIds: [],
    agentId,
    agentRole: classification.agentState == null ? task?.agentName ?? null : "Agent state",
    model: null,
    kind: classification.kind,
    state: classification.state,
    decision: classification.decision,
    artifactRef: null,
    candidateStatus: classification.state === "completed" ? "observed" : classification.state === "failed" || classification.state === "capped" ? "rejected" : "none",
    tokens: measurements.tokens,
    durationMs: measurements.durationMs,
    timestamp: event.timestamp,
    raw: {
      protocol: "AI:GO native execution event ledger",
      sourceEventId: event.id,
      sourceEventType: event.eventType,
      joinConfidence: association.confidence,
      joinReason: association.reason,
      agentState: classification.agentState
    }
  };
}

function historyOnlyTask(execution: SquadExecutionHistory, task: SquadHistoryTask, wave: number | null): ArgusEvent {
  const state = statusState(task.status);
  const kind = taskKind(state);
  return {
    eventId: `aigo-history:${execution.executionId}:task:${task.taskId}`,
    runId: execution.executionId,
    parentEventId: null,
    track: "unknown",
    wave,
    taskId: task.taskId,
    taskTitle: task.title,
    dependsOnTaskIds: [],
    agentId: task.agentId,
    agentRole: task.agentName,
    model: null,
    kind,
    state,
    decision: "Task status recorded in execution history; no matching task terminal event was found.",
    artifactRef: null,
    candidateStatus: state === "completed" ? "observed" : state === "failed" || state === "capped" ? "rejected" : "none",
    tokens: { input: task.tokenUsage.promptTokens, output: task.tokenUsage.completionTokens, reasoning: null, cachedInput: null, normalizedCost: null },
    durationMs: task.durationMs,
    timestamp: execution.completedAt ?? execution.startedAt,
    raw: {
      protocol: "AI:GO completed history export",
      sourceEventId: null,
      sourceEventType: "history:task",
      joinConfidence: "inferred",
      joinReason: "history exposes task duration and outcome, but no task completion timestamp",
      agentState: null
    }
  };
}

function taskDetail(task: SquadHistoryTask, source: SquadTaskRecord | null = null): ArgusRunTaskDetail {
  return {
    taskId: task.taskId,
    title: source?.detail.title ?? task.title,
    agentId: task.agentId || source?.detail.assignedTo || null,
    agentName: task.agentName || null,
    status: source?.detail.status ?? task.status,
    output: task.output,
    error: task.error ?? source?.detail.error ?? null,
    durationMs: task.durationMs,
    tokens: {
      input: task.tokenUsage.promptTokens,
      output: task.tokenUsage.completionTokens
    },
    priority: source?.detail.priority ?? null,
    description: source?.detail.description ?? null,
    createdBy: source?.detail.createdBy ?? null,
    dependsOnTaskIds: source?.detail.dependsOn ?? [],
    artifacts: source?.detail.artifacts ?? [],
    result: source?.detail.result ?? null,
    retryCount: source?.detail.retryCount ?? null,
    maxRetries: source?.detail.maxRetries ?? null,
    startedAt: source?.detail.startedAt ?? null,
    completedAt: source?.detail.completedAt ?? null,
    markdown: source?.markdown ?? null
  };
}

/**
 * Projects one persisted AI:GO execution into the UI trace contract. Source
 * events retain their original type, while only exact execution/task joins are
 * marked confirmed. Agent-only correlations stay visibly inferred.
 */
export function argusRunFromExecution(execution: SquadExecutionHistory, events: SquadEvent[]): ArgusRun {
  const tasks = new Map(execution.tasks.map((task) => [task.taskId, task]));
  const waves = waveByTask(events, execution.executionId);
  const eventRows: ArgusEvent[] = [];
  const terminalTaskIds = new Set<string>();

  for (const event of events) {
    const association = associationFor(event, execution, tasks);
    if (association == null) continue;
    const associatedTaskIds = event.eventType === "squad:task-wave-started"
      ? stringValues(event.payload.taskIds).filter((taskId) => tasks.has(taskId))
      : [stringValue(event.payload.taskId)].filter((taskId): taskId is string => taskId != null && tasks.has(taskId));
    const taskIds = associatedTaskIds.length > 0 ? associatedTaskIds : [null];
    for (const taskId of taskIds) {
      const row = sourceEvent(event, execution, tasks, waves, association, taskId);
      if ((row.kind === "task.completed" || row.kind === "task.failed") && row.taskId != null) terminalTaskIds.add(row.taskId);
      eventRows.push(row);
    }
  }

  for (const task of execution.tasks) {
    if (!terminalTaskIds.has(task.taskId)) eventRows.push(historyOnlyTask(execution, task, waves.get(task.taskId) ?? null));
  }

  const ordered = eventRows.sort((left, right) => new Date(left.timestamp).valueOf() - new Date(right.timestamp).valueOf() || left.eventId.localeCompare(right.eventId));
  const status = runStatus(execution.status);
  return {
    runId: execution.executionId,
    portalRunId: null,
    source: "aigo",
    track: "unknown",
    dataset: null,
    itemId: null,
    status,
    score: null,
    finalAnswer: execution.finalResult,
    outcome: status === "capped" ? "capped" : "unknown",
    failure: firstFailure(execution),
    caps: { runTokens: null, itemWallclockSeconds: null, usedTokens: execution.totalTokenUsage.promptTokens + execution.totalTokenUsage.completionTokens, elapsedMs: execution.durationMs },
    totals: { input: execution.totalTokenUsage.promptTokens, output: execution.totalTokenUsage.completionTokens, reasoning: null, cachedInput: null, normalizedCost: null, latencyMs: execution.durationMs },
    modelUsage: [],
    hashes: { dataset: null, squadConfig: null, submissionJson: null, prompt: null },
    compliance: { userToolsZero: null, plannerNativeProtocol: null, memoryOff: null, hashesPresent: null, outputContract: null, fallbackFree: null },
    events: ordered,
    detail: {
      executionId: execution.executionId,
      squadId: execution.squadId,
      squadName: execution.squadName,
      request: execution.request,
      planTitle: execution.planTitle,
      startedAt: execution.startedAt,
      completedAt: execution.completedAt,
      tasks: execution.tasks.map((task) => taskDetail(task)),
      console: [],
      reportMarkdown: null
    },
    rawEvidenceRefs: [`aigo://workspace/logs/history.json#${execution.executionId}`, `aigo://workspace/logs/events.jsonl#${execution.executionId}`],
    importedAt: execution.completedAt ?? execution.startedAt
  };
}

/** Reads source records through the boundary and keeps their joins auditable. */
export async function argusRunsFromDataSource(source: SquadObservabilityDataSource): Promise<ArgusRun[]> {
  const [history, events] = await Promise.all([source.listExecutionHistory(), source.listEvents()]);
  const taskIds = [...new Set(history.flatMap((execution) => execution.tasks.map((task) => task.taskId)))];
  const taskRecords = new Map(await Promise.all(taskIds.map(async (taskId) => [taskId, await source.getSquadTask(taskId)] as const)));
  return Promise.all(history.map(async (execution) => {
    const run = argusRunFromExecution(execution, events);
    const [consoleEntries, reportMarkdown] = await Promise.all([
      source.getExecutionLog(execution.executionId),
      source.getExecutionReport(execution.executionId)
    ]);
    run.detail = {
      ...run.detail!,
      tasks: execution.tasks.map((task) => taskDetail(task, taskRecords.get(task.taskId) ?? null)),
      console: consoleEntries,
      reportMarkdown
    };
    run.rawEvidenceRefs = [
      ...run.rawEvidenceRefs,
      ...(consoleEntries.length > 0 ? [`aigo://workspace/logs/${execution.executionId}.jsonl`] : []),
      ...(reportMarkdown == null ? [] : [`aigo://workspace/artifacts/reports/${execution.executionId}-report.md`]),
      ...execution.tasks.filter((task) => taskRecords.get(task.taskId) != null).map((task) => `aigo://workspace/tasks/${task.taskId}`)
    ];
    return run;
  }));
}
