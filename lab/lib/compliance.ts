import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { GateEvidence, ValidationIssue, ValidationResult } from "./types.ts";
import { lintContextPolicy } from "./context.ts";
import { sha256File, verifyHashManifest } from "./hash.ts";
import { lintVirtualKernelConfig } from "./virtual-kernel.ts";
import { lintCandidateLadder } from "./candidates.ts";

export const ALLOWED_MODEL_IDS = new Set([
  "furiosa-ai/Qwen3-32B-FP8",
  "furiosa-ai/gpt-oss-120b",
  "furiosa-ai/K-EXAONE-236B-A23B-NVFP4A16"
]);

export const FALLBACK_SIGNATURES = [
  "planner has no usable model",
  "planner call failed",
  "produced no tasks",
  "router is not running"
] as const;

const FORBIDDEN_CONFIG_KEYS = new Set([
  "apiKey",
  "accessToken",
  "secret",
  "password",
  "templateId",
  "profileId",
  "sourceTemplateId",
  "sourceProfileId",
  "mcpServers",
  "customTools"
]);

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function arrayAt(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function findForbiddenKeys(value: unknown, path = "$", issues: ValidationIssue[] = []): ValidationIssue[] {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findForbiddenKeys(entry, `${path}[${index}]`, issues));
    return issues;
  }
  if (!isRecord(value)) return issues;
  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (FORBIDDEN_CONFIG_KEYS.has(key) && child != null && !(key === "templateId" && child === null)) {
      issues.push({ code: "CONFIG_FORBIDDEN_FIELD", message: `Forbidden field ${key} is present.`, path: childPath, severity: "error" });
    }
    findForbiddenKeys(child, childPath, issues);
  }
  return issues;
}

export function lintSquadConfig(config: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (!isRecord(config)) return { ok: false, issues: [{ code: "CONFIG_SHAPE", message: "Config must be a JSON object.", severity: "error" }] };
  if (config.name !== "ARGUS") issues.push({ code: "CONFIG_NAME", message: "Squad name must be ARGUS.", path: "$.name", severity: "error" });
  const directCreation = config.creationMethod === "manual-new";
  const deliveryCreation = config.isBuiltin === false && typeof config.id === "string" && config.id.startsWith("argus-direct-delivery-");
  if (!directCreation && !deliveryCreation) issues.push({ code: "CONFIG_CREATION_METHOD", message: "Config must prove the 새로 만들기/manual origin or be its direct delivery mapping.", path: "$.creationMethod", severity: "error" });
  if (config.isBuiltin === true) issues.push({ code: "CONFIG_BUILTIN", message: "ARGUS cannot originate from a built-in Squad.", path: "$.isBuiltin", severity: "error" });
  const agents = arrayAt(config.agents).filter(isRecord);
  if (agents.length !== 2) issues.push({ code: "CONFIG_ROSTER", message: `Baseline must have exactly two agents; found ${agents.length}.`, path: "$.agents", severity: "error" });
  const planner = agents.find((agent) => agent.name === "ARGUS Planner");
  const solver = agents.find((agent) => agent.name === "ARGUS Solver");
  if (!planner) issues.push({ code: "CONFIG_PLANNER_MISSING", message: "ARGUS Planner is missing.", path: "$.agents", severity: "error" });
  if (!solver) issues.push({ code: "CONFIG_SOLVER_MISSING", message: "ARGUS Solver is missing.", path: "$.agents", severity: "error" });

  for (const [index, agent] of agents.entries()) {
    const path = `$.agents[${index}]`;
    const tools = arrayAt(agent.tools);
    const toolConfig = isRecord(agent.toolConfig) ? agent.toolConfig : {};
    if (tools.length > 0 || arrayAt(toolConfig.enabledTools).length > 0 || Object.keys(isRecord(toolConfig.customToolConfigs) ? toolConfig.customToolConfigs : {}).length > 0 || Object.keys(isRecord(toolConfig.toolPermissionOverrides) ? toolConfig.toolPermissionOverrides : {}).length > 0) {
      issues.push({ code: "CONFIG_USER_TOOLS", message: `${String(agent.name)} has user-facing tools attached.`, path, severity: "error" });
    }
    if (agent.memoryEnabled !== false) issues.push({ code: "CONFIG_MEMORY", message: `${String(agent.name)} must have memory off.`, path, severity: "error" });
    if (agent.executionMode !== "in-process" && agent.executionMode !== "in_process") issues.push({ code: "CONFIG_EXECUTION_MODE", message: `${String(agent.name)} must use in-process execution.`, path, severity: "error" });
    const preferences = isRecord(agent.modelPreferences) ? agent.modelPreferences : {};
    const model = typeof agent.model === "string" ? agent.model : preferences.preferredModelId;
    if (typeof model !== "string" || !ALLOWED_MODEL_IDS.has(model)) issues.push({ code: "CONFIG_MODEL_ID", message: `${String(agent.name)} does not use an exact allowed provider model ID.`, path, severity: "error" });
    if (agent.name === "ARGUS Planner") {
      if (preferences.requiresToolCalling !== true) issues.push({ code: "CONFIG_PLANNER_PROTOCOL", message: "Planner requiresToolCalling must be true for native orchestration.", path, severity: "error" });
      if (model === "furiosa-ai/gpt-oss-120b") issues.push({ code: "CONFIG_PLANNER_GPT_OSS", message: "gpt-oss is not a Planner candidate until a functional tool protocol probe passes.", path, severity: "error" });
    } else if (preferences.requiresToolCalling !== false) {
      issues.push({ code: "CONFIG_SOLVER_TOOL_CAPABILITY", message: `${String(agent.name)} requiresToolCalling must be false.`, path, severity: "error" });
    }
  }
  if (isRecord(config.approval) && config.approval.expectedTaskCount !== 1) issues.push({ code: "CONFIG_TASK_COUNT", message: "Expected native task count must be exactly one.", path: "$.approval.expectedTaskCount", severity: "error" });
  if (directCreation) {
    const approval = isRecord(config.approval) ? config.approval : {};
    if (typeof approval.autoApprove !== "boolean" || approval.expectedTaskCount !== 1) issues.push({ code: "CONFIG_APPROVAL", message: "Direct candidate must declare approval mode and expect exactly one task.", path: "$.approval", severity: "error" });
    const budget = isRecord(config.budget) ? config.budget : {};
    const ceilings: Array<[string, number]> = [
      ["totalTokens", 80_000], ["perAgentTokens", 25_000], ["perTaskTokens", 18_000],
      ["maxConcurrentTasks", 1], ["maxTasks", 1], ["maxPlanIterations", 1], ["maxAgentTurns", 6],
      ["executionTimeoutSeconds", 300], ["taskTimeoutSeconds", 240]
    ];
    for (const [key, ceiling] of ceilings) {
      const value = budget[key];
      if (typeof value !== "number" || value <= 0 || value > ceiling) issues.push({ code: "CONFIG_BUDGET", message: `${key} must be a positive number no greater than ${ceiling}.`, path: `$.budget.${key}`, severity: "error" });
    }
  }
  findForbiddenKeys(config, "$", issues);
  issues.push(...lintContextPolicy(config).issues);
  issues.push(...lintVirtualKernelConfig(config).issues);
  return { ok: !issues.some((issue) => issue.severity === "error"), value: config, issues };
}

export function detectFallbackSignatures(text: string): string[] {
  const normalized = text.toLowerCase();
  return FALLBACK_SIGNATURES.filter((signature) => normalized.includes(signature));
}

const SECRET_PATTERNS: Array<[string, RegExp]> = [
  ["OPENAI_STYLE_KEY", /\bsk-[A-Za-z0-9_-]{20,}\b/g],
  ["GOOGLE_API_KEY", /\bAIza[0-9A-Za-z_-]{30,}\b/g],
  ["BEARER_TOKEN", /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}=*\b/gi],
  ["PRIVATE_KEY", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
  ["ASSIGNED_SECRET", /(?:api[_-]?key|access[_-]?token|password|client[_-]?secret)\s*[=:]\s*["']?[A-Za-z0-9._~+\/-]{12,}/gi]
];

export function scanSecrets(text: string, path = "input"): ValidationResult {
  const issues: ValidationIssue[] = [];
  for (const [code, regex] of SECRET_PATTERNS) {
    regex.lastIndex = 0;
    if (regex.test(text)) issues.push({ code: `SECRET_${code}`, message: `Possible secret detected in ${path}.`, path, severity: "error" });
  }
  return { ok: issues.length === 0, issues };
}

export const REQUIRED_GATES = [
  "requestByteGate",
  "plannerProtocolGate",
  "sweFidelityGate",
  "submissionBindingGate",
  "capGate",
  "fallbackGate",
  "formatGate"
] as const;

export interface AuditReport {
  candidateValid: boolean;
  gatesPassed: number;
  gatesRequired: number;
  freezeReady: boolean;
  issues: ValidationIssue[];
}

function validBoundArtifact(config: UnknownRecord, refKey: string, hashKey: string, cwd: string, issues: ValidationIssue[]): boolean {
  const ref = config[refKey];
  const hash = config[hashKey];
  if (typeof ref !== "string" || !existsSync(resolve(cwd, ref))) {
    issues.push({ code: "ARTIFACT_MISSING", message: `${refKey} does not reference an existing file.`, path: `$.${refKey}`, severity: "error" });
    return false;
  }
  if (typeof hash !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(hash)) {
    issues.push({ code: "ARTIFACT_HASH_MISSING", message: `${hashKey} is not a SHA-256 digest.`, path: `$.${hashKey}`, severity: "error" });
    return false;
  }
  if (sha256File(resolve(cwd, ref)) !== hash.replace(/^sha256:/, "")) {
    issues.push({ code: "ARTIFACT_HASH_MISMATCH", message: `${refKey} does not match ${hashKey}.`, path: `$.${hashKey}`, severity: "error" });
    return false;
  }
  return true;
}

function validEvidence(value: unknown, cwd: string, gate: string, issues: ValidationIssue[]): value is GateEvidence {
  if (!isRecord(value) || !["passed", "failed", "unverified"].includes(String(value.status))) {
    issues.push({ code: "GATE_UNVERIFIED", message: `${gate} has not passed.`, path: `$.evidence.${gate}`, severity: "error" });
    return false;
  }
  if (typeof value.evidenceRef !== "string" || !existsSync(resolve(cwd, value.evidenceRef))) {
    issues.push({ code: "GATE_EVIDENCE_MISSING", message: `${gate} does not reference an existing evidence file.`, path: `$.evidence.${gate}.evidenceRef`, severity: "error" });
    return false;
  }
  if (typeof value.evidenceHash !== "string" || !/^(sha256:)?[a-f0-9]{64}$/.test(value.evidenceHash)) {
    issues.push({ code: "GATE_HASH_MISSING", message: `${gate} lacks a SHA-256 evidence hash.`, path: `$.evidence.${gate}.evidenceHash`, severity: "error" });
    return false;
  }
  const expected = value.evidenceHash.replace(/^sha256:/, "");
  const actual = sha256File(resolve(cwd, value.evidenceRef));
  if (expected !== actual) {
    issues.push({ code: "GATE_HASH_MISMATCH", message: `${gate} evidence hash does not match its file.`, path: `$.evidence.${gate}.evidenceHash`, severity: "error" });
    return false;
  }
  if (value.status !== "passed") {
    issues.push({ code: "GATE_UNVERIFIED", message: `${gate} has not passed.`, path: `$.evidence.${gate}`, severity: "error" });
    return false;
  }
  return true;
}

export function auditCandidate(config: unknown, cwd = process.cwd()): AuditReport {
  const lint = lintSquadConfig(config);
  const issues = [...lint.issues];
  const candidate = isRecord(config) ? config : {};
  const evidence = isRecord(candidate.evidence) ? candidate.evidence : {};
  const mappingValid = validBoundArtifact(candidate, "mappingManifest", "mappingManifestHash", cwd, issues);
  const creationValid = validBoundArtifact(candidate, "creationEvidence", "creationEvidenceHash", cwd, issues);
  const ladderBound = validBoundArtifact(candidate, "candidateLadder", "candidateLadderHash", cwd, issues);
  let manifestValid = false;
  let ladderValid = false;
  if (mappingValid && typeof candidate.mappingManifest === "string") {
    try {
      const mapping = JSON.parse(readFileSync(resolve(cwd, candidate.mappingManifest), "utf8"));
      const verification = verifyHashManifest(mapping, cwd);
      issues.push(...verification.issues);
      manifestValid = verification.ok;
    } catch (error) {
      issues.push({ code: "MANIFEST_JSON", message: `Mapping manifest is invalid JSON: ${(error as Error).message}`, path: "$.mappingManifest", severity: "error" });
    }
  }
  if (ladderBound && typeof candidate.candidateLadder === "string") {
    try {
      const ladder = JSON.parse(readFileSync(resolve(cwd, candidate.candidateLadder), "utf8"));
      const verification = lintCandidateLadder(ladder);
      issues.push(...verification.issues);
      ladderValid = verification.ok;
    } catch (error) {
      issues.push({ code: "LADDER_JSON", message: `Candidate ladder is invalid JSON: ${(error as Error).message}`, path: "$.candidateLadder", severity: "error" });
    }
  }
  let gatesPassed = 0;
  for (const gate of REQUIRED_GATES) if (validEvidence(evidence[gate], cwd, gate, issues)) gatesPassed += 1;
  const artifactIntegrity = mappingValid && creationValid && manifestValid && ladderBound && ladderValid;
  return { candidateValid: lint.ok && artifactIntegrity, gatesPassed, gatesRequired: REQUIRED_GATES.length, freezeReady: lint.ok && artifactIntegrity && gatesPassed === REQUIRED_GATES.length, issues };
}

export function loadAndLintConfig(path: string): ValidationResult {
  const raw = readFileSync(path, "utf8");
  const secretResult = scanSecrets(raw, path);
  let config: unknown;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    return { ok: false, issues: [...secretResult.issues, { code: "CONFIG_JSON", message: `Invalid JSON: ${(error as Error).message}`, path, severity: "error" }] };
  }
  const lint = lintSquadConfig(config);
  return { ok: secretResult.ok && lint.ok, value: config, issues: [...secretResult.issues, ...lint.issues] };
}

export function loadAndLintConfigValue(config: unknown): ValidationResult {
  const secretResult = scanSecrets(JSON.stringify(config), "config");
  const lint = lintSquadConfig(config);
  return { ok: secretResult.ok && lint.ok, value: config, issues: [...secretResult.issues, ...lint.issues] };
}
