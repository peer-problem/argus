import { detectFallbackSignatures } from "./compliance.ts";
import { normalizedCost, summarizeModelUsage } from "./metrics.ts";
import { lintOutput } from "./output.ts";
import type { ArgusEvent, ArgusRun, EventKind, EventState, ModelUsage, RunStatus, Track } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map((entry) => {
    const source = record(entry);
    return string(pick(source, "task_id", "taskId", "id") ?? entry).trim();
  }).filter(Boolean))];
}

function string(value: unknown, fallback = ""): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function nullableString(value: unknown): string | null {
  const result = string(value);
  return result ? result : null;
}

function number(value: unknown, fallback = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pick(source: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) if (source[key] !== undefined && source[key] !== null) return source[key];
  return undefined;
}

function nested(source: UnknownRecord, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => record(value)[key], source);
}

function pickNested(source: UnknownRecord, ...paths: string[]): unknown {
  for (const path of paths) {
    const value = nested(source, path);
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function iso(value: unknown, fallback: string): string {
  const candidate = string(value);
  const date = candidate ? new Date(candidate) : new Date(Number.NaN);
  return Number.isNaN(date.valueOf()) ? fallback : date.toISOString();
}

export function normalizeTrack(value: unknown): Track {
  const lower = string(value).toLowerCase();
  if (lower.includes("cod")) return "coding";
  if (lower.includes("math") || lower.includes("aime")) return "math";
  if (lower.includes("generic") || lower.includes("mmlu")) return "generic";
  return "unknown";
}

function normalizeStatus(value: unknown): RunStatus {
  const lower = string(value).toLowerCase();
  if (/complete|success|graded|ok/.test(lower)) return "completed";
  if (/cap|limit/.test(lower)) return "capped";
  if (/fail|error/.test(lower)) return "failed";
  if (/run|progress|execut/.test(lower)) return "running";
  if (/queue|pending|created/.test(lower)) return "queued";
  return "unknown";
}

function normalizeEventState(value: unknown): EventState {
  const status = normalizeStatus(value);
  if (status === "queued" || status === "running" || status === "completed" || status === "failed" || status === "capped") return status;
  if (string(value).toLowerCase().includes("plan")) return "planning";
  return "unknown";
}

function eventKind(value: unknown): EventKind {
  const lower = string(value).toLowerCase().replace(/[ _]/g, ".");
  const mappings: Array<[RegExp, EventKind]> = [
    [/plan.*creat|plan.*produc/, "plan.created"],
    [/task.*creat/, "task.created"],
    [/task.*assign/, "task.assigned"],
    [/task.*start/, "task.started"],
    [/task.*complet|task.*success/, "task.completed"],
    [/task.*fail/, "task.failed"],
    [/aggregat.*start/, "aggregation.started"],
    [/aggregat.*complet|final.*answer/, "aggregation.completed"],
    [/run.*start|execution.*start/, "run.started"],
    [/run.*cap|token.*cap|wallclock.*cap/, "run.capped"],
    [/run.*fail|execution.*fail/, "run.failed"],
    [/run.*complet|execution.*complet/, "run.completed"],
    [/run.*creat/, "run.created"]
  ];
  return mappings.find(([regex]) => regex.test(lower))?.[1] ?? "unknown";
}

function usageFrom(value: unknown, runKind: "test" | "submission" = "test", fallbackModel = "unknown"): ModelUsage {
  const source = record(value);
  const model = string(pick(source, "model", "model_id", "modelId", "name"), fallbackModel);
  const input = number(pick(source, "input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"));
  const output = number(pick(source, "output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"));
  const reasoning = number(pick(source, "reasoning", "reasoning_tokens", "reasoningTokens"));
  const cachedInput = number(pick(source, "cached_input", "cached_input_tokens", "cachedInputTokens", "cachedTokens"));
  const inferredCost = model.startsWith("unattributed-") ? 0 : normalizedCost(model, { input, output, reasoning }, runKind);
  return {
    model,
    calls: number(pick(source, "calls", "call_count", "callCount"), 1),
    input,
    output,
    reasoning,
    cachedInput,
    normalizedCost: number(pick(source, "normalized_cost", "normalizedCost"), inferredCost),
    latencyMs: number(pick(source, "latency_ms", "latencyMs", "duration_ms", "durationMs"))
  };
}

function modelUsageFrom(source: UnknownRecord, runKind: "test" | "submission"): ModelUsage[] {
  const candidate = pickNested(source, "modelUsage", "model_usage", "model_breakdown", "modelBreakdown", "usage.by_model", "usage.byModel", "breakdown.models");
  if (Array.isArray(candidate)) return candidate.map((entry) => usageFrom(entry, runKind)).filter((usage) => usage.model !== "unknown");
  if (typeof candidate === "object" && candidate !== null) return Object.entries(candidate as UnknownRecord).map(([model, value]) => usageFrom(value, runKind, model));
  const singleUsage = usageFrom(pickNested(source, "usage", "tokens", "token_usage", "totalTokenUsage") ?? source, runKind, string(pick(source, "model", "model_id", "modelId"), "unattributed-ai-go"));
  return singleUsage.input + singleUsage.output + singleUsage.reasoning > 0 ? [singleUsage] : [];
}

function normalizeRawEvent(rawValue: unknown, context: { runId: string; track: Track; index: number; fallbackTimestamp: string; runKind: "test" | "submission" }): ArgusEvent {
  const raw = record(rawValue);
  const usage = usageFrom(pick(raw, "tokens", "usage", "token_usage") ?? raw, context.runKind, string(pick(raw, "model", "model_id", "modelId"), "unknown"));
  const kind = eventKind(pick(raw, "kind", "type", "event", "event_type", "eventType", "name"));
  return {
    eventId: string(pick(raw, "eventId", "event_id", "id"), `evt-${String(context.index + 1).padStart(6, "0")}`),
    runId: context.runId,
    parentEventId: nullableString(pick(raw, "parentEventId", "parent_event_id", "parentId", "parent_id")),
    track: context.track,
    wave: pick(raw, "wave", "wave_index", "waveIndex") == null ? null : number(pick(raw, "wave", "wave_index", "waveIndex")),
    taskId: nullableString(pick(raw, "taskId", "task_id", "task")),
    taskTitle: nullableString(pick(raw, "taskTitle", "task_title", "title")),
    dependsOnTaskIds: stringArray(pick(raw, "dependsOnTaskIds", "depends_on_task_ids", "dependsOn", "depends_on", "dependencies")),
    agentId: nullableString(pick(raw, "agentName", "agent_name", "agent_id", "agentId", "agent")),
    agentRole: nullableString(pick(raw, "agentRole", "agent_role", "role")),
    model: usage.model === "unknown" ? null : usage.model,
    kind,
    state: normalizeEventState(pick(raw, "state", "status", "phase", "kind", "type")),
    decision: string(pick(raw, "decision", "summary", "message", "description", "result"), kind === "unknown" ? "Unclassified source event" : kind.replaceAll(".", " ")),
    artifactRef: nullableString(pick(raw, "artifactRef", "artifact_ref", "output_ref", "outputRef")),
    candidateStatus: "observed",
    tokens: { input: usage.input, output: usage.output, reasoning: usage.reasoning, cachedInput: usage.cachedInput, normalizedCost: usage.normalizedCost },
    durationMs: usage.latencyMs,
    squadConfigHash: nullableString(pick(raw, "squadConfigHash", "squad_config_hash")),
    submissionJsonHash: nullableString(pick(raw, "submissionJsonHash", "submission_json_hash")),
    promptHash: nullableString(pick(raw, "promptHash", "prompt_hash")),
    timestamp: iso(pick(raw, "timestamp", "created_at", "createdAt", "time"), context.fallbackTimestamp),
    raw
  };
}

function synthesizeTaskEvents(source: UnknownRecord, context: { runId: string; track: Track; fallbackTimestamp: string; runKind: "test" | "submission" }): ArgusEvent[] {
  const tasks = array(pickNested(source, "tasks", "task_breakdown", "taskBreakdown", "details.tasks", "plan.tasks"));
  return tasks.flatMap((taskValue, taskIndex) => {
    const task = record(taskValue);
    const baseIndex = taskIndex * 2;
    const created = normalizeRawEvent({
      ...task,
      id: `evt-task-${taskIndex + 1}-created`,
      type: "task.created",
      status: "queued",
      message: string(pick(task, "title", "name", "description"), `Task ${taskIndex + 1} created`),
      task_id: pick(task, "task_id", "taskId", "id"),
      agent_id: pick(task, "agentName", "agent_name", "agent_id", "agentId", "agent", "assigned_agent"),
      timestamp: pick(task, "created_at", "createdAt", "started_at", "startedAt")
    }, { ...context, index: baseIndex });
    const terminal = normalizeRawEvent({
      ...task,
      id: `evt-task-${taskIndex + 1}-terminal`,
      type: normalizeStatus(pick(task, "status", "state")) === "failed" ? "task.failed" : "task.completed",
      message: string(pick(task, "decision", "summary", "result", "output"), `Task ${taskIndex + 1} ${string(pick(task, "status", "state"), "completed")}`),
      task_id: pick(task, "task_id", "taskId", "id"),
      agent_id: pick(task, "agentName", "agent_name", "agent_id", "agentId", "agent", "assigned_agent"),
      timestamp: pick(task, "completed_at", "completedAt", "ended_at", "endedAt")
    }, { ...context, index: baseIndex + 1 });
    return [created, terminal];
  });
}

function failureFrom(source: UnknownRecord, rawText: string): ArgusRun["failure"] {
  const status = string(pickNested(source, "item_status", "itemStatus", "failure.itemStatus", "diagnosis.item_status"), "unknown").toLowerCase();
  const kind = string(pickNested(source, "failure_kind", "failureKind", "failure.kind", "diagnosis.kind"), "unknown").toLowerCase();
  const owner = string(pickNested(source, "failure_owner", "failureOwner", "failure.owner", "diagnosis.owner"), "unknown").toLowerCase();
  const message = string(pickNested(source, "failure_message", "failureMessage", "failure.message", "diagnosis.message", "error"));
  const tags = detectFallbackSignatures(rawText).map(() => "FALLBACK_FANOUT");
  const hasFailure = status !== "unknown" || kind !== "unknown" || owner !== "unknown" || Boolean(message) || tags.length > 0;
  if (!hasFailure) return null;
  const itemStatus = (["ok", "capped_tokens", "capped_wallclock", "error"] as const).find((entry) => entry === status) ?? "unknown";
  const failureKind = (["infrastructure", "upstream_error", "token_cap", "wallclock_cap", "runner"] as const).find((entry) => entry === kind) ?? "unknown";
  const failureOwner = (["team", "policy", "configuration", "organizer"] as const).find((entry) => entry === owner) ?? "unknown";
  return { itemStatus, kind: failureKind, owner: failureOwner, secondaryTags: [...new Set(tags)], message };
}

function outcomeFrom(source: UnknownRecord, status: RunStatus, sourceType: "portal" | "aigo"): ArgusRun["outcome"] {
  const value = string(pick(source, "outcome", "result_status", "resultStatus")).toLowerCase();
  const options: ArgusRun["outcome"][] = ["graded", "extraction_failed", "capped", "grader_error", "infrastructure_failed"];
  if (options.includes(value as ArgusRun["outcome"])) return value as ArgusRun["outcome"];
  if (sourceType === "aigo") return "unknown";
  if (status === "completed") return "graded";
  if (status === "capped") return "capped";
  return "unknown";
}

function normalizeRun(rawValue: unknown, sourceType: "portal" | "aigo", sourceRef: string): ArgusRun {
  const source = record(rawValue);
  const now = new Date().toISOString();
  const runId = string(pick(source, "runId", "run_id", "id", "execution_id", "executionId"), `argus-${sourceType}-${Date.now()}`);
  const track = normalizeTrack(pick(source, "track", "category", "benchmark", "dataset", "request"));
  const status = normalizeStatus(pick(source, "status", "state", "outcome"));
  const runKind = string(pick(source, "run_kind", "runKind", "kind", "mode"), "test").toLowerCase().includes("submission") ? "submission" : "test";
  const sourceElapsedMs = number(pickNested(source, "caps.elapsedMs", "elapsed_ms", "elapsedMs", "duration_ms", "durationMs"));
  let modelUsage = modelUsageFrom(source, runKind);
  if (sourceElapsedMs > 0 && modelUsage.length === 1 && modelUsage[0]!.model.startsWith("unattributed-") && modelUsage[0]!.latencyMs === 0) {
    modelUsage = [{ ...modelUsage[0]!, latencyMs: sourceElapsedMs }];
  }
  const totals = summarizeModelUsage(modelUsage);
  const elapsedMs = sourceElapsedMs || totals.latencyMs;
  const rawEvents = array(pickNested(source, "events", "activity", "timeline", "details.events"));
  let events = rawEvents.map((event, index) => normalizeRawEvent(event, { runId, track, index, fallbackTimestamp: now, runKind }));
  if (events.length === 0) events = synthesizeTaskEvents(source, { runId, track, fallbackTimestamp: now, runKind });
  events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const rawText = JSON.stringify(source);
  const failure = failureFrom(source, rawText);
  const capTokens = pickNested(source, "caps.per_run_token_cap", "caps.runTokens", "per_run_token_cap", "perRunTokenCap");
  const wallclock = pickNested(source, "caps.per_item_wallclock_seconds", "caps.itemWallclockSeconds", "per_item_wallclock_seconds", "perItemWallclockSeconds");
  const datasetHash = nullableString(pickNested(source, "hashes.dataset", "dataset_hash", "datasetHash"));
  const squadConfigHash = nullableString(pickNested(source, "hashes.squadConfig", "squad_config_hash", "squadConfigHash"));
  const submissionJsonHash = nullableString(pickNested(source, "hashes.submissionJson", "submission_json_hash", "submissionJsonHash"));
  const promptHash = nullableString(pickNested(source, "hashes.prompt", "prompt_hash", "promptHash"));
  const usedTokens = number(pickNested(source, "caps.usedTokens", "used_tokens", "usedTokens"), totals.input + totals.output + totals.reasoning);
  const finalAnswer = nullableString(pick(source, "final_answer", "finalAnswer", "answer", "output", "finalResult"));
  const explicitOutputContract = pickNested(source, "compliance.outputContract", "compliance.output_contract");
  const outputContract = typeof explicitOutputContract === "boolean"
    ? explicitOutputContract
    : finalAnswer && track !== "unknown"
      ? lintOutput(track, finalAnswer, string(pick(source, "request", "original_request", "originalRequest")) || undefined).ok
      : null;
  return {
    runId,
    portalRunId: sourceType === "portal" ? runId : nullableString(pick(source, "portal_run_id", "portalRunId")),
    source: sourceType,
    track,
    dataset: string(pick(source, "dataset", "benchmark", "practice_set", "practiceSet"), sourceType === "aigo" ? "AI:GO direct" : "unknown"),
    itemId: nullableString(pick(source, "item_id", "itemId", "request_id", "requestId")),
    status,
    score: pick(source, "score", "accuracy", "grade") == null ? null : number(pick(source, "score", "accuracy", "grade")),
    finalAnswer,
    outcome: outcomeFrom(source, status, sourceType),
    failure,
    caps: {
      runTokens: capTokens == null ? null : number(capTokens),
      itemWallclockSeconds: wallclock == null ? null : number(wallclock),
      usedTokens,
      elapsedMs
    },
    totals: { input: totals.input, output: totals.output, reasoning: totals.reasoning, cachedInput: totals.cachedInput, normalizedCost: totals.normalizedCost, latencyMs: totals.latencyMs || elapsedMs },
    modelUsage,
    hashes: { dataset: datasetHash, squadConfig: squadConfigHash, submissionJson: submissionJsonHash, prompt: promptHash },
    compliance: {
      userToolsZero: pickNested(source, "compliance.userToolsZero", "compliance.user_tools_zero") as boolean | null ?? null,
      plannerNativeProtocol: pickNested(source, "compliance.plannerNativeProtocol", "compliance.planner_native_protocol") as boolean | null ?? null,
      memoryOff: pickNested(source, "compliance.memoryOff", "compliance.memory_off") as boolean | null ?? null,
      hashesPresent: Boolean(datasetHash && squadConfigHash && submissionJsonHash && promptHash),
      outputContract,
      fallbackFree: detectFallbackSignatures(rawText).length === 0
    },
    events,
    rawEvidenceRefs: [sourceRef],
    importedAt: now
  };
}

export function normalizePortalExport(raw: unknown, sourceRef = "portal-export.json"): ArgusRun {
  return normalizeRun(raw, "portal", sourceRef);
}

export function normalizeAigoExport(raw: unknown, sourceRef = "aigo-export.json"): ArgusRun {
  return normalizeRun(raw, "aigo", sourceRef);
}

export function mergeRuns(portal: ArgusRun, aigo: ArgusRun): ArgusRun {
  const eventsById = new Map([...aigo.events, ...portal.events].map((event) => [event.eventId, event]));
  const events = [...eventsById.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  return {
    ...aigo,
    ...portal,
    source: "merged",
    runId: portal.runId || aigo.runId,
    portalRunId: portal.portalRunId,
    dataset: portal.dataset !== "unknown" ? portal.dataset : aigo.dataset,
    finalAnswer: portal.finalAnswer ?? aigo.finalAnswer,
    events,
    hashes: {
      dataset: portal.hashes.dataset ?? aigo.hashes.dataset,
      squadConfig: portal.hashes.squadConfig ?? aigo.hashes.squadConfig,
      submissionJson: portal.hashes.submissionJson ?? aigo.hashes.submissionJson,
      prompt: portal.hashes.prompt ?? aigo.hashes.prompt
    },
    compliance: Object.fromEntries(Object.keys(aigo.compliance).map((key) => [key, portal.compliance[key as keyof ArgusRun["compliance"]] ?? aigo.compliance[key as keyof ArgusRun["compliance"]]])) as unknown as ArgusRun["compliance"],
    rawEvidenceRefs: [...new Set([...aigo.rawEvidenceRefs, ...portal.rawEvidenceRefs])],
    importedAt: new Date().toISOString()
  };
}
