import { Tabs } from "@base-ui/react/tabs";
import { Braces, FileText, Timer, Waypoints } from "lucide-react";
import { useState } from "react";
import type { ArgusEvent } from "../types.ts";
import { formatDuration, formatNumber } from "../derive.ts";

export function Inspector({ event }: { event: ArgusEvent | null }) {
  const [mode, setMode] = useState<"fields" | "source">("fields");
  if (!event) return <aside className="inspector empty-inspector"><Waypoints size={20} aria-hidden="true" /><p>Select an event to inspect its evidence.</p></aside>;
  const protocol = typeof event.raw?.protocol === "string" ? event.raw.protocol : "Recorded in imported JSON";
  return (
    <aside className="inspector" aria-label="Event inspector">
      <Tabs.Root className="inspector-tabs" value={mode} onValueChange={(next) => setMode(next as "fields" | "source")}>
        <div className="inspector-head">
          <div><p className="eyebrow">Event evidence</p><h2>{event.kind.replace(".", " / ")}</h2></div>
          <Tabs.List className="ui-tabs-list" aria-label="Evidence representation">
            <Tabs.Tab className="ui-tab" value="fields">Fields</Tabs.Tab>
            <Tabs.Tab className="ui-tab" value="source">Source</Tabs.Tab>
            <Tabs.Indicator className="ui-tabs-indicator" />
          </Tabs.List>
        </div>
        <Tabs.Panel className="inspector-panel" value="fields">
          <div className="decision-block"><span>Decision</span><p>{event.decision}</p></div>
          <dl className="evidence-list">
            <div><dt>Kind</dt><dd>{event.kind}</dd></div>
            <div><dt>State</dt><dd>{event.state}</dd></div>
            <div><dt>Occurred</dt><dd title={event.timestamp}>{event.timestamp}</dd></div>
            <div><dt>Protocol</dt><dd title={protocol}>{protocol}</dd></div>
            <div><dt>Agent</dt><dd>{event.agentId ?? "System"}</dd></div>
            <div><dt>Model</dt><dd title={event.model ?? undefined}>{event.model?.split("/").at(-1) ?? "—"}</dd></div>
            <div><dt>Task</dt><dd>{event.taskTitle ?? "Run orchestration"}</dd></div>
            <div><dt>Wave</dt><dd>{event.wave == null ? "—" : String(event.wave + 1).padStart(2, "0")}</dd></div>
          </dl>
          <div className="inspector-metrics">
            <div><FileText size={14} aria-hidden="true" /><span>Tokens</span><strong>{formatNumber(event.tokens.input + event.tokens.output)}</strong></div>
            <div><Timer size={14} aria-hidden="true" /><span>Duration</span><strong>{formatDuration(event.durationMs)}</strong></div>
          </div>
          {event.artifactRef && <div className="artifact-ref"><span>Artifact</span><code>{event.artifactRef}</code></div>}
          <div className="provenance-hash"><span>Event ID</span><code>{event.eventId}</code></div>
        </Tabs.Panel>
        <Tabs.Panel className="inspector-panel" value="source">
          <pre className="raw-view"><Braces size={16} aria-hidden="true" />{JSON.stringify(event.raw ?? event, null, 2)}</pre>
        </Tabs.Panel>
      </Tabs.Root>
    </aside>
  );
}
