import type { Track, ValidationIssue, ValidationResult } from "./types.ts";

export const VIRTUAL_KERNEL_STAGES = ["normalize", "solve", "assert", "repair", "emit"] as const;

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function agentsOf(config: unknown): UnknownRecord[] {
  if (!isRecord(config) || !Array.isArray(config.agents)) return [];
  return config.agents.filter(isRecord);
}

function promptOf(agent: UnknownRecord | undefined): string {
  return typeof agent?.systemPrompt === "string" ? agent.systemPrompt : "";
}

function requirePattern(issues: ValidationIssue[], value: string, pattern: RegExp, code: string, message: string, path: string): void {
  if (!pattern.test(value)) issues.push({ code, message, path, severity: "error" });
}

export function lintVirtualKernelConfig(config: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const agents = agentsOf(config);
  const planner = agents.find((agent) => agent.name === "ARGUS Planner");
  const solver = agents.find((agent) => agent.name === "ARGUS Solver");
  const plannerPrompt = promptOf(planner);
  const solverPrompt = promptOf(solver);

  for (const [index, agent] of agents.entries()) {
    const identity = `${String(agent.name ?? "")} ${String(agent.role ?? "")}`;
    if (/kernel agent|state keeper|formatter|reviewer/i.test(identity)) {
      issues.push({ code: "VK_FORBIDDEN_ROLE", message: "Virtual Kernel v1 cannot add a Kernel Agent, State Keeper, Formatter, or Reviewer to the baseline roster.", path: `$.agents[${index}]`, severity: "error" });
    }
  }

  requirePattern(issues, plannerPrompt, /thin control driver/i, "VK_PLANNER_THIN_DRIVER", "Planner must identify itself as a thin control driver.", "$.agents[ARGUS Planner].systemPrompt");
  requirePattern(issues, plannerPrompt, /exactly one task assigned to ARGUS Solver/i, "VK_PLANNER_ONE_TASK", "Planner must create exactly one Solver task.", "$.agents[ARGUS Planner].systemPrompt");
  requirePattern(issues, plannerPrompt, /complete original request/i, "VK_PLANNER_FIDELITY", "Planner must preserve the complete original request.", "$.agents[ARGUS Planner].systemPrompt");
  requirePattern(issues, plannerPrompt, /short output-contract gate/i, "VK_PLANNER_CONTRACT_GATE", "Planner must restrict itself to a short output-contract gate.", "$.agents[ARGUS Planner].systemPrompt");
  requirePattern(issues, plannerPrompt, /aggregate it verbatim/i, "VK_PLANNER_VERBATIM", "Planner must aggregate a valid Solver artifact verbatim.", "$.agents[ARGUS Planner].systemPrompt");
  requirePattern(issues, plannerPrompt, /Never re-solve, paraphrase, reformat/i, "VK_PLANNER_NO_RESOLVE", "Planner must not re-solve or rewrite the Solver artifact.", "$.agents[ARGUS Planner].systemPrompt");

  requirePattern(issues, solverPrompt, /only execution subject of ARGUS Virtual Kernel v1/i, "VK_SOLVER_SUBJECT", "Solver must be the only Virtual Kernel execution subject.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /exactly one verification loop/i, "VK_SINGLE_LOOP", "Solver must run exactly one internal verification loop.", "$.agents[ARGUS Solver].systemPrompt");
  const stagePositions = VIRTUAL_KERNEL_STAGES.map((stage) => solverPrompt.indexOf(stage.toUpperCase()));
  if (stagePositions.some((position) => position < 0) || stagePositions.some((position, index) => index > 0 && position <= stagePositions[index - 1]!)) {
    issues.push({ code: "VK_STAGE_ORDER", message: "Solver must contain NORMALIZE → SOLVE → ASSERT → REPAIR → EMIT in order.", path: "$.agents[ARGUS Solver].systemPrompt", severity: "error" });
  }
  requirePattern(issues, solverPrompt, /REPAIR[^.;]*at most once/i, "VK_REPAIR_LIMIT", "Solver repair must be limited to one revision.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /Do not expose this protocol, intermediate state, reasoning, or discarded candidates/i, "VK_OUTPUT_ISOLATION", "Solver must isolate internal stages and discarded candidates from output.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /Coding assertions:/i, "VK_CODING_ASSERTIONS", "Solver must define Coding assertions.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /Math assertions:/i, "VK_MATH_ASSERTIONS", "Solver must define Math assertions.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /Generic assertions:/i, "VK_GENERIC_ASSERTIONS", "Solver must define Generic assertions.", "$.agents[ARGUS Solver].systemPrompt");
  requirePattern(issues, solverPrompt, /Never request or claim to use code execution, tests, calculator/i, "VK_NO_FALSE_EXECUTION", "Solver must not request or claim external execution.", "$.agents[ARGUS Solver].systemPrompt");

  if (isRecord(config) && isRecord(config.methodology)) {
    const methodology = config.methodology;
    if (methodology.id !== "ARGUS-VIRTUAL-KERNEL" || methodology.version !== 1 || methodology.source !== ".agents/docs/ARGUS-VIRTUAL-KERNEL.md" || methodology.executionAgent !== "ARGUS Solver") {
      issues.push({ code: "VK_METADATA_IDENTITY", message: "Methodology metadata must cite the current ARGUS Virtual Kernel v1 document and bind it to ARGUS Solver.", path: "$.methodology", severity: "error" });
    }
    if (JSON.stringify(methodology.stages) !== JSON.stringify(VIRTUAL_KERNEL_STAGES) || methodology.repairLimit !== 1) {
      issues.push({ code: "VK_METADATA_LOOP", message: "Methodology metadata must declare the five ordered stages and repairLimit 1.", path: "$.methodology", severity: "error" });
    }
    if (methodology.stateScope !== "single-inference" || methodology.observability !== "contract-only" || methodology.externalExecution !== false) {
      issues.push({ code: "VK_METADATA_BOUNDARY", message: "Methodology metadata must keep state inside one inference, expose contract evidence only, and disable external execution.", path: "$.methodology", severity: "error" });
    }
  }

  return { ok: issues.length === 0, value: config, issues };
}

const TRACK_ASSERTIONS: Record<Exclude<Track, "unknown">, RegExp[]> = {
  coding: [/paths?/, /code/, /indentation/, /smallest supported patch/, /empty repo/i],
  math: [/every condition/, /integer/, /symbolic/, /domain/, /back-substitute|cross-check/],
  generic: [/shown options?/, /distractors?/, /definition/, /scope/, /refutation/]
};

export function lintVirtualKernelTrackPrompt(track: Exclude<Track, "unknown">, prompt: string, path = "prompt"): ValidationResult {
  const issues: ValidationIssue[] = [];
  requirePattern(issues, prompt, /ARGUS Virtual Kernel v1/i, "VK_PROMPT_IDENTITY", "Track prompt must name ARGUS Virtual Kernel v1.", path);
  requirePattern(issues, prompt, /one ARGUS Solver task; no others/i, "VK_PROMPT_ONE_TASK", "Track prompt must route exactly one Solver task.", path);
  requirePattern(issues, prompt, /Normalize→Solve→Assert→one Repair→Emit/i, "VK_PROMPT_LOOP", "Track prompt must invoke the configured one-repair protocol.", path);
  requirePattern(issues, prompt, /accept only a contract-valid/i, "VK_PROMPT_GATE", "Track prompt must gate the Solver result against the output contract.", path);
  requirePattern(issues, prompt, /aggregate (?:it )?verbatim/i, "VK_PROMPT_VERBATIM", "Track prompt must preserve the accepted artifact verbatim.", path);
  for (const pattern of TRACK_ASSERTIONS[track]) requirePattern(issues, prompt, pattern, "VK_PROMPT_TRACK_ASSERTION", `${track} prompt is missing a track assertion matching ${pattern}.`, path);
  return { ok: issues.length === 0, issues };
}
