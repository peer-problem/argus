import type { ArgusEvent, ArgusRun, PortalBatchRunReport } from "./types.ts";

export function formatNumber(value: number, maximumFractionDigits = 1): string {
  return new Intl.NumberFormat("en-US", { notation: value >= 100_000 ? "compact" : "standard", maximumFractionDigits }).format(value);
}

export function formatDuration(ms: number): string {
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

export function timelineDuration(run: ArgusRun): number {
  const origin = eventTimelineOrigin(run.events);
  const observedDuration = Number.isFinite(origin)
    ? Math.max(0, ...run.events.map((event) => eventTimestamp(event) - origin))
    : 0;
  return Math.max(1, run.totals.latencyMs, observedDuration);
}

export function visibleEvents(events: ArgusEvent[], progress: number, durationMs?: number): ArgusEvent[] {
  if (events.length === 0) return [];
  const ordered = [...events].sort((left, right) => eventTimestamp(left) - eventTimestamp(right));
  const origin = eventTimestamp(ordered[0]!);
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
  if (primary.score == null || secondary.score == null) return false;
  if (primary.track !== secondary.track || primary.dataset !== secondary.dataset) return false;
  return Boolean(primary.itemId && secondary.itemId && primary.itemId === secondary.itemId);
}

export function costEfficiencyIndex(run: ArgusRun, visibleRuns: ArgusRun[]): number {
  const costs = visibleRuns.map((candidate) => candidate.totals.normalizedCost).filter(Number.isFinite);
  if (costs.length === 0) return 0;
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
  return run.caps.runTokens ? run.caps.usedTokens / run.caps.runTokens : null;
}

export function cacheShare(run: ArgusRun): number {
  return run.totals.input ? run.totals.cachedInput / run.totals.input : 0;
}

export function eventStart(run: ArgusRun, event: ArgusEvent): number {
  const origin = eventTimelineOrigin(run.events);
  if (!Number.isFinite(origin)) return 0;
  return Math.max(0, eventTimestamp(event) - origin);
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
