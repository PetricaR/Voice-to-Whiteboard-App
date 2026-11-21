/**
 * Draws one slide of a deck from its laid-out elements (engine/deckLayout.ts),
 * the same elements the PowerPoint export writes. The slide is built at
 * 1280 × 720 px (96 px per inch) and scaled to `width`.
 */
import { memo, useMemo, type CSSProperties } from 'react';
import type { DeckSpec } from '../../engine/deck';
import { SLIDE_H, SLIDE_W, layoutSlide, themeOf, type DeckTheme, type El, type TableEl, type TextEl } from '../../engine/deckLayout';
import { SlideChart } from './SlideChart';

const IN = 96;
const PT = 96 / 72;
export const SLIDE_PX = { w: Math.round(SLIDE_W * IN), h: Math.round(SLIDE_H * IN) };

export function fontStack(face: string): string {
  if (face === 'Georgia') return "Georgia, 'Times New Roman', serif";
  return "Arial, 'Helvetica Neue', Helvetica, sans-serif";
}

const box = (e: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  position: 'absolute',
  left: e.x * IN,
  top: e.y * IN,
  width: e.w * IN,
  height: e.h * IN,
});

function TextBox({ el, t }: { el: TextEl; t: DeckTheme }) {
  const lineHeight = (el.font === 'head' && t.headFont === 'Georgia' ? 1.14 : 1.2) * (el.lineSpacing ?? 1);
  return (
    <div
      className="slide-text"
      data-role={el.role}
      style={{
        ...box(el),
        display: 'flex',
        flexDirection: 'column',
        justifyContent: el.valign === 'middle' ? 'center' : el.valign === 'bottom' ? 'flex-end' : 'flex-start',
        fontFamily: fontStack(el.font === 'head' ? t.headFont : t.bodyFont),
        fontSize: el.size * PT,
        fontWeight: el.bold ? 700 : 400,
        color: `#${el.color}`,
        textAlign: el.align ?? 'left',
        lineHeight,
        letterSpacing: el.charSpacing ? el.charSpacing * PT : undefined,
      }}
    >
      {el.paras.map((p, i) => (
        <p key={i} style={{ margin: 0, marginBottom: i < el.paras.length - 1 && el.paraSpaceAfter ? el.paraSpaceAfter * PT : 0, ...(/ value$/.test(el.name) ? { whiteSpace: 'nowrap' } : {}) }}>
          {p.bullet && <span aria-hidden="true">•&nbsp;&nbsp;</span>}
          {p.runs.map((r, j) => (
            <span
              key={j}
              style={{
                ...(r.bold !== undefined ? { fontWeight: r.bold ? 700 : 400 } : {}),
                ...(r.italic ? { fontStyle: 'italic' } : {}),
                ...(r.color ? { color: `#${r.color}` } : {}),
                ...(r.size ? { fontSize: r.size * PT } : {}),
              }}
            >
              {r.text}
            </span>
          ))}
        </p>
      ))}
    </div>
  );
}

function Table({ el, t }: { el: TableEl; t: DeckTheme }) {
  const cell = (i: number): CSSProperties => ({
    textAlign: el.numeric[i] ? 'right' : 'left',
    padding: `0 ${0.12 * IN}px`,
    height: el.rowH * IN,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    maxWidth: el.colW[i] * IN,
  });
  return (
    <table
      className="slide-table"
      style={{ ...box(el), height: undefined, borderCollapse: 'collapse', tableLayout: 'fixed', fontFamily: fontStack(t.bodyFont), fontSize: el.size * PT, color: `#${t.ink}` }}
    >
      <colgroup>
        {el.colW.map((w, i) => <col key={i} style={{ width: w * IN }} />)}
      </colgroup>
      <thead>
        <tr style={{ background: `#${t.dark}`, color: '#FFFFFF' }}>
          {el.columns.map((c, i) => <th key={i} style={{ ...cell(i), fontWeight: 700 }}>{c}</th>)}
        </tr>
      </thead>
      <tbody>
        {el.rows.map((r, ri) => (
          <tr key={ri} style={{ background: ri % 2 === 1 ? `#${t.soft}` : '#FFFFFF', borderBottom: `1px solid #${t.rule}` }}>
            {el.columns.map((_, i) => <td key={i} style={cell(i)}>{r[i] ?? ''}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Element({ el, t }: { el: El; t: DeckTheme }) {
  switch (el.kind) {
    case 'text':
      return <TextBox el={el} t={t} />;
    case 'table':
      return <Table el={el} t={t} />;
    case 'chart':
      return (
        <div style={box(el)}>
          <SlideChart el={el} theme={t} font={fontStack(t.bodyFont)} />
        </div>
      );
    case 'shape': {
      const opacity = el.transparency ? 1 - el.transparency / 100 : 1;
      if (el.shape === 'chevron') {
        const w = el.w * IN;
        const h = el.h * IN;
        const d = w * 0.5;
        return (
          <svg style={box(el)} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
            <polygon points={`0,0 ${w - d},0 ${w},${h / 2} ${w - d},${h} 0,${h} ${d},${h / 2}`} fill={`#${el.fill}`} opacity={opacity} />
          </svg>
        );
      }
      return (
        <div
          aria-hidden="true"
          style={{
            ...box(el),
            background: el.fill ? `#${el.fill}` : undefined,
            opacity,
            borderRadius: el.shape === 'ellipse' ? '50%' : el.shape === 'roundRect' ? (el.radius ?? 0.1) * IN : 0,
            border: el.line ? `${(el.lineWidth ?? 1) * PT}px solid #${el.line}` : undefined,
          }}
        />
      );
    }
  }
}

function SlideCanvasView({ deck, index, width, className }: { deck: DeckSpec; index: number; width: number; className?: string }) {
  const frame = useMemo(() => layoutSlide(deck, index), [deck, index]);
  const t = themeOf(deck);
  const scale = width / SLIDE_PX.w;
  const slide = deck.slides[index];
  return (
    <div
      className={`slide-canvas${className ? ` ${className}` : ''}`}
      style={{ width, height: SLIDE_PX.h * scale }}
      role="img"
      aria-label={`Slide ${index + 1}: ${slide?.title ?? ''}`}
    >
      <div
        className="slide-canvas-inner"
        style={{ width: SLIDE_PX.w, height: SLIDE_PX.h, transform: `scale(${scale})`, transformOrigin: '0 0', background: `#${frame.background}` }}
      >
        {frame.elements.map((el, i) => <Element key={i} el={el} t={t} />)}
        {frame.number && (
          <div
            style={{
              ...box(frame.number),
              fontFamily: fontStack(t.bodyFont),
              fontSize: frame.number.size * PT,
              color: `#${frame.number.color}`,
              textAlign: 'right',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
            }}
          >
            {frame.number.value}
          </div>
        )}
      </div>
    </div>
  );
}

export const SlideCanvas = memo(SlideCanvasView);
