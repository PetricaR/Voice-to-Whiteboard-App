import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { QueryExecutionResult } from '../../data/sqlEngine';
import { formatMetricValue, type DashboardWidget } from '../../engine/dashboard';
import type { ColorName } from '../../engine/types';

export interface InspectedDatum {
  widget: DashboardWidget;
  label: string;
  value: unknown;
  formattedValue: string;
  column: string;
  row: unknown[];
}

const SERIES_COLORS: ColorName[] = ['blue', 'teal', 'purple', 'green', 'orange', 'pink', 'yellow', 'red'];

const colorVar = (c: ColorName | undefined, idx = 0) =>
  `var(--c-${c ?? SERIES_COLORS[idx % SERIES_COLORS.length]}-accent)`;

const containerVar = (c: ColorName | undefined, idx = 0) =>
  `var(--c-${c ?? SERIES_COLORS[idx % SERIES_COLORS.length]}-container)`;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

function toNum(v: unknown): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const cleaned = v.replace(/[$,%€\s,]/g, '');
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function detectColumns(widget: DashboardWidget, cols: string[], rows: unknown[][]) {
  if (cols.length === 0) return { xIdx: 0, yIndices: [0], compIdx: -1, seriesIdx: -1 };
  const xIdx = widget.xField ? Math.max(0, cols.indexOf(widget.xField)) : 0;
  const seriesIdx = widget.seriesField ? cols.indexOf(widget.seriesField) : -1;
  const compIdx = widget.comparisonField ? cols.indexOf(widget.comparisonField) : -1;

  let yIndices: number[] = [];
  if (widget.yFields && widget.yFields.length > 0) {
    yIndices = widget.yFields.map((f) => cols.indexOf(f)).filter((i) => i >= 0);
  }
  if (yIndices.length === 0) {
    // Pick numeric columns other than xIdx / seriesIdx / compIdx (KPI cards have no X-axis dimension when col 0 is numeric)
    const sample = rows[0] ?? [];
    cols.forEach((_, idx) => {
      if (widget.kind !== 'kpi' && idx === xIdx && cols.length > 1) return;
      if (idx === seriesIdx || idx === compIdx) return;
      const val = sample[idx];
      if (typeof val === 'number' || (typeof val === 'string' && val.trim() !== '' && !Number.isNaN(Number(val)))) {
        yIndices.push(idx);
      }
    });
  }
  if (yIndices.length === 0) {
    yIndices = [Math.min(1, cols.length - 1)];
  }
  return { xIdx, yIndices, compIdx, seriesIdx };
}

function SortableDataTable({
  widget,
  result,
  onInspectDatum,
}: {
  widget: DashboardWidget;
  result: QueryExecutionResult;
  onInspectDatum: (d: InspectedDatum) => void;
}) {
  const captionId = useId();
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const [sortState, setSortState] = useState<{ col: number; dir: 'ascending' | 'descending' } | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Reset visual sort indicator when underlying SQL rows change
  useEffect(() => {
    setSortState(null);
  }, [result.executedAt]);

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

  return (
    <div tabIndex={0} role="region" aria-labelledby={captionId} className="table-wrapper">
      <div role="status" className="visually-hidden">{announcement}</div>
      <table className="dash-table">
        <caption id={captionId} className="visually-hidden">{widget.title}</caption>
        <thead>
          <tr>
            {result.columns.map((col, idx) => {
              const isSorted = sortState?.col === idx;
              return (
                <th
                  key={col}
                  scope="col"
                  {...(isSorted ? { 'aria-sort': sortState.dir } : {})}
                >
                  <button type="button" className="th-sort-btn" onClick={() => handleSort(idx)}>
                    <span>{col}</span>
                    <span aria-hidden="true" className="sort-glyph">
                      {isSorted ? (sortState.dir === 'ascending' ? '↑' : '↓') : '↕'}
                    </span>
                  </button>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody ref={tbodyRef}>
          {result.rows.slice(0, 120).map((row, rIdx) => (
            <tr key={rIdx}>
              {result.columns.map((col, cIdx) => {
                const raw = row[cIdx];
                const isNum = typeof raw === 'number';
                const formatted = isNum && cIdx > 0 ? formatMetricValue(raw, widget.format) : (raw == null ? '—' : String(raw));
                return (
                  <td
                    key={col}
                    data-label={col}
                    data-value={raw == null ? '' : String(raw)}
                    className={isNum ? 'num-cell' : undefined}
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

export function ChartRenderer({
  widget,
  result,
  loading,
  error,
  onInspectDatum,
}: {
  widget: DashboardWidget;
  result?: QueryExecutionResult;
  loading?: boolean;
  error?: string;
  onInspectDatum: (datum: InspectedDatum) => void;
}) {
  const cols = result?.columns ?? [];
  const rows = result?.rows ?? [];
  const { xIdx, yIndices, compIdx } = useMemo(() => detectColumns(widget, cols, rows), [widget, cols, rows]);

  if (loading && !result) {
    return <div className="widget-skeleton" aria-busy="true">Running SQL query…</div>;
  }
  if (error) {
    return (
      <div className="widget-error" role="alert">
        <strong>Query error:</strong> {error}
      </div>
    );
  }
  if (!result || rows.length === 0) {
    return <div className="widget-empty">No rows returned for current filter selection.</div>;
  }

  // 1. KPI Headline Metric Card
  if (widget.kind === 'kpi') {
    const valColIdx = yIndices[0] ?? Math.max(0, cols.length - 1);
    const firstRow = rows[0];
    const rawVal = firstRow[valColIdx];
    const formatted = formatMetricValue(rawVal, widget.format, widget.unit);
    const deltaCol = compIdx >= 0 ? compIdx : cols.length > 1 && valColIdx === 0 ? 1 : valColIdx > 0 && cols.length > valColIdx + 1 ? valColIdx + 1 : -1;
    const rawDelta = deltaCol >= 0 ? firstRow[deltaCol] : undefined;
    const deltaNum = rawDelta !== undefined ? toNum(rawDelta) : null;

    return (
      <div className="kpi-body">
        <button
          type="button"
          className="kpi-number-btn"
          onClick={() =>
            onInspectDatum({
              widget,
              label: widget.title,
              value: rawVal,
              formattedValue: formatted,
              column: cols[valColIdx] ?? 'value',
              row: firstRow,
            })
          }
          title="Click to inspect the exact SQL query behind this figure"
        >
          <span className="kpi-primary-value" style={{ color: widget.color ? colorVar(widget.color) : undefined }}>
            {formatted}
          </span>
        </button>
        {deltaNum !== null && rawDelta !== null && rawDelta !== '' && (
          <div className={`kpi-delta ${deltaNum >= 0 ? 'up' : 'down'}`}>
            <span>{deltaNum >= 0 ? '▲' : '▼'} {typeof rawDelta === 'number' ? `${Math.abs(deltaNum).toFixed(1)}%` : String(rawDelta)}</span>
            {cols[deltaCol] && <small>{cols[deltaCol].replace(/_/g, ' ')}</small>}
          </div>
        )}
      </div>
    );
  }

  // 2. Interactive Sortable & Container-Responsive Data Table
  if (widget.kind === 'table') {
    return <SortableDataTable widget={widget} result={result} onInspectDatum={onInspectDatum} />;
  }

  const primaryY = yIndices[0] ?? Math.min(1, cols.length - 1);
  const items = rows.slice(0, 24).map((r, idx) => ({
    label: String(r[xIdx] ?? `#${idx + 1}`),
    value: toNum(r[primaryY]),
    secondValue: yIndices[1] !== undefined ? toNum(r[yIndices[1]]) : undefined,
    raw: r[primaryY],
    row: r,
  }));
  const maxVal = Math.max(1, ...items.map((it) => Math.abs(it.value) + (widget.kind === 'stacked_bar' && it.secondValue ? Math.abs(it.secondValue) : 0)));

  // 3. Horizontal Bar / Funnel
  if (widget.kind === 'horizontal_bar' || widget.kind === 'funnel') {
    return (
      <div className={`hbar-list ${widget.kind === 'funnel' ? 'is-funnel' : ''}`}>
        {items.slice(0, 10).map((it, idx) => {
          const pct = Math.max(3, Math.min(100, (Math.abs(it.value) / maxVal) * 100));
          const formatted = formatMetricValue(it.value, widget.format, widget.unit);
          const stepDrop = widget.kind === 'funnel' && idx > 0 && items[0].value > 0
            ? `${Math.round((it.value / items[0].value) * 100)}%`
            : null;
          return (
            <button
              key={`${it.label}-${idx}`}
              type="button"
              className="hbar-row"
              onClick={() =>
                onInspectDatum({
                  widget,
                  label: it.label,
                  value: it.raw,
                  formattedValue: formatted,
                  column: cols[primaryY] ?? 'value',
                  row: it.row,
                })
              }
            >
              <span className="hbar-label" title={it.label}>{it.label}</span>
              <span className="hbar-track">
                <span
                  className="hbar-fill"
                  style={{
                    width: `${pct}%`,
                    background: colorVar(widget.color, idx),
                  }}
                />
              </span>
              <span className="hbar-val">
                {formatted}
                {stepDrop && <small className="funnel-pct"> ({stepDrop})</small>}
              </span>
            </button>
          );
        })}
      </div>
    );
  }

  // 4. Donut / Pie Chart
  if (widget.kind === 'donut' || widget.kind === 'pie') {
    const total = Math.max(1, items.reduce((s, it) => s + Math.max(0, it.value), 0));
    const cx = 95;
    const cy = 95;
    const rOuter = 78;
    const rInner = widget.kind === 'donut' ? 46 : 0;
    let angle = -Math.PI / 2;

    return (
      <div className="donut-layout">
        <svg viewBox="0 0 190 190" className="chart-svg donut-svg" role="img" aria-label={widget.title}>
          {items.slice(0, 8).map((it, idx) => {
            const slice = (Math.max(0, it.value) / total) * Math.PI * 2;
            const start = angle;
            const end = angle + Math.max(0.02, slice);
            angle += slice;
            const x1 = cx + rOuter * Math.cos(start);
            const y1 = cy + rOuter * Math.sin(start);
            const x2 = cx + rOuter * Math.cos(end);
            const y2 = cy + rOuter * Math.sin(end);
            const large = slice > Math.PI ? 1 : 0;
            const d = rInner > 0
              ? [
                  `M ${x1} ${y1}`,
                  `A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2}`,
                  `L ${cx + rInner * Math.cos(end)} ${cy + rInner * Math.sin(end)}`,
                  `A ${rInner} ${rInner} 0 ${large} 0 ${cx + rInner * Math.cos(start)} ${cy + rInner * Math.sin(start)}`,
                  'Z',
                ].join(' ')
              : `M ${cx} ${cy} L ${x1} ${y1} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2} ${y2} Z`;
            const formatted = formatMetricValue(it.value, widget.format, widget.unit);
            return (
              <path
                key={`${it.label}-${idx}`}
                d={d}
                fill={colorVar(undefined, idx)}
                stroke="var(--md-surface-container-lowest)"
                strokeWidth={2}
                className="chart-hit"
                onClick={() =>
                  onInspectDatum({
                    widget,
                    label: it.label,
                    value: it.raw,
                    formattedValue: formatted,
                    column: cols[primaryY] ?? 'value',
                    row: it.row,
                  })
                }
              >
                <title>{`${it.label}: ${formatted} (${Math.round((it.value / total) * 100)}%)`}</title>
              </path>
            );
          })}
          {widget.kind === 'donut' && (
            <text x={cx} y={cy + 5} textAnchor="middle" className="donut-center-text">
              {formatMetricValue(total, widget.format)}
            </text>
          )}
        </svg>
        <div className="donut-legend">
          {items.slice(0, 8).map((it, idx) => {
            const formatted = formatMetricValue(it.value, widget.format, widget.unit);
            return (
              <button
                key={`${it.label}-${idx}`}
                type="button"
                className="legend-item-btn"
                onClick={() =>
                  onInspectDatum({
                    widget,
                    label: it.label,
                    value: it.raw,
                    formattedValue: formatted,
                    column: cols[primaryY] ?? 'value',
                    row: it.row,
                  })
                }
              >
                <span className="legend-dot" style={{ background: colorVar(undefined, idx) }} />
                <span className="legend-name">{it.label}</span>
                <span className="legend-val">{formatted}</span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // 5. Heatmap Matrix
  if (widget.kind === 'heatmap') {
    return (
      <div className="heatmap-grid">
        {items.slice(0, 18).map((it, idx) => {
          const intensity = Math.max(0.14, Math.min(1, Math.abs(it.value) / maxVal));
          const formatted = formatMetricValue(it.value, widget.format, widget.unit);
          return (
            <button
              key={`${it.label}-${idx}`}
              type="button"
              className="heatmap-cell"
              style={{
                background: `color-mix(in srgb, ${colorVar(widget.color ?? 'blue')} ${Math.round(intensity * 82)}%, var(--md-surface-container))`,
              }}
              onClick={() =>
                onInspectDatum({
                  widget,
                  label: it.label,
                  value: it.raw,
                  formattedValue: formatted,
                  column: cols[primaryY] ?? 'value',
                  row: it.row,
                })
              }
            >
              <span className="hm-label">{it.label}</span>
              <strong className="hm-val">{formatted}</strong>
            </button>
          );
        })}
      </div>
    );
  }

  // 6. SVG Cartesian Charts: line, area, scatter, bar, stacked_bar
  const W = 560;
  const H = 220;
  const padL = 54;
  const padR = 18;
  const padT = 18;
  const padB = 38;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  if (widget.kind === 'line' || widget.kind === 'area' || widget.kind === 'scatter') {
    const secondYIdx = yIndices[1];
    const pts1 = items.map((it, i) => ({
      x: padL + (items.length === 1 ? plotW / 2 : (i / (items.length - 1)) * plotW),
      y: padT + plotH - (Math.max(0, it.value) / maxVal) * plotH,
      it,
    }));
    const pts2 = secondYIdx !== undefined
      ? items.map((it, i) => ({
          x: padL + (items.length === 1 ? plotW / 2 : (i / (items.length - 1)) * plotW),
          y: padT + plotH - (Math.max(0, it.secondValue ?? 0) / maxVal) * plotH,
          it,
        }))
      : null;

    const linePath = pts1.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
    const areaPath = pts1.length > 0
      ? `${linePath} L ${pts1[pts1.length - 1].x.toFixed(1)} ${padT + plotH} L ${pts1[0].x.toFixed(1)} ${padT + plotH} Z`
      : '';

    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.5, 1].map((t) => {
          const gy = padT + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.55} />
              <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
                {formatMetricValue(maxVal * t, 'compact')}
              </text>
            </g>
          );
        })}
        {widget.kind === 'area' && pts1.length > 1 && (
          <path d={areaPath} fill={containerVar(widget.color ?? 'blue')} fillOpacity={0.55} />
        )}
        {widget.kind !== 'scatter' && pts1.length > 1 && (
          <path d={linePath} fill="none" stroke={colorVar(widget.color ?? 'blue')} strokeWidth={2.75} strokeLinejoin="round" />
        )}
        {pts2 && pts2.length > 1 && (
          <path
            d={pts2.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')}
            fill="none"
            stroke={colorVar('teal')}
            strokeWidth={2.25}
            strokeDasharray="5 3"
          />
        )}
        {pts1.map((p, idx) => {
          const formatted = formatMetricValue(p.it.value, widget.format, widget.unit);
          const showLabel = items.length <= 8 || idx % Math.ceil(items.length / 6) === 0;
          return (
            <g key={`${p.it.label}-${idx}`}>
              <circle
                cx={p.x}
                cy={p.y}
                r={widget.kind === 'scatter' ? 6.5 : 4.5}
                fill={colorVar(widget.color ?? 'blue')}
                stroke="var(--md-surface-container-lowest)"
                strokeWidth={1.5}
                className="chart-hit"
                onClick={() =>
                  onInspectDatum({
                    widget,
                    label: p.it.label,
                    value: p.it.raw,
                    formattedValue: formatted,
                    column: cols[primaryY] ?? 'value',
                    row: p.it.row,
                  })
                }
              >
                <title>{`${p.it.label}: ${formatted}`}</title>
              </circle>
              {showLabel && (
                <text x={p.x} y={H - 12} textAnchor="middle" className="axis-tick">
                  {p.it.label.slice(0, 10)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  // Default: Vertical Bar & Stacked Bar
  const gap = Math.max(6, Math.min(18, Math.floor(plotW / (items.length * 3.5))));
  const barW = Math.max(10, (plotW - gap * (items.length - 1)) / items.length);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
      {[0, 0.5, 1].map((t) => {
        const gy = padT + plotH * (1 - t);
        return (
          <g key={t}>
            <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.55} />
            <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
              {formatMetricValue(maxVal * t, 'compact')}
            </text>
          </g>
        );
      })}
      {items.map((it, idx) => {
        const h1 = Math.max(3, (Math.max(0, it.value) / maxVal) * plotH);
        const h2 = widget.kind === 'stacked_bar' && it.secondValue ? Math.max(0, (it.secondValue / maxVal) * plotH) : 0;
        const bx = padL + idx * (barW + gap);
        const by1 = padT + plotH - h1;
        const formatted = formatMetricValue(it.value, widget.format, widget.unit);
        const showLabel = items.length <= 9 || idx % Math.ceil(items.length / 6) === 0;
        return (
          <g key={`${it.label}-${idx}`}>
            <rect
              x={bx}
              y={by1}
              width={barW}
              height={h1}
              rx={5}
              fill={colorVar(widget.color, idx)}
              className="chart-hit"
              onClick={() =>
                onInspectDatum({
                  widget,
                  label: it.label,
                  value: it.raw,
                  formattedValue: formatted,
                  column: cols[primaryY] ?? 'value',
                  row: it.row,
                })
              }
            >
              <title>{`${it.label}: ${formatted}`}</title>
            </rect>
            {h2 > 0 && (
              <rect
                x={bx}
                y={by1 - h2}
                width={barW}
                height={h2}
                rx={5}
                fill={colorVar('teal')}
                className="chart-hit"
                onClick={() =>
                  onInspectDatum({
                    widget,
                    label: it.label,
                    value: it.secondValue,
                    formattedValue: formatMetricValue(it.secondValue, widget.format, widget.unit),
                    column: cols[yIndices[1]] ?? 'series_2',
                    row: it.row,
                  })
                }
              />
            )}
            {showLabel && (
              <text x={bx + barW / 2} y={H - 12} textAnchor="middle" className="axis-tick">
                {it.label.slice(0, 10)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
