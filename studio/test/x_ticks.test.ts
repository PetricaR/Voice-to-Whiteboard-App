import { describe, expect, it } from 'vitest';
import { AUTO_TICK_ROTATION, fitToWidth, layoutXTicks } from '../src/ui/dashboard/xTicks';

// Every character 6px wide: easy arithmetic
const measure = (t: string) => t.length * 6;

describe('x-axis category labels', () => {
  it('keeps labels that fit untouched and flat', () => {
    const l = layoutXTicks(['APAC', 'EMEA', 'LATAM'], 60, measure);
    expect(l.rotation).toBe(0);
    expect(l.extraBottomPad).toBe(0);
    expect(['APAC', 'EMEA', 'LATAM'].map(l.label)).toEqual(['APAC', 'EMEA', 'LATAM']);
  });

  it('fits by drawn width, so a label that just fits is not cut', () => {
    expect(fitToWidth('2026-Q1', 42, measure)).toBe('2026-Q1');
    expect(fitToWidth('2026-Q1', 41, measure)).toBe('2026-…');
    expect(fitToWidth('Wide', 1, measure)).toBe('W…');
  });

  it('tilts labels that cutting would make identical (quarters all becoming "2026-…")', () => {
    const quarters = ['2025-Q4', '2026-Q1', '2026-Q2', '2026-Q3'];
    const l = layoutXTicks(quarters, 40, measure);
    expect(l.rotation).toBe(AUTO_TICK_ROTATION);
    expect(quarters.map(l.label)).toEqual(quarters);
    // The tilted labels need room below the axis
    expect(l.extraBottomPad).toBeGreaterThanOrEqual(18);
  });

  it('tilts when most of a label would be cut away', () => {
    const l = layoutXTicks(['North America', 'EMEA'], 30, measure);
    expect(l.rotation).toBe(AUTO_TICK_ROTATION);
    expect(l.label('North America')).toBe('North America');
  });

  it('cuts flat when the cut labels stay distinct and mostly whole', () => {
    const l = layoutXTicks(['Enterprise', 'Professional'], 54, measure);
    expect(l.rotation).toBe(0);
    expect(l.label('Professional')).toBe('Professi…');
    expect(l.label('Enterprise')).toBe('Enterpri…');
  });

  it('keeps very long tilted labels to 16 characters, with padding that grows with them but is capped', () => {
    const long = ['Customer Success Operations', 'Customer Success Engineering'];
    const l = layoutXTicks(long, 20, measure);
    expect(l.rotation).toBe(AUTO_TICK_ROTATION);
    expect(l.label(long[0])).toBe('Customer Succes…');
    expect(l.extraBottomPad).toBeLessThanOrEqual(64);
  });

  it("respects the chart's own rotation and truncation settings", () => {
    const quarters = ['2025-Q4', '2026-Q1'];
    const flat = layoutXTicks(quarters, 30, measure, { rotation: 0 });
    expect(flat.rotation).toBe(0);
    expect(flat.label('2026-Q1')).toBe('2026…');

    const cut = layoutXTicks(quarters, 30, measure, { truncateChars: 5 });
    expect(cut.rotation).toBe(0);
    expect(cut.label('2026-Q1')).toBe('2026…');

    const tilted = layoutXTicks(quarters, 30, measure, { rotation: 45 });
    expect(tilted.rotation).toBe(45);
    expect(tilted.label('2026-Q1')).toBe('2026-Q1');
    expect(tilted.extraBottomPad).toBeGreaterThanOrEqual(18);
  });

  it('copes with no categories', () => {
    const l = layoutXTicks([], 40, measure);
    expect(l.rotation).toBe(0);
  });
});
