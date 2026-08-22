import { describe, expect, it } from "vitest";
import { validateSchema } from "../../../lab/lib/schema.ts";
import { capShare, comparisonIsMatched, costEfficiencyIndex, dependencyWaveCount, finalAnswerPreview, formatDuration, notGradedItems, portalTokenEfficiency, taskCount, visibleEvents, weightedPortalScore } from "./derive.ts";
import { dataArrivalsFor, demoBatches, demoRuns } from "./data/demo.ts";
import { demoPortalReports } from "./data/portalReports.ts";

describe("trace derivations", () => {
  it("reveals at least the first event while replaying", () => {
    expect(visibleEvents(demoRuns[0]!.events, 0)).toHaveLength(1);
    expect(visibleEvents(demoRuns[0]!.events, 1)).toHaveLength(demoRuns[0]!.events.length);
  });

  it("computes cap share and readable duration", () => {
    expect(capShare(demoRuns[0]!)).toBeCloseTo(0.1824);
    expect(formatDuration(74_000)).toBe("1m 14s");
  });

  it("derives task topology from evidence instead of assuming one wave", () => {
    expect(taskCount(demoRuns[0]!)).toBe(1);
    expect(dependencyWaveCount(demoRuns[0]!)).toBe(1);
    const multiWave = structuredClone(demoRuns[0]!);
    multiWave.events.push({ ...multiWave.events[2]!, eventId: "second-task", taskId: "review", wave: 1 });
    expect(taskCount(multiWave)).toBe(2);
    expect(dependencyWaveCount(multiWave)).toBe(2);
  });

  it("keeps repeated model calls and their context limits visible per run", () => {
    const complex = demoRuns.find((run) => run.runId === "ARGUS-C2-031")!;
    expect(complex.modelUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "furiosa-ai/Qwen3-32B-FP8", calls: 2, contextWindowTokens: 40_000 }),
      expect.objectContaining({ model: "furiosa-ai/gpt-oss-120b", calls: 2, contextWindowTokens: 128_000 })
    ]));
    expect(complex.events.filter((event) => event.model?.includes("Qwen3") && event.tokens.input > 0)).toHaveLength(2);
    expect(complex.events.filter((event) => event.model?.includes("gpt-oss") && event.tokens.input > 0)).toHaveLength(2);
  });

  it("only compares scored runs from the same item", () => {
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[1]!)).toBe(true);
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[2]!)).toBe(false);
    const unknown = structuredClone(demoRuns[1]!);
    unknown.score = null;
    expect(comparisonIsMatched(demoRuns[0]!, unknown)).toBe(false);
  });

  it("maps visible-set normalized cost to a transparent efficiency index", () => {
    const lowestCost = demoRuns.reduce((best, run) => run.totals.normalizedCost < best.totals.normalizedCost ? run : best);
    const highestCost = demoRuns.reduce((worst, run) => run.totals.normalizedCost > worst.totals.normalizedCost ? run : worst);
    expect(costEfficiencyIndex(lowestCost, demoRuns)).toBe(100);
    expect(costEfficiencyIndex(highestCost, demoRuns)).toBe(0);
    expect(costEfficiencyIndex(demoRuns[0]!, [demoRuns[0]!])).toBe(100);
  });

  it("keeps Portal batch scoring and token efficiency explicit", () => {
    const report = demoPortalReports[0]!;
    expect(weightedPortalScore(report)).toBeCloseTo(0.093, 3);
    expect(report.score).toBe(0.093);
    expect(portalTokenEfficiency(report)).toBeCloseTo(25.513, 3);
    expect(notGradedItems(report)).toBe(4);
    expect(report.tokens.input + report.tokens.output).toBe(report.tokens.total);
    expect(report.modelUsage.reduce((total, model) => total + model.totalTokens, 0)).toBe(report.tokens.total);
  });

  it("previews final answers without losing the exact artifact", () => {
    expect(finalAnswerPreview("  ANSWER: D  ")).toBe("ANSWER: D");
    expect(finalAnswerPreview("\n\t")).toBe("Not observed");
    expect(finalAnswerPreview("*** PATCH START ***\nfile.py\n...")).toBe("*** PATCH START *** · 31 chars");
  });

  it("replays the complete typed native event flow without rewriting fixture kinds", () => {
    expect(demoRuns[0]!.events.map((event) => event.kind)).toEqual([
      "run.created",
      "run.started",
      "plan.created",
      "task.created",
      "task.assigned",
      "task.started",
      "task.completed",
      "aggregation.started",
      "aggregation.completed",
      "run.completed"
    ]);
    expect(demoRuns[0]!.events.map((event) => event.state)).toEqual([
      "queued",
      "planning",
      "completed",
      "queued",
      "queued",
      "running",
      "completed",
      "running",
      "completed",
      "completed"
    ]);
  });

  it("keeps native events and Portal evidence in separate records", () => {
    const extractionFailure = demoBatches[0]!.items.find((item) => item.trace.outcome === "extraction_failed")!;
    expect(extractionFailure.trace.events.at(-1)).toMatchObject({ kind: "run.completed", state: "completed" });
    expect(extractionFailure.evidence.map((record) => record.source)).toEqual(["aigo", "portal"]);
    expect(extractionFailure.links[0]).toMatchObject({ relation: "same_evaluated_item" });
  });

  it("records the protocol and exact clock for each mock data arrival", () => {
    const arrivals = dataArrivalsFor(demoBatches[0]!.items[0]!, "2026-08-22T02:00:00.000Z");
    expect(arrivals.map((arrival) => arrival.protocol)).toEqual([
      "Native execution event ledger",
      "Completed history JSON export",
      "Run-details JSON export",
      "Evidence link · no field merge",
      "Application module load"
    ]);
    expect(arrivals.at(-1)?.recordedAt).toBe("2026-08-22T02:00:00.000Z");
  });

  it("models execution settings at the batch boundary", () => {
    expect(demoBatches[0]).toMatchObject({
      settings: {
        maxConcurrentTasks: 1,
        maxTasks: 1,
        taskTimeoutSeconds: 240,
        directRequestByteLimit: 65_536
      }
    });
    expect(demoBatches[0]!.items.map((item) => item.trace.runId)).toEqual(demoRuns.map((run) => run.runId));
  });

  it("keeps every expanded item projection inside the run schema", () => {
    for (const run of demoRuns) expect(validateSchema("run", run).ok).toBe(true);
  });
});
