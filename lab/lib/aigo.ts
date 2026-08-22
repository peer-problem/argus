import type { ValidationIssue, ValidationResult } from "./types.ts";

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as UnknownRecord : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function roleLabel(value: unknown): string {
  if (typeof value === "string") return value;
  const role = record(value);
  const type = text(role.type);
  if (type === "planner") return "Planner";
  if (type === "custom") return text(role.value, "Custom");
  return type ? `${type[0]!.toUpperCase()}${type.slice(1)}` : "Custom";
}

function sanitizeToolConfig(value: unknown) {
  const source = record(value);
  return {
    enabledTools: array(source.enabledTools).filter((item): item is string => typeof item === "string"),
    disabledTools: array(source.disabledTools).filter((item): item is string => typeof item === "string"),
    toolPermissionOverrides: record(source.toolPermissionOverrides),
    customToolConfigs: record(source.customToolConfigs)
  };
}

function mapAgent(value: unknown) {
  const agent = record(value);
  const preferences = record(agent.modelPreferences);
  const settings = record(agent.settingsOverrides);
  const toolConfig = sanitizeToolConfig(agent.toolConfig);
  return {
    id: text(agent.id),
    name: text(agent.name),
    role: roleLabel(agent.role),
    icon: text(agent.icon, "🤖"),
    description: text(agent.description),
    systemPrompt: text(agent.systemPrompt),
    instructions: text(agent.instructions),
    providerId: text(preferences.preferredProviderId),
    model: text(preferences.preferredModelId),
    tools: [...toolConfig.enabledTools],
    toolConfig,
    modelPreferences: {
      preferredModelId: text(preferences.preferredModelId),
      preferredProviderId: text(preferences.preferredProviderId),
      minContextWindow: numberOrNull(preferences.minContextWindow),
      requiresToolCalling: preferences.requiresToolCalling === true,
      requiresVision: preferences.requiresVision === true
    },
    memoryEnabled: agent.memoryEnabled === true,
    executionMode: text(agent.executionMode).replaceAll("_", "-"),
    maxToolCallRounds: numberOrNull(settings.maxIterations),
    maxTokens: numberOrNull(settings.maxTokens),
    sourceProfileId: agent.sourceProfileId ?? null
  };
}

function mapBudget(value: unknown) {
  const budget = record(value);
  return {
    totalTokens: numberOrNull(budget.maxTotalTokens),
    perAgentTokens: numberOrNull(budget.maxTokensPerAgent),
    perTaskTokens: numberOrNull(budget.maxTokensPerTask),
    maxConcurrentTasks: numberOrNull(budget.maxConcurrentAgents),
    maxTasks: numberOrNull(budget.maxTasksPerPlan),
    maxPlanIterations: numberOrNull(budget.maxPlanIterations),
    maxAgentTurns: numberOrNull(budget.maxAgentTurns),
    executionTimeoutSeconds: numberOrNull(budget.executionTimeoutSecs),
    taskTimeoutSeconds: numberOrNull(budget.taskTimeoutSecs),
    agentIdleTimeoutSeconds: numberOrNull(budget.agentIdleTimeoutSecs),
    warningThresholdPercent: numberOrNull(budget.warningThresholdPercent)
  };
}

export function snapshotAigoSquad(configValue: unknown, budgetValue: unknown, candidateId = "ARGUS-C0") {
  const config = record(configValue);
  const agents = array(config.agents).map(mapAgent);
  return {
    schemaVersion: 1,
    candidateId,
    status: "gate-failed",
    name: text(config.name),
    description: text(config.description),
    creationMethod: "manual-new",
    sourceSquadId: text(config.id),
    workspacePath: text(config.workspacePath),
    plannerAgentId: text(config.plannerAgentId),
    approval: { autoApprove: false, expectedTaskCount: 1 },
    budget: mapBudget(budgetValue),
    agents,
    sourceTimestamps: {
      createdAt: text(config.createdAt),
      updatedAt: text(config.updatedAt)
    }
  };
}

/**
 * Converts the manually created live Squad to AI:GO's schemaVersion 1 delivery
 * shape. This does not import, install, or save a template in AI:GO.
 */
export function mapAigoSquadToDelivery(configValue: unknown, deliveryId = "argus-direct-delivery-v1") {
  const config = record(configValue);
  const agents = array(config.agents).map((value) => {
    const agent = mapAgent(value);
    return {
      name: agent.name,
      role: agent.role,
      systemPrompt: agent.systemPrompt,
      tools: agent.tools,
      memoryEnabled: agent.memoryEnabled,
      icon: agent.icon,
      toolConfig: agent.toolConfig,
      modelPreferences: agent.modelPreferences,
      settingsOverrides: {
        maxIterations: agent.maxToolCallRounds,
        maxTokens: agent.maxTokens
      },
      executionMode: agent.executionMode.replaceAll("-", "_")
    };
  });
  return {
    schemaVersion: 1,
    id: deliveryId,
    name: text(config.name),
    description: text(config.description),
    icon: "◉",
    category: "custom",
    isBuiltin: false,
    suggestedModels: [...new Set(agents.map((agent) => agent.modelPreferences.preferredModelId).filter(Boolean))],
    agents
  };
}

export function lintAigoSource(configValue: unknown): ValidationResult {
  const issues: ValidationIssue[] = [];
  const config = record(configValue);
  if (text(config.name) !== "ARGUS") issues.push({ code: "AIGO_NAME", message: "Live Squad name must be ARGUS.", path: "$.name", severity: "error" });
  const agents = array(config.agents).map(record);
  if (agents.length !== 2) issues.push({ code: "AIGO_ROSTER", message: `Expected two live agents; found ${agents.length}.`, path: "$.agents", severity: "error" });
  if (!agents.some((agent) => text(agent.name) === "ARGUS Planner")) issues.push({ code: "AIGO_PLANNER", message: "Live ARGUS Planner is missing.", path: "$.agents", severity: "error" });
  if (!agents.some((agent) => text(agent.name) === "ARGUS Solver")) issues.push({ code: "AIGO_SOLVER", message: "Live ARGUS Solver is missing.", path: "$.agents", severity: "error" });
  for (const [index, agent] of agents.entries()) {
    const tools = sanitizeToolConfig(agent.toolConfig);
    if (tools.enabledTools.length || Object.keys(tools.customToolConfigs).length) issues.push({ code: "AIGO_USER_TOOLS", message: `${text(agent.name)} has attached user tools.`, path: `$.agents[${index}].toolConfig`, severity: "error" });
    if (agent.memoryEnabled !== false) issues.push({ code: "AIGO_MEMORY", message: `${text(agent.name)} must have memory disabled.`, path: `$.agents[${index}].memoryEnabled`, severity: "error" });
    if (text(agent.executionMode) !== "in_process") issues.push({ code: "AIGO_EXECUTION", message: `${text(agent.name)} must use in_process execution.`, path: `$.agents[${index}].executionMode`, severity: "error" });
    if (agent.sourceProfileId != null) issues.push({ code: "AIGO_PROFILE_ORIGIN", message: `${text(agent.name)} came from a profile.`, path: `$.agents[${index}].sourceProfileId`, severity: "error" });
  }
  return { ok: issues.length === 0, value: configValue, issues };
}
