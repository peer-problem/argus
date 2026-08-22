import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("practice corpus lock", () => {
  it("keeps the recorded archive digest and track totals internally consistent", () => {
    const summary = JSON.parse(readFileSync("practice/manifests/visible-set.summary.json", "utf8"));
    const coding = JSON.parse(readFileSync("practice/manifests/coding-visible.requests.json", "utf8"));
    const checksum = readFileSync("practice/checksums/archive.sha256", "utf8").trim().split(/\s+/)[0];
    expect(summary.archiveSha256).toBe(checksum);
    expect(summary.tracks.coding.count + summary.tracks.math.count + summary.tracks.generic.count).toBe(summary.total);
    expect(summary.total).toBe(121);
    expect(summary.largestVisibleRequestBytes).toBe(70_310);
    expect(coding.items).toHaveLength(summary.tracks.coding.count);
    expect(coding.items.filter((item: { kind: string }) => item.kind === "swebench")).toHaveLength(summary.tracks.coding.swebench);
    expect(coding.items.filter((item: { kind: string }) => item.kind === "livecodebench")).toHaveLength(summary.tracks.coding.livecodebench);
    expect(Math.max(...coding.items.map((item: { sourceBytes: number }) => item.sourceBytes))).toBe(summary.largestVisibleRequestBytes);
  });

  it("locks the requested calibration matrix without claiming live runs", () => {
    const plan = JSON.parse(readFileSync("practice/manifests/calibration-plan.json", "utf8"));
    const checksum = readFileSync("practice/checksums/archive.sha256", "utf8").trim().split(/\s+/)[0];
    expect(plan).toMatchObject({
      status: "plan-only",
      archiveSha256: checksum,
      execution: { liveRuns: 0, readyForExecution: false, requiresApproval: true }
    });
    expect(plan.models.solverMatrix).toEqual([
      "furiosa-ai/Qwen3-32B-FP8",
      "furiosa-ai/gpt-oss-120b",
      "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16"
    ]);
    expect(plan.models.plannerEligible).toEqual([
      "furiosa-ai/Qwen3-32B-FP8",
      "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16"
    ]);
    expect(plan.models.plannerExcluded).toEqual(["furiosa-ai/gpt-oss-120b"]);
    expect(plan.subsets.swebench.selected).toHaveLength(5);
    expect(plan.subsets.swebench.directEligible).toHaveLength(4);
    expect(plan.subsets.swebench.ready).toBe(false);
    expect(plan.subsets.livecodebench.selected.length).toBeGreaterThanOrEqual(5);
    expect(plan.subsets.math.math500.length + plan.subsets.math.aime2024.length).toBeGreaterThanOrEqual(18);
    expect(plan.subsets.math.repeats).toBe(2);
    expect(plan.subsets.math.ready).toBe(false);
    const genericSubjects = plan.subsets.generic.selected.map((entry: { subject: string }) => entry.subject);
    expect(new Set(genericSubjects).size).toBe(plan.subsets.generic.requiredSubjects);
    expect(plan.subsets.generic.selected).toHaveLength(14);
  });
});
