import { Button } from "@base-ui/react/button";
import { animate } from "motion/mini";
import { Braces, CircleGauge, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, type CSSProperties } from "react";
import type { ArgusEvent, ArgusRun } from "../../../../lab/lib/types.ts";
import { eventStart, formatDuration, formatNumber } from "../derive.ts";
import { UiButton, UiIconButton, UiSelect, UiSlider } from "./ui/Controls.tsx";

interface ExecutionTraceProps {
  run: ArgusRun;
  events: ArgusEvent[];
  selectedEventId: string | null;
  progress: number;
  playing: boolean;
  speed: number;
  onProgress: (progress: number) => void;
  onPlaying: (playing: boolean) => void;
  onSpeed: (speed: number) => void;
  onSelect: (event: ArgusEvent) => void;
}

interface TraceRow {
  event: ArgusEvent;
  startMs: number;
  endMs: number;
  depth: number;
  parentIndex: number | null;
  modelIndex: number;
}

const traceColors = ["#2d72d2", "#7961db", "#c87619", "#238551", "#5f6b7c"];

function shortModel(model: string | null | undefined): string {
  return model?.split("/").at(-1) ?? "Native";
}

function actorLabel(event: ArgusEvent): string {
  if (event.agentId === "AI:GO Runtime") return "AI:GO Native Runtime";
  if (event.agentId === "ARGUS Planner") return "Planner";
  if (event.agentId === "ARGUS Solver") return "Universal Solver";
  if (event.agentId === "AI:GO Aggregator") return "Native Aggregator";
  if (event.agentId === "ARGUS Lab") return "Evidence Linker";
  return event.agentId ?? "System";
}

function actionLabel(event: ArgusEvent): string {
  if (event.kind === "run.created") return "Run accepted";
  if (event.kind === "plan.created") return "Plan call";
  if (event.kind === "task.created") return event.taskTitle ?? "Task planned";
  if (event.kind === "task.completed") return event.taskTitle ?? "Task completed";
  if (event.kind === "task.failed") return event.taskTitle ?? "Task failed";
  if (event.kind === "aggregation.completed") return "Aggregate result";
  if (event.kind === "run.completed") return "Run completed";
  if (event.kind === "run.failed") return "Run failed";
  if (event.kind === "run.capped") return "Run capped";
  return event.kind.replace(".", " · ");
}

function significantEvents(run: ArgusRun): ArgusEvent[] {
  const terminalKinds = new Set(["run.created", "run.completed", "run.failed", "run.capped"]);
  return run.events.filter((event) =>
    terminalKinds.has(event.kind)
    || event.kind === "plan.created"
    || event.kind === "aggregation.completed"
    || ((event.kind === "task.created" || event.kind === "task.completed" || event.kind === "task.failed")
      && (event.durationMs > 0 || event.tokens.input + event.tokens.output > 0))
  );
}

function buildRows(run: ArgusRun): TraceRow[] {
  const important = significantEvents(run);
  const models = [...new Set(important.map((event) => event.model).filter((model): model is string => Boolean(model)))];
  const rows: TraceRow[] = important.map((event): TraceRow => {
    const observedAt = eventStart(run, event);
    const startMs = Math.max(0, observedAt - event.durationMs);
    const depth = event.kind.startsWith("task.") ? 2 : event.kind === "plan.created" || event.kind.startsWith("aggregation.") ? 1 : 0;
    return {
      event,
      startMs,
      endMs: Math.max(startMs, observedAt),
      depth,
      parentIndex: null,
      modelIndex: event.model ? models.indexOf(event.model) : -1
    };
  }).sort((a, b) => a.startMs - b.startMs || new Date(a.event.timestamp).valueOf() - new Date(b.event.timestamp).valueOf());

  rows.forEach((row, index) => {
    if (index === 0) return;
    if (row.event.kind.startsWith("task.") && row.event.dependsOnTaskIds?.length) {
      const dependency = [...rows].slice(0, index).reverse().find((candidate) => candidate.event.taskId && row.event.dependsOnTaskIds?.includes(candidate.event.taskId));
      if (dependency) row.parentIndex = rows.indexOf(dependency);
    }
    if (row.parentIndex == null && row.event.kind.startsWith("task.")) {
      const planIndex = rows.findIndex((candidate) => candidate.event.kind === "plan.created");
      row.parentIndex = planIndex >= 0 ? planIndex : 0;
    } else if (row.parentIndex == null && row.event.kind.startsWith("aggregation.")) {
      const previousTask = [...rows].slice(0, index).map((candidate, candidateIndex) => ({ candidate, candidateIndex })).reverse().find(({ candidate }) => candidate.event.kind === "task.completed" || candidate.event.kind === "task.failed");
      row.parentIndex = previousTask?.candidateIndex ?? index - 1;
    } else if (row.parentIndex == null) {
      row.parentIndex = index - 1;
    }
  });
  return rows;
}

function contextLimit(run: ArgusRun, model: string | null | undefined): number | null {
  if (!model) return null;
  return run.modelUsage.find((usage) => usage.model === model)?.contextWindowTokens ?? null;
}

function tickLabel(duration: number, value: number): string {
  return formatDuration(duration * value);
}

export function ExecutionTrace({ run, events, selectedEventId, progress, playing, speed, onProgress, onPlaying, onSpeed, onSelect }: ExecutionTraceProps) {
  const traceRef = useRef<HTMLDivElement>(null);
  const rows = buildRows(run);
  const duration = Math.max(1, run.totals.latencyMs, ...rows.map((row) => row.endMs));
  const visibleIds = new Set(events.map((event) => event.eventId));
  const models = [...new Set(rows.map((row) => row.event.model).filter((model): model is string => Boolean(model)))];
  const callCount = rows.filter((row) => row.event.model && row.event.tokens.input + row.event.tokens.output > 0).length;
  const rowHeight = 70;
  const connectorHeight = Math.max(rowHeight, rows.length * rowHeight);
  const canvasStyle = { "--trace-progress": progress, "--trace-rows": rows.length } as CSSProperties;
  const x = (value: number) => Math.max(0, Math.min(100, value / duration * 100));

  useEffect(() => {
    const trace = traceRef.current;
    if (!trace || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rowElements = trace.querySelectorAll(".trace-row");
    const controls = [...rowElements].map((element, index) => animate(element, { opacity: [0, 1], transform: ["translateX(-6px)", "translateX(0)"] }, { duration: .24, delay: index * .025, ease: "easeOut" }));
    return () => controls.forEach((control) => control.stop());
  }, [run.runId]);

  return (
    <section className="execution-trace" aria-labelledby="execution-trace-title">
      <header className="trace-header">
        <div>
          <h2 id="execution-trace-title">Execution trace</h2>
          <p>Every model call, task branch, token load, and observed duration on one clock.</p>
        </div>
        <div className="trace-summary">
          <span><strong>{callCount}</strong> model calls</span>
          <span><strong>{models.length}</strong> models</span>
          <span><strong>{formatDuration(duration)}</strong> wall-clock</span>
        </div>
      </header>

      <div className="trace-model-legend" aria-label="Models and context limits">
        {models.map((model, index) => {
          const limit = contextLimit(run, model);
          return <span key={model}><i style={{ background: traceColors[index % traceColors.length] }} /><strong>{shortModel(model)}</strong><small>{limit == null ? "context unknown" : `${formatNumber(limit, 0)} context`}</small></span>;
        })}
        <span className="native-legend"><i /><strong>Native</strong><small>non-model event</small></span>
      </div>

      <div className="trace-canvas" style={canvasStyle} ref={traceRef}>
        <div className="trace-axis">
          <span>Actor / call</span>
          <div>{[0, .25, .5, .75, 1].map((value) => <time key={value} style={{ left: `${value * 100}%` }}>{tickLabel(duration, value)}</time>)}</div>
        </div>

        <svg className="trace-connectors" viewBox={`0 0 100 ${connectorHeight}`} preserveAspectRatio="none" aria-hidden="true">
          {rows.map((row, index) => {
            if (row.parentIndex == null) return null;
            const parent = rows[row.parentIndex];
            if (!parent) return null;
            const startX = x(parent.endMs);
            const endX = x(row.startMs);
            const elbow = Math.max(startX + .8, startX + (endX - startX) * .48);
            const startY = row.parentIndex * rowHeight + rowHeight / 2;
            const endY = index * rowHeight + rowHeight / 2;
            const visible = visibleIds.has(row.event.eventId);
            return <path key={row.event.eventId} d={`M ${startX} ${startY} H ${elbow} V ${endY} H ${endX}`} pathLength="1" style={{ strokeDasharray: 1, strokeDashoffset: visible ? 0 : 1, opacity: visible ? .7 : .1 }} />;
          })}
        </svg>

        <div className="trace-rows">
          {rows.map((row, index) => {
            const event = row.event;
            const visible = visibleIds.has(event.eventId);
            const selected = event.eventId === selectedEventId;
            const totalTokens = event.tokens.input + event.tokens.output;
            const limit = contextLimit(run, event.model);
            const pressure = limit == null ? null : totalTokens / limit;
            const start = x(row.startMs);
            const width = event.durationMs > 0 ? Math.max(1.4, x(row.endMs) - start) : 1.1;
            const color = row.modelIndex >= 0 ? traceColors[row.modelIndex % traceColors.length] : "#5f6b7c";
            const failed = event.state === "failed" || event.state === "capped";
            return (
              <div className={`trace-row ${selected ? "is-selected" : ""} ${failed ? "is-failed" : ""}`} key={event.eventId}>
                <Button type="button" className="trace-row-meta" onClick={() => onSelect(event)} style={{ "--trace-depth": row.depth } as CSSProperties}>
                  <span className="trace-branch-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="trace-actor"><strong>{actorLabel(event)}</strong><small>{actionLabel(event)}{event.wave == null ? "" : ` · wave ${event.wave + 1}`}</small></span>
                  <span className="trace-call-model"><i style={{ background: color }} />{shortModel(event.model)}</span>
                  <span className="trace-call-usage">
                    {totalTokens > 0 ? <>{formatNumber(event.tokens.input, 0)} in · {formatNumber(event.tokens.output, 0)} out</> : "No model tokens"}
                    {pressure != null && <b className={pressure > .85 ? "is-hot" : ""}>{Math.round(pressure * 100)}% ctx</b>}
                  </span>
                </Button>
                <div className="trace-time-cell">
                  {[0, .25, .5, .75, 1].map((value) => <i className="trace-gridline" key={value} style={{ left: `${value * 100}%` }} />)}
                  <Button type="button" className="trace-hit-target" style={{ left: `${start}%`, width: `${Math.min(100 - start, width)}%` }} aria-label={`${actionLabel(event)} at ${formatDuration(row.startMs)}, ${formatDuration(event.durationMs)}, ${formatNumber(totalTokens, 0)} tokens`} onClick={() => onSelect(event)}>
                    <span className={`trace-span ${event.durationMs === 0 ? "is-milestone" : ""}`} style={{ "--trace-color": color, transform: `scaleX(${visible ? 1 : 0})`, opacity: visible ? 1 : .12, transitionDelay: `${index * .025}s` } as CSSProperties}>
                      {event.durationMs > 0 && <span>{formatDuration(event.durationMs)}{totalTokens > 0 ? ` · ${formatNumber(totalTokens, 0)} tok` : ""}</span>}
                    </span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="trace-playhead" aria-hidden="true"><span /></div>
      </div>

      <div className="trace-controls">
        <div className="trace-control-copy"><CircleGauge size={15} aria-hidden="true" /><span>Replay position</span><strong>{formatDuration(progress * duration)}</strong></div>
        <UiIconButton type="button" label="Restart replay" onClick={() => { onPlaying(false); onProgress(0); }}><RotateCcw size={16} aria-hidden="true" /></UiIconButton>
        <UiButton type="button" variant="primary" onClick={() => onPlaying(!playing)}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {playing ? "Pause" : "Replay"}</UiButton>
        <UiSlider label="Timeline position" value={Math.round(progress * 100)} onValueChange={(value) => onProgress(value / 100)} />
        <UiSelect className="speed-control" label="Speed" value={String(speed)} onValueChange={(value) => onSpeed(Number(value))} options={[
          { value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }
        ]} />
        <span className="trace-raw-note"><Braces size={13} aria-hidden="true" />Click a row for exact event evidence</span>
      </div>
    </section>
  );
}
