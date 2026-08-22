import type { ArgusEvent, ArgusRun } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "number" && Number.isFinite(record[key]);
}

function hasObservedNumber(record: Record<string, unknown>, key: string): boolean {
  return record[key] === null || hasNumber(record, key);
}

function isNullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function isRunTaskDetail(value: unknown): boolean {
  if (!isRecord(value) || !isRecord(value.tokens)) return false;
  return typeof value.taskId === "string"
    && typeof value.title === "string"
    && isNullableString(value.agentId)
    && isNullableString(value.agentName)
    && typeof value.status === "string"
    && isNullableString(value.output)
    && isNullableString(value.error)
    && hasObservedNumber(value, "durationMs")
    && hasObservedNumber(value.tokens, "input")
    && hasObservedNumber(value.tokens, "output")
    && isNullableString(value.priority)
    && isNullableString(value.description)
    && isNullableString(value.createdBy)
    && Array.isArray(value.dependsOnTaskIds)
    && value.dependsOnTaskIds.every((item) => typeof item === "string")
    && Array.isArray(value.artifacts)
    && value.artifacts.every((item) => typeof item === "string")
    && isNullableString(value.result)
    && hasObservedNumber(value, "retryCount")
    && hasObservedNumber(value, "maxRetries")
    && isNullableString(value.startedAt)
    && isNullableString(value.completedAt)
    && isNullableString(value.markdown);
}

function isRunDetail(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return typeof value.executionId === "string"
    && isNullableString(value.squadId)
    && isNullableString(value.squadName)
    && isNullableString(value.request)
    && isNullableString(value.planTitle)
    && typeof value.startedAt === "string"
    && isNullableString(value.completedAt)
    && Array.isArray(value.tasks)
    && value.tasks.every(isRunTaskDetail)
    && Array.isArray(value.console)
    && value.console.every((entry) => isRecord(entry) && typeof entry.timestamp === "string" && typeof entry.level === "string" && typeof entry.agentId === "string" && typeof entry.message === "string")
    && isNullableString(value.reportMarkdown);
}

function isArgusEvent(value: unknown): value is ArgusEvent {
  if (!isRecord(value) || !isRecord(value.tokens)) return false;
  return typeof value.eventId === "string"
    && typeof value.runId === "string"
    && typeof value.kind === "string"
    && typeof value.state === "string"
    && typeof value.decision === "string"
    && typeof value.timestamp === "string"
    && hasObservedNumber(value.tokens, "input")
    && hasObservedNumber(value.tokens, "output")
    && hasObservedNumber(value.tokens, "reasoning")
    && hasObservedNumber(value.tokens, "cachedInput")
    && hasObservedNumber(value.tokens, "normalizedCost")
    && hasObservedNumber(value, "durationMs");
}

export function isArgusRun(value: unknown): value is ArgusRun {
  if (!isRecord(value)
    || !isRecord(value.caps)
    || !isRecord(value.totals)
    || !isRecord(value.hashes)
    || !isRecord(value.compliance)) return false;

  return typeof value.runId === "string"
    && typeof value.source === "string"
    && typeof value.track === "string"
    && (typeof value.dataset === "string" || value.dataset === null)
    && typeof value.status === "string"
    && Array.isArray(value.events)
    && value.events.every(isArgusEvent)
    && Array.isArray(value.modelUsage)
    && Array.isArray(value.rawEvidenceRefs)
    && (value.detail === undefined || value.detail === null || isRunDetail(value.detail))
    && typeof value.importedAt === "string"
    && hasObservedNumber(value.caps, "usedTokens")
    && hasObservedNumber(value.caps, "elapsedMs")
    && hasObservedNumber(value.totals, "input")
    && hasObservedNumber(value.totals, "output")
    && hasObservedNumber(value.totals, "reasoning")
    && hasObservedNumber(value.totals, "cachedInput")
    && hasObservedNumber(value.totals, "normalizedCost")
    && hasObservedNumber(value.totals, "latencyMs");
}
