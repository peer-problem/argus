import type { ArgusEvent, ArgusRun, Track } from "../types.ts";

const hash = (letter: string) => letter.repeat(64);

interface DemoSpec {
  runId: string;
  track: Exclude<Track, "unknown">;
  itemId: string;
  dataset: string;
  score: number;
  input: number;
  output: number;
  cached: number;
  cost: number;
  latency: number;
  coordinatorModel: string;
  workerModel: string;
  finalAnswer: string;
  status?: ArgusRun["status"];
  outcome?: ArgusRun["outcome"];
  failure?: ArgusRun["failure"];
  compliant?: boolean;
  taskCount?: number;
}

function event(spec: DemoSpec, index: number, partial: Partial<ArgusEvent>): ArgusEvent {
  const at = new Date(Date.UTC(2026, 7, 22, 1, 0, 0) + index * Math.max(500, spec.latency / 6));
  return {
    eventId: `${spec.runId}-evt-${String(index + 1).padStart(2, "0")}`,
    runId: spec.runId,
    parentEventId: index === 0 ? null : `${spec.runId}-evt-${String(index).padStart(2, "0")}`,
    track: spec.track,
    wave: index >= 2 && index <= 3 ? 0 : null,
    taskId: index >= 2 && index <= 3 ? "solve" : null,
    taskTitle: index >= 2 && index <= 3 ? "Produce one contract-valid answer" : null,
    agentId: index === 2 || index === 3 ? "Task Agent" : "Run Coordinator",
    agentRole: index === 2 || index === 3 ? "Worker" : "Coordinator",
    model: index === 2 || index === 3 ? spec.workerModel : spec.coordinatorModel,
    kind: "unknown",
    state: "running",
    decision: "",
    artifactRef: null,
    candidateStatus: "observed",
    tokens: { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 },
    durationMs: 0,
    timestamp: at.toISOString(),
    raw: { demo: true, sourceSequence: index },
    ...partial
  };
}

function splitUsage(spec: DemoSpec) {
  const workerInput = Math.round(spec.input * 0.56);
  const coordinatorInput = spec.input - workerInput;
  const coordinatorOutput = Math.round(spec.output * 0.3);
  const workerOutput = spec.output - coordinatorOutput;
  const planOutput = Math.round(coordinatorOutput * 0.62);
  const finalOutput = coordinatorOutput - planOutput;
  return { workerInput, coordinatorInput, workerOutput, coordinatorOutput, planOutput, finalOutput };
}

function makeEvents(spec: DemoSpec): ArgusEvent[] {
  const { finalOutput, planOutput, coordinatorInput, workerInput, workerOutput } = splitUsage(spec);
  const terminalFailed = spec.status === "capped" || spec.status === "failed";
  return [
    event(spec, 0, { kind: "run.started", state: "planning", decision: `${spec.track} request accepted; output contract identified.`, durationMs: 410 }),
    event(spec, 1, { kind: "plan.created", state: "completed", decision: `${spec.taskCount ?? 1} task${(spec.taskCount ?? 1) === 1 ? "" : "s"} observed in the run.`, durationMs: 890, tokens: { input: coordinatorInput, output: planOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.4), normalizedCost: spec.cost * 0.25 } }),
    event(spec, 2, { kind: "task.started", state: "running", decision: "Task execution started with the recorded run context.", durationMs: 180 }),
    event(spec, 3, { kind: terminalFailed ? "task.failed" : "task.completed", state: terminalFailed ? (spec.status === "capped" ? "capped" : "failed") : "completed", decision: terminalFailed ? (spec.failure?.message || "Task did not produce a gradeable artifact.") : spec.track === "coding" ? "Applicable patch candidate produced." : "Answer candidate produced.", artifactRef: terminalFailed ? null : `artifact://${spec.runId}/candidate.txt`, candidateStatus: terminalFailed ? "rejected" : "selected", durationMs: Math.round(spec.latency * 0.72), tokens: { input: workerInput, output: workerOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.6), normalizedCost: spec.cost * 0.62 } }),
    event(spec, 4, { kind: "aggregation.started", state: terminalFailed ? "failed" : "running", decision: terminalFailed ? "No valid candidate available for aggregation." : "Contract gate passed; verbatim aggregation selected.", durationMs: 260 }),
    event(spec, 5, { kind: spec.status === "capped" ? "run.capped" : spec.status === "failed" ? "run.failed" : "run.completed", state: spec.status === "capped" ? "capped" : spec.status === "failed" ? "failed" : "completed", decision: terminalFailed ? (spec.failure?.message || "Run ended without a valid artifact.") : "Final answer emitted without formatter rewrite.", artifactRef: terminalFailed ? null : `artifact://${spec.runId}/final.txt`, durationMs: 390, tokens: { input: 0, output: finalOutput, reasoning: 0, cachedInput: 0, normalizedCost: spec.cost * 0.13 } })
  ];
}

function makeRun(spec: DemoSpec): ArgusRun {
  const status = spec.status ?? "completed";
  const compliant = spec.compliant ?? true;
  const { coordinatorInput, coordinatorOutput, workerInput, workerOutput } = splitUsage(spec);
  const coordinatorUsage = { model: spec.coordinatorModel, calls: 1, input: coordinatorInput, output: coordinatorOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.4), normalizedCost: spec.cost * 0.38, latencyMs: Math.round(spec.latency * 0.28) };
  const workerUsage = { model: spec.workerModel, calls: 1, input: workerInput, output: workerOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.6), normalizedCost: spec.cost * 0.62, latencyMs: Math.round(spec.latency * 0.72) };
  const modelUsage = spec.coordinatorModel === spec.workerModel
    ? [{ ...coordinatorUsage, calls: 2, input: spec.input, output: spec.output, cachedInput: spec.cached, normalizedCost: spec.cost, latencyMs: spec.latency }]
    : [coordinatorUsage, workerUsage];
  return {
    runId: spec.runId,
    portalRunId: `portal-${spec.runId}`,
    source: "demo",
    track: spec.track,
    dataset: spec.dataset,
    itemId: spec.itemId,
    status,
    score: spec.score,
    finalAnswer: spec.finalAnswer,
    outcome: spec.outcome ?? (status === "capped" ? "capped" : status === "failed" ? "extraction_failed" : "graded"),
    failure: spec.failure ?? null,
    caps: { runTokens: 100_000, itemWallclockSeconds: 300, usedTokens: spec.input + spec.output, elapsedMs: spec.latency },
    totals: { input: spec.input, output: spec.output, reasoning: 0, cachedInput: spec.cached, normalizedCost: spec.cost, latencyMs: spec.latency },
    modelUsage,
    hashes: { dataset: hash("d"), runEvidence: hash("e") },
    compliance: {
      eventsComplete: true,
      usagePresent: true,
      outputContract: compliant,
      finalArtifactPresent: compliant
    },
    events: makeEvents(spec),
    rawEvidenceRefs: [`demo://${spec.runId}/run-details.json`],
    importedAt: "2026-08-22T01:05:00.000Z"
  };
}

export const demoRuns: ArgusRun[] = [
  makeRun({
    runId: "TRACE-DEMO-001",
    track: "coding",
    itemId: "coding-visible-04",
    dataset: "SWE-bench Lite · visible",
    score: 1,
    input: 17_660,
    output: 580,
    cached: 4_720,
    cost: 6_240,
    latency: 42_800,
    coordinatorModel: "demo/model-small",
    workerModel: "demo/model-large",
    finalAnswer: "*** PATCH START ***\nsympy/core/basic.py\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE\n*** PATCH END ***"
  }),
  makeRun({
    runId: "TRACE-DEMO-002",
    track: "coding",
    itemId: "coding-visible-04",
    dataset: "SWE-bench Lite · visible",
    score: 1,
    input: 19_420,
    output: 664,
    cached: 5_100,
    cost: 4_018,
    latency: 35_900,
    coordinatorModel: "demo/model-small",
    workerModel: "demo/model-small",
    finalAnswer: "*** PATCH START ***\nsympy/core/basic.py\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE\n*** PATCH END ***"
  }),
  makeRun({
    runId: "TRACE-DEMO-003",
    track: "math",
    itemId: "math-visible-18",
    dataset: "MATH-500 · level 5",
    score: 0,
    input: 83_900,
    output: 17_040,
    cached: 0,
    cost: 40_376,
    latency: 302_400,
    coordinatorModel: "demo/model-small",
    workerModel: "demo/model-large",
    finalAnswer: "",
    status: "capped",
    outcome: "capped",
    compliant: false,
    taskCount: 2,
    failure: { itemStatus: "capped_tokens", kind: "token_cap", owner: "policy", secondaryTags: ["TASK_TOPOLOGY_MISMATCH"], message: "Run token cap reached before final answer extraction." }
  }),
  makeRun({
    runId: "TRACE-DEMO-004",
    track: "generic",
    itemId: "generic-visible-11",
    dataset: "MMLU-Pro · law",
    score: 0,
    input: 4_420,
    output: 311,
    cached: 1_205,
    cost: 946,
    latency: 12_900,
    coordinatorModel: "demo/model-small",
    workerModel: "demo/model-large",
    finalAnswer: "The answer is D.",
    status: "failed",
    outcome: "extraction_failed",
    compliant: false,
    failure: { itemStatus: "error", kind: "runner", owner: "team", secondaryTags: ["FORMAT_OPTION_LETTER"], message: "Final output did not match ANSWER: <letter>." }
  })
];
