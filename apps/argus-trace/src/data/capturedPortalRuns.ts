import type { ArgusBatch, ArgusEvent, ArgusRun, PortalBatchRunReport, TokenUsage } from "../types.ts";
import { addedPortalReports } from "./portalReports.ts";

function emptyTokens(): TokenUsage {
  return { input: null, output: null, reasoning: null, cachedInput: null, normalizedCost: null };
}

function startedAt(report: PortalBatchRunReport): string {
  return new Date(new Date(report.postedAt).valueOf() - report.executionTimeMs).toISOString();
}

function lifecycleEvents(report: PortalBatchRunReport): ArgusEvent[] {
  const start = startedAt(report);
  const common = {
    runId: report.runName,
    track: "unknown" as const,
    wave: null,
    taskId: null,
    taskTitle: null,
    dependsOnTaskIds: [] as string[],
    model: null,
    artifactRef: report.evidence.reference,
    candidateStatus: "observed" as const,
    tokens: emptyTokens(),
    durationMs: null,
    squadConfigHash: null,
    submissionJsonHash: null,
    promptHash: null
  };
  return [
    {
      ...common,
      eventId: `${report.runName}-started`,
      parentEventId: null,
      agentId: report.team,
      agentRole: "Portal team",
      kind: "run.started",
      state: "running",
      decision: "The ranked hidden evaluation started; per-item content is withheld by design.",
      timestamp: start,
      raw: { sourceEventType: "portal:run-started", evidenceScope: "aggregate-only" }
    },
    {
      ...common,
      eventId: `${report.runName}-completed`,
      parentEventId: `${report.runName}-started`,
      agentId: "AI:GO Portal",
      agentRole: "Evaluation Portal",
      kind: "run.completed",
      state: "completed",
      decision: `Portal recorded a ${(report.score * 100).toFixed(1)}% bench score across ${report.totalItems} hidden items.`,
      timestamp: report.postedAt,
      raw: { sourceEventType: "portal:run-completed", evidenceScope: "aggregate-only", scoredItems: report.scoredItems, totalItems: report.totalItems }
    }
  ];
}

function reportMarkdown(report: PortalBatchRunReport): string {
  const models = report.modelUsage.map((usage) => `- ${usage.model}: ${usage.inputTokens.toLocaleString("en-US")} input + ${usage.outputTokens.toLocaleString("en-US")} output = ${usage.totalTokens.toLocaleString("en-US")} tokens (${usage.requests.toLocaleString("en-US")} requests)`).join("\n");
  const tracks = report.trackResults.map((result) => `- ${result.track}: ${(result.accuracy * 100).toFixed(1)}% (${result.graded}/${result.items} graded)`).join("\n");
  return `# Portal run capture\n\n- Team: ${report.team}\n- Run: ${report.runName}\n- Status: ${report.status}\n- Bench score: ${(report.score * 100).toFixed(1)}%\n- Duration: ${Math.round(report.executionTimeMs / 1_000)} seconds\n- Total tokens: ${report.tokens.total.toLocaleString("en-US")}\n\n## Per-model usage\n\n${models}\n\n## Per-track results\n\n${tracks}\n\nIndividual hidden items are withheld by design and are not reconstructed in ARGUS.`;
}

function portalRun(report: PortalBatchRunReport): ArgusRun {
  return {
    runId: report.runName,
    portalRunId: report.reportId,
    source: "portal",
    track: "unknown",
    dataset: "Ranked hidden evaluation · items withheld",
    itemId: null,
    status: report.status,
    score: report.score,
    finalAnswer: null,
    outcome: "graded",
    failure: null,
    caps: { runTokens: report.caps.tokenLimit, itemWallclockSeconds: report.caps.wallClockSeconds, usedTokens: report.tokens.total, elapsedMs: report.executionTimeMs },
    totals: { input: report.tokens.input, output: report.tokens.output, reasoning: null, cachedInput: null, normalizedCost: null, latencyMs: report.executionTimeMs },
    modelUsage: report.modelUsage.map((usage) => ({ model: usage.model, calls: usage.requests, input: usage.inputTokens, output: usage.outputTokens, reasoning: null, cachedInput: null, normalizedCost: null, latencyMs: null, contextWindowTokens: null })),
    hashes: { dataset: null, squadConfig: null, submissionJson: null, prompt: null },
    compliance: { userToolsZero: null, plannerNativeProtocol: null, memoryOff: null, hashesPresent: null, outputContract: null, fallbackFree: null },
    events: lifecycleEvents(report),
    detail: {
      executionId: report.runName,
      squadId: null,
      squadName: report.team,
      request: "Ranked hidden evaluation; individual item content is withheld by design.",
      planTitle: `${report.team} · ${report.runName}`,
      startedAt: startedAt(report),
      completedAt: report.postedAt,
      tasks: [],
      console: [],
      reportMarkdown: reportMarkdown(report)
    },
    rawEvidenceRefs: [report.evidence.reference],
    importedAt: report.evidence.receivedAt ?? report.postedAt
  };
}

export const capturedPortalRuns: ArgusRun[] = addedPortalReports.map(portalRun);

export const capturedPortalBatch: ArgusBatch = {
  batchId: "batch-captured-portal-20260822-1718-1754",
  name: "Captured ranked Portal runs · Aug 22 17:18–17:54 UTC",
  source: "bundled",
  settings: { maxConcurrentTasks: null, maxTasks: null, taskTimeoutSeconds: null, directRequestByteLimit: null },
  items: capturedPortalRuns.map((run) => ({
    itemKey: `portal:${run.runId}`,
    trace: run,
    evidence: [{
      evidenceId: `${run.runId}-portal-capture`,
      source: "portal",
      protocol: "Portal run detail capture",
      emittedAt: run.detail?.completedAt ?? null,
      receivedAt: run.importedAt,
      fields: ["score", "status", "duration", "total tokens", "per-model usage", "per-track results", "caps"],
      reference: run.rawEvidenceRefs[0]!
    }],
    links: []
  })),
  createdAt: capturedPortalRuns.reduce((earliest, run) => run.detail!.startedAt < earliest ? run.detail!.startedAt : earliest, capturedPortalRuns[0]!.detail!.startedAt),
  completedAt: capturedPortalRuns.reduce((latest, run) => run.detail!.completedAt! > latest ? run.detail!.completedAt! : latest, capturedPortalRuns[0]!.detail!.completedAt!)
};
