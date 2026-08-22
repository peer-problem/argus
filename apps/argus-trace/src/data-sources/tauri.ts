import type {
  SquadAnalytics,
  SquadConsoleEntry,
  SquadEvent,
  SquadExecutionHistory,
  SquadExecutionIndexEntry,
  SquadObservabilityDataSource,
  SquadTaskCounts,
  SquadTaskGraph,
  SquadTaskQuery,
  SquadTaskRecord,
  SquadTaskSummary,
  SquadWorkspaceStatus
} from "./squadObservability.ts";
import { parseFixtureEvents, parseFixtureExecutionIndex } from "./fixture.ts";

export type TauriInvoke = <Result>(command: string, arguments_?: Record<string, unknown>) => Promise<Result>;

/**
 * Thin Tauri IPC adapter. The invoke function is injected so this module does
 * not add a Tauri dependency to the browser build or access window globals.
 */
export class TauriDataSource implements SquadObservabilityDataSource {
  constructor(private readonly invoke: TauriInvoke) {}

  getWorkspaceStatus(): Promise<SquadWorkspaceStatus> {
    return this.invoke("get_squad_workspace_status");
  }

  listExecutionHistory(): Promise<SquadExecutionHistory[]> {
    return this.invoke("list_execution_history");
  }

  async listExecutionIndex(): Promise<SquadExecutionIndexEntry[]> {
    return parseFixtureExecutionIndex(JSON.parse(await this.readWorkspaceFile("logs/index.json")) as unknown);
  }

  async listEvents(): Promise<SquadEvent[]> {
    return parseFixtureEvents(await this.readWorkspaceFile("logs/events.jsonl"));
  }

  getExecutionLog(executionId: string): Promise<SquadConsoleEntry[]> {
    return this.invoke("get_execution_log", { executionId });
  }

  async getExecutionReport(executionId: string): Promise<string | null> {
    try {
      return await this.readWorkspaceFile(`artifacts/reports/${executionId}-report.md`);
    } catch {
      return null;
    }
  }

  getSquadAnalytics(): Promise<SquadAnalytics> {
    return this.invoke("get_squad_analytics");
  }

  listSquadTasks(query: SquadTaskQuery = {}): Promise<SquadTaskSummary[]> {
    return this.invoke("list_squad_tasks", { ...query });
  }

  async getSquadTask(taskId: string): Promise<SquadTaskRecord | null> {
    const summary = (await this.listSquadTasks()).find((task) => task.id === taskId);
    if (!summary) return null;
    const detail = await this.invoke<SquadTaskRecord["detail"] | null>("get_squad_task", { taskId });
    if (detail == null) return null;
    let markdown: string | null = null;
    try {
      markdown = await this.readWorkspaceFile(`tasks/${taskId}.md`);
    } catch {
      // A persisted task is still valid when its human-readable export is absent.
    }
    return { summary, detail, markdown };
  }

  getSquadTaskGraph(squadId?: string): Promise<SquadTaskGraph> {
    return this.invoke("get_squad_task_graph", squadId == null ? {} : { squadId });
  }

  listAllSquadTaskCounts(): Promise<SquadTaskCounts[]> {
    return this.invoke("list_all_squad_task_counts");
  }

  listWorkspaceFiles(relativePath = ""): Promise<string[]> {
    return this.invoke("list_workspace_files", { path: relativePath });
  }

  readWorkspaceFile(relativePath: string): Promise<string> {
    return this.invoke("read_workspace_file", { path: relativePath });
  }
}
