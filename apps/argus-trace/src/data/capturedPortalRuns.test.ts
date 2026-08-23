import { describe, expect, it } from "vitest";
import { isArgusRun } from "../contracts.ts";
import { notGradedItems, weightedPortalScore } from "../derive.ts";
import { dataArrivalsFor } from "./demo.ts";
import { addedPortalReports } from "./portalReports.ts";
import { capturedPortalBatch, capturedPortalRuns } from "./capturedPortalRuns.ts";

describe("captured ranked Portal runs", () => {
  it("adds all five captures as separate valid sidebar runs", () => {
    expect(capturedPortalRuns.map((run) => run.runId)).toEqual([
      "limitedbeannoodle-hidden-1b3906fa",
      "noonchcoach-hidden-90825d8d",
      "couchpotato-hidden-c9f31618",
      "demodaycare-hidden-bce040e5",
      "couchpotato-hidden-cf5ccb29"
    ]);
    expect(capturedPortalRuns.every(isArgusRun)).toBe(true);
    expect(capturedPortalBatch.items).toHaveLength(5);
    expect(capturedPortalRuns.map((run) => run.portalRunId)).toEqual(addedPortalReports.map((report) => report.reportId));
    expect(capturedPortalRuns.every((run) => run.detail?.tasks.length === 0)).toBe(true);
  });

  it("preserves the token totals shown in the captures", () => {
    expect(addedPortalReports[0]).toMatchObject({
      team: "LimitedBeanNoodle",
      score: 0.406,
      executionTimeMs: 774_000,
      tokens: { input: 2_206_728, output: 560_932, total: 2_767_660 },
      modelUsage: [{ inputTokens: 2_206_728, outputTokens: 560_932, requests: 566, totalTokens: 2_767_660 }]
    });
    expect(addedPortalReports[1]).toMatchObject({
      team: "Noonchcoach",
      score: 0.35,
      executionTimeMs: 524_000,
      tokens: { input: 1_845_542, output: 423_809, total: 2_269_351 },
      modelUsage: [{ inputTokens: 1_845_542, outputTokens: 423_809, requests: 539, totalTokens: 2_269_351 }]
    });
    expect(addedPortalReports[2]).toMatchObject({
      team: "CouchPotato",
      score: 0.285,
      executionTimeMs: 688_000,
      tokens: { input: 2_294_626, output: 563_661, total: 2_858_287 },
      modelUsage: [{ inputTokens: 2_294_626, outputTokens: 563_661, requests: 802, totalTokens: 2_858_287 }]
    });
    expect(addedPortalReports[3]).toMatchObject({
      team: "DemoDayCare",
      score: 0.393,
      executionTimeMs: 683_000,
      tokens: { input: 1_250_739, output: 514_142, total: 1_764_881 },
      modelUsage: [
        { inputTokens: 126_534, outputTokens: 293_098, requests: 112, totalTokens: 419_632 },
        { inputTokens: 1_124_205, outputTokens: 221_044, requests: 147, totalTokens: 1_345_249 }
      ]
    });
    expect(addedPortalReports[4]).toMatchObject({
      team: "CouchPotato",
      score: 0.045,
      executionTimeMs: 556_000,
      tokens: { input: 4_848_875, output: 519_605, total: 5_368_480 },
      modelUsage: [{ inputTokens: 4_848_875, outputTokens: 519_605, requests: 1_573, totalTokens: 5_368_480 }]
    });
    for (const report of addedPortalReports) {
      expect(report.modelUsage.reduce((sum, usage) => sum + usage.totalTokens, 0)).toBe(report.tokens.total);
      expect(weightedPortalScore(report)).toBeCloseTo(report.score, 3);
    }
  });

  it("keeps the hidden-item grading counts and bundled provenance", () => {
    expect(addedPortalReports.map(notGradedItems)).toEqual([3, 3, 1, 1, 0]);
    const arrivals = dataArrivalsFor(capturedPortalBatch.items[0]!, "2026-08-23T00:00:00.000Z");
    expect(arrivals.at(-1)).toMatchObject({ source: "Bundled evidence projection", protocol: "Application module load" });
  });
});
