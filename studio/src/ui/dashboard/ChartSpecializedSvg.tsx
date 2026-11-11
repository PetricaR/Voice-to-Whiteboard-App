import { useId, type ReactElement } from 'react';
import {
  formatMetricValue,
  type DashboardWidget,
} from '../../engine/dashboard';
import {
  buildCurvePath,
  computeBoxPlotStats,
  computeKdeCurve,
  layoutNetworkGraph,
  layoutOrgTree,
  layoutSankeyDiagram,
  layoutSquarifiedTreemap,
  pivotMultiSeries,
  resolveSeriesColor,
  toFiniteNum,
} from './chartLayouts';
import {
  MAP_SCOPE_VIEWBOX,
  WORLD_REGIONS,
  matchMacroRegion,
  projectGeo,
  resolveLocationCoords,
} from './geoPaths';

export interface SpecializedChartProps {
  widget: DashboardWidget;
  cols: string[];
  rows: unknown[][];
  xIdx: number;
  yIndices: number[];
  seriesIdx: number;
  compIdx: number;
  width: number;
  height: number;
  mutedSeries: Set<string>;
  onInspect: (label: string, val: unknown, colName: string, row: unknown[]) => void;
  onHover: (tip: { x: number; y: number; title: string; detail: string } | null) => void;
}

function findColIndex(cols: string[], name: string | undefined, fallback = -1): number {
  if (!name) return fallback;
  const idx = cols.indexOf(name);
  return idx >= 0 ? idx : fallback;
}

export function renderDistributionSvg(p: SpecializedChartProps) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, width: W, height: H, onInspect, onHover } = p;
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);
  const padL = cfg?.plotPaddingLeft ?? 54;
  const padR = cfg?.plotPaddingRight ?? 18;
  const padT = cfg?.plotPaddingTop ?? 16;
  const padB = cfg?.plotPaddingBottom ?? 32;
  const plotW = Math.max(120, W - padL - padR);
  const plotH = Math.max(80, H - padT - padB);

  if (widget.kind === 'density') {
    // Group values by seriesField (or single cohort)
    const groups = new Map<string, { vals: number[]; row: unknown[] }>();
    const groupCol = seriesIdx >= 0 ? seriesIdx : cols.length > 1 && xIdx !== yCol ? xIdx : -1;
    for (const r of rows) {
      const v = Number(r[yCol]);
      if (!Number.isFinite(v)) continue;
      const g = groupCol >= 0 && typeof r[groupCol] === 'string' ? String(r[groupCol]) : cols[yCol] ?? 'Density';
      if (p.mutedSeries.has(g)) continue;
      const entry = groups.get(g) ?? { vals: [], row: r };
      entry.vals.push(v);
      groups.set(g, entry);
    }
    const allVals = Array.from(groups.values()).flatMap((g) => g.vals);
    if (allVals.length === 0) return null;
    const minX = Math.min(...allVals);
    const maxX = Math.max(...allVals);
    const curves = Array.from(groups.entries()).slice(0, 6).map(([name, g], idx) => ({
      name,
      row: g.row,
      mean: g.vals.reduce((s, v) => s + v, 0) / g.vals.length,
      color: resolveSeriesColor(idx, cfg, widget.color),
      pts: computeKdeCurve(g.vals, minX, maxX, 40),
    }));
    const domainLo = curves[0]?.pts[0]?.x ?? minX;
    const domainHi = curves[0]?.pts[curves[0].pts.length - 1]?.x ?? maxX + 1;
    const maxD = Math.max(1e-6, ...curves.flatMap((c) => c.pts.map((pt) => pt.density)));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.5, 1].map((t) => {
          const gy = padT + plotH * (1 - t);
          return (
            <line
              key={t}
              x1={padL}
              y1={gy}
              x2={W - padR}
              y2={gy}
              stroke="var(--md-outline-variant)"
              strokeDasharray={t === 0 ? undefined : '3 3'}
              strokeOpacity={cfg?.gridOpacity ?? 0.5}
            />
          );
        })}
        {curves.map((c) => {
          const coords = c.pts.map((pt) => ({
            x: padL + ((pt.x - domainLo) / Math.max(1e-6, domainHi - domainLo)) * plotW,
            y: padT + plotH - (pt.density / maxD) * plotH * 0.92,
          }));
          const lineD = buildCurvePath(coords, 'monotone');
          const areaD = `${lineD} L ${coords[coords.length - 1].x.toFixed(1)} ${padT + plotH} L ${coords[0].x.toFixed(1)} ${padT + plotH} Z`;
          const meanFormatted = formatMetricValue(c.mean, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={c.name}
              className="chart-hit"
              onClick={() => onInspect(c.name, c.mean, cols[yCol] ?? 'mean', c.row)}
              onMouseEnter={() => onHover({ x: W / 2, y: padT + 18, title: c.name, detail: `Mean: ${meanFormatted}` })}
              onMouseLeave={() => onHover(null)}
            >
              <path d={areaD} fill={c.color} fillOpacity={cfg?.fillOpacity ?? 0.22} />
              <path d={lineD} fill="none" stroke={c.color} strokeWidth={cfg?.strokeWidth ?? 2.4} />
            </g>
          );
        })}
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const xv = domainLo + (domainHi - domainLo) * t;
          const xp = padL + plotW * t;
          return (
            <text key={t} x={xp} y={H - 8} textAnchor={t === 0 ? 'start' : t === 1 ? 'end' : 'middle'} className="axis-tick">
              {formatMetricValue(xv, widget.format ?? 'compact', undefined, fmtOpts)}
            </text>
          );
        })}
      </svg>
    );
  }

  // box_plot and violin
  const groupX = cols.length > 1 && xIdx !== yCol ? xIdx : null;
  const stats = computeBoxPlotStats(rows, groupX, yCol)
    .filter((s) => !p.mutedSeries.has(s.group))
    .slice(0, cfg?.limitItems ?? 12);
  if (stats.length === 0) return null;

  const allNums = stats.flatMap((s) => [s.min, s.max, ...s.outliers]);
  const lo = cfg?.yMin ?? Math.min(...allNums) * (Math.min(...allNums) >= 0 && cfg?.startFromZero ? 0 : 0.92);
  const hi = cfg?.yMax ?? Math.max(...allNums) * 1.06;
  const span = Math.max(1e-6, hi - lo);
  const yOf = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
  const slotW = plotW / stats.length;

  // Gather raw values per group for Violin KDE
  const rawByGroup = new Map<string, number[]>();
  if (widget.kind === 'violin') {
    for (const r of rows) {
      const v = Number(r[yCol]);
      if (!Number.isFinite(v)) continue;
      const g = groupX !== null ? String(r[groupX] ?? 'All') : 'Distribution';
      const arr = rawByGroup.get(g) ?? [];
      arr.push(v);
      rawByGroup.set(g, arr);
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
      {[0, 0.5, 1].map((t) => {
        const val = lo + span * t;
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
                strokeDasharray={t === 0 ? undefined : '3 3'}
                strokeOpacity={cfg?.gridOpacity ?? 0.5}
              />
            )}
            {cfg?.showYTicks !== false && (
              <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
                {formatMetricValue(val, cfg?.yAxisFormat ?? 'compact')}
              </text>
            )}
          </g>
        );
      })}
      {stats.map((st, idx) => {
        const cx = padL + (idx + 0.5) * slotW;
        const boxW = Math.max(14, Math.min(48, slotW * 0.46));
        const col = resolveSeriesColor(idx, cfg, widget.color);
        const yMin = yOf(st.min);
        const yQ1 = yOf(st.q1);
        const yMed = yOf(st.median);
        const yQ3 = yOf(st.q3);
        const yMax = yOf(st.max);
        const medFmt = formatMetricValue(st.median, widget.format, widget.unit, fmtOpts);

        let violinPath = '';
        if (widget.kind === 'violin') {
          const gVals = rawByGroup.get(st.group) ?? [st.min, st.median, st.max];
          const kde = computeKdeCurve(gVals, st.min, st.max, 24);
          const maxD = Math.max(1e-6, ...kde.map((k) => k.density));
          const maxHalfW = Math.min(36, slotW * 0.42);
          const rightSide = kde.map((k) => `${(cx + (k.density / maxD) * maxHalfW).toFixed(1)},${yOf(k.x).toFixed(1)}`);
          const leftSide = [...kde].reverse().map((k) => `${(cx - (k.density / maxD) * maxHalfW).toFixed(1)},${yOf(k.x).toFixed(1)}`);
          violinPath = `M ${rightSide.join(' L ')} L ${leftSide.join(' L ')} Z`;
        }

        return (
          <g
            key={st.group}
            className="chart-hit"
            onClick={() => onInspect(st.group, st.median, 'median', st.sampleRow)}
            onMouseEnter={() =>
              onHover({
                x: cx,
                y: yQ3,
                title: st.group,
                detail: `Median ${medFmt} · IQR ${formatMetricValue(st.q1, 'compact')}–${formatMetricValue(st.q3, 'compact')} (n=${st.count})`,
              })
            }
            onMouseLeave={() => onHover(null)}
          >
            {widget.kind === 'violin' ? (
              <>
                <path d={violinPath} fill={col} fillOpacity={cfg?.fillOpacity ?? 0.34} stroke={col} strokeWidth={1.75} />
                <line x1={cx} y1={yMin} x2={cx} y2={yMax} stroke={col} strokeWidth={1.5} />
                <rect x={cx - 4} y={yQ3} width={8} height={Math.max(2, yQ1 - yQ3)} rx={3} fill={col} />
                <circle cx={cx} cy={yMed} r={3.2} fill="var(--md-surface-container-lowest)" stroke={col} strokeWidth={1.5} />
              </>
            ) : (
              <>
                <line x1={cx} y1={yMax} x2={cx} y2={yQ3} stroke={col} strokeWidth={1.6} />
                <line x1={cx} y1={yQ1} x2={cx} y2={yMin} stroke={col} strokeWidth={1.6} />
                <line x1={cx - boxW * 0.3} y1={yMax} x2={cx + boxW * 0.3} y2={yMax} stroke={col} strokeWidth={1.6} />
                <line x1={cx - boxW * 0.3} y1={yMin} x2={cx + boxW * 0.3} y2={yMin} stroke={col} strokeWidth={1.6} />
                <rect
                  x={cx - boxW / 2}
                  y={yQ3}
                  width={boxW}
                  height={Math.max(3, yQ1 - yQ3)}
                  rx={cfg?.barRadius ?? 4}
                  fill={col}
                  fillOpacity={cfg?.fillOpacity ?? 0.28}
                  stroke={col}
                  strokeWidth={1.8}
                />
                <line x1={cx - boxW / 2} y1={yMed} x2={cx + boxW / 2} y2={yMed} stroke={col} strokeWidth={2.6} />
                {cfg?.showMean !== false && (
                  <polygon
                    points={`${cx},${yOf(st.mean) - 4} ${cx + 4},${yOf(st.mean)} ${cx},${yOf(st.mean) + 4} ${cx - 4},${yOf(st.mean)}`}
                    fill="var(--md-surface-container-lowest)"
                    stroke={col}
                    strokeWidth={1.5}
                  />
                )}
                {cfg?.showOutliers !== false &&
                  st.outliers.slice(0, 8).map((ov, oi) => (
                    <circle key={oi} cx={cx} cy={yOf(ov)} r={3} fill="none" stroke={col} strokeWidth={1.4} />
                  ))}
              </>
            )}
            {cfg?.showXTicks !== false && (
              <text x={cx} y={H - 8} textAnchor="middle" className="axis-tick">
                {st.group.slice(0, cfg?.xTickTruncate ?? 13)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function renderTemporalSpecialSvg(p: SpecializedChartProps) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, width: W, height: H, onInspect, onHover } = p;
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };

  if (widget.kind === 'gantt') {
    const startIdx = findColIndex(cols, widget.startField, yIndices[0] ?? 1);
    const endIdx = findColIndex(cols, widget.endField, yIndices[1] ?? Math.min(cols.length - 1, startIdx + 1));
    const progIdx = findColIndex(cols, widget.progressField, yIndices[2] ?? -1);
    const items = rows.slice(0, cfg?.limitItems ?? 14).map((r, i) => {
      const s = toFiniteNum(r[startIdx]);
      const eRaw = toFiniteNum(r[endIdx]);
      const e = eRaw > s ? eRaw : s + Math.max(1, eRaw || 5);
      const prog = progIdx >= 0 ? Math.max(0, Math.min(100, toFiniteNum(r[progIdx]))) : null;
      const group = seriesIdx >= 0 ? String(r[seriesIdx] ?? '') : '';
      return { label: String(r[xIdx] ?? `Task ${i + 1}`), start: s, end: e, prog, group, row: r };
    });
    const minS = Math.min(0, ...items.map((it) => it.start));
    const maxE = Math.max(minS + 1, ...items.map((it) => it.end));
    const padL = cfg?.plotPaddingLeft ?? 148;
    const padR = cfg?.plotPaddingRight ?? 24;
    const padT = cfg?.plotPaddingTop ?? 14;
    const padB = cfg?.plotPaddingBottom ?? 28;
    const plotW = Math.max(120, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const rowH = plotH / Math.max(1, items.length);
    const groupList = Array.from(new Set(items.map((i) => i.group).filter(Boolean)));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const gx = padL + plotW * t;
          const v = Math.round(minS + (maxE - minS) * t);
          return (
            <g key={t}>
              <line x1={gx} y1={padT} x2={gx} y2={padT + plotH} stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <text x={gx} y={H - 7} textAnchor="middle" className="axis-tick">
                {widget.unit ? `${v}${widget.unit}` : v}
              </text>
            </g>
          );
        })}
        {items.map((it, idx) => {
          const bx = padL + ((it.start - minS) / (maxE - minS)) * plotW;
          const bw = Math.max(8, ((it.end - it.start) / (maxE - minS)) * plotW);
          const bh = Math.max(10, Math.min(20, rowH * 0.64));
          const by = padT + idx * rowH + (rowH - bh) / 2;
          const cIdx = it.group ? Math.max(0, groupList.indexOf(it.group)) : idx;
          const col = resolveSeriesColor(cIdx, cfg, widget.color);
          const detail = `${it.start} → ${it.end}${widget.unit ?? ''}${it.prog !== null ? ` (${it.prog}% done)` : ''}`;
          return (
            <g
              key={`${it.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(it.label, it.end - it.start, cols[endIdx] ?? 'duration', it.row)}
              onMouseEnter={() => onHover({ x: bx + bw / 2, y: by, title: it.label, detail })}
              onMouseLeave={() => onHover(null)}
            >
              <text x={padL - 10} y={by + bh / 2 + 4} textAnchor="end" className="axis-tick">
                {it.label.slice(0, cfg?.xTickTruncate ?? 20)}
              </text>
              <rect x={bx} y={by} width={bw} height={bh} rx={cfg?.barRadius ?? 5} fill={col} fillOpacity={0.3} stroke={col} strokeWidth={1.2} />
              {it.prog !== null && it.prog > 0 && (
                <rect x={bx} y={by} width={Math.max(4, (bw * it.prog) / 100)} height={bh} rx={cfg?.barRadius ?? 5} fill={col} fillOpacity={cfg?.fillOpacity ?? 0.9} />
              )}
              {(cfg?.showDataLabels ?? true) && it.prog !== null && (
                <text x={bx + bw + 5} y={by + bh / 2 + 3.5} className="axis-tick" style={{ fontSize: 10 }}>
                  {it.prog}%
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'candlestick') {
    const oIdx = findColIndex(cols, widget.openField, yIndices[0] ?? 1);
    const hIdx = findColIndex(cols, widget.highField, yIndices[1] ?? Math.min(cols.length - 1, oIdx + 1));
    const lIdx = findColIndex(cols, widget.lowField, yIndices[2] ?? Math.min(cols.length - 1, oIdx + 2));
    const cIdx = findColIndex(cols, widget.closeField, yIndices[3] ?? Math.min(cols.length - 1, oIdx + 3));

    const candles = rows.slice(0, cfg?.limitItems ?? 32).map((r, i) => {
      const open = toFiniteNum(r[oIdx]);
      const close = toFiniteNum(r[cIdx]);
      const high = Math.max(open, close, toFiniteNum(r[hIdx]));
      const low = Math.min(open, close, toFiniteNum(r[lIdx]) || Math.min(open, close));
      return { label: String(r[xIdx] ?? `#${i + 1}`), open, high, low, close, row: r };
    });
    const lo = cfg?.yMin ?? Math.min(...candles.map((c) => c.low)) * 0.985;
    const hi = cfg?.yMax ?? Math.max(...candles.map((c) => c.high)) * 1.015;
    const span = Math.max(1e-6, hi - lo);
    const padL = cfg?.plotPaddingLeft ?? 56;
    const padR = cfg?.plotPaddingRight ?? 16;
    const padT = cfg?.plotPaddingTop ?? 14;
    const padB = cfg?.plotPaddingBottom ?? 30;
    const plotW = Math.max(120, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const yOf = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
    const slotW = plotW / Math.max(1, candles.length);
    const bodyW = Math.max(6, Math.min(26, slotW * 0.58));
    const step = Math.max(1, Math.ceil(candles.length / Math.max(3, Math.floor(plotW / 80))));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.5, 1].map((t) => {
          const gy = padT + plotH * (1 - t);
          return (
            <g key={t}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--md-outline-variant)" strokeDasharray={t === 0 ? undefined : '3 3'} strokeOpacity={0.5} />
              <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
                {formatMetricValue(lo + span * t, widget.format ?? 'compact', undefined, fmtOpts)}
              </text>
            </g>
          );
        })}
        {candles.map((c, idx) => {
          const cx = padL + (idx + 0.5) * slotW;
          const bull = c.close >= c.open;
          const tone = bull ? 'var(--c-green-accent)' : 'var(--c-red-accent)';
          const topY = yOf(Math.max(c.open, c.close));
          const botY = yOf(Math.min(c.open, c.close));
          const closeFmt = formatMetricValue(c.close, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={`${c.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(c.label, c.close, cols[cIdx] ?? 'close', c.row)}
              onMouseEnter={() =>
                onHover({
                  x: cx,
                  y: yOf(c.high),
                  title: c.label,
                  detail: `O ${c.open} · H ${c.high} · L ${c.low} · C ${closeFmt}`,
                })
              }
              onMouseLeave={() => onHover(null)}
            >
              <line x1={cx} y1={yOf(c.high)} x2={cx} y2={yOf(c.low)} stroke={tone} strokeWidth={1.75} />
              <rect
                x={cx - bodyW / 2}
                y={topY}
                width={bodyW}
                height={Math.max(3, botY - topY)}
                rx={2}
                fill={tone}
                fillOpacity={bull ? 0.88 : 0.92}
              />
              {(idx % step === 0 || idx === candles.length - 1) && (
                <text x={cx} y={H - 8} textAnchor="middle" className="axis-tick">
                  {c.label.slice(0, 10)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  // streamgraph
  const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
  const activeSeries = piv.series.filter((s) => !p.mutedSeries.has(s.name));
  const cats = piv.categories;
  if (cats.length === 0 || activeSeries.length === 0) return null;

  const padL = cfg?.plotPaddingLeft ?? 24;
  const padR = cfg?.plotPaddingRight ?? 24;
  const padT = cfg?.plotPaddingTop ?? 14;
  const padB = cfg?.plotPaddingBottom ?? 30;
  const plotW = Math.max(120, W - padL - padR);
  const plotH = Math.max(80, H - padT - padB);
  const totals = cats.map((_, ci) => activeSeries.reduce((s, ser) => s + Math.max(0, ser.values[ci] ?? 0), 0));
  const maxTot = Math.max(1, ...totals);

  // Build centered stream stacks
  const layers = activeSeries.map((ser, si) => {
    const topPts: { x: number; y: number }[] = [];
    const botPts: { x: number; y: number }[] = [];
    cats.forEach((_, ci) => {
      const tot = totals[ci];
      let below = 0;
      for (let k = 0; k < si; k++) below += Math.max(0, activeSeries[k].values[ci] ?? 0);
      const val = Math.max(0, ser.values[ci] ?? 0);
      const yCenter = padT + plotH / 2;
      const halfSpan = ((tot / maxTot) * plotH * 0.86) / 2;
      const yBottom = yCenter + halfSpan - (below / Math.max(1, tot)) * (halfSpan * 2);
      const yTop = yBottom - (val / Math.max(1, tot)) * (halfSpan * 2);
      const x = padL + (cats.length === 1 ? plotW / 2 : (ci / (cats.length - 1)) * plotW);
      topPts.push({ x, y: yTop });
      botPts.push({ x, y: yBottom });
    });
    const topPath = buildCurvePath(topPts, 'monotone');
    const revBot = [...botPts].reverse();
    const botPath = buildCurvePath(revBot, 'monotone').replace(/^M/, 'L');
    return {
      ser,
      si,
      d: `${topPath} ${botPath} Z`,
      sum: ser.values.reduce((a, b) => a + b, 0),
    };
  });

  const xStep = Math.max(1, Math.ceil(cats.length / Math.max(3, Math.floor(plotW / 80))));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
      {layers.map((ly) => {
        const col = resolveSeriesColor(ly.si, cfg, widget.color);
        const sumFmt = formatMetricValue(ly.sum, widget.format, widget.unit, fmtOpts);
        return (
          <path
            key={ly.ser.name}
            d={ly.d}
            fill={col}
            fillOpacity={cfg?.fillOpacity ?? 0.82}
            stroke="var(--md-surface-container-lowest)"
            strokeWidth={1}
            className="chart-hit"
            onClick={() => onInspect(ly.ser.name, ly.sum, ly.ser.name, ly.ser.rows[0] ?? [ly.ser.name, ly.sum])}
            onMouseEnter={() => onHover({ x: W / 2, y: padT + 20, title: ly.ser.name, detail: `Total: ${sumFmt}` })}
            onMouseLeave={() => onHover(null)}
          />
        );
      })}
      {cats.map((c, ci) =>
        ci % xStep === 0 || ci === cats.length - 1 ? (
          <text
            key={`${c}-${ci}`}
            x={padL + (cats.length === 1 ? plotW / 2 : (ci / (cats.length - 1)) * plotW)}
            y={H - 8}
            textAnchor={ci === 0 ? 'start' : ci === cats.length - 1 ? 'end' : 'middle'}
            className="axis-tick"
          >
            {c.slice(0, 10)}
          </text>
        ) : null,
      )}
    </svg>
  );
}

export function renderHierarchicalAndFlowSvg(p: SpecializedChartProps) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, width: W, height: H, onInspect, onHover } = p;
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);
  const parentIdx = findColIndex(cols, widget.parentField, seriesIdx);

  if (widget.kind === 'treemap') {
    const groups = Array.from(new Set(rows.map((r) => (parentIdx >= 0 ? String(r[parentIdx] ?? '') : ''))));
    const tiles = layoutSquarifiedTreemap(
      rows
        .map((r, idx) => ({
          label: String(r[xIdx] ?? `#${idx + 1}`),
          group: parentIdx >= 0 ? String(r[parentIdx] ?? '') : undefined,
          value: Math.max(0, toFiniteNum(r[yCol])),
          data: r,
        }))
        .filter((it) => !p.mutedSeries.has(it.group ?? it.label)),
      4,
      4,
      W - 8,
      H - 8,
    );
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {tiles.map((t, idx) => {
          const cIdx = t.group ? Math.max(0, groups.indexOf(t.group)) : idx;
          const col = resolveSeriesColor(cIdx, cfg, widget.color);
          const fmt = formatMetricValue(t.value, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={`${t.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(t.label, t.value, cols[yCol] ?? 'value', t.data)}
              onMouseEnter={() =>
                onHover({ x: t.x + t.w / 2, y: t.y + t.h / 2, title: t.label, detail: `${t.group ? `${t.group} · ` : ''}${fmt}` })
              }
              onMouseLeave={() => onHover(null)}
            >
              <rect
                x={t.x + 1.5}
                y={t.y + 1.5}
                width={Math.max(2, t.w - 3)}
                height={Math.max(2, t.h - 3)}
                rx={cfg?.barRadius ?? 6}
                fill={col}
                fillOpacity={cfg?.fillOpacity ?? 0.84}
              />
              {t.w > 54 && t.h > 28 && (
                <>
                  <text x={t.x + 8} y={t.y + 16} fill="#ffffff" style={{ fontSize: 11, fontWeight: 600 }}>
                    {t.label.slice(0, Math.max(4, Math.floor(t.w / 7.2)))}
                  </text>
                  {t.h > 42 && (
                    <text x={t.x + 8} y={t.y + 31} fill="rgba(255,255,255,0.88)" style={{ fontSize: 10.5 }}>
                      {fmt}
                    </text>
                  )}
                </>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'sunburst') {
    const pCol = parentIdx >= 0 && parentIdx !== xIdx ? parentIdx : -1;
    const byParent = new Map<string, { total: number; children: { label: string; val: number; row: unknown[] }[] }>();
    for (const r of rows) {
      const val = Math.max(0, toFiniteNum(r[yCol]));
      if (val <= 0) continue;
      const parent = pCol >= 0 ? String(r[pCol] ?? 'Group') : String(r[xIdx] ?? 'Slice');
      if (p.mutedSeries.has(parent)) continue;
      const child = String(r[xIdx] ?? 'Item');
      const g = byParent.get(parent) ?? { total: 0, children: [] };
      g.total += val;
      g.children.push({ label: child, val, row: r });
      byParent.set(parent, g);
    }
    const grandTotal = Math.max(1, Array.from(byParent.values()).reduce((s, g) => s + g.total, 0));
    const cx = W / 2;
    const cy = H / 2;
    const rMax = Math.min(W, H) * 0.45;
    const r0 = rMax * 0.28;
    const r1 = rMax * 0.62;
    const r2 = rMax;

    const arcPath = (startA: number, endA: number, ri: number, ro: number) => {
      const span = Math.max(0.015, endA - startA - 0.012);
      const e = startA + span;
      const large = span > Math.PI ? 1 : 0;
      const x1 = cx + ro * Math.cos(startA);
      const y1 = cy + ro * Math.sin(startA);
      const x2 = cx + ro * Math.cos(e);
      const y2 = cy + ro * Math.sin(e);
      const x3 = cx + ri * Math.cos(e);
      const y3 = cy + ri * Math.sin(e);
      const x4 = cx + ri * Math.cos(startA);
      const y4 = cy + ri * Math.sin(startA);
      return `M ${x1} ${y1} A ${ro} ${ro} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${ri} ${ri} 0 ${large} 0 ${x4} ${y4} Z`;
    };

    let angle = ((cfg?.startAngle ?? -90) * Math.PI) / 180;
    const rings: ReactElement[] = [];
    Array.from(byParent.entries()).forEach(([parentName, grp], gi) => {
      const pSpan = (grp.total / grandTotal) * Math.PI * 2;
      const col = resolveSeriesColor(gi, cfg, widget.color);
      const pFmt = formatMetricValue(grp.total, widget.format, widget.unit, fmtOpts);
      rings.push(
        <path
          key={`p-${parentName}`}
          d={arcPath(angle, angle + pSpan, r0, r1 - 2)}
          fill={col}
          fillOpacity={0.9}
          className="chart-hit"
          onClick={() => onInspect(parentName, grp.total, cols[yCol] ?? 'total', grp.children[0]?.row ?? [parentName, grp.total])}
          onMouseEnter={() => onHover({ x: cx, y: cy - r1, title: parentName, detail: `${pFmt} (${Math.round((grp.total / grandTotal) * 100)}%)` })}
          onMouseLeave={() => onHover(null)}
        />,
      );
      let childCursor = angle;
      grp.children.forEach((ch, ci) => {
        const cSpan = (ch.val / Math.max(1, grp.total)) * pSpan;
        const cFmt = formatMetricValue(ch.val, widget.format, widget.unit, fmtOpts);
        rings.push(
          <path
            key={`c-${parentName}-${ch.label}-${ci}`}
            d={arcPath(childCursor, childCursor + cSpan, r1 + 1, r2)}
            fill={col}
            fillOpacity={Math.max(0.38, 0.78 - (ci % 4) * 0.11)}
            className="chart-hit"
            onClick={() => onInspect(`${parentName} › ${ch.label}`, ch.val, cols[yCol] ?? 'value', ch.row)}
            onMouseEnter={() => onHover({ x: cx, y: cy - r2 + 10, title: `${parentName} › ${ch.label}`, detail: cFmt })}
            onMouseLeave={() => onHover(null)}
          />,
        );
        childCursor += cSpan;
      });
      angle += pSpan;
    });

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {rings}
        <text x={cx} y={cy + 4} textAnchor="middle" className="donut-center-text" style={{ fontSize: 12 }}>
          {cfg?.donutCenterLabel || formatMetricValue(grandTotal, widget.format, undefined, fmtOpts)}
        </text>
      </svg>
    );
  }

  if (widget.kind === 'org_chart') {
    const pCol = findColIndex(cols, widget.parentField, 2);
    const { nodes, edges } = layoutOrgTree(rows, cols, xIdx, pCol, yCol, seriesIdx, W, H);
    const groups = Array.from(new Set(nodes.map((n) => n.group ?? '')));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {edges.map((e, i) => {
          const x1 = e.from.x + e.from.w / 2;
          const y1 = e.from.y + e.from.h;
          const x2 = e.to.x + e.to.w / 2;
          const y2 = e.to.y;
          const midY = (y1 + y2) / 2;
          return (
            <path
              key={i}
              d={`M ${x1} ${y1} V ${midY} H ${x2} V ${y2}`}
              fill="none"
              stroke="var(--md-outline)"
              strokeWidth={1.5}
            />
          );
        })}
        {nodes.map((n) => {
          const cIdx = n.group ? Math.max(0, groups.indexOf(n.group)) : n.depth;
          const col = resolveSeriesColor(cIdx, cfg, widget.color);
          const fmt = formatMetricValue(n.value, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={n.id}
              className="chart-hit"
              onClick={() => onInspect(n.label, n.value, cols[yCol] ?? 'value', n.row)}
              onMouseEnter={() => onHover({ x: n.x + n.w / 2, y: n.y, title: n.label, detail: n.value ? fmt : n.group ?? '' })}
              onMouseLeave={() => onHover(null)}
            >
              <rect
                x={n.x}
                y={n.y}
                width={n.w}
                height={n.h}
                rx={8}
                fill="var(--md-surface-container-low)"
                stroke={col}
                strokeWidth={1.6}
              />
              <rect x={n.x} y={n.y} width={4} height={n.h} rx={2} fill={col} />
              <text x={n.x + 10} y={n.y + (n.value ? 15 : n.h / 2 + 4)} className="axis-tick" style={{ fill: 'var(--md-on-surface)', fontWeight: 600 }}>
                {n.label.slice(0, Math.max(6, Math.floor((n.w - 14) / 6.3)))}
              </text>
              {n.value > 0 && (
                <text x={n.x + 10} y={n.y + 29} className="axis-tick" style={{ fontSize: 10 }}>
                  {fmt}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'circle_packing') {
    const gCol = parentIdx >= 0 && parentIdx !== xIdx ? parentIdx : -1;
    const clusters = new Map<string, { label: string; val: number; row: unknown[] }[]>();
    for (const r of rows) {
      const val = Math.max(0, toFiniteNum(r[yCol]));
      if (val <= 0) continue;
      const g = gCol >= 0 ? String(r[gCol] ?? 'Cluster') : 'All';
      if (p.mutedSeries.has(g)) continue;
      const list = clusters.get(g) ?? [];
      list.push({ label: String(r[xIdx] ?? 'Item'), val, row: r });
      clusters.set(g, list);
    }
    const entries = Array.from(clusters.entries());
    const maxVal = Math.max(1, ...entries.flatMap(([, items]) => items.map((i) => i.val)));
    const clusterStep = W / Math.max(1, entries.length);

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {entries.map(([gName, items], gi) => {
          const gcx = (gi + 0.5) * clusterStep;
          const gcy = H / 2 + 6;
          const outerR = Math.min(clusterStep * 0.45, H * 0.42);
          const col = resolveSeriesColor(gi, cfg, widget.color);
          return (
            <g key={gName}>
              {entries.length > 1 && (
                <>
                  <circle cx={gcx} cy={gcy} r={outerR} fill={col} fillOpacity={0.08} stroke={col} strokeDasharray="4 3" strokeOpacity={0.55} />
                  <text x={gcx} y={16} textAnchor="middle" className="axis-tick" style={{ fontWeight: 600 }}>
                    {gName.slice(0, 18)}
                  </text>
                </>
              )}
              {items.slice(0, 12).map((it, ii) => {
                const r = Math.max(11, Math.min(outerR * 0.52, outerR * 0.54 * Math.sqrt(it.val / maxVal)));
                const angle = ii === 0 ? 0 : ((ii - 1) / Math.max(1, items.length - 1)) * Math.PI * 2;
                const dist = items.length === 1 ? 0 : ii === 0 ? 0 : outerR * 0.48;
                const cx = gcx + Math.cos(angle) * dist;
                const cy = gcy + Math.sin(angle) * dist;
                const fmt = formatMetricValue(it.val, widget.format, widget.unit, fmtOpts);
                return (
                  <g
                    key={`${it.label}-${ii}`}
                    className="chart-hit"
                    onClick={() => onInspect(it.label, it.val, cols[yCol] ?? 'value', it.row)}
                    onMouseEnter={() => onHover({ x: cx, y: cy - r, title: it.label, detail: `${gName !== 'All' ? `${gName} · ` : ''}${fmt}` })}
                    onMouseLeave={() => onHover(null)}
                  >
                    <circle cx={cx} cy={cy} r={r} fill={col} fillOpacity={cfg?.fillOpacity ?? 0.72} stroke="var(--md-surface-container-lowest)" strokeWidth={1.5} />
                    {r >= 18 && (
                      <text x={cx} y={cy + 3.5} textAnchor="middle" fill="#ffffff" style={{ fontSize: 9.5, fontWeight: 600 }}>
                        {it.label.slice(0, Math.max(3, Math.floor(r / 3.4)))}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'sankey' || widget.kind === 'parallel_sets') {
    // Build multi-stage links across categorical columns up to yCol
    const links: { source: string; target: string; value: number; row: unknown[] }[] = [];
    const stringCols = cols
      .map((_, ci) => ci)
      .filter((ci) => ci !== yCol && typeof rows[0]?.[ci] === 'string')
      .slice(0, widget.kind === 'parallel_sets' ? 3 : 2);

    if (stringCols.length >= 2) {
      for (let s = 0; s < stringCols.length - 1; s++) {
        const cA = stringCols[s];
        const cB = stringCols[s + 1];
        const agg = new Map<string, { val: number; row: unknown[] }>();
        for (const r of rows) {
          const a = `${stringCols.length > 2 ? `${s + 1}: ` : ''}${String(r[cA] ?? 'A')}`;
          const b = `${stringCols.length > 2 ? `${s + 2}: ` : ''}${String(r[cB] ?? 'B')}`;
          if (a === b) continue;
          const v = Math.max(0, toFiniteNum(r[yCol]));
          const key = `${a}\u0000${b}`;
          const prev = agg.get(key);
          agg.set(key, { val: (prev?.val ?? 0) + v, row: r });
        }
        for (const [k, v] of agg.entries()) {
          const [source, target] = k.split('\u0000');
          links.push({ source, target, value: v.val, row: v.row });
        }
      }
    } else {
      rows.slice(0, 16).forEach((r, i) => {
        links.push({
          source: 'Total',
          target: String(r[xIdx] ?? `Item ${i + 1}`),
          value: Math.max(0, toFiniteNum(r[yCol])),
          row: r,
        });
      });
    }

    const { nodes, links: laidLinks } = layoutSankeyDiagram(
      links,
      W,
      H,
      cfg?.nodeSize ?? 14,
      cfg?.linkCurvature ?? 0.5,
    );
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {laidLinks.map((lk, idx) => {
          const sIdx = nodes.indexOf(lk.source);
          const col = resolveSeriesColor(Math.max(0, sIdx), cfg, widget.color);
          const fmt = formatMetricValue(lk.value, widget.format, widget.unit, fmtOpts);
          return (
            <path
              key={idx}
              d={lk.path}
              fill="none"
              stroke={col}
              strokeWidth={lk.strokeWidth}
              strokeOpacity={cfg?.fillOpacity ?? 0.38}
              className="chart-hit"
              onClick={() => onInspect(`${lk.source.label} → ${lk.target.label}`, lk.value, cols[yCol] ?? 'flow', lk.row)}
              onMouseEnter={() =>
                onHover({
                  x: (lk.source.x + lk.target.x) / 2,
                  y: (lk.source.y + lk.target.y) / 2,
                  title: `${lk.source.label} → ${lk.target.label}`,
                  detail: fmt,
                })
              }
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
        {nodes.map((n, idx) => {
          const col = resolveSeriesColor(idx, cfg, widget.color);
          const isRight = n.x > W * 0.55;
          return (
            <g key={n.id}>
              <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={3} fill={col} />
              <text
                x={isRight ? n.x - 6 : n.x + n.w + 6}
                y={n.y + n.h / 2 + 4}
                textAnchor={isRight ? 'end' : 'start'}
                className="axis-tick"
                style={{ fill: 'var(--md-on-surface)', fontWeight: 500 }}
              >
                {n.label.replace(/^\d+:\s*/, '').slice(0, 18)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'chord') {
    const tgtCol = seriesIdx >= 0 ? seriesIdx : Math.min(1, cols.length - 1);
    const valCol = yCol === tgtCol ? Math.min(2, cols.length - 1) : yCol;
    const pairs = rows.slice(0, 28).map((r) => ({
      s: String(r[xIdx] ?? 'A'),
      t: String(r[tgtCol] ?? 'B'),
      v: Math.max(0.1, toFiniteNum(r[valCol])),
      row: r,
    }));
    const nodeTotals = new Map<string, number>();
    for (const pr of pairs) {
      nodeTotals.set(pr.s, (nodeTotals.get(pr.s) ?? 0) + pr.v);
      nodeTotals.set(pr.t, (nodeTotals.get(pr.t) ?? 0) + pr.v);
    }
    const nodeNames = Array.from(nodeTotals.keys()).slice(0, 12);
    const sumAll = Math.max(1, Array.from(nodeTotals.values()).reduce((a, b) => a + b, 0));
    const cx = W / 2;
    const cy = H / 2;
    const R = Math.min(W, H) * 0.4;
    const pad = 0.06;
    let curA = -Math.PI / 2;
    const nodeArcs = new Map<string, { start: number; end: number; mid: number; idx: number }>();
    nodeNames.forEach((nm, idx) => {
      const span = ((nodeTotals.get(nm) ?? 1) / sumAll) * (Math.PI * 2 - pad * nodeNames.length);
      nodeArcs.set(nm, { start: curA, end: curA + span, mid: curA + span / 2, idx });
      curA += span + pad;
    });

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {pairs.map((pr, idx) => {
          const sa = nodeArcs.get(pr.s);
          const ta = nodeArcs.get(pr.t);
          if (!sa || !ta) return null;
          const x1 = cx + (R - 8) * Math.cos(sa.mid);
          const y1 = cy + (R - 8) * Math.sin(sa.mid);
          const x2 = cx + (R - 8) * Math.cos(ta.mid);
          const y2 = cy + (R - 8) * Math.sin(ta.mid);
          const col = resolveSeriesColor(sa.idx, cfg, widget.color);
          const fmt = formatMetricValue(pr.v, widget.format, widget.unit, fmtOpts);
          return (
            <path
              key={idx}
              d={`M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`}
              fill="none"
              stroke={col}
              strokeWidth={Math.max(2, Math.min(14, (pr.v / sumAll) * 65))}
              strokeOpacity={cfg?.fillOpacity ?? 0.45}
              className="chart-hit"
              onClick={() => onInspect(`${pr.s} ↔ ${pr.t}`, pr.v, cols[valCol] ?? 'flow', pr.row)}
              onMouseEnter={() => onHover({ x: cx, y: cy, title: `${pr.s} → ${pr.t}`, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
        {nodeNames.map((nm) => {
          const a = nodeArcs.get(nm)!;
          const col = resolveSeriesColor(a.idx, cfg, widget.color);
          const x1 = cx + R * Math.cos(a.start);
          const y1 = cy + R * Math.sin(a.start);
          const x2 = cx + R * Math.cos(a.end);
          const y2 = cy + R * Math.sin(a.end);
          const large = a.end - a.start > Math.PI ? 1 : 0;
          const lx = cx + (R + 15) * Math.cos(a.mid);
          const ly = cy + (R + 15) * Math.sin(a.mid);
          return (
            <g key={nm}>
              <path d={`M ${x1} ${y1} A ${R} ${R} 0 ${large} 1 ${x2} ${y2}`} fill="none" stroke={col} strokeWidth={8} strokeLinecap="round" />
              <text x={lx} y={ly + 3} textAnchor={Math.cos(a.mid) >= 0 ? 'start' : 'end'} className="axis-tick" style={{ fontSize: 10.5 }}>
                {nm.slice(0, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'network_chart' || widget.kind === 'arc_diagram') {
    const tgtCol = seriesIdx >= 0 ? seriesIdx : Math.min(1, cols.length - 1);
    const valCol = yCol === tgtCol ? Math.min(2, cols.length - 1) : yCol;
    const edgeRows = rows.slice(0, 36).map((r) => ({
      source: String(r[xIdx] ?? 'Node A'),
      target: String(r[tgtCol] ?? 'Node B'),
      weight: Math.max(1, toFiniteNum(r[valCol]) || 1),
      row: r,
    }));

    if (widget.kind === 'arc_diagram') {
      const nodeSet = Array.from(new Set(edgeRows.flatMap((e) => [e.source, e.target]))).slice(0, 18);
      const padX = 36;
      const baseY = H - 38;
      const usableW = Math.max(160, W - padX * 2);
      const maxW = Math.max(1, ...edgeRows.map((e) => e.weight));
      const xOfNode = (nm: string) => {
        const idx = Math.max(0, nodeSet.indexOf(nm));
        return padX + (nodeSet.length <= 1 ? usableW / 2 : (idx / (nodeSet.length - 1)) * usableW);
      };
      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          <line x1={padX} y1={baseY} x2={W - padX} y2={baseY} stroke="var(--md-outline-variant)" />
          {edgeRows.map((e, idx) => {
            if (!nodeSet.includes(e.source) || !nodeSet.includes(e.target)) return null;
            const x1 = xOfNode(e.source);
            const x2 = xOfNode(e.target);
            const left = Math.min(x1, x2);
            const right = Math.max(x1, x2);
            const rx = Math.max(8, (right - left) / 2);
            const ry = Math.min(baseY - 14, rx * 0.78);
            const col = resolveSeriesColor(nodeSet.indexOf(e.source), cfg, widget.color);
            const fmt = formatMetricValue(e.weight, widget.format, widget.unit, fmtOpts);
            return (
              <path
                key={idx}
                d={`M ${left} ${baseY} A ${rx} ${ry} 0 0 1 ${right} ${baseY}`}
                fill="none"
                stroke={col}
                strokeWidth={1.4 + (e.weight / maxW) * 4.5}
                strokeOpacity={cfg?.fillOpacity ?? 0.55}
                className="chart-hit"
                onClick={() => onInspect(`${e.source} ↔ ${e.target}`, e.weight, cols[valCol] ?? 'weight', e.row)}
                onMouseEnter={() => onHover({ x: (left + right) / 2, y: baseY - ry, title: `${e.source} → ${e.target}`, detail: fmt })}
                onMouseLeave={() => onHover(null)}
              />
            );
          })}
          {nodeSet.map((nm, idx) => {
            const nx = xOfNode(nm);
            const col = resolveSeriesColor(idx, cfg, widget.color);
            return (
              <g key={nm}>
                <circle cx={nx} cy={baseY} r={cfg?.nodeSize ?? 5.5} fill={col} stroke="var(--md-surface-container-lowest)" strokeWidth={1.5} />
                <text x={nx} y={baseY + 16} textAnchor="middle" className="axis-tick" style={{ fontSize: 10 }}>
                  {nm.slice(0, 10)}
                </text>
              </g>
            );
          })}
        </svg>
      );
    }

    const net = layoutNetworkGraph(edgeRows, W, H, cfg?.nodeSize ?? 8);
    const maxW = Math.max(1, ...net.edges.map((e) => e.weight));
    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {net.edges.map((e, idx) => {
          const fmt = formatMetricValue(e.weight, widget.format, widget.unit, fmtOpts);
          return (
            <line
              key={idx}
              x1={e.source.x}
              y1={e.source.y}
              x2={e.target.x}
              y2={e.target.y}
              stroke="var(--md-outline)"
              strokeWidth={1.2 + (e.weight / maxW) * 3.5}
              strokeOpacity={0.55}
              className="chart-hit"
              onClick={() => onInspect(`${e.source.label} ↔ ${e.target.label}`, e.weight, cols[valCol] ?? 'weight', e.row)}
              onMouseEnter={() =>
                onHover({ x: (e.source.x + e.target.x) / 2, y: (e.source.y + e.target.y) / 2, title: `${e.source.label} ↔ ${e.target.label}`, detail: fmt })
              }
              onMouseLeave={() => onHover(null)}
            />
          );
        })}
        {net.nodes.map((n, idx) => {
          const col = resolveSeriesColor(idx, cfg, widget.color);
          return (
            <g
              key={n.id}
              className="chart-hit"
              onClick={() => onInspect(n.label, n.weight, 'hub_total', rows[0])}
            >
              <circle cx={n.x} cy={n.y} r={n.r} fill={col} fillOpacity={cfg?.fillOpacity ?? 0.9} stroke="var(--md-surface-container-lowest)" strokeWidth={2} />
              <text x={n.x} y={n.y - n.r - 4} textAnchor="middle" className="axis-tick" style={{ fill: 'var(--md-on-surface)', fontWeight: 600, fontSize: 10.5 }}>
                {n.label.slice(0, 14)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return null;
}

export function GeospatialMapSvg(p: SpecializedChartProps) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, width: W, height: H, onInspect, onHover } = p;
  const gradUid = useId();
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);
  const scope = MAP_SCOPE_VIEWBOX[cfg?.mapScope ?? 'world'];
  const latIdx = findColIndex(cols, widget.latField, cols.findIndex((c) => /origin_lat|^lat/i.test(c)));
  const lonIdx = findColIndex(cols, widget.lonField, cols.findIndex((c) => /origin_lon|^lon|^lng/i.test(c)));
  const dLatIdx = findColIndex(cols, widget.destLatField, cols.findIndex((c) => /dest_lat|to_lat/i.test(c)));
  const dLonIdx = findColIndex(cols, widget.destLonField, cols.findIndex((c) => /dest_lon|to_lon|to_lng/i.test(c)));
  const destNameIdx = seriesIdx >= 0 ? seriesIdx : cols.findIndex((c) => /dest_city|dest|target/i.test(c));

  const primaryTone = resolveSeriesColor(0, cfg, widget.color ?? 'blue');

  // Choropleth regional shading
  const regionTotals = new Map<string, { val: number; row: unknown[] }>();
  if (widget.kind === 'choropleth_map') {
    for (const r of rows) {
      const m = matchMacroRegion(String(r[xIdx] ?? ''));
      if (!m) continue;
      const v = toFiniteNum(r[yCol]);
      const prev = regionTotals.get(m);
      regionTotals.set(m, { val: (prev?.val ?? 0) + v, row: r });
    }
  }
  const maxRegVal = Math.max(1, ...Array.from(regionTotals.values()).map((v) => v.val));

  const maxRowVal = Math.max(1, ...rows.map((r) => Math.abs(toFiniteNum(r[yCol]))));

  return (
    <svg
      viewBox={`${scope.x} ${scope.y} ${scope.w} ${scope.h}`}
      style={{ height: H, width: '100%' }}
      preserveAspectRatio="xMidYMid meet"
      className="chart-svg geo-svg"
      role="img"
      aria-label={widget.title}
    >
      <defs>
        <radialGradient id={`${gradUid}-heat`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--c-red-accent)" stopOpacity={0.78} />
          <stop offset="45%" stopColor="var(--c-orange-accent)" stopOpacity={0.42} />
          <stop offset="100%" stopColor="var(--c-yellow-accent)" stopOpacity={0} />
        </radialGradient>
        <marker id={`${gradUid}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M 0 1 L 10 5 L 0 9 z" fill={primaryTone} />
        </marker>
      </defs>

      {/* Subtle Ocean & Graticule */}
      <rect x={scope.x} y={scope.y} width={scope.w} height={scope.h} rx={12} fill="color-mix(in srgb, var(--md-surface-container) 65%, transparent)" />
      {cfg?.showMapGraticule !== false &&
        [-60, -30, 0, 30, 60].map((lat) => {
          const { y } = projectGeo(lat, 0);
          return <line key={`lat-${lat}`} x1={0} y1={y} x2={800} y2={y} stroke="var(--md-outline-variant)" strokeOpacity={0.3} strokeDasharray="3 4" />;
        })}
      {cfg?.showMapGraticule !== false &&
        [-120, -60, 0, 60, 120].map((lon) => {
          const { x } = projectGeo(0, lon);
          return <line key={`lon-${lon}`} x1={x} y1={0} x2={x} y2={400} stroke="var(--md-outline-variant)" strokeOpacity={0.3} strokeDasharray="3 4" />;
        })}

      {/* Continent Polygons */}
      {WORLD_REGIONS.map((reg) => {
        const hit = regionTotals.get(reg.id);
        const ratio = hit ? Math.max(0.18, hit.val / maxRegVal) : 0;
        const fill =
          widget.kind === 'choropleth_map' && hit
            ? `color-mix(in srgb, ${primaryTone} ${Math.round(ratio * 84)}%, var(--md-surface-container-high))`
            : 'var(--md-surface-container-high)';
        const labelPt = projectGeo(reg.labelLat, reg.labelLon);
        const fmt = hit ? formatMetricValue(hit.val, widget.format, widget.unit, fmtOpts) : '';
        return (
          <g
            key={reg.id}
            className={widget.kind === 'choropleth_map' && hit ? 'chart-hit' : undefined}
            onClick={
              widget.kind === 'choropleth_map' && hit
                ? () => onInspect(reg.label, hit.val, cols[yCol] ?? 'value', hit.row)
                : undefined
            }
            onMouseEnter={
              widget.kind === 'choropleth_map' && hit
                ? () => onHover({ x: (labelPt.x / 800) * W, y: (labelPt.y / 400) * H, title: reg.label, detail: fmt })
                : undefined
            }
            onMouseLeave={widget.kind === 'choropleth_map' ? () => onHover(null) : undefined}
          >
            {reg.paths.map((d, pi) => (
              <path
                key={pi}
                d={d}
                fill={fill}
                stroke="var(--md-outline)"
                strokeOpacity={0.55}
                strokeWidth={1.1}
              />
            ))}
            {widget.kind === 'choropleth_map' && hit && cfg?.showMapLabels !== false && (
              <text x={labelPt.x} y={labelPt.y} textAnchor="middle" style={{ fontSize: 12, fontWeight: 700, fill: 'var(--md-on-surface)' }}>
                {reg.label}: {fmt}
              </text>
            )}
          </g>
        );
      })}

      {/* Point & Corridor Layers */}
      {widget.kind !== 'choropleth_map' &&
        rows.slice(0, cfg?.limitItems ?? 28).map((r, idx) => {
          const name = String(r[xIdx] ?? `Loc ${idx + 1}`);
          const [lat, lon] =
            latIdx >= 0 && lonIdx >= 0 && r[latIdx] != null && r[lonIdx] != null
              ? [toFiniteNum(r[latIdx]), toFiniteNum(r[lonIdx])]
              : resolveLocationCoords(name);
          const pt = projectGeo(lat, lon);
          const val = Math.max(0, toFiniteNum(r[yCol]));
          const fmt = formatMetricValue(val, widget.format, widget.unit, fmtOpts);
          const col = resolveSeriesColor(idx, cfg, widget.color);

          if (widget.kind === 'flow_map' || widget.kind === 'connection_map') {
            const destLabel = destNameIdx >= 0 ? String(r[destNameIdx] ?? 'Dest') : 'Hub';
            const [dLat, dLon] =
              dLatIdx >= 0 && dLonIdx >= 0 && r[dLatIdx] != null && r[dLonIdx] != null
                ? [toFiniteNum(r[dLatIdx]), toFiniteNum(r[dLonIdx])]
                : resolveLocationCoords(destLabel);
            const dPt = projectGeo(dLat, dLon);
            const midX = (pt.x + dPt.x) / 2;
            const midY = (pt.y + dPt.y) / 2 - Math.min(72, Math.hypot(dPt.x - pt.x, dPt.y - pt.y) * (cfg?.linkCurvature ?? 0.24));
            const sw = widget.kind === 'flow_map' ? 1.8 + (val / maxRowVal) * 6.5 : cfg?.strokeWidth ?? 2;
            return (
              <g
                key={idx}
                className="chart-hit"
                onClick={() => onInspect(`${name} → ${destLabel}`, val, cols[yCol] ?? 'flow', r)}
                onMouseEnter={() => onHover({ x: (midX / 800) * W, y: (midY / 400) * H, title: `${name} → ${destLabel}`, detail: fmt })}
                onMouseLeave={() => onHover(null)}
              >
                <path
                  d={`M ${pt.x} ${pt.y} Q ${midX} ${midY} ${dPt.x} ${dPt.y}`}
                  fill="none"
                  stroke={widget.kind === 'flow_map' ? primaryTone : col}
                  strokeWidth={sw}
                  strokeOpacity={cfg?.fillOpacity ?? 0.78}
                  strokeDasharray={widget.kind === 'connection_map' ? '5 3' : undefined}
                  markerEnd={widget.kind === 'flow_map' ? `url(#${gradUid}-arrow)` : undefined}
                />
                <circle cx={pt.x} cy={pt.y} r={4.5} fill={primaryTone} stroke="var(--md-surface-container-lowest)" strokeWidth={1.5} />
                <circle cx={dPt.x} cy={dPt.y} r={5} fill={col} stroke="var(--md-surface-container-lowest)" strokeWidth={1.5} />
                {cfg?.showMapLabels !== false && idx < 6 && (
                  <>
                    <text x={pt.x} y={pt.y - 8} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: 'var(--md-on-surface)' }}>
                      {name}
                    </text>
                    <text x={dPt.x} y={dPt.y - 8} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: 'var(--md-on-surface)' }}>
                      {destLabel}
                    </text>
                  </>
                )}
              </g>
            );
          }

          if (widget.kind === 'geo_heatmap') {
            const rad = 26 + (val / maxRowVal) * 44;
            return (
              <g
                key={idx}
                className="chart-hit"
                onClick={() => onInspect(name, val, cols[yCol] ?? 'intensity', r)}
                onMouseEnter={() => onHover({ x: (pt.x / 800) * W, y: (pt.y / 400) * H, title: name, detail: fmt })}
                onMouseLeave={() => onHover(null)}
              >
                <circle cx={pt.x} cy={pt.y} r={rad} fill={`url(#${gradUid}-heat)`} />
                <circle cx={pt.x} cy={pt.y} r={3.5} fill="var(--c-red-accent)" />
                {cfg?.showMapLabels !== false && (
                  <text x={pt.x} y={pt.y - 8} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: 'var(--md-on-surface)' }}>
                    {name}
                  </text>
                )}
              </g>
            );
          }

          const bubbleR =
            widget.kind === 'bubble_map'
              ? Math.max(7, Math.sqrt(val / maxRowVal) * (cfg?.nodeSize ? cfg.nodeSize * 2.2 : 28))
              : cfg?.nodeSize ?? 6.5;

          return (
            <g
              key={idx}
              className="chart-hit"
              onClick={() => onInspect(name, val, cols[yCol] ?? 'value', r)}
              onMouseEnter={() => onHover({ x: (pt.x / 800) * W, y: (pt.y / 400) * H, title: name, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            >
              <circle
                cx={pt.x}
                cy={pt.y}
                r={bubbleR}
                fill={col}
                fillOpacity={widget.kind === 'bubble_map' ? (cfg?.fillOpacity ?? 0.58) : 0.92}
                stroke={col}
                strokeWidth={1.8}
              />
              {widget.kind === 'bubble_map' && <circle cx={pt.x} cy={pt.y} r={2.5} fill="#ffffff" />}
              {cfg?.showMapLabels !== false && (
                <text x={pt.x} y={pt.y - bubbleR - 5} textAnchor="middle" style={{ fontSize: 10.5, fontWeight: 600, fill: 'var(--md-on-surface)' }}>
                  {name}
                </text>
              )}
            </g>
          );
        })}
    </svg>
  );
}

export function renderAdvancedAndMultiSvg(p: SpecializedChartProps) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, compIdx, width: W, height: H, onInspect, onHover } = p;
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);

  if (widget.kind === 'marimekko') {
    const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
    const cats = piv.categories;
    const activeSeries = piv.series.filter((s) => !p.mutedSeries.has(s.name));
    if (cats.length === 0 || activeSeries.length === 0) return null;

    const padL = cfg?.plotPaddingLeft ?? 42;
    const padR = cfg?.plotPaddingRight ?? 12;
    const padT = cfg?.plotPaddingTop ?? 12;
    const padB = cfg?.plotPaddingBottom ?? 28;
    const plotW = Math.max(120, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const colTotals = cats.map((_, ci) => activeSeries.reduce((s, ser) => s + Math.max(0, ser.values[ci] ?? 0), 0));
    const grand = Math.max(1, colTotals.reduce((a, b) => a + b, 0));
    let curX = padL;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.5, 1].map((t) => (
          <text key={t} x={padL - 6} y={padT + plotH * (1 - t) + 4} textAnchor="end" className="axis-tick">
            {Math.round(t * 100)}%
          </text>
        ))}
        {cats.map((cat, ci) => {
          const cw = Math.max(8, (colTotals[ci] / grand) * plotW);
          const xPos = curX;
          curX += cw;
          let curY = padT + plotH;
          const colTot = Math.max(1, colTotals[ci]);
          return (
            <g key={cat}>
              {activeSeries.map((ser, si) => {
                const v = Math.max(0, ser.values[ci] ?? 0);
                const sh = (v / colTot) * plotH;
                curY -= sh;
                const yPos = curY;
                const col = resolveSeriesColor(si, cfg, widget.color);
                const fmt = formatMetricValue(v, widget.format, widget.unit, fmtOpts);
                return (
                  <g
                    key={ser.name}
                    className="chart-hit"
                    onClick={() => onInspect(`${cat} · ${ser.name}`, v, ser.name, ser.rows[ci] ?? [cat, ser.name, v])}
                    onMouseEnter={() =>
                      onHover({
                        x: xPos + cw / 2,
                        y: yPos + sh / 2,
                        title: `${cat} · ${ser.name}`,
                        detail: `${fmt} (${Math.round((v / colTot) * 100)}% of ${cat})`,
                      })
                    }
                    onMouseLeave={() => onHover(null)}
                  >
                    <rect
                      x={xPos + 1}
                      y={yPos + 0.5}
                      width={Math.max(1, cw - 2)}
                      height={Math.max(1, sh - 1)}
                      fill={col}
                      fillOpacity={cfg?.fillOpacity ?? 0.86}
                    />
                    {cw > 52 && sh > 20 && (
                      <text x={xPos + cw / 2} y={yPos + sh / 2 + 4} textAnchor="middle" fill="#ffffff" style={{ fontSize: 10, fontWeight: 600 }}>
                        {Math.round((v / colTot) * 100)}%
                      </text>
                    )}
                  </g>
                );
              })}
              {cw > 34 && (
                <text x={xPos + cw / 2} y={H - 8} textAnchor="middle" className="axis-tick">
                  {cat.slice(0, Math.max(4, Math.floor(cw / 7)))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'parallel_coordinates') {
    const metricCols =
      yIndices.length >= 2
        ? yIndices
        : cols
            .map((_, idx) => idx)
            .filter((idx) => idx !== xIdx && typeof rows[0]?.[idx] === 'number');
    const axes = metricCols.length >= 2 ? metricCols.slice(0, 7) : [yCol, yCol];
    const padL = 36;
    const padR = 36;
    const padT = 22;
    const padB = 24;
    const plotW = Math.max(120, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);

    const bounds = axes.map((colIdx) => {
      const vals = rows.map((r) => toFiniteNum(r[colIdx]));
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      return { colIdx, name: cols[colIdx] ?? 'Metric', min, max: max > min ? max : min + 1 };
    });

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {bounds.map((b, ai) => {
          const ax = padL + (ai / Math.max(1, bounds.length - 1)) * plotW;
          return (
            <g key={`${b.name}-${ai}`}>
              <line x1={ax} y1={padT} x2={ax} y2={padT + plotH} stroke="var(--md-outline)" strokeOpacity={0.65} />
              <text x={ax} y={13} textAnchor="middle" className="axis-tick" style={{ fontWeight: 600 }}>
                {b.name.replace(/_/g, ' ').slice(0, 14)}
              </text>
              <text x={ax} y={H - 6} textAnchor="middle" className="axis-tick" style={{ fontSize: 9.5 }}>
                {formatMetricValue(b.min, 'compact')}–{formatMetricValue(b.max, 'compact')}
              </text>
            </g>
          );
        })}
        {rows.slice(0, cfg?.limitItems ?? 20).map((r, ri) => {
          const label = String(r[xIdx] ?? `#${ri + 1}`);
          if (p.mutedSeries.has(label)) return null;
          const pts = bounds.map((b, ai) => {
            const v = toFiniteNum(r[b.colIdx]);
            const x = padL + (ai / Math.max(1, bounds.length - 1)) * plotW;
            const y = padT + plotH - ((v - b.min) / (b.max - b.min)) * plotH;
            return { x, y };
          });
          const col = resolveSeriesColor(ri, cfg, widget.color);
          const d = buildCurvePath(pts, cfg?.curveType ?? 'linear');
          return (
            <g
              key={`${label}-${ri}`}
              className="chart-hit"
              onClick={() => onInspect(label, r[bounds[0].colIdx], bounds[0].name, r)}
              onMouseEnter={() =>
                onHover({
                  x: pts[Math.floor(pts.length / 2)].x,
                  y: pts[Math.floor(pts.length / 2)].y,
                  title: label,
                  detail: bounds.map((b) => `${b.name}: ${formatMetricValue(r[b.colIdx], 'compact')}`).join(' · '),
                })
              }
              onMouseLeave={() => onHover(null)}
            >
              <path d={d} fill="none" stroke={col} strokeWidth={cfg?.strokeWidth ?? 2.1} strokeOpacity={cfg?.fillOpacity ?? 0.78} />
              {pts.map((pt, pi) => (
                <circle key={pi} cx={pt.x} cy={pt.y} r={3.2} fill={col} />
              ))}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'waterfall') {
    const rawSteps = rows.slice(0, cfg?.limitItems ?? 14).map((r, i) => ({
      label: String(r[xIdx] ?? `Step ${i + 1}`),
      delta: toFiniteNum(r[yCol]),
      row: r,
    }));
    let running = 0;
    const bars: { label: string; from: number; to: number; delta: number; isTotal: boolean; row: unknown[] }[] = [];
    for (const s of rawSteps) {
      const next = running + s.delta;
      bars.push({ label: s.label, from: running, to: next, delta: s.delta, isTotal: false, row: s.row });
      running = next;
    }
    bars.push({ label: 'Net Total', from: 0, to: running, delta: running, isTotal: true, row: rows[rows.length - 1] ?? ['Net Total', running] });

    const allVals = [0, ...bars.flatMap((b) => [b.from, b.to])];
    const lo = Math.min(...allVals);
    const hi = Math.max(...allVals);
    const span = Math.max(1, hi - lo);
    const padL = cfg?.plotPaddingLeft ?? 56;
    const padR = cfg?.plotPaddingRight ?? 16;
    const padT = cfg?.plotPaddingTop ?? 18;
    const padB = cfg?.plotPaddingBottom ?? 30;
    const plotW = Math.max(120, W - padL - padR);
    const plotH = Math.max(80, H - padT - padB);
    const yOf = (v: number) => padT + plotH - ((v - lo) / span) * plotH;
    const slotW = plotW / bars.length;
    const bw = Math.max(14, Math.min(58, slotW * 0.64));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0, 0.5, 1].map((t) => {
          const v = lo + span * t;
          const gy = yOf(v);
          return (
            <g key={t}>
              <line x1={padL} y1={gy} x2={W - padR} y2={gy} stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.5} />
              <text x={padL - 8} y={gy + 4} textAnchor="end" className="axis-tick">
                {formatMetricValue(v, 'compact')}
              </text>
            </g>
          );
        })}
        <line x1={padL} y1={yOf(0)} x2={W - padR} y2={yOf(0)} stroke="var(--md-outline)" strokeOpacity={0.75} />
        {bars.map((b, idx) => {
          const cx = padL + (idx + 0.5) * slotW;
          const top = yOf(Math.max(b.from, b.to));
          const bot = yOf(Math.min(b.from, b.to));
          const tone = b.isTotal
            ? resolveSeriesColor(0, cfg, widget.color ?? 'blue')
            : b.delta >= 0
              ? 'var(--c-green-accent)'
              : 'var(--c-red-accent)';
          const fmt = formatMetricValue(b.delta, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={`${b.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(b.label, b.delta, cols[yCol] ?? 'delta', b.row)}
              onMouseEnter={() => onHover({ x: cx, y: top, title: b.label, detail: `${b.delta >= 0 && !b.isTotal ? '+' : ''}${fmt}` })}
              onMouseLeave={() => onHover(null)}
            >
              {idx > 0 && (
                <line
                  x1={padL + (idx - 0.5) * slotW + bw / 2}
                  y1={yOf(bars[idx - 1].to)}
                  x2={cx - bw / 2}
                  y2={yOf(bars[idx - 1].to)}
                  stroke="var(--md-outline)"
                  strokeDasharray="3 2"
                />
              )}
              <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(3, bot - top)} rx={cfg?.barRadius ?? 5} fill={tone} fillOpacity={cfg?.fillOpacity ?? 0.9} />
              {cfg?.showDataLabels !== false && (
                <text x={cx} y={top - 5} textAnchor="middle" className="axis-tick" style={{ fontSize: 10, fontWeight: 600 }}>
                  {b.delta >= 0 && !b.isTotal ? `+${fmt}` : fmt}
                </text>
              )}
              <text x={cx} y={H - 8} textAnchor="middle" className="axis-tick">
                {b.label.slice(0, 12)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'spiral_plot') {
    const items = rows.slice(0, cfg?.limitItems ?? 36).map((r, i) => ({
      label: String(r[xIdx] ?? `#${i + 1}`),
      val: Math.max(0, toFiniteNum(r[yCol])),
      row: r,
    }));
    const maxV = Math.max(1, ...items.map((it) => it.val));
    const cx = W / 2;
    const cy = H / 2;
    const maxR = Math.min(W, H) * 0.42;
    const minR = maxR * 0.18;
    const turns = 2.15;

    const spiralPts = items.map((it, idx) => {
      const t = idx / Math.max(1, items.length - 1);
      const angle = -Math.PI / 2 + t * Math.PI * 2 * turns;
      const baseR = minR + t * (maxR - minR);
      const amp = (it.val / maxV) * 18;
      return {
        it,
        idx,
        angle,
        x0: cx + Math.cos(angle) * baseR,
        y0: cy + Math.sin(angle) * baseR,
        x1: cx + Math.cos(angle) * (baseR + Math.max(3, amp)),
        y1: cy + Math.sin(angle) * (baseR + Math.max(3, amp)),
      };
    });
    const guideD = buildCurvePath(spiralPts.map((s) => ({ x: s.x0, y: s.y0 })), 'monotone');

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        <path d={guideD} fill="none" stroke="var(--md-outline-variant)" strokeDasharray="3 3" />
        {spiralPts.map((sp) => {
          const col = resolveSeriesColor(sp.idx, cfg, widget.color);
          const fmt = formatMetricValue(sp.it.val, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={sp.idx}
              className="chart-hit"
              onClick={() => onInspect(sp.it.label, sp.it.val, cols[yCol] ?? 'value', sp.it.row)}
              onMouseEnter={() => onHover({ x: sp.x1, y: sp.y1, title: sp.it.label, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            >
              <line x1={sp.x0} y1={sp.y0} x2={sp.x1} y2={sp.y1} stroke={col} strokeWidth={Math.max(4, Math.min(10, 220 / items.length))} strokeLinecap="round" />
              {(sp.idx === 0 || sp.idx === spiralPts.length - 1) && (
                <text x={sp.x1 + 6} y={sp.y1 + 3} className="axis-tick" style={{ fontSize: 10 }}>
                  {sp.it.label.slice(0, 9)}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'proportional_area') {
    const items = rows
      .slice(0, cfg?.limitItems ?? 8)
      .map((r, i) => ({ label: String(r[xIdx] ?? `#${i + 1}`), val: Math.max(0, toFiniteNum(r[yCol])), row: r }))
      .filter((it) => !p.mutedSeries.has(it.label));
    const maxV = Math.max(1, ...items.map((i) => i.val));
    const slotW = W / Math.max(1, items.length);
    const maxR = Math.min(slotW * 0.42, (H - 46) * 0.46);
    const baseY = H - 30;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        <line x1={18} y1={baseY} x2={W - 18} y2={baseY} stroke="var(--md-outline-variant)" />
        {items.map((it, idx) => {
          const r = Math.max(6, maxR * Math.sqrt(it.val / maxV));
          const cx = (idx + 0.5) * slotW;
          const cy = baseY - r;
          const col = resolveSeriesColor(idx, cfg, widget.color);
          const fmt = formatMetricValue(it.val, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={`${it.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(it.label, it.val, cols[yCol] ?? 'value', it.row)}
              onMouseEnter={() => onHover({ x: cx, y: cy - r, title: it.label, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            >
              <circle cx={cx} cy={cy} r={r} fill={col} fillOpacity={cfg?.fillOpacity ?? 0.72} stroke={col} strokeWidth={1.75} />
              <text x={cx} y={cy - r - 6} textAnchor="middle" className="axis-tick" style={{ fontWeight: 600, fill: 'var(--md-on-surface)' }}>
                {fmt}
              </text>
              <text x={cx} y={H - 10} textAnchor="middle" className="axis-tick">
                {it.label.slice(0, 12)}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  if (widget.kind === 'gauge') {
    const items = rows.slice(0, 5).map((r, i) => ({
      label: String(r[xIdx] ?? widget.title ?? `Metric ${i + 1}`),
      val: Math.max(0, toFiniteNum(r[yCol])),
      target: compIdx >= 0 ? toFiniteNum(r[compIdx]) : undefined,
      row: r,
    }));
    const cx = W / 2;
    if (items.length <= 1) {
      // Classic Semicircular Executive Gauge with qualitative bands & target marker
      const actual = items[0]?.val ?? 0;
      const maxVal = cfg?.yMax ?? cfg?.targetValue ?? items[0]?.target ?? (widget.format === 'percent' ? 100 : Math.max(100, actual * 1.25));
      const ratio = Math.max(0, Math.min(1, actual / Math.max(1e-6, maxVal)));
      const cy = H * 0.74;
      const R = Math.min(W * 0.36, H * 0.58);
      const arc = (t0: number, t1: number) => {
        const a0 = Math.PI + t0 * Math.PI;
        const a1 = Math.PI + t1 * Math.PI;
        const x0 = cx + R * Math.cos(a0);
        const y0 = cy + R * Math.sin(a0);
        const x1 = cx + R * Math.cos(a1);
        const y1 = cy + R * Math.sin(a1);
        return `M ${x0} ${y0} A ${R} ${R} 0 0 1 ${x1} ${y1}`;
      };
      const col = resolveSeriesColor(0, cfg, widget.color ?? 'teal');
      const fmt = formatMetricValue(actual, widget.format, widget.unit, fmtOpts);
      const targetVal = cfg?.targetValue ?? items[0]?.target;

      return (
        <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
          <path d={arc(0, 1)} fill="none" stroke="var(--md-surface-container-highest)" strokeWidth={18} strokeLinecap="round" />
          <path
            d={arc(0, Math.max(0.02, ratio))}
            fill="none"
            stroke={col}
            strokeWidth={18}
            strokeLinecap="round"
            className="chart-hit"
            onClick={() => onInspect(widget.title, actual, cols[yCol] ?? 'value', items[0]?.row ?? [actual])}
          />
          {typeof targetVal === 'number' && targetVal > 0 && targetVal <= maxVal && (() => {
            const ta = Math.PI + (targetVal / maxVal) * Math.PI;
            return (
              <line
                x1={cx + (R - 13) * Math.cos(ta)}
                y1={cy + (R - 13) * Math.sin(ta)}
                x2={cx + (R + 13) * Math.cos(ta)}
                y2={cy + (R + 13) * Math.sin(ta)}
                stroke="var(--md-on-surface)"
                strokeWidth={2.5}
              />
            );
          })()}
          <text x={cx} y={cy - 10} textAnchor="middle" className="donut-center-text" style={{ fontSize: 22 }}>
            {fmt}
          </text>
          <text x={cx} y={cy + 14} textAnchor="middle" className="axis-tick">
            {cfg?.donutCenterSubtext || `of ${formatMetricValue(maxVal, widget.format, widget.unit, fmtOpts)}`}
          </text>
        </svg>
      );
    }

    // Multi-Value Concentric Activity Gauge (Holistics #38)
    const maxVal = cfg?.yMax ?? cfg?.targetValue ?? (widget.format === 'percent' ? 100 : Math.max(1, ...items.map((i) => i.val)));
    const gcx = Math.min(W * 0.36, 115);
    const gcy = H / 2;
    const outerR = Math.min(gcx - 14, H * 0.44);
    const ringStep = Math.max(10, Math.min(16, (outerR - 18) / items.length));

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {items.map((it, idx) => {
          const r = outerR - idx * ringStep;
          const ratio = Math.max(0.03, Math.min(0.999, it.val / Math.max(1e-6, maxVal)));
          const start = -Math.PI / 2;
          const end = start + ratio * Math.PI * 2;
          const x1 = gcx + r * Math.cos(start);
          const y1 = gcy + r * Math.sin(start);
          const x2 = gcx + r * Math.cos(end);
          const y2 = gcy + r * Math.sin(end);
          const large = ratio > 0.5 ? 1 : 0;
          const col = resolveSeriesColor(idx, cfg, widget.color);
          const fmt = formatMetricValue(it.val, widget.format, widget.unit, fmtOpts);
          const ly = 28 + idx * 34;
          return (
            <g
              key={`${it.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(it.label, it.val, cols[yCol] ?? 'value', it.row)}
              onMouseEnter={() => onHover({ x: gcx, y: gcy - r, title: it.label, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            >
              <circle cx={gcx} cy={gcy} r={r} fill="none" stroke="var(--md-surface-container-highest)" strokeWidth={ringStep - 4} />
              <path
                d={`M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`}
                fill="none"
                stroke={col}
                strokeWidth={ringStep - 4}
                strokeLinecap="round"
              />
              <circle cx={gcx + outerR + 22} cy={ly} r={5} fill={col} />
              <text x={gcx + outerR + 34} y={ly + 4} className="axis-tick" style={{ fill: 'var(--md-on-surface)', fontWeight: 500 }}>
                {it.label.slice(0, 16)}
              </text>
              <text x={W - 10} y={ly + 4} textAnchor="end" className="axis-tick" style={{ fontWeight: 600 }}>
                {fmt}
              </text>
            </g>
          );
        })}
      </svg>
    );
  }

  return null;
}

export function renderPolarCompareSvg(
  p: SpecializedChartProps & { items: { label: string; value: number; raw: unknown; row: unknown[] }[] },
) {
  const { widget, cols, rows, xIdx, yIndices, seriesIdx, width: W, height: H, items, onInspect, onHover } = p;
  const cfg = widget.chartConfig;
  const fmtOpts = { decimals: cfg?.decimals, prefix: cfg?.prefix, suffix: cfg?.suffix };
  const yCol = yIndices[0] ?? Math.min(1, cols.length - 1);
  const cx = W / 2;
  const cy = H / 2;
  const R = Math.min(W, H) * 0.39;

  if (widget.kind === 'nightingale_rose') {
    const active = items.filter((it) => !p.mutedSeries.has(it.label)).slice(0, 16);
    if (active.length === 0) return null;
    const maxV = Math.max(1, ...active.map((i) => Math.max(0, i.value)));
    const innerR = (cfg?.innerRadiusRatio ?? 0.14) * R;
    const sliceAngle = (Math.PI * 2) / active.length;
    const padRad = ((cfg?.padAngle ?? 2) * Math.PI) / 180;
    const startBase = ((cfg?.startAngle ?? -90) * Math.PI) / 180;

    return (
      <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
        {[0.33, 0.66, 1].map((t) => (
          <circle key={t} cx={cx} cy={cy} r={innerR + (R - innerR) * t} fill="none" stroke="var(--md-outline-variant)" strokeDasharray="3 3" strokeOpacity={0.5} />
        ))}
        {active.map((it, idx) => {
          const a0 = startBase + idx * sliceAngle + padRad / 2;
          const a1 = startBase + (idx + 1) * sliceAngle - padRad / 2;
          const ro = innerR + Math.max(0.08, Math.max(0, it.value) / maxV) * (R - innerR);
          const x1 = cx + ro * Math.cos(a0);
          const y1 = cy + ro * Math.sin(a0);
          const x2 = cx + ro * Math.cos(a1);
          const y2 = cy + ro * Math.sin(a1);
          const x3 = cx + innerR * Math.cos(a1);
          const y3 = cy + innerR * Math.sin(a1);
          const x4 = cx + innerR * Math.cos(a0);
          const y4 = cy + innerR * Math.sin(a0);
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const mid = (a0 + a1) / 2;
          const col = resolveSeriesColor(idx, cfg, widget.color);
          const fmt = formatMetricValue(it.value, widget.format, widget.unit, fmtOpts);
          return (
            <g
              key={`${it.label}-${idx}`}
              className="chart-hit"
              onClick={() => onInspect(it.label, it.raw, cols[yCol] ?? 'value', it.row)}
              onMouseEnter={() => onHover({ x: cx + (ro / 2) * Math.cos(mid), y: cy + (ro / 2) * Math.sin(mid), title: it.label, detail: fmt })}
              onMouseLeave={() => onHover(null)}
            >
              <path
                d={`M ${x1} ${y1} A ${ro} ${ro} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${innerR} ${innerR} 0 ${large} 0 ${x4} ${y4} Z`}
                fill={col}
                fillOpacity={cfg?.fillOpacity ?? 0.85}
                stroke="var(--md-surface-container-lowest)"
                strokeWidth={1.5}
              />
              {cfg?.showDataLabels !== false && (
                <text
                  x={cx + (ro + 13) * Math.cos(mid)}
                  y={cy + (ro + 13) * Math.sin(mid) + 3}
                  textAnchor={Math.cos(mid) >= 0 ? 'start' : 'end'}
                  className="axis-tick"
                  style={{ fontSize: 10 }}
                >
                  {it.label.slice(0, 11)}: {fmt}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    );
  }

  // Radar / Spider Chart
  const piv = pivotMultiSeries(rows, cols, xIdx, seriesIdx, yIndices, cfg);
  const spokes = piv.categories.slice(0, 10);
  const activeSeries = piv.series.filter((s) => !p.mutedSeries.has(s.name));
  if (spokes.length < 3 || activeSeries.length === 0) return null;
  const maxVal = cfg?.yMax ?? Math.max(1, ...activeSeries.flatMap((s) => s.values));

  const spokeAngle = (i: number) => -Math.PI / 2 + (i / spokes.length) * Math.PI * 2;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ height: H }} className="chart-svg cartesian-svg" role="img" aria-label={widget.title}>
      {[0.25, 0.5, 0.75, 1].map((t) => {
        const ringPts = spokes
          .map((_, si) => {
            const a = spokeAngle(si);
            return `${(cx + R * t * Math.cos(a)).toFixed(1)},${(cy + R * t * Math.sin(a)).toFixed(1)}`;
          })
          .join(' ');
        return <polygon key={t} points={ringPts} fill="none" stroke="var(--md-outline-variant)" strokeOpacity={0.55} strokeDasharray={t < 1 ? '3 3' : undefined} />;
      })}
      {spokes.map((sp, si) => {
        const a = spokeAngle(si);
        const xEnd = cx + R * Math.cos(a);
        const yEnd = cy + R * Math.sin(a);
        const lx = cx + (R + 15) * Math.cos(a);
        const ly = cy + (R + 15) * Math.sin(a);
        return (
          <g key={sp}>
            <line x1={cx} y1={cy} x2={xEnd} y2={yEnd} stroke="var(--md-outline-variant)" strokeOpacity={0.6} />
            <text x={lx} y={ly + 3} textAnchor={Math.abs(Math.cos(a)) < 0.2 ? 'middle' : Math.cos(a) > 0 ? 'start' : 'end'} className="axis-tick" style={{ fontSize: 10.5 }}>
              {sp.slice(0, 13)}
            </text>
          </g>
        );
      })}
      {activeSeries.map((ser, si) => {
        const col = resolveSeriesColor(si, cfg, widget.color);
        const pts = spokes.map((sp, idx) => {
          const v = Math.max(0, ser.values[idx] ?? 0);
          const ratio = Math.min(1, v / maxVal);
          const a = spokeAngle(idx);
          return { x: cx + R * ratio * Math.cos(a), y: cy + R * ratio * Math.sin(a), v, sp, row: ser.rows[idx] };
        });
        return (
          <g key={ser.name}>
            <polygon
              points={pts.map((pt) => `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`).join(' ')}
              fill={col}
              fillOpacity={cfg?.fillOpacity ?? 0.22}
              stroke={col}
              strokeWidth={cfg?.strokeWidth ?? 2.2}
            />
            {pts.map((pt, idx) => {
              const fmt = formatMetricValue(pt.v, widget.format, widget.unit, fmtOpts);
              return (
                <circle
                  key={idx}
                  cx={pt.x}
                  cy={pt.y}
                  r={cfg?.markerSize ?? 4}
                  fill={col}
                  stroke="var(--md-surface-container-lowest)"
                  strokeWidth={1.5}
                  className="chart-hit"
                  onClick={() => onInspect(`${ser.name} · ${pt.sp}`, pt.v, ser.name, pt.row ?? [pt.sp, pt.v])}
                  onMouseEnter={() => onHover({ x: pt.x, y: pt.y, title: `${ser.name} · ${pt.sp}`, detail: fmt })}
                  onMouseLeave={() => onHover(null)}
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}
