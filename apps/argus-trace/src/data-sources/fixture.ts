import type {
  SquadAnalytics,
  SquadConsoleEntry,
  SquadEvent,
  SquadExecutionHistory,
  SquadExecutionIndexEntry,
  SquadHistoryTask,
  SquadIdentity,
  SquadObservabilityDataSource,
  SquadTaskCounts,
  SquadTaskDetail,
  SquadTaskGraph,
  SquadTaskQuery,
  SquadTaskRecord,
  SquadTaskSummary,
  SquadTokenUsage,
  SquadWorkspaceStatus
} from "./squadObservability.ts";

const requiredWorkspaceFiles = [
  ".squad.json",
  "logs/index.json",
  "logs/history.json",
  "logs/events.jsonl",
  "tasks/index.json"
] as const;

export class FixtureFileNotFoundError extends Error {
  constructor(path: string) {
    super(`Fixture file was not found: ${path}`);
    this.name = "FixtureFileNotFoundError";
  }
}

export class FixtureFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FixtureFormatError";
  }
}

export interface FixtureFileReader {
  readText(path: string): Promise<string>;
  listPaths(): Promise<readonly string[]>;
}

function normalizePath(path: string): string {
  const normalized = path.replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) return "";
  const parts = normalized.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new FixtureFormatError(`A fixture path must be a safe relative path: ${path}`);
  }
  return parts.join("/");
}

function asRecord(value: unknown, context: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new FixtureFormatError(`${context} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new FixtureFormatError(`${context} must be an array.`);
  return value;
}

function requiredString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key];
  if (typeof value !== "string") throw new FixtureFormatError(`${context}.${key} must be a string.`);
  return value;
}

function requiredStringOrNumber(record: Record<string, unknown>, key: string, context: string): string | number {
  const value = record[key];
  if ((typeof value !== "string" && typeof value !== "number") || (typeof value === "number" && !Number.isFinite(value))) {
    throw new FixtureFormatError(`${context}.${key} must be a string or finite number.`);
  }
  return value;
}

function nullableString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function requiredNumber(record: Record<string, unknown>, key: string, context: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new FixtureFormatError(`${context}.${key} must be a finite number.`);
  }
  return value;
}

function nullableNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArray(value: unknown, context: string): string[] {
  return asArray(value, context).map((item, index) => {
    if (typeof item !== "string") throw new FixtureFormatError(`${context}[${index}] must be a string.`);
    return item;
  });
}

function tokenUsage(value: unknown, context: string): SquadTokenUsage {
  const record = asRecord(value, context);
  return {
    promptTokens: requiredNumber(record, "promptTokens", context),
    completionTokens: requiredNumber(record, "completionTokens", context)
  };
}

function parseIdentity(value: unknown): SquadIdentity {
  const record = asRecord(value, ".squad.json");
  return {
    appVersion: requiredString(record, "appVersion", ".squad.json"),
    initializedAt: nullableString(record, "initializedAt"),
    squadId: requiredString(record, "squadId", ".squad.json"),
    squadName: requiredString(record, "squadName", ".squad.json")
  };
}

function parseHistoryTask(value: unknown, context: string): SquadHistoryTask {
  const record = asRecord(value, context);
  return {
    taskId: requiredString(record, "taskId", context),
    title: requiredString(record, "title", context),
    agentId: requiredString(record, "agentId", context),
    agentName: requiredString(record, "agentName", context),
    status: requiredString(record, "status", context),
    output: nullableString(record, "output"),
    error: nullableString(record, "error"),
    durationMs: requiredNumber(record, "durationMs", context),
    tokenUsage: tokenUsage(record.tokenUsage, `${context}.tokenUsage`)
  };
}

function parseHistory(value: unknown): SquadExecutionHistory[] {
  return asArray(value, "logs/history.json").map((item, index) => {
    const context = `logs/history.json[${index}]`;
    const record = asRecord(item, context);
    const perAgentRecord = asRecord(record.perAgentTokenUsage, `${context}.perAgentTokenUsage`);
    const perAgentTokenUsage = Object.fromEntries(Object.entries(perAgentRecord).map(([agentId, usage]) => [agentId, tokenUsage(usage, `${context}.perAgentTokenUsage.${agentId}`)]));
    return {
      executionId: requiredString(record, "executionId", context),
      squadId: requiredString(record, "squadId", context),
      squadName: requiredString(record, "squadName", context),
      request: requiredString(record, "request", context),
      planTitle: requiredString(record, "planTitle", context),
      tasks: asArray(record.tasks, `${context}.tasks`).map((task, taskIndex) => parseHistoryTask(task, `${context}.tasks[${taskIndex}]`)),
      finalResult: nullableString(record, "finalResult"),
      status: requiredString(record, "status", context),
      totalTokenUsage: tokenUsage(record.totalTokenUsage, `${context}.totalTokenUsage`),
      perAgentTokenUsage,
      durationMs: requiredNumber(record, "durationMs", context),
      artifacts: stringArray(record.artifacts, `${context}.artifacts`),
      startedAt: requiredString(record, "startedAt", context),
      completedAt: nullableString(record, "completedAt")
    } satisfies SquadExecutionHistory;
  });
}

export function parseFixtureExecutionIndex(value: unknown): SquadExecutionIndexEntry[] {
  return asArray(value, "logs/index.json").map((item, index) => {
    const context = `logs/index.json[${index}]`;
    const record = asRecord(item, context);
    return {
      executionId: requiredString(record, "executionId", context),
      squadId: requiredString(record, "squadId", context),
      startedAt: requiredString(record, "startedAt", context),
      lastUpdatedAt: requiredString(record, "lastUpdatedAt", context),
      entryCount: requiredNumber(record, "entryCount", context)
    };
  });
}

function parseEvent(value: unknown, context: string): SquadEvent {
  const record = asRecord(value, context);
  return {
    id: requiredStringOrNumber(record, "id", context),
    eventType: requiredString(record, "eventType", context),
    timestamp: requiredString(record, "timestamp", context),
    squadId: requiredString(record, "squadId", context),
    payload: asRecord(record.payload, `${context}.payload`)
  };
}

export function parseFixtureEvents(text: string, path = "logs/events.jsonl"): SquadEvent[] {
  return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
    try {
      return parseEvent(JSON.parse(line) as unknown, `${path}:${index + 1}`);
    } catch (error) {
      if (error instanceof FixtureFormatError) throw error;
      throw new FixtureFormatError(`Fixture JSONL is invalid: ${path}:${index + 1}`);
    }
  });
}

function parseConsoleEntry(value: unknown, context: string): SquadConsoleEntry {
  const record = asRecord(value, context);
  return {
    timestamp: requiredString(record, "timestamp", context),
    level: requiredString(record, "level", context),
    agentId: requiredString(record, "agentId", context),
    message: requiredString(record, "message", context)
  };
}

function parseTaskSummary(value: unknown, context: string): SquadTaskSummary {
  const record = asRecord(value, context);
  return {
    id: requiredString(record, "id", context),
    squadId: requiredString(record, "squadId", context),
    planId: nullableString(record, "planId"),
    title: requiredString(record, "title", context),
    status: requiredString(record, "status", context),
    priority: nullableString(record, "priority"),
    assignedTo: nullableString(record, "assignedTo"),
    dependsOn: stringArray(record.dependsOn ?? [], `${context}.dependsOn`),
    createdAt: nullableString(record, "createdAt"),
    completedAt: nullableString(record, "completedAt")
  };
}

function parseTaskDetail(value: unknown, context: string): SquadTaskDetail {
  const record = asRecord(value, context);
  return {
    ...parseTaskSummary(record, context),
    description: nullableString(record, "description"),
    createdBy: nullableString(record, "createdBy"),
    result: nullableString(record, "result"),
    error: nullableString(record, "error"),
    artifacts: stringArray(record.artifacts ?? [], `${context}.artifacts`),
    tokenUsage: nullableNumber(record, "tokenUsage"),
    retryCount: nullableNumber(record, "retryCount"),
    maxRetries: nullableNumber(record, "maxRetries"),
    startedAt: nullableString(record, "startedAt")
  };
}

function increment(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

/**
 * Reads an extracted AI:GO fixture without using HTTP. Paths are interpreted
 * relative to `payload/workspace` unless another safe root is supplied.
 */
export class FixtureDataSource implements SquadObservabilityDataSource {
  private readonly workspaceRoot: string;

  constructor(private readonly reader: FixtureFileReader, workspaceRoot = "payload/workspace") {
    this.workspaceRoot = normalizePath(workspaceRoot);
    if (!this.workspaceRoot) throw new FixtureFormatError("A fixture workspace root is required.");
  }

  async getWorkspaceStatus(): Promise<SquadWorkspaceStatus> {
    const available = await Promise.all(requiredWorkspaceFiles.map(async (path) => ({ path, available: await this.exists(this.workspacePath(path)) })));
    const identity = parseIdentity(await this.readJson(this.workspacePath(".squad.json")));
    return { ...identity, ready: available.every((entry) => entry.available), requiredFiles: available };
  }

  async listExecutionHistory(): Promise<SquadExecutionHistory[]> {
    return parseHistory(await this.readJson(this.workspacePath("logs/history.json")));
  }

  async listExecutionIndex(): Promise<SquadExecutionIndexEntry[]> {
    return parseFixtureExecutionIndex(await this.readJson(this.workspacePath("logs/index.json")));
  }

  async listEvents(): Promise<SquadEvent[]> {
    return parseFixtureEvents(await this.reader.readText(this.workspacePath("logs/events.jsonl")), this.workspacePath("logs/events.jsonl"));
  }

  async getExecutionLog(executionId: string): Promise<SquadConsoleEntry[]> {
    try {
      return await this.readJsonLines(this.workspacePath(`logs/${this.safeId(executionId, "execution ID")}.jsonl`), parseConsoleEntry);
    } catch (error) {
      if (error instanceof FixtureFileNotFoundError) return [];
      throw error;
    }
  }

  async getExecutionReport(executionId: string): Promise<string | null> {
    try {
      return await this.readWorkspaceFile(`artifacts/reports/${this.safeId(executionId, "execution ID")}-report.md`);
    } catch (error) {
      if (error instanceof FixtureFileNotFoundError) return null;
      throw error;
    }
  }

  async getSquadAnalytics(): Promise<SquadAnalytics> {
    const history = await this.listExecutionHistory();
    const executionStatusCounts: Record<string, number> = {};
    const taskStatusCounts: Record<string, number> = {};
    const perAgentTokenUsage: Record<string, SquadTokenUsage> = {};
    let taskCount = 0;
    let totalDurationMs = 0;
    let promptTokens = 0;
    let completionTokens = 0;

    for (const execution of history) {
      increment(executionStatusCounts, execution.status);
      totalDurationMs += execution.durationMs;
      promptTokens += execution.totalTokenUsage.promptTokens;
      completionTokens += execution.totalTokenUsage.completionTokens;
      for (const task of execution.tasks) {
        taskCount += 1;
        increment(taskStatusCounts, task.status);
      }
      for (const [agentId, usage] of Object.entries(execution.perAgentTokenUsage)) {
        const existing = perAgentTokenUsage[agentId] ?? { promptTokens: 0, completionTokens: 0 };
        existing.promptTokens += usage.promptTokens;
        existing.completionTokens += usage.completionTokens;
        perAgentTokenUsage[agentId] = existing;
      }
    }

    return {
      executionCount: history.length,
      executionStatusCounts,
      taskCount,
      taskStatusCounts,
      totalDurationMs,
      totalTokenUsage: { promptTokens, completionTokens },
      perAgentTokenUsage
    };
  }

  async listSquadTasks(query: SquadTaskQuery = {}): Promise<SquadTaskSummary[]> {
    const tasks = asArray(await this.readJson(this.workspacePath("tasks/index.json")), "tasks/index.json").map((task, index) => parseTaskSummary(task, `tasks/index.json[${index}]`));
    const statuses = query.statuses == null ? null : new Set(query.statuses);
    return tasks.filter((task) => (query.squadId == null || task.squadId === query.squadId) && (statuses == null || statuses.has(task.status)));
  }

  async getSquadTask(taskId: string): Promise<SquadTaskRecord | null> {
    const safeTaskId = this.safeId(taskId, "task ID");
    const summary = (await this.listSquadTasks()).find((task) => task.id === safeTaskId);
    if (!summary) return null;
    try {
      const detail = parseTaskDetail(await this.readJson(this.workspacePath(`tasks/${safeTaskId}.json`)), `tasks/${safeTaskId}.json`);
      let markdown: string | null = null;
      try {
        markdown = await this.readWorkspaceFile(`tasks/${safeTaskId}.md`);
      } catch (error) {
        if (!(error instanceof FixtureFileNotFoundError)) throw error;
      }
      return { summary, detail, markdown };
    } catch (error) {
      if (error instanceof FixtureFileNotFoundError) return null;
      throw error;
    }
  }

  async getSquadTaskGraph(squadId?: string): Promise<SquadTaskGraph> {
    const nodes = await this.listSquadTasks(squadId == null ? {} : { squadId });
    const ids = new Set(nodes.map((task) => task.id));
    const graphSquadId = squadId ?? (nodes.length === 1 ? nodes[0]!.squadId : "all");
    return {
      squadId: graphSquadId,
      nodes,
      edges: nodes.flatMap((task) => task.dependsOn.filter((dependency) => ids.has(dependency)).map((dependency) => ({ fromTaskId: dependency, toTaskId: task.id })))
    };
  }

  async listAllSquadTaskCounts(): Promise<SquadTaskCounts[]> {
    const bySquad = new Map<string, SquadTaskCounts>();
    for (const task of await this.listSquadTasks()) {
      const current = bySquad.get(task.squadId) ?? { squadId: task.squadId, total: 0, byStatus: {} };
      current.total += 1;
      increment(current.byStatus, task.status);
      bySquad.set(task.squadId, current);
    }
    return [...bySquad.values()].sort((left, right) => left.squadId.localeCompare(right.squadId));
  }

  async listWorkspaceFiles(relativePath = ""): Promise<string[]> {
    const requested = normalizePath(relativePath);
    const prefix = requested ? `${requested}/` : "";
    const rootPrefix = `${this.workspaceRoot}/`;
    const paths = await this.reader.listPaths();
    return paths.map(normalizePath)
      .map((path) => {
        if (path === this.workspaceRoot) return "";
        if (path.startsWith(rootPrefix)) return path.slice(rootPrefix.length);
        const nestedRoot = `/${rootPrefix}`;
        const rootIndex = path.indexOf(nestedRoot);
        return rootIndex >= 0 ? path.slice(rootIndex + nestedRoot.length) : null;
      })
      .filter((path): path is string => path != null && path.startsWith(prefix))
      .sort((left, right) => left.localeCompare(right));
  }

  async readWorkspaceFile(relativePath: string): Promise<string> {
    const path = normalizePath(relativePath);
    if (!path) throw new FixtureFormatError("A workspace file path is required.");
    return this.reader.readText(this.workspacePath(path));
  }

  private workspacePath(relativePath: string): string {
    const safePath = normalizePath(relativePath);
    return safePath ? `${this.workspaceRoot}/${safePath}` : this.workspaceRoot;
  }

  private safeId(value: string, label: string): string {
    const safeValue = normalizePath(value);
    if (!safeValue || safeValue.includes("/")) throw new FixtureFormatError(`A ${label} must be a single safe identifier.`);
    return safeValue;
  }

  private async exists(path: string): Promise<boolean> {
    try {
      await this.reader.readText(path);
      return true;
    } catch (error) {
      if (error instanceof FixtureFileNotFoundError) return false;
      throw error;
    }
  }

  private async readJson(path: string): Promise<unknown> {
    const text = await this.reader.readText(path);
    try {
      return JSON.parse(text) as unknown;
    } catch {
      throw new FixtureFormatError(`Fixture JSON is invalid: ${path}`);
    }
  }

  private async readJsonLines<T>(path: string, parse: (value: unknown, context: string) => T): Promise<T[]> {
    const text = await this.reader.readText(path);
    return text.split(/\r?\n/).filter(Boolean).map((line, index) => {
      try {
        return parse(JSON.parse(line) as unknown, `${path}:${index + 1}`);
      } catch (error) {
        if (error instanceof FixtureFormatError) throw error;
        throw new FixtureFormatError(`Fixture JSONL is invalid: ${path}:${index + 1}`);
      }
    });
  }
}

/** A deterministic reader for tests and programmatic fixture construction. */
export class InMemoryFixtureFileReader implements FixtureFileReader {
  private readonly files: Map<string, string>;

  constructor(files: Record<string, string>) {
    this.files = new Map(Object.entries(files).map(([path, text]) => [normalizePath(path), text]));
  }

  async readText(path: string): Promise<string> {
    const text = this.files.get(normalizePath(path));
    if (text == null) throw new FixtureFileNotFoundError(path);
    return text;
  }

  async listPaths(): Promise<readonly string[]> {
    return [...this.files.keys()];
  }
}

/**
 * Browser-only file reader for a folder selected by the user. It accepts the
 * browser's relative folder paths and resolves the fixture root without HTTP.
 */
export class BrowserFixtureFileReader implements FixtureFileReader {
  private readonly files: Map<string, File>;

  constructor(files: Iterable<File>) {
    this.files = new Map();
    for (const file of files) {
      const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
      const path = normalizePath(relativePath);
      if (this.files.has(path)) throw new FixtureFormatError(`The selected fixture has duplicate paths: ${path}`);
      this.files.set(path, file);
    }
  }

  async readText(path: string): Promise<string> {
    const normalizedPath = normalizePath(path);
    const exact = this.files.get(normalizedPath);
    if (exact) return exact.text();
    const matches = [...this.files.entries()].filter(([candidate]) => candidate.endsWith(`/${normalizedPath}`));
    if (matches.length === 1) return matches[0]![1].text();
    if (matches.length > 1) throw new FixtureFormatError(`The selected fixture has ambiguous paths for: ${normalizedPath}`);
    throw new FixtureFileNotFoundError(normalizedPath);
  }

  async listPaths(): Promise<readonly string[]> {
    return [...this.files.keys()];
  }
}
