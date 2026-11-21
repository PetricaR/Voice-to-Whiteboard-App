/**
 * Time values as text every part of the studio can read: SQLite's date
 * functions, the chart axes (which order ISO text correctly) and a person.
 * Shared by the browser and the studio server.
 */

const pad = (n: number, width = 2) => String(n).padStart(width, '0');

/** "2026-10-28 14:15:00" (UTC), with milliseconds only when there are any. */
export function isoFromEpochMs(ms: number): string {
  const d = new Date(ms);
  const base = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
  const millis = d.getUTCMilliseconds();
  return millis === 0 ? base : `${base}.${pad(millis, 3)}`;
}

const EPOCH_NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

/**
 * A BigQuery TIMESTAMP as ISO text. The REST API writes it as seconds since
 * the epoch in scientific notation ("1.7931456E9"), or as microseconds when
 * asked for int64 timestamps; text that is already a date is left alone.
 */
export function warehouseTimestampToIso(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (text === '') return null;
  if (!EPOCH_NUMBER.test(text)) return text.replace(/\s*UTC$/, '');
  const n = Number(text);
  if (!Number.isFinite(n)) return text;
  // Seconds reach 1e11 only in the year 5138; anything larger is microseconds
  const ms = Math.abs(n) >= 1e14 ? n / 1000 : n * 1000;
  if (Math.abs(ms) > 8.64e15) return text;
  return isoFromEpochMs(Math.round(ms));
}

/** Milliseconds since the epoch of ISO-like text ("2026-10-28", "2026-10-28 14:15:00", "2026-10-28T14:15:00Z"); NaN otherwise. */
export function epochMsOfIso(text: string): number {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/.exec(text.trim());
  if (!m) return NaN;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3] ?? 1), Number(m[4] ?? 0), Number(m[5] ?? 0), Number(m[6] ?? 0),
    m[7] ? Math.round(Number(m[7]) * 1000) : 0);
  const zone = m[8];
  if (!zone || zone === 'Z' || zone === 'UTC') return ms;
  const sign = zone[0] === '-' ? -1 : 1;
  const digits = zone.slice(1).replace(':', '');
  return ms - sign * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4))) * 60_000;
}
