import { describe, expect, it } from "vitest";
import { capShare, comparisonIsMatched, dependencyWaveCount, finalAnswerPreview, formatDuration, taskCount, visibleEvents } from "./derive.ts";
import { demoRuns } from "./data/demo.ts";

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

  it("only compares scored runs from the same item", () => {
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[1]!)).toBe(true);
    expect(comparisonIsMatched(demoRuns[0]!, demoRuns[2]!)).toBe(false);
    const unknown = structuredClone(demoRuns[1]!);
    unknown.score = null;
    expect(comparisonIsMatched(demoRuns[0]!, unknown)).toBe(false);
  });

  it("previews final answers without losing the exact artifact", () => {
    expect(finalAnswerPreview("  ANSWER: D  ")).toBe("ANSWER: D");
    expect(finalAnswerPreview("\n\t")).toBe("Not observed");
    expect(finalAnswerPreview("*** PATCH START ***\nfile.py\n...")).toBe("*** PATCH START *** · 31 chars");
  });
});
