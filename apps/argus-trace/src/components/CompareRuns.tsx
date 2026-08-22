import { VisAxis, VisCrosshair, VisLine, VisStackedBar, VisTooltip, VisXYContainer } from "@unovis/react";
import { TooltipComponent } from "echarts/components";
import { init, use, type EChartsType } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { Scatter3DChart } from "echarts-gl/charts";
import { Grid3DComponent } from "echarts-gl/components";
import { Box, ChevronLeft, ChevronRight, Info } from "lucide-react";
import { useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from "react";
import type { PortalBatchRunReport, Track } from "../types.ts";
import { formatDuration, formatNumber, notGradedItems, portalTokenEfficiency } from "../derive.ts";

use([CanvasRenderer, TooltipComponent, Scatter3DChart as never, Grid3DComponent as never]);

interface ModelPoint {
  index: number;
  model: string;
  input: number;
  output: number;
  total: number;
}

interface TrackPoint {
  index: number;
  label: string;
  track?: Exclude<Track, "unknown">;
  accuracy: number;
  graded: number;
  items: number;
  isBench?: boolean;
}

interface TimelinePoint {
  index: number;
  timestamp: number;
  reportId: string;
  runName: string;
  score: number;
  coding: number;
  math: number;
  generic: number;
  codingAccuracy: number;
  mathAccuracy: number;
  genericAccuracy: number;
  efficiency: number;
  calls: number;
  totalTokens: number;
}

interface ScatterDatum {
  name: string;
  reportId: string;
  testedAt: string;
  value: [number, number, number];
  totalTokens: number;
}

interface CameraState {
  alpha: number;
  beta: number;
  distance: number;
  center: number[];
}

const trackColors: Record<Exclude<Track, "unknown">, string> = {
  coding: "#6c3ff2",
  math: "#abc929",
  generic: "#5f6b7c"
};

const tokenColors = ["#6c3ff2", "#c7e752"];

function shortModel(model: string): string {
  const name = model.split("/").at(-1) ?? model;
  return name.length > 18 ? `${name.slice(0, 16)}…` : name;
}

function postedClock(value: string): string {
  return new Intl.DateTimeFormat("en", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value));
}

function compactAxisNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function timelineClock(value: number | Date): string {
  return new Intl.DateTimeFormat("en", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "UTC" }).format(new Date(value));
}

function requestTotal(report: PortalBatchRunReport): number {
  return report.modelUsage.reduce((total, model) => total + model.requests, 0);
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function makeScatterData(reports: PortalBatchRunReport[]): ScatterDatum[] {
  return reports.map((report) => ({
    name: report.runName,
    reportId: report.reportId,
    testedAt: report.postedAt,
    value: [portalTokenEfficiency(report), report.tokens.total, report.score * 100],
    totalTokens: report.tokens.total
  }));
}

function pointSize(totalTokens: number, reports: PortalBatchRunReport[], selected = false): number {
  const tokenValues = reports.map((report) => report.tokens.total);
  const minimum = Math.min(...tokenValues);
  const maximum = Math.max(...tokenValues);
  const share = maximum === minimum ? 0.5 : (totalTokens - minimum) / (maximum - minimum);
  return 17 + Math.sqrt(share) * 19 + (selected ? 7 : 0);
}

function RunSpace({ reports, selectedId, onSelect }: { reports: PortalBatchRunReport[]; selectedId: string; onSelect: (reportId: string) => void }) {
  const chartElement = useRef<HTMLDivElement>(null);
  const camera = useRef<CameraState>({ alpha: 18, beta: 34, distance: 260, center: [0, 0, 0] });
  const selected = reports.find((report) => report.reportId === selectedId) ?? reports[0]!;
  const selectedIndex = reports.findIndex((report) => report.reportId === selected.reportId);
  const previous = reports[selectedIndex - 1];
  const next = reports[selectedIndex + 1];

  useEffect(() => {
    const element = chartElement.current;
    if (!element || !selected) return;
    const chart = init(element, undefined, { renderer: "canvas" });
    const allData = makeScatterData(reports);
    const regular = allData.filter((datum) => datum.reportId !== selected.reportId);
    const active = allData.find((datum) => datum.reportId === selected.reportId)!;
    const axisLabel = { color: "#050607", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, fontWeight: "bold" };
    const axisCommon = {
      type: "value",
      min: 0,
      axisLine: { lineStyle: { color: "#050607", width: 2 } },
      axisTick: { show: true, lineStyle: { color: "#050607", width: 1.5 } },
      axisLabel,
      nameTextStyle: { color: "#050607", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontWeight: "bold", fontSize: 11 },
      splitLine: { show: true, lineStyle: { color: "#111418", width: 1, opacity: 0.42 } },
      splitArea: { show: true, areaStyle: { color: ["rgba(255,255,255,.96)", "rgba(247,248,250,.94)"] } }
    };
    const option = {
      backgroundColor: "#ffffff",
      animationDuration: 700,
      animationDurationUpdate: 620,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        show: true,
        trigger: "item",
        backgroundColor: "rgba(15, 10, 29, .58)",
        borderColor: "rgba(108, 63, 242, .42)",
        borderWidth: 1,
        padding: 12,
        extraCssText: "backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(15, 10, 29, .12);",
        textStyle: { color: "#fff", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11 },
        formatter: (params: { data?: ScatterDatum }) => {
          const datum = params.data;
          if (!datum?.reportId) return "";
          return `<strong style="font-size:12px">${escapeHtml(datum.name)}</strong><br/><span style="color:#c8d1da">Tested ${escapeHtml(postedClock(datum.testedAt))} UTC</span>`;
        }
      },
      grid3D: {
        boxWidth: 118,
        boxHeight: 76,
        boxDepth: 96,
        environment: "#ffffff",
        axisPointer: { show: true, lineStyle: { color: "#050607", width: 2.25, opacity: 1 }, label: { show: false } },
        light: { main: { intensity: 0.72, shadow: false, alpha: 34, beta: 24 }, ambient: { intensity: 0.96 } },
        viewControl: { ...camera.current, minDistance: 120, maxDistance: 400, damping: 0.88, autoRotate: false, rotateSensitivity: 1.56, panSensitivity: 0 },
        postEffect: { enable: false },
        temporalSuperSampling: { enable: true }
      },
      xAxis3D: { ...axisCommon, name: "EFFICIENCY", nameGap: 30, axisLabel: { ...axisLabel, formatter: (value: number) => value.toFixed(1) } },
      yAxis3D: { ...axisCommon, name: "TOTAL TOKENS", nameGap: 22, axisLabel: { ...axisLabel, formatter: compactAxisNumber } },
      zAxis3D: { ...axisCommon, name: "BENCH", max: 70, nameGap: 22, axisLabel: { ...axisLabel, formatter: (value: number) => `${Math.round(value)}%` } },
      series: [
        {
          name: "Runs",
          type: "scatter3D",
          coordinateSystem: "cartesian3D",
          data: regular,
          symbol: "circle",
          symbolSize: (_value: number[], params: { data: ScatterDatum }) => pointSize(params.data.totalTokens, reports),
          itemStyle: { color: "#6c3ff2", opacity: 0.96, borderColor: "#050607", borderWidth: 1 },
          label: { show: false },
          emphasis: { itemStyle: { color: "#8b67ff", opacity: 1 } }
        },
        {
          name: "Selected",
          type: "scatter3D",
          coordinateSystem: "cartesian3D",
          data: [active],
          symbol: "circle",
          symbolSize: (_value: number[], params: { data: ScatterDatum }) => pointSize(params.data.totalTokens, reports, true),
          itemStyle: { color: "#dfff78", opacity: 1, borderColor: "#050607", borderWidth: 3 },
          label: { show: false }
        }
      ]
    };
    chart.setOption(option as Parameters<EChartsType["setOption"]>[0]);
    chart.on("grid3dcamerachanged", (params) => {
      const next = params as unknown as Partial<CameraState>;
      camera.current = {
        alpha: next.alpha ?? camera.current.alpha,
        beta: next.beta ?? camera.current.beta,
        distance: next.distance ?? camera.current.distance,
        center: next.center ?? camera.current.center
      };
    });
    chart.on("click", (params) => {
      const datum = params.data as unknown as ScatterDatum | undefined;
      if (!datum?.reportId) return;
      onSelect(datum.reportId);
    });
    const resize = new ResizeObserver(() => chart.resize());
    resize.observe(element);
    return () => {
      resize.disconnect();
      chart.dispose();
    };
  }, [onSelect, reports, selected]);

  return (
    <section className="run-space" aria-label="Run performance space">
      <div className="run-space-viewport">
        <div ref={chartElement} className="run-space-canvas" role="img" aria-label="3D Run comparison by efficiency, total tokens, and bench score" />
        <dl className="run-space-selection-stats" aria-label={`Selected run statistics for ${selected.runName}`}>
          <div><dt>Bench</dt><dd>{(selected.score * 100).toFixed(1)}%</dd></div>
          <div><dt>Efficiency</dt><dd>{portalTokenEfficiency(selected).toFixed(2)}</dd></div>
          <div><dt>Total tokens</dt><dd>{formatNumber(selected.tokens.total, 2)}</dd></div>
        </dl>
        <nav className="run-space-switcher" aria-label="Selected run navigation">
          <button type="button" className="run-space-switch" onClick={() => previous && onSelect(previous.reportId)} disabled={!previous} aria-label={previous ? `Previous run: ${previous.runName}` : "No previous run"}>
            <ChevronLeft size={18} aria-hidden="true" />
          </button>
          <button type="button" className="run-space-switch" onClick={() => next && onSelect(next.reportId)} disabled={!next} aria-label={next ? `Next run: ${next.runName}` : "No next run"}>
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </nav>
      </div>
    </section>
  );
}

function timelineData(reports: PortalBatchRunReport[]): TimelinePoint[] {
  return [...reports].sort((a, b) => new Date(a.postedAt).valueOf() - new Date(b.postedAt).valueOf()).map((report, index) => {
    const result = Object.fromEntries(report.trackResults.map((track) => [track.track, track]));
    const coding = result.coding!;
    const math = result.math!;
    const generic = result.generic!;
    return {
      index,
      timestamp: new Date(report.postedAt).valueOf(),
      reportId: report.reportId,
      runName: report.runName,
      score: report.score * 100,
      coding: coding.accuracy * coding.weight * 100,
      math: math.accuracy * math.weight * 100,
      generic: generic.accuracy * generic.weight * 100,
      codingAccuracy: coding.accuracy * 100,
      mathAccuracy: math.accuracy * 100,
      genericAccuracy: generic.accuracy * 100,
      efficiency: portalTokenEfficiency(report),
      calls: requestTotal(report),
      totalTokens: report.tokens.total
    };
  });
}

function timelineTooltip(point: TimelinePoint): string {
  return `<div class="chart-tooltip"><strong>${escapeHtml(point.runName)}</strong><span>${timelineClock(point.timestamp)} UTC</span><dl><div><dt>Bench score</dt><dd>${point.score.toFixed(1)}%</dd></div><div><dt>Coding</dt><dd>${point.codingAccuracy.toFixed(1)}%</dd></div><div><dt>Math</dt><dd>${point.mathAccuracy.toFixed(1)}%</dd></div><div><dt>Generic</dt><dd>${point.genericAccuracy.toFixed(1)}%</dd></div></dl></div>`;
}

function selectTimelineRun(event: ReactMouseEvent<HTMLDivElement>, data: TimelinePoint[], onSelect: (reportId: string) => void) {
  if (data.length === 0) return;
  const marginLeft = 42;
  const marginRight = 10;
  const bounds = event.currentTarget.getBoundingClientRect();
  const plotWidth = bounds.width - marginLeft - marginRight;
  const plotX = event.clientX - bounds.left - marginLeft;
  if (plotWidth <= 0 || plotX < 0 || plotX > plotWidth) return;
  const index = Math.min(data.length - 1, Math.floor((plotX / plotWidth) * data.length));
  onSelect(data[index]!.reportId);
}

function AllRunsStats({ reports, onSelect }: { reports: PortalBatchRunReport[]; onSelect: (reportId: string) => void }) {
  const data = useMemo(() => timelineData(reports), [reports]);
  const scoreAccessors = [(point: TimelinePoint) => point.coding, (point: TimelinePoint) => point.math, (point: TimelinePoint) => point.generic];
  const timeAt = (value: number | Date) => timelineClock(data[Math.max(0, Math.round(Number(value)))]?.timestamp ?? data[0]!.timestamp);
  const joinedBarStep = data.length > 1 ? data.length / (data.length - 1) : 1;
  return (
    <section className="all-runs-stats" aria-label="All Run statistics">
      <article className="timeline-chart timeline-chart-score">
        <div className="timeline-chart-head"><h2>Bench scores</h2><div className="timeline-legend"><span><i style={{ background: trackColors.coding }} />Coding 2×</span><span><i style={{ background: trackColors.math }} />Math 1×</span><span><i style={{ background: trackColors.generic }} />Generic 1×</span></div></div>
        <div className="unovis-chart timeline-main-chart timeline-selectable" onClick={(event) => selectTimelineRun(event, data, onSelect)}>
          <VisXYContainer<TimelinePoint> data={data} height={216} margin={{ top: 14, right: 10, bottom: 44, left: 42 }} xDomain={[-0.5, Math.max(0.5, data.length - 0.5)]} yDomain={[0, 70]}>
            <VisStackedBar<TimelinePoint> x={(point) => point.index} y={scoreAccessors} color={[trackColors.coding, trackColors.math, trackColors.generic]} dataStep={joinedBarStep} barPadding={0} roundedCorners={0} duration={700} />
            <VisAxis<TimelinePoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={timeAt} tickTextFontSize="8px" tickTextWidth={38} tickTextAngle={-35} gridLine={false} />
            <VisAxis<TimelinePoint> type="y" numTicks={4} tickFormat={(value) => `${Math.round(Number(value))}%`} />
            <VisTooltip />
            <VisCrosshair<TimelinePoint> x={(point) => point.index} yStacked={scoreAccessors} color={[trackColors.coding, trackColors.math, trackColors.generic]} template={timelineTooltip} visibilityThreshold={0} />
          </VisXYContainer>
        </div>
      </article>
      <article className="timeline-chart">
        <div className="timeline-chart-head"><h2>Token efficiency</h2><span>score / 1M tokens</span></div>
        <div className="unovis-chart timeline-selectable" onClick={(event) => selectTimelineRun(event, data, onSelect)}>
          <VisXYContainer<TimelinePoint> data={data} height={216} margin={{ top: 14, right: 10, bottom: 44, left: 42 }} xDomain={[-0.5, Math.max(0.5, data.length - 0.5)]} yDomain={[0, undefined]}>
            <VisLine<TimelinePoint> x={(point) => point.index} y={(point) => point.efficiency} color="#6c3ff2" lineWidth={3} duration={700} />
            <VisAxis<TimelinePoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={timeAt} tickTextFontSize="8px" tickTextWidth={38} tickTextAngle={-35} gridLine={false} />
            <VisAxis<TimelinePoint> type="y" numTicks={4} tickFormat={(value) => Number(value).toFixed(1)} />
            <VisTooltip />
            <VisCrosshair<TimelinePoint> x={(point) => point.index} y={(point) => point.efficiency} color="#6c3ff2" template={(point) => `<div class="chart-tooltip"><strong>${escapeHtml(point.runName)}</strong><dl><div><dt>Efficiency</dt><dd>${point.efficiency.toFixed(2)}</dd></div></dl></div>`} visibilityThreshold={0} />
          </VisXYContainer>
        </div>
      </article>
      <article className="timeline-chart">
        <div className="timeline-chart-head"><h2>Model calls</h2><span>requests</span></div>
        <div className="unovis-chart timeline-selectable" onClick={(event) => selectTimelineRun(event, data, onSelect)}>
          <VisXYContainer<TimelinePoint> data={data} height={216} margin={{ top: 14, right: 10, bottom: 44, left: 42 }} xDomain={[-0.5, Math.max(0.5, data.length - 0.5)]} yDomain={[0, undefined]}>
            <VisStackedBar<TimelinePoint> x={(point) => point.index} y={[(point) => point.calls]} color="#abc929" dataStep={joinedBarStep} barPadding={0} roundedCorners={0} duration={700} />
            <VisAxis<TimelinePoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={timeAt} tickTextFontSize="8px" tickTextWidth={38} tickTextAngle={-35} gridLine={false} />
            <VisAxis<TimelinePoint> type="y" numTicks={4} tickFormat={(value) => formatNumber(Number(value), 0)} />
            <VisTooltip />
            <VisCrosshair<TimelinePoint> x={(point) => point.index} yStacked={[(point) => point.calls]} color="#abc929" template={(point) => `<div class="chart-tooltip"><strong>${escapeHtml(point.runName)}</strong><dl><div><dt>Model calls</dt><dd>${point.calls.toLocaleString()}</dd></div></dl></div>`} visibilityThreshold={0} />
          </VisXYContainer>
        </div>
      </article>
    </section>
  );
}

function ModelTokenChart({ report }: { report: PortalBatchRunReport }) {
  const data = useMemo<ModelPoint[]>(() => {
    const models = report.modelUsage.map((usage, index) => ({ index: index + 1, model: shortModel(usage.model), input: usage.inputTokens, output: usage.outputTokens, total: usage.totalTokens }));
    return [...models, { index: models.length + 1, model: "Total", input: report.tokens.input, output: report.tokens.output, total: report.tokens.total }];
  }, [report]);
  const modelAt = (value: number | Date) => data[Math.max(0, Math.round(Number(value)) - 1)]?.model ?? "";
  const accessors = [(point: ModelPoint) => point.input, (point: ModelPoint) => point.output];
  return (
    <article className="run-stat-chart">
      <div className="run-stat-chart-head">
        <h3>Per-run tokens</h3>
        <div className="chart-inline-legend"><span><i style={{ background: tokenColors[0] }} />Input</span><span><i style={{ background: tokenColors[1] }} />Output</span></div>
      </div>
      <div className="unovis-chart" key={report.reportId}>
        <VisXYContainer<ModelPoint> data={data} height={150} margin={{ top: 10, right: 5, bottom: 31, left: 24 }} xDomain={[0.5, Math.max(1.5, data.length + 0.5)]} yDomain={[0, undefined]}>
          <VisStackedBar<ModelPoint> x={(point) => point.index} y={accessors} color={tokenColors} barPadding={0.36} roundedCorners={2} duration={700} />
          <VisAxis<ModelPoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={modelAt} tickTextFontSize="9px" tickTextWidth={108} gridLine={false} />
          <VisAxis<ModelPoint> type="y" label="TOKENS" numTicks={4} tickFormat={(value) => formatNumber(Number(value), 1)} />
          <VisTooltip />
          <VisCrosshair<ModelPoint> x={(point) => point.index} yStacked={accessors} color={tokenColors} template={(point) => `<div class="chart-tooltip"><dl><div><dt>Input</dt><dd>${point.input.toLocaleString()}</dd></div><div><dt>Output</dt><dd>${point.output.toLocaleString()}</dd></div><div><dt>Total</dt><dd>${point.total.toLocaleString()}</dd></div></dl></div>`} visibilityThreshold={0} />
        </VisXYContainer>
      </div>
    </article>
  );
}

function TrackAccuracyChart({ report }: { report: PortalBatchRunReport }) {
  const data = useMemo<TrackPoint[]>(() => {
    const tracks = report.trackResults.map((result, index) => ({ index: index + 1, label: result.track, track: result.track, accuracy: result.accuracy * 100, graded: result.graded, items: result.items }));
    return [...tracks, { index: tracks.length + 1, label: "Bench", accuracy: report.score * 100, graded: report.scoredItems, items: report.totalItems, isBench: true }];
  }, [report]);
  const trackAt = (value: number | Date) => data[Math.max(0, Math.round(Number(value)) - 1)]?.label ?? "";
  const accessors = [(point: TrackPoint) => point.accuracy];
  const color = (point: TrackPoint) => point.isBench ? "#dfff78" : trackColors.coding;
  return (
    <article className="run-stat-chart">
      <div className="run-stat-chart-head"><h3>Per-run track accuracy</h3></div>
      <div className="unovis-chart" key={report.reportId}>
        <VisXYContainer<TrackPoint> data={data} height={136} margin={{ top: 10, right: 5, bottom: 29, left: 24 }} xDomain={[0.5, Math.max(1.5, data.length + 0.5)]} yDomain={[0, 100]}>
          <VisStackedBar<TrackPoint> x={(point) => point.index} y={accessors} color={color} barPadding={0.34} roundedCorners={2} duration={700} />
          <VisAxis<TrackPoint> type="x" tickValues={data.map((point) => point.index)} tickFormat={trackAt} gridLine={false} />
          <VisAxis<TrackPoint> type="y" label="ACCURACY" numTicks={5} tickFormat={(value) => `${Number(value)}%`} />
          <VisTooltip />
          <VisCrosshair<TrackPoint> x={(point) => point.index} yStacked={accessors} color={color} template={(point) => `<div class="chart-tooltip"><dl><div><dt>${point.isBench ? "Bench accuracy" : "Accuracy"}</dt><dd>${point.accuracy.toFixed(1)}%</dd></div><div><dt>${point.isBench ? "Scored" : "Graded"}</dt><dd>${point.graded} / ${point.items}</dd></div></dl></div>`} visibilityThreshold={0} />
        </VisXYContainer>
      </div>
    </article>
  );
}

function SelectedRunStats({ report }: { report: PortalBatchRunReport }) {
  const missing = notGradedItems(report);
  return (
    <section className="selected-run portal-report compare-selected-panel" aria-labelledby="selected-run-title">
      <header className="selected-run-head">
        <div><h2 id="selected-run-title">{report.runName}</h2><p>{formatDuration(report.executionTimeMs)} · {postedClock(report.evidence.receivedAt ?? report.postedAt)} UTC</p></div>
        <span className={`status-mark status-${report.status}`}>{report.status}</span>
      </header>

      <div className="run-stat-grid portal-chart-grid"><TrackAccuracyChart report={report} /><ModelTokenChart report={report} /></div>

      <p className="portal-field-note"><Info size={14} aria-hidden="true" />Items is the total question count. Graded excludes answers that could not be checked; {missing} item{missing === 1 ? " was" : "s were"} not graded in this Run.</p>
    </section>
  );
}

export function CompareRuns({ reports, selectedId, onSelectedIdChange }: { reports: PortalBatchRunReport[]; selectedId: string; onSelectedIdChange: (reportId: string) => void }) {
  const selected = reports.find((report) => report.reportId === selectedId) ?? reports[0];

  if (!selected) return <div className="compare-empty"><Box size={20} /><p>No comparison Run report is loaded.</p></div>;

  return (
    <div className="analysis-page compare-runs-page">
      <div className="compare-workbench"><RunSpace reports={reports} selectedId={selected.reportId} onSelect={onSelectedIdChange} /><SelectedRunStats report={selected} /></div>
      <AllRunsStats reports={reports} onSelect={onSelectedIdChange} />
    </div>
  );
}
