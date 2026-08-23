import { describe, expect, it } from "vitest";
import { isArgusRun } from "./contracts.ts";
import { capShare, comparisonIsMatched, costEfficiencyIndex, dependencyWaveCount, eventStart, finalAnswerPreview, formatDuration, notGradedItems, observedSum, portalTokenEfficiency, taskCount, timelineDuration, tokenTotal, traceCallSpans, visibleEvents, visibleTraceCallEvents, weightedPortalScore } from "./derive.ts";
import { dataArrivalsFor, demoBatches, demoRuns } from "./data/demo.ts";
import { addedPortalReports, capturedPortalReports, demoLinkedPortalReports } from "./data/portalReports.ts";

describe("trace derivations", () => {
  it("reveals at least the first event while replaying", () => {
    expect(visibleEvents(demoRuns[0]!.events, 0)).toHaveLength(1);
    expect(visibleEvents(demoRuns[0]!.events, 1)).toHaveLength(demoRuns[0]!.events.length);
  });

  it("reveals events by their observed time, not their position in the array", () => {
    const first = demoRuns[0]!.events[0]!;
    const events = [
      { ...first, eventId: "at-start", timestamp: "2026-08-22T00:00:00.000Z" },
      { ...first, eventId: "at-one-second", timestamp: "2026-08-22T00:00:01.000Z" },
      { ...first, eventId: "at-ten-seconds", timestamp: "2026-08-22T00:00:10.000Z" }
    ];
    expect(visibleEvents(events, .3).map((event) => event.eventId)).toEqual(["at-start", "at-one-second"]);
    expect(visibleEvents([...events].reverse(), .3).map((event) => event.eventId)).toEqual(["at-start", "at-one-second"]);
  });

  it("anchors replay timing to the recorded execution start and completion", () => {
    const run = structuredClone(demoRuns[0]!);
    run.detail!.startedAt = "2026-08-22T00:59:59.000Z";
    run.detail!.completedAt = "2026-08-22T01:00:44.000Z";
    expect(timelineDuration(run)).toBe(45_000);
    expect(eventStart(run, run.events[0]!)).toBe(1_000);
    expect(visibleEvents(run.events, 0, timelineDuration(run), run.detail!.startedAt)).toHaveLength(1);
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
    expect(complex.events.filter((event) => event.model?.includes("Qwen3") && (event.tokens.input ?? 0) > 0)).toHaveLength(2);
    expect(complex.events.filter((event) => event.model?.includes("gpt-oss") && (event.tokens.input ?? 0) > 0)).toHaveLength(2);
  });

  it("only compares scored runs from the same item", () => {
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[1]!)).toBe(true);
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[2]!)).toBe(false);
    const unknown = structuredClone(demoRuns[1]!);
    unknown.score = null;
    expect(comparisonIsMatched(demoRuns[0]!, unknown)).toBe(false);
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

  it("covers success, limits, failures, and source measurement gaps in the mock evidence", () => {
    expect(demoRuns.map((run) => run.outcome)).toEqual(expect.arrayContaining(["graded", "capped", "infrastructure_failed"]));
    expect(demoRuns.map((run) => run.status)).toEqual(expect.arrayContaining(["completed", "capped", "failed"]));

    const partiallyObserved = demoRuns.find((run) => run.runId === "ARGUS-C5-061")!;
    expect(partiallyObserved).toMatchObject({ dataset: null, score: null, totals: { cachedInput: null, normalizedCost: null } });
    expect(partiallyObserved.events.every((event) => event.durationMs == null && event.tokens.cachedInput == null && event.tokens.normalizedCost == null)).toBe(true);
    expect(partiallyObserved.modelUsage.every((model) => model.cachedInput == null && model.normalizedCost == null && model.latencyMs == null)).toBe(true);

    const multiWave = demoRuns.find((run) => run.runId === "ARGUS-C4-052")!;
    expect(taskCount(multiWave)).toBe(2);
    expect(dependencyWaveCount(multiWave)).toBe(2);
    expect(multiWave.events.every((event) => event.raw?.joinConfidence === "confirmed" && event.raw?.sourceEventType != null)).toBe(true);

    const capped = demoRuns.find((run) => run.runId === "ARGUS-C2-031")!;
    expect(capped.events).toEqual(expect.arrayContaining([expect.objectContaining({ raw: expect.objectContaining({ sourceEventType: "squad:agent-state-changed", joinConfidence: "inferred" }) })]));
  });

  it("keeps ARGUS-C3-044 as one task and labels only token-bearing model calls", () => {
    const run = demoRuns.find((candidate) => candidate.runId === "ARGUS-C3-044")!;
    expect(taskCount(run)).toBe(1);
    expect(run.events.some((event) => event.taskTitle?.startsWith("Unexpected additional"))).toBe(false);
    expect(run.events.filter((event) => event.model != null).map((event) => event.kind)).toEqual(["plan.created", "task.completed"]);
    expect(run.events.filter((event) => event.kind === "task.created" || event.kind === "task.assigned" || event.kind === "task.started").every((event) => event.model == null)).toBe(true);
    expect(run.modelUsage).toEqual([
      expect.objectContaining({ model: "furiosa-ai/Qwen3-32B-FP8", calls: 1 }),
      expect.objectContaining({ model: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16", calls: 1 })
    ]);
    expect(traceCallSpans(run).map((call) => call.event.kind)).toEqual(["plan.created", "task.completed"]);
    expect(visibleTraceCallEvents(run, 1).map((event) => event.kind)).toEqual(["plan.created", "task.completed"]);
  });

  it("keeps source-backed task calls visible when the model name is not observed", () => {
    const run = structuredClone(demoRuns.find((candidate) => candidate.runId === "ARGUS-C3-044")!);
    run.events.forEach((event) => { event.model = null; });
    run.modelUsage = [];
    expect(traceCallSpans(run)).toEqual([
      expect.objectContaining({ event: expect.objectContaining({ kind: "plan.created", model: null }), durationMs: expect.any(Number) }),
      expect.objectContaining({ event: expect.objectContaining({ kind: "task.completed", model: null }), durationMs: expect.any(Number) })
    ]);
  });

  it("labels model calls consistently across every mock run", () => {
    for (const run of demoRuns) {
      const modelEvents = run.events.filter((event) => event.model != null);
      expect(modelEvents.every((event) => (tokenTotal(event.tokens) ?? 0) > 0 || (event.durationMs ?? 0) > 0)).toBe(true);
      expect(run.events.filter((event) => event.kind === "run.started" || event.kind === "task.assigned" || event.kind === "task.started").every((event) => event.model == null)).toBe(true);
      expect(run.modelUsage.reduce((total, usage) => total + (usage.calls ?? 0), 0)).toBe(modelEvents.length);
    }
  });

  it("keeps Portal batch scoring and token efficiency explicit", () => {
    const report = demoLinkedPortalReports[0]!;
    expect(weightedPortalScore(report)).toBeCloseTo(0.426, 3);
    expect(report.score).toBe(0.426);
    expect(portalTokenEfficiency(report)).toBeCloseTo(16.84, 2);
    expect(notGradedItems(report)).toBe(2);
    expect(report.tokens.input + report.tokens.output).toBe(report.tokens.total);
    expect(report.modelUsage.reduce((total, model) => total + model.totalTokens, 0)).toBe(report.tokens.total);
  });

  it("preserves all eleven captured Portal reports without inventing missing evidence", () => {
    expect(addedPortalReports).toHaveLength(5);
    expect(demoLinkedPortalReports).toHaveLength(6);
    expect(capturedPortalReports).toHaveLength(11);
    expect(capturedPortalReports.map((report) => [report.team, report.runName, report.score])).toEqual([
      ["LimitedBeanNoodle", "limitedbeannoodle-hidden-1b3906fa", 0.406],
      ["Noonchcoach", "noonchcoach-hidden-90825d8d", 0.35],
      ["CouchPotato", "couchpotato-hidden-c9f31618", 0.285],
      ["DemoDayCare", "demodaycare-hidden-bce040e5", 0.393],
      ["CouchPotato", "couchpotato-hidden-cf5ccb29", 0.045],
      ["MISHULTA", "mishulta-hidden-8144245b", 0.426],
      ["TheresNoFree", "theresnofree-hidden", 0.403],
      ["CouchPotato", "couchpotato-hidden-a8fd641c", 0.254],
      ["LimitedBeanNoodle", "limitedbeannoodle-hidden", 0.253],
      ["CouchPotato", "couchpotato-hidden", 0.186],
      ["MakeTheWorldBetter", "maketheworldbetter-hidden", 0.17]
    ]);

    for (const report of capturedPortalReports) {
      expect(report.tokens.input + report.tokens.output).toBe(report.tokens.total);
      expect(report.modelUsage.reduce((total, model) => total + model.inputTokens, 0)).toBe(report.tokens.input);
      expect(report.modelUsage.reduce((total, model) => total + model.outputTokens, 0)).toBe(report.tokens.output);
      expect(report.modelUsage.reduce((total, model) => total + model.totalTokens, 0)).toBe(report.tokens.total);
      expect(report.trackResults.reduce((total, track) => total + track.graded, 0)).toBe(report.scoredItems);
      expect(report.trackResults.reduce((total, track) => total + track.items, 0)).toBe(report.totalItems);
      expect(weightedPortalScore(report)).toBeCloseTo(report.score, 2);
      expect(report.caps).toEqual({ wallClockSeconds: null, tokenLimit: null });
      expect(report.evidence).toMatchObject({ protocol: "Portal run detail capture", receivedAt: null });
    }

    expect(addedPortalReports[0]!.modelUsage[0]).toMatchObject({ requests: 566, totalTokens: 2_767_660 });
    expect(addedPortalReports[1]!.modelUsage[0]).toMatchObject({ requests: 539, totalTokens: 2_269_351 });
    expect(addedPortalReports[2]!.modelUsage[0]).toMatchObject({ requests: 802, totalTokens: 2_858_287 });
    expect(addedPortalReports[3]!.modelUsage[0]).toMatchObject({ requests: 112, totalTokens: 419_632 });
    expect(addedPortalReports[4]!.modelUsage[0]).toMatchObject({ requests: 1_573, totalTokens: 5_368_480 });
    expect(demoLinkedPortalReports[0]!.modelUsage[0]).toMatchObject({ requests: 327, totalTokens: 2_529_549 });
    expect(demoLinkedPortalReports[1]!.modelUsage[0]).toMatchObject({ requests: 26, totalTokens: 77_577 });
    expect(demoLinkedPortalReports[5]!.modelUsage[0]).toMatchObject({ requests: 1_464, totalTokens: 5_381_381 });
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
    const completed = demoBatches[0]!.items.find((item) => item.trace.status === "completed")!;
    expect(completed.trace.events.at(-1)).toMatchObject({ kind: "run.completed", state: "completed" });
    expect(completed.evidence.map((record) => record.source)).toEqual(["aigo", "portal"]);
    expect(completed.links[0]).toMatchObject({ relation: "same_evaluated_item" });
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

  it("keeps every expanded item projection inside the frontend run contract", () => {
    for (const run of demoRuns) expect(isArgusRun(run)).toBe(true);
    expect(isArgusRun({ runId: "incomplete", events: [] })).toBe(false);
  });
});
