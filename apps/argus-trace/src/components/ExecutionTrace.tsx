import { Button } from "@base-ui/react/button";
import { animate } from "motion/mini";
import { CircleGauge, Pause, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from "react";
import type { ArgusEvent, ArgusRun } from "../types.ts";
import { eventStart, formatDuration, formatNumber, timelineDuration } from "../derive.ts";
import { UiButton, UiIconButton, UiSelect, UiSlider } from "./ui/Controls.tsx";

interface ExecutionTraceProps {
  run: ArgusRun;
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

const traceColors = ["#6c3ff2", "#abc929", "#c87619", "#238551", "#5f6b7c"];

function shortModel(model: string | null | undefined): string {
  return model?.split("/").at(-1) ?? "Native";
}

function compactModel(model: string | null | undefined): string {
  const label = shortModel(model);
  return label.length > 18 ? `${label.slice(0, 12)}…${label.slice(-4)}` : label;
}

function actorLabel(event: ArgusEvent): string {
  if (event.agentId === "AI:GO Runtime") return "Native Runtime";
  if (event.agentId === "ARGUS Planner") return "Planner";
  if (event.agentId === "ARGUS Solver") return "Solver";
  if (event.agentId === "AI:GO Aggregator") return "Aggregator";
  if (event.agentId === "ARGUS Lab") return "Evidence";
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

export function ExecutionTrace({ run, selectedEventId, progress, playing, speed, onProgress, onPlaying, onSpeed, onSelect }: ExecutionTraceProps) {
  const traceRef = useRef<HTMLDivElement>(null);
  const rows = buildRows(run);
  const duration = timelineDuration(run);
  const playheadMs = Math.max(0, Math.min(duration, progress * duration));
  const models = [...new Set(rows.map((row) => row.event.model).filter((model): model is string => Boolean(model)))];
  const callCount = rows.filter((row) => row.event.model && row.event.tokens.input + row.event.tokens.output > 0).length;
  const rowHeight = 56;
  const connectorHeight = Math.max(rowHeight, rows.length * rowHeight);
  const canvasStyle = { "--trace-rows": rows.length } as CSSProperties;
  const x = (value: number) => Math.max(0, Math.min(100, value / duration * 100));
  const reveal = (startMs: number, endMs: number): number => {
    if (endMs <= startMs) return playheadMs >= endMs ? 1 : 0;
    return Math.max(0, Math.min(1, (playheadMs - startMs) / (endMs - startMs)));
  };

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
        <h2 id="execution-trace-title">Execution trace</h2>
        <div className="trace-summary">
          <span><strong>{rows.length}</strong> key events</span>
          <span><strong>{callCount}</strong> model calls</span>
          <span><strong>{formatDuration(duration)}</strong> wall-clock</span>
        </div>
      </header>

      <div className="trace-model-legend" aria-label="Models used in this trace">
        {models.map((model, index) => {
          const limit = contextLimit(run, model);
          const label = `${model} · ${limit == null ? "context unknown" : `${formatNumber(limit, 0)} context`}`;
          return <span key={model} title={label} aria-label={label}><i style={{ background: traceColors[index % traceColors.length] }} /><strong>{compactModel(model)}</strong></span>;
        })}
        <span className="native-legend" title="Non-model event"><i /><strong>Native</strong></span>
      </div>

      <div className="trace-canvas" style={canvasStyle} ref={traceRef}>
        <div className="trace-axis">
          <span>Actor / call</span>
          <div>{[0, .5, 1].map((value) => <time key={value} style={{ left: `${value * 100}%` }}>{tickLabel(duration, value)}</time>)}</div>
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
            const visible = playheadMs >= Math.max(parent.endMs, row.startMs);
            return <path key={row.event.eventId} d={`M ${startX} ${startY} H ${elbow} V ${endY} H ${endX}`} pathLength="1" style={{ strokeDasharray: 1, strokeDashoffset: visible ? 0 : 1, opacity: visible ? .7 : 0 }} />;
          })}
        </svg>

        <div className="trace-rows">
          {rows.map((row, index) => {
            const event = row.event;
            const selected = event.eventId === selectedEventId;
            const totalTokens = event.tokens.input + event.tokens.output;
            const start = x(row.startMs);
            const width = Math.max(0, x(row.endMs) - start);
            const endsAtTimelineBoundary = start >= 99.9;
            const spanReveal = reveal(row.startMs, row.endMs);
            const elapsedMs = Math.max(0, Math.min(event.durationMs, playheadMs - row.startMs));
            const usedTokens = Math.round(totalTokens * spanReveal);
            const color = row.modelIndex >= 0 ? traceColors[row.modelIndex % traceColors.length] : "#5f6b7c";
            const failed = event.state === "failed" || event.state === "capped";
            const showProgressLabel = totalTokens > 0 && spanReveal > 0;
            const selectWithKeyboard = (keyEvent: KeyboardEvent<HTMLButtonElement>) => {
              if (keyEvent.key === "Enter" || keyEvent.key === " ") {
                keyEvent.preventDefault();
                onSelect(event);
              }
            };
            return (
              <div className={`trace-row ${selected ? "is-selected" : ""} ${failed ? "is-failed" : ""}`} key={event.eventId}>
                <Button type="button" className="trace-row-meta" onClick={() => onSelect(event)} onKeyDown={selectWithKeyboard} style={{ "--trace-depth": row.depth } as CSSProperties}>
                  <span className="trace-branch-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="trace-actor"><strong>{actorLabel(event)}</strong><small>{actionLabel(event)}</small></span>
                  <span className="trace-call-model" title={event.model ?? "Non-model event"}><i style={{ background: color }} />{compactModel(event.model)}</span>
                </Button>
                <div className="trace-time-cell">
                  {[0, .5, 1].map((value) => <i className="trace-gridline" key={value} style={{ left: `${value * 100}%` }} />)}
                  {showProgressLabel && <span className={`trace-progress-label ${start > 72 ? "is-end-aligned" : ""}`} style={{ left: `${start}%`, "--trace-color": color } as CSSProperties} title={`${formatDuration(elapsedMs)} elapsed · ${formatNumber(usedTokens, 0)} of ${formatNumber(totalTokens, 0)} tokens`}>
                    {formatDuration(elapsedMs)} · {formatNumber(usedTokens, 0)} tok
                  </span>}
                  <Button type="button" className={`trace-hit-target ${event.durationMs === 0 ? "is-milestone-target" : "is-duration-target"} ${endsAtTimelineBoundary ? "is-at-timeline-end" : ""}`} style={{ left: `${start}%`, width: `${Math.min(100 - start, width)}%` }} aria-label={`${actionLabel(event)} at ${formatDuration(row.startMs)}, ${formatDuration(event.durationMs)}, ${formatNumber(totalTokens, 0)} tokens`} onClick={() => onSelect(event)} onKeyDown={selectWithKeyboard}>
                    <span className={`trace-span ${event.durationMs === 0 ? "is-milestone" : ""}`} style={{ "--trace-color": color, transform: `scaleX(${spanReveal})`, opacity: spanReveal > 0 ? 1 : 0 } as CSSProperties}>
                    </span>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="trace-playhead-lane" aria-hidden="true"><div className={`trace-playhead ${playing ? "is-playing" : ""} ${playheadMs >= duration ? "is-at-timeline-end" : ""}`} style={{ left: `${x(playheadMs)}%` }}><span /></div></div>
      </div>

      <div className="trace-controls">
        <div className="trace-control-copy"><CircleGauge size={15} aria-hidden="true" /><span>Position</span><strong>{formatDuration(progress * duration)}</strong></div>
        <UiIconButton type="button" label="Restart replay" onClick={() => { onPlaying(false); onProgress(0); }}><RotateCcw size={16} aria-hidden="true" /></UiIconButton>
        <UiButton type="button" variant="primary" onClick={() => {
          if (playing) {
            onPlaying(false);
            return;
          }
          if (progress >= 1) onProgress(0);
          onPlaying(true);
        }}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {playing ? "Pause" : "Replay"}</UiButton>
        <UiSlider label="Timeline position" value={Math.round(progress * 100)} onValueChange={(value) => onProgress(value / 100)} />
        <UiSelect className="speed-control" label="Speed" value={String(speed)} onValueChange={(value) => onSpeed(Number(value))} options={[
          { value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }
        ]} />
      </div>
    </section>
  );
}
