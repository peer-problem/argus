import type { ArgusEvent, ArgusRun, ObservedNumber, PortalBatchRunReport, TokenUsage } from "./types.ts";

export function isObservedNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function formatNumber(value: ObservedNumber | undefined, maximumFractionDigits = 1): string {
  if (!isObservedNumber(value)) return "Not observed";
  return new Intl.NumberFormat("en-US", { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits }).format(value);
}

export function formatDuration(ms: ObservedNumber | undefined): string {
  if (!isObservedNumber(ms)) return "Not observed";
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1_000).toFixed(ms < 10_000 ? 1 : 0)} s`;
  return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1_000)}s`;
}

export function finalAnswerPreview(finalAnswer: string | null | undefined): string {
  const trimmed = finalAnswer?.trim() ?? "";
  if (!trimmed) return "Not observed";
  const firstLine = trimmed.split(/\r?\n/, 1)[0]!;
  const clipped = firstLine.length > 48 ? `${firstLine.slice(0, 47)}…` : firstLine;
  return trimmed.includes("\n") || clipped !== trimmed ? `${clipped} · ${trimmed.length} chars` : clipped;
}

function eventTimestamp(event: ArgusEvent): number {
  const timestamp = new Date(event.timestamp).valueOf();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function eventTimelineOrigin(events: ArgusEvent[]): number {
  return events.reduce((earliest, event) => Math.min(earliest, eventTimestamp(event)), Number.POSITIVE_INFINITY);
}

function runTimelineOrigin(run: ArgusRun): number {
  const startedAt = run.detail?.startedAt == null ? Number.NaN : new Date(run.detail.startedAt).valueOf();
  return Number.isFinite(startedAt) ? startedAt : eventTimelineOrigin(run.events);
}

export function timelineDuration(run: ArgusRun): number {
  const origin = runTimelineOrigin(run);
  const observedDuration = Number.isFinite(origin)
    ? Math.max(0, ...run.events.map((event) => eventTimestamp(event) - origin))
    : 0;
  const completedAt = run.detail?.completedAt == null ? Number.NaN : new Date(run.detail.completedAt).valueOf();
  const executionWindow = Number.isFinite(origin) && Number.isFinite(completedAt) ? Math.max(0, completedAt - origin) : 0;
  if (executionWindow > 0) return executionWindow;
  return Math.max(1, run.totals.latencyMs ?? 0, observedDuration);
}

/** Returns no total when one of the source measurements needed for it is absent. */
export function observedSum(...values: ObservedNumber[]): number | null {
  return values.every(isObservedNumber) ? values.reduce((total, value) => total + value, 0) : null;
}

export function tokenTotal(usage: Pick<TokenUsage, "input" | "output">): number | null {
  return observedSum(usage.input, usage.output);
}

export function visibleEvents(events: ArgusEvent[], progress: number, durationMs?: number, startedAt?: string | null): ArgusEvent[] {
  if (events.length === 0) return [];
  const ordered = [...events].sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const requestedOrigin = startedAt == null ? Number.NaN : new Date(startedAt).valueOf();
  const origin = Number.isFinite(requestedOrigin) ? requestedOrigin : eventTimestamp(ordered[0]!);
  const observedDuration = Math.max(0, eventTimestamp(ordered.at(-1)!) - origin);
  const duration = Math.max(0, durationMs ?? observedDuration);
  const playheadMs = Math.min(1, Math.max(0, progress)) * duration;
  const revealed = ordered.filter((event) => eventTimestamp(event) - origin <= playheadMs);
  return revealed.length > 0 ? revealed : [ordered[0]!];
}

export function agentNames(run: ArgusRun): string[] {
  return [...new Set(run.events.map((event) => event.agentId).filter((agent): agent is string => Boolean(agent)))];
}

export function modelNames(run: ArgusRun): string[] {
  return [...new Set(run.modelUsage.map((usage) => usage.model))];
}

export function taskCount(run: ArgusRun): number {
  return new Set(run.events.map((event) => event.taskId).filter(Boolean)).size;
}

export function dependencyWaveCount(run: ArgusRun): number {
  const taskEvents = run.events.filter((event) => event.taskId);
  if (taskEvents.length === 0) return 0;
  return new Set(taskEvents.map((event) => event.wave ?? 0)).size;
}

export function comparisonIsMatched(primary: ArgusRun, secondary: ArgusRun): boolean {
  if (primary.score == null || secondary.score == null || primary.dataset == null || secondary.dataset == null) return false;
  if (primary.track !== secondary.track || primary.dataset !== secondary.dataset) return false;
  return Boolean(primary.itemId && secondary.itemId && primary.itemId === secondary.itemId);
}

export function costEfficiencyIndex(run: ArgusRun, visibleRuns: ArgusRun[]): number | null {
  if (!isObservedNumber(run.totals.normalizedCost)) return null;
  const costs = visibleRuns.map((candidate) => candidate.totals.normalizedCost).filter(isObservedNumber);
  if (costs.length === 0) return null;
  const minimum = Math.min(...costs);
  const maximum = Math.max(...costs);
  if (minimum === maximum) return 100;
  const index = ((maximum - run.totals.normalizedCost) / (maximum - minimum)) * 100;
  return Math.min(100, Math.max(0, index));
}

export function weightedPortalScore(report: PortalBatchRunReport): number {
  return report.trackResults.reduce((score, result) => score + result.accuracy * result.weight, 0);
}

export function portalTokenEfficiency(report: PortalBatchRunReport): number {
  if (report.tokens.total <= 0) return 0;
  return ((report.score * 100) / report.tokens.total) * 1_000_000;
}

export function notGradedItems(report: PortalBatchRunReport): number {
  return report.trackResults.reduce((total, result) => total + Math.max(0, result.items - result.graded), 0);
}

export function capShare(run: ArgusRun): number | null {
  return run.caps.runTokens && isObservedNumber(run.caps.usedTokens) ? run.caps.usedTokens / run.caps.runTokens : null;
}

export function cacheShare(run: ArgusRun): number | null {
  return run.totals.input && isObservedNumber(run.totals.cachedInput) ? run.totals.cachedInput / run.totals.input : null;
}

export function eventStart(run: ArgusRun, event: ArgusEvent): number {
  const origin = runTimelineOrigin(run);
  if (!Number.isFinite(origin)) return 0;
  return Math.max(0, eventTimestamp(event) - origin);
}

export interface TraceCallSpan {
  event: ArgusEvent;
  startMs: number;
  endMs: number;
  durationMs: number;
}

function previousEvent(run: ArgusRun, event: ArgusEvent, matches: (candidate: ArgusEvent) => boolean): ArgusEvent | null {
  const timestamp = eventTimestamp(event);
  return run.events
    .filter((candidate) => candidate.eventId !== event.eventId && eventTimestamp(candidate) <= timestamp && matches(candidate))
    .sort((left, right) => eventTimestamp(right) - eventTimestamp(left))[0] ?? null;
}

function isTraceCallAnchor(event: ArgusEvent): boolean {
  if (event.kind === "plan.created" || event.kind === "task.completed" || event.kind === "task.failed") return true;
  return event.model != null && ((tokenTotal(event.tokens) ?? 0) > 0 || (event.durationMs ?? 0) > 0);
}

/**
 * Reduces the source event ledger into call spans for the primary timeline.
 * Lifecycle records remain in `run.events` for the lower event-ledger viewer.
 */
export function traceCallSpans(run: ArgusRun): TraceCallSpan[] {
  return run.events.filter(isTraceCallAnchor).map((event): TraceCallSpan => {
    const endMs = eventStart(run, event);
    let startMs = Math.max(0, endMs - (event.durationMs ?? 0));
    if (event.kind === "plan.created") {
      const planningStarted = previousEvent(run, event, (candidate) => candidate.kind === "run.started" && candidate.state === "planning");
      if (planningStarted) startMs = eventStart(run, planningStarted);
    } else if ((event.kind === "task.completed" || event.kind === "task.failed") && event.taskId != null) {
      const taskStarted = previousEvent(run, event, (candidate) => candidate.kind === "task.started" && candidate.taskId === event.taskId);
      if (taskStarted) startMs = eventStart(run, taskStarted);
    }
    startMs = Math.max(0, Math.min(startMs, endMs));
    return { event, startMs, endMs, durationMs: Math.max(0, endMs - startMs) };
  }).sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs || left.event.eventId.localeCompare(right.event.eventId));
}

export function visibleTraceCallEvents(run: ArgusRun, progress: number): ArgusEvent[] {
  const calls = traceCallSpans(run);
  if (calls.length === 0) return [];
  const playheadMs = Math.min(1, Math.max(0, progress)) * timelineDuration(run);
  const visible = calls.filter((call) => call.startMs <= playheadMs).map((call) => call.event);
  return visible.length > 0 ? visible : [calls[0]!.event];
}

export function complianceScore(run: ArgusRun): { passed: number; known: number; total: number } {
  const values = Object.values(run.compliance);
  return { passed: values.filter((value) => value === true).length, known: values.filter((value) => value !== null).length, total: values.length };
}

export function failureCounts(runs: ArgusRun[]): Record<string, number> {
  return runs.reduce<Record<string, number>>((counts, run) => {
    if (run.failure) counts[run.failure.owner] = (counts[run.failure.owner] ?? 0) + 1;
    return counts;
  }, {});
}
