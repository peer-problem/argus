import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calibrationReports, evaluatePromotion, ExperimentLedger } from "./experiments.ts";
import type { ArgusExperiment } from "./types.ts";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function experiment(overrides: Partial<ArgusExperiment> = {}): ArgusExperiment {
  return {
    runId: "run-1",
    candidateId: "candidate-a",
    architecture: "A2",
    runKind: "test",
    track: "coding",
    itemId: "coding-visible-0001",
    stratum: "swebench",
    repeat: 1,
    datasetHash: "sha256:dataset",
    squadConfigHash: "sha256:squad",
    submissionJsonHash: "sha256:submission",
    promptHash: "sha256:prompt",
    modelRoutes: { solver: "Qwen3-32B" },
    score: 1,
    formatValid: true,
    outcome: "graded",
    itemStatus: "ok",
    failureKind: "unknown",
    failureOwner: "unknown",
    secondaryTags: [],
    timeout: false,
    tokens: { input: 100, output: 20, reasoning: 5, cachedInput: 10, byModel: {} },
    normalizedCost: 2,
    latencyMs: 1_000,
    contextDuplicationFactor: 1.25,
    failureClass: null,
    portalRunId: "portal-1",
    graderRef: "grader-1",
    recordedAt: "2026-08-22T00:00:00.000Z",
    ...overrides
  };
}

function pairedRecords(): ArgusExperiment[] {
  const rows = [
    { track: "coding" as const, itemId: "coding-1", stratum: "swebench" },
    { track: "math" as const, itemId: "math-1", stratum: "integer" },
    { track: "generic" as const, itemId: "generic-1", stratum: "history" }
  ];
  return rows.flatMap((row, rowIndex) => [1, 2].flatMap((repeat) => [
    experiment({
      ...row,
      repeat,
      runId: `baseline-${rowIndex}-${repeat}`,
      candidateId: "baseline",
      score: 1,
      normalizedCost: 2,
      portalRunId: `portal-baseline-${rowIndex}-${repeat}`
    }),
    experiment({
      ...row,
      repeat,
      runId: `candidate-${rowIndex}-${repeat}`,
      candidateId: "candidate",
      score: 1,
      normalizedCost: 1,
      portalRunId: `portal-candidate-${rowIndex}-${repeat}`
    })
  ]));
}

describe("experiment ledger", () => {
  it("appends schema-valid records as immutable JSONL and reads them back", () => {
    const directory = mkdtempSync(join(tmpdir(), "argus-experiments-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "experiments.jsonl");
    const ledger = new ExperimentLedger(path);
    const records = [experiment(), experiment({ runId: "run-2", itemId: "coding-visible-0002" })];

    ledger.append(records);

    expect(ledger.read()).toEqual(records);
    expect(readFileSync(path, "utf8").trim().split("\n")).toHaveLength(2);
    expect(() => ledger.append(experiment())).toThrow(/Duplicate experiment run ID/);
    expect(() => ledger.append([
      experiment({ runId: "run-3" }),
      experiment({ runId: "run-3", itemId: "coding-visible-0003" })
    ])).toThrow(/Duplicate experiment run ID/);
  });

  it("rejects records that do not satisfy the experiment schema", () => {
    const directory = mkdtempSync(join(tmpdir(), "argus-experiments-"));
    temporaryDirectories.push(directory);
    const ledger = new ExperimentLedger(join(directory, "experiments.jsonl"));
    expect(() => ledger.append(experiment({ score: 2 }))).toThrow(/Invalid experiment/);
  });
});

describe("calibration reports", () => {
  it("reports track weights, strata, repeats, token/cost totals, and context duplication", () => {
    const records = pairedRecords().filter((record) => record.candidateId === "candidate");
    const report = calibrationReports(records)[0]!;

    expect(report).toMatchObject({
      candidateId: "candidate",
      runs: 6,
      uniqueItems: 3,
      accuracy: 1,
      weightedAccuracy: 1,
      weightedObservedAccuracy: 1,
      totalNormalizedCost: 6,
      meanNormalizedCost: 1,
      meanLatencyMs: 1_000,
      meanContextDuplicationFactor: 1.25,
      hashesComplete: true,
      repeatCoverage: { minimum: 2, maximum: 2, itemsWithAtLeastTwo: 3, totalItems: 3 }
    });
    expect(report.byTrack.coding?.tokens).toEqual({ input: 200, output: 40, reasoning: 10, cachedInput: 20 });
    expect(Object.keys(report.byStratum)).toEqual(["swebench", "integer", "history"]);
  });

  it("does not claim a benchmark-weighted score until all three tracks are observed", () => {
    const report = calibrationReports([experiment()])[0]!;
    expect(report.weightedAccuracy).toBeNull();
    expect(report.weightedObservedAccuracy).toBe(1);
  });
});

describe("promotion gate", () => {
  it("promotes an exactly paired, repeated candidate that maintains accuracy at lower cost", () => {
    const report = evaluatePromotion(pairedRecords(), "baseline", "candidate");
    expect(report.promotable).toBe(true);
    expect(report.pairedRuns).toBe(6);
    expect(report.criteria.every((criterion) => criterion.passed)).toBe(true);
  });

  it.each([
    ["sample mismatch", (records: ArgusExperiment[]) => records.filter((record) => record.runId !== "candidate-0-1"), "PAIRED_SAMPLE_MATCH"],
    ["single repeat", (records: ArgusExperiment[]) => records.filter((record) => record.repeat === 1), "MINIMUM_REPEATS"],
    ["format regression", (records: ArgusExperiment[]) => records.map((record) => record.runId === "candidate-0-1" ? { ...record, formatValid: false } : record), "FORMAT_NO_REGRESSION"],
    ["timeout regression", (records: ArgusExperiment[]) => records.map((record) => record.runId === "candidate-0-1" ? { ...record, timeout: true } : record), "TIMEOUT_NO_REGRESSION"],
    ["terminal failure", (records: ArgusExperiment[]) => records.map((record) => record.runId === "candidate-0-1" ? { ...record, outcome: "extraction_failed" as const } : record), "NO_TERMINAL_FAILURE"],
    ["stratum regression", (records: ArgusExperiment[]) => records.map((record) => record.runId.startsWith("candidate-0-") ? { ...record, score: 0 } : record), "STRATUM_NO_LARGE_REGRESSION"]
  ])("rejects %s", (_name, mutate, criterionCode) => {
    const report = evaluatePromotion(mutate(pairedRecords()), "baseline", "candidate");
    expect(report.promotable).toBe(false);
    expect(report.criteria.find((criterion) => criterion.code === criterionCode)?.passed).toBe(false);
  });
});
