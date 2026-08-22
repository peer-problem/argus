import type { ArgusBatch, ArgusBatchItem, ArgusEvent, ArgusEvidenceRecord, ArgusRun, Track } from "../../../../lab/lib/types.ts";

const hash = (letter: string) => letter.repeat(64);

interface DemoSpec {
  runId: string;
  startedAt: string;
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
  const nativeCapped = spec.status === "capped";
  const nativeFailed = spec.outcome === "infrastructure_failed";
  const nativeCompleted = !nativeCapped && !nativeFailed;
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
      agentRole: "Native runtime",
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
    model: spec.plannerModel
  });
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
      cachedInput: Math.round(spec.cached * 0.4),
      normalizedCost: spec.cost * 0.25
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
    const taskCached = isLast ? Math.round(spec.cached * 0.6) - Math.floor((spec.cached * 0.6) / taskTotal) * taskIndex : Math.floor((spec.cached * 0.6) / taskTotal);
    const taskCost = isLast ? spec.cost * 0.62 - (spec.cost * 0.62 / taskTotal) * taskIndex : spec.cost * 0.62 / taskTotal;
    const common = {
      taskId,
      taskTitle,
      wave,
      dependsOnTaskIds: taskIndex === 0 ? [] : [taskIndex === 1 ? "solve" : `solve-${taskIndex}`],
      agentId: "ARGUS Solver",
      agentRole: "Universal Solver",
      model: spec.solverModel
    };

    push(segmentStart, "AI:GO Planner coordination", {
      ...common,
      kind: "task.created",
      state: "queued",
      agentId: "ARGUS Planner",
      agentRole: "Planner",
      model: spec.plannerModel,
      decision: `${taskTitle} created in wave ${wave + 1}.`
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
      ? { input: 0, output: finalOutput, reasoning: 0, cachedInput: 0, normalizedCost: spec.cost * 0.13 }
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
  return events;
}

function makeRun(spec: DemoSpec): ArgusRun {
  const status = spec.status ?? "completed";
  const compliant = spec.compliant ?? true;
  const events = makeEvents(spec);
  const { plannerInput, plannerOutput, solverInput, solverOutput } = splitUsage(spec);
  const plannerUsage = { model: spec.plannerModel, calls: 1, input: plannerInput, output: plannerOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.4), normalizedCost: spec.cost * 0.38, latencyMs: Math.round(spec.latency * 0.28) };
  const solverUsage = { model: spec.solverModel, calls: spec.taskCount ?? 1, input: solverInput, output: solverOutput, reasoning: 0, cachedInput: Math.round(spec.cached * 0.6), normalizedCost: spec.cost * 0.62, latencyMs: Math.round(spec.latency * 0.72) };
  const modelUsage = spec.plannerModel === spec.solverModel
    ? [{ ...plannerUsage, calls: 1 + (spec.taskCount ?? 1), input: spec.input, output: spec.output, cachedInput: spec.cached, normalizedCost: spec.cost, latencyMs: spec.latency }]
    : [plannerUsage, solverUsage];
  const terminal = events.find((event) => event.kind === "run.completed" || event.kind === "run.failed" || event.kind === "run.capped")!;
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
    failure: { itemStatus: "capped_tokens", kind: "token_cap", owner: "policy", secondaryTags: ["PLANNER_ZERO_OR_EXTRA_TASKS"], message: "Run token cap reached before final answer extraction." }
  },
  {
    runId: "ARGUS-C0-009",
    startedAt: "2026-08-22T01:24:00.000Z",
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
    solverModel: "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16",
    finalAnswer: "The answer is D.",
    outcome: "extraction_failed",
    compliant: false,
    failure: { itemStatus: "error", kind: "runner", owner: "team", secondaryTags: ["FORMAT_OPTION_LETTER"], message: "Final output did not match ANSWER: <letter>." }
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
    source: run.source === "demo" ? "Bundled batch fixture" : "Imported evidence",
    receiver: "ARGUS Trace",
    protocol: run.source === "demo" ? "Application module load" : "Browser File API",
    recordedAt: loadedAt,
    data: "source-aware item projection loaded for local replay",
    reference: run.source === "demo" ? `demo://${run.runId}` : run.rawEvidenceRefs.join(" · ") || undefined
  }];
}
