import { Collapsible } from "@base-ui/react/collapsible";
import { Tabs } from "@base-ui/react/tabs";
import { Braces, ChevronRight, FileText, Timer, Waypoints } from "lucide-react";
import { useState } from "react";
import type { ArgusEvent } from "../types.ts";
import { formatDuration, formatNumber } from "../derive.ts";

function eventTitle(event: ArgusEvent): string {
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

interface InspectorProps {
  event: ArgusEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function Inspector({ event, open, onOpenChange }: InspectorProps) {
  const [mode, setMode] = useState<"fields" | "source">("fields");
  if (!event) return <section className="event-evidence empty-event-evidence"><Waypoints size={18} aria-hidden="true" /><p>Select an event to inspect its evidence.</p></section>;
  const protocol = typeof event.raw?.protocol === "string" ? event.raw.protocol : "Recorded in imported JSON";
  const fields = [
    { label: "Occurred", value: event.timestamp },
    { label: "Protocol", value: protocol },
    { label: "Actor", value: event.agentId },
    { label: "Model", value: event.model?.split("/").at(-1) },
    { label: "Task", value: event.taskTitle },
    { label: "Wave", value: event.wave == null ? null : String(event.wave + 1).padStart(2, "0") }
  ].filter((field): field is { label: string; value: string } => typeof field.value === "string" && field.value.length > 0);
  return (
    <Collapsible.Root className="event-evidence" open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="event-evidence-trigger">
        <span><small>Selected event</small><strong>{eventTitle(event)}</strong></span>
        <span className="event-evidence-trigger-meta">{formatDuration(event.durationMs)} <ChevronRight className="event-evidence-icon" size={16} aria-hidden="true" /></span>
      </Collapsible.Trigger>
      <Collapsible.Panel className="event-evidence-panel">
        <Tabs.Root className="event-evidence-tabs" value={mode} onValueChange={(next) => setMode(next as "fields" | "source")}>
          <div className="event-evidence-head">
            <div className="decision-block"><span>Decision</span><p>{event.decision}</p></div>
            <Tabs.List className="ui-tabs-list" aria-label="Evidence representation">
              <Tabs.Tab className="ui-tab" value="fields">Details</Tabs.Tab>
              <Tabs.Tab className="ui-tab" value="source">Source</Tabs.Tab>
              <Tabs.Indicator className="ui-tabs-indicator" />
            </Tabs.List>
          </div>
          <Tabs.Panel className="event-evidence-content" value="fields">
            <dl className="event-evidence-facts">
              {fields.map(({ label, value }) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}
            </dl>
            <div className="event-evidence-metrics">
              <div><FileText size={14} aria-hidden="true" /><span>Tokens</span><strong>{formatNumber(event.tokens.input + event.tokens.output)}</strong></div>
              <div><Timer size={14} aria-hidden="true" /><span>Duration</span><strong>{formatDuration(event.durationMs)}</strong></div>
            </div>
            <Collapsible.Root className="advanced-evidence">
              <Collapsible.Trigger className="advanced-evidence-trigger">Advanced evidence <ChevronRight size={14} aria-hidden="true" /></Collapsible.Trigger>
              <Collapsible.Panel className="advanced-evidence-panel">
                <dl>
                  {event.artifactRef && <div><dt>Artifact</dt><dd><code>{event.artifactRef}</code></dd></div>}
                  <div><dt>Event ID</dt><dd><code>{event.eventId}</code></dd></div>
                </dl>
              </Collapsible.Panel>
            </Collapsible.Root>
          </Tabs.Panel>
          <Tabs.Panel className="event-evidence-content" value="source">
            <pre className="raw-view"><Braces size={16} aria-hidden="true" />{JSON.stringify(event.raw ?? event, null, 2)}</pre>
          </Tabs.Panel>
        </Tabs.Root>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
