import { AlertTriangle, Check, CircleAlert, Gauge, ShieldCheck, X } from "lucide-react";
import type { ArgusBatchItem, ArgusRun } from "../types.ts";
import { capShare, complianceScore, formatDuration, formatNumber, tokenTotal } from "../derive.ts";
import { dataArrivalsFor } from "../data/demo.ts";
import { UiProgress } from "./ui/Controls.tsx";

export function TokenFlow({ run }: { run: ArgusRun }) {
  const total = tokenTotal(run.totals);
  const { input, output, cachedInput } = run.totals;
  if (total == null || input == null || output == null || cachedInput == null) return (
    <section className="analysis-section token-flow" aria-labelledby="token-title">
      <div className="section-heading"><h2 id="token-title">Token usage</h2><strong>{formatNumber(total, 0)} total</strong></div>
      <p className="token-flow-empty">Input/cache breakdown was not observed. Input <strong>{formatNumber(input, 0)}</strong> · Output <strong>{formatNumber(output, 0)}</strong> · Cached <strong>{formatNumber(cachedInput, 0)}</strong></p>
    </section>
  );
  const cached = Math.min(cachedInput, input);
  const fresh = input - cached;
  return (
    <section className="analysis-section token-flow" aria-labelledby="token-title">
      <div className="section-heading"><h2 id="token-title">Token usage</h2><strong>{formatNumber(total, 0)} total</strong></div>
      <div className="token-bar" aria-label={`${fresh} fresh input, ${cached} cached input, ${output} output`}>
        <span className="fresh" style={{ width: `${(fresh / total) * 100}%` }} />
        <span className="cached" style={{ width: `${(cached / total) * 100}%` }} />
        <span className="output" style={{ width: `${(output / total) * 100}%` }} />
      </div>
      <div className="token-legend"><span><i className="fresh" />Fresh input <strong>{formatNumber(fresh, 0)}</strong></span><span><i className="cached" />Cached <strong>{formatNumber(cached, 0)}</strong></span><span><i className="output" />Output <strong>{formatNumber(output, 0)}</strong></span></div>
    </section>
  );
}

function formatRecordedAt(recordedAt: string, startedAt?: string) {
  const end = new Date(recordedAt).toISOString();
  return startedAt ? `${new Date(startedAt).toISOString()} → ${end}` : end;
}

export function DataArrivalFlow({ item, loadedAt }: { item: ArgusBatchItem; loadedAt: string }) {
  const arrivals = dataArrivalsFor(item, loadedAt);
  const run = item.trace;
  return (
    <section className="analysis-section data-arrival" aria-labelledby="data-arrival-title">
      <div className="section-heading">
        <h2 id="data-arrival-title">Data arrival</h2>
        <span className="section-note">{run.source === "demo" ? "separate fixture records · not live transport" : "source records · local replay"}</span>
      </div>
      <ol>{arrivals.map((arrival, index) => (
        <li key={arrival.id}>
          <span className="arrival-index">{String(index + 1).padStart(2, "0")}</span>
          <div className="arrival-copy">
            <strong>{arrival.protocol}</strong>
            <small>{arrival.source} <span aria-hidden="true">→</span> {arrival.receiver}</small>
            <time dateTime={arrival.recordedAt}>{formatRecordedAt(arrival.recordedAt, arrival.startedAt)}</time>
            {arrival.reference && <code>{arrival.reference}</code>}
            <details className="arrival-details"><summary>Record fields</summary><p>{arrival.data}</p></details>
          </div>
        </li>
      ))}</ol>
    </section>
  );
}

const complianceLabels: Record<string, [string, string]> = {
  userToolsZero: ["User tools", "No built-in, custom, or MCP tools attached"],
  plannerNativeProtocol: ["Native protocol", "Planner coordination remained inside AI:GO"],
  memoryOff: ["Memory", "No previous conversation context injected"],
  hashesPresent: ["Artifact hashes", "Dataset, Squad, submission, and prompt identified"],
  outputContract: ["Output contract", "Final artifact passed track extraction"],
  fallbackFree: ["Fallback", "No planner failure or roster fan-out signature"]
};

export function RunSignals({ run }: { run: ArgusRun }) {
  const share = capShare(run);
  const capPercent = share == null ? null : Math.min(100, share * 100);
  const compliance = complianceScore(run);
  return (
    <section className="run-signals" aria-label="Run diagnostics">
      <article className={`signal-card ${share != null && share > .85 ? "is-danger" : ""}`}>
        <div className="signal-head"><h2>Caps</h2><Gauge size={18} aria-hidden="true" /></div>
        <div className="signal-number"><strong>{share == null ? "Not observed" : `${Math.round(share * 100)}%`}</strong><span>token cap used</span></div>
        <UiProgress label="Token cap usage" value={capPercent} tone={capPercent != null && capPercent > 85 ? "danger" : capPercent == null ? "muted" : "default"} />
        <dl className="signal-facts">
          <div><dt>Observed</dt><dd>{formatNumber(run.caps.usedTokens, 0)}</dd></div>
          <div><dt>Limit</dt><dd>{run.caps.runTokens == null ? "Not observed" : formatNumber(run.caps.runTokens, 0)}</dd></div>
          <div><dt>Elapsed</dt><dd>{formatDuration(run.caps.elapsedMs)}</dd></div>
          <div><dt>Wall-clock</dt><dd>{run.caps.itemWallclockSeconds == null ? "Unknown" : `${run.caps.itemWallclockSeconds}s`}</dd></div>
        </dl>
      </article>

      <article className={`signal-card ${run.failure ? "is-danger" : ""}`}>
        <div className="signal-head"><h2>Failure</h2>{run.failure ? <AlertTriangle size={18} aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}</div>
        {run.failure ? <>
          <div className="signal-number"><strong>{run.failure.owner}</strong><span>{run.failure.kind.replaceAll("_", " ")}</span></div>
          <p className="signal-message">{run.failure.message || "Failure metadata was recorded without a message."}</p>
          <div className="signal-tags"><span>{run.failure.itemStatus.replaceAll("_", " ")}</span>{run.failure.secondaryTags.map((tag) => <span key={tag}>{tag}</span>)}</div>
        </> : <>
          <div className="signal-number"><strong>Clear</strong><span>{run.outcome.replaceAll("_", " ")}</span></div>
          <p className="signal-message">No failure evidence is attached to this run.</p>
        </>}
      </article>

      <article className="signal-card">
        <div className="signal-head"><h2>Compliance</h2><ShieldCheck size={18} aria-hidden="true" /></div>
        <div className="signal-number"><strong>{compliance.passed}/{compliance.total}</strong><span>{compliance.known} checks observed</span></div>
        <div className="signal-checks">
          {(Object.entries(run.compliance) as Array<[keyof ArgusRun["compliance"], boolean | null]>).map(([key, value]) => {
            const label = complianceLabels[key]?.[0] ?? String(key).replace(/([a-z])([A-Z])/g, "$1 $2");
            return <div key={key} className={value === true ? "pass" : value === false ? "fail" : "unknown"}><span>{value === true ? <Check size={13} /> : value === false ? <X size={13} /> : <CircleAlert size={13} />}</span><strong>{label}</strong><small>{value === true ? "Pass" : value === false ? "Fail" : "Unknown"}</small></div>;
          })}
        </div>
      </article>
    </section>
  );
}
