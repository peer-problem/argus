import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { validateSchema } from "./schema.ts";
import type { ArgusExperiment, Track } from "./types.ts";

const TRACK_WEIGHTS: Record<Exclude<Track, "unknown">, number> = {
  coding: 0.5,
  math: 0.25,
  generic: 0.25
};

export interface ExperimentSliceSummary {
  runs: number;
  uniqueItems: number;
  accuracy: number;
  formatFailureRate: number;
  timeoutRate: number;
  meanNormalizedCost: number;
  totalNormalizedCost: number;
  meanLatencyMs: number;
  tokens: {
    input: number;
    output: number;
    reasoning: number;
    cachedInput: number;
  };
}

export interface CalibrationReport {
  candidateId: string;
  runs: number;
  uniqueItems: number;
  repeatCoverage: {
    minimum: number;
    maximum: number;
    itemsWithAtLeastTwo: number;
    totalItems: number;
  };
  accuracy: number;
  weightedAccuracy: number | null;
  weightedObservedAccuracy: number;
  formatFailureRate: number;
  timeoutRate: number;
  totalNormalizedCost: number;
  meanNormalizedCost: number;
  meanLatencyMs: number;
  meanContextDuplicationFactor: number | null;
  hashesComplete: boolean;
  byTrack: Partial<Record<Exclude<Track, "unknown">, ExperimentSliceSummary>>;
  byStratum: Record<string, ExperimentSliceSummary>;
}

export interface PromotionCriterion {
  code: string;
  passed: boolean;
  detail: string;
}

export interface PromotionReport {
  baselineId: string;
  candidateId: string;
  promotable: boolean;
  pairedRuns: number;
  baseline: CalibrationReport | null;
  candidate: CalibrationReport | null;
  criteria: PromotionCriterion[];
}

function mean(values: number[]): number {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

function isTimeout(record: ArgusExperiment): boolean {
  return record.timeout === true || record.itemStatus === "capped_wallclock" || record.failureKind === "wallclock_cap" || /timeout/i.test(record.failureClass ?? "");
}

function summarize(records: ArgusExperiment[]): ExperimentSliceSummary {
  return {
    runs: records.length,
    uniqueItems: new Set(records.map((record) => `${record.track}:${record.itemId}`)).size,
    accuracy: mean(records.map((record) => record.score)),
    formatFailureRate: records.length ? records.filter((record) => !record.formatValid).length / records.length : 0,
    timeoutRate: records.length ? records.filter(isTimeout).length / records.length : 0,
    meanNormalizedCost: mean(records.map((record) => record.normalizedCost)),
    totalNormalizedCost: records.reduce((total, record) => total + record.normalizedCost, 0),
    meanLatencyMs: mean(records.map((record) => record.latencyMs)),
    tokens: records.reduce((total, record) => ({
      input: total.input + record.tokens.input,
      output: total.output + record.tokens.output,
      reasoning: total.reasoning + record.tokens.reasoning,
      cachedInput: total.cachedInput + record.tokens.cachedInput
    }), { input: 0, output: 0, reasoning: 0, cachedInput: 0 })
  };
}

function groupBy<T>(values: T[], key: (value: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const value of values) {
    const groupKey = key(value);
    groups.set(groupKey, [...(groups.get(groupKey) ?? []), value]);
  }
  return groups;
}

function candidateKey(record: ArgusExperiment): string {
  return record.candidateId ?? record.squadConfigHash;
}

export function calibrationReports(records: ArgusExperiment[]): CalibrationReport[] {
  return [...groupBy(records, candidateKey)].map(([candidateId, candidateRecords]) => {
    const byTrack = Object.fromEntries([...groupBy(candidateRecords, (record) => record.track)].map(([track, group]) => [track, summarize(group)])) as CalibrationReport["byTrack"];
    const byStratum = Object.fromEntries([...groupBy(candidateRecords, (record) => record.stratum ?? "unclassified")].map(([stratum, group]) => [stratum, summarize(group)]));
    const tracks = Object.entries(byTrack) as Array<[Exclude<Track, "unknown">, ExperimentSliceSummary]>;
    const observedWeight = tracks.reduce((total, [track]) => total + TRACK_WEIGHTS[track], 0);
    const weightedSum = tracks.reduce((total, [track, summary]) => total + summary.accuracy * TRACK_WEIGHTS[track], 0);
    const repeats = [...groupBy(candidateRecords, (record) => `${record.track}:${record.itemId}`)].map(([, group]) => new Set(group.map((record) => record.repeat ?? 1)).size);
    const duplication = candidateRecords.map((record) => record.contextDuplicationFactor).filter((value): value is number => value != null);
    const summary = summarize(candidateRecords);
    return {
      candidateId,
      runs: summary.runs,
      uniqueItems: summary.uniqueItems,
      repeatCoverage: {
        minimum: repeats.length ? Math.min(...repeats) : 0,
        maximum: repeats.length ? Math.max(...repeats) : 0,
        itemsWithAtLeastTwo: repeats.filter((count) => count >= 2).length,
        totalItems: repeats.length
      },
      accuracy: summary.accuracy,
      weightedAccuracy: tracks.length === 3 ? weightedSum : null,
      weightedObservedAccuracy: observedWeight ? weightedSum / observedWeight : 0,
      formatFailureRate: summary.formatFailureRate,
      timeoutRate: summary.timeoutRate,
      totalNormalizedCost: summary.totalNormalizedCost,
      meanNormalizedCost: summary.meanNormalizedCost,
      meanLatencyMs: summary.meanLatencyMs,
      meanContextDuplicationFactor: duplication.length ? mean(duplication) : null,
      hashesComplete: candidateRecords.every((record) => [record.datasetHash, record.squadConfigHash, record.submissionJsonHash, record.promptHash].every(Boolean)),
      byTrack,
      byStratum
    };
  }).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
}

function pairKey(record: ArgusExperiment): string {
  return `${record.track}:${record.itemId}:${record.repeat ?? 1}`;
}

function invalidTerminalOutcome(record: ArgusExperiment): boolean {
  return record.outcome != null && record.outcome !== "graded";
}

export function evaluatePromotion(records: ArgusExperiment[], baselineId: string, candidateId: string, maximumStratumRegression = 0): PromotionReport {
  if (!Number.isFinite(maximumStratumRegression) || maximumStratumRegression < 0) throw new Error("maximumStratumRegression must be a non-negative finite number");
  const baselineRecords = records.filter((record) => candidateKey(record) === baselineId);
  const candidateRecords = records.filter((record) => candidateKey(record) === candidateId);
  const reports = calibrationReports(records);
  const baseline = reports.find((report) => report.candidateId === baselineId) ?? null;
  const candidate = reports.find((report) => report.candidateId === candidateId) ?? null;
  const baselineByPair = new Map(baselineRecords.map((record) => [pairKey(record), record]));
  const candidateByPair = new Map(candidateRecords.map((record) => [pairKey(record), record]));
  const pairedKeys = [...baselineByPair.keys()].filter((key) => candidateByPair.has(key));
  const sampleMatched = baselineRecords.length > 0 && candidateRecords.length > 0 && baselineByPair.size === candidateByPair.size && pairedKeys.length === baselineByPair.size;
  const pairedBaseline = pairedKeys.map((key) => baselineByPair.get(key)!);
  const pairedCandidate = pairedKeys.map((key) => candidateByPair.get(key)!);
  const baselineAccuracy = mean(pairedBaseline.map((record) => record.score));
  const candidateAccuracy = mean(pairedCandidate.map((record) => record.score));
  const baselineCost = pairedBaseline.reduce((total, record) => total + record.normalizedCost, 0);
  const candidateCost = pairedCandidate.reduce((total, record) => total + record.normalizedCost, 0);
  const itemRepeatCounts = [...groupBy(pairedBaseline, (record) => `${record.track}:${record.itemId}`)].map(([, group]) => new Set(group.map((record) => record.repeat ?? 1)).size);
  const hasTwoRepeats = itemRepeatCounts.length > 0 && itemRepeatCounts.every((count) => count >= 2);
  const directionConsistent = pairedKeys.every((key) => candidateByPair.get(key)!.score >= baselineByPair.get(key)!.score);
  const accuracyImproved = candidateAccuracy > baselineAccuracy;
  const accuracyMaintainedWithLowerCost = Math.abs(candidateAccuracy - baselineAccuracy) < 1e-12 && candidateCost < baselineCost;
  const strata = new Set(pairedBaseline.map((record) => record.stratum ?? "unclassified"));
  const regressions = [...strata].map((stratum) => {
    const baselineStratum = pairedBaseline.filter((record) => (record.stratum ?? "unclassified") === stratum);
    const candidateStratum = pairedCandidate.filter((record) => (record.stratum ?? "unclassified") === stratum);
    return { stratum, delta: mean(candidateStratum.map((record) => record.score)) - mean(baselineStratum.map((record) => record.score)) };
  });
  const criteria: PromotionCriterion[] = [
    { code: "CANDIDATES_PRESENT", passed: Boolean(baseline && candidate), detail: `${baselineRecords.length} baseline and ${candidateRecords.length} candidate records` },
    { code: "PAIRED_SAMPLE_MATCH", passed: sampleMatched, detail: `${pairedKeys.length} exact track/item/repeat pairs` },
    { code: "MINIMUM_REPEATS", passed: hasTwoRepeats, detail: hasTwoRepeats ? "Every paired item has at least two repeats." : "Every paired item must have at least two repeats." },
    { code: "DIRECTION_CONSISTENT", passed: directionConsistent && pairedKeys.length > 0, detail: `${pairedKeys.filter((key) => candidateByPair.get(key)!.score < baselineByPair.get(key)!.score).length} paired regressions` },
    { code: "ACCURACY_COST_FRONTIER", passed: accuracyImproved || accuracyMaintainedWithLowerCost, detail: `accuracy ${baselineAccuracy.toFixed(4)} → ${candidateAccuracy.toFixed(4)}; cost ${baselineCost.toFixed(2)} → ${candidateCost.toFixed(2)}` },
    { code: "FORMAT_NO_REGRESSION", passed: Boolean(baseline && candidate && candidate.formatFailureRate <= baseline.formatFailureRate), detail: `${baseline?.formatFailureRate ?? 0} → ${candidate?.formatFailureRate ?? 0}` },
    { code: "TIMEOUT_NO_REGRESSION", passed: Boolean(baseline && candidate && candidate.timeoutRate <= baseline.timeoutRate), detail: `${baseline?.timeoutRate ?? 0} → ${candidate?.timeoutRate ?? 0}` },
    { code: "NO_TERMINAL_FAILURE", passed: candidateRecords.length > 0 && !candidateRecords.some(invalidTerminalOutcome), detail: `${candidateRecords.filter(invalidTerminalOutcome).length} non-graded outcomes` },
    { code: "STRATUM_NO_LARGE_REGRESSION", passed: regressions.every(({ delta }) => delta >= -maximumStratumRegression), detail: regressions.map(({ stratum, delta }) => `${stratum}:${delta.toFixed(4)}`).join(", ") || "no strata" },
    { code: "HASHES_COMPLETE", passed: Boolean(candidate?.hashesComplete), detail: candidate?.hashesComplete ? "All candidate records are hash-bound." : "One or more candidate records lack a required hash." }
  ];
  return { baselineId, candidateId, promotable: criteria.every((criterion) => criterion.passed), pairedRuns: pairedKeys.length, baseline, candidate, criteria };
}

export class ExperimentLedger {
  constructor(readonly path: string) {}

  read(): ArgusExperiment[] {
    if (!existsSync(this.path)) return [];
    return readFileSync(this.path, "utf8").split("\n").filter(Boolean).map((line, index) => {
      const record = JSON.parse(line) as ArgusExperiment;
      const validation = validateSchema("experiment", record);
      if (!validation.ok) throw new Error(`Invalid experiment on ledger line ${index + 1}: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join(", ")}`);
      return record;
    });
  }

  append(records: ArgusExperiment | ArgusExperiment[]): void {
    const batch = Array.isArray(records) ? records : [records];
    if (batch.length === 0) throw new Error("At least one experiment record is required.");
    const runIds = new Set(this.read().map((record) => record.runId));
    for (const record of batch) {
      const validation = validateSchema("experiment", record);
      if (!validation.ok) throw new Error(`Invalid experiment ${record.runId}: ${validation.issues.map((issue) => `${issue.path} ${issue.message}`).join(", ")}`);
      if (runIds.has(record.runId)) throw new Error(`Duplicate experiment run ID: ${record.runId}`);
      runIds.add(record.runId);
    }
    appendFileSync(this.path, batch.map((record) => JSON.stringify(record)).join("\n") + "\n", { encoding: "utf8", flag: "a" });
  }
}
