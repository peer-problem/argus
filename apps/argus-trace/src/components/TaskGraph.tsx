import { Button } from "@base-ui/react/button";
import { Check, CircleDot, Radar, Route, TerminalSquare, TriangleAlert } from "lucide-react";
import type { ArgusEvent, ArgusRun } from "../types.ts";
import { dependencyWaveCount, taskCount } from "../derive.ts";

interface TaskGraphProps {
  run: ArgusRun;
  events: ArgusEvent[];
  onSelect: (event: ArgusEvent) => void;
  agentFilter?: string;
  modelFilter?: string;
}

const stages = [
  { key: "plan", label: "Plan", kinds: ["run.started", "plan.created"], Icon: Radar },
  { key: "task", label: "Solve", kinds: ["task.created", "task.assigned", "task.started", "task.completed", "task.failed"], Icon: Route },
  { key: "aggregate", label: "Aggregate", kinds: ["aggregation.started", "aggregation.completed"], Icon: CircleDot },
  { key: "final", label: "Final", kinds: ["run.completed", "run.failed", "run.capped"], Icon: TerminalSquare }
] as const;

export function TaskGraph({ run, events, onSelect, agentFilter = "all", modelFilter = "all" }: TaskGraphProps) {
  const lastVisible = events.at(-1);
  const tasks = taskCount(run);
  const waves = dependencyWaveCount(run);
  const taskIds = [...new Set(run.events.map((event) => event.taskId).filter((taskId): taskId is string => Boolean(taskId)))];
  const taskRecords = taskIds.map((taskId) => {
    const all = run.events.filter((event) => event.taskId === taskId);
    const visible = events.filter((event) => event.taskId === taskId);
    const source = visible.at(-1) ?? all.at(-1)!;
    const metadata = [...all].reverse().find((event) => event.taskTitle || event.agentId || event.dependsOnTaskIds?.length) ?? source;
    return {
      taskId,
      source,
      visible: visible.length > 0,
      wave: metadata.wave ?? 0,
      title: metadata.taskTitle ?? taskId,
      agent: metadata.agentId ?? "Unattributed agent",
      dependencies: metadata.dependsOnTaskIds ?? [],
      failed: visible.some((event) => event.state === "failed" || event.state === "capped")
    };
  }).sort((a, b) => a.wave - b.wave || a.taskId.localeCompare(b.taskId));
  const observedWaves = [...new Set(taskRecords.map((task) => task.wave))];
  return (
    <section className="work-section graph-section" aria-labelledby="task-graph-title">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Native execution</p>
          <h2 id="task-graph-title">Task graph</h2>
        </div>
        <div className="wave-key"><span /> {waves || "—"} {waves === 1 ? "wave" : "waves"} · {tasks || "—"} {tasks === 1 ? "task" : "tasks"}</div>
      </div>
      <div className="task-graph" aria-label="Task graph stages">
        <div className="graph-thread" aria-hidden="true"><span style={{ transform: `scaleX(${Math.min(1, events.length / Math.max(1, run.events.length))})` }} /></div>
        {stages.map(({ key, label, kinds, Icon }, index) => {
          const stageEvents = events.filter((event) => (kinds as readonly string[]).includes(event.kind));
          const source = stageEvents.at(-1) ?? run.events.find((event) => (kinds as readonly string[]).includes(event.kind));
          const visible = stageEvents.length > 0;
          const failed = stageEvents.some((event) => event.state === "failed" || event.state === "capped");
          const active = visible && lastVisible && (kinds as readonly string[]).includes(lastVisible.kind);
          const dimmed = Boolean(source) && ((agentFilter !== "all" && source?.agentId !== agentFilter) || (modelFilter !== "all" && source?.model !== modelFilter));
          return (
            <Button
              key={key}
              type="button"
              className={`graph-node ${visible ? "is-visible" : ""} ${active ? "is-active" : ""} ${failed ? "is-failed" : ""} ${dimmed ? "is-dimmed" : ""}`}
              onClick={() => stageEvents.at(-1) && onSelect(stageEvents.at(-1)!)}
              disabled={!visible}
            >
              <span className="node-index">0{index + 1}</span>
              <span className="node-icon"><Icon size={17} strokeWidth={1.7} /></span>
              <span className="node-copy"><strong>{label}</strong><small>{source?.agentRole ?? source?.agentId ?? "System"}</small></span>
              <span className="node-state">{failed ? <TriangleAlert size={14} /> : visible ? <Check size={14} /> : null}</span>
            </Button>
          );
        })}
      </div>
      {taskRecords.length > 0 && (
        <div className="task-wave-map" aria-label="Observed task dependencies">
          {observedWaves.map((wave) => (
            <div className="task-wave" key={wave}>
              <div className="task-wave-label"><span>Wave</span><strong>{String(wave + 1).padStart(2, "0")}</strong></div>
              <div className="task-wave-items">
                {taskRecords.filter((task) => task.wave === wave).map((task) => {
                  const dimmed = (agentFilter !== "all" && task.agent !== agentFilter) || (modelFilter !== "all" && task.source.model !== modelFilter);
                  return (
                    <Button
                      type="button"
                      key={task.taskId}
                      disabled={!task.visible}
                      className={`${task.visible ? "is-visible" : ""} ${task.failed ? "is-failed" : ""} ${dimmed ? "is-dimmed" : ""}`}
                      onClick={() => task.visible && onSelect(task.source)}
                    >
                      <span className="task-state-dot" />
                      <span className="task-wave-copy"><strong>{task.title}</strong><small>{task.agent}</small></span>
                      <span className="task-dependencies">{task.dependencies.length ? `after ${task.dependencies.join(", ")}` : "no dependencies"}</span>
                    </Button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
