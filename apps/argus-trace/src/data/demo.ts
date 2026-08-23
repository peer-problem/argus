import type { ArgusBatch, ArgusBatchItem, ArgusEvent, ArgusEvidenceRecord, ArgusRun, Track } from "../types.ts";

const hash = (letter: string) => letter.repeat(64);

function contextWindowFor(model: string): number | null {
  if (model.includes("K-EXAONE-236B")) return 48_000;
  if (model.includes("gpt-oss-120b")) return 128_000;
  if (model.includes("Qwen3-32B")) return 40_000;
  return null;
}

function share(total: number, index: number, count: number): number {
  const base = Math.floor(total / count);
  return index === count - 1 ? total - base * index : base;
}

interface DemoSpec {
  runId: string;
  startedAt: string;
  track: Exclude<Track, "unknown">;
  itemId: string;
  dataset: string | null;
  score: number | null;
  input: number;
  output: number;
  cached: number | null;
  cost: number | null;
  latency: number;
  plannerModel: string;
  solverModel: string;
  finalAnswer: string | null;
  status?: ArgusRun["status"];
  outcome?: ArgusRun["outcome"];
  failure?: ArgusRun["failure"];
  compliant?: boolean;
  taskCount?: number;
  eventTimingsObserved?: boolean;
  includeInferredAgentState?: boolean;
  planTitle: string;
  request: string;
  scenario: string;
  taskTitles: string[];
  taskAgents: Array<{ id: string; name: string; role: string }>;
  taskModels: string[];
  taskWaves: number[];
  taskDependencies?: string[][];
  taskOutcomes?: Array<"completed" | "failed" | "capped">;
  taskErrors?: Array<string | null>;
  taskResults: string[];
}

export interface DemoBenchProfile {
  coding: number;
  math: number;
  generic: number;
  graded?: Partial<Record<Exclude<Track, "unknown">, number>>;
}

export interface DataArrival {
  id: string;
  source: string;
  receiver: string;
  protocol: string;
  recordedAt: string;
  startedAt?: string;
  data: string;
  reference?: string;
}

const at = (spec: DemoSpec, offsetMs: number) => new Date(new Date(spec.startedAt).valueOf() + offsetMs).toISOString();

function splitUsage(spec: DemoSpec) {
  const solverInput = Math.round(spec.input * 0.76);
  const plannerInput = spec.input - solverInput;
  const plannerOutput = Math.round(spec.output * 0.18);
  const solverOutput = spec.output - plannerOutput;
  const planOutput = plannerOutput;
  const finalOutput = 0;
  return { solverInput, plannerInput, solverOutput, plannerOutput, planOutput, finalOutput };
}

function nativeSourceType(event: ArgusEvent): string {
  if (event.kind === "run.created" || (event.kind === "run.started" && event.state === "planning")) return "squad:planning-started";
  if (event.kind === "run.started") return "squad:execution-started";
  if (event.kind === "plan.created") return "squad:plan-ready";
  if (event.kind === "task.created") return "squad:task-wave-started";
  if (event.kind === "task.assigned" || event.kind === "task.started") return "squad:task-status-changed";
  if (event.kind === "task.completed" || event.kind === "task.failed") return "squad:task-completed";
  if (event.kind === "evidence.attached") return "squad:execution-token-usage";
  if (event.kind.startsWith("aggregation.")) return "squad:aggregation-started";
  if (event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.capped") return "squad:execution-completed";
  return event.kind;
}

function makeEvents(spec: DemoSpec): ArgusEvent[] {
  const events: ArgusEvent[] = [];
  const { finalOutput, planOutput, plannerInput, solverInput, solverOutput } = splitUsage(spec);
  const taskTotal = spec.taskTitles.length;
  const nativeCapped = spec.status === "capped";
  const nativeFailed = spec.outcome === "infrastructure_failed";
  const nativeCompleted = !nativeCapped && !nativeFailed;
  const cached = spec.cached ?? 0;
  const cost = spec.cost ?? 0;
  const terminalOffset = spec.latency;
  const planOffset = Math.min(1_200, Math.max(700, Math.round(spec.latency * 0.08)));
  const taskWindowStart = planOffset + 220;
  const taskWindowEnd = Math.max(taskWindowStart + 400, terminalOffset - 1_050);
  const taskWindow = Math.max(400, taskWindowEnd - taskWindowStart);

  function push(offsetMs: number, protocol: string, partial: Partial<ArgusEvent>) {
    const index = events.length;
    events.push({
      eventId: `${spec.runId}-evt-${String(index + 1).padStart(2, "0")}`,
      runId: spec.runId,
      parentEventId: index === 0 ? null : events[index - 1]!.eventId,
      track: spec.track,
      wave: null,
      taskId: null,
      taskTitle: null,
      dependsOnTaskIds: [],
      agentId: "AI:GO Runtime",
      agentRole: "AI:GO Native Runtime",
      model: null,
      kind: "unknown",
      state: "running",
      decision: "",
      artifactRef: null,
      candidateStatus: "none",
      tokens: { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 },
      durationMs: 0,
      squadConfigHash: hash("a"),
      submissionJsonHash: hash("b"),
      promptHash: hash("c"),
      timestamp: at(spec, offsetMs),
      raw: { fixture: true, protocol, sourceSequence: index },
      ...partial
    });
  }

  push(0, "AI:GO native execution", {
    kind: "run.created",
    state: "queued",
    decision: `${spec.track} request accepted into the native execution queue.`
  });
  push(180, "AI:GO native execution", {
    kind: "run.started",
    state: "planning",
    decision: "Native Planner started orchestration.",
    agentId: "ARGUS Planner",
    agentRole: "Planner",
    model: null
  });
  if (spec.includeInferredAgentState) {
    push(260, "AI:GO native execution", {
      kind: "unknown",
      state: "running",
      decision: "Agent state changed to running.",
      agentId: "ARGUS Solver",
      agentRole: "Agent state",
      tokens: { input: null, output: null, reasoning: null, cachedInput: null, normalizedCost: null },
      durationMs: null,
      raw: {
        fixture: true,
        protocol: "AI:GO native execution",
        sourceEventType: "squad:agent-state-changed",
        joinConfidence: "inferred",
        joinReason: "Agent state is within the execution window, but it has no execution or task ID.",
        agentState: "running"
      }
    });
  }
  push(planOffset, "AI:GO Planner coordination", {
    kind: "plan.created",
    state: "completed",
    decision: `${taskTotal} native ${taskTotal === 1 ? "task" : "tasks"} planned for ARGUS Solver.`,
    agentId: "ARGUS Planner",
    agentRole: "Planner",
    model: spec.plannerModel,
    durationMs: planOffset - 180,
    tokens: {
      input: plannerInput,
      output: planOutput,
      reasoning: 0,
      cachedInput: Math.round(cached * 0.4),
      normalizedCost: cost * 0.25
    }
  });

  const waveValues = [...new Set(spec.taskWaves)].sort((left, right) => left - right);
  for (let taskIndex = 0; taskIndex < taskTotal; taskIndex += 1) {
    const taskId = `task-${taskIndex + 1}`;
    const taskTitle = spec.taskTitles[taskIndex]!;
    const taskAgent = spec.taskAgents[taskIndex]!;
    const wave = spec.taskWaves[taskIndex]!;
    const waveIndex = waveValues.indexOf(wave);
    const wavePeers = spec.taskWaves.map((value, index) => ({ value, index })).filter((item) => item.value === wave);
    const peerIndex = wavePeers.findIndex((item) => item.index === taskIndex);
    const waveSpan = taskWindow / waveValues.length;
    const waveStart = taskWindowStart + Math.round(waveSpan * waveIndex);
    const segmentStart = waveStart + peerIndex * 70;
    const segmentEnd = Math.min(taskWindowEnd, waveStart + Math.round(waveSpan * (.72 + peerIndex * .06)));
    const isLast = taskIndex === taskTotal - 1;
    const taskOutcome = spec.taskOutcomes?.[taskIndex] ?? (isLast && !nativeCompleted ? (nativeCapped ? "capped" : "failed") : "completed");
    const taskFailed = taskOutcome !== "completed";
    const taskInput = isLast ? solverInput - Math.floor(solverInput / taskTotal) * taskIndex : Math.floor(solverInput / taskTotal);
    const taskOutput = isLast ? solverOutput - Math.floor(solverOutput / taskTotal) * taskIndex : Math.floor(solverOutput / taskTotal);
    const taskCached = isLast ? Math.round(cached * 0.6) - Math.floor((cached * 0.6) / taskTotal) * taskIndex : Math.floor((cached * 0.6) / taskTotal);
    const taskCost = isLast ? cost * 0.62 - (cost * 0.62 / taskTotal) * taskIndex : cost * 0.62 / taskTotal;
    const common = {
      taskId,
      taskTitle,
      wave,
      dependsOnTaskIds: spec.taskDependencies?.[taskIndex] ?? [],
      agentId: taskAgent.id,
      agentRole: taskAgent.role,
      model: null
    };

    push(segmentStart, "AI:GO Planner coordination", {
      ...common,
      kind: "task.created",
      state: "queued",
      agentId: "ARGUS Planner",
      agentRole: "Planner",
      model: null,
      decision: `${taskTitle} created in wave ${wave + 1}.`,
      durationMs: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 }
    });
    push(segmentStart + 60, "AI:GO Planner coordination", {
      ...common,
      kind: "task.assigned",
      state: "queued",
      decision: `${taskId} assigned to ${taskAgent.name}.`
    });
    push(segmentStart + 120, "AI:GO native task execution", {
      ...common,
      kind: "task.started",
      state: "running",
      decision: `Complete request context handed to ${taskAgent.name}.`
    });
    push(segmentEnd, "AI:GO native task execution", {
      ...common,
      model: spec.taskModels[taskIndex]!,
      kind: taskFailed ? "task.failed" : "task.completed",
      state: taskOutcome,
      decision: taskFailed
        ? spec.taskErrors?.[taskIndex] || spec.failure?.message || "Task ended without a native candidate."
        : spec.taskResults[taskIndex]!,
      artifactRef: taskFailed ? null : `artifact://${spec.runId}/${taskId}.txt`,
      candidateStatus: taskFailed ? "rejected" : isLast && nativeCompleted ? "selected" : "observed",
      durationMs: Math.max(0, segmentEnd - segmentStart - 120),
      tokens: {
        input: taskInput,
        output: taskOutput,
        reasoning: 0,
        cachedInput: taskCached,
        normalizedCost: taskCost
      }
    });
  }

  push(terminalOffset - 850, "AI:GO native aggregation", {
    kind: "aggregation.started",
    state: nativeCompleted ? "running" : "failed",
    decision: nativeCompleted ? "Native aggregation inspected the final-wave candidate." : "No valid final-wave candidate was available for aggregation.",
    agentId: "AI:GO Aggregator",
    agentRole: "Native aggregation"
  });
  push(terminalOffset - 320, "AI:GO native aggregation", {
    kind: "aggregation.completed",
    state: nativeCompleted ? "completed" : "failed",
    decision: nativeCompleted ? "The selected Solver artifact was emitted without formatter rewrite." : "Native aggregation completed without an accepted artifact.",
    artifactRef: nativeCompleted ? `artifact://${spec.runId}/final.txt` : null,
    candidateStatus: nativeCompleted ? "selected" : "rejected",
    agentId: "AI:GO Aggregator",
    agentRole: "Native aggregation",
    durationMs: 530,
    tokens: nativeCompleted
      ? { input: 0, output: finalOutput, reasoning: 0, cachedInput: 0, normalizedCost: cost * 0.13 }
      : { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 }
  });
  push(terminalOffset, "AI:GO native execution", {
    kind: nativeCapped ? "run.capped" : nativeFailed ? "run.failed" : "run.completed",
    state: nativeCapped ? "capped" : nativeFailed ? "failed" : "completed",
    decision: nativeCapped
      ? spec.failure?.message || "The native run reached its cap."
      : nativeFailed
        ? spec.failure?.message || "The native run failed."
        : "The native run completed and exposed its final result.",
    artifactRef: nativeCompleted ? `artifact://${spec.runId}/final.txt` : null
  });
  return events.map((event) => ({
    ...event,
    durationMs: spec.eventTimingsObserved === false ? null : event.durationMs,
    tokens: {
      ...event.tokens,
      cachedInput: spec.cached == null ? null : event.tokens.cachedInput,
      normalizedCost: spec.cost == null ? null : event.tokens.normalizedCost
    },
    raw: {
      ...(event.raw ?? {}),
      sourceEventType: typeof event.raw?.sourceEventType === "string" ? event.raw.sourceEventType : nativeSourceType(event),
      joinConfidence: typeof event.raw?.joinConfidence === "string" ? event.raw.joinConfidence : "confirmed",
      joinReason: typeof event.raw?.joinReason === "string" ? event.raw.joinReason : event.taskId == null ? "Fixture event record" : "Fixture task ID record"
    }
  }));
}

function makeRun(spec: DemoSpec): ArgusRun {
  const status = spec.status ?? "completed";
  const compliant = spec.compliant ?? true;
  const events = makeEvents(spec);
  const modelUsage = [...new Set(events.map((event) => event.model).filter((model): model is string => Boolean(model)))].map((model) => {
    const calls = events.filter((event) => event.model === model && ((event.durationMs ?? 0) > 0 || (event.tokens.input ?? 0) + (event.tokens.output ?? 0) > 0));
    return {
      model,
      calls: calls.length,
      input: calls.reduce((total, event) => total + (event.tokens.input ?? 0), 0),
      output: calls.reduce((total, event) => total + (event.tokens.output ?? 0), 0),
      reasoning: calls.reduce((total, event) => total + (event.tokens.reasoning ?? 0), 0),
      cachedInput: spec.cached == null ? null : calls.reduce((total, event) => total + (event.tokens.cachedInput ?? 0), 0),
      normalizedCost: spec.cost == null ? null : calls.reduce((total, event) => total + (event.tokens.normalizedCost ?? 0), 0),
      latencyMs: spec.eventTimingsObserved === false ? null : calls.reduce((total, event) => total + (event.durationMs ?? 0), 0),
      contextWindowTokens: contextWindowFor(model)
    };
  });
  const terminal = events.find((event) => event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.capped")!;
  const taskIds = [...new Set(events.map((event) => event.taskId).filter((taskId): taskId is string => taskId != null))];
  const tasks = taskIds.map((taskId, taskIndex) => {
    const taskEvents = events.filter((event) => event.taskId === taskId);
    const started = taskEvents.find((event) => event.kind === "task.started");
    const completed = taskEvents.find((event) => event.kind === "task.completed" || event.kind === "task.failed")!;
    const failed = completed.state === "failed" || completed.state === "capped";
    return {
      taskId,
      title: completed.taskTitle ?? taskId,
      agentId: completed.agentId ?? null,
      agentName: completed.agentRole ?? null,
      status: failed ? "failed" : "done",
      output: failed ? null : spec.taskResults[taskIndex]!,
      error: failed ? spec.taskErrors?.[taskIndex] ?? spec.failure?.message ?? completed.decision : null,
      durationMs: completed.durationMs,
      tokens: { input: completed.tokens.input, output: completed.tokens.output },
      priority: completed.wave === 0 ? "high" : "medium",
      description: `${spec.scenario} ${completed.taskTitle ?? "Execute the planned work item."}`,
      createdBy: "ARGUS Planner",
      dependsOnTaskIds: completed.dependsOnTaskIds ?? [],
      artifacts: completed.artifactRef == null ? [] : [completed.artifactRef],
      result: failed ? null : completed.decision,
      retryCount: completed.taskTitle?.toLowerCase().includes("retry") ? 1 : 0,
      maxRetries: 2,
      startedAt: started?.timestamp ?? null,
      completedAt: completed.timestamp,
      markdown: `# ${completed.taskTitle ?? taskId}\n\n${completed.decision}`
    };
  });
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
    caps: { runTokens: 12_000, itemWallclockSeconds: 240, usedTokens: spec.input + spec.output, elapsedMs: spec.latency },
    totals: { input: spec.input, output: spec.output, reasoning: 0, cachedInput: spec.cached, normalizedCost: spec.cost, latencyMs: spec.latency },
    modelUsage,
    hashes: { dataset: hash("d"), squadConfig: hash("a"), submissionJson: hash("b"), prompt: hash("c") },
    compliance: {
      userToolsZero: true,
      plannerNativeProtocol: true,
      memoryOff: true,
      hashesPresent: true,
      outputContract: compliant,
      fallbackFree: (spec.taskOutcomes ?? []).every((outcome) => outcome === "completed")
    },
    events,
    detail: {
      executionId: spec.runId,
      squadId: "b75a5a4b-ce9c-4f00-ab89-54adee1962c1",
      squadName: "ARGUS Demo Lab",
      request: spec.request,
      planTitle: spec.planTitle,
      startedAt: spec.startedAt,
      completedAt: terminal.timestamp,
      tasks,
      console: [
        { timestamp: at(spec, 180), level: "info", agentId: "ARGUS Planner", message: "Planning started." },
        ...tasks.map((task) => ({ timestamp: task.completedAt ?? terminal.timestamp, level: task.error == null ? "info" : "error", agentId: task.agentId ?? "AI:GO Runtime", message: task.error ?? `${task.title} completed.` })),
        { timestamp: terminal.timestamp, level: spec.failure == null ? "info" : "warn", agentId: "AI:GO Runtime", message: terminal.decision }
      ],
      reportMarkdown: `# ${spec.planTitle}\n\n- Execution: \`${spec.runId}\`\n- Scenario: ${spec.scenario}\n- Status: **${status}**\n- Waves: ${new Set(spec.taskWaves).size}\n- Tasks: ${tasks.length}\n- Prompt tokens: ${spec.input.toLocaleString("en-US")}\n- Completion tokens: ${spec.output.toLocaleString("en-US")}\n\n${spec.failure?.message ?? "The final result satisfied the configured execution contract."}`
    },
    rawEvidenceRefs: [`demo://aigo/workspace/logs/history.json#${spec.runId}`, `demo://aigo/workspace/logs/events.jsonl#${spec.runId}`, `demo://aigo/workspace/logs/${spec.runId}.jsonl`],
    importedAt: new Date(new Date(terminal.timestamp).valueOf() + 1_200).toISOString()
  };
}

const coding = { id: "agent-coding", name: "ARGUS Coding Solver", role: "Coding solver" };
const math = { id: "agent-math", name: "ARGUS Math Solver", role: "Math solver" };
const generic = { id: "agent-generic", name: "ARGUS Generic Solver", role: "Generic solver" };
const verifier = { id: "agent-verifier", name: "ARGUS Verifier", role: "Evidence verifier" };
const qwen = "furiosa-ai/Qwen3-32B-FP8";
const oss = "furiosa-ai/gpt-oss-120b";
const exaone = "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16";

const specs: DemoSpec[] = [
  {
    runId: "AIGO-R14-FINAL-CHECK", startedAt: "2026-08-23T10:18:14.000Z", track: "coding", itemId: "coding-cache-key-02", dataset: "ARGUS validation suite · v5", score: .655,
    input: 3_872, output: 1_037, cached: 1_410, cost: 2_594, latency: 58_740, plannerModel: qwen, solverModel: oss,
    finalAnswer: "*** PATCH START ***\ncache/key.py\n- return name\n+ return f\"{namespace}:{name}\"\n*** PATCH END ***",
    planTitle: "Four-agent final verification",
    request: "Recheck the cache-key fix with independent implementation, boundary, regression, and contract reviews before selecting the final patch.",
    scenario: "Four specialist agents revisit the strongest candidate after the overnight ablation and converge in a final verification wave.",
    taskTitles: ["Review implementation diff", "Probe namespace boundaries", "Re-run focused regression", "Select final contract-valid patch"],
    taskAgents: [coding, math, generic, verifier], taskModels: [oss, qwen, exaone, qwen], taskWaves: [0, 0, 0, 1],
    taskDependencies: [[], [], [], ["task-1", "task-2", "task-3"]],
    taskResults: ["The namespace is included without changing existing callers.", "Empty and Unicode namespaces remain collision-free.", "Focused regression passed: 12 tests.", "Final patch satisfies the artifact contract."],
    includeInferredAgentState: true
  },
  {
    runId: "AIGO-R13-CACHED-RERUN", startedAt: "2026-08-23T03:56:41.000Z", track: "generic", itemId: "generic-policy-03", dataset: "ARGUS validation suite · v5", score: .59,
    input: 1_456, output: 318, cached: 830, cost: 793, latency: 27_480, plannerModel: qwen, solverModel: exaone, finalAnswer: "ANSWER: C",
    planTitle: "Two-agent cached rerun",
    request: "Repeat the best policy-classification route with a warm cache, then independently verify only the answer contract and choice mapping.",
    scenario: "A sparse overnight ablation cuts the team to one solver and one verifier; efficiency improves while benchmark quality slips.",
    taskTitles: ["Classify statements from cached context", "Verify choice and output contract"],
    taskAgents: [generic, verifier], taskModels: [exaone, qwen], taskWaves: [0, 1], taskDependencies: [[], ["task-1"]],
    taskResults: ["Statement pair maps to option C.", "ANSWER: C"]
  },
  {
    runId: "AIGO-R12-ADVERSARIAL", startedAt: "2026-08-22T22:18:57.000Z", track: "coding", itemId: "coding-cache-key-02", dataset: "ARGUS validation suite · v5", score: .615,
    input: 6_290, output: 1_940, cached: 2_780, cost: 5_732, latency: 103_620, plannerModel: qwen, solverModel: oss,
    finalAnswer: "*** PATCH START ***\ncache/key.py\n- return name\n+ return f\"{namespace}:{name}\"\n*** PATCH END ***",
    planTitle: "Four-agent adversarial review",
    request: "Challenge the cache-key patch with implementation review, fuzzing, regression checks, and output-contract validation before emitting the artifact.",
    scenario: "The evening's widest review spends substantially more tokens; one fuzz route fails, but four agent roles still produce the first robust candidate.",
    taskTitles: ["Audit collision root cause", "Fuzz malformed namespaces", "Build guarded patch", "Verify focused tests", "Reconcile surviving evidence"],
    taskAgents: [coding, math, coding, verifier, generic], taskModels: [oss, qwen, oss, qwen, exaone], taskWaves: [0, 0, 1, 1, 2],
    taskDependencies: [[], [], ["task-1"], ["task-1"], ["task-1", "task-3", "task-4"]],
    taskOutcomes: ["completed", "failed", "completed", "completed", "completed"],
    taskErrors: [null, "Fuzz harness exceeded its per-task memory allowance.", null, null, null],
    taskResults: ["The namespace omission is the collision source.", "No candidate recorded.", "Namespace-prefixed key implemented.", "Focused tests passed with one fuzz route unavailable.", "The surviving evidence supports the patch artifact."],
    includeInferredAgentState: true
  },
  {
    runId: "AIGO-R11-TRI-MODEL", startedAt: "2026-08-22T20:42:36.000Z", track: "generic", itemId: "generic-tri-model-08", dataset: "ARGUS validation suite · v4", score: .545,
    input: 3_480, output: 920, cached: 1_260, cost: 2_230, latency: 45_600, plannerModel: qwen, solverModel: oss, finalAnswer: "ANSWER: H",
    planTitle: "Tri-model evidence synthesis",
    request: "Evaluate a policy scenario with independent code, quantitative, and general-reasoning routes; reconcile disagreements and emit one option letter.",
    scenario: "Three models produce parallel evidence, but extra arbitration introduces a small benchmark regression before the next patch iteration.",
    taskTitles: ["Inspect rule implementation", "Quantify threshold effects", "Evaluate policy intent", "Synthesize final decision"],
    taskAgents: [coding, math, generic, verifier], taskModels: [oss, qwen, exaone, exaone], taskWaves: [0, 0, 0, 1],
    taskDependencies: [[], [], [], ["task-1", "task-2", "task-3"]],
    taskResults: ["Implementation evidence supports H.", "Threshold analysis rules out B and F.", "Policy intent supports H with high confidence.", "ANSWER: H"],
    includeInferredAgentState: true
  },
  {
    runId: "AIGO-R10-TWO-WAVE", startedAt: "2026-08-22T20:05:12.000Z", track: "math", itemId: "math-hologram-01", dataset: "ARGUS validation suite · v4", score: .575,
    input: 1_527, output: 370, cached: 420, cost: 812, latency: 30_980, plannerModel: qwen, solverModel: oss, finalAnswer: "ANSWER: F",
    planTitle: "Two-wave math verification plan",
    request: "Solve a reconstruction-distance multiple-choice problem, verify the wavelength scaling independently, then emit exactly one option letter.",
    scenario: "Two independent derivations run in parallel before a second-wave answer selection.",
    taskTitles: ["Derive wavelength distance scaling", "Check derivation against answer choices", "Select contract-valid answer"],
    taskAgents: [math, verifier, generic], taskModels: [oss, qwen, exaone], taskWaves: [0, 0, 1], taskDependencies: [[], [], ["task-1", "task-2"]],
    taskResults: ["The image distance scales by 500/600 = 5/6.", "Option F is the unique 5/6 distance choice.", "ANSWER: F"], includeInferredAgentState: true
  },
  {
    runId: "AIGO-R08-CODE-VERIFY", startedAt: "2026-08-22T19:07:03.000Z", track: "coding", itemId: "coding-cache-key-02", dataset: "ARGUS validation suite · v4", score: .52,
    input: 4_100, output: 1_150, cached: 1_840, cost: 2_946, latency: 70_200, plannerModel: qwen, solverModel: oss,
    finalAnswer: "*** PATCH START ***\ncache/key.py\n- return name\n+ return f\"{namespace}:{name}\"\n*** PATCH END ***",
    planTitle: "Three-stage patch verification plan", request: "Fix a cache-key collision, preserve unrelated changes, run the focused test, and return only the applicable patch artifact.",
    scenario: "Parallel diagnosis feeds a patch task, followed by a focused verification wave.",
    taskTitles: ["Inspect cache-key construction", "Reproduce the collision", "Build the minimal patch", "Run focused regression verification"],
    taskAgents: [coding, generic, coding, verifier], taskModels: [oss, exaone, oss, qwen], taskWaves: [0, 0, 1, 2],
    taskDependencies: [[], [], ["task-1", "task-2"], ["task-3"]],
    taskResults: ["The key omits the namespace and collides across tenants.", "Two namespaces reproduce the collision.", "Namespace added without changing callers.", "Focused regression suite passed: 12 tests."]
  },
  {
    runId: "AIGO-R07-RETRY", startedAt: "2026-08-22T18:49:26.000Z", track: "generic", itemId: "generic-policy-03", dataset: "ARGUS validation suite · v3", score: .405,
    input: 1_880, output: 420, cached: 520, cost: 1_484, latency: 34_200, plannerModel: qwen, solverModel: exaone, finalAnswer: "ANSWER: C",
    planTitle: "Retry recovery with evidence check", request: "Classify two policy statements, recover from a transient model error, and return the matching option letter.",
    scenario: "The first call fails quickly; one bounded retry succeeds and a verifier confirms it.",
    taskTitles: ["Classify statements · attempt 1", "Classify statements · retry 1", "Verify option and output contract"],
    taskAgents: [generic, generic, verifier], taskModels: [exaone, exaone, qwen], taskWaves: [0, 1, 2], taskDependencies: [[], ["task-1"], ["task-2"]],
    taskOutcomes: ["failed", "completed", "completed"], taskErrors: ["Upstream model stream ended before a final candidate was recorded.", null, null],
    taskResults: ["No candidate recorded.", "Statement pair maps to option C.", "ANSWER: C"]
  },
  {
    runId: "AIGO-R06-CONSENSUS", startedAt: "2026-08-22T18:34:52.000Z", track: "math", itemId: "math-radical-04", dataset: "ARGUS validation suite · v3", score: .43,
    input: 4_985, output: 1_588, cached: 2_120, cost: 4_918, latency: 74_600, plannerModel: qwen, solverModel: oss, finalAnswer: "\\boxed{120}",
    planTitle: "Five-agent math consensus", request: "Count the real values satisfying a nested-radical integer constraint and cross-check the result by independent methods.",
    scenario: "Five tasks across three models improve confidence at a visible token and latency cost.",
    taskTitles: ["Determine domain constraints", "Parameterize integer cases", "Count valid real values", "Check boundary cases", "Reconcile consensus answer"],
    taskAgents: [math, verifier, generic, coding, generic], taskModels: [oss, qwen, exaone, oss, exaone], taskWaves: [0, 0, 0, 0, 1],
    taskDependencies: [[], [], [], [], ["task-1", "task-2", "task-3", "task-4"]],
    taskResults: ["The outer integer is bounded by the real domain.", "Each integer case maps to one nonnegative x.", "Candidate count: 120.", "Endpoints are valid and no cases collide.", "\\boxed{120}"]
  },
  {
    runId: "AIGO-R05-CROSS-ROUTE", startedAt: "2026-08-22T18:11:09.000Z", track: "generic", itemId: "generic-even-number-05", dataset: "ARGUS validation suite · v3", score: .28,
    input: 2_191, output: 805, cached: 910, cost: 2_510, latency: 52_000, plannerModel: qwen, solverModel: oss, finalAnswer: "ANSWER: D",
    planTitle: "Cross-route arbitration plan", request: "Select the even number from a multiple-choice list while comparing coding, math, and generic routes.",
    scenario: "Three model routes run in parallel; two reject the wrapper and one returns a usable answer.",
    taskTitles: ["Evaluate with coding route", "Evaluate with math route", "Evaluate with generic route"],
    taskAgents: [coding, math, generic], taskModels: [oss, qwen, exaone], taskWaves: [0, 0, 0], taskOutcomes: ["failed", "failed", "completed"],
    taskErrors: ["Coding route rejected the generic payload.", "Math route rejected the generic wrapper.", null],
    taskResults: ["No candidate.", "No candidate.", "ANSWER: D"]
  },
  {
    runId: "AIGO-R04-CONTRACT", startedAt: "2026-08-22T17:58:33.000Z", track: "generic", itemId: "generic-contract-06", dataset: "ARGUS validation suite · v2", score: .31,
    input: 1_590, output: 608, cached: 430, cost: 1_276, latency: 47_400, plannerModel: qwen, solverModel: oss,
    finalAnswer: "Both statements appear true, so the corresponding choice should be selected.", outcome: "extraction_failed", compliant: false,
    failure: { itemStatus: "error", kind: "runner", owner: "team", secondaryTags: ["OUTPUT_CONTRACT"], message: "Final answer line was not present, so the grader could not extract an option." },
    planTitle: "Universal solver output-contract miss", request: "Evaluate both statements and end with exactly one ANSWER: <letter> line.",
    scenario: "Reasoning succeeds, but the required final output contract is omitted.",
    taskTitles: ["Analyze both statements"], taskAgents: [generic], taskModels: [oss], taskWaves: [0],
    taskResults: ["Both statements appear true, but no contract line was emitted."]
  },
  {
    runId: "AIGO-R03-MATH-TIMEOUT", startedAt: "2026-08-22T16:26:47.000Z", track: "math", itemId: "math-radical-04", dataset: "ARGUS validation suite · v2", score: .19,
    input: 2_710, output: 927, cached: 0, cost: 5_804, latency: 190_000, plannerModel: qwen, solverModel: oss, finalAnswer: null,
    status: "capped", outcome: "capped", compliant: false, includeInferredAgentState: true,
    failure: { itemStatus: "capped_wallclock", kind: "wallclock_cap", owner: "policy", secondaryTags: ["TASK_TIMEOUT"], message: "Math task reached the 180-second wall-clock limit before producing a final answer." },
    planTitle: "Single-route long math attempt", request: "Solve the nested-radical integer problem within the configured wall-clock limit.",
    scenario: "One long-running task reaches the native wall-clock limit before a candidate is available.",
    taskTitles: ["Solve nested-radical integer cases"], taskAgents: [math], taskModels: [oss], taskWaves: [0], taskOutcomes: ["capped"],
    taskErrors: ["Task timed out after 180 seconds."], taskResults: ["No candidate."]
  },
  {
    runId: "AIGO-R02-UNIVERSAL", startedAt: "2026-08-22T15:47:22.000Z", track: "generic", itemId: "generic-kernel-07", dataset: "ARGUS validation suite · v2", score: .2325,
    input: 1_828, output: 676, cached: 580, cost: 2_178, latency: 59_700, plannerModel: qwen, solverModel: oss, finalAnswer: "ANSWER: A",
    planTitle: "Single universal-solver baseline", request: "Evaluate two machine-learning statements and emit one answer option.",
    scenario: "A single universal task succeeds with moderate latency and no cross-route evidence.",
    taskTitles: ["Evaluate both ML statements"], taskAgents: [generic], taskModels: [oss], taskWaves: [0], taskResults: ["ANSWER: A"]
  },
  {
    runId: "AIGO-R01-BROADCAST", startedAt: "2026-08-22T15:02:11.000Z", track: "generic", itemId: "generic-even-number-05", dataset: "ARGUS validation suite · v1", score: .2,
    input: 1_335, output: 179, cached: 0, cost: 980, latency: 16_200, plannerModel: qwen, solverModel: oss, finalAnswer: "ANSWER: D",
    planTitle: "Three-route broadcast baseline", request: "Select the even number from the supplied choices using the initial broadcast strategy.",
    scenario: "The baseline broadcasts to every route, creating two fast failures and one useful answer.",
    taskTitles: ["Broadcast to coding route", "Broadcast to math route", "Broadcast to generic route"],
    taskAgents: [coding, math, generic], taskModels: [oss, qwen, exaone], taskWaves: [0, 0, 0], taskOutcomes: ["failed", "failed", "completed"],
    taskErrors: ["Coding route rejected the generic payload.", "Math route rejected the generic payload.", null],
    taskResults: ["No candidate.", "No candidate.", "ANSWER: D"]
  }
];

export const demoRuns: ArgusRun[] = specs.map(makeRun);

export const demoBenchProfiles: Record<string, DemoBenchProfile> = {
  "AIGO-R14-FINAL-CHECK": { coding: .7, math: .64, generic: .58 },
  "AIGO-R13-CACHED-RERUN": { coding: .62, math: .54, generic: .58 },
  "AIGO-R12-ADVERSARIAL": { coding: .67, math: .59, generic: .53 },
  "AIGO-R11-TRI-MODEL": { coding: .54, math: .62, generic: .48 },
  "AIGO-R10-TWO-WAVE": { coding: .47, math: .76, generic: .6 },
  "AIGO-R08-CODE-VERIFY": { coding: .56, math: .44, generic: .52 },
  "AIGO-R07-RETRY": { coding: .31, math: .46, generic: .54 },
  "AIGO-R06-CONSENSUS": { coding: .26, math: .52, generic: .68 },
  "AIGO-R05-CROSS-ROUTE": { coding: .16, math: .32, generic: .48 },
  "AIGO-R04-CONTRACT": { coding: .22, math: .34, generic: .46, graded: { generic: 6 } },
  "AIGO-R03-MATH-TIMEOUT": { coding: .12, math: .1, generic: .42, graded: { coding: 6, math: 2, generic: 6 } },
  "AIGO-R02-UNIVERSAL": { coding: .15, math: .25, generic: .38 },
  "AIGO-R01-BROADCAST": { coding: .1, math: .15, generic: .45 }
};

function evidenceFor(run: ArgusRun): ArgusEvidenceRecord[] {
  const terminal = run.events.find((event) => event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.capped")!;
  const aigoExportAt = new Date(new Date(terminal.timestamp).valueOf() + 1_200).toISOString();
  const portalExportAt = new Date(new Date(terminal.timestamp).valueOf() + 4_000).toISOString();
  return [
    {
      evidenceId: `${run.runId}-aigo-export`,
      source: "aigo",
      protocol: "Completed history JSON export",
      emittedAt: terminal.timestamp,
      receivedAt: aigoExportAt,
      fields: ["event ledger", "task graph", "agents", "model usage", "durations"],
      reference: `demo://${run.runId}/aigo-history.json`
    },
    {
      evidenceId: `${run.runId}-portal-export`,
      source: "portal",
      protocol: "Run-details JSON export",
      emittedAt: null,
      receivedAt: portalExportAt,
      fields: ["score", "outcome", "caps", "final answer", "grading status"],
      reference: `demo://${run.runId}/portal-run.json`
    }
  ];
}

function batchItemFor(run: ArgusRun): ArgusBatchItem {
  const evidence = evidenceFor(run);
  return {
    itemKey: `${run.itemId ?? "unknown-item"}:${run.runId}`,
    trace: run,
    evidence,
    links: [{
      linkId: `${run.runId}-same-item`,
      fromEvidenceId: evidence[0]!.evidenceId,
      toEvidenceId: evidence[1]!.evidenceId,
      relation: "same_evaluated_item",
      linkedAt: run.importedAt
    }]
  };
}

export const demoBatches: ArgusBatch[] = [{
  batchId: "batch-aigo-demo-thirteen-runs",
  name: "AI:GO demo experiments · 13 runs",
  source: "demo",
  settings: {
    maxConcurrentTasks: 5,
    maxTasks: 5,
    taskTimeoutSeconds: 180,
    directRequestByteLimit: 65_536
  },
  items: demoRuns.map(batchItemFor),
  createdAt: demoRuns.at(-1)!.events[0]!.timestamp,
  completedAt: demoRuns[0]!.importedAt
}];

export function makeImportedBatch(runs: ArgusRun[], loadedAt: string): ArgusBatch {
  const batchId = `import-${runs[0]?.runId ?? "empty"}`;
  const items = runs.map((run): ArgusBatchItem => {
    const source = run.source === "portal" ? "portal" : run.source === "aigo" ? "aigo" : "argus";
    const references = run.rawEvidenceRefs.length > 0 ? run.rawEvidenceRefs : [`import://${run.runId}`];
    return {
      itemKey: `${run.itemId ?? "unknown-item"}:${run.runId}`,
      trace: run,
      evidence: references.map((reference, index) => ({
        evidenceId: `${run.runId}-import-${index + 1}`,
        source,
        protocol: "Browser File API import",
        emittedAt: null,
        receivedAt: loadedAt,
        fields: ["run snapshot", "native events", "recorded metrics"],
        reference
      })),
      links: []
    };
  });
  return {
    batchId,
    name: runs.length === 1 ? `Imported item · ${runs[0]!.runId}` : `Imported batch · ${runs.length} items`,
    source: "imported",
    settings: { maxConcurrentTasks: null, maxTasks: null, taskTimeoutSeconds: null, directRequestByteLimit: null },
    items,
    createdAt: loadedAt,
    completedAt: loadedAt
  };
}

export function dataArrivalsFor(item: ArgusBatchItem, loadedAt: string): DataArrival[] {
  const run = item.trace;
  const bundled = run.source === "portal" && item.evidence.some((record) => record.protocol === "Portal run detail capture");
  const terminal = run.events.find((event) => event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.capped");
  const native = terminal ? [{
    id: `${run.runId}-native`,
    source: "AI:GO Runtime",
    receiver: "AI:GO history",
    protocol: "Native execution event ledger",
    startedAt: run.events[0]?.timestamp,
    recordedAt: terminal.timestamp,
    data: "kind · state · task · agent · model · token usage · duration",
    reference: item.evidence.find((record) => record.source === "aigo")?.reference
  } satisfies DataArrival] : [];
  const evidence = item.evidence.map((record): DataArrival => ({
    id: record.evidenceId,
    source: record.source === "aigo" ? "AI:GO" : record.source === "portal" ? "Portal" : "ARGUS",
    receiver: record.source === "argus" ? "ARGUS Trace" : "ARGUS evidence store",
    protocol: record.protocol,
    startedAt: record.emittedAt ?? undefined,
    recordedAt: record.receivedAt,
    data: record.fields.join(" · "),
    reference: record.reference
  }));
  const links = item.links.map((link): DataArrival => ({
    id: link.linkId,
    source: "ARGUS correlation index",
    receiver: "ARGUS Trace",
    protocol: "Evidence link · no field merge",
    recordedAt: link.linkedAt,
    data: `${link.fromEvidenceId} ↔ ${link.toEvidenceId} · ${link.relation.replaceAll("_", " ")}`
  }));
  return [...native, ...evidence, ...links, {
    id: `${run.runId}-trace-load`,
    source: run.source === "demo" ? "Bundled batch fixture" : bundled ? "Bundled evidence projection" : "Imported evidence",
    receiver: "ARGUS Trace",
    protocol: run.source === "demo" || bundled ? "Application module load" : "Browser File API",
    recordedAt: loadedAt,
    data: "source-aware item projection loaded for local replay",
    reference: run.source === "demo" ? `demo://${run.runId}` : run.rawEvidenceRefs.join(" · ") || undefined
  }];
}
