import type { ArgusEvent, ArgusRun, PortalBatchRunReport } from "../../../lab/lib/types.ts";

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

export function visibleEvents(events: ArgusEvent[], progress: number): ArgusEvent[] {
  if (events.length === 0) return [];
  const count = Math.max(1, Math.ceil(events.length * Math.min(1, Math.max(0, progress))));
  return events.slice(0, count);
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
  const graded = report.trackResults.reduce((total, result) => total + result.graded, 0);
  return (graded / report.tokens.total) * 1_000_000;
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
  const first = run.events[0];
  if (!first) return 0;
  return Math.max(0, new Date(event.timestamp).valueOf() - new Date(first.timestamp).valueOf());
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
