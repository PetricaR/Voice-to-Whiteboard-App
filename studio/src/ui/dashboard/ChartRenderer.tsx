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
  createNumericScale,
  markerSvgPath,
  pivotMultiSeries,
  resolveSeriesColor,
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

interface HoverTip {
  x: number;
  y: number;
  title: string;
  detail: string;
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
  onToggle,
}: {
  entries: { name: string; color: string; valueText?: string }[];
  position: 'top' | 'bottom' | 'left' | 'right';
  showValues?: boolean;
  muted: Set<string>;
  onToggle: (name: string) => void;
}) {
  if (entries.length === 0) return null;
  return (
    <div className={`chart-legend chart-legend-${position}`} role="group" aria-label="Chart series legend">
      {entries.map((entry) => {
        const isMuted = muted.has(entry.name);
        return (
          <button
            key={entry.name}
            type="button"
            className={`chart-legend-pill${isMuted ? ' is-muted' : ''}`}
            onClick={() => onToggle(entry.name)}
            aria-pressed={!isMuted}
            title={isMuted ? `Show ${entry.name}` : `Hide ${entry.name}`}
          >
            <span className="legend-dot" style={{ background: entry.color }} />
            <span className="legend-name">{entry.name}</span>
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

  // Clear muted series when widget changes
  useEffect(() => {
    setMutedSeries(new Set());
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

  const H = cfg?.chartHeight ?? 216;
  const W = Math.max(240, stageWidth);

  const wrapComposite = (
    stageNode: React.ReactNode,
    legendEntries: { name: string; color: string; valueText?: string }[] = [],
    defaultShowLegend = false,
  ) => {
    const legendPos = cfg?.legendPosition ?? 'bottom';
    const shouldShowLegend =
      legendPos !== 'none' &&
      legendEntries.length > 0 &&
      (cfg?.showLegend !== undefined ? cfg.showLegend : defaultShowLegend);

    return (
      <div
        className={`chart-composite chart-fade-panel${shouldShowLegend ? ` has-legend-${legendPos}` : ''}`}
        data-reloading={loading ? 'true' : undefined}
        data-animated={cfg?.animate === false ? 'false' : undefined}
      >
        {shouldShowLegend && (legendPos === 'top' || legendPos === 'left') && (
          <InteractiveLegend
            entries={legendEntries}
            position={legendPos}
            showValues={cfg?.legendShowValues}
            muted={mutedSeries}
            onToggle={toggleSeries}
          />
        )}
        <div className="chart-stage-wrap">
          {stageNode}
          {hoverTip && cfg?.showTooltip !== false && (
            <div
              className="chart-tooltip-pill"
              style={{
                left: `${Math.min(86, Math.max(14, (hoverTip.x / Math.max(1, W)) * 100))}%`,
                top: `${Math.max(8, Math.min(H - 36, hoverTip.y - 12))}px`,
              }}
              role="status"
            >
              <strong>{hoverTip.title}</strong>
              <span>{hoverTip.detail}</span>
            </div>
          )}
        </div>
        {shouldShowLegend && (legendPos === 'bottom' || legendPos === 'right') && (
          <InteractiveLegend
            entries={legendEntries}
            position={legendPos}
            showValues={cfg?.legendShowValues}
            muted={mutedSeries}
            onToggle={toggleSeries}
          />
        )}
        {cfg?.footnote && <p className="chart-footnote">{cfg.footnote}</p>}
      </div>
    );
  };

  // =========================================================================
  // 1. KPI Headline Metric Card
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
          <div className="kpi-goal-track" title={`Target: ${formatMetricValue(cfg.targetValue, widget.format, widget.unit, fmtOpts)}`}>
            <span
              className="kpi-goal-fill"
              style={{
                width: `${Math.min(100, Math.max(2, (numVal / cfg.targetValue) * 100))}%`,
                background: accentTone ?? 'var(--md-primary)',
              }}
            />
          </div>
        )}
        <div className="kpi-meta-slot">
          {hasDelta ? (
            <div className={`kpi-delta ${deltaNum >= 0 ? 'up' : 'down'}`}>
              <span>
                {deltaNum >= 0 ? '▲' : '▼'}{' '}
                {typeof rawDelta === 'number' ? `${Math.abs(deltaNum).toFixed(1)}%` : String(rawDelta)}
              </span>
              {cols[deltaCol] && <small>{cols[deltaCol].replace(/_/g, ' ')}</small>}
            </div>
          ) : (
            <span className="kpi-source-caption">
              {cfg?.footnote || (cols[valColIdx] ?? widget.id).replace(/_/g, ' ')}
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
  // 3. Pie & Donut Chart
  // =========================================================================
  if (widget.kind === 'donut' || widget.kind === 'pie') {
    const activeItems = items.filter((it) => !mutedSeries.has(it.label));
    const total = Math.max(1e-6, activeItems.reduce((s, it) => s + Math.max(0, it.value), 0));
    const size = Math.max(176, Math.min(240, H));
    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size * 0.41;
    const defaultInner = widget.kind === 'donut' ? 0.58 : 0;
    const rInner = Math.max(0, Math.min(0.86, cfg?.innerRadiusRatio ?? defaultInner)) * rOuter;
    const padRad = ((cfg?.padAngle ?? 1.2) * Math.PI) / 180;
    let angle = ((cfg?.startAngle ?? -90) * Math.PI) / 180;

    const showInlineLegend = cfg?.showLegend !== false && (cfg?.legendPosition ?? 'right') === 'right';

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
            const x1 = cx + rOuter * Math.cos(start);
            const y1 = cy + rOuter * Math.sin(start);
            const x2 = cx + rOuter * Math.cos(end);
            const y2 = cy + rOuter * Math.sin(end);
            const large = end - start > Math.PI ? 1 : 0;
            const d =
              rInner > 1
                ? [
                    `M ${x1} ${y1}`,
                    `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
                    `L ${cx + rInner * Math.cos(end)} ${cy + rInner * Math.sin(end)}`,
                    `A ${rInner} ${rInner} 0 ${large} 0 ${cx + rInner * Math.cos(start)} ${cy + rInner * Math.sin(start)}`,
                    'Z',
                  ].join(' ')
                : `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} Z`;
            const formatted = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
            const labelR = (rInner > 1 ? (rInner + rOuter) / 2 : rOuter * 0.65);
            return (
              <g key={`${it.label}-${idx}`}>
                <path
                  d={d}
                  fill={col}
                  fillOpacity={cfg?.fillOpacity ?? 0.92}
                  stroke="var(--md-surface-container-lowest)"
                  strokeWidth={2}
                  className="chart-hit"
                  onClick={() => emitDatumClick(it.label, it.raw, cols[primaryY] ?? 'value', it.row)}
                >
                  <title>{`${it.label}: ${formatted} (${Math.round((it.value / total) * 100)}%)`}</title>
                </path>
                {cfg?.showDataLabels && slice > 0.26 && (
                  <text
                    x={cx + labelR * Math.cos(mid)}
                    y={cy + labelR * Math.sin(mid) + 3.5}
                    textAnchor="middle"
                    fill="#ffffff"
                    style={{ fontSize: cfg?.dataLabelFontSize ?? 10, fontWeight: 700, pointerEvents: 'none' }}
                  >
                    {formatDataLabelText(it.label, it.value, total, widget)}
                  </text>
                )}
              </g>
            );
          })}
          {rInner > 14 && (
            <>
              <text x={cx} y={cy + (cfg?.donutCenterSubtext ? -1 : 5)} textAnchor="middle" className="donut-center-text">
                {cfg?.donutCenterLabel || formatMetricValue(total, widget.format, undefined, fmtOpts)}
              </text>
              {cfg?.donutCenterSubtext && (
                <text x={cx} y={cy + 14} textAnchor="middle" className="axis-tick" style={{ fontSize: 10 }}>
                  {cfg.donutCenterSubtext}
                </text>
              )}
            </>
          )}
        </svg>
        {showInlineLegend && (
          <div className="donut-legend">
            {items.slice(0, 10).map((it, idx) => {
              const formatted = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
              const sharePct = Math.round((Math.max(0, it.value) / Math.max(1e-6, items.reduce((s, x) => s + Math.max(0, x.value), 0))) * 100);
              const isMuted = mutedSeries.has(it.label);
              return (
                <button
                  key={`${it.label}-${idx}`}
                  type="button"
                  className={`legend-item-btn${isMuted ? ' is-muted' : ''}`}
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
    const byRem = [...rawQuotas].sort((a, b) => b.rem - a.rem);
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
        <div className="heatmap-matrix-wrap chart-fade-panel" data-reloading={loading ? 'true' : undefined}>
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

    const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 18 : 56);
    const padR = cfg?.plotPaddingRight ?? (cfg?.yAxisPosition === 'right' ? 56 : 20);
    const padT = cfg?.plotPaddingTop ?? 18;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 44 : 32);
    const plotW = Math.max(100, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);

    const xVals = visiblePts.map((p) => p.xVal);
    const yVals = visiblePts.map((p) => p.yVal);
    const xScale = createNumericScale(
      [xVals.length ? Math.min(...xVals) : 0, xVals.length ? Math.max(...xVals) * 1.05 : 10],
      { startFromZero: false, scale: cfg?.xAxisScale === 'log' || cfg?.xAxisScale === 'sqrt' ? cfg.xAxisScale : 'linear' },
    );
    const yLo = cfg?.yMin ?? (cfg?.startFromZero ? Math.min(0, ...(yVals.length ? yVals : [0])) : Math.min(...(yVals.length ? yVals : [0])) * 0.92);
    const yHi = cfg?.yMax ?? Math.max(1, ...(yVals.length ? yVals : [1])) * 1.08;
    const yScale = createNumericScale([yLo, yHi], { startFromZero: false, scale: cfg?.yAxisScale ?? 'linear' });
    const maxSize = Math.max(1e-6, ...visiblePts.map((p) => p.sizeVal));

    const xOf = (v: number) => padL + xScale.norm(v) * plotW;
    const yOf = (v: number) => padT + (1 - yScale.norm(v)) * plotH;
    const yTickCnt = Math.max(2, Math.min(10, cfg?.yTickCount ?? 4));
    const gridDash = strokeDashForStyle(cfg?.gridStyle ?? 'dashed');

    const reg =
      cfg?.showTrendline && visiblePts.length >= 2
        ? computeLinearRegression(visiblePts.map((p) => ({ x: p.xVal, y: p.yVal })))
        : null;

    const avgY =
      cfg?.showAverageLine && visiblePts.length > 0
        ? visiblePts.reduce((s, p) => s + p.yVal, 0) / visiblePts.length
        : null;

    const legendEntries = groupNames.map((g, gi) => ({
      name: g,
      color: resolveSeriesColor(gi, cfg, widget.color),
    }));

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {cfg?.showPlotBorder && (
            <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" />
          )}
          {/* Horizontal Grid & Y-Axis Ticks */}
          {Array.from({ length: yTickCnt }, (_, ti) => {
            const t = ti / Math.max(1, yTickCnt - 1);
            const val = yScale.min + (yScale.max - yScale.min) * t;
            const gy = yOf(val);
            return (
              <g key={`yt-${ti}`}>
                {cfg?.showHorizontalGrid !== false && (
                  <line
                    x1={padL}
                    y1={gy}
                    x2={W - padR}
                    y2={gy}
                    stroke="var(--md-outline-variant)"
                    strokeDasharray={ti === 0 ? undefined : gridDash}
                    strokeOpacity={cfg?.gridOpacity ?? 0.5}
                  />
                )}
                {cfg?.showYAxis !== false && cfg?.showYTicks !== false && (
                  <text
                    x={cfg?.yAxisPosition === 'right' ? W - padR + 8 : padL - 8}
                    y={gy + 4}
                    textAnchor={cfg?.yAxisPosition === 'right' ? 'start' : 'end'}
                    className="axis-tick"
                  >
                    {formatMetricValue(val, cfg?.yAxisFormat ?? 'compact')}
                  </text>
                )}
              </g>
            );
          })}
          {/* Vertical Grid & X-Axis Ticks */}
          {[0, 0.25, 0.5, 0.75, 1].map((t, xi) => {
            const xv = xScale.min + (xScale.max - xScale.min) * t;
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
                    strokeOpacity={cfg?.gridOpacity ?? 0.45}
                  />
                )}
                {cfg?.showXAxis !== false && cfg?.showXTicks !== false && (
                  <text x={gx} y={padT + plotH + 18} textAnchor="middle" className="axis-tick">
                    {xNumCol >= 0 ? formatMetricValue(xv, 'compact') : items[Math.round(t * Math.max(0, items.length - 1))]?.label.slice(0, 10)}
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
  // 11. Histogram (Binned Continuous Distribution — Holistics #11)
  // =========================================================================
  if (widget.kind === 'histogram') {
    const valCol = yIndices[0] ?? 0;
    const rawValues = rows.map((r) => toFiniteNum(r[valCol])).filter((n) => Number.isFinite(n));
    const bins = computeHistogramBins(rows, valCol, cfg?.binCount ?? 8);
    const maxCount = Math.max(1, cfg?.yMax ?? Math.max(...bins.map((b) => b.count)));
    const padL = cfg?.plotPaddingLeft ?? 46;
    const padR = cfg?.plotPaddingRight ?? 16;
    const padT = cfg?.plotPaddingTop ?? 16;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 42 : 30);
    const plotW = Math.max(100, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const slotW = plotW / Math.max(1, bins.length);
    const gap = Math.max(1, (cfg?.barGap ?? 0.06) * slotW);
    const col = resolveSeriesColor(0, cfg, widget.color ?? 'blue');
    const meanVal = rawValues.length ? rawValues.reduce((a, b) => a + b, 0) / rawValues.length : 0;
    const minDomain = bins[0]?.x0 ?? 0;
    const maxDomain = bins[bins.length - 1]?.x1 ?? 1;

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {[0, 0.5, 1].map((t) => {
            const gy = padT + plotH * (1 - t);
            return (
              <g key={t}>
                {cfg?.showHorizontalGrid !== false && (
                  <line
                    x1={padL}
                    y1={gy}
                    x2={W - padR}
                    y2={gy}
                    stroke="var(--md-outline-variant)"
                    strokeDasharray={t === 0 ? undefined : strokeDashForStyle(cfg?.gridStyle ?? 'dashed')}
                    strokeOpacity={cfg?.gridOpacity ?? 0.5}
                  />
                )}
                {cfg?.showYAxis !== false && (
                  <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
                    {Math.round(maxCount * t)}
                  </text>
                )}
              </g>
            );
          })}
          {bins.map((b, bi) => {
            const bh = (b.count / maxCount) * plotH;
            const bx = padL + bi * slotW + gap / 2;
            const bw = Math.max(3, slotW - gap);
            const by = padT + plotH - bh;
            return (
              <g
                key={bi}
                className="chart-hit"
                onClick={() => emitDatumClick(`Bin ${b.label}`, b.count, 'frequency', [b.label, b.count])}
                onMouseEnter={() =>
                  handleHover({
                    x: bx + bw / 2,
                    y: by,
                    title: `Range ${b.label}`,
                    detail: `${b.count} observations (${Math.round((b.count / Math.max(1, rawValues.length)) * 100)}%)`,
                  })
                }
                onMouseLeave={() => handleHover(null)}
              >
                <rect
                  x={bx}
                  y={by}
                  width={bw}
                  height={Math.max(1, bh)}
                  rx={cfg?.barRadius ?? 2}
                  fill={cfg?.colorBy === 'category' ? resolveSeriesColor(bi, cfg, widget.color) : col}
                  fillOpacity={cfg?.fillOpacity ?? 0.85}
                />
                {cfg?.showDataLabels && b.count > 0 && (
                  <text x={bx + bw / 2} y={by - 4} textAnchor="middle" className="axis-tick" style={{ fontSize: cfg?.dataLabelFontSize ?? 10 }}>
                    {b.count}
                  </text>
                )}
                {cfg?.showXAxis !== false && (bi % Math.max(1, Math.ceil(bins.length / 6)) === 0 || bi === bins.length - 1) && (
                  <text x={bx + bw / 2} y={padT + plotH + 17} textAnchor="middle" className="axis-tick">
                    {formatMetricValue(b.x0, widget.format)}
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
  // 12. Unified Multi-Series Cartesian Engine:
  //     bar, column, horizontal_bar, grouped_bar, stacked_bar, line, area
  // =========================================================================
  const pivoted = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
  const categories = pivoted.categories;
  const allSeries = pivoted.series;
  const activeSeries = allSeries.filter((s) => !mutedSeries.has(s.name));
  const seriesToPlot = activeSeries.length > 0 ? activeSeries : allSeries.slice(0, 1);

  const isLineOrArea = widget.kind === 'line' || widget.kind === 'area';
  const isHorizontalBar =
    !isLineOrArea &&
    (cfg?.orientation === 'horizontal' ||
      (cfg?.orientation !== 'vertical' && widget.kind === 'horizontal_bar'));

  const effectiveStackMode: 'none' | 'stacked' | 'percent_100' =
    cfg?.stackMode ??
    (widget.kind === 'stacked_bar' && seriesToPlot.length > 1 ? 'stacked' : 'none');

  const legendEntries = allSeries.map((s, si) => {
    const sumVal = s.values.reduce((a, b) => a + b, 0);
    return {
      name: s.name,
      color: resolveSeriesColor(si, cfg, allSeries.length === 1 ? widget.color : undefined),
      valueText: formatMetricValue(sumVal, widget.format, widget.unit, fmtOpts),
    };
  });

  // Compute domain across categories & series
  const catStackPosTotals = categories.map((_, ci) =>
    seriesToPlot.reduce((s, ser) => s + Math.max(0, ser.values[ci] ?? 0), 0),
  );
  const catStackNegTotals = categories.map((_, ci) =>
    seriesToPlot.reduce((s, ser) => s + Math.min(0, ser.values[ci] ?? 0), 0),
  );
  const flatValues = seriesToPlot.flatMap((s) => s.values);

  let rawMin = 0;
  let rawMax = 100;
  if (effectiveStackMode === 'percent_100') {
    rawMin = 0;
    rawMax = 100;
  } else if (effectiveStackMode === 'stacked' && seriesToPlot.length > 1) {
    rawMin = Math.min(0, ...catStackNegTotals);
    rawMax = Math.max(1e-6, ...catStackPosTotals);
  } else {
    const minData = flatValues.length ? Math.min(...flatValues) : 0;
    const maxData = flatValues.length ? Math.max(...flatValues) : 1;
    const shouldZeroBase = cfg?.startFromZero ?? !isLineOrArea;
    rawMin = shouldZeroBase ? Math.min(0, minData) : minData - Math.abs(maxData - minData) * 0.08;
    rawMax = Math.max(rawMin + 1e-6, maxData * (isLineOrArea ? 1.06 : 1.04));
  }
  const domainMin = cfg?.yMin ?? rawMin;
  const domainMax = cfg?.yMax ?? rawMax;
  const valScale = createNumericScale([domainMin, domainMax], { startFromZero: false, scale: cfg?.yAxisScale ?? 'linear' });

  // Peak & Trough indices for highlightMaxMin
  let peakPt: { ci: number; si: number; val: number } | null = null;
  let troughPt: { ci: number; si: number; val: number } | null = null;
  if (cfg?.highlightMaxMin) {
    seriesToPlot.forEach((ser, si) => {
      ser.values.forEach((v, ci) => {
        if (!peakPt || v > peakPt.val) peakPt = { ci, si, val: v };
        if (!troughPt || v < troughPt.val) troughPt = { ci, si, val: v };
      });
    });
  }

  const avgMetric =
    cfg?.showAverageLine && flatValues.length > 0
      ? flatValues.reduce((a, b) => a + b, 0) / flatValues.length
      : null;

  const gridDash = strokeDashForStyle(cfg?.gridStyle ?? 'dashed');
  const yTickCnt = Math.max(2, Math.min(12, cfg?.yTickCount ?? 3));

  // -------------------------------------------------------------------------
  // 12A. Horizontal Bar / Stacked Horizontal / Grouped Horizontal SVG
  // -------------------------------------------------------------------------
  if (isHorizontalBar) {
    const dynH = cfg?.chartHeight ?? Math.max(200, Math.min(440, categories.length * 32 + 44));
    const maxLabelChars = Math.min(20, Math.max(6, ...categories.map((c) => Math.min(c.length, cfg?.xTickTruncate ?? 16))));
    const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 16 : maxLabelChars * 6.8 + 18);
    const padR = cfg?.plotPaddingRight ?? (cfg?.showDataLabels !== false ? 58 : 22);
    const padT = cfg?.plotPaddingTop ?? 12;
    const padB = cfg?.plotPaddingBottom ?? (cfg?.xAxisTitle ? 40 : 28);
    const plotW = Math.max(90, W - padL - padR);
    const plotH = Math.max(70, dynH - padT - padB);
    const xOfVal = (v: number) => padL + valScale.norm(v) * plotW;
    const zeroX = xOfVal(Math.max(valScale.min, Math.min(valScale.max, 0)));
    const rowSlotH = plotH / Math.max(1, categories.length);
    const barGapRatio = cfg?.barGap ?? 0.24;

    return wrapComposite(
      <div ref={stageRef} className="chart-stage">
        <svg viewBox={`0 0 ${W} ${dynH}`} style={{ height: dynH }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          {cfg?.showPlotBorder && <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" />}
          {/* Value Gridlines & Bottom Ticks */}
          {Array.from({ length: yTickCnt }, (_, ti) => {
            const t = ti / Math.max(1, yTickCnt - 1);
            const v = valScale.min + (valScale.max - valScale.min) * t;
            const gx = xOfVal(v);
            return (
              <g key={`hgrid-${ti}`}>
                {(cfg?.showVerticalGrid ?? cfg?.showHorizontalGrid !== false) && (
                  <line
                    x1={gx}
                    y1={padT}
                    x2={gx}
                    y2={padT + plotH}
                    stroke="var(--md-outline-variant)"
                    strokeDasharray={ti === 0 ? undefined : gridDash}
                    strokeOpacity={cfg?.gridOpacity ?? 0.5}
                  />
                )}
                {cfg?.showXAxis !== false && cfg?.showXTicks !== false && (
                  <text x={gx} y={padT + plotH + 17} textAnchor="middle" className="axis-tick">
                    {effectiveStackMode === 'percent_100'
                      ? `${Math.round(v)}%`
                      : formatMetricValue(v, cfg?.yAxisFormat ?? 'compact')}
                  </text>
                )}
              </g>
            );
          })}

          {/* Bars */}
          {categories.map((cat, ci) => {
            const yTopSlot = padT + ci * rowSlotH;
            const usableH = Math.min(cfg?.barMaxWidth ?? 36, rowSlotH * (1 - barGapRatio));
            const bandY = yTopSlot + (rowSlotH - usableH) / 2;
            const catTot = Math.max(1e-6, catStackPosTotals[ci]);
            let stackCursor = zeroX;

            return (
              <g key={`${cat}-${ci}`}>
                {cfg?.showYAxis !== false && (
                  <text
                    x={padL - 8}
                    y={yTopSlot + rowSlotH / 2 + 4}
                    textAnchor="end"
                    className="axis-tick"
                  >
                    {truncateText(cat, cfg?.xTickTruncate ?? 18)}
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

                  if (effectiveStackMode !== 'none' && seriesToPlot.length > 1) {
                    const segW = Math.abs(xOfVal(plotV) - zeroX);
                    bx = stackCursor;
                    bw = Math.max(1, segW);
                    stackCursor += segW;
                  } else {
                    const subH = usableH / seriesToPlot.length;
                    by = bandY + si * subH;
                    bh = Math.max(3, subH - (seriesToPlot.length > 1 ? 1.5 : 0));
                    const targetX = xOfVal(plotV);
                    bx = Math.min(zeroX, targetX);
                    bw = Math.max(2, Math.abs(targetX - zeroX));
                  }

                  const fmt = formatMetricValue(rawV, widget.format, widget.unit, fmtOpts);
                  const showLbl = cfg?.showDataLabels !== false && (seriesToPlot.length === 1 || effectiveStackMode === 'none');

                  return (
                    <g
                      key={ser.name}
                      className="chart-hit"
                      onClick={() =>
                        emitDatumClick(
                          seriesToPlot.length > 1 ? `${cat} · ${ser.name}` : cat,
                          rawV,
                          ser.name,
                          ser.rows[ci] ?? [cat, rawV],
                        )
                      }
                      onMouseEnter={() =>
                        handleHover({
                          x: bx + bw,
                          y: by + bh / 2,
                          title: seriesToPlot.length > 1 ? `${cat} · ${ser.name}` : cat,
                          detail: effectiveStackMode === 'percent_100' ? `${fmt} (${Math.round(plotV)}%)` : fmt,
                        })
                      }
                      onMouseLeave={() => handleHover(null)}
                    >
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        rx={cfg?.barRadius ?? 5}
                        fill={col}
                        fillOpacity={cfg?.fillOpacity ?? 0.9}
                      />
                      {showLbl && (
                        <text
                          x={cfg?.dataLabelPosition === 'inside' && bw > 44 ? bx + bw - 6 : bx + bw + 6}
                          y={by + bh / 2 + 3.5}
                          textAnchor={cfg?.dataLabelPosition === 'inside' && bw > 44 ? 'end' : 'start'}
                          fill={cfg?.dataLabelPosition === 'inside' && bw > 44 ? '#ffffff' : undefined}
                          className={cfg?.dataLabelPosition === 'inside' && bw > 44 ? undefined : 'axis-tick'}
                          style={{ fontSize: cfg?.dataLabelFontSize ?? 10.5, fontWeight: 600 }}
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
            <line
              x1={xOfVal(avgMetric)}
              y1={padT}
              x2={xOfVal(avgMetric)}
              y2={padT + plotH}
              stroke="var(--c-orange-accent)"
              strokeWidth={1.6}
              strokeDasharray="5 3"
            />
          )}
          {cfg?.referenceLines?.map((rl) => {
            const rx = xOfVal(toFiniteNum(rl.value));
            const rlCol = rl.color ?? 'var(--c-red-accent)';
            return (
              <g key={rl.id}>
                <line x1={rx} y1={padT} x2={rx} y2={padT + plotH} stroke={rlCol} strokeWidth={1.6} strokeDasharray={strokeDashForStyle(rl.style ?? 'dashed')} />
                {rl.label && <text x={rx + 4} y={padT + 11} className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>{rl.label}</text>}
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
  // 12B. Vertical Cartesian Engine:
  //      bar, column, grouped_bar, stacked_bar, line, area
  // -------------------------------------------------------------------------
  const directLabelsRightPad = isLineOrArea && cfg?.directLineLabels ? 74 : 0;
  const rotDeg = cfg?.xTickRotation ?? 0;
  const extraRotPad = rotDeg !== 0 ? 18 : 0;
  const padL = cfg?.plotPaddingLeft ?? (cfg?.showYAxis === false ? 18 : cfg?.yAxisPosition === 'right' ? 18 : 54);
  const padR = cfg?.plotPaddingRight ?? (cfg?.yAxisPosition === 'right' ? 54 : 16) + directLabelsRightPad;
  const padT = cfg?.plotPaddingTop ?? 16;
  const padB = cfg?.plotPaddingBottom ?? 32 + extraRotPad + (cfg?.xAxisTitle ? 14 : 0);
  const plotW = Math.max(100, W - padL - padR);
  const plotH = Math.max(80, H - padT - padB);

  const yOfVal = (v: number) => padT + (1 - valScale.norm(v)) * plotH;
  const zeroY = yOfVal(Math.max(valScale.min, Math.min(valScale.max, 0)));

  const maxXTicks = cfg?.xTickMaxCount ?? Math.max(3, Math.floor(plotW / 72));
  const xTickStep = categories.length <= maxXTicks ? 1 : Math.ceil(categories.length / maxXTicks);
  const slotW = plotW / Math.max(1, categories.length);
  const xCenterOf = (ci: number) =>
    isLineOrArea
      ? padL + (categories.length <= 1 ? plotW / 2 : (ci / (categories.length - 1)) * plotW)
      : padL + (ci + 0.5) * slotW;

  const regLine =
    cfg?.showTrendline && categories.length >= 2 && seriesToPlot[0]
      ? computeLinearRegression(seriesToPlot[0].values.map((v, i) => ({ x: i, y: v })))
      : null;

  return wrapComposite(
    <div ref={stageRef} className="chart-stage">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        <defs>
          {seriesToPlot.map((ser) => {
            const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
            const col = resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
            return (
              <linearGradient key={ser.name} id={`${areaGradId}-${fullSi}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={col} stopOpacity={cfg?.fillOpacity ?? (widget.kind === 'area' ? 0.32 : 0.92)} />
                <stop offset="100%" stopColor={col} stopOpacity={widget.kind === 'area' ? 0.03 : 0.45} />
              </linearGradient>
            );
          })}
        </defs>

        {cfg?.showPlotBorder && (
          <rect x={padL} y={padT} width={plotW} height={plotH} fill="none" stroke="var(--md-outline-variant)" />
        )}

        {/* Reference Bands */}
        {cfg?.referenceBands?.map((b) => {
          const bCol = b.color ?? 'var(--c-teal-accent)';
          const byTop = yOfVal(Math.max(b.from, b.to));
          const byBot = yOfVal(Math.min(b.from, b.to));
          return (
            <g key={b.id}>
              <rect x={padL} y={byTop} width={plotW} height={Math.max(2, byBot - byTop)} fill={bCol} fillOpacity={0.12} />
              {b.label && (
                <text x={padL + 6} y={byTop + 12} className="axis-tick" style={{ fill: bCol, fontSize: 10, fontWeight: 600 }}>
                  {b.label}
                </text>
              )}
            </g>
          );
        })}

        {/* Horizontal Gridlines & Y-Axis Ticks */}
        {Array.from({ length: yTickCnt }, (_, ti) => {
          const t = ti / Math.max(1, yTickCnt - 1);
          const val = valScale.min + (valScale.max - valScale.min) * t;
          const gy = yOfVal(val);
          return (
            <g key={`yg-${ti}`}>
              {cfg?.showHorizontalGrid !== false && (
                <line
                  x1={padL}
                  y1={gy}
                  x2={W - padR}
                  y2={gy}
                  stroke="var(--md-outline-variant)"
                  strokeDasharray={ti === 0 ? undefined : gridDash}
                  strokeOpacity={ti === 0 ? 0.75 : (cfg?.gridOpacity ?? 0.5)}
                />
              )}
              {cfg?.showYAxis !== false && cfg?.showYTicks !== false && (
                <text
                  x={cfg?.yAxisPosition === 'right' ? W - padR + 8 : padL - 8}
                  y={gy + 4}
                  textAnchor={cfg?.yAxisPosition === 'right' ? 'start' : 'end'}
                  className="axis-tick"
                >
                  {effectiveStackMode === 'percent_100'
                    ? `${Math.round(val)}%`
                    : formatMetricValue(val, cfg?.yAxisFormat ?? 'compact')}
                </text>
              )}
            </g>
          );
        })}

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
                strokeOpacity={cfg?.gridOpacity ?? 0.42}
              />
            );
          })}

        {/* LINE & AREA SERIES */}
        {isLineOrArea &&
          (() => {
            const cumBelow = new Array(categories.length).fill(0);
            return seriesToPlot.map((ser, si) => {
              const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
              const col = resolveSeriesColor(fullSi, cfg, allSeries.length === 1 ? widget.color : undefined);
              const dash = strokeDashForStyle(cfg?.lineStyle ?? (si > 0 && !widget.seriesField ? 'dashed' : 'solid'));

              const topPts = categories.map((cat, ci) => {
                const rawV = ser.values[ci] ?? 0;
                const tot = Math.max(1e-6, catStackPosTotals[ci]);
                let plotTop = rawV;
                let plotBot = Math.max(valScale.min, 0);
                if (effectiveStackMode === 'stacked' && seriesToPlot.length > 1) {
                  plotBot = cumBelow[ci];
                  plotTop = cumBelow[ci] + Math.max(0, rawV);
                  cumBelow[ci] = plotTop;
                } else if (effectiveStackMode === 'percent_100' && seriesToPlot.length > 1) {
                  plotBot = cumBelow[ci];
                  plotTop = cumBelow[ci] + (Math.max(0, rawV) / tot) * 100;
                  cumBelow[ci] = plotTop;
                }
                return {
                  x: xCenterOf(ci),
                  y: yOfVal(plotTop),
                  yBot: yOfVal(plotBot),
                  rawV,
                  cat,
                  ci,
                };
              });

              const curve = cfg?.curveType ?? 'linear';
              const linePath = buildCurvePath(topPts, curve);
              const revBot = [...topPts].reverse().map((p) => ({ x: p.x, y: p.yBot }));
              const areaPath =
                topPts.length > 1
                  ? effectiveStackMode !== 'none' && seriesToPlot.length > 1
                    ? `${linePath} ${buildCurvePath(revBot, curve).replace(/^M/, 'L')} Z`
                    : `${linePath} L ${topPts[topPts.length - 1].x.toFixed(1)} ${(padT + plotH).toFixed(1)} L ${topPts[0].x.toFixed(1)} ${(padT + plotH).toFixed(1)} Z`
                  : '';

              const showPts = cfg?.showMarkers !== false;
              const mShape = cfg?.markerShape ?? 'circle';
              const mSize = cfg?.markerSize ?? 4.25;
              const lastPt = topPts[topPts.length - 1];

              return (
                <g key={ser.name}>
                  {widget.kind === 'area' && areaPath && (
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
                          : (cfg?.fillOpacity ?? 0.34)
                      }
                    />
                  )}
                  {topPts.length > 1 && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke={col}
                      strokeWidth={cfg?.strokeWidth ?? 2.5}
                      strokeDasharray={dash}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                  {topPts.map((pt) => {
                    const fmt = formatMetricValue(pt.rawV, widget.format, widget.unit, fmtOpts);
                    const isPeak = peakPt?.ci === pt.ci && peakPt?.si === si;
                    const isTrough = troughPt?.ci === pt.ci && troughPt?.si === si;
                    return (
                      <g
                        key={pt.ci}
                        className="chart-hit"
                        onClick={() =>
                          emitDatumClick(
                            seriesToPlot.length > 1 ? `${pt.cat} · ${ser.name}` : pt.cat,
                            pt.rawV,
                            ser.name,
                            ser.rows[pt.ci] ?? [pt.cat, pt.rawV],
                          )
                        }
                        onMouseEnter={() =>
                          handleHover({
                            x: pt.x,
                            y: pt.y,
                            title: seriesToPlot.length > 1 ? `${pt.cat} · ${ser.name}` : pt.cat,
                            detail: fmt,
                          })
                        }
                        onMouseLeave={() => handleHover(null)}
                      >
                        {/* Invisible generous hit target even when markers are hidden */}
                        <circle cx={pt.x} cy={pt.y} r={9} fill="transparent" />
                        {showPts &&
                          (mShape === 'circle' ? (
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r={mSize}
                              fill={col}
                              stroke="var(--md-surface-container-lowest)"
                              strokeWidth={2}
                            />
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
                            r={mSize + 4}
                            fill="none"
                            stroke={isPeak ? 'var(--c-green-accent)' : 'var(--c-red-accent)'}
                            strokeWidth={2}
                          />
                        )}
                        {cfg?.showDataLabels && (
                          <text
                            x={pt.x}
                            y={pt.y - mSize - 5}
                            textAnchor="middle"
                            className="axis-tick"
                            style={{ fontSize: cfg?.dataLabelFontSize ?? 10, fontWeight: 600 }}
                          >
                            {formatDataLabelText(pt.cat, pt.rawV, catStackPosTotals.reduce((a, b) => a + b, 0), widget)}
                          </text>
                        )}
                      </g>
                    );
                  })}
                  {cfg?.directLineLabels && lastPt && (
                    <text
                      x={lastPt.x + 7}
                      y={lastPt.y + 4}
                      className="axis-tick"
                      style={{ fill: col, fontWeight: 700, fontSize: 10.5 }}
                    >
                      {truncateText(ser.name, 11)}
                    </text>
                  )}
                </g>
              );
            });
          })()}

        {/* VERTICAL BAR / COLUMN / GROUPED / STACKED SERIES */}
        {!isLineOrArea &&
          categories.map((cat, ci) => {
            const cx = xCenterOf(ci);
            const barGapRatio = cfg?.barGap ?? 0.24;
            const groupW = Math.min(cfg?.barMaxWidth ?? 56, slotW * (1 - barGapRatio));
            const catTot = Math.max(1e-6, catStackPosTotals[ci]);
            let posStackVal = 0;
            let negStackVal = 0;

            return (
              <g key={`barcat-${cat}-${ci}`}>
                {seriesToPlot.map((ser, si) => {
                  const fullSi = Math.max(0, allSeries.findIndex((a) => a.name === ser.name));
                  const rawV = ser.values[ci] ?? 0;
                  const col =
                    cfg?.colorBy === 'category' && seriesToPlot.length === 1
                      ? resolveSeriesColor(ci, cfg, widget.color)
                      : resolveSeriesColor(fullSi, cfg, seriesToPlot.length === 1 ? widget.color : undefined);

                  let bx = cx - groupW / 2;
                  let bw = groupW;
                  let by = zeroY;
                  let bh = 2;
                  let pctShare = 0;

                  if (effectiveStackMode !== 'none' && seriesToPlot.length > 1) {
                    if (effectiveStackMode === 'percent_100') {
                      pctShare = (Math.max(0, rawV) / catTot) * 100;
                      const nextStack = posStackVal + pctShare;
                      by = yOfVal(nextStack);
                      bh = Math.max(1, yOfVal(posStackVal) - by);
                      posStackVal = nextStack;
                    } else if (rawV >= 0) {
                      const nextStack = posStackVal + rawV;
                      by = yOfVal(nextStack);
                      bh = Math.max(1, yOfVal(posStackVal) - by);
                      posStackVal = nextStack;
                    } else {
                      const nextStack = negStackVal + rawV;
                      by = yOfVal(negStackVal);
                      bh = Math.max(1, yOfVal(nextStack) - by);
                      negStackVal = nextStack;
                    }
                  } else {
                    const subW = groupW / seriesToPlot.length;
                    bx = cx - groupW / 2 + si * subW;
                    bw = Math.max(2, subW - (seriesToPlot.length > 1 ? 2 : 0));
                    const targetY = yOfVal(rawV);
                    by = Math.min(zeroY, targetY);
                    bh = Math.max(2, Math.abs(zeroY - targetY));
                  }

                  const fmt = formatMetricValue(rawV, widget.format, widget.unit, fmtOpts);
                  const isPeak = peakPt?.ci === ci && peakPt?.si === si;
                  const isTrough = troughPt?.ci === ci && troughPt?.si === si;

                  return (
                    <g
                      key={ser.name}
                      className="chart-hit"
                      onClick={() =>
                        emitDatumClick(
                          seriesToPlot.length > 1 ? `${cat} · ${ser.name}` : cat,
                          rawV,
                          ser.name,
                          ser.rows[ci] ?? [cat, rawV],
                        )
                      }
                      onMouseEnter={() =>
                        handleHover({
                          x: bx + bw / 2,
                          y: by,
                          title: seriesToPlot.length > 1 ? `${cat} · ${ser.name}` : cat,
                          detail: effectiveStackMode === 'percent_100' ? `${fmt} (${Math.round(pctShare)}%)` : fmt,
                        })
                      }
                      onMouseLeave={() => handleHover(null)}
                    >
                      <rect
                        x={bx}
                        y={by}
                        width={bw}
                        height={bh}
                        rx={cfg?.barRadius ?? 5}
                        fill={cfg?.gradientFill ? `url(#${areaGradId}-${fullSi})` : col}
                        fillOpacity={cfg?.fillOpacity ?? 0.9}
                        stroke={
                          isPeak
                            ? 'var(--c-green-accent)'
                            : isTrough
                              ? 'var(--c-red-accent)'
                              : undefined
                        }
                        strokeWidth={isPeak || isTrough ? 2 : undefined}
                      />
                      {cfg?.showDataLabels && bh > 8 && (
                        <text
                          x={bx + bw / 2}
                          y={
                            cfg.dataLabelPosition === 'inside' || cfg.dataLabelPosition === 'center'
                              ? by + bh / 2 + 4
                              : by - 5
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
                              : 'axis-tick'
                          }
                          style={{ fontSize: cfg?.dataLabelFontSize ?? 10, fontWeight: 600 }}
                        >
                          {effectiveStackMode === 'percent_100'
                            ? `${Math.round(pctShare)}%`
                            : formatDataLabelText(cat, rawV, catStackPosTotals.reduce((a, b) => a + b, 0), widget)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}

        {/* X-Axis Tick Labels */}
        {cfg?.showXAxis !== false &&
          cfg?.showXTicks !== false &&
          categories.map((cat, ci) => {
            if (ci % xTickStep !== 0 && ci !== categories.length - 1) return null;
            const lx = xCenterOf(ci);
            const ly = padT + plotH + 18;
            const textStr = truncateText(cat, cfg?.xTickTruncate ?? 11);
            const anchor =
              rotDeg < 0
                ? 'end'
                : rotDeg > 0
                  ? 'start'
                  : isLineOrArea && ci === 0 && categories.length > 3
                    ? 'start'
                    : isLineOrArea && ci === categories.length - 1 && categories.length > 3
                      ? 'end'
                      : 'middle';
            return (
              <text
                key={`xlbl-${cat}-${ci}`}
                x={lx}
                y={ly}
                textAnchor={anchor}
                transform={rotDeg !== 0 ? `rotate(${rotDeg} ${lx} ${ly})` : undefined}
                className="axis-tick"
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
            strokeWidth={1.8}
            strokeDasharray="6 4"
          />
        )}

        {/* Average Line */}
        {avgMetric !== null && effectiveStackMode === 'none' && (
          <g>
            <line
              x1={padL}
              y1={yOfVal(avgMetric)}
              x2={W - padR}
              y2={yOfVal(avgMetric)}
              stroke="var(--c-orange-accent)"
              strokeWidth={1.6}
              strokeDasharray="5 3"
            />
            <text
              x={W - padR - 4}
              y={yOfVal(avgMetric) - 4}
              textAnchor="end"
              className="axis-tick"
              style={{ fill: 'var(--c-orange-accent)', fontWeight: 600 }}
            >
              Avg {formatMetricValue(avgMetric, widget.format, widget.unit, fmtOpts)}
            </text>
          </g>
        )}

        {/* Custom Reference Lines */}
        {cfg?.referenceLines?.map((rl) => {
          const rlCol = rl.color ?? 'var(--c-red-accent)';
          const ry = yOfVal(toFiniteNum(rl.value));
          return (
            <g key={rl.id}>
              <line
                x1={padL}
                y1={ry}
                x2={W - padR}
                y2={ry}
                stroke={rlCol}
                strokeWidth={1.6}
                strokeDasharray={strokeDashForStyle(rl.style ?? 'dashed')}
              />
              {rl.label && (
                <text x={W - padR - 4} y={ry - 4} textAnchor="end" className="axis-tick" style={{ fill: rlCol, fontWeight: 600 }}>
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
            targetIdx >= 0 && seriesToPlot[0]
              ? yOfVal(seriesToPlot[0].values[targetIdx] ?? 0) - 18
              : padT + (ann.yRatio ?? 0.22) * plotH;
          const aCol = ann.color ?? 'var(--c-purple-accent)';
          return (
            <g key={ann.id}>
              {targetIdx >= 0 && (
                <line x1={ax} y1={ay + 8} x2={ax} y2={ay + 18} stroke={aCol} strokeWidth={1.5} />
              )}
              <rect
                x={Math.max(4, Math.min(W - 116, ax - 56))}
                y={Math.max(2, ay - 12)}
                width={112}
                height={20}
                rx={6}
                fill="var(--md-surface-container-highest)"
                stroke={aCol}
                strokeWidth={1.2}
              />
              <text
                x={Math.max(60, Math.min(W - 60, ax))}
                y={Math.max(15, ay + 1)}
                textAnchor="middle"
                className="axis-tick"
                style={{ fill: 'var(--md-on-surface)', fontWeight: 600, fontSize: 9.5 }}
              >
                {truncateText(ann.text, 18)}
              </text>
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
    allSeries.length > 1,
  );
}
