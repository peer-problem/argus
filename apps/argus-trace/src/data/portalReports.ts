import type { PortalBatchRunReport, Track } from "../types.ts";
import { demoBenchProfiles, demoRuns } from "./demo.ts";

const tracks: Array<Exclude<Track, "unknown">> = ["coding", "math", "generic"];
const weights: Record<Exclude<Track, "unknown">, number> = { coding: .5, math: .25, generic: .25 };

function observed(value: number | null | undefined, field: string, runId: string): number {
  if (value == null) throw new Error(`${runId} is missing ${field}.`);
  return value;
}

/** Thirteen coherent demo reports derived from the same runs shown in Run Detail. */
export const demoPortalReports: PortalBatchRunReport[] = demoRuns.map((run) => {
  const profile = demoBenchProfiles[run.runId];
  if (!profile) throw new Error(`${run.runId} is missing a demo bench profile.`);
  const trackResults = tracks.map((track) => {
    const graded = profile.graded?.[track] ?? 8;
    return {
      track,
      accuracy: profile[track],
      graded,
      items: 8,
      excluded: 8 - graded,
      weight: weights[track]
    };
  });
  const input = observed(run.totals.input, "input tokens", run.runId);
  const output = observed(run.totals.output, "output tokens", run.runId);
  return {
    reportId: run.portalRunId!,
    source: "portal",
    team: "ARGUS Demo Lab",
    runName: run.runId,
    status: run.status,
    score: observed(run.score, "bench score", run.runId),
    scoredItems: trackResults.reduce((total, result) => total + result.graded, 0),
    totalItems: trackResults.reduce((total, result) => total + result.items, 0),
    executionTimeMs: observed(run.totals.latencyMs, "latency", run.runId),
    tokens: { input, output, total: input + output },
    caps: { wallClockSeconds: run.caps.itemWallclockSeconds, tokenLimit: run.caps.runTokens },
    postedAt: run.detail!.completedAt!,
    modelUsage: run.modelUsage.map((usage) => ({
      model: usage.model,
      inputTokens: observed(usage.input, "model input tokens", run.runId),
      outputTokens: observed(usage.output, "model output tokens", run.runId),
      requests: observed(usage.calls, "model calls", run.runId),
      totalTokens: observed(usage.input, "model input tokens", run.runId) + observed(usage.output, "model output tokens", run.runId)
    })),
    trackResults,
    evidence: {
      protocol: "Run-details JSON export",
      receivedAt: run.importedAt,
      reference: `demo://portal/${run.portalRunId}.json`
    }
  };
});
