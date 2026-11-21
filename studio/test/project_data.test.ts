import { beforeAll, describe, expect, it } from 'vitest';
import { handleToolCall } from '../src/agent/dispatcher';
import { isSourceAttached, setProjectScope, type PersistedTable } from '../src/data/projectScope';
import { DiagramStore } from '../src/engine/store';
import {
  executeSqlQuery,
  importDataFile,
  importRowsIntoLocalTable,
  inspectDataSchema,
  listLocalTables,
  listUserTables,
  removeUserTable,
  restoreProjectTables,
  syncSampleTables,
} from '../src/data/sqlEngine';

// The engine is one per page (and per test file): this file is a project without the sample data
const saved = new Map<string, PersistedTable>();
const removed: string[] = [];
const scope = {
  projectId: 'ptest',
  name: 'Churn analysis',
  brief: '',
  sources: { includeSamples: false, remote: ['bigquery:acme'], defaultSource: 'local' },
};

beforeAll(() => {
  setProjectScope(scope, {
    saveTable: async (t) => {
      saved.set(t.tableName, t);
    },
    removeTable: async (name) => {
      removed.push(name);
    },
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('data of a project', () => {
  it('has no sample tables when the project leaves them out, and gets them when turned on', async () => {
    expect((await listLocalTables()).some((t) => t.name === 'monthly_revenue')).toBe(false);
    const off = await executeSqlQuery('SELECT COUNT(*) AS n FROM monthly_revenue');
    expect(off.ok).toBe(false);

    setProjectScope({ ...scope, sources: { ...scope.sources, includeSamples: true } });
    await syncSampleTables();
    expect((await listLocalTables()).some((t) => t.name === 'monthly_revenue')).toBe(true);
    expect((await executeSqlQuery('SELECT COUNT(*) AS n FROM monthly_revenue')).ok).toBe(true);

    setProjectScope(scope);
    await syncSampleTables();
    expect((await executeSqlQuery('SELECT COUNT(*) AS n FROM monthly_revenue')).ok).toBe(false);
  });

  it('keeps an uploaded file with the project and brings it back', async () => {
    const meta = await importDataFile({ name: 'churn.csv', text: 'region,churned\nEMEA,12\nAPAC,7\n' });
    await flush();
    const kept = saved.get('churn');
    expect(kept?.kind).toBe('file');
    expect(kept?.fileName).toBe('churn.csv');
    expect(kept?.loadedAt).toBe(meta.loadedAt);
    expect(new TextDecoder().decode(kept!.bytes)).toContain('EMEA,12');

    // A reload: the table is gone from memory, then comes back from the project
    expect(await removeUserTable('churn')).toBe(true);
    await flush();
    expect(removed).toContain('churn');
    expect(listUserTables().some((t) => t.name === 'churn')).toBe(false);

    saved.clear();
    const { restored, failed } = await restoreProjectTables([kept!]);
    expect(restored).toEqual(['churn']);
    expect(failed).toEqual([]);
    await flush();
    expect(saved.size).toBe(0); // brought back, not saved again
    const back = listUserTables().find((t) => t.name === 'churn');
    expect(back?.loadedAt).toBe(meta.loadedAt);
    const sum = await executeSqlQuery('SELECT SUM(churned) AS n FROM churn');
    expect(sum.rows[0][0]).toBe(19);
  });

  it('keeps warehouse rows with their meaning, and restores the latest-first order', async () => {
    await importRowsIntoLocalTable({
      tableName: 'orders',
      columns: ['day', 'amount'],
      rows: [['2026-01-01', 10], ['2026-01-02', 15]],
      columnTypes: { amount: 'FLOAT64' },
      sourceTable: 'acme.sales.orders',
      sourceRowCount: 5000,
    });
    await flush();
    const kept = saved.get('orders')!;
    expect(kept.kind).toBe('rows');
    await removeUserTable('orders');
    await removeUserTable('churn');

    const broken: PersistedTable = { tableName: 'bad', kind: 'rows', fileName: 'bad', bytes: new Uint8Array([1, 2, 3]), loadedAt: 1 };
    const churn: PersistedTable = { tableName: 'churn', kind: 'file', fileName: 'churn.csv', bytes: new TextEncoder().encode('a,b\n1,2\n'), loadedAt: kept.loadedAt + 10 };
    const { restored, failed } = await restoreProjectTables([churn, kept, broken]);
    expect(restored).toEqual(['orders', 'churn']);
    expect(failed).toEqual(['bad']);
    const orders = listUserTables().find((t) => t.name === 'orders');
    expect(orders?.partOf).toEqual({ table: 'acme.sales.orders', rowCount: 5000 });
    expect(listUserTables()[0].name).toBe('churn');
  });

  it('refuses a remote source that is not part of the project', async () => {
    const other = await executeSqlQuery('SELECT 1', { source: 'clickhouse' });
    expect(other.ok).toBe(false);
    expect(other.error).toMatch(/not part of project "Churn analysis"/);
    await expect(inspectDataSchema({ source: 'bigquery:other' })).rejects.toThrow(/not part of project/);

    // An attached one passes the check (here it then needs the studio server)
    const attached = await executeSqlQuery('SELECT 1', { source: 'bigquery:acme' });
    expect(attached.error).toMatch(/only reachable through the studio server/);
    // Local data is always the project's own
    expect((await executeSqlQuery('SELECT 1 AS x')).ok).toBe(true);
  });
});

describe('the agent in a project', () => {
  it('sees the project, its brief and its sources in every tool result', async () => {
    setProjectScope({ ...scope, brief: 'Why  retail\ncustomers leave in Q4' });
    const res = await handleToolCall('list_data_sources', {}, { store: new DiagramStore(), source: 'text' });
    const state = String(res.diagram);
    expect(state.split('\n')[0]).toBe(
      'project: "Churn analysis" — Why retail customers leave in Q4; its data sources: local (2 uploaded tables, no sample tables), bigquery:acme',
    );
    const query = await handleToolCall('run_query', { source: 'postgres', sql: 'SELECT 1' }, { store: new DiagramStore(), source: 'text' });
    expect(JSON.stringify(query)).toMatch(/not part of project/);
    setProjectScope(scope);
  });
});

describe('source ids', () => {
  it('treats "bigquery" as the server\'s default BigQuery project', () => {
    setProjectScope({ ...scope, sources: { ...scope.sources, remote: ['bigquery:acme'] } });
    expect(isSourceAttached('bigquery', 'acme')).toBe(true);
    expect(isSourceAttached('bigquery', 'other')).toBe(false);
    // Earlier work kept the plain id
    setProjectScope({ ...scope, sources: { ...scope.sources, remote: ['bigquery'] } });
    expect(isSourceAttached('bigquery', 'acme')).toBe(true);
    expect(isSourceAttached('bigquery:acme', 'acme')).toBe(true);
    expect(isSourceAttached('bigquery:other', 'acme')).toBe(false);
    expect(isSourceAttached('local')).toBe(true);
    setProjectScope(scope);
  });
});
