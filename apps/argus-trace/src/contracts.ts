import type { ArgusEvent, ArgusRun } from "./types.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasNumber(record: Record<string, unknown>, key: string): boolean {
  return typeof record[key] === "number" && Number.isFinite(record[key]);
}

function isArgusEvent(value: unknown): value is ArgusEvent {
  if (!isRecord(value) || !isRecord(value.tokens)) return false;
  return typeof value.eventId === "string"
    && typeof value.runId === "string"
    && typeof value.kind === "string"
    && typeof value.state === "string"
    && typeof value.decision === "string"
    && typeof value.timestamp === "string"
    && hasNumber(value.tokens, "input")
    && hasNumber(value.tokens, "output")
    && hasNumber(value.tokens, "reasoning")
    && hasNumber(value.tokens, "cachedInput")
    && hasNumber(value.tokens, "normalizedCost");
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
    && typeof value.dataset === "string"
    && typeof value.status === "string"
    && Array.isArray(value.events)
    && value.events.every(isArgusEvent)
    && Array.isArray(value.modelUsage)
    && Array.isArray(value.rawEvidenceRefs)
    && typeof value.importedAt === "string"
    && hasNumber(value.caps, "usedTokens")
    && hasNumber(value.caps, "elapsedMs")
    && hasNumber(value.totals, "input")
    && hasNumber(value.totals, "output")
    && hasNumber(value.totals, "reasoning")
    && hasNumber(value.totals, "cachedInput")
    && hasNumber(value.totals, "normalizedCost")
    && hasNumber(value.totals, "latencyMs");
}
