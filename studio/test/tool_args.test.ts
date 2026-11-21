/**
 * Every tool survives arguments that do not match its declared schema: the
 * model gets an answer it can act on, never a TypeError from deep inside an
 * engine (agent/coerceArgs.ts and the reference resolvers).
 */
import { describe, expect, it } from 'vitest';
import { coerceToSchema } from '../src/agent/coerceArgs';
import { handleToolCall, type ToolContext } from '../src/agent/dispatcher';
import { TOOL_DECLARATIONS } from '../src/agent/tools';
import { Workspace } from '../src/engine/workspace';

describe('tool arguments are read as their declared types', () => {
  it('coerces scalars, wraps single values in lists and drops null list items', () => {
    const schema = {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING' },
        steps: { type: 'INTEGER' },
        replace: { type: 'BOOLEAN' },
        y_fields: { type: 'ARRAY', items: { type: 'STRING' } },
        nodes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { id: { type: 'STRING' } } } },
      },
    };
    expect(coerceToSchema({
      title: 2026, steps: '3', replace: 'true', y_fields: 'mrr', nodes: [null, { id: 7, extra: 'kept' }], unknown: [1],
    }, schema)).toEqual({
      title: '2026', steps: 3, replace: true, y_fields: ['mrr'], nodes: [{ id: '7', extra: 'kept' }], unknown: [1],
    });
    // Values that cannot be read as the type are dropped; null ("clear it") is kept
    expect(coerceToSchema({ title: {}, steps: 'many', replace: 'yes', y_fields: null }, schema))
      .toEqual({ y_fields: null });
    expect(coerceToSchema('not an object', schema)).toBeUndefined();
  });

  it('never lets a malformed argument of any tool escape as an exception', async () => {
    const decls = TOOL_DECLARATIONS as { name: string; parameters?: { properties?: Record<string, unknown> } }[];
    const weird: unknown[] = [null, 5, 'str', [], {}, [null], [5], ['x'], [{}], true, { id: 5 }, [{ id: null, label: 7 }]];
    // These reach the network (studio server, Google) and are covered by their own tests
    const offline = decls.filter((d) => !/google|bigquery|list_data_sources/.test(d.name));
    expect(offline.length).toBeGreaterThan(20);

    const failures: string[] = [];
    for (const d of offline) {
      const argSets: (Record<string, unknown> | undefined)[] = [undefined, {}];
      for (const prop of Object.keys(d.parameters?.properties ?? {})) for (const w of weird) argSets.push({ [prop]: w });
      const ws = new Workspace();
      const ctx: ToolContext = { workspace: ws, source: 'text' };
      await handleToolCall('create_diagram', { title: 'T', nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ from: 'a', to: 'b' }] }, ctx);
      await handleToolCall('create_dashboard', { title: 'D', new_page: true, widgets: [{ title: 'K', kind: 'kpi', sql: 'SELECT 1 AS n' }] }, ctx);
      await handleToolCall('create_deck', { title: 'M', slides: [{ layout: 'title', title: 's1' }, { layout: 'chart', title: 'c' }] }, ctx);
      await handleToolCall('write_text', { title: 'Ch', text: 'hello' }, ctx);
      for (const args of argSets) {
        try {
          const res = await handleToolCall(d.name, args, ctx);
          if (res == null || typeof res !== 'object' || typeof res.ok !== 'boolean') failures.push(`${d.name}: no ok flag`);
        } catch (e) {
          failures.push(`${d.name}(${JSON.stringify(args)}): ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);
});
