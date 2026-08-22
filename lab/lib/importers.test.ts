import { describe, expect, it } from "vitest";
import { mergeRuns, normalizeAigoExport, normalizePortalExport } from "./importers.ts";
import { validateSchema } from "./schema.ts";

describe("evidence importers", () => {
  it("normalizes portal model/task/cap breakdowns", () => {
    const run = normalizePortalExport({
      run_id: "portal-42",
      track: "coding",
      dataset: "visible-swebench",
      item_id: "coding-01",
      status: "completed",
      score: 1,
      final_answer: "*** PATCH START ***\n...\n*** PATCH END ***",
      outcome: "graded",
      caps: { per_run_token_cap: 100000, per_item_wallclock_seconds: 300, usedTokens: 1100, elapsedMs: 2200 },
      model_breakdown: [{ model: "furiosa-ai/Qwen3-32B-FP8", calls: 2, input_tokens: 1000, output_tokens: 100, latency_ms: 2200 }],
      tasks: [{ id: "patch", title: "Produce minimal patch", agent: "ARGUS Solver", status: "completed", result: "minimal patch candidate produced", depends_on: ["inspect"], wave: 1 }],
      compliance: { userToolsZero: true, plannerNativeProtocol: true, memoryOff: true, outputContract: true }
    });
    expect(run.runId).toBe("portal-42");
    expect(run.totals.normalizedCost).toBe(220);
    expect(run.events).toHaveLength(2);
    expect(run.events[0]?.dependsOnTaskIds).toEqual(["inspect"]);
    expect(run.compliance.fallbackFree).toBe(true);
    expect(validateSchema("run", run).ok).toBe(true);
  });

  it("tags AI:GO fallback evidence", () => {
    const run = normalizeAigoExport({ runId: "local-1", track: "math", status: "failed", error: "Planner has no usable model" });
    expect(run.compliance.fallbackFree).toBe(false);
    expect(run.failure?.secondaryTags).toContain("FALLBACK_FANOUT");
  });

  it("normalizes an actual AI:GO history record without claiming it was graded", () => {
    const run = normalizeAigoExport({
      executionId: "aigo-42",
      request: "You are running ARGUS on the Math track. What is 2+2?",
      status: "completed",
      durationMs: 33304,
      totalTokenUsage: { promptTokens: 383, completionTokens: 200 },
      tasks: [{ taskId: "task-1", title: "Solve 2+2", agentName: "ARGUS Solver", status: "completed", output: "FINAL ANSWER: \\boxed{4}", durationMs: 3398 }],
      finalResult: "Execution complete — 1 task processed."
    });
    expect(run.track).toBe("math");
    expect(run.outcome).toBe("unknown");
    expect(run.finalAnswer).toContain("Execution complete");
    expect(run.totals.input).toBe(383);
    expect(run.events.at(-1)?.decision).toContain("FINAL ANSWER");
    expect(run.compliance.outputContract).toBe(false);
  });

  it("reconciles portal truth with AI:GO task evidence", () => {
    const aigo = normalizeAigoExport({
      executionId: "local-42",
      track: "math",
      status: "completed",
      tasks: [{ taskId: "solve", status: "completed", output: "FINAL ANSWER: \\boxed{4}" }],
      totalTokenUsage: { promptTokens: 20, completionTokens: 5 }
    }, "aigo.json");
    const portal = normalizePortalExport({
      run_id: "portal-42",
      portal_run_id: "portal-42",
      track: "math",
      dataset: "MATH-500",
      item_id: "math-visible-1",
      status: "completed",
      score: 1,
      outcome: "graded",
      final_answer: "FINAL ANSWER: \\boxed{4}",
      caps: { per_run_token_cap: 1000, usedTokens: 25 }
    }, "portal.json");
    const merged = mergeRuns(portal, aigo);
    expect(merged.source).toBe("merged");
    expect(merged.score).toBe(1);
    expect(merged.caps.runTokens).toBe(1000);
    expect(merged.events.some((event) => event.taskId === "solve")).toBe(true);
    expect(merged.rawEvidenceRefs).toEqual(["aigo.json", "portal.json"]);
  });
});
