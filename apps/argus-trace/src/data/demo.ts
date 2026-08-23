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
  const solverInput = Math.round(spec.input * 0.56);
  const plannerInput = spec.input - solverInput;
  const plannerOutput = Math.round(spec.output * 0.3);
  const solverOutput = spec.output - plannerOutput;
  const planOutput = Math.round(plannerOutput * 0.62);
  const finalOutput = plannerOutput - planOutput;
  return { solverInput, plannerInput, solverOutput, plannerOutput, planOutput, finalOutput };
}

function makeEvents(spec: DemoSpec): ArgusEvent[] {
  const events: ArgusEvent[] = [];
  const { finalOutput, planOutput, plannerInput, solverInput, solverOutput } = splitUsage(spec);
  const taskTotal = spec.taskCount ?? 1;
  const plannerCallCount = Math.max(1, taskTotal);
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
      input: share(plannerInput, 0, plannerCallCount),
      output: share(planOutput, 0, plannerCallCount),
      reasoning: 0,
      cachedInput: share(Math.round(cached * 0.4), 0, plannerCallCount),
      normalizedCost: cost * 0.25 / plannerCallCount
    }
  });

  for (let taskIndex = 0; taskIndex < taskTotal; taskIndex += 1) {
    const taskId = taskIndex === 0 ? "solve" : `solve-${taskIndex + 1}`;
    const taskTitle = taskIndex === 0 ? "Produce one contract-valid answer" : "Unexpected additional Solver task";
    const wave = taskIndex;
    const segmentStart = taskWindowStart + Math.round((taskWindow / taskTotal) * taskIndex);
    const segmentEnd = taskWindowStart + Math.round((taskWindow / taskTotal) * (taskIndex + 1));
    const isLast = taskIndex === taskTotal - 1;
    const taskFailed = isLast && !nativeCompleted;
    const taskInput = isLast ? solverInput - Math.floor(solverInput / taskTotal) * taskIndex : Math.floor(solverInput / taskTotal);
    const taskOutput = isLast ? solverOutput - Math.floor(solverOutput / taskTotal) * taskIndex : Math.floor(solverOutput / taskTotal);
    const taskCached = isLast ? Math.round(cached * 0.6) - Math.floor((cached * 0.6) / taskTotal) * taskIndex : Math.floor((cached * 0.6) / taskTotal);
    const taskCost = isLast ? cost * 0.62 - (cost * 0.62 / taskTotal) * taskIndex : cost * 0.62 / taskTotal;
    const common = {
      taskId,
      taskTitle,
      wave,
      dependsOnTaskIds: taskIndex === 0 ? [] : [taskIndex === 1 ? "solve" : `solve-${taskIndex}`],
      agentId: "ARGUS Solver",
      agentRole: "Universal Solver",
      model: null
    };

    push(segmentStart, "AI:GO Planner coordination", {
      ...common,
      kind: "task.created",
      state: "queued",
      agentId: "ARGUS Planner",
      agentRole: "Planner",
      model: taskIndex === 0 ? null : spec.plannerModel,
      decision: `${taskTitle} created in wave ${wave + 1}.`,
      durationMs: taskIndex === 0 ? 0 : Math.min(900, Math.max(360, Math.round(planOffset * 0.65))),
      tokens: taskIndex === 0
        ? { input: 0, output: 0, reasoning: 0, cachedInput: 0, normalizedCost: 0 }
        : {
            input: share(plannerInput, taskIndex, plannerCallCount),
            output: share(planOutput, taskIndex, plannerCallCount),
            reasoning: 0,
            cachedInput: share(Math.round(cached * 0.4), taskIndex, plannerCallCount),
            normalizedCost: cost * 0.25 / plannerCallCount
          }
    });
    push(segmentStart + 60, "AI:GO Planner coordination", {
      ...common,
      kind: "task.assigned",
      state: "queued",
      decision: `${taskId} assigned to ARGUS Solver.`
    });
    push(segmentStart + 120, "AI:GO native task execution", {
      ...common,
      kind: "task.started",
      state: "running",
      decision: "Complete request context handed to the universal Solver."
    });
    push(segmentEnd, "AI:GO native task execution", {
      ...common,
      model: spec.solverModel,
      kind: taskFailed ? "task.failed" : "task.completed",
      state: taskFailed ? (nativeCapped ? "capped" : "failed") : "completed",
      decision: taskFailed
        ? spec.failure?.message || "Task ended without a native candidate."
        : spec.track === "coding"
          ? "Minimal, applicable patch candidate produced."
          : "Single answer candidate produced.",
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
      sourceEventType: typeof event.raw?.sourceEventType === "string" ? event.raw.sourceEventType : event.kind,
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
      status: completed.state,
      output: failed ? null : taskIndex === taskIds.length - 1 ? spec.finalAnswer : `Intermediate candidate ${taskIndex + 1} recorded.`,
      error: failed ? spec.failure?.message ?? completed.decision : null,
      durationMs: completed.durationMs,
      tokens: { input: completed.tokens.input, output: completed.tokens.output },
      priority: taskIndex === 0 ? "high" : "normal",
      description: completed.taskTitle ?? "Execute the planned work item.",
      createdBy: "ARGUS Planner",
      dependsOnTaskIds: completed.dependsOnTaskIds ?? [],
      artifacts: completed.artifactRef == null ? [] : [completed.artifactRef],
      result: failed ? null : completed.decision,
      retryCount: failed ? 1 : 0,
      maxRetries: 2,
      startedAt: started?.timestamp ?? null,
      completedAt: completed.timestamp,
      markdown: `# ${completed.taskTitle ?? taskId}\n\n${completed.decision}`
    };
  });
  const request = spec.track === "coding"
    ? "Inspect the failing repository behavior and return the smallest contract-valid patch. Preserve unrelated source changes and include only the final patch artifact."
    : spec.track === "math"
      ? "Solve the problem carefully, verify the result, and return one contract-valid boxed answer."
      : "Evaluate the supplied choices and return the single contract-valid answer.";
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
    events,
    detail: {
      executionId: spec.runId,
      squadId: `squad-${spec.runId.toLowerCase()}`,
      squadName: `${spec.track[0]!.toUpperCase()}${spec.track.slice(1)} analysis squad`,
      request,
      planTitle: tasks.length === 1 ? tasks[0]!.title : `${tasks.length}-wave ${spec.track} plan`,
      startedAt: spec.startedAt,
      completedAt: terminal.timestamp,
      tasks,
      console: [
        { timestamp: at(spec, 180), level: "info", agentId: "ARGUS Planner", message: "Planning started." },
        ...tasks.map((task) => ({ timestamp: task.completedAt ?? terminal.timestamp, level: task.error == null ? "info" : "error", agentId: task.agentId ?? "AI:GO Runtime", message: task.error ?? `${task.title} completed.` })),
        { timestamp: terminal.timestamp, level: spec.failure == null ? "info" : "warn", agentId: "AI:GO Runtime", message: terminal.decision }
      ],
      reportMarkdown: `# Execution report\n\n- Execution: \`${spec.runId}\`\n- Status: **${status}**\n- Tasks: ${tasks.length}\n- Prompt tokens: ${spec.input}\n- Completion tokens: ${spec.output}\n\n${spec.failure?.message ?? "The execution completed with a recorded result."}`
    },
    rawEvidenceRefs: [`demo://${spec.runId}/aigo-history.json`, `demo://${spec.runId}/portal-run.json`],
    importedAt: new Date(new Date(terminal.timestamp).valueOf() + 5_200).toISOString()
  };
}

const specs: DemoSpec[] = [
  {
    runId: "ARGUS-C0-014",
    startedAt: "2026-08-22T01:00:00.000Z",
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
  },
  {
    runId: "ARGUS-C1-021",
    startedAt: "2026-08-22T01:08:00.000Z",
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
  },
  {
    runId: "ARGUS-C2-031",
    startedAt: "2026-08-22T01:16:00.000Z",
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
    includeInferredAgentState: true,
    failure: { itemStatus: "capped_tokens", kind: "token_cap", owner: "policy", secondaryTags: ["PLANNER_ZERO_OR_EXTRA_TASKS"], message: "Run token cap reached before final answer extraction." }
  },
  {
    runId: "ARGUS-C3-044",
    startedAt: "2026-08-22T01:32:00.000Z",
    track: "generic",
    itemId: "generic-visible-24",
    dataset: "MMLU-Pro · business",
    score: 1,
    input: 28_760,
    output: 2_340,
    cached: 9_880,
    cost: 5_614,
    latency: 81_600,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16",
    finalAnswer: "ANSWER: B"
  },
  {
    runId: "ARGUS-C4-052",
    startedAt: "2026-08-22T01:42:00.000Z",
    track: "coding",
    itemId: "coding-hidden-17",
    dataset: "SWE-bench Verified · hidden",
    score: 0,
    input: 37_540,
    output: 3_890,
    cached: 12_604,
    cost: 12_480,
    latency: 96_300,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/gpt-oss-120b",
    finalAnswer: null,
    status: "failed",
    outcome: "infrastructure_failed",
    compliant: false,
    taskCount: 2,
    failure: { itemStatus: "error", kind: "infrastructure", owner: "organizer", secondaryTags: ["WORKER_RESTART", "ARTIFACT_UNAVAILABLE"], message: "Solver worker restarted before the selected artifact could be persisted." }
  },
  {
    runId: "ARGUS-C5-061",
    startedAt: "2026-08-22T01:54:00.000Z",
    track: "math",
    itemId: "math-private-07",
    dataset: null,
    score: null,
    input: 11_880,
    output: 1_012,
    cached: null,
    cost: null,
    latency: 28_700,
    plannerModel: "furiosa-ai/Qwen3-32B-FP8",
    solverModel: "furiosa-ai/gpt-oss-120b",
    finalAnswer: "\\boxed{42}",
    eventTimingsObserved: false
  }
];

export const demoRuns: ArgusRun[] = specs.map(makeRun);

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
  batchId: "batch-demo-protocol-01",
  name: "Protocol coverage batch",
  source: "demo",
  settings: {
    maxConcurrentTasks: 1,
    maxTasks: 1,
    taskTimeoutSeconds: 240,
    directRequestByteLimit: 65_536
  },
  items: demoRuns.map(batchItemFor),
  createdAt: demoRuns[0]!.events[0]!.timestamp,
  completedAt: demoRuns.at(-1)!.importedAt
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
