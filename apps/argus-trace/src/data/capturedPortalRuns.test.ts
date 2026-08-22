import { describe, expect, it } from "vitest";
import { isArgusRun } from "../contracts.ts";
import { notGradedItems, weightedPortalScore } from "../derive.ts";
import { dataArrivalsFor } from "./demo.ts";
import { addedPortalReports } from "./portalReports.ts";
import { capturedPortalBatch, capturedPortalRuns } from "./capturedPortalRuns.ts";

describe("captured ranked Portal runs", () => {
  it("adds all three captures as separate valid sidebar runs", () => {
    expect(capturedPortalRuns.map((run) => run.runId)).toEqual([
      "couchpotato-hidden-c9f31618",
      "demodaycare-hidden-bce040e5",
      "couchpotato-hidden-cf5ccb29"
    ]);
    expect(capturedPortalRuns.every(isArgusRun)).toBe(true);
    expect(capturedPortalBatch.items).toHaveLength(3);
    expect(capturedPortalRuns.map((run) => run.portalRunId)).toEqual(addedPortalReports.map((report) => report.reportId));
    expect(capturedPortalRuns.every((run) => run.detail?.tasks.length === 0)).toBe(true);
  });

  it("preserves the token totals shown in the captures", () => {
    expect(addedPortalReports[0]).toMatchObject({
      team: "CouchPotato",
      score: 0.285,
      executionTimeMs: 688_000,
      tokens: { input: 2_294_626, output: 563_661, total: 2_858_287 },
      modelUsage: [{ inputTokens: 2_294_626, outputTokens: 563_661, requests: 802, totalTokens: 2_858_287 }]
    });
    expect(addedPortalReports[1]).toMatchObject({
      team: "DemoDayCare",
      score: 0.393,
      executionTimeMs: 683_000,
      tokens: { input: 1_250_739, output: 514_142, total: 1_764_881 },
      modelUsage: [
        { inputTokens: 126_534, outputTokens: 293_098, requests: 112, totalTokens: 419_632 },
        { inputTokens: 1_124_205, outputTokens: 221_044, requests: 147, totalTokens: 1_345_249 }
      ]
    });
    expect(addedPortalReports[2]).toMatchObject({
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
    expect(notGradedItems(addedPortalReports[0]!)).toBe(1);
    expect(notGradedItems(addedPortalReports[1]!)).toBe(1);
    expect(notGradedItems(addedPortalReports[2]!)).toBe(0);
    const arrivals = dataArrivalsFor(capturedPortalBatch.items[0]!, "2026-08-23T00:00:00.000Z");
    expect(arrivals.at(-1)).toMatchObject({ source: "Bundled evidence projection", protocol: "Application module load" });
  });
});
