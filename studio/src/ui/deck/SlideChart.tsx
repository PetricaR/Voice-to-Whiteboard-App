/**
 * A slide chart drawn as SVG in slide pixels (96 per inch), styled like the
 * native PowerPoint chart the export writes (deck-export/pptx.ts): data labels
 * instead of a value axis on bars and columns, a light grid on lines, the
 * highlighted category in the theme's dominant color.
 */
import { memo } from 'react';
import { formatChartValue, type ChartEl, type DeckTheme } from '../../engine/deckLayout';

const PX = 96 / 72;
const hex = (c: string) => `#${c}`;

function niceTicks(min: number, max: number, count = 5): number[] {
  if (max === min) max = min + 1;
  const span = max - min;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => span / s <= count) ?? 10 * mag;
  const start = Math.floor(min / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= max + step * 0.5; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** Trims a label to fit `px` at a font size. */
function fit(label: string, px: number, size: number): string {
  const max = Math.max(3, Math.floor(px / (size * 0.52)));
  return label.length > max ? `${label.slice(0, max - 1)}…` : label;
}

function Legend({ names, colors, x, y, w, t, font }: { names: string[]; colors: string[]; x: number; y: number; w: number; t: DeckTheme; font: string }) {
  const size = 12 * PX;
  const widths = names.map((n) => Math.min(220, n.length * size * 0.55 + 30));
  const total = widths.reduce((a, b) => a + b, 0);
  let cx = x + Math.max(0, (w - total) / 2);
  return (
    <g>
      {names.map((n, i) => {
        const gx = cx;
        cx += widths[i];
        return (
          <g key={n + i}>
            <rect x={gx} y={y - size * 0.7} width={size * 0.8} height={size * 0.8} rx={2} fill={hex(colors[i])} />
            <text x={gx + size * 1.1} y={y} fontSize={size} fill={hex(t.muted)} fontFamily={font}>{fit(n, widths[i] - 30, size)}</text>
          </g>
        );
      })}
    </g>
  );
}

function ChartView({ el, theme: t, font }: { el: ChartEl; theme: DeckTheme; font: string }) {
  const W = el.w * 96;
  const H = el.h * 96;
  const c = el.chart;
  const n = c.categories.length;
  const labelSize = 12 * PX;
  const dataSize = 12 * PX;
  const fmt = (v: number) => formatChartValue(v, c);
  const multi = c.series.length > 1;
  const colorOf = (si: number, ci: number) => hex(el.perPoint ? el.colors[ci] ?? el.colors[0] : el.colors[si] ?? el.colors[0]);
  const legendH = multi ? 34 : 0;

  if (n === 0) return null;

  if (c.type === 'donut') {
    const vals = c.series[0].values.map((v) => Math.max(0, v));
    const total = vals.reduce((a, b) => a + b, 0) || 1;
    const legendW = Math.min(W * 0.42, 330);
    const r = Math.min((W - legendW) / 2, H / 2) - 12;
    const cx = (W - legendW) / 2;
    const cy = H / 2;
    const inner = r * 0.62;
    let angle = -Math.PI / 2;
    const arcs = vals.map((v, i) => {
      const a0 = angle;
      const a1 = angle + (v / total) * Math.PI * 2;
      angle = a1;
      const large = a1 - a0 > Math.PI ? 1 : 0;
      const p = (a: number, rr: number) => `${cx + rr * Math.cos(a)} ${cy + rr * Math.sin(a)}`;
      const d = v >= total - 1e-9
        ? `M ${p(0, r)} A ${r} ${r} 0 1 1 ${p(Math.PI, r)} A ${r} ${r} 0 1 1 ${p(0, r)} M ${p(0, inner)} A ${inner} ${inner} 0 1 0 ${p(Math.PI, inner)} A ${inner} ${inner} 0 1 0 ${p(0, inner)} Z`
        : `M ${p(a0, r)} A ${r} ${r} 0 ${large} 1 ${p(a1, r)} L ${p(a1, inner)} A ${inner} ${inner} 0 ${large} 0 ${p(a0, inner)} Z`;
      const mid = (a0 + a1) / 2;
      const lr = (r + inner) / 2;
      return { d, i, share: v / total, lx: cx + lr * Math.cos(mid), ly: cy + lr * Math.sin(mid) };
    });
    const rowH = Math.min(44, (H - 20) / n);
    const ly0 = cy - (rowH * n) / 2 + rowH / 2;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Donut chart">
        {arcs.map((a) => <path key={a.i} d={a.d} fill={colorOf(0, a.i)} fillRule="evenodd" />)}
        {arcs.filter((a) => a.share >= 0.05).map((a) => (
          <text key={`l${a.i}`} x={a.lx} y={a.ly} fontSize={dataSize} fill="#FFFFFF" textAnchor="middle" dominantBaseline="central" fontFamily={font} fontWeight={600}>
            {Math.round(a.share * 100)}%
          </text>
        ))}
        {c.categories.map((cat, i) => (
          <g key={cat + i} transform={`translate(${W - legendW + 10} ${ly0 + i * rowH})`}>
            <rect x={0} y={-9} width={18} height={18} rx={3} fill={colorOf(0, i)} />
            <text x={30} y={0} fontSize={13 * PX} fill={hex(t.ink)} dominantBaseline="central" fontFamily={font}>{fit(cat, legendW - 50, 13 * PX)}</text>
          </g>
        ))}
      </svg>
    );
  }

  if (c.type === 'bar') {
    const labelW = Math.min(W * 0.34, Math.max(...c.categories.map((x) => x.length)) * labelSize * 0.55 + 16);
    const valueW = Math.max(...c.series.flatMap((s) => s.values.map((v) => fmt(v).length))) * dataSize * 0.58 + 14;
    const top = 6;
    const plotH = H - top - legendH - 6;
    const band = plotH / n;
    const inner = band / 1.6;
    const bar = inner / c.series.length;
    const max = Math.max(1e-9, ...c.series.flatMap((s) => s.values));
    const plotW = W - labelW - valueW;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Bar chart">
        <line x1={labelW} x2={labelW} y1={top} y2={top + plotH} stroke={hex(t.rule)} strokeWidth={1.3} />
        {c.categories.map((cat, ci) => {
          const y0 = top + ci * band + (band - inner) / 2;
          return (
            <g key={cat + ci}>
              <text x={labelW - 10} y={top + ci * band + band / 2} fontSize={labelSize} fill={hex(t.muted)} textAnchor="end" dominantBaseline="central" fontFamily={font}>
                {fit(cat, labelW - 14, labelSize)}
              </text>
              {c.series.map((s, si) => {
                const v = Math.max(0, s.values[ci] ?? 0);
                const bw = (v / max) * plotW;
                return (
                  <g key={si}>
                    <rect x={labelW} y={y0 + si * bar} width={Math.max(0, bw)} height={bar - (multi ? 2 : 0)} fill={colorOf(si, ci)} />
                    <text x={labelW + bw + 8} y={y0 + si * bar + bar / 2} fontSize={dataSize} fill={hex(t.ink)} dominantBaseline="central" fontFamily={font}>{fmt(s.values[ci] ?? 0)}</text>
                  </g>
                );
              })}
            </g>
          );
        })}
        {multi && <Legend names={c.series.map((s) => s.name)} colors={c.series.map((_, i) => el.colors[i])} x={0} y={H - 10} w={W} t={t} font={font} />}
      </svg>
    );
  }

  if (c.type === 'column' || c.type === 'stacked_column') {
    const stacked = c.type === 'stacked_column';
    const top = 30;
    const catH = 46;
    const plotH = H - top - catH - legendH;
    const band = W / n;
    const inner = band / 1.6;
    const sums = c.categories.map((_, ci) => c.series.reduce((a, s) => a + Math.max(0, s.values[ci] ?? 0), 0));
    const max = Math.max(1e-9, ...(stacked ? sums : c.series.flatMap((s) => s.values)));
    const base = top + plotH;
    const bar = stacked ? inner : inner / c.series.length;
    return (
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Column chart">
        {c.categories.map((cat, ci) => {
          const x0 = ci * band + (band - inner) / 2;
          let acc = 0;
          return (
            <g key={cat + ci}>
              {c.series.map((s, si) => {
                const v = Math.max(0, s.values[ci] ?? 0);
                const h = (v / max) * plotH;
                const x = stacked ? x0 : x0 + si * bar;
                const y = stacked ? base - acc - h : base - h;
                acc += stacked ? h : 0;
                return (
                  <g key={si}>
                    <rect x={x} y={y} width={bar - (multi && !stacked ? 2 : 0)} height={h} fill={colorOf(si, ci)} />
                    {stacked
                      ? h > dataSize * 1.4 && (
                          <text x={x + bar / 2} y={y + h / 2} fontSize={dataSize} fill="#FFFFFF" textAnchor="middle" dominantBaseline="central" fontFamily={font}>{fmt(s.values[ci] ?? 0)}</text>
                        )
                      : (
                          <text x={x + bar / 2} y={y - 8} fontSize={multi ? dataSize * 0.85 : dataSize} fill={hex(t.ink)} textAnchor="middle" fontFamily={font}>{fmt(s.values[ci] ?? 0)}</text>
                        )}
                  </g>
                );
              })}
              <text x={ci * band + band / 2} y={base + 24} fontSize={labelSize} fill={hex(t.muted)} textAnchor="middle" fontFamily={font}>
                {fit(cat, band - 6, labelSize)}
              </text>
            </g>
          );
        })}
        <line x1={0} x2={W} y1={base} y2={base} stroke={hex(t.rule)} strokeWidth={1.3} />
        {multi && <Legend names={c.series.map((s) => s.name)} colors={c.series.map((_, i) => el.colors[i])} x={0} y={H - 10} w={W} t={t} font={font} />}
      </svg>
    );
  }

  // line / area
  const all = c.series.flatMap((s) => s.values);
  const ticks = niceTicks(Math.min(0, ...all), Math.max(...all));
  const lo = ticks[0];
  const hi = ticks[ticks.length - 1];
  const axisW = Math.max(...ticks.map((v) => fmt(v).length)) * 11 * PX * 0.58 + 12;
  const top = 26;
  const catH = 40;
  const plotH = H - top - catH - legendH;
  const plotW = W - axisW - 12;
  const xAt = (i: number) => axisW + (n === 1 ? plotW / 2 : (i * plotW) / (n - 1));
  const yAt = (v: number) => top + plotH - ((v - lo) / (hi - lo || 1)) * plotH;
  const every = Math.ceil(n / Math.max(1, Math.floor(plotW / (labelSize * 5))));
  const labels = c.series.length === 1 && n <= 8;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={c.type === 'area' ? 'Area chart' : 'Line chart'}>
      {ticks.map((v) => (
        <g key={v}>
          <line x1={axisW} x2={W - 12} y1={yAt(v)} y2={yAt(v)} stroke="#E6E9EF" strokeWidth={1} />
          <text x={axisW - 8} y={yAt(v)} fontSize={11 * PX} fill={hex(t.muted)} textAnchor="end" dominantBaseline="central" fontFamily={font}>{fmt(v)}</text>
        </g>
      ))}
      <line x1={axisW} x2={W - 12} y1={yAt(lo)} y2={yAt(lo)} stroke={hex(t.rule)} strokeWidth={1.3} />
      {c.categories.map((cat, i) => (i % every === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= every) ? (
        <text key={cat + i} x={xAt(i)} y={top + plotH + 26} fontSize={labelSize} fill={hex(t.muted)} textAnchor="middle" fontFamily={font}>{fit(cat, every * (plotW / Math.max(1, n - 1)) - 4, labelSize)}</text>
      ) : null)}
      {c.series.map((s, si) => {
        const pts = s.values.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
        const color = hex(el.colors[si] ?? el.colors[0]);
        return (
          <g key={s.name + si}>
            {c.type === 'area' && (
              <polygon points={`${xAt(0)},${yAt(lo)} ${pts} ${xAt(n - 1)},${yAt(lo)}`} fill={color} opacity={0.35} />
            )}
            <polyline points={pts} fill="none" stroke={color} strokeWidth={c.type === 'line' ? 2.5 * PX : 1.6} strokeLinejoin="round" strokeLinecap="round" />
            {c.type === 'line' && n <= 12 && s.values.map((v, i) => <circle key={i} cx={xAt(i)} cy={yAt(v)} r={4.7} fill={color} />)}
            {labels && s.values.map((v, i) => (
              <text key={`v${i}`} x={xAt(i)} y={yAt(v) - 12} fontSize={dataSize} fill={hex(t.ink)} textAnchor="middle" fontFamily={font}>{fmt(v)}</text>
            ))}
          </g>
        );
      })}
      {multi && <Legend names={c.series.map((s) => s.name)} colors={c.series.map((_, i) => el.colors[i])} x={0} y={H - 10} w={W} t={t} font={font} />}
    </svg>
  );
}

export const SlideChart = memo(ChartView);
