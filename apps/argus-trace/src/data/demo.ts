import type { ArgusEvent, ArgusRun, Track } from "../../../../lab/lib/types.ts";

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
  plannerModel: string;
  solverModel: string;
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
    agentId: index === 2 || index === 3 ? "ARGUS Solver" : "ARGUS Planner",
    agentRole: index === 2 || index === 3 ? "Universal Solver" : "Planner",
    model: index === 2 || index === 3 ? spec.solverModel : spec.plannerModel,
    kind: "unknown",
    state: "running",
    decision: "",
    artifactRef: null,
    candidateStatus: "observed",
    tokens: { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 },
    durationMs: 0,
    squadConfigHash: hash("a"),
    submissionJsonHash: hash("b"),
    promptHash: hash("c"),
    timestamp: at.toISOString(),
    raw: { demo: true, sourceSequence: index },
    ...partial
  };
}

function splitUsage(spec: DemoSpec) {
  const solverInput = Math.round(spec.input * 0.56);
  const plannerInput = spec.input - solverInput;
  const plannerOutput = Math.round(spec.output * 0.3);
  const solverOutput = spec.output - plannerOutput;
  const planOutput = Math.round(plannerOutput * 0.62);
  const finalOutput = plannerOutput - planOutput;
  return { solverInput, plannerInput, solverOutput, plannerOutput, planOutput, finalOutput };
}

function makeEvents(spec: DemoSpec): ArgusEvent[] {
  const { finalOutput, planOutput, plannerInput, solverInput, solverOutput } = splitUsage(spec);
  const terminalFailed = spec.status === "capped" || spec.status === "failed";
  return [
    event(spec, 0, { kind: "run.started", state: "planning", decision: `${spec.track} request accepted; output contract identified.`, durationMs: 410 }),
    event(spec, 1, { kind: "plan.created", state: "completed", decision: `One task planned for ARGUS Solver${(spec.taskCount ?? 1) > 1 ? ` (${spec.taskCount} observed)` : ""}.`, durationMs: 890, tokens: { input: plannerInput, output: planOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.4), normalizedCost: spec.cost * 0.25 } }),
    event(spec, 2, { kind: "task.started", state: "running", decision: "Complete request context handed to the universal Solver.", durationMs: 180 }),
    event(spec, 3, { kind: terminalFailed ? "task.failed" : "task.completed", state: terminalFailed ? (spec.status === "capped" ? "capped" : "failed") : "completed", decision: terminalFailed ? (spec.failure?.message || "Task did not produce a gradeable artifact.") : spec.track === "coding" ? "Minimal, applicable patch candidate produced." : "Single answer candidate produced and checked.", artifactRef: terminalFailed ? null : `artifact://${spec.runId}/candidate.txt`, candidateStatus: terminalFailed ? "rejected" : "selected", durationMs: Math.round(spec.latency * 0.72), tokens: { input: solverInput, output: solverOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.6), normalizedCost: spec.cost * 0.62 } }),
    event(spec, 4, { kind: "aggregation.started", state: terminalFailed ? "failed" : "running", decision: terminalFailed ? "No valid candidate available for aggregation." : "Contract gate passed; verbatim aggregation selected.", durationMs: 260 }),
    event(spec, 5, { kind: spec.status === "capped" ? "run.capped" : spec.status === "failed" ? "run.failed" : "run.completed", state: spec.status === "capped" ? "capped" : spec.status === "failed" ? "failed" : "completed", decision: terminalFailed ? (spec.failure?.message || "Run ended without a valid artifact.") : "Final answer emitted without formatter rewrite.", artifactRef: terminalFailed ? null : `artifact://${spec.runId}/final.txt`, durationMs: 390, tokens: { input: 0, output: finalOutput, reasoning: 0, cachedInput: 0, normalizedCost: spec.cost * 0.13 } })
  ];
}

function makeRun(spec: DemoSpec): ArgusRun {
  const status = spec.status ?? "completed";
  const compliant = spec.compliant ?? true;
  const { plannerInput, plannerOutput, solverInput, solverOutput } = splitUsage(spec);
  const plannerUsage = { model: spec.plannerModel, calls: 1, input: plannerInput, output: plannerOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.4), normalizedCost: spec.cost * 0.38, latencyMs: Math.round(spec.latency * 0.28) };
  const solverUsage = { model: spec.solverModel, calls: 1, input: solverInput, output: solverOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.6), normalizedCost: spec.cost * 0.62, latencyMs: Math.round(spec.latency * 0.72) };
  const modelUsage = spec.plannerModel === spec.solverModel
    ? [{ ...plannerUsage, calls: 2, input: spec.input, output: spec.output, cachedInput: spec.cached, normalizedCost: spec.cost, latencyMs: spec.latency }]
    : [plannerUsage, solverUsage];
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
    hashes: { dataset: hash("d"), squadConfig: hash("a"), submissionJson: hash("b"), prompt: hash("c") },
    compliance: {
      userToolsZero: true,
      plannerNativeProtocol: true,
      memoryOff: true,
      hashesPresent: true,
      outputContract: compliant,
      fallbackFree: compliant
    },
    events: makeEvents(spec),
    rawEvidenceRefs: [`demo://${spec.runId}/run-details.json`],
    importedAt: "2026-08-22T01:05:00.000Z"
  };
}

export const demoRuns: ArgusRun[] = [
  makeRun({
    runId: "ARGUS-C0-014",
    track: "coding",
    itemId: "coding-visible-04",
    dataset: "SWE-bench Lite · visible",
    score: 1,
    input: 17_660,
    output: 580,
    cached: 4_720,
    cost: 6_240,
    latency: 42_800,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/gpt-oss-120b",
    finalAnswer: "*** PATCH START ***\nsympy/core/basic.py\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE\n*** PATCH END ***"
  }),
  makeRun({
    runId: "ARGUS-C1-021",
    track: "coding",
    itemId: "coding-visible-04",
    dataset: "SWE-bench Lite · visible",
    score: 1,
    input: 19_420,
    output: 664,
    cached: 5_100,
    cost: 4_018,
    latency: 35_900,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/Qwen3-32B-FP8",
    finalAnswer: "*** PATCH START ***\nsympy/core/basic.py\n<<<<<<< SEARCH\n...\n=======\n...\n>>>>>>> REPLACE\n*** PATCH END ***"
  }),
  makeRun({
    runId: "ARGUS-C2-031",
    track: "math",
    itemId: "math-visible-18",
    dataset: "MATH-500 · level 5",
    score: 0,
    input: 83_900,
    output: 17_040,
    cached: 0,
    cost: 40_376,
    latency: 302_400,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/gpt-oss-120b",
    finalAnswer: "",
    status: "capped",
    outcome: "capped",
    compliant: false,
    taskCount: 2,
    failure: { itemStatus: "capped_tokens", kind: "token_cap", owner: "policy", secondaryTags: ["PLANNER_ZERO_OR_EXTRA_TASKS"], message: "Run token cap reached before final answer extraction." }
  }),
  makeRun({
    runId: "ARGUS-C0-009",
    track: "generic",
    itemId: "generic-visible-11",
    dataset: "MMLU-Pro · law",
    score: 0,
    input: 4_420,
    output: 311,
    cached: 1_205,
    cost: 946,
    latency: 12_900,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/gpt-oss-120b",
    finalAnswer: "The answer is D.",
    status: "failed",
    outcome: "extraction_failed",
    compliant: false,
    failure: { itemStatus: "error", kind: "runner", owner: "team", secondaryTags: ["FORMAT_OPTION_LETTER"], message: "Final output did not match ANSWER: <letter>." }
  })
];
