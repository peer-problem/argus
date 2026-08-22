import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { argusRunsFromDataSource } from "../apps/argus-trace/src/data-sources/executionTrace.ts";
import { FixtureDataSource, InMemoryFixtureFileReader } from "../apps/argus-trace/src/data-sources/fixture.ts";
import { traceCallSpans } from "../apps/argus-trace/src/derive.ts";

const fixtureRoot = process.env.AIGO_FIXTURE_ROOT;
const describeFixture = fixtureRoot == null ? describe.skip : describe;

async function collectWorkspaceFiles(root: string): Promise<Record<string, string>> {
  const workspaceRoot = join(root, "payload/workspace");
  const files: Record<string, string> = {};

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) files[relative(root, path)] = await readFile(path, "utf8");
    }
  }

  await visit(workspaceRoot);
  return files;
}

describeFixture("AI:GO fixture contract", () => {
  it("reads the external 1.12.1 bundle without adding records or source values", async () => {
    const files = await collectWorkspaceFiles(fixtureRoot!);
    const source = new FixtureDataSource(new InMemoryFixtureFileReader(files));
    const [status, history, events, tasks, analytics, traces] = await Promise.all([
      source.getWorkspaceStatus(),
      source.listExecutionHistory(),
      source.listEvents(),
      source.listSquadTasks(),
      source.getSquadAnalytics(),
      argusRunsFromDataSource(source)
    ]);

    expect(status).toMatchObject({ appVersion: "1.12.1", ready: true });
    expect(history).toHaveLength(27);
    expect(events).toHaveLength(516);
    expect(traces).toHaveLength(27);
    expect(traces.every((trace) => trace.events.every((event) => event.raw?.sourceEventType != null && event.raw?.payload == null))).toBe(true);
    const calls = traces.flatMap(traceCallSpans);
    expect(calls).toHaveLength(93);
    expect(calls.filter((call) => call.event.kind === "plan.created")).toHaveLength(27);
    expect(calls.filter((call) => call.event.kind === "task.completed" || call.event.kind === "task.failed")).toHaveLength(66);
    expect(calls.every((call) => call.event.model == null)).toBe(true);
    expect(traces.every((trace) => trace.detail?.console.length && trace.detail.reportMarkdown != null)).toBe(true);
    expect(traces.flatMap((trace) => trace.detail?.tasks ?? [])).toHaveLength(66);
    expect(traces.flatMap((trace) => trace.detail?.tasks ?? []).filter((task) => ["b3da228a-94a6-45ca-9a71-dc90f3d95a33", "8af8165f-9bf8-447f-84a7-6ba4c00192e3"].includes(task.taskId))).toEqual([
      expect.objectContaining({ description: null, markdown: null }),
      expect.objectContaining({ description: null, markdown: null })
    ]);
    expect(tasks).toHaveLength(64);
    expect(analytics).toMatchObject({
      executionCount: 27,
      taskCount: 66,
      totalTokenUsage: { promptTokens: 29_312, completionTokens: 21_511 }
    });
    await expect(source.getExecutionLog(history[0]!.executionId)).resolves.not.toHaveLength(0);
    await expect(source.getExecutionReport(history[0]!.executionId)).resolves.not.toBeNull();
  });
});
