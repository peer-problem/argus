import { Collapsible } from "@base-ui/react/collapsible";
import { ChevronRight, FileJson2, ScrollText, TerminalSquare, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import type { ArgusEvent, ArgusRun, ArgusRunTaskDetail } from "../types.ts";
import { formatDuration, formatNumber, observedSum } from "../derive.ts";

function clock(value: string | null | undefined): string {
  if (!value) return "Not observed";
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) return "Not observed";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function fallbackTasks(run: ArgusRun): ArgusRunTaskDetail[] {
  const terminal = run.events.filter((event) => event.taskId != null && (event.kind === "task.completed" || event.kind === "task.failed"));
  const byTask = new Map<string, ArgusEvent>();
  terminal.forEach((event) => byTask.set(event.taskId!, event));
  return [...byTask.values()].map((event) => ({
    taskId: event.taskId!,
    title: event.taskTitle ?? event.taskId!,
    agentId: event.agentId ?? null,
    agentName: event.agentRole ?? null,
    status: event.state,
    output: event.state === "completed" ? event.decision : null,
    error: event.state === "failed" || event.state === "capped" ? event.decision : null,
    durationMs: event.durationMs,
    tokens: { input: event.tokens.input, output: event.tokens.output },
    priority: null,
    description: null,
    createdBy: null,
    dependsOnTaskIds: event.dependsOnTaskIds ?? [],
    artifacts: event.artifactRef == null ? [] : [event.artifactRef],
    result: null,
    retryCount: null,
    maxRetries: null,
    startedAt: event.durationMs == null ? null : new Date(new Date(event.timestamp).valueOf() - event.durationMs).toISOString(),
    completedAt: event.timestamp,
    markdown: null
  }));
}

function taskJson(task: ArgusRunTaskDetail): string {
  return JSON.stringify({
    id: task.taskId,
    title: task.title,
    status: task.status,
    priority: task.priority,
    assignedTo: task.agentId,
    agentName: task.agentName,
    description: task.description,
    createdBy: task.createdBy,
    dependsOn: task.dependsOnTaskIds,
    result: task.result,
    error: task.error,
    output: task.output,
    artifacts: task.artifacts,
    retryCount: task.retryCount,
    maxRetries: task.maxRetries,
    startedAt: task.startedAt,
    completedAt: task.completedAt,
    durationMs: task.durationMs,
    tokenUsage: {
      promptTokens: task.tokens.input,
      completionTokens: task.tokens.output
    },
    markdown: task.markdown
  }, null, 2);
}

function Disclosure({ title, subtitle, icon, children }: { title: string; subtitle: string; icon: "report" | "json"; children: ReactNode }) {
  const Icon = icon === "report" ? ScrollText : FileJson2;
  return (
    <Collapsible.Root className="result-disclosure">
      <Collapsible.Trigger className="result-disclosure-trigger">
        <span><Icon size={14} aria-hidden="true" /><span><strong>{title}</strong><small>{subtitle}</small></span></span>
        <ChevronRight className="result-disclosure-icon" size={15} aria-hidden="true" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="result-disclosure-panel"><div>{children}</div></Collapsible.Panel>
    </Collapsible.Root>
  );
}

function sourceEventType(event: ArgusEvent): string {
  const sourceType = event.raw?.sourceEventType;
  return typeof sourceType === "string" ? sourceType : event.kind;
}

export function RunResultDetails({ run }: { run: ArgusRun }) {
  const detail = run.detail ?? null;
  const tasks = detail?.tasks.length ? detail.tasks : fallbackTasks(run);
  const logEntries = [
    ...(detail?.console ?? []).map((entry) => ({ timestamp: entry.timestamp, level: entry.level, actor: entry.agentId, message: entry.message, id: `console:${entry.timestamp}:${entry.agentId}:${entry.message}` })),
    ...run.events.map((event) => ({ timestamp: event.timestamp, level: event.state, actor: event.agentId ?? sourceEventType(event), message: `${sourceEventType(event)} · ${event.decision}`, id: `event:${event.eventId}` }))
  ].sort((left, right) => new Date(left.timestamp).valueOf() - new Date(right.timestamp).valueOf());

  return (
    <section className="run-result-details" aria-labelledby="run-result-title">
      <header className="result-section-head">
        <div><p className="eyebrow">Execution result</p><h2 id="run-result-title">Tasks and source evidence</h2></div>
        <dl>
          <div><dt>Started</dt><dd>{clock(detail?.startedAt ?? run.events[0]?.timestamp)}</dd></div>
          <div><dt>Completed</dt><dd>{clock(detail?.completedAt ?? run.events.at(-1)?.timestamp)}</dd></div>
        </dl>
      </header>

      <section className="result-tasks" aria-labelledby="result-tasks-title">
        <div className="result-subhead"><h3 id="result-tasks-title">Tasks</h3><span>{tasks.length}</span></div>
        {tasks.length === 0 ? <p className="result-empty">No task records were observed.</p> : <ol>
          {tasks.map((task, index) => {
            const failed = /failed|error|capped/.test(task.status.toLowerCase()) || task.error != null;
            const tokens = observedSum(task.tokens.input, task.tokens.output);
            return <li key={task.taskId} className={failed ? "is-failed" : ""}>
              <div className="result-task-index">{String(index + 1).padStart(2, "0")}</div>
              <div className="result-task-copy">
                <div className="result-task-title"><strong>{task.title}</strong><span className={`result-task-status ${failed ? "is-failed" : ""}`}>{task.status}</span></div>
                <code title={task.taskId}>{task.taskId}</code>
                <dl>
                  <div><dt>Agent</dt><dd>{task.agentName ?? task.agentId ?? "Not observed"}</dd></div>
                  <div><dt>Window</dt><dd>{clock(task.startedAt)} → {clock(task.completedAt)}</dd></div>
                  <div><dt>Duration</dt><dd>{formatDuration(task.durationMs)}</dd></div>
                  <div><dt>Tokens</dt><dd>{formatNumber(tokens, 0)}</dd></div>
                </dl>
                {task.error && <p className="result-task-error"><TriangleAlert size={13} aria-hidden="true" />{task.error}</p>}
                {task.output && <details className="result-task-output"><summary>Task output</summary><pre>{task.output}</pre></details>}
              </div>
            </li>;
          })}
        </ol>}
      </section>

      <div className="result-evidence-grid">
        <section className="result-source-records" aria-labelledby="result-records-title">
          <div className="result-subhead"><h3 id="result-records-title">Source records</h3><span>Foldable</span></div>
          <Disclosure title="Execution report Markdown" subtitle={detail?.reportMarkdown ? "Source record" : "Not observed"} icon="report">
            <pre>{detail?.reportMarkdown ?? "No execution report Markdown was present in the source."}</pre>
          </Disclosure>
          {tasks.map((task) => <Disclosure key={task.taskId} title={task.title} subtitle={`Task Detail JSON · ${task.taskId}`} icon="json"><pre>{taskJson(task)}</pre></Disclosure>)}
        </section>

        <section className="result-log-viewer" aria-labelledby="result-log-title">
          <div className="result-subhead"><h3 id="result-log-title"><TerminalSquare size={14} aria-hidden="true" />Execution log</h3><span>Console + event ledger</span></div>
          <ol>
            {logEntries.map((entry) => <li key={entry.id} className={`is-${entry.level.toLowerCase()}`}>
              <time dateTime={entry.timestamp}>{clock(entry.timestamp)}</time><code>{entry.level}</code><strong>{entry.actor}</strong><p>{entry.message}</p>
            </li>)}
          </ol>
        </section>
      </div>

      <div className="result-text-grid">
        <section aria-labelledby="execution-prompt-title"><div className="result-subhead"><h3 id="execution-prompt-title">Execution prompt</h3><span>Source request</span></div><pre>{detail?.request ?? "Not observed"}</pre></section>
        <section aria-labelledby="execution-output-title"><div className="result-subhead"><h3 id="execution-output-title">Execution output</h3><span>Final result</span></div><pre>{run.finalAnswer?.trim() || "Not observed"}</pre></section>
      </div>
    </section>
  );
}
