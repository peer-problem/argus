import { Button } from "@base-ui/react/button";
import { Pause, Play, RotateCcw } from "lucide-react";
import type { CSSProperties } from "react";
import type { ArgusEvent, ArgusRun } from "../types.ts";
import { agentNames, eventStart, formatDuration } from "../derive.ts";
import { UiButton, UiIconButton, UiSelect, UiSlider } from "./ui/Controls.tsx";

interface SwimlanesProps {
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
  agentFilter?: string;
  modelFilter?: string;
}

export function Swimlanes({ run, events, selectedEventId, progress, playing, speed, onProgress, onPlaying, onSpeed, onSelect, agentFilter = "all", modelFilter = "all" }: SwimlanesProps) {
  const agents = agentNames(run);
  const firstTimestamp = run.events[0] ? new Date(run.events[0].timestamp).valueOf() : 0;
  const lastTimestamp = run.events.at(-1) ? new Date(run.events.at(-1)!.timestamp).valueOf() : firstTimestamp;
  const duration = Math.max(1, run.totals.latencyMs, lastTimestamp - firstTimestamp);
  const gridStyle = { "--replay-progress": progress } as CSSProperties;
  return (
    <section className="work-section timeline-section" aria-labelledby="timeline-title">
      <div className="section-heading">
        <div><p className="eyebrow">Replay</p><h2 id="timeline-title">Agent swimlanes</h2></div>
        <span className="section-note">{formatDuration(progress * duration)} / {formatDuration(duration)}</span>
      </div>
      <div className="swimlane-grid" style={gridStyle}>
        <div className="lane-axis"><span>0</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>
        {agents.map((agent) => {
          const role = run.events.find((event) => event.agentId === agent && event.agentRole)?.agentRole ?? "Observed agent";
          return (
          <div className={`lane ${agentFilter !== "all" && agentFilter !== agent ? "is-dimmed" : ""}`} key={agent}>
            <div className="lane-label"><strong>{agent}</strong><small>{role}</small></div>
            <div className="lane-track">
              {[0.25, 0.5, 0.75].map((value) => <i key={value} style={{ left: `${value * 100}%` }} />)}
              {events.filter((event) => event.agentId === agent).map((event) => {
                const left = (eventStart(run, event) / duration) * 100;
                const clampedLeft = Math.min(98, Math.max(0, left));
                const width = Math.max(1.6, (event.durationMs / duration) * 100);
                return (
                  <Button
                    type="button"
                    key={event.eventId}
                    className={`lane-event kind-${event.state} ${event.eventId === selectedEventId ? "is-selected" : ""} ${modelFilter !== "all" && modelFilter !== event.model ? "is-dimmed" : ""}`}
                    style={{ left: `${clampedLeft}%`, width: `${Math.max(.8, Math.min(100 - clampedLeft, width))}%` }}
                    aria-label={`${event.kind}: ${event.decision}`}
                    onClick={() => onSelect(event)}
                  ><span>{event.kind.split(".").at(-1)}</span></Button>
                );
              })}
            </div>
          </div>
          );
        })}
        <div className="playhead" aria-hidden="true"><span /></div>
      </div>
      <div className="replay-controls">
        <UiIconButton type="button" label="Restart replay" onClick={() => { onPlaying(false); onProgress(0); }}><RotateCcw size={16} aria-hidden="true" /></UiIconButton>
        <UiButton type="button" variant="primary" onClick={() => onPlaying(!playing)}>{playing ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />} {playing ? "Pause" : "Replay"}</UiButton>
        <UiSlider label="Timeline position" value={Math.round(progress * 100)} onValueChange={(value) => onProgress(value / 100)} />
        <UiSelect className="speed-control" label="Speed" value={String(speed)} onValueChange={(value) => onSpeed(Number(value))} options={[
          { value: "0.5", label: "0.5×" }, { value: "1", label: "1×" }, { value: "2", label: "2×" }, { value: "4", label: "4×" }
        ]} />
      </div>
    </section>
  );
}
