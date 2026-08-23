import { describe, expect, it } from "vitest";
import { isArgusRun } from "./contracts.ts";
import {
  capShare,
  comparisonIsMatched,
  costEfficiencyIndex,
  dependencyWaveCount,
  eventStart,
  finalAnswerPreview,
  formatDuration,
  notGradedItems,
  observedSum,
  portalTokenEfficiency,
  taskCount,
  timelineDuration,
  tokenTotal,
  traceCallSpans,
  visibleEvents,
  visibleTraceCallEvents,
  weightedPortalScore
} from "./derive.ts";
import { dataArrivalsFor, demoBatches, demoRuns } from "./data/demo.ts";
import { demoPortalReports } from "./data/portalReports.ts";

const runById = (runId: string) => demoRuns.find((run) => run.runId === runId)!;

describe("trace derivations", () => {
  it("reveals at least the first event while replaying", () => {
    expect(visibleEvents(demoRuns[0]!.events, 0)).toHaveLength(1);
    expect(visibleEvents(demoRuns[0]!.events, 1)).toHaveLength(demoRuns[0]!.events.length);
  });

  it("reveals events by observed time instead of array position", () => {
    const first = demoRuns[0]!.events[0]!;
    const events = [
      { ...first, eventId: "at-start", timestamp: "2026-08-22T00:00:00.000Z" },
      { ...first, eventId: "at-one-second", timestamp: "2026-08-22T00:00:01.000Z" },
      { ...first, eventId: "at-ten-seconds", timestamp: "2026-08-22T00:00:10.000Z" }
    ];
    expect(visibleEvents(events, .3).map((event) => event.eventId)).toEqual(["at-start", "at-one-second"]);
    expect(visibleEvents([...events].reverse(), .3).map((event) => event.eventId)).toEqual(["at-start", "at-one-second"]);
  });

  it("anchors replay timing to the execution start and completion", () => {
    const run = structuredClone(demoRuns[0]!);
    const firstEventAt = new Date(run.events[0]!.timestamp).valueOf();
    run.detail!.startedAt = new Date(firstEventAt - 1_000).toISOString();
    run.detail!.completedAt = new Date(firstEventAt + 44_000).toISOString();
    expect(timelineDuration(run)).toBe(45_000);
    expect(eventStart(run, run.events[0]!)).toBe(1_000);
    expect(visibleEvents(run.events, 0, timelineDuration(run), run.detail!.startedAt)).toHaveLength(1);
  });

  it("computes cap share and readable duration", () => {
    const run = demoRuns[0]!;
    expect(capShare(run)).toBeCloseTo((run.totals.input! + run.totals.output!) / 12_000);
    expect(formatDuration(74_000)).toBe("1m 14s");
  });

  it("derives task topology from the event evidence", () => {
    expect(taskCount(runById("AIGO-R11-TRI-MODEL"))).toBe(4);
    expect(dependencyWaveCount(runById("AIGO-R11-TRI-MODEL"))).toBe(2);
    expect(taskCount(runById("AIGO-R02-UNIVERSAL"))).toBe(1);
    expect(dependencyWaveCount(runById("AIGO-R02-UNIVERSAL"))).toBe(1);
    expect(taskCount(runById("AIGO-R08-CODE-VERIFY"))).toBe(4);
    expect(dependencyWaveCount(runById("AIGO-R08-CODE-VERIFY"))).toBe(3);
  });

  it("keeps three-model calls and context limits visible in the showcase run", () => {
    const run = runById("AIGO-R11-TRI-MODEL");
    expect(run.modelUsage).toEqual(expect.arrayContaining([
      expect.objectContaining({ model: "furiosa-ai/Qwen3-32B-FP8", calls: 2, contextWindowTokens: 40_000 }),
      expect.objectContaining({ model: "furiosa-ai/gpt-oss-120b", calls: 1, contextWindowTokens: 128_000 }),
      expect.objectContaining({ model: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", calls: 2, contextWindowTokens: 48_000 })
    ]));
    expect(run.events.filter((event) => event.model != null)).toHaveLength(5);
  });

  it("only compares scored runs for the same observed item", () => {
    const primary = demoRuns[0]!;
    const matched = structuredClone(primary);
    matched.runId = "MATCHED-COPY";
    expect(comparisonIsMatched(primary, matched)).toBe(true);
    expect(comparisonIsMatched(primary, demoRuns[1]!)).toBe(false);
    matched.score = null;
    expect(comparisonIsMatched(primary, matched)).toBe(false);
  });

  it("maps visible-set normalized cost to a transparent efficiency index", () => {
    const lowestCost = demoRuns.reduce((best, run) => (run.totals.normalizedCost ?? Infinity) < (best.totals.normalizedCost ?? Infinity) ? run : best);
    const highestCost = demoRuns.reduce((worst, run) => (run.totals.normalizedCost ?? -Infinity) > (worst.totals.normalizedCost ?? -Infinity) ? run : worst);
    expect(costEfficiencyIndex(lowestCost, demoRuns)).toBe(100);
    expect(costEfficiencyIndex(highestCost, demoRuns)).toBe(0);
    expect(costEfficiencyIndex(demoRuns[0]!, [demoRuns[0]!])).toBe(100);
  });

  it("keeps unknown measurements distinct from recorded zeroes", () => {
    const unknown = structuredClone(demoRuns[0]!);
    unknown.dataset = null;
    unknown.caps.usedTokens = null;
    unknown.totals = { ...unknown.totals, input: null, normalizedCost: null, latencyMs: null };
    unknown.events[0]!.durationMs = null;
    unknown.events[0]!.tokens = { ...unknown.events[0]!.tokens, input: null, output: null };
    expect(capShare(unknown)).toBeNull();
    expect(costEfficiencyIndex(unknown, demoRuns)).toBeNull();
    expect(comparisonIsMatched(demoRuns[0]!, unknown)).toBe(false);
    expect(formatDuration(null)).toBe("Not observed");
    expect(observedSum(0, 0)).toBe(0);
    expect(observedSum(0, null)).toBeNull();
    expect(tokenTotal(unknown.events[0]!.tokens)).toBeNull();
  });

  it("covers fast paths, retries, partial route failures, contract misses, and caps", () => {
    expect(demoRuns.map((run) => run.outcome)).toEqual(expect.arrayContaining(["graded", "extraction_failed", "capped"]));
    expect(demoRuns.map((run) => run.status)).toEqual(expect.arrayContaining(["completed", "capped"]));

    const retry = runById("AIGO-R07-RETRY");
    expect(retry.detail!.tasks.map((task) => [task.status, task.retryCount])).toEqual([
      ["failed", 0],
      ["done", 1],
      ["done", 0]
    ]);

    const crossRoute = runById("AIGO-R05-CROSS-ROUTE");
    expect(crossRoute.detail!.tasks.map((task) => task.status)).toEqual(["failed", "failed", "done"]);

    expect(runById("AIGO-R04-CONTRACT")).toMatchObject({ outcome: "extraction_failed", compliance: { outputContract: false } });
    expect(runById("AIGO-R03-MATH-TIMEOUT")).toMatchObject({ status: "capped", outcome: "capped" });
  });

  it("keeps the direct route to one task and two trace calls", () => {
    const run = runById("AIGO-R02-UNIVERSAL");
    expect(taskCount(run)).toBe(1);
    expect(run.events.filter((event) => event.model != null).map((event) => event.kind)).toEqual(["plan.created", "task.completed"]);
    expect(run.events.filter((event) => event.kind === "task.created" || event.kind === "task.assigned" || event.kind === "task.started").every((event) => event.model == null)).toBe(true);
    expect(traceCallSpans(run).map((call) => call.event.kind)).toEqual(["plan.created", "task.completed"]);
    expect(visibleTraceCallEvents(run, 1).map((event) => event.kind)).toEqual(["plan.created", "task.completed"]);
  });

  it("keeps source-backed task calls visible when the model name is absent", () => {
    const run = structuredClone(runById("AIGO-R02-UNIVERSAL"));
    run.events.forEach((event) => { event.model = null; });
    run.modelUsage = [];
    expect(traceCallSpans(run)).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ kind: "plan.created", model: null }), durationMs: expect.any(Number) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "task.completed", model: null }), durationMs: expect.any(Number) })
    ]);
  });

  it("labels model calls consistently across all thirteen runs", () => {
    expect(demoRuns).toHaveLength(13);
    expect(new Set(demoRuns.map((run) => run.runId)).size).toBe(13);
    for (const run of demoRuns) {
      const modelEvents = run.events.filter((event) => event.model != null);
      expect(modelEvents.every((event) => (tokenTotal(event.tokens) ?? 0) > 0 || (event.durationMs ?? 0) > 0)).toBe(true);
      expect(run.events.filter((event) => event.kind === "run.started" || event.kind === "task.assigned" || event.kind === "task.started").every((event) => event.model == null)).toBe(true);
      expect(run.modelUsage.reduce((total, usage) => total + (usage.calls ?? 0), 0)).toBe(modelEvents.length);
    }
  });

  it("keeps Compare Runs reports coherent with Run Detail data", () => {
    expect(demoPortalReports).toHaveLength(13);
    expect(demoPortalReports.map((report) => report.runName)).toEqual(demoRuns.map((run) => run.runId));

    for (const [index, report] of demoPortalReports.entries()) {
      const run = demoRuns[index]!;
      expect(report.reportId).toBe(run.portalRunId);
      expect(weightedPortalScore(report)).toBeCloseTo(report.score, 8);
      expect(report.score).toBe(run.score);
      expect(report.executionTimeMs).toBe(run.totals.latencyMs);
      expect(report.tokens.input).toBe(run.totals.input);
      expect(report.tokens.output).toBe(run.totals.output);
      expect(report.tokens.input + report.tokens.output).toBe(report.tokens.total);
      expect(report.modelUsage.reduce((total, model) => total + model.inputTokens, 0)).toBe(report.tokens.input);
      expect(report.modelUsage.reduce((total, model) => total + model.outputTokens, 0)).toBe(report.tokens.output);
      expect(report.modelUsage.reduce((total, model) => total + model.totalTokens, 0)).toBe(report.tokens.total);
      expect(report.trackResults.reduce((total, track) => total + track.graded, 0)).toBe(report.scoredItems);
      expect(report.trackResults.reduce((total, track) => total + track.items, 0)).toBe(report.totalItems);
      expect(report.caps).toEqual({ wallClockSeconds: 240, tokenLimit: 12_000 });
      expect(report.evidence.protocol).toBe("Run-details JSON export");
      expect(portalTokenEfficiency(report)).toBeGreaterThan(0);
    }

    expect(notGradedItems(demoPortalReports.find((report) => report.runName === "AIGO-R03-MATH-TIMEOUT")!)).toBe(10);
  });

  it("models an irregular experiment history with evening density and score regressions", () => {
    const chronological = [...demoRuns].reverse();
    const timestamps = chronological.map((run) => new Date(run.detail!.startedAt!).valueOf());
    const scores = chronological.map((run) => run.score!);
    const intervals = timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index]!);
    const regressions = scores.slice(1).filter((score, index) => score < scores[index]!).length;
    const eveningRuns = chronological.filter((run) => {
      const startedAt = run.detail!.startedAt!;
      return startedAt.startsWith("2026-08-22T") && Number(startedAt.slice(11, 13)) >= 18;
    });

    expect(timestamps).toEqual([...timestamps].sort((left, right) => left - right));
    expect(chronological[0]!.detail!.startedAt).toBe("2026-08-22T15:02:11.000Z");
    expect(new Date(chronological.at(-1)!.detail!.completedAt!).valueOf()).toBeLessThan(new Date("2026-08-23T10:30:00.000Z").valueOf());
    expect(new Set(intervals).size).toBe(intervals.length);
    expect(eveningRuns).toHaveLength(7);
    expect(regressions).toBeGreaterThanOrEqual(4);
    expect(demoRuns[0]!.detail!.planTitle).toBe("Four-agent final verification");
    expect(demoRuns[1]!.detail!.planTitle).toBe("Two-agent cached rerun");

    const agentCount = (runId: string) => new Set(runById(runId).detail!.tasks.map((task) => task.agentId)).size;
    expect(agentCount("AIGO-R13-CACHED-RERUN")).toBe(2);
    expect(agentCount("AIGO-R14-FINAL-CHECK")).toBe(4);
  });

  it("previews final answers without losing the exact artifact", () => {
    expect(finalAnswerPreview("  ANSWER: D  ")).toBe("ANSWER: D");
    expect(finalAnswerPreview("\n\t")).toBe("Not observed");
    expect(finalAnswerPreview("*** PATCH START ***\nfile.py\n...")).toBe("*** PATCH START *** · 31 chars");
  });

  it("uses native AI:GO event labels while preserving normalized UI kinds", () => {
    const sourceTypes = new Set(demoRuns.flatMap((run) => run.events.map((event) => event.raw?.sourceEventType)));
    expect(sourceTypes.has("squad:planning-started")).toBe(true);
    expect(sourceTypes.has("squad:plan-ready")).toBe(true);
    expect(sourceTypes.has("squad:task-wave-started")).toBe(true);
    expect(sourceTypes.has("squad:task-status-changed")).toBe(true);
    expect(sourceTypes.has("squad:task-completed")).toBe(true);
    expect(sourceTypes.has("squad:aggregation-started")).toBe(true);
    expect(sourceTypes.has("squad:execution-completed")).toBe(true);
    expect(demoRuns.every((run) => run.events.every((event) => event.raw?.sourceEventType != null && event.raw?.joinConfidence != null))).toBe(true);
  });

  it("keeps native events and Portal evidence in separate records", () => {
    const completed = demoBatches[0]!.items.find((item) => item.trace.status === "completed")!;
    expect(completed.trace.events.at(-1)).toMatchObject({ kind: "run.completed", state: "completed" });
    expect(completed.evidence.map((record) => record.source)).toEqual(["aigo", "portal"]);
    expect(completed.links[0]).toMatchObject({ relation: "same_evaluated_item" });
  });

  it("records the protocol and exact clock for each mock data arrival", () => {
    const arrivals = dataArrivalsFor(demoBatches[0]!.items[0]!, "2026-08-23T02:00:00.000Z");
    expect(arrivals.map((arrival) => arrival.protocol)).toEqual([
      "Native execution event ledger",
      "Completed history JSON export",
      "Run-details JSON export",
      "Evidence link · no field merge",
      "Application module load"
    ]);
    expect(arrivals.at(-1)?.recordedAt).toBe("2026-08-23T02:00:00.000Z");
  });

  it("models the observed execution settings at the batch boundary", () => {
    expect(demoBatches[0]).toMatchObject({
      name: "AI:GO demo experiments · 13 runs",
      settings: {
        maxConcurrentTasks: 5,
        maxTasks: 5,
        taskTimeoutSeconds: 180,
        directRequestByteLimit: 65_536
      }
    });
    expect(demoBatches[0]!.items.map((item) => item.trace.runId)).toEqual(demoRuns.map((run) => run.runId));
  });

  it("keeps every demo projection inside the existing frontend run contract", () => {
    for (const run of demoRuns) expect(isArgusRun(run)).toBe(true);
    expect(isArgusRun({ runId: "incomplete", events: [] })).toBe(false);
  });
});
