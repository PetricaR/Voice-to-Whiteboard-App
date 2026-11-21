import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { QueryExecutionResult } from '../../data/sqlEngine';
import {
  formatMetricValue,
  type ChartElementConfig,
  type DashboardWidget,
} from '../../engine/dashboard';
import type { ColorName } from '../../engine/types';
import {
  buildCurvePath,
  computeHistogramBins,
  computeLinearRegression,
  createDualAxisScales,
  createNumericScale,
  formatAxisTick,
  humanizeColumnName,
  markerSvgPath,
  pivotMultiSeries,
  resolveDirectLabelPositions,
  resolveSeriesColor,
  roundedBarPath,
  shapeCategoryItems,
  strokeDashForStyle,
  toFiniteNum,
} from './chartLayouts';
import {
  GeospatialMapSvg,
  renderAdvancedAndMultiSvg,
  renderDistributionSvg,
  renderHierarchicalAndFlowSvg,
  renderPolarCompareSvg,
  renderTemporalSpecialSvg,
  type SpecializedChartProps,
} from './ChartSpecializedSvg';

export interface InspectedDatum {
  widget: DashboardWidget;
  label: string;
  value: unknown;
  formattedValue: string;
  column: string;
  row: unknown[];
}

export interface HoverTipRow {
  label: string;
  value: string;
  color?: string;
  axisTag?: 'L' | 'R';
}

interface HoverTip {
  x: number;
  y: number;
  title: string;
  detail?: string;
  rows?: HoverTipRow[];
}

interface LegendEntry {
  name: string;
  displayName?: string;
  color: string;
  valueText?: string;
  swatch?: 'dot' | 'bar' | 'line' | 'dashed';
  axisTag?: 'L' | 'R';
}

const SERIES_COLORS: ColorName[] = ['blue', 'teal', 'purple', 'green', 'orange', 'pink', 'yellow', 'red'];

const colorVar = (c: ColorName | undefined, idx = 0) =>
  `var(--c-${c ?? SERIES_COLORS[idx % SERIES_COLORS.length]}-accent)`;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function useStageWidth(defaultWidth = 620) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(defaultWidth);

  useLayoutEffect(() => {
    if (!node) return;
    const initial = node.clientWidth;
    if (initial > 0) setWidth(Math.round(initial));
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) {
        setWidth((prev) => (Math.abs(prev - next) >= 2 ? Math.round(next) : prev));
      }
    });
    ro.observe(node);
    return () => ro.disconnect();
  }, [node]);

  return { ref: setNode, width };
}

function detectColumns(widget: DashboardWidget, cols: string[], rows: unknown[][]) {
  if (cols.length === 0) return { xIdx: 0, yIndices: [0], compIdx: -1, seriesIdx: -1, sizeIdx: -1 };
  const xIdx = widget.xField && cols.includes(widget.xField) ? cols.indexOf(widget.xField) : 0;
  const seriesIdx = widget.seriesField ? cols.indexOf(widget.seriesField) : -1;
  const compIdx = widget.comparisonField ? cols.indexOf(widget.comparisonField) : -1;
  const sizeIdx = widget.sizeField ? cols.indexOf(widget.sizeField) : -1;

  let yIndices: number[] = [];
  if (widget.yFields && widget.yFields.length > 0) {
    yIndices = widget.yFields.map((f) => cols.indexOf(f)).filter((i) => i >= 0);
  }
  if (yIndices.length === 0) {
    const sample = rows[0] ?? [];
    cols.forEach((_, idx) => {
      if (widget.kind !== 'kpi' && widget.kind !== 'histogram' && widget.kind !== 'density' && idx === xIdx && cols.length > 1) {
        return;
      }
      if (idx === seriesIdx || idx === compIdx || idx === sizeIdx) return;
      const val = sample[idx];
      if (typeof val === 'number' || (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val)))) {
        yIndices.push(idx);
      }
    });
  }
  if (yIndices.length === 0) {
    yIndices = [Math.min(1, cols.length - 1)];
  }
  return { xIdx, yIndices, compIdx, seriesIdx, sizeIdx };
}

function formatDataLabelText(
  label: string,
  val: number,
  total: number,
  widget: DashboardWidget,
): string {
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const valStr = formatMetricValue(val, widget.format, widget.unit, fmtOpts);
  const pctStr = `${Math.round((val / Math.max(1e-6, total)) * 100)}%`;
  switch (cfg?.dataLabelContent ?? 'value') {
    case 'percent':
      return pctStr;
    case 'label_value':
      return `${label.slice(0, 12)}: ${valStr}`;
    case 'label_percent':
      return `${label.slice(0, 12)}: ${pctStr}`;
    default:
      return valStr;
  }
}

function truncateText(str: string, maxLen: number): string {
  if (maxLen <= 0 || str.length <= maxLen) return str;
  return `${str.slice(0, Math.max(1, maxLen - 1))}…`;
}

function SortableDataTable({
  widget,
  result,
  loading,
  onInspectDatum,
}: {
  widget: DashboardWidget;
  result: QueryExecutionResult;
  loading?: boolean;
  onInspectDatum: (d: InspectedDatum) => void;
}) {
  const captionId = useId();
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [sortState, setSortState] = useState<{ col: number; dir: 'ascending' | 'descending' } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };

  useEffect(() => {
    setSortState(null);
  }, [result.executedAt]);

  const numericColumns = useMemo(() => {
    const sampleRows = result.rows.slice(0, 16);
    return result.columns.map((_, cIdx) => {
      if (cIdx === 0) return false;
      let sawValue = false;
      for (const r of sampleRows) {
        const v = r[cIdx];
        if (v === null || v === undefined || v === '') continue;
        sawValue = true;
        if (typeof v !== 'number') return false;
      }
      return sawValue;
    });
  }, [result.columns, result.rows]);

  const handleSort = (colIdx: number) => {
    const tbody = tbodyRef.current;
    if (!tbody) return;
    const nextDir: 'ascending' | 'descending' =
      sortState?.col === colIdx && sortState.dir === 'ascending' ? 'descending' : 'ascending';

    const trs = Array.from(tbody.querySelectorAll('tr'));
    trs.sort((rowA, rowB) => {
      const cellA = rowA.children[colIdx] as HTMLElement | undefined;
      const cellB = rowB.children[colIdx] as HTMLElement | undefined;
      const rawA = cellA?.dataset.value ?? cellA?.textContent ?? '';
      const rawB = cellB?.dataset.value ?? cellB?.textContent ?? '';
      const numA = Number(rawA);
      const numB = Number(rawB);
      const bothNumeric = rawA !== '' && rawB !== '' && Number.isFinite(numA) && Number.isFinite(numB);
      const cmp = bothNumeric ? numA - numB : collator.compare(rawA, rawB);
      return nextDir === 'ascending' ? cmp : -cmp;
    });

    const moveRow = (tbody as unknown as { moveBefore?: (node: Node, child: Node | null) => void }).moveBefore;
    for (const tr of trs) {
      if (typeof moveRow === 'function') {
        moveRow.call(tbody, tr, null);
      } else {
        tbody.appendChild(tr);
      }
    }

    setSortState({ col: colIdx, dir: nextDir });
    setAnnouncement(`Sorted ${widget.title} by ${result.columns[colIdx]} ${nextDir}`);
  };

  const maxRows = cfg?.limitItems ?? 120;

  return (
    <div
      tabIndex={0}
      role="region"
      aria-labelledby={captionId}
      className="table-wrapper chart-fade-panel"
      data-reloading={loading ? 'true' : undefined}
    >
      <div role="status" className="visually-hidden">{announcement}</div>
      <table className="dash-table">
        <caption id={captionId} className="visually-hidden">{widget.title}</caption>
        <thead>
          <tr>
            {result.columns.map((col, idx) => {
              const isSorted = sortState?.col === idx;
              const isNumCol = numericColumns[idx];
              return (
                <th
                  key={col}
                  scope="col"
                  className={isNumCol ? 'num-col' : undefined}
                  {...(isSorted ? { 'aria-sort': sortState.dir } : {})}
                >
                  <button type="button" className="th-sort-btn" onClick={() => handleSort(idx)}>
                    <span>{col.replace(/_/g, ' ')}</span>
                    <span aria-hidden="true" className={`sort-glyph${isSorted ? ' active' : ''}`}>
                      {isSorted ? (sortState.dir === 'ascending' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {result.rows.slice(0, maxRows).map((row, rIdx) => (
            <tr key={rIdx}>
              {result.columns.map((col, cIdx) => {
                const raw = row[cIdx];
                const isNum = typeof raw === 'number';
                const formatted =
                  isNum && cIdx > 0
                    ? formatMetricValue(raw, widget.format, undefined, fmtOpts)
                    : raw == null
                      ? '—'
                      : String(raw);
                return (
                  <td
                    key={col}
                    data-label={col}
                    data-value={raw == null ? '' : String(raw)}
                    className={isNum && cIdx > 0 ? 'num-cell' : undefined}
                  >
                    <button
                      type="button"
                      className="datum-cell-btn"
                      onClick={() =>
                        onInspectDatum({
                          widget,
                          label: String(row[0] ?? `Row ${rIdx + 1}`),
                          value: raw,
                          formattedValue: formatted,
                          column: col,
                          row,
                        })
                      }
                      title="Click to audit SQL lineage for this value"
                    >
                      {formatted}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InteractiveLegend({
  entries,
  position,
  showValues,
  muted,
  hoveredSeries,
  onHoverSeries,
  onToggle,
}: {
  entries: LegendEntry[];
  position: 'top' | 'bottom' | 'left' | 'right';
  showValues?: boolean;
  muted: Set<string>;
  hoveredSeries: string | null;
  onHoverSeries: (name: string | null) => void;
  onToggle: (name: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={`chart-legend chart-legend-${position}`} role="group" aria-label="Chart series legend">
      {entries.map((entry) => {
        const isMuted = muted.has(entry.name);
        const isFocused = hoveredSeries !== null && hoveredSeries === entry.name;
        const swatchKind = entry.swatch ?? 'dot';
        return (
          <button
            key={entry.name}
            type="button"
            className={`chart-legend-pill${isMuted ? ' is-muted' : ''}${isFocused ? ' is-focused' : ''}`}
            onClick={() => onToggle(entry.name)}
            onMouseEnter={() => onHoverSeries(entry.name)}
            onMouseLeave={() => onHoverSeries(null)}
            aria-pressed={!isMuted}
            title={isMuted ? `Show ${entry.displayName ?? entry.name}` : `Hide ${entry.displayName ?? entry.name}`}
          >
            {swatchKind === 'line' || swatchKind === 'dashed' ? (
              <span
                className={`legend-line-swatch${swatchKind === 'dashed' ? ' is-dashed' : ''}`}
                style={{ borderColor: entry.color }}
              />
            ) : swatchKind === 'bar' ? (
              <span className="legend-bar-swatch" style={{ background: entry.color }} />
            ) : (
              <span className="legend-dot" style={{ background: entry.color }} />
            )}
            <span className="legend-name">{entry.displayName ?? humanizeColumnName(entry.name)}</span>
            {entry.axisTag && (
              <span
                className={`legend-axis-tag axis-${entry.axisTag.toLowerCase()}`}
                title={entry.axisTag === 'L' ? 'Plotted on Left Y-Axis' : 'Plotted on Right (Second) Y-Axis'}
              >
                {entry.axisTag === 'L' ? '← L' : 'R →'}
              </span>
            )}
            {showValues && entry.valueText && <span className="legend-val">{entry.valueText}</span>}
          </button>
        );
      })}
    </div>
  );
}

const SPECIALIZED_KINDS = new Set([
  'density',
  'box_plot',
  'violin',
  'gantt',
  'candlestick',
  'streamgraph',
  'treemap',
  'sunburst',
  'org_chart',
  'circle_packing',
  'sankey',
  'parallel_sets',
  'chord',
  'network_chart',
  'arc_diagram',
  'choropleth_map',
  'dot_map',
  'geo_heatmap',
  'bubble_map',
  'flow_map',
  'connection_map',
  'marimekko',
  'parallel_coordinates',
  'waterfall',
  'spiral_plot',
  'proportional_area',
  'gauge',
  'nightingale_rose',
  'radar',
]);

export function ChartRenderer({
  widget,
  result,
  loading,
  error,
  onInspectDatum,
  onCrossFilter,
}: {
  widget: DashboardWidget;
  result?: QueryExecutionResult;
  loading?: boolean;
  error?: string;
  onInspectDatum: (datum: InspectedDatum) => void;
  onCrossFilter?: (dimensionCol: string, value: string) => boolean;
}) {
  const areaGradId = useId();
  const { ref: stageRef, width: stageWidth } = useStageWidth(620);
  const [mutedSeries, setMutedSeries] = useState<Set<string>>(() => new Set());
  const [hoverTip, setHoverTip] = useState<HoverTip | null>(null);
  const [hoveredCatIdx, setHoveredCatIdx] = useState<number | null>(null);
  const [hoveredSeries, setHoveredSeries] = useState<string | null>(null);
  const [hoveredSlice, setHoveredSlice] = useState<string | null>(null);

  const cols = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const cfg: ChartElementConfig | undefined = widget.chartConfig;
  const fmtOpts = useMemo(
    () => ({ decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix }),
    [cfg?.decimals, cfg?.prefix, cfg?.suffix],
  );

  const { xIdx, yIndices, compIdx, seriesIdx, sizeIdx } = useMemo(
    () => detectColumns(widget, cols, rows),
    [widget, cols, rows],
  );

  // Clear interactive states when widget changes
  useEffect(() => {
    setMutedSeries(new Set());
    setHoverTip(null);
    setHoveredCatIdx(null);
    setHoveredSeries(null);
    setHoveredSlice(null);
  }, [widget.id, widget.kind]);

  const toggleSeries = (name: string) => {
    setMutedSeries((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const emitDatumClick = (label: string, val: unknown, colName: string, row: unknown[]) => {
    if (cfg?.crossFilterOnClick && onCrossFilter && cols[xIdx]) {
      const handled = onCrossFilter(cols[xIdx], String(row[xIdx] ?? label));
      if (handled) return;
    }
    onInspectDatum({
      widget,
      label,
      value: val,
      formattedValue: formatMetricValue(val, widget.format, widget.unit, fmtOpts),
      column: colName,
      row,
    });
  };

  const handleHover = (tip: HoverTip | null) => {
    if (cfg?.showTooltip === false) {
      setHoverTip(null);
      return;
    }
    setHoverTip(tip);
  };

  if (loading && !result) {
    return (
      <div className="widget-skeleton chart-fade-panel" aria-busy="true">
        <span className="skeleton-shimmer-dot" aria-hidden="true" />
        <span>Running SQL query…</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="widget-error chart-fade-panel" role="alert">
        <strong>Query error:</strong> {error}
      </div>
    );
  }
  if (!result || rows.length === 0) {
    return <div className="widget-empty chart-fade-panel">No rows returned for current filter selection.</div>;
  }

  const H = cfg?.chartHeight ?? 232;
  const W = Math.max(240, stageWidth);
  const designPreset = cfg?.designPreset ?? 'editorial';

  const wrapComposite = (
    stageNode: React.ReactNode,
    legendEntries: LegendEntry[] = [],
    defaultShowLegend = false,
  ) => {
    // Financial Times / Datawrapper / Flourish pattern: decode colors above the plot before scanning the data
    const legendPos = cfg?.legendPosition ?? 'top';
    const shouldShowLegend =
      legendPos !== 'none' &&
      legendEntries.length > 0 &&
      (cfg?.showLegend !== undefined ? cfg.showLegend : defaultShowLegend);

    // Smart tooltip horizontal placement so it never clips left or right edges
    const tipRatioX = hoverTip ? hoverTip.x / Math.max(1, W) : 0.5;
    const tipAlignClass = tipRatioX > 0.72 ? ' align-right' : tipRatioX < 0.28 ? ' align-left' : '';
    const tipLeftPct = hoverTip ? Math.min(96, Math.max(4, tipRatioX * 100)) : 50;
    const tipTopPx = hoverTip ? Math.max(10, Math.min(H - 52, hoverTip.y - 12)) : 12;

    return (
      <div
        className={`chart-composite chart-fade-panel preset-${designPreset}${shouldShowLegend ? ` has-legend-${legendPos}` : ''}`}
        data-reloading={loading ? 'true' : undefined}
        data-animated={cfg?.animate === false ? 'false' : undefined}
      >
        {shouldShowLegend && (legendPos === 'top' || legendPos === 'left') && (
          <InteractiveLegend
            entries={legendEntries}
            position={legendPos}
            showValues={cfg?.legendShowValues}
            muted={mutedSeries}
            hoveredSeries={hoveredSeries}
            onHoverSeries={setHoveredSeries}
            onToggle={toggleSeries}
          />
        )}
        <div className="chart-stage-wrap">
          {stageNode}
          {hoverTip && cfg?.showTooltip !== false && (
            <div
              className={`chart-tooltip-card${tipAlignClass}`}
              style={{
                left: `${tipLeftPct}%`,
                top: `${tipTopPx}px`,
              }}
              role="status"
            >
              <div className="chart-tooltip-head">{hoverTip.title}</div>
              {hoverTip.rows && hoverTip.rows.length > 0 ? (
                <div className="chart-tooltip-rows">
                  {hoverTip.rows.map((r, ri) => (
                    <div key={`${r.label}-${ri}`} className="chart-tooltip-row">
                      <span className="chart-tooltip-key">
                        {r.color && <i className="chart-tooltip-swatch" style={{ background: r.color }} />}
                        <span>{r.label}</span>
                        {r.axisTag && <em className="chart-tooltip-axis">{r.axisTag}</em>}
                      </span>
                      <strong className="chart-tooltip-val">{r.value}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                hoverTip.detail && <span className="chart-tooltip-detail">{hoverTip.detail}</span>
              )}
            </div>
          )}
        </div>
        {shouldShowLegend && (legendPos === 'bottom' || legendPos === 'right') && (
          <InteractiveLegend
            entries={legendEntries}
            position={legendPos}
            showValues={cfg?.legendShowValues}
            muted={mutedSeries}
            hoveredSeries={hoveredSeries}
            onHoverSeries={setHoveredSeries}
            onToggle={toggleSeries}
          />
        )}
        {cfg?.footnote && <p className="chart-footnote">{cfg.footnote}</p>}
      </div>
    );
  };

  // =========================================================================
  // 1. KPI Headline Metric Card (Stripe / Linear / Apple craft)
  // =========================================================================
  if (widget.kind === 'kpi') {
    const valColIdx = yIndices[0] ?? Math.max(0, cols.length - 1);
    const firstRow = rows[0];
    const rawVal = firstRow[valColIdx];
    const numVal = toFiniteNum(rawVal);
    const formatted = formatMetricValue(rawVal, widget.format, widget.unit, fmtOpts);
    const deltaCol =
      compIdx >= 0
        ? compIdx
        : cols.length > 1 && valColIdx === 0
          ? 1
          : valColIdx > 0 && cols.length > valColIdx + 1
            ? valColIdx + 1
            : -1;
    const rawDelta = deltaCol >= 0 ? firstRow[deltaCol] : undefined;
    const deltaNum = rawDelta !== undefined ? toFiniteNum(rawDelta) : null;
    const hasDelta = deltaNum !== null && rawDelta !== null && rawDelta !== '';
    const accentTone = cfg?.customColors?.[0] ?? (widget.color ? colorVar(widget.color) : undefined);
    const targetPct = typeof cfg?.targetValue === 'number' && cfg.targetValue > 0
      ? Math.round((numVal / cfg.targetValue) * 100)
      : null;

    return (
      <div className="kpi-body chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
        <button
          type="button"
          className="kpi-number-btn"
          onClick={() => emitDatumClick(widget.title, rawVal, cols[valColIdx] ?? 'value', firstRow)}
          title="Click to inspect the exact SQL query behind this figure"
        >
          <span className="kpi-primary-value" style={{ color: accentTone }}>
            {formatted}
          </span>
        </button>
        {typeof cfg?.targetValue === 'number' && cfg.targetValue > 0 && (
          <div className="kpi-goal-wrap">
            <div className="kpi-goal-track" title={`Target: ${formatMetricValue(cfg.targetValue, widget.format, widget.unit, fmtOpts)}`}>
              <span
                className="kpi-goal-fill"
                style={{
                  width: `${Math.min(100, Math.max(2, (numVal / cfg.targetValue) * 100))}%`,
                  background: accentTone ?? 'var(--md-primary)',
                }}
              />
            </div>
            <span className="kpi-goal-label">
              {targetPct}% of {formatMetricValue(cfg.targetValue, widget.format, widget.unit, fmtOpts)}
            </span>
          </div>
        )}
        <div className="kpi-meta-slot">
          {hasDelta ? (
            <div className={`kpi-delta ${deltaNum >= 0 ? 'up' : 'down'}`}>
              <span className="kpi-delta-num">
                {deltaNum >= 0 ? '▲' : '▼'}{' '}
                {typeof rawDelta === 'number' ? `${Math.abs(deltaNum).toFixed(1)}%` : String(rawDelta)}
              </span>
              {cols[deltaCol] && <small>{humanizeColumnName(cols[deltaCol])}</small>}
            </div>
          ) : (
            <span className="kpi-source-caption">
              {cfg?.footnote || humanizeColumnName(cols[valColIdx] ?? widget.id)}
            </span>
          )}
        </div>
      </div>
    );
  }

  // =========================================================================
  // 2. Interactive Sortable Data Table
  // =========================================================================
  if (widget.kind === 'table') {
    return <SortableDataTable widget={widget} result={result} loading={loading} onInspectDatum={onInspectDatum} />;
  }

  const primaryY = yIndices[0] ?? Math.min(1, cols.length - 1);
  const rawItems = rows.map((r, idx) => ({
    label: String(r[xIdx] ?? `#${idx + 1}`),
    value: toFiniteNum(r[primaryY]),
    secondValue: yIndices[1] !== undefined ? toFiniteNum(r[yIndices[1]]) : undefined,
    raw: r[primaryY],
    row: r,
  }));
  const items = shapeCategoryItems(
    rawItems,
    cfg,
    widget.kind === 'pie' || widget.kind === 'donut' ? 12 : 28,
  );

  // =========================================================================
  // 3. Pie & Donut Chart (Apple / Flourish / Stripe dynamic center callout)
  // =========================================================================
  if (widget.kind === 'donut' || widget.kind === 'pie') {
    const activeItems = items.filter((it) => !mutedSeries.has(it.label));
    const total = Math.max(1e-6, activeItems.reduce((s, it) => s + Math.max(0, it.value), 0));
    const size = Math.max(180, Math.min(244, H));
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size * 0.42;
    const defaultInner = widget.kind === 'donut' ? 0.65 : 0;
    const rInner = Math.max(0, Math.min(0.86, cfg?.innerRadiusRatio ?? defaultInner)) * rOuter;
    const padRad = ((cfg?.padAngle ?? 1.6) * Math.PI) / 180;
    let angle = ((cfg?.startAngle ?? -90) * Math.PI) / 180;

    const showInlineLegend = cfg?.showLegend !== false && (cfg?.legendPosition ?? 'right') !== 'none';
    const focusedItem = hoveredSlice ? activeItems.find((it) => it.label === hoveredSlice) ?? null : null;
    const centerPrimary = focusedItem
      ? formatMetricValue(focusedItem.value, widget.format, widget.unit, fmtOpts)
      : cfg?.donutCenterLabel || formatMetricValue(total, widget.format, undefined, fmtOpts);
    const centerSub = focusedItem
      ? `${truncateText(focusedItem.label, 14)} · ${Math.round((Math.max(0, focusedItem.value) / total) * 100)}%`
      : cfg?.donutCenterSubtext || 'Total';

    return (
      <div className="donut-layout chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
        <svg
          viewBox={`0 0 ${size} ${size}`}
          style={{ width: size, height: size, maxWidth: '100%' }}
          className="chart-svg donut-svg"
          role="img"
          aria-label={widget.title}
        >
          {activeItems.map((it, idx) => {
            const fullIdx = items.findIndex((orig) => orig.label === it.label);
            const cIdx = fullIdx >= 0 ? fullIdx : idx;
            const col = resolveSeriesColor(cIdx, cfg, undefined);
            const slice = (Math.max(0, it.value) / total) * Math.PI * 2;
            const start = angle + (activeItems.length > 1 ? padRad / 2 : 0);
            const end = angle + Math.max(0.02, slice - (activeItems.length > 1 ? padRad / 2 : 0));
            const mid = (start + end) / 2;
            angle += slice;
            const isHovered = hoveredSlice === it.label;
            const isDimmed = hoveredSlice !== null && !isHovered;
            const rOutEff = isHovered ? rOuter + 3.5 : rOuter;
            const x1 = cx + rOutEff * Math.cos(start);
            const y1 = cy + rOutEff * Math.sin(start);
            const x2 = cx + rOutEff * Math.cos(end);
            const y2 = cy + rOutEff * Math.sin(end);
            const large = end - start > Math.PI ? 1 : 0;
            const d =
              rInner > 1
                ? [
                    `M ${x1} ${y1}`,
                    `A ${rOutEff} ${rOutEff} 0 ${large} 1 ${x2} ${y2}`,
                    `L ${cx + rInner * Math.cos(end)} ${cy + rInner * Math.sin(end)}`,
                    `A ${rInner} ${rInner} 0 ${large} 0 ${cx + rInner * Math.cos(start)} ${cy + rInner * Math.sin(start)}`,
                    'Z',
                  ].join(' ')
                : `M ${cx} ${cy} L ${x1} ${y1} A ${rOutEff} ${rOutEff} 0 ${large} 1 ${x2} ${y2} Z`;
            const formatted = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
            const labelR = rInner > 1 ? (rInner + rOuter) / 2 : rOuter * 0.65;
            return (
              <g
                key={`${it.label}-${idx}`}
                style={{ opacity: isDimmed ? 0.38 : 1, transition: 'opacity 160ms ease' }}
              >
                <path
                  d={d}
                  fill={col}
                  fillOpacity={cfg?.fillOpacity ?? 0.94}
                  stroke="var(--md-surface-container-lowest)"
                  strokeWidth={2}
                  className="chart-hit"
                  onMouseEnter={() => setHoveredSlice(it.label)}
                  onMouseLeave={() => setHoveredSlice(null)}
                  onClick={() => emitDatumClick(it.label, it.raw, cols[primaryY] ?? 'value', it.row)}
                >
                  <title>{`${it.label}: ${formatted} (${Math.round((it.value / total) * 100)}%)`}</title>
                </path>
                {cfg?.showDataLabels && slice > 0.28 && (
                  <text
                    x={cx + labelR * Math.cos(mid)}
                    y={cy + labelR * Math.sin(mid) + 3.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    style={{ fontSize: cfg?.dataLabelFontSize ?? 10.5, fontWeight: 700, pointerEvents: 'none' }}
                  >
                    {formatDataLabelText(it.label, it.value, total, widget)}
                  </text>
                )}
              </g>
            );
          })}
          {rInner > 18 && (
            <g style={{ pointerEvents: 'none' }}>
              <text x={cx} y={cy - 1} textAnchor="middle" className="donut-center-text">
                {centerPrimary}
              </text>
              <text x={cx} y={cy + 15} textAnchor="middle" className="donut-center-subtext">
                {centerSub}
              </text>
            </g>
          )}
        </svg>
        {showInlineLegend && (
          <div className="donut-legend">
            {items.slice(0, 10).map((it, idx) => {
              const formatted = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
              const grand = Math.max(1e-6, items.reduce((s, x) => s + Math.max(0, x.value), 0));
              const sharePct = Math.round((Math.max(0, it.value) / grand) * 100);
              const isMuted = mutedSeries.has(it.label);
              const isFocused = hoveredSlice === it.label;
              return (
                <button
                  key={`${it.label}-${idx}`}
                  type="button"
                  className={`legend-item-btn${isMuted ? ' is-muted' : ''}${isFocused ? ' is-focused' : ''}`}
                  onMouseEnter={() => setHoveredSlice(it.label)}
                  onMouseLeave={() => setHoveredSlice(null)}
                  onClick={() => emitDatumClick(it.label, it.raw, cols[primaryY] ?? 'value', it.row)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    toggleSeries(it.label);
                  }}
                >
                  <span className="legend-dot" style={{ background: resolveSeriesColor(idx, cfg, undefined) }} />
                  <span className="legend-name" title={it.label}>{it.label}</span>
                  <span className="legend-val">
                    {formatted} <small className="legend-share">{sharePct}%</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 4. Square Area (10×10 Waffle Chart — Holistics #35)
  // =========================================================================
  if (widget.kind === 'square_area') {
    const active = items.filter((it) => !mutedSeries.has(it.label) && it.value > 0);
    const total = Math.max(1e-6, active.reduce((s, it) => s + it.value, 0));
    // Allocate exact 100 tiles via largest-remainder rounding
    const rawQuotas = active.map((it, idx) => {
      const origIdx = Math.max(0, items.findIndex((o) => o.label === it.label));
      const exact = (it.value / total) * 100;
      return {
        it,
        color: resolveSeriesColor(origIdx >= 0 ? origIdx : idx, cfg, widget.color),
        count: Math.floor(exact),
        rem: exact - Math.floor(exact),
      };
    });
    let allocated = rawQuotas.reduce((s, q) => s + q.count, 0);
    const byRem = rawQuotas.toSorted((a, b) => b.rem - a.rem);
    let rCursor = 0;
    while (allocated < 100 && byRem.length > 0) {
      byRem[rCursor % byRem.length].count += 1;
      allocated += 1;
      rCursor += 1;
    }
    const cells: { label: string; color: string; val: number; raw: unknown; row: unknown[] }[] = [];
    for (const q of rawQuotas) {
      for (let k = 0; k < q.count && cells.length < 100; k++) {
        cells.push({ label: q.it.label, color: q.color, val: q.it.value, raw: q.it.raw, row: q.it.row });
      }
    }

    return (
      <div className="waffle-layout chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
        <div className="waffle-grid" role="img" aria-label={widget.title}>
          {cells.map((c, idx) => (
            <button
              key={idx}
              type="button"
              className="waffle-tile"
              style={{
                background: c.color,
                opacity: cfg?.fillOpacity ?? 0.9,
                borderRadius: cfg?.barRadius ?? 4,
              }}
              title={`${c.label}: ${formatMetricValue(c.val, widget.format, widget.unit, fmtOpts)}`}
              onClick={() => emitDatumClick(c.label, c.raw, cols[primaryY] ?? 'value', c.row)}
            />
          ))}
        </div>
        {cfg?.showLegend !== false && (
          <div className="donut-legend">
            {items.map((it, idx) => {
              const pct = Math.round((Math.max(0, it.value) / Math.max(1e-6, items.reduce((s, x) => s + Math.max(0, x.value), 0))) * 100);
              return (
                <button
                  key={`${it.label}-${idx}`}
                  type="button"
                  className={`legend-item-btn${mutedSeries.has(it.label) ? ' is-muted' : ''}`}
                  onClick={() => toggleSeries(it.label)}
                >
                  <span className="legend-dot" style={{ background: resolveSeriesColor(idx, cfg, widget.color) }} />
                  <span className="legend-name">{it.label}</span>
                  <span className="legend-val">
                    {formatMetricValue(it.value, widget.format, widget.unit, fmtOpts)} <small className="legend-share">{pct}%</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // =========================================================================
  // 5. Stephen Few Bullet Chart (Holistics #37)
  // =========================================================================
  if (widget.kind === 'bullet') {
    const bulletRows = items.slice(0, cfg?.limitItems ?? 8);
    return (
      <div className="bullet-list chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
        {bulletRows.map((it, idx) => {
          const target =
            compIdx >= 0 && it.row[compIdx] != null
              ? toFiniteNum(it.row[compIdx])
              : cfg?.targetValue ?? (it.secondValue !== undefined ? it.secondValue : it.value * 1.1);
          const scaleMax = Math.max(1e-6, cfg?.yMax ?? Math.max(it.value, target) * 1.18);
          const valPct = Math.min(100, Math.max(1, (it.value / scaleMax) * 100));
          const targetPct = Math.min(99, Math.max(1, (target / scaleMax) * 100));
          const col = resolveSeriesColor(cfg?.colorBy === 'category' ? idx : 0, cfg, widget.color ?? 'blue');
          const fmt = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
          const tgtFmt = formatMetricValue(target, widget.format, widget.unit, fmtOpts);

          return (
            <button
              key={`${it.label}-${idx}`}
              type="button"
              className="bullet-row"
              onClick={() => emitDatumClick(it.label, it.raw, cols[primaryY] ?? 'actual', it.row)}
              title={`${it.label}: ${fmt} vs Target ${tgtFmt}`}
            >
              <div className="bullet-row-head">
                <span className="bullet-label">{it.label}</span>
                <span className="bullet-values">
                  <strong>{fmt}</strong>
                  <small>target {tgtFmt}</small>
                </span>
              </div>
              <div className="bullet-track">
                <span className="bullet-band band-poor" style={{ width: '60%' }} />
                <span className="bullet-band band-satisfactory" style={{ width: '85%' }} />
                <span className="bullet-band band-good" style={{ width: '100%' }} />
                <span
                  className="bullet-actual-bar"
                  style={{
                    width: `${valPct}%`,
                    background: col,
                    borderRadius: cfg?.barRadius ?? 3,
                  }}
                />
                <span className="bullet-target-marker" style={{ left: `${targetPct}%` }} />
              </div>
            </button>
          );
        })}
      </div>
    );
  }

  // =========================================================================
  // 6. Funnel Chart (Progressive Centered Trapezoids — Holistics #39)
  // =========================================================================
  if (widget.kind === 'funnel') {
    const stages = items.slice(0, cfg?.limitItems ?? 8);
    const topVal = Math.max(1e-6, Math.max(...stages.map((s) => Math.abs(s.value))));
    const stageH = Math.max(26, (H - 16) / Math.max(1, stages.length));
    const cx = W / 2;
    const maxHalfW = Math.max(80, (W - 150) / 2);

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {stages.map((st, idx) => {
            const curRatio = Math.max(0.14, Math.abs(st.value) / topVal);
            const nextRatio =
              idx < stages.length - 1
                ? Math.max(0.12, Math.abs(stages[idx + 1].value) / topVal)
                : curRatio * 0.85;
            const y0 = 8 + idx * stageH;
            const y1 = y0 + stageH - 4;
            const hw0 = curRatio * maxHalfW;
            const hw1 = nextRatio * maxHalfW;
            const col = resolveSeriesColor(idx, cfg, widget.color);
            const fmt = formatMetricValue(st.value, widget.format, widget.unit, fmtOpts);
            const convPct = Math.round((Math.abs(st.value) / Math.max(1e-6, Math.abs(stages[0].value))) * 100);

            return (
              <g
                key={`${st.label}-${idx}`}
                className="chart-hit"
                onClick={() => emitDatumClick(st.label, st.raw, cols[primaryY] ?? 'value', st.row)}
                onMouseEnter={() =>
                  handleHover({
                    x: cx,
                    y: (y0 + y1) / 2,
                    title: st.label,
                    detail: `${fmt} (${convPct}% of top)`,
                  })
                }
                onMouseLeave={() => handleHover(null)}
              >
                <polygon
                  points={`${cx - hw0},${y0} ${cx + hw0},${y0} ${cx + hw1},${y1} ${cx - hw1},${y1}`}
                  fill={col}
                  fillOpacity={cfg?.fillOpacity ?? 0.86}
                  stroke="var(--md-surface-container-lowest)"
                  strokeWidth={1.5}
                />
                <text
                  x={cx}
                  y={(y0 + y1) / 2 + 4}
                  textAnchor="middle"
                  fill="#ffffff"
                  style={{ fontSize: cfg?.dataLabelFontSize ?? 11.5, fontWeight: 700 }}
                >
                  {st.label}: {fmt} {idx > 0 ? `(${convPct}%)` : ''}
                </text>
              </g>
            );
          })}
        </svg>
      </div>,
    );
  }

  // =========================================================================
  // 7. Heatmap (2D Matrix when seriesField exists, 1D Tile Grid fallback)
  // =========================================================================
  if (widget.kind === 'heatmap') {
    const baseTone = cfg?.customColors?.[0] ?? resolveSeriesColor(0, cfg, widget.color ?? 'blue');
    if (seriesIdx >= 0 && seriesIdx !== xIdx) {
      const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, [primaryY], cfg);
      const xCats = piv.categories.slice(0, 14);
      const yRows = piv.series.slice(0, 10);
      const allVals = yRows.flatMap((s) => s.values);
      const maxCell = Math.max(1e-6, ...allVals.map((v) => Math.abs(v)));

      return (
        <div
          className="heatmap-matrix-wrap chart-fade-panel"
          tabIndex={0}
          role="region"
          aria-label={`${widget.title} matrix`}
          data-reloading={loading ? 'true' : undefined}
        >
          <table className="heatmap-matrix-table" role="grid" aria-label={widget.title}>
            <thead>
              <tr>
                <th scope="col" className="hm-corner" />
                {xCats.map((xc) => (
                  <th key={xc} scope="col" className="hm-col-head" title={xc}>
                    {truncateText(xc, cfg?.xTickTruncate ?? 9)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {yRows.map((yr) => (
                <tr key={yr.name}>
                  <th scope="row" className="hm-row-head" title={yr.name}>
                    {truncateText(yr.name, 14)}
                  </th>
                  {xCats.map((xc, ci) => {
                    const val = yr.values[ci] ?? 0;
                    const intensity = Math.max(0.1, Math.min(1, Math.abs(val) / maxCell));
                    const fmt = formatMetricValue(val, widget.format, widget.unit, fmtOpts);
                    return (
                      <td key={xc} className="hm-matrix-td">
                        <button
                          type="button"
                          className="hm-matrix-btn"
                          style={{
                            background: `color-mix(in srgb, ${baseTone} ${Math.round(intensity * 85)}%, var(--md-surface-container))`,
                            color: intensity > 0.62 ? '#ffffff' : 'var(--md-on-surface)',
                          }}
                          title={`${yr.name} · ${xc}: ${fmt}`}
                          onClick={() =>
                            emitDatumClick(`${yr.name} · ${xc}`, val, cols[primaryY] ?? 'value', yr.rows[ci] ?? [xc, yr.name, val])
                          }
                        >
                          {cfg?.showDataLabels !== false ? fmt : ''}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          {cfg?.footnote && <p className="chart-footnote">{cfg.footnote}</p>}
        </div>
      );
    }

    const maxTile = Math.max(1e-6, ...items.map((it) => Math.abs(it.value)));
    return (
      <div className="heatmap-grid chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
        {items.slice(0, cfg?.limitItems ?? 18).map((it, idx) => {
          const intensity = Math.max(0.14, Math.min(1, Math.abs(it.value) / maxTile));
          const formatted = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
          return (
            <button
              key={`${it.label}-${idx}`}
              type="button"
              className="heatmap-cell"
              style={{
                background: `color-mix(in srgb, ${baseTone} ${Math.round(intensity * 82)}%, var(--md-surface-container))`,
              }}
              onClick={() => emitDatumClick(it.label, it.raw, cols[primaryY] ?? 'value', it.row)}
            >
              <span className="hm-label">{it.label}</span>
              {cfg?.showDataLabels !== false && <strong className="hm-val">{formatted}</strong>}
            </button>
          );
        })}
      </div>
    );
  }

  // =========================================================================
  // 8. Trellis / Small Multiples (Synchronized Axes — Holistics #33)
  // =========================================================================
  if (widget.kind === 'trellis') {
    const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
    const facets = piv.series.slice(0, cfg?.limitItems ?? 9);
    const cats = piv.categories;
    const sharedMax = Math.max(1e-6, cfg?.yMax ?? Math.max(...facets.flatMap((f) => f.values)));
    const gridCols = Math.max(1, Math.min(4, cfg?.trellisColumns ?? (facets.length >= 4 ? 2 : facets.length)));
    const subKind = cfg?.trellisSubKind ?? 'area';

    return (
      <div
        className="trellis-grid chart-fade-panel"
        style={{ gridTemplateColumns: `repeat(${gridCols}, minmax(0, 1fr))` }}
        data-reloading={loading ? 'true' : undefined}
      >
        {facets.map((facet, fi) => {
          const col = resolveSeriesColor(fi, cfg, widget.color);
          const latest = facet.values[facet.values.length - 1] ?? 0;
          const subW = 240;
          const subH = 96;
          const pL = 8;
          const pR = 8;
          const pT = 10;
          const pB = 18;
          const pw = subW - pL - pR;
          const ph = subH - pT - pB;
          const pts = cats.map((c, ci) => ({
            x: pL + (cats.length <= 1 ? pw / 2 : (ci / (cats.length - 1)) * pw),
            y: pT + ph - (Math.max(0, facet.values[ci] ?? 0) / sharedMax) * ph,
            v: facet.values[ci] ?? 0,
            c,
          }));
          const lineD = buildCurvePath(pts, cfg?.curveType ?? 'monotone');
          const areaD = pts.length > 1 ? `${lineD} L ${pts[pts.length - 1].x} ${pT + ph} L ${pts[0].x} ${pT + ph} Z` : '';

          return (
            <button
              key={facet.name}
              type="button"
              className="trellis-panel"
              onClick={() =>
                emitDatumClick(
                  facet.name,
                  latest,
                  cols[primaryY] ?? 'value',
                  facet.rows[facet.rows.length - 1] ?? [facet.name, latest],
                )
              }
            >
              <div className="trellis-panel-head">
                <span className="trellis-title">{facet.name}</span>
                <strong className="trellis-latest" style={{ color: col }}>
                  {formatMetricValue(latest, widget.format, widget.unit, fmtOpts)}
                </strong>
              </div>
              <svg viewBox={`0 0 ${subW} ${subH}`} className="trellis-svg" role="img" aria-label={facet.name}>
                <line x1={pL} y1={pT + ph} x2={subW - pR} y2={pT + ph} stroke="var(--md-outline-variant)" />
                <line x1={pL} y1={pT + ph / 2} x2={subW - pR} y2={pT + ph / 2} stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.45} />
                {(subKind === 'bar' || subKind === 'column') ? (
                  pts.map((pt, pi) => {
                    const bw = Math.max(4, (pw / Math.max(1, pts.length)) * 0.68);
                    const cxBar = pL + ((pi + 0.5) / Math.max(1, pts.length)) * pw;
                    return (
                      <rect
                        key={pi}
                        x={cxBar - bw / 2}
                        y={pt.y}
                        width={bw}
                        height={Math.max(2, pT + ph - pt.y)}
                        rx={cfg?.barRadius ?? 2}
                        fill={col}
                        fillOpacity={cfg?.fillOpacity ?? 0.85}
                      />
                    );
                  })
                ) : (
                  <>
                    {subKind === 'area' && areaD && <path d={areaD} fill={col} fillOpacity={0.18} />}
                    {lineD && <path d={lineD} fill="none" stroke={col} strokeWidth={2.2} />}
                  </>
                )}
                {cats.length > 0 && (
                  <>
                    <text x={pL} y={subH - 4} className="axis-tick" style={{ fontSize: 9 }}>
                      {String(cats[0]).slice(0, 8)}
                    </text>
                    <text x={subW - pR} y={subH - 4} textAnchor="end" className="axis-tick" style={{ fontSize: 9 }}>
                      {String(cats[cats.length - 1]).slice(0, 8)}
                    </text>
                  </>
                )}
              </svg>
            </button>
          );
        })}
      </div>
    );
  }

  // =========================================================================
  // 9. Specialized 29 Chart Types Delegated to ChartSpecializedSvg
  // =========================================================================
  if (SPECIALIZED_KINDS.has(widget.kind)) {
    const specProps: SpecializedChartProps = {
      widget,
      cols,
      rows,
      xIdx,
      yIndices,
      seriesIdx,
      compIdx,
      width: W,
      height: H,
      mutedSeries,
      onInspect: emitDatumClick,
      onHover: handleHover,
    };

    let svgNode: React.ReactNode = null;
    if (widget.kind === 'density' || widget.kind === 'box_plot' || widget.kind === 'violin') {
      svgNode = renderDistributionSvg(specProps);
    } else if (widget.kind === 'gantt' || widget.kind === 'candlestick' || widget.kind === 'streamgraph') {
      svgNode = renderTemporalSpecialSvg(specProps);
    } else if (
      widget.kind === 'treemap' ||
      widget.kind === 'sunburst' ||
      widget.kind === 'org_chart' ||
      widget.kind === 'circle_packing' ||
      widget.kind === 'sankey' ||
      widget.kind === 'parallel_sets' ||
      widget.kind === 'chord' ||
      widget.kind === 'network_chart' ||
      widget.kind === 'arc_diagram'
    ) {
      svgNode = renderHierarchicalAndFlowSvg(specProps);
    } else if (
      widget.kind === 'choropleth_map' ||
      widget.kind === 'dot_map' ||
      widget.kind === 'geo_heatmap' ||
      widget.kind === 'bubble_map' ||
      widget.kind === 'flow_map' ||
      widget.kind === 'connection_map'
    ) {
      svgNode = <GeospatialMapSvg {...specProps} />;
    } else if (widget.kind === 'nightingale_rose' || widget.kind === 'radar') {
      svgNode = renderPolarCompareSvg({ ...specProps, items });
    } else {
      svgNode = renderAdvancedAndMultiSvg(specProps);
    }

    const legendEntries: { name: string; color: string; valueText?: string }[] = [];
    if (
      (widget.kind === 'streamgraph' || widget.kind === 'marimekko' || widget.kind === 'radar') &&
      (seriesIdx >= 0 || yIndices.length > 1)
    ) {
      const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
      piv.series.forEach((s, si) => {
        legendEntries.push({
          name: s.name,
          color: resolveSeriesColor(si, cfg, widget.color),
        });
      });
    }

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        {svgNode}
      </div>,
      legendEntries,
      legendEntries.length > 1,
    );
  }

  // =========================================================================
  // 10. Scatter & Bubble Plot (2D Numeric X × Y + Size + OLS Trendline)
  // =========================================================================
  if (widget.kind === 'scatter' || widget.kind === 'bubble') {
    const hasTwoNumericCols =
      yIndices.length >= 2 &&
      rows.some((r) => typeof r[yIndices[0]] === 'number' && typeof r[yIndices[1]] === 'number');
    const xNumCol =
      typeof rows[0]?.[xIdx] === 'number'
        ? xIdx
        : hasTwoNumericCols
          ? yIndices[0]
          : -1;
    const yNumCol =
      xNumCol === yIndices[0] && yIndices.length >= 2
        ? yIndices[1]
        : yIndices[0] ?? Math.min(1, cols.length - 1);
    const szCol =
      sizeIdx >= 0
        ? sizeIdx
        : widget.kind === 'bubble' && yIndices.length >= 3
          ? yIndices[2]
          : widget.kind === 'bubble' && yIndices.length >= 2 && xNumCol === xIdx
            ? yIndices[1]
            : -1;

    const groupNames = Array.from(
      new Set(rows.map((r) => (seriesIdx >= 0 ? String(r[seriesIdx] ?? 'Series') : cols[yNumCol] ?? 'Points'))),
    );
    const ptsRaw = rows.slice(0, cfg?.limitItems ?? 120).map((r, i) => {
      const grp = seriesIdx >= 0 ? String(r[seriesIdx] ?? 'Series') : groupNames[0];
      return {
        label: String(r[xIdx] ?? `#${i + 1}`),
        grp,
        xVal: xNumCol >= 0 ? toFiniteNum(r[xNumCol]) : i + 1,
        yVal: toFiniteNum(r[yNumCol]),
        sizeVal: szCol >= 0 ? Math.max(0, toFiniteNum(r[szCol])) : 1,
        row: r,
      };
    });
    const visiblePts = ptsRaw.filter((p) => !mutedSeries.has(p.grp));

    const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 18 : 60);
    const padR = cfg?.plotPaddingRight ?? (cfg?.yAxisPosition === 'right' ? 60 : 20);
    const padT = cfg?.plotPaddingTop ?? 18;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 44 : 32);
    const plotW = Math.max(100, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);

    const xVals = visiblePts.map((p) => p.xVal);
    const yVals = visiblePts.map((p) => p.yVal);
    const xScale = createNumericScale(
      xVals.length ? xVals : [0, 10],
      {
        startFromZero: false,
        tickCount: 5,
        scale: cfg?.xAxisScale === 'log' || cfg?.xAxisScale === 'sqrt' ? cfg.xAxisScale : 'linear',
      },
    );
    const yTickCnt = Math.max(2, Math.min(10, cfg?.yTickCount ?? 5));
    const yScale = createNumericScale(yVals.length ? yVals : [0, 1], {
      startFromZero: Boolean(cfg?.startFromZero),
      minOverride: cfg?.yMin,
      maxOverride: cfg?.yMax,
      tickCount: yTickCnt,
      scale: cfg?.yAxisScale ?? 'linear',
    });
    const maxSize = Math.max(1e-6, ...visiblePts.map((p) => p.sizeVal));

    const xOf = (v: number) => padL + xScale.norm(v) * plotW;
    const yOf = (v: number) => padT + (1 - yScale.norm(v)) * plotH;
    const gridDash = strokeDashForStyle(cfg?.gridStyle ?? 'solid');
    const gridOpacity = cfg?.gridOpacity ?? 0.2;
    const yAxisFmt = cfg?.yAxisFormat ?? widget.format ?? 'compact';

    const reg =
      cfg?.showTrendline && visiblePts.length >= 2
        ? computeLinearRegression(visiblePts.map((p) => ({ x: p.xVal, y: p.yVal })))
        : null;

    const avgY =
      cfg?.showAverageLine && visiblePts.length > 0
        ? visiblePts.reduce((s, p) => s + p.yVal, 0) / visiblePts.length
        : null;

    const legendEntries: LegendEntry[] = groupNames.map((g, gi) => ({
      name: g,
      color: resolveSeriesColor(gi, cfg, widget.color),
      swatch: 'dot',
    }));

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {cfg?.showPlotBorder && (
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" strokeOpacity={0.45} />
          )}
          {/* Horizontal Nice Grid & Y-Axis Ticks */}
          {yScale.ticks.map((val, ti) => {
            const gy = yOf(val);
            const isBase = ti === 0 || Math.abs(val) < 1e-9;
            return (
              <g key={`yt-${ti}`}>
                {cfg?.showHorizontalGrid !== false && (
                  <line
                    x1={padL}
                    y1={gy}
                    x2={W - padR}
                    y2={gy}
                    stroke={isBase ? 'var(--md-outline)' : 'var(--md-outline-variant)'}
                    strokeDasharray={isBase ? undefined : gridDash}
                    strokeOpacity={isBase ? 0.42 : gridOpacity}
                    shapeRendering="crispEdges"
                  />
                )}
                {cfg?.showYAxis !== false && cfg?.showYTicks !== false && (
                  <text
                    x={cfg?.yAxisPosition === 'right' ? W - padR + 8 : padL - 10}
                    y={gy + 3.5}
                    textAnchor={cfg?.yAxisPosition === 'right' ? 'start' : 'end'}
                    className="axis-tick"
                  >
                    {formatAxisTick(val, yAxisFmt, undefined, fmtOpts)}
                  </text>
                )}
              </g>
            );
          })}
          {/* Vertical Grid & X-Axis Nice Ticks */}
          {xScale.ticks.map((xv, xi) => {
            const gx = xOf(xv);
            return (
              <g key={`xt-${xi}`}>
                {cfg?.showVerticalGrid && (
                  <line
                    x1={gx}
                    y1={padT}
                    x2={gx}
                    y2={padT + plotH}
                    stroke="var(--md-outline-variant)"
                    strokeDasharray={gridDash}
                    strokeOpacity={gridOpacity}
                    shapeRendering="crispEdges"
                  />
                )}
                {cfg?.showXAxis !== false && cfg?.showXTicks !== false && (
                  <text x={gx} y={padT + plotH + 18} textAnchor="middle" className="axis-tick">
                    {xNumCol >= 0 ? formatAxisTick(xv, 'compact') : items[Math.round((xi / Math.max(1, xScale.ticks.length - 1)) * Math.max(0, items.length - 1))]?.label.slice(0, 10)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Reference Bands */}
          {cfg?.referenceBands?.map((b) => {
            const bCol = b.color ?? 'var(--c-teal-accent)';
            if (b.axis === 'x') {
              const bx0 = xOf(Math.min(b.from, b.to));
              const bx1 = xOf(Math.max(b.from, b.to));
              return <rect key={b.id} x={bx0} y={padT} width={Math.max(2, bx1 - bx0)} height={plotH} fill={bCol} fillOpacity={0.12} />;
            }
            const by0 = yOf(Math.max(b.from, b.to));
            const by1 = yOf(Math.min(b.from, b.to));
            return <rect key={b.id} x={padL} y={by0} width={plotW} height={Math.max(2, by1 - by0)} fill={bCol} fillOpacity={0.12} />;
          })}

          {/* Reference Lines & Average Line */}
          {avgY !== null && (
            <g>
              <line x1={padL} y1={yOf(avgY)} x2={W - padR} y2={yOf(avgY)} stroke="var(--c-orange-accent)" strokeWidth={1.5} strokeDasharray="5 3" />
              <text x={W - padR - 4} y={yOf(avgY) - 4} textAnchor="end" className="axis-tick" style={{ fill: 'var(--c-orange-accent)', fontWeight: 600 }}>
                Avg {formatMetricValue(avgY, widget.format, widget.unit, fmtOpts)}
              </text>
            </g>
          )}
          {cfg?.referenceLines?.map((rl) => {
            const rlCol = rl.color ?? 'var(--c-red-accent)';
            const dash = strokeDashForStyle(rl.style ?? 'dashed');
            if (rl.axis === 'x') {
              const rx = xOf(toFiniteNum(rl.value));
              return (
                <g key={rl.id}>
                  <line x1={rx} y1={padT} x2={rx} y2={padT + plotH} stroke={rlCol} strokeWidth={1.6} strokeDasharray={dash} />
                  {rl.label && <text x={rx + 4} y={padT + 12} className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>{rl.label}</text>}
                </g>
              );
            }
            const ry = yOf(toFiniteNum(rl.value));
            return (
              <g key={rl.id}>
                <line x1={padL} y1={ry} x2={W - padR} y2={ry} stroke={rlCol} strokeWidth={1.6} strokeDasharray={dash} />
                {rl.label && <text x={W - padR - 4} y={ry - 4} textAnchor="end" className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>{rl.label}</text>}
              </g>
            );
          })}

          {/* OLS Trendline */}
          {reg && (
            <line
              x1={xOf(xScale.min)}
              y1={yOf(reg.slope * xScale.min + reg.intercept)}
              x2={xOf(xScale.max)}
              y2={yOf(reg.slope * xScale.max + reg.intercept)}
              stroke="var(--md-on-surface-variant)"
              strokeWidth={1.8}
              strokeDasharray="6 4"
            />
          )}

          {/* Points / Area-Scaled Bubbles */}
          {visiblePts.map((pt, idx) => {
            const gi = Math.max(0, groupNames.indexOf(pt.grp));
            const col = resolveSeriesColor(cfg?.colorBy === 'category' ? idx : gi, cfg, widget.color);
            const cx = xOf(pt.xVal);
            const cy = yOf(pt.yVal);
            const r =
              widget.kind === 'bubble'
                ? Math.max(5, Math.sqrt(pt.sizeVal / maxSize) * (cfg?.markerSize ? cfg.markerSize * 3.6 : 24))
                : cfg?.markerSize ?? 5.5;
            const yFmt = formatMetricValue(pt.yVal, widget.format, widget.unit, fmtOpts);
            const shape = cfg?.markerShape ?? 'circle';

            return (
              <g
                key={`${pt.label}-${idx}`}
                className="chart-hit"
                onClick={() => emitDatumClick(pt.label, pt.yVal, cols[yNumCol] ?? 'value', pt.row)}
                onMouseEnter={() =>
                  handleHover({
                    x: cx,
                    y: cy,
                    title: pt.label,
                    detail: `${cols[xNumCol] ?? 'X'}: ${formatMetricValue(pt.xVal, 'compact')} · ${cols[yNumCol] ?? 'Y'}: ${yFmt}${
                      widget.kind === 'bubble' && szCol >= 0 ? ` · ${cols[szCol]}: ${formatMetricValue(pt.sizeVal, 'compact')}` : ''
                    }`,
                  })
                }
                onMouseLeave={() => handleHover(null)}
              >
                {shape === 'circle' || widget.kind === 'bubble' ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={col}
                    fillOpacity={cfg?.fillOpacity ?? (widget.kind === 'bubble' ? 0.62 : 0.85)}
                    stroke={col}
                    strokeWidth={1.6}
                  />
                ) : (
                  <path
                    d={markerSvgPath(shape, cx, cy, r)}
                    fill={col}
                    fillOpacity={cfg?.fillOpacity ?? 0.85}
                    stroke="var(--md-surface-container-lowest)"
                    strokeWidth={1.2}
                  />
                )}
                {cfg?.showDataLabels && (
                  <text x={cx} y={cy - r - 4} textAnchor="middle" className="axis-tick" style={{ fontSize: cfg?.dataLabelFontSize ?? 10 }}>
                    {truncateText(pt.label, 12)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Axis Titles */}
          {cfg?.xAxisTitle && (
            <text x={padL + plotW / 2} y={H - 5} textAnchor="middle" className="axis-title-text">
              {cfg.xAxisTitle}
            </text>
          )}
          {cfg?.yAxisTitle && (
            <text
              x={13}
              y={padT + plotH / 2}
              textAnchor="middle"
              transform={`rotate(-90 13 ${padT + plotH / 2})`}
              className="axis-title-text"
            >
              {cfg.yAxisTitle}
            </text>
          )}
        </svg>
      </div>,
      legendEntries,
      groupNames.length > 1,
    );
  }

  // =========================================================================
  // 11. Histogram (Binned Continuous Distribution — Nice Ticks + Flat Base)
  // =========================================================================
  if (widget.kind === 'histogram') {
    const valCol = yIndices[0] ?? 0;
    const rawValues = rows.map((r) => toFiniteNum(r[valCol])).filter((n) => Number.isFinite(n));
    const bins = computeHistogramBins(rows, valCol, cfg?.binCount ?? 8);
    const histScale = createNumericScale(bins.map((b) => b.count), {
      startFromZero: true,
      maxOverride: cfg?.yMax,
      tickCount: cfg?.yTickCount ?? 4,
    });
    const padL = cfg?.plotPaddingLeft ?? 46;
    const padR = cfg?.plotPaddingRight ?? 16;
    const padT = cfg?.plotPaddingTop ?? 16;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 42 : 30);
    const plotW = Math.max(100, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const slotW = plotW / Math.max(1, bins.length);
    const gap = Math.max(2, (cfg?.barGap ?? 0.08) * slotW);
    const col = resolveSeriesColor(0, cfg, widget.color);
    const meanVal = rawValues.length ? rawValues.reduce((a, b) => a + b, 0) / rawValues.length : 0;
    const minDomain = bins[0]?.x0 ?? 0;
    const maxDomain = bins[bins.length - 1]?.x1 ?? 1;
    const gridDash = strokeDashForStyle(cfg?.gridStyle ?? 'solid');

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {histScale.ticks.map((tv, ti) => {
            const gy = padT + (1 - histScale.norm(tv)) * plotH;
            const isBase = ti === 0;
            return (
              <g key={ti}>
                {cfg?.showHorizontalGrid !== false && (
                  <line
                    x1={padL}
                    y1={gy}
                    x2={W - padR}
                    y2={gy}
                    stroke={isBase ? 'var(--md-outline)' : 'var(--md-outline-variant)'}
                    strokeDasharray={isBase ? undefined : gridDash}
                    strokeOpacity={isBase ? 0.42 : (cfg?.gridOpacity ?? 0.2)}
                    shapeRendering="crispEdges"
                  />
                )}
                {cfg?.showYAxis !== false && (
                  <text x={padL - 10} y={gy + 3.5} textAnchor="end" className="axis-tick">
                    {Math.round(tv)}
                  </text>
                )}
              </g>
            );
          })}
          {bins.map((b, bi) => {
            const bh = histScale.norm(b.count) * plotH;
            const bx = padL + bi * slotW + gap / 2;
            const bw = Math.max(3, slotW - gap);
            const by = padT + plotH - bh;
            const isDim = hoveredCatIdx !== null && hoveredCatIdx !== bi;
            return (
              <g
                key={bi}
                className="chart-hit"
                style={{ opacity: isDim ? 0.45 : 1, transition: 'opacity 140ms ease' }}
                onClick={() => emitDatumClick(`Bin ${b.label}`, b.count, 'frequency', [b.label, b.count])}
                onMouseEnter={() => {
                  setHoveredCatIdx(bi);
                  handleHover({
                    x: bx + bw / 2,
                    y: by,
                    title: `Range ${b.label}`,
                    rows: [
                      {
                        label: 'Observations',
                        value: `${b.count} (${Math.round((b.count / Math.max(1, rawValues.length)) * 100)}%)`,
                        color: col,
                      },
                    ],
                  });
                }}
                onMouseLeave={() => {
                  setHoveredCatIdx(null);
                  handleHover(null);
                }}
              >
                <path
                  d={roundedBarPath(bx, by, bw, Math.max(1, bh), cfg?.barRadius ?? 4, 'top')}
                  fill={cfg?.colorBy === 'category' ? resolveSeriesColor(bi, cfg, widget.color) : col}
                  fillOpacity={cfg?.fillOpacity ?? 0.88}
                />
                {cfg?.showDataLabels && b.count > 0 && (
                  <text x={bx + bw / 2} y={by - 5} textAnchor="middle" className="axis-tick" style={{ fontSize: cfg?.dataLabelFontSize ?? 10.5, fontWeight: 600 }}>
                    {b.count}
                  </text>
                )}
                {cfg?.showXAxis !== false && (bi % Math.max(1, Math.ceil(bins.length / 6)) === 0 || bi === bins.length - 1) && (
                  <text x={bx + bw / 2} y={padT + plotH + 18} textAnchor="middle" className="axis-tick">
                    {formatAxisTick(b.x0, widget.format)}
                  </text>
                )}
              </g>
            );
          })}
          {(cfg?.showAverageLine || cfg?.showMean) && maxDomain > minDomain && (
            <line
              x1={padL + ((meanVal - minDomain) / (maxDomain - minDomain)) * plotW}
              y1={padT}
              x2={padL + ((meanVal - minDomain) / (maxDomain - minDomain)) * plotW}
              y2={padT + plotH}
              stroke="var(--c-orange-accent)"
              strokeWidth={1.8}
              strokeDasharray="5 3"
            />
          )}
          {cfg?.xAxisTitle && (
            <text x={padL + plotW / 2} y={H - 4} textAnchor="middle" className="axis-title-text">
              {cfg.xAxisTitle}
            </text>
          )}
        </svg>
      </div>,
    );
  }

  // =========================================================================
  // 12. Unified Multi-Series & Dual-Axis Cartesian Engine:
  //     bar, column, horizontal_bar, grouped_bar, stacked_bar, line, area, combo
  // =========================================================================
  const pivoted = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
  const categories = pivoted.categories;
  const allSeries = pivoted.series;
  const activeSeries = allSeries.filter((s) => !mutedSeries.has(s.name));
  const seriesToPlot = activeSeries.length > 0 ? activeSeries : allSeries.slice(0, 1);

  const isCombo = widget.kind === 'combo';
  const isLineOrArea = widget.kind === 'line' || widget.kind === 'area';
  const isHorizontalBar =
    !isLineOrArea &&
    !isCombo &&
    (cfg?.orientation === 'horizontal' ||
      (cfg?.orientation !== 'vertical' && widget.kind === 'horizontal_bar'));

  // Resolve Secondary (Right / Y2) Axis series assignment
  const explicitSecondary = (cfg?.secondaryYFields ?? []).map((s) => s.trim().toLowerCase());
  const secondaryNameSet = new Set<string>();
  if (!isHorizontalBar && allSeries.length > 0) {
    if (explicitSecondary.length > 0) {
      for (const s of allSeries) {
        if (explicitSecondary.includes(s.name.toLowerCase())) {
          secondaryNameSet.add(s.name);
        }
      }
    } else if (isCombo && allSeries.length >= 2) {
      for (const s of allSeries.slice(1)) secondaryNameSet.add(s.name);
    } else if (cfg?.showY2Axis && allSeries.length >= 2) {
      secondaryNameSet.add(allSeries[allSeries.length - 1].name);
    }
  }

  const isSeriesY2 = (name: string) => secondaryNameSet.has(name);
  const y1SeriesAll = allSeries.filter((s) => !isSeriesY2(s.name));
  const y2SeriesAll = allSeries.filter((s) => isSeriesY2(s.name));
  const y1SeriesToPlot = seriesToPlot.filter((s) => !isSeriesY2(s.name));
  const y2SeriesToPlot = seriesToPlot.filter((s) => isSeriesY2(s.name));
  const hasY2 = !isHorizontalBar && (y2SeriesAll.length > 0 || Boolean(cfg?.showY2Axis));

  const secondaryType = cfg?.secondarySeriesType ?? (isLineOrArea ? 'dashed_line' : 'line');
  const y1Fmt = cfg?.yAxisFormat ?? widget.format ?? 'compact';
  const y2Fmt = cfg?.y2AxisFormat ?? 'compact';
  const y2FmtOpts = { decimals: cfg?.y2Decimals };
  const formatSeriesVal = (val: number, isY2: boolean) =>
    isY2
      ? formatMetricValue(val, y2Fmt, cfg?.y2Unit, y2FmtOpts)
      : formatMetricValue(val, widget.format ?? y1Fmt, widget.unit, fmtOpts);

  const effectiveStackMode: 'none' | 'stacked' | 'percent_100' =
    cfg?.stackMode ??
    (widget.kind === 'stacked_bar' && y1SeriesToPlot.length > 1 ? 'stacked' : 'none');

  const swatchForSeries = (isY2: boolean): LegendEntry['swatch'] => {
    if (isY2) {
      if (secondaryType === 'bar') return 'bar';
      if (secondaryType === 'dashed_line') return 'dashed';
      return 'line';
    }
    if (isLineOrArea) return cfg?.lineStyle === 'dashed' ? 'dashed' : 'line';
    return 'bar';
  };

  const legendEntries: LegendEntry[] = allSeries.map((s, si) => {
    const onY2 = isSeriesY2(s.name);
    const latestOrSum =
      isLineOrArea || isCombo || onY2
        ? (s.values[s.values.length - 1] ?? 0)
        : s.values.reduce((a, b) => a + b, 0);
    return {
      name: s.name,
      displayName: humanizeColumnName(s.name),
      color: resolveSeriesColor(si, cfg, allSeries.length === 1 ? widget.color : undefined),
      valueText: formatSeriesVal(latestOrSum, onY2),
      swatch: swatchForSeries(onY2),
      ...(hasY2 ? { axisTag: onY2 ? 'R' : 'L' } : {}),
    };
  });

  // Compute primary (Y1) domain totals
  const y1ForDomain = y1SeriesToPlot.length > 0 ? y1SeriesToPlot : seriesToPlot;
  const catStackPosTotals = categories.map((_, ci) =>
    y1ForDomain.reduce((s, ser) => s + Math.max(0, ser.values[ci] ?? 0), 0),
  );
  const catStackNegTotals = categories.map((_, ci) =>
    y1ForDomain.reduce((s, ser) => s + Math.min(0, ser.values[ci] ?? 0), 0),
  );
  const flatY1Values = y1ForDomain.flatMap((s) => s.values);
  const flatY2Values = (y2SeriesToPlot.length > 0 ? y2SeriesToPlot : y2SeriesAll).flatMap((s) => s.values);

  const yTickCnt = Math.max(2, Math.min(10, cfg?.yTickCount ?? (H < 195 ? 4 : 5)));
  const shouldY1ZeroBase = cfg?.startFromZero ?? !isLineOrArea;

  const y1DomainValues =
    effectiveStackMode === 'percent_100'
      ? [0, 100]
      : effectiveStackMode === 'stacked' && y1ForDomain.length > 1
        ? [...catStackNegTotals, ...catStackPosTotals]
        : flatY1Values;

  const dualScales = hasY2
    ? createDualAxisScales(
        y1DomainValues,
        flatY2Values.length > 0 ? flatY2Values : [0, 100],
        {
          startFromZero: effectiveStackMode !== 'none' ? true : shouldY1ZeroBase,
          minOverride: effectiveStackMode === 'percent_100' ? 0 : cfg?.yMin,
          maxOverride: effectiveStackMode === 'percent_100' ? 100 : cfg?.yMax,
          tickCount: yTickCnt,
          scale: cfg?.yAxisScale ?? 'linear',
        },
        {
          startFromZero: cfg?.y2StartFromZero ?? (secondaryType === 'bar'),
          minOverride: cfg?.y2Min,
          maxOverride: cfg?.y2Max,
          tickCount: yTickCnt,
          scale: cfg?.y2AxisScale ?? 'linear',
        },
      )
    : null;

  const valScale = dualScales
    ? dualScales.left
    : createNumericScale(y1DomainValues, {
        startFromZero: effectiveStackMode !== 'none' ? true : shouldY1ZeroBase,
        minOverride: effectiveStackMode === 'percent_100' ? 0 : cfg?.yMin,
        maxOverride: effectiveStackMode === 'percent_100' ? 100 : cfg?.yMax,
        tickCount: yTickCnt,
        scale: cfg?.yAxisScale ?? 'linear',
      });

  const y2Scale = dualScales ? dualScales.right : null;

  // Peak & Trough indices for highlightMaxMin (across Y1 primary series)
  let peakPt: { ci: number; si: number; val: number } | null = null;
  let troughPt: { ci: number; si: number; val: number } | null = null;
  if (cfg?.highlightMaxMin) {
    y1ForDomain.forEach((ser, si) => {
      ser.values.forEach((v, ci) => {
        if (!peakPt || v > peakPt.val) peakPt = { ci, si, val: v };
        if (!troughPt || v < troughPt.val) troughPt = { ci, si, val: v };
      });
    });
  }

  const avgMetric =
    cfg?.showAverageLine && flatY1Values.length > 0
      ? flatY1Values.reduce((a, b) => a + b, 0) / flatY1Values.length
      : null;

  const gridDash = strokeDashForStyle(cfg?.gridStyle ?? (designPreset === 'flourish' ? 'dotted' : 'solid'));
  const gridOpacity = cfg?.gridOpacity ?? (designPreset === 'minimal' ? 0.14 : 0.2);

  // -------------------------------------------------------------------------
  // 12A. Horizontal Bar / Stacked Horizontal / Grouped Horizontal SVG
  // -------------------------------------------------------------------------
  if (isHorizontalBar) {
    const dynH = cfg?.chartHeight ?? Math.max(210, Math.min(460, categories.length * 34 + 48));
    const maxLabelChars = Math.min(22, Math.max(6, ...categories.map((c) => Math.min(c.length, cfg?.xTickTruncate ?? 18))));
    const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 16 : maxLabelChars * 6.9 + 18);
    const padR = cfg?.plotPaddingRight ?? (cfg?.showDataLabels !== false ? 66 : 22);
    const padT = cfg?.plotPaddingTop ?? 12;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 42 : 30);
    const plotW = Math.max(90, W - padL - padR);
    const plotH = Math.max(70, dynH - padT - padB);
    const hTickMax = Math.max(2, Math.min(valScale.ticks.length, Math.floor(plotW / 58) + 1));
    const hTickStep = valScale.ticks.length <= hTickMax ? 1 : Math.ceil((valScale.ticks.length - 1) / Math.max(1, hTickMax - 1));
    const xOfVal = (v: number) => padL + valScale.norm(v) * plotW;
    const zeroX = xOfVal(Math.max(valScale.min, Math.min(valScale.max, 0)));
    const rowSlotH = plotH / Math.max(1, categories.length);
    const barGapRatio = cfg?.barGap ?? 0.28;

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${dynH}`} style={{ height: dynH }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {cfg?.showPlotBorder && <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" strokeOpacity={0.45} />}
          {/* Value Nice Gridlines & Collision-Free Bottom Ticks */}
          {valScale.ticks.map((v, ti) => {
            const gx = xOfVal(v);
            const isZero = Math.abs(v) < 1e-9 || ti === 0;
            const showTickText = ti === 0 || ti === valScale.ticks.length - 1 || ti % hTickStep === 0;
            return (
              <g key={`hgrid-${ti}`}>
                {(cfg?.showVerticalGrid ?? cfg?.showHorizontalGrid !== false) && (
                  <line
                    x1={gx}
                    y1={padT}
                    x2={gx}
                    y2={padT + plotH}
                    stroke={isZero ? 'var(--md-outline)' : 'var(--md-outline-variant)'}
                    strokeDasharray={isZero ? undefined : gridDash}
                    strokeOpacity={isZero ? 0.42 : gridOpacity}
                    shapeRendering="crispEdges"
                  />
                )}
                {showTickText && cfg?.showXAxis !== false && cfg?.showXTicks !== false && (
                  <text
                    x={gx}
                    y={padT + plotH + 18}
                    textAnchor={ti === 0 ? 'start' : ti === valScale.ticks.length - 1 ? 'end' : 'middle'}
                    className="axis-tick"
                  >
                    {effectiveStackMode === 'percent_100'
                      ? `${Math.round(v)}%`
                      : formatAxisTick(v, y1Fmt, undefined, fmtOpts)}
                  </text>
                )}
              </g>
            );
          })}

          {/* Horizontal Bars with Flat Left Baseline & Smooth Right Tip */}
          {categories.map((cat, ci) => {
            const yTopSlot = padT + ci * rowSlotH;
            const usableH = Math.min(cfg?.barMaxWidth ?? 30, rowSlotH * (1 - barGapRatio));
            const bandY = yTopSlot + (rowSlotH - usableH) / 2;
            const catTot = Math.max(1e-6, catStackPosTotals[ci]);
            let stackCursor = zeroX;
            const isHoveredRow = hoveredCatIdx === ci;
            const isDimmedRow = hoveredCatIdx !== null && !isHoveredRow;

            return (
              <g
                key={`${cat}-${ci}`}
                style={{ opacity: isDimmedRow ? 0.42 : 1, transition: 'opacity 150ms ease' }}
              >
                {isHoveredRow && (
                  <rect
                    x={padL}
                    y={yTopSlot + 1}
                    width={plotW}
                    height={Math.max(4, rowSlotH - 2)}
                    rx={6}
                    fill="var(--md-on-surface)"
                    fillOpacity={0.04}
                  />
                )}
                {cfg?.showYAxis !== false && (
                  <text
                    x={padL - 10}
                    y={yTopSlot + rowSlotH / 2 + 4}
                    textAnchor="end"
                    className={`axis-tick${isHoveredRow ? ' is-active' : ''}`}
                  >
                    {truncateText(cat, cfg?.xTickTruncate ?? 19)}
                  </text>
                )}
                {seriesToPlot.map((ser, si) => {
                  const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
                  const rawV = ser.values[ci] ?? 0;
                  const plotV = effectiveStackMode === 'percent_100' ? (Math.max(0, rawV) / catTot) * 100 : rawV;
                  const col =
                    cfg?.colorBy === 'category' && seriesToPlot.length === 1
                      ? resolveSeriesColor(ci, cfg, widget.color)
                      : resolveSeriesColor(fullSi, cfg, seriesToPlot.length === 1 ? widget.color : undefined);

                  let bx = zeroX;
                  let bw = 2;
                  let by = bandY;
                  let bh = usableH;
                  let tipSide: 'right' | 'left' = rawV >= 0 ? 'right' : 'left';
                  let segRadius = cfg?.barRadius ?? 5;

                  if (effectiveStackMode !== 'none' && seriesToPlot.length > 1) {
                    const segW = Math.abs(xOfVal(plotV) - zeroX);
                    bx = stackCursor;
                    bw = Math.max(1, segW);
                    stackCursor += segW;
                    if (si < seriesToPlot.length - 1) segRadius = 0;
                  } else {
                    const subH = usableH / seriesToPlot.length;
                    by = bandY + si * subH;
                    bh = Math.max(3, subH - (seriesToPlot.length > 1 ? 2 : 0));
                    const targetX = xOfVal(plotV);
                    bx = Math.min(zeroX, targetX);
                    bw = Math.max(2, Math.abs(targetX - zeroX));
                    tipSide = targetX >= zeroX ? 'right' : 'left';
                  }

                  const showLbl = cfg?.showDataLabels !== false && (seriesToPlot.length === 1 || effectiveStackMode === 'none');
                  const isSeriesDim = hoveredSeries !== null && hoveredSeries !== ser.name;

                  return (
                    <g
                      key={ser.name}
                      className="chart-hit"
                      style={{ opacity: isSeriesDim ? 0.35 : 1, transition: 'opacity 150ms ease' }}
                      onClick={() =>
                        emitDatumClick(
                          seriesToPlot.length > 1 ? `${cat} · ${humanizeColumnName(ser.name)}` : cat,
                          rawV,
                          ser.name,
                          ser.rows[ci] ?? [cat, rawV],
                        )
                      }
                      onMouseEnter={() => {
                        setHoveredCatIdx(ci);
                        handleHover({
                          x: bx + bw,
                          y: by + bh / 2,
                          title: cat,
                          rows: seriesToPlot.map((sItem) => {
                            const sIdx = Math.max(0, allSeries.findIndex((a) => a.name === sItem.name));
                            const sVal = sItem.values[ci] ?? 0;
                            return {
                              label: humanizeColumnName(sItem.name),
                              value: formatMetricValue(sVal, widget.format, widget.unit, fmtOpts),
                              color:
                                cfg?.colorBy === 'category' && seriesToPlot.length === 1
                                  ? resolveSeriesColor(ci, cfg, widget.color)
                                  : resolveSeriesColor(sIdx, cfg, seriesToPlot.length === 1 ? widget.color : undefined),
                            };
                          }),
                        });
                      }}
                      onMouseLeave={() => {
                        setHoveredCatIdx(null);
                        handleHover(null);
                      }}
                    >
                      <path
                        d={roundedBarPath(bx, by, bw, bh, segRadius, tipSide)}
                        fill={col}
                        fillOpacity={cfg?.fillOpacity ?? 0.92}
                      />
                      {showLbl && (
                        <text
                          x={cfg?.dataLabelPosition === 'inside' && bw > 46 ? bx + bw - 7 : bx + bw + 7}
                          y={by + bh / 2 + 3.5}
                          textAnchor={cfg?.dataLabelPosition === 'inside' && bw > 46 ? 'end' : 'start'}
                          fill={cfg?.dataLabelPosition === 'inside' && bw > 46 ? '#ffffff' : undefined}
                          className={cfg?.dataLabelPosition === 'inside' && bw > 46 ? undefined : 'axis-tick data-label-val'}
                          style={{ fontSize: cfg?.dataLabelFontSize ?? 11, fontWeight: 600 }}
                        >
                          {formatDataLabelText(cat, rawV, catStackPosTotals.reduce((a, b) => a + b, 0), widget)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

          {avgMetric !== null && effectiveStackMode === 'none' && (
            <g>
              <line
                x1={xOfVal(avgMetric)}
                y1={padT}
                x2={xOfVal(avgMetric)}
                y2={padT + plotH}
                stroke="var(--c-orange-accent)"
                strokeWidth={1.5}
                strokeDasharray="5 3"
              />
              <text x={xOfVal(avgMetric) + 5} y={padT + 11} className="axis-tick" style={{ fill: 'var(--c-orange-accent)', fontWeight: 600 }}>
                Avg {formatAxisTick(avgMetric, y1Fmt, undefined, fmtOpts)}
              </text>
            </g>
          )}
          {cfg?.referenceLines?.map((rl) => {
            const rx = xOfVal(toFiniteNum(rl.value));
            const rlCol = rl.color ?? 'var(--c-red-accent)';
            return (
              <g key={rl.id}>
                <line x1={rx} y1={padT} x2={rx} y2={padT + plotH} stroke={rlCol} strokeWidth={1.5} strokeDasharray={strokeDashForStyle(rl.style ?? 'dashed')} />
                {rl.label && <text x={rx + 5} y={padT + 11} className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>{rl.label}</text>}
              </g>
            );
          })}
          {cfg?.xAxisTitle && (
            <text x={padL + plotW / 2} y={dynH - 5} textAnchor="middle" className="axis-title-text">
              {cfg.xAxisTitle}
            </text>
          )}
        </svg>
      </div>,
      legendEntries,
      allSeries.length > 1,
    );
  }

  // -------------------------------------------------------------------------
  // 12B. Vertical Cartesian & Dual-Axis Combo Engine:
  //      bar, column, grouped_bar, stacked_bar, line, area, combo (+ Y2)
  // -------------------------------------------------------------------------
  const y1ColorIdx = y1SeriesAll.length > 0 ? Math.max(0, allSeries.findIndex((s) => s.name === y1SeriesAll[0].name)) : 0;
  const y2ColorIdx = y2SeriesAll.length > 0 ? Math.max(1, allSeries.findIndex((s) => s.name === y2SeriesAll[0].name)) : 1;
  const y1AxisAccent = resolveSeriesColor(y1ColorIdx, cfg, allSeries.length === 1 ? widget.color : undefined);
  const y2AxisAccent = resolveSeriesColor(y2ColorIdx, cfg, undefined);

  const formattedY1Ticks = valScale.ticks.map((v) =>
    effectiveStackMode === 'percent_100' ? `${Math.round(v)}%` : formatAxisTick(v, y1Fmt, undefined, fmtOpts),
  );
  const formattedY2Ticks = y2Scale
    ? y2Scale.ticks.map((v) => formatAxisTick(v, y2Fmt, cfg?.y2Unit, y2FmtOpts))
    : [];

  const maxY1Chars = Math.max(3, ...formattedY1Ticks.map((t) => t.length));
  const maxY2Chars = Math.max(3, ...formattedY2Ticks.map((t) => t.length));
  const autoLeftPad = Math.min(76, Math.max(46, Math.round(maxY1Chars * 6.8 + 16)));
  const autoRightPad = hasY2 ? Math.min(78, Math.max(48, Math.round(maxY2Chars * 6.8 + 18))) : 16;

  const hasBarGeometry = !isLineOrArea || (hasY2 && secondaryType === 'bar');
  const barSeriesList = seriesToPlot.filter((s) => {
    const onY2 = isSeriesY2(s.name);
    return onY2 ? secondaryType === 'bar' : !isLineOrArea;
  });
  const lineAreaSeriesList = seriesToPlot.filter((s) => {
    const onY2 = isSeriesY2(s.name);
    return onY2 ? secondaryType !== 'bar' : isLineOrArea;
  });

  const showDirectLabels = !hasY2 && lineAreaSeriesList.length > 0 && Boolean(cfg?.directLineLabels);
  const directLabelsRightPad = showDirectLabels ? 98 : 0;
  const rotDeg = cfg?.xTickRotation ?? 0;
  const extraRotPad = rotDeg !== 0 ? 18 : 0;

  const hasTopAxisHeaders = Boolean(cfg?.yAxisTitle || (hasY2 && cfg?.y2AxisTitle));
  const leftAxisOnRight = !hasY2 && cfg?.yAxisPosition === 'right';
  const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 18 : leftAxisOnRight ? 18 : autoLeftPad);
  const padR =
    cfg?.plotPaddingRight ??
    (leftAxisOnRight ? autoLeftPad : autoRightPad) + directLabelsRightPad;
  const padT = cfg?.plotPaddingTop ?? (hasTopAxisHeaders ? 28 : 16);
  const padB = cfg?.plotPaddingBottom ?? 32 + extraRotPad + (cfg?.xAxisTitle ? 16 : 0);
  const plotW = Math.max(100, W - padL - padR);
  const plotH = Math.max(80, H - padT - padB);

  const yOfVal = (v: number) => padT + (1 - valScale.norm(v)) * plotH;
  const y2OfVal = (v: number) => (y2Scale ? padT + (1 - y2Scale.norm(v)) * plotH : yOfVal(v));
  const zeroY = yOfVal(Math.max(valScale.min, Math.min(valScale.max, 0)));
  const zeroY2 = y2Scale ? y2OfVal(Math.max(y2Scale.min, Math.min(y2Scale.max, 0))) : zeroY;

  const slotW = plotW / Math.max(1, categories.length);
  const autoMaxXTicks =
    hasBarGeometry && categories.length <= 6 && slotW >= 36
      ? categories.length
      : Math.max(3, Math.floor(plotW / (hasBarGeometry ? 54 : 68)));
  const maxXTicks = cfg?.xTickMaxCount ?? autoMaxXTicks;
  const xTickStep = categories.length <= maxXTicks ? 1 : Math.ceil(categories.length / maxXTicks);
  const autoXTrunc = hasBarGeometry
    ? Math.max(6, Math.min(14, Math.floor((slotW * xTickStep - 6) / 6.3)))
    : 11;
  const xCenterOf = (ci: number) =>
    !hasBarGeometry
      ? padL + (categories.length <= 1 ? plotW / 2 : (ci / (categories.length - 1)) * plotW)
      : padL + (ci + 0.5) * slotW;

  const regLine =
    cfg?.showTrendline && categories.length >= 2 && y1ForDomain[0]
      ? computeLinearRegression(y1ForDomain[0].values.map((v, i) => ({ x: i, y: v })))
      : null;

  // Precompute all line/area series paths and points (supports both Y1 and Y2)
  const curveMode = cfg?.curveType ?? 'monotone';
  const computedLines = (() => {
    const cumBelowY1 = new Array(categories.length).fill(0);
    return lineAreaSeriesList.map((ser, localIdx) => {
      const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
      const onY2 = isSeriesY2(ser.name);
      const col = resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
      const isArea = onY2 ? secondaryType === 'area' : widget.kind === 'area';
      const defaultLineStyle =
        onY2 && secondaryType === 'dashed_line'
          ? 'dashed'
          : !onY2 && localIdx > 0 && !widget.seriesField && !hasY2
            ? 'solid'
            : 'solid';
      const dash = strokeDashForStyle(onY2 ? (secondaryType === 'dashed_line' ? 'dashed' : 'solid') : (cfg?.lineStyle ?? defaultLineStyle));
      const scaleFn = onY2 ? y2OfVal : yOfVal;
      const baseDomainMin = onY2 && y2Scale ? Math.max(y2Scale.min, 0) : Math.max(valScale.min, 0);

      const pts = categories.map((cat, ci) => {
        const rawV = ser.values[ci] ?? 0;
        const tot = Math.max(1e-6, catStackPosTotals[ci]);
        let plotTop = rawV;
        let plotBot = baseDomainMin;
        if (!onY2 && effectiveStackMode === 'stacked' && lineAreaSeriesList.length > 1) {
          plotBot = cumBelowY1[ci];
          plotTop = cumBelowY1[ci] + Math.max(0, rawV);
          cumBelowY1[ci] = plotTop;
        } else if (!onY2 && effectiveStackMode === 'percent_100' && lineAreaSeriesList.length > 1) {
          plotBot = cumBelowY1[ci];
          plotTop = cumBelowY1[ci] + (Math.max(0, rawV) / tot) * 100;
          cumBelowY1[ci] = plotTop;
        }
        return {
          x: xCenterOf(ci),
          y: scaleFn(plotTop),
          yBot: scaleFn(plotBot),
          rawV,
          cat,
          ci,
        };
      });

      const linePath = buildCurvePath(pts, curveMode);
      const revBot = pts.toReversed().map((p) => ({ x: p.x, y: p.yBot }));
      const areaPath =
        pts.length > 1
          ? !onY2 && effectiveStackMode !== 'none' && lineAreaSeriesList.length > 1
            ? `${linePath} ${buildCurvePath(revBot, curveMode).replace(/^M/, 'L')} Z`
            : `${linePath} L ${pts[pts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${pts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
          : '';

      return { ser, fullSi, onY2, col, isArea, dash, pts, linePath, areaPath };
    });
  })();

  // Collision-free vertical targets for Direct End-of-Line Labels (FT / Economist pattern)
  const directLabelYMap = showDirectLabels
    ? resolveDirectLabelPositions(
        computedLines
          .filter((l) => l.pts.length > 0)
          .map((l) => ({ id: l.ser.name, y: l.pts[l.pts.length - 1].y })),
        padT + 8,
        padT + plotH - 6,
        15,
      )
    : null;

  const triggerColumnHover = (ci: number) => {
    setHoveredCatIdx(ci);
    const cat = categories[ci];
    const xPos = xCenterOf(ci);
    const tipRows: HoverTipRow[] = seriesToPlot.map((ser) => {
      const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
      const onY2 = isSeriesY2(ser.name);
      const rawV = ser.values[ci] ?? 0;
      const col =
        cfg?.colorBy === 'category' && seriesToPlot.length === 1 && !isLineOrArea
          ? resolveSeriesColor(ci, cfg, widget.color)
          : resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
      const valStr =
        !onY2 && effectiveStackMode === 'percent_100'
          ? `${formatSeriesVal(rawV, false)} (${Math.round((Math.max(0, rawV) / Math.max(1e-6, catStackPosTotals[ci])) * 100)}%)`
          : formatSeriesVal(rawV, onY2);
      return {
        label: humanizeColumnName(ser.name),
        value: valStr,
        color: col,
        ...(hasY2 ? { axisTag: onY2 ? ('R' as const) : ('L' as const) } : {}),
      };
    });

    // Anchor tooltip neatly above the highest visible point in this column
    const yCandidates: number[] = [];
    for (const ln of computedLines) {
      if (ln.pts[ci]) yCandidates.push(ln.pts[ci].y);
    }
    for (const bs of barSeriesList) {
      const onY2 = isSeriesY2(bs.name);
      const v = bs.values[ci] ?? 0;
      yCandidates.push(onY2 ? y2OfVal(v) : yOfVal(v));
    }
    const anchorY = yCandidates.length > 0 ? Math.min(...yCandidates) : padT + 24;

    handleHover({
      x: xPos,
      y: Math.max(padT + 14, anchorY),
      title: cat,
      rows: tipRows,
    });
  };

  const clearColumnHover = () => {
    setHoveredCatIdx(null);
    handleHover(null);
  };

  return wrapComposite(
    <div ref={stageRef} className="chart-stage">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        style={{ height: H }}
        className="chart-svg cartesian-svg"
        role="img"
        aria-label={widget.title}
        onMouseLeave={clearColumnHover}
      >
        <defs>
          {seriesToPlot.map((ser) => {
            const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
            const onY2 = isSeriesY2(ser.name);
            const isAreaGrad = onY2 ? secondaryType === 'area' : widget.kind === 'area';
            const col = resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
            return (
              <linearGradient key={ser.name} id={`${areaGradId}-${fullSi}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={col} stopOpacity={cfg?.fillOpacity ?? (isAreaGrad ? 0.24 : 0.94)} />
                <stop offset="75%" stopColor={col} stopOpacity={isAreaGrad ? 0.05 : 0.78} />
                <stop offset="100%" stopColor={col} stopOpacity={isAreaGrad ? 0.01 : 0.62} />
              </linearGradient>
            );
          })}
        </defs>

        {cfg?.showPlotBorder && (
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" strokeOpacity={0.45} />
        )}

        {/* Horizontal Top Axis Headers (FT / Datawrapper style — never forces neck-tilting!) */}
        {cfg?.yAxisTitle && cfg?.showYAxis !== false && (
          <g>
            {hasY2 && (
              <rect x={padL} y={padT - 19} width={10} height={3} rx={1.5} fill={y1AxisAccent} />
            )}
            <text
              x={leftAxisOnRight ? W - padR : hasY2 ? padL + 15 : padL}
              y={padT - 14}
              textAnchor={leftAxisOnRight ? 'end' : 'start'}
              className="axis-header-text"
              style={hasY2 ? { fill: y1AxisAccent } : undefined}
            >
              {cfg.yAxisTitle}
            </text>
          </g>
        )}
        {hasY2 && (cfg?.y2AxisTitle || y2SeriesAll[0]) && (
          <g>
            <rect x={W - padR - 10} y={padT - 19} width={10} height={3} rx={1.5} fill={y2AxisAccent} />
            <text
              x={W - padR - 15}
              y={padT - 14}
              textAnchor="end"
              className="axis-header-text"
              style={{ fill: y2AxisAccent }}
            >
              {cfg?.y2AxisTitle || humanizeColumnName(y2SeriesAll[0].name)}
            </text>
          </g>
        )}

        {/* Reference Bands (supports x, y, and y2 axes!) */}
        {cfg?.referenceBands?.map((b) => {
          const bCol = b.color ?? 'var(--c-teal-accent)';
          const yMap = b.axis === 'y2' && y2Scale ? y2OfVal : yOfVal;
          const byTop = yMap(Math.max(b.from, b.to));
          const byBot = yMap(Math.min(b.from, b.to));
          return (
            <g key={b.id}>
              <rect x={padL} y={byTop} width={plotW} height={Math.max(2, byBot - byTop)} fill={bCol} fillOpacity={b.opacity ?? 0.1} rx={2} />
              {b.label && (
                <text x={padL + 8} y={byTop + 13} className="axis-tick" style={{ fill: bCol, fontSize: 10, fontWeight: 600 }}>
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Synchronized Horizontal Hairline Gridlines + Left (Y1) & Right (Y2) Nice Ticks */}
        {valScale.ticks.map((val, ti) => {
          const gy = yOfVal(val);
          const isZeroLine = Math.abs(val) < 1e-9 || (ti === 0 && valScale.min >= 0);
          const y2TickLabel = formattedY2Ticks[ti];
          return (
            <g key={`yg-${ti}`}>
              {cfg?.showHorizontalGrid !== false && (
                <line
                  x1={padL}
                  y1={gy}
                  x2={W - padR}
                  y2={gy}
                  stroke={isZeroLine ? 'var(--md-outline)' : 'var(--md-outline-variant)'}
                  strokeWidth={isZeroLine ? 1.15 : 1}
                  strokeDasharray={isZeroLine ? undefined : gridDash}
                  strokeOpacity={isZeroLine ? 0.42 : gridOpacity}
                  shapeRendering="crispEdges"
                />
              )}
              {cfg?.showYAxis !== false && cfg?.showYTicks !== false && (
                <text
                  x={leftAxisOnRight ? W - padR + 10 : padL - 10}
                  y={gy + 3.5}
                  textAnchor={leftAxisOnRight ? 'start' : 'end'}
                  className="axis-tick"
                  style={hasY2 ? { fill: y1AxisAccent, opacity: 0.9 } : undefined}
                >
                  {formattedY1Ticks[ti]}
                </text>
              )}
              {hasY2 && y2TickLabel !== undefined && cfg?.showYTicks !== false && (
                <text
                  x={W - padR + 10}
                  y={gy + 3.5}
                  textAnchor="start"
                  className="axis-tick axis-tick-y2"
                  style={{ fill: y2AxisAccent, opacity: 0.92 }}
                >
                  {y2TickLabel}
                </text>
              )}
            </g>
          );
        })}

        {/* Subtle Dual-Axis Edge Guide Ticks (visual anchor without heavy chartjunk box) */}
        {hasY2 && (
          <>
            <line x1={padL} y1={padT} x2={padL} y2={padT + plotH} stroke={y1AxisAccent} strokeOpacity={0.22} strokeWidth={1.25} shapeRendering="crispEdges" />
            <line x1={W - padR} y1={padT} x2={W - padR} y2={padT + plotH} stroke={y2AxisAccent} strokeOpacity={0.28} strokeWidth={1.25} shapeRendering="crispEdges" />
          </>
        )}

        {/* Optional Vertical Gridlines */}
        {cfg?.showVerticalGrid &&
          categories.map((cat, ci) => {
            if (ci % xTickStep !== 0 && ci !== categories.length - 1) return null;
            const gx = xCenterOf(ci);
            return (
              <line
                key={`vg-${cat}-${ci}`}
                x1={gx}
                y1={padT}
                x2={gx}
                y2={padT + plotH}
                stroke="var(--md-outline-variant)"
                strokeDasharray={gridDash}
                strokeOpacity={gridOpacity}
                shapeRendering="crispEdges"
              />
            );
          })}

        {/* Interactive Hover Column Wash (Bar/Combo) or Crisp Vertical Crosshair (Line/Area) */}
        {hoveredCatIdx !== null && categories[hoveredCatIdx] !== undefined && (
          hasBarGeometry ? (
            <rect
              x={padL + hoveredCatIdx * slotW + 2}
              y={padT}
              width={Math.max(4, slotW - 4)}
              height={plotH}
              rx={6}
              fill="var(--md-on-surface)"
              fillOpacity={0.045}
              style={{ pointerEvents: 'none' }}
            />
          ) : (
            <line
              x1={xCenterOf(hoveredCatIdx)}
              y1={padT}
              x2={xCenterOf(hoveredCatIdx)}
              y2={padT + plotH}
              stroke="var(--md-on-surface-variant)"
              strokeWidth={1}
              strokeDasharray="3 3"
              strokeOpacity={0.5}
              style={{ pointerEvents: 'none' }}
            />
          )
        )}

        {/* LAYER 1: VERTICAL BAR / COLUMN / GROUPED / STACKED SERIES (rendered beneath overlay lines!) */}
        {barSeriesList.length > 0 &&
          categories.map((cat, ci) => {
            const cx = xCenterOf(ci);
            const barGapRatio = cfg?.barGap ?? 0.28;
            const groupW = Math.min(cfg?.barMaxWidth ?? 52, slotW * (1 - barGapRatio));
            const catTot = Math.max(1e-6, catStackPosTotals[ci]);
            let posStackVal = 0;
            let negStackVal = 0;
            const isRowDimmed = hoveredCatIdx !== null && hoveredCatIdx !== ci;

            return (
              <g
                key={`barcat-${cat}-${ci}`}
                style={{ opacity: isRowDimmed ? 0.45 : 1, transition: 'opacity 140ms ease' }}
              >
                {barSeriesList.map((ser, si) => {
                  const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
                  const onY2 = isSeriesY2(ser.name);
                  const rawV = ser.values[ci] ?? 0;
                  const col =
                    cfg?.colorBy === 'category' && barSeriesList.length === 1 && !hasY2
                      ? resolveSeriesColor(ci, cfg, widget.color)
                      : resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
                  const isSeriesDim = hoveredSeries !== null && hoveredSeries !== ser.name;

                  let bx = cx - groupW / 2;
                  let bw = groupW;
                  let by = onY2 ? zeroY2 : zeroY;
                  let bh = 2;
                  let pctShare = 0;
                  let tipSide: 'top' | 'bottom' = rawV >= 0 ? 'top' : 'bottom';
                  let barRad = cfg?.barRadius ?? 5;

                  const scaleFn = onY2 ? y2OfVal : yOfVal;
                  const baseZeroY = onY2 ? zeroY2 : zeroY;

                  if (!onY2 && effectiveStackMode !== 'none' && barSeriesList.length > 1) {
                    if (effectiveStackMode === 'percent_100') {
                      pctShare = (Math.max(0, rawV) / catTot) * 100;
                      const nextStack = posStackVal + pctShare;
                      by = scaleFn(nextStack);
                      bh = Math.max(1, scaleFn(posStackVal) - by);
                      posStackVal = nextStack;
                    } else if (rawV >= 0) {
                      const nextStack = posStackVal + rawV;
                      by = scaleFn(nextStack);
                      bh = Math.max(1, scaleFn(posStackVal) - by);
                      posStackVal = nextStack;
                    } else {
                      const nextStack = negStackVal + rawV;
                      by = scaleFn(negStackVal);
                      bh = Math.max(1, scaleFn(nextStack) - by);
                      negStackVal = nextStack;
                      tipSide = 'bottom';
                    }
                    if (si < barSeriesList.length - 1) barRad = 0;
                  } else {
                    const subW = groupW / barSeriesList.length;
                    bx = cx - groupW / 2 + si * subW;
                    bw = Math.max(3, subW - (barSeriesList.length > 1 ? 2.5 : 0));
                    const targetY = scaleFn(rawV);
                    by = Math.min(baseZeroY, targetY);
                    bh = Math.max(2, Math.abs(baseZeroY - targetY));
                    tipSide = targetY <= baseZeroY ? 'top' : 'bottom';
                  }

                  const isPeak = !onY2 && peakPt?.ci === ci && peakPt?.si === si;
                  const isTrough = !onY2 && troughPt?.ci === ci && troughPt?.si === si;

                  return (
                    <g
                      key={ser.name}
                      className="chart-hit"
                      style={{ opacity: isSeriesDim ? 0.25 : 1, transition: 'opacity 140ms ease' }}
                      onClick={() =>
                        emitDatumClick(
                          allSeries.length > 1 ? `${cat} · ${humanizeColumnName(ser.name)}` : cat,
                          rawV,
                          ser.name,
                          ser.rows[ci] ?? [cat, rawV],
                        )
                      }
                      onMouseEnter={() => triggerColumnHover(ci)}
                    >
                      <path
                        d={roundedBarPath(bx, by, bw, bh, barRad, tipSide)}
                        fill={cfg?.gradientFill ? `url(#${areaGradId}-${fullSi})` : col}
                        fillOpacity={cfg?.fillOpacity ?? (hasY2 && lineAreaSeriesList.length > 0 ? 0.84 : 0.92)}
                        stroke={
                          isPeak
                            ? 'var(--c-green-accent)'
                            : isTrough
                              ? 'var(--c-red-accent)'
                              : undefined
                        }
                        strokeWidth={isPeak || isTrough ? 2 : undefined}
                      />
                      {cfg?.showDataLabels && bh > 10 && (
                        <text
                          x={bx + bw / 2}
                          y={
                            cfg.dataLabelPosition === 'inside' || cfg.dataLabelPosition === 'center'
                              ? by + bh / 2 + 4
                              : by - 6
                          }
                          textAnchor="middle"
                          fill={
                            cfg.dataLabelPosition === 'inside' || cfg.dataLabelPosition === 'center'
                              ? '#ffffff'
                              : undefined
                          }
                          className={
                            cfg.dataLabelPosition === 'inside' || cfg.dataLabelPosition === 'center'
                              ? undefined
                              : 'axis-tick data-label-val'
                          }
                          style={{ fontSize: cfg?.dataLabelFontSize ?? 10.5, fontWeight: 600 }}
                        >
                          {effectiveStackMode === 'percent_100'
                            ? `${Math.round(pctShare)}%`
                            : onY2
                              ? formatSeriesVal(rawV, true)
                              : formatDataLabelText(cat, rawV, catStackPosTotals.reduce((a, b) => a + b, 0), widget)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

        {/* LAYER 2: LINE & AREA SERIES (primary trends + secondary dual-axis overlays ON TOP) */}
        {computedLines.map(({ ser, fullSi, onY2, col, isArea, dash, pts, linePath, areaPath }, li) => {
          const isSeriesDim = hoveredSeries !== null && hoveredSeries !== ser.name;
          // Editorial best practice (FT / Stripe / Apple): keep curves clean without noisy dots at every point
          // unless user explicitly opts in (`showMarkers: true`), while always surfacing the final endpoint dot + active hover dots!
          const showAllMarkers = cfg?.showMarkers === true;
          const mShape = cfg?.markerShape ?? 'circle';
          const mSize = cfg?.markerSize ?? 4;
          const lastPt = pts[pts.length - 1];
          const hoveredPt = hoveredCatIdx !== null ? pts[hoveredCatIdx] : null;
          const labelY = directLabelYMap?.get(ser.name) ?? lastPt?.y ?? padT;

          return (
            <g
              key={ser.name}
              style={{ opacity: isSeriesDim ? 0.2 : 1, transition: 'opacity 160ms ease' }}
            >
              {isArea && areaPath && (
                <path
                  d={areaPath}
                  fill={
                    cfg?.gradientFill !== false && effectiveStackMode === 'none'
                      ? `url(#${areaGradId}-${fullSi})`
                      : col
                  }
                  fillOpacity={
                    cfg?.gradientFill !== false && effectiveStackMode === 'none'
                      ? 1
                      : (cfg?.fillOpacity ?? 0.24)
                  }
                  style={{ pointerEvents: 'none' }}
                />
              )}
              {pts.length > 1 && (
                <>
                  {/* Subtle halo behind secondary combo line so it stays razor-sharp when crossing bars */}
                  {onY2 && barSeriesList.length > 0 && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="var(--md-surface-container-lowest)"
                      strokeWidth={(cfg?.strokeWidth ?? 2.6) + 2.4}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                      strokeOpacity={0.85}
                      style={{ pointerEvents: 'none' }}
                    />
                  )}
                  <path
                    d={linePath}
                    fill="none"
                    stroke={col}
                    strokeWidth={cfg?.strokeWidth ?? (onY2 ? 2.6 : 2.5)}
                    strokeDasharray={dash}
                    strokeLinejoin="round"
                    strokeLinecap="round"
                    style={{ pointerEvents: 'none' }}
                  />
                </>
              )}

              {/* Explicit Point Markers (only when requested or peak/trough/data-labels) */}
              {pts.map((pt) => {
                const isPeak = !onY2 && peakPt?.ci === pt.ci && peakPt?.si === li;
                const isTrough = !onY2 && troughPt?.ci === pt.ci && troughPt?.si === li;
                const isLast = pt.ci === pts.length - 1;
                const showThisMarker = showAllMarkers || (isLast && cfg?.showMarkers !== false && hoveredCatIdx === null);
                return (
                  <g key={pt.ci} style={{ pointerEvents: 'none' }}>
                    {showThisMarker &&
                      (mShape === 'circle' || !showAllMarkers ? (
                        <>
                          {isLast && !showAllMarkers && (
                            <circle cx={pt.x} cy={pt.y} r={mSize + 3.5} fill={col} fillOpacity={0.18} />
                          )}
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r={isLast && !showAllMarkers ? 4 : mSize}
                            fill={col}
                            stroke="var(--md-surface-container-lowest)"
                            strokeWidth={2}
                          />
                        </>
                      ) : (
                        <path
                          d={markerSvgPath(mShape, pt.x, pt.y, mSize)}
                          fill={col}
                          stroke="var(--md-surface-container-lowest)"
                          strokeWidth={1.5}
                        />
                      ))}
                    {(isPeak || isTrough) && (
                      <circle
                        cx={pt.x}
                        cy={pt.y}
                        r={mSize + 4.5}
                        fill="none"
                        stroke={isPeak ? 'var(--c-green-accent)' : 'var(--c-red-accent)'}
                        strokeWidth={2}
                      />
                    )}
                    {cfg?.showDataLabels && (
                      <text
                        x={pt.x}
                        y={pt.y - mSize - 6}
                        textAnchor="middle"
                        className="axis-tick data-label-val"
                        style={{ fontSize: cfg?.dataLabelFontSize ?? 10, fontWeight: 600, fill: onY2 ? col : undefined }}
                      >
                        {onY2
                          ? formatSeriesVal(pt.rawV, true)
                          : formatDataLabelText(pt.cat, pt.rawV, catStackPosTotals.reduce((a, b) => a + b, 0), widget)}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* Elevated Active Halo Dot on Crosshair Hover */}
              {hoveredPt && (
                <g style={{ pointerEvents: 'none' }}>
                  <circle cx={hoveredPt.x} cy={hoveredPt.y} r={8.5} fill={col} fillOpacity={0.18} />
                  <circle
                    cx={hoveredPt.x}
                    cy={hoveredPt.y}
                    r={4.5}
                    fill={col}
                    stroke="var(--md-surface-container-lowest)"
                    strokeWidth={2.2}
                  />
                </g>
              )}

              {/* Collision-Free Direct End-of-Line Labels (FT / Datawrapper style) */}
              {showDirectLabels && lastPt && (
                <g style={{ pointerEvents: 'none' }}>
                  {Math.abs(labelY - lastPt.y) > 4 && (
                    <line
                      x1={lastPt.x + 5}
                      y1={lastPt.y}
                      x2={lastPt.x + 12}
                      y2={labelY}
                      stroke={col}
                      strokeOpacity={0.45}
                      strokeWidth={1}
                    />
                  )}
                  <text
                    x={lastPt.x + 14}
                    y={labelY + 3.5}
                    className="axis-tick direct-line-label"
                    style={{ fill: col, fontWeight: 650, fontSize: 10.5 }}
                  >
                    {truncateText(humanizeColumnName(ser.name), 10)} · {formatAxisTick(lastPt.rawV, onY2 ? y2Fmt : y1Fmt, undefined, onY2 ? y2FmtOpts : fmtOpts)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* Full-Column Invisible Interaction Overlay (effortless hover tracking & SQL click-to-inspect!) */}
        {categories.map((cat, ci) => {
          const cx = xCenterOf(ci);
          const colX = !hasBarGeometry
            ? ci === 0
              ? padL
              : (xCenterOf(ci - 1) + cx) / 2
            : padL + ci * slotW;
          const colEnd = !hasBarGeometry
            ? ci === categories.length - 1
              ? padL + plotW
              : (cx + xCenterOf(ci + 1)) / 2
            : padL + (ci + 1) * slotW;
          const primaryClickSeries = seriesToPlot[0];
          const primaryRaw = primaryClickSeries?.values[ci] ?? 0;
          return (
            <rect
              key={`hitcol-${ci}`}
              x={colX}
              y={padT}
              width={Math.max(4, colEnd - colX)}
              height={plotH}
              fill="transparent"
              className="chart-hit-col"
              onMouseEnter={() => triggerColumnHover(ci)}
              onClick={() =>
                primaryClickSeries &&
                emitDatumClick(
                  allSeries.length > 1 ? `${cat} · ${humanizeColumnName(primaryClickSeries.name)}` : cat,
                  primaryRaw,
                  primaryClickSeries.name,
                  primaryClickSeries.rows[ci] ?? [cat, primaryRaw],
                )
              }
            />
          );
        })}

        {/* X-Axis Tick Labels */}
        {cfg?.showXAxis !== false &&
          cfg?.showXTicks !== false &&
          categories.map((cat, ci) => {
            if (ci % xTickStep !== 0 && ci !== categories.length - 1) return null;
            const lx = xCenterOf(ci);
            const ly = padT + plotH + 19;
            const textStr = truncateText(cat, cfg?.xTickTruncate ?? autoXTrunc);
            const isHoveredTick = hoveredCatIdx === ci;
            const anchor =
              rotDeg < 0
                ? 'end'
                : rotDeg > 0
                  ? 'start'
                  : !hasBarGeometry && ci === 0 && categories.length > 3
                    ? 'start'
                    : !hasBarGeometry && ci === categories.length - 1 && categories.length > 3
                      ? 'end'
                      : 'middle';
            return (
              <text
                key={`xlbl-${cat}-${ci}`}
                x={lx}
                y={ly}
                textAnchor={anchor}
                transform={rotDeg !== 0 ? `rotate(${rotDeg} ${lx} ${ly})` : undefined}
                className={`axis-tick${isHoveredTick ? ' is-active' : ''}`}
              >
                {textStr}
              </text>
            );
          })}

        {/* OLS Trendline */}
        {regLine && categories.length >= 2 && (
          <line
            x1={xCenterOf(0)}
            y1={yOfVal(regLine.intercept)}
            x2={xCenterOf(categories.length - 1)}
            y2={yOfVal(regLine.slope * (categories.length - 1) + regLine.intercept)}
            stroke="var(--md-on-surface-variant)"
            strokeWidth={1.6}
            strokeDasharray="6 4"
            strokeOpacity={0.78}
            style={{ pointerEvents: 'none' }}
          />
        )}

        {/* Average Line */}
        {avgMetric !== null && effectiveStackMode === 'none' && (
          <g style={{ pointerEvents: 'none' }}>
            <line
              x1={padL}
              y1={yOfVal(avgMetric)}
              x2={W - padR}
              y2={yOfVal(avgMetric)}
              stroke="var(--c-orange-accent)"
              strokeWidth={1.4}
              strokeDasharray="5 3"
            />
            <text
              x={W - padR - 5}
              y={yOfVal(avgMetric) - 5}
              textAnchor="end"
              className="axis-tick"
              style={{ fill: 'var(--c-orange-accent)', fontWeight: 600 }}
            >
              Avg {formatAxisTick(avgMetric, y1Fmt, undefined, fmtOpts)}
            </text>
          </g>
        )}

        {/* Custom Reference Lines (supports x, y left, and y2 right!) */}
        {cfg?.referenceLines?.map((rl) => {
          const rlCol = rl.color ?? (rl.axis === 'y2' ? y2AxisAccent : 'var(--c-red-accent)');
          const dash = strokeDashForStyle(rl.style ?? 'dashed');
          if (rl.axis === 'x') {
            const catIdx = categories.indexOf(String(rl.value));
            if (catIdx < 0) return null;
            const rx = xCenterOf(catIdx);
            return (
              <g key={rl.id} style={{ pointerEvents: 'none' }}>
                <line x1={rx} y1={padT} x2={rx} y2={padT + plotH} stroke={rlCol} strokeWidth={1.5} strokeDasharray={dash} />
                {rl.label && (
                  <text x={rx + 5} y={padT + 12} className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>
                    {rl.label}
                  </text>
                )}
              </g>
            );
          }
          const ry = rl.axis === 'y2' && y2Scale ? y2OfVal(toFiniteNum(rl.value)) : yOfVal(toFiniteNum(rl.value));
          return (
            <g key={rl.id} style={{ pointerEvents: 'none' }}>
              <line
                x1={padL}
                y1={ry}
                x2={W - padR}
                y2={ry}
                stroke={rlCol}
                strokeWidth={1.5}
                strokeDasharray={dash}
              />
              {rl.label && (
                <text
                  x={rl.axis === 'y2' ? padL + 6 : W - padR - 6}
                  y={ry - 5}
                  textAnchor={rl.axis === 'y2' ? 'start' : 'end'}
                  className="axis-tick"
                  style={{ fill: rlCol, fontWeight: 600 }}
                >
                  {rl.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Pinned Callout Annotations */}
        {cfg?.annotations?.map((ann) => {
          const targetIdx = ann.targetLabel ? categories.indexOf(ann.targetLabel) : -1;
          const ax =
            targetIdx >= 0
              ? xCenterOf(targetIdx)
              : padL + (ann.xRatio ?? 0.5) * plotW;
          const ay =
            targetIdx >= 0 && y1ForDomain[0]
              ? yOfVal(y1ForDomain[0].values[targetIdx] ?? 0) - 20
              : padT + (ann.yRatio ?? 0.22) * plotH;
          const aCol = ann.color ?? 'var(--c-purple-accent)';
          const boxW = Math.min(138, Math.max(76, ann.text.length * 6.2 + 18));
          const boxX = Math.max(padL, Math.min(W - padR - boxW, ax - boxW / 2));
          const boxY = Math.max(padT, ay - 13);
          return (
            <g key={ann.id} style={{ pointerEvents: 'none' }}>
              {targetIdx >= 0 && (
                <line x1={ax} y1={boxY + 21} x2={ax} y2={ay + 18} stroke={aCol} strokeWidth={1.3} strokeDasharray="2 2" />
              )}
              <rect
                x={boxX}
                y={boxY}
                width={boxW}
                height={21}
                rx={6}
                fill="var(--md-surface-container-lowest)"
                stroke={aCol}
                strokeWidth={1.2}
              />
              <text
                x={boxX + boxW / 2}
                y={boxY + 14}
                textAnchor="middle"
                className="axis-tick"
                style={{ fill: 'var(--md-on-surface)', fontWeight: 600, fontSize: 10 }}
              >
                {truncateText(ann.text, 20)}
              </text>
            </g>
          );
        })}

        {/* X-Axis Title */}
        {cfg?.xAxisTitle && (
          <text x={padL + plotW / 2} y={H - 5} textAnchor="middle" className="axis-title-text">
            {cfg.xAxisTitle}
          </text>
        )}
      </svg>
    </div>,
    legendEntries,
    allSeries.length > 1 || hasY2,
  );
}
