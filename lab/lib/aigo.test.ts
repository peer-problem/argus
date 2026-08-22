import { describe, expect, it } from "vitest";
import { lintAigoSource, mapAigoSquadToDelivery, snapshotAigoSquad } from "./aigo.ts";

const source = {
  id: "squad-live",
  name: "ARGUS",
  description: "direct",
  workspacePath: "/tmp/argus",
  plannerAgentId: "planner",
  agents: [
    {
      id: "planner", name: "ARGUS Planner", icon: "P", role: { type: "planner" }, systemPrompt: "plan",
      toolConfig: { enabledTools: [], disabledTools: [], toolPermissionOverrides: {}, customToolConfigs: {} },
      modelPreferences: { preferredModelId: "furiosa-ai/Qwen3-32B-FP8", preferredProviderId: "provider", requiresToolCalling: true, requiresVision: false },
      memoryEnabled: false, settingsOverrides: { maxIterations: 10, maxTokens: 6144 }, sourceProfileId: null, executionMode: "in_process"
    },
    {
      id: "solver", name: "ARGUS Solver", icon: "S", role: { type: "custom", value: "Universal Solver" }, systemPrompt: "solve",
      toolConfig: { enabledTools: [], disabledTools: [], toolPermissionOverrides: {}, customToolConfigs: {} },
      modelPreferences: { preferredModelId: "furiosa-ai/Qwen3-32B-FP8", preferredProviderId: "provider", requiresToolCalling: false, requiresVision: false },
      memoryEnabled: false, settingsOverrides: { maxIterations: 2, maxTokens: 12288 }, sourceProfileId: null, executionMode: "in_process"
    }
  ]
};

describe("AI:GO direct Squad mapping", () => {
  it("normalizes the live config without adding tools or profile provenance", () => {
    const snapshot = snapshotAigoSquad(source, { maxTotalTokens: 80000, maxTasksPerPlan: 1 });
    expect(snapshot.creationMethod).toBe("manual-new");
    expect(snapshot.agents[0]!.model).toBe("furiosa-ai/Qwen3-32B-FP8");
    expect(snapshot.agents[1]!.maxToolCallRounds).toBe(2);
    expect(lintAigoSource(source).ok).toBe(true);
  });

  it("emits an AI:GO schema v1 delivery object without mutating source", () => {
    const delivery = mapAigoSquadToDelivery(source);
    expect(delivery.schemaVersion).toBe(1);
    expect(delivery.isBuiltin).toBe(false);
    expect(delivery.agents).toHaveLength(2);
    expect(delivery.agents.every((agent) => agent.tools.length === 0)).toBe(true);
    expect(source.agents[0]!.executionMode).toBe("in_process");
  });
});
