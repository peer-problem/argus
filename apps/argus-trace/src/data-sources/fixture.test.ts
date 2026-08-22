import { describe, expect, it } from "vitest";
import { argusRunFromExecution, argusRunsFromDataSource } from "./executionTrace.ts";
import { FixtureDataSource, FixtureFormatError, InMemoryFixtureFileReader } from "./fixture.ts";
import { TauriDataSource, type TauriInvoke } from "./tauri.ts";

function json(value: unknown): string {
  return JSON.stringify(value);
}

const squadId = "squad-1";
const sourceFiles = {
  "payload/workspace/.squad.json": json({ appVersion: "1.12.1", initializedAt: "2026-08-22T08:41:54.000Z", squadId, squadName: "Sanitized fixture" }),
  "payload/workspace/logs/index.json": json([
    { executionId: "run-ok", squadId, startedAt: "2026-08-22T08:41:54.000Z", lastUpdatedAt: "2026-08-22T08:42:10.000Z", entryCount: 4 },
    { executionId: "run-partial", squadId, startedAt: "2026-08-22T08:43:00.000Z", lastUpdatedAt: "2026-08-22T08:43:09.000Z", entryCount: 5 }
  ]),
  "payload/workspace/logs/history.json": json([
    {
      executionId: "run-ok", squadId, squadName: "Sanitized fixture", request: "Sanitized request", planTitle: "One task",
      tasks: [{ taskId: "task-1", title: "First task", agentId: "agent-1", agentName: "Planner", status: "completed", output: "Sanitized output", error: null, durationMs: 1000, tokenUsage: { promptTokens: 4, completionTokens: 2 } }],
      finalResult: "Done", status: "completed", totalTokenUsage: { promptTokens: 10, completionTokens: 5 }, perAgentTokenUsage: { "agent-1": { promptTokens: 4, completionTokens: 2 } }, durationMs: 10_000, artifacts: [], startedAt: "2026-08-22T08:41:54.000Z", completedAt: "2026-08-22T08:42:04.000Z"
    },
    {
      executionId: "run-partial", squadId, squadName: "Sanitized fixture", request: "Sanitized request", planTitle: "Two tasks",
      tasks: [
        { taskId: "task-2", title: "Second task", agentId: "agent-1", agentName: "Planner", status: "completed", output: "OK", error: null, durationMs: 2000, tokenUsage: { promptTokens: 5, completionTokens: 3 } },
        { taskId: "task-missing", title: "History-only task", agentId: "agent-2", agentName: "Solver", status: "failed", output: null, error: "Sanitized upstream failure", durationMs: 500, tokenUsage: { promptTokens: 1, completionTokens: 0 } }
      ],
      finalResult: "Partial", status: "completed", totalTokenUsage: { promptTokens: 12, completionTokens: 3 }, perAgentTokenUsage: { "agent-1": { promptTokens: 5, completionTokens: 3 }, "agent-2": { promptTokens: 1, completionTokens: 0 } }, durationMs: 9_000, artifacts: [], startedAt: "2026-08-22T08:43:00.000Z", completedAt: "2026-08-22T08:43:09.000Z"
    }
  ]),
  "payload/workspace/logs/events.jsonl": [
    { id: 101, eventType: "squad:task-completed", timestamp: "2026-08-22T08:42:00.000Z", squadId, payload: { executionId: "run-ok", taskId: "task-1", success: true } },
    { id: "event-2", eventType: "squad:task-completed", timestamp: "2026-08-22T08:43:05.000Z", squadId, payload: { executionId: "run-partial", taskId: "task-missing", success: false, error: "Sanitized upstream failure" } }
  ].map(json).join("\n"),
  "payload/workspace/logs/run-ok.jsonl": [
    { timestamp: "2026-08-22T08:41:55.000Z", level: "info", agentId: "system", message: "Plan generated" },
    { timestamp: "2026-08-22T08:42:04.000Z", level: "info", agentId: "system", message: "Execution complete" }
  ].map(json).join("\n"),
  "payload/workspace/tasks/index.json": json([
    { id: "task-1", squadId, planId: "plan-1", title: "First task", status: "done", priority: "high", assignedTo: "agent-1", dependsOn: [], createdAt: "2026-08-22T08:41:55.000Z", completedAt: "2026-08-22T08:42:03.000Z" },
    { id: "task-2", squadId, planId: "plan-2", title: "Second task", status: "failed", priority: "normal", assignedTo: "agent-1", dependsOn: ["task-1"], createdAt: "2026-08-22T08:43:01.000Z", completedAt: "2026-08-22T08:43:08.000Z" }
  ]),
  "payload/workspace/tasks/task-1.json": json({ id: "task-1", squadId, planId: "plan-1", title: "First task", status: "done", priority: "high", assignedTo: "agent-1", dependsOn: [], description: "Sanitized task description", createdBy: "planner", result: null, error: null, artifacts: [], tokenUsage: 0, retryCount: 0, maxRetries: 3, createdAt: "2026-08-22T08:41:55.000Z", startedAt: "2026-08-22T08:41:55.000Z", completedAt: "2026-08-22T08:42:03.000Z" }),
  "payload/workspace/tasks/task-1.md": "# First task\n\nSanitized task description\n",
  "payload/workspace/artifacts/reports/run-ok-report.md": "# Run report\n\nSanitized report\n"
};

function makeSource() {
  return new FixtureDataSource(new InMemoryFixtureFileReader(sourceFiles));
}

describe("FixtureDataSource", () => {
  it("reads the source files without creating synthetic executions, tasks, or timestamps", async () => {
    const source = makeSource();
    await expect(source.getWorkspaceStatus()).resolves.toMatchObject({ squadId, ready: true, appVersion: "1.12.1" });
    await expect(source.listExecutionHistory()).resolves.toHaveLength(2);
    await expect(source.listExecutionHistory()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ executionId: "run-partial", tasks: expect.arrayContaining([expect.objectContaining({ taskId: "task-missing", status: "failed", error: "Sanitized upstream failure" })]) })
    ]));
    await expect(source.listEvents()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 101, eventType: "squad:task-completed", payload: expect.objectContaining({ success: true }) }),
      expect.objectContaining({ eventType: "squad:task-completed", payload: expect.objectContaining({ success: false }) })
    ]));
  });

  it("keeps console order, report discovery, task gaps, and workspace paths explicit", async () => {
    const source = makeSource();
    await expect(source.getExecutionLog("run-ok")).resolves.toMatchObject([{ message: "Plan generated" }, { message: "Execution complete" }]);
    await expect(source.getExecutionReport("run-ok")).resolves.toContain("Sanitized report");
    await expect(source.getExecutionReport("run-partial")).resolves.toBeNull();
    await expect(source.getSquadTask("task-1")).resolves.toMatchObject({ detail: { description: "Sanitized task description" }, markdown: expect.stringContaining("First task") });
    await expect(source.getSquadTask("task-missing")).resolves.toBeNull();
    await expect(source.listWorkspaceFiles("tasks")).resolves.toEqual(["tasks/index.json", "tasks/task-1.json", "tasks/task-1.md"]);
    await expect(source.readWorkspaceFile("../outside.txt")).rejects.toBeInstanceOf(FixtureFormatError);
  });

  it("derives analytics and task graph only from persisted source records", async () => {
    const source = makeSource();
    await expect(source.getSquadAnalytics()).resolves.toMatchObject({
      executionCount: 2,
      taskCount: 3,
      taskStatusCounts: { completed: 2, failed: 1 },
      totalDurationMs: 19_000,
      totalTokenUsage: { promptTokens: 22, completionTokens: 8 }
    });
    await expect(source.getSquadTaskGraph(squadId)).resolves.toMatchObject({ nodes: [{ id: "task-1" }, { id: "task-2" }], edges: [{ fromTaskId: "task-1", toTaskId: "task-2" }] });
    await expect(source.listAllSquadTaskCounts()).resolves.toEqual([{ squadId, total: 2, byStatus: { done: 1, failed: 1 } }]);
  });

  it("projects execution events into an auditable trace without treating agent-only events as confirmed", async () => {
    const source = makeSource();
    const [history, events] = await Promise.all([source.listExecutionHistory(), source.listEvents()]);
    const partial = history.find((execution) => execution.executionId === "run-partial")!;
    const trace = argusRunFromExecution(partial, [
      ...events,
      { id: "agent-only", eventType: "squad:agent-state-changed", timestamp: "2026-08-22T08:43:06.000Z", squadId, payload: { agentId: "agent-2", state: "running" } },
      { id: "outside-window", eventType: "squad:agent-state-changed", timestamp: "2026-08-22T08:44:06.000Z", squadId, payload: { agentId: "agent-2", state: "idle" } }
    ]);

    expect(trace).toMatchObject({ source: "aigo", dataset: null, score: null, totals: { input: 12, output: 3, cachedInput: null, normalizedCost: null } });
    expect(trace.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: "task-missing", kind: "task.failed", durationMs: 500, raw: expect.objectContaining({ sourceEventType: "squad:task-completed", joinConfidence: "confirmed", joinReason: "execution ID and task ID matched" }) }),
      expect.objectContaining({ taskId: "task-2", raw: expect.objectContaining({ sourceEventType: "history:task", joinConfidence: "inferred" }) }),
      expect.objectContaining({ agentId: "agent-2", raw: expect.objectContaining({ sourceEventType: "squad:agent-state-changed", joinConfidence: "inferred" }) })
    ]));
    expect(trace.events.some((event) => event.raw?.sourceEventId === "outside-window")).toBe(false);
    expect(trace.events.every((event) => event.raw?.payload == null)).toBe(true);

    const traces = await argusRunsFromDataSource(source);
    expect(traces).toHaveLength(2);
    expect(traces.find((run) => run.runId === "run-ok")?.detail).toMatchObject({
      executionId: "run-ok",
      request: "Sanitized request",
      tasks: [expect.objectContaining({ taskId: "task-1", description: "Sanitized task description", markdown: expect.stringContaining("First task") })],
      console: [{ message: "Plan generated" }, { message: "Execution complete" }],
      reportMarkdown: expect.stringContaining("Sanitized report")
    });
    expect(traces.find((run) => run.runId === "run-partial")?.detail).toMatchObject({
      tasks: expect.arrayContaining([expect.objectContaining({ taskId: "task-missing", description: null })]),
      console: [],
      reportMarkdown: null
    });
  });
});

describe("TauriDataSource", () => {
  it("keeps UI calls behind the same source contract", async () => {
    const calls: Array<{ command: string; arguments_?: Record<string, unknown> }> = [];
    const invoke: TauriInvoke = async (command, arguments_) => {
      calls.push({ command, arguments_ });
      if (command === "read_workspace_file") return "# Report" as never;
      return [] as never;
    };
    const source = new TauriDataSource(invoke);
    await source.getExecutionLog("run-ok");
    await source.listSquadTasks({ squadId, statuses: ["failed"] });
    await source.getExecutionReport("run-ok");
    expect(calls).toEqual([
      { command: "get_execution_log", arguments_: { executionId: "run-ok" } },
      { command: "list_squad_tasks", arguments_: { squadId, statuses: ["failed"] } },
      { command: "read_workspace_file", arguments_: { path: "artifacts/reports/run-ok-report.md" } }
    ]);
  });
});
