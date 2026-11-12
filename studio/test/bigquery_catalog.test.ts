import { generateKeyPairSync } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as liveConfig from '../src/agent/liveConfig';
import {
  executeSqlQuery,
  importRowsIntoLocalTable,
  inspectDataSchema,
} from '../src/data/sqlEngine';
import {
  BQ_COST_PER_TB,
  BqCatalogStore,
  buildGcpAuthHeaders,
  resolveGoogleCredentials,
} from '../server/bigqueryCatalog';
import { liveTokenMiddleware } from '../server/liveToken';

describe('BigQuery Data Catalog API, Sync, Preview & Local SQLite Import', () => {
  let server: Server;
  let port = 0;
  let tempDir = '';
  const upstream = vi.fn<typeof fetch>();

  beforeAll(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'studio-bq-test-'));
    const mw = liveTokenMiddleware({
      getApiKey: () => 'AIzaSy-test-key',
      loadConfig: async () => liveConfig,
      connectorEnv: {
        BIGQUERY_PROJECT_ID: 'analytics-prod-123',
        BIGQUERY_ACCESS_TOKEN: 'ya29.mock-bq-token',
      },
      bqPersistPath: join(tempDir, '.bq-catalog.local'),
      fetch: upstream,
      log: () => undefined,
    });
    server = createServer((req, res) =>
      mw(req, res, () => {
        res.statusCode = 404;
        res.end();
      }),
    );
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  const jsonHeaders = () => ({
    'Content-Type': 'application/json',
    Origin: `http://127.0.0.1:${port}`,
  });

  it('discovers accessible GCP projects and marks already-registered projects', async () => {
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          projects: [
            { projectId: 'analytics-prod-123', name: 'Analytics Prod', lifecycleState: 'ACTIVE' },
            { projectId: 'zeta-warehouse', name: 'Zeta Warehouse', lifecycleState: 'ACTIVE' },
            { projectId: 'alpha-mart', name: 'Alpha Mart', lifecycleState: 'ACTIVE' },
          ],
        }),
        { status: 200 },
      ),
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/data/bq/projects`);
    expect(res.status).toBe(200);
    const projects = await res.json();
    // Unadded projects come first alphabetically, followed by already_added
    expect(projects).toEqual([
      { project_id: 'alpha-mart', display_name: 'Alpha Mart', already_added: false },
      { project_id: 'zeta-warehouse', display_name: 'Zeta Warehouse', already_added: false },
      { project_id: 'analytics-prod-123', display_name: 'Analytics Prod', already_added: true },
    ]);
  });

  it('manages multi-project BigQuery sources CRUD and exposes secondary projects as connectors', async () => {
    const createRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sources`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        project_id: 'marketing-dw-456',
        display_name: 'Marketing DW',
        dataset_filter: 'mart_',
      }),
    });
    expect(createRes.status).toBe(201);
    const created = await createRes.json();
    expect(created.project_id).toBe('marketing-dw-456');
    expect(created.dataset_filter).toBe('mart_');
    expect(created.is_active).toBe(true);

    // Duplicate project_id returns 409
    const dupRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sources`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ project_id: 'marketing-dw-456' }),
    });
    expect(dupRes.status).toBe(409);

    // /api/data/sources lists both primary `bigquery` and `bigquery:marketing-dw-456`
    const sourcesRes = await fetch(`http://127.0.0.1:${port}/api/data/sources`);
    const sourcesBody = await sourcesRes.json();
    expect(sourcesBody.sources.map((s: { id: string }) => s.id)).toEqual([
      'bigquery',
      'bigquery:marketing-dw-456',
    ]);

    // Pause source via PATCH -> disappears from active connectors
    const patchRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sources/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ is_active: false }),
    });
    expect(patchRes.status).toBe(200);
    const afterPause = await (await fetch(`http://127.0.0.1:${port}/api/data/sources`)).json();
    expect(afterPause.sources.map((s: { id: string }) => s.id)).toEqual(['bigquery']);

    // Re-enable then delete
    await fetch(`http://127.0.0.1:${port}/api/data/bq/sources/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ is_active: true }),
    });
    const delRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sources/${created.id}`, {
      method: 'DELETE',
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(delRes.status).toBe(200);
  });

  it('syncs datasets, tables, nested STRUCT columns, preserves descriptions, and populates /api/data/schema', async () => {
    // 1. datasets.list (includes mart_revenue and raw_logs; dataset_filter='mart_' keeps only mart_revenue)
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          datasets: [
            { datasetReference: { datasetId: 'mart_revenue', projectId: 'analytics-prod-123' }, location: 'EU' },
            { datasetReference: { datasetId: 'raw_logs', projectId: 'analytics-prod-123' }, location: 'EU' },
          ],
        }),
        { status: 200 },
      ),
    );
    // 2. datasets.get (mart_revenue)
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          location: 'EU',
          description: 'Curated executive revenue mart',
          labels: { env: 'prod' },
        }),
        { status: 200 },
      ),
    );
    // 3. tables.list (mart_revenue)
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          tables: [
            { tableReference: { tableId: 'subscriptions' }, type: 'TABLE' },
          ],
        }),
        { status: 200 },
      ),
    );
    // 4. tables.get (mart_revenue.subscriptions)
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'TABLE',
          description: 'Active SaaS customer subscriptions',
          numRows: '14250',
          numBytes: '2097152',
          creationTime: '1700000000000',
          lastModifiedTime: '1705000000000',
          schema: {
            fields: [
              { name: 'account_id', type: 'STRING', mode: 'REQUIRED', description: 'Unique customer ID' },
              { name: 'arr_usd', type: 'FLOAT64', mode: 'NULLABLE', description: 'Annual recurring revenue' },
              {
                name: 'billing_address',
                type: 'RECORD',
                mode: 'NULLABLE',
                fields: [{ name: 'country', type: 'STRING', mode: 'NULLABLE' }],
              },
            ],
          },
        }),
        { status: 200 },
      ),
    );

    const syncRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sync`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        project_id: 'analytics-prod-123',
        dataset_filter: 'mart_',
      }),
    });
    expect(syncRes.status).toBe(200);
    const syncBody = await syncRes.json();
    expect(syncBody).toEqual({
      project_id: 'analytics-prod-123',
      datasets_added: 1,
      datasets_updated: 0,
      tables_added: 1,
      tables_updated: 0,
      columns_synced: 4,
      errors: [],
    });

    // Verify /api/data/schema?source=bigquery now exposes the synced dataset & table!
    const schemaRes = await fetch(`http://127.0.0.1:${port}/api/data/schema?source=bigquery`);
    expect(schemaRes.status).toBe(200);
    const schemaBody = await schemaRes.json();
    expect(schemaBody.source).toBe('bigquery');
    expect(schemaBody.tables).toHaveLength(1);
    expect(schemaBody.tables[0]).toMatchObject({
      name: 'mart_revenue.subscriptions',
      fullName: 'analytics-prod-123.mart_revenue.subscriptions',
      projectId: 'analytics-prod-123',
      datasetId: 'mart_revenue',
      tableId: 'subscriptions',
      rowCount: 14250,
      sizeBytes: 2097152,
      location: 'EU',
      description: 'Active SaaS customer subscriptions',
    });
    expect(schemaBody.tables[0].columns.map((c: { name: string }) => c.name)).toEqual([
      'account_id',
      'arr_usd',
      'billing_address',
      'billing_address.country',
    ]);

    // Re-sync with empty description in BigQuery -> preserves existing curated descriptions!
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ datasets: [{ datasetReference: { datasetId: 'mart_revenue' } }] }), { status: 200 }),
    );
    upstream.mockResolvedValueOnce(new Response(JSON.stringify({ location: 'EU', description: '' }), { status: 200 }));
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ tables: [{ tableReference: { tableId: 'subscriptions' }, type: 'TABLE' }] }), { status: 200 }),
    );
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'TABLE',
          description: '',
          numRows: '15000',
          schema: {
            fields: [{ name: 'account_id', type: 'STRING', mode: 'REQUIRED' }],
          },
        }),
        { status: 200 },
      ),
    );

    const resync = await (
      await fetch(`http://127.0.0.1:${port}/api/data/bq/sync`, {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ project_id: 'analytics-prod-123' }),
      })
    ).json();
    expect(resync.datasets_updated).toBe(1);
    expect(resync.tables_updated).toBe(1);

    const dsList = await (await fetch(`http://127.0.0.1:${port}/api/data/bq/datasets?search=account_id`)).json();
    expect(dsList.datasets[0].description).toBe('Curated executive revenue mart');
    expect(dsList.datasets[0].tables[0].description).toBe('Active SaaS customer subscriptions');
    expect(dsList.datasets[0].tables[0].columns[0].description).toBe('Unique customer ID');

    // Verify disk persistence reloaded cleanly in a new BqCatalogStore instance
    const reloaded = new BqCatalogStore({
      persistPath: join(tempDir, '.bq-catalog.local'),
      env: {},
    });
    expect(reloaded.listDatasets()).toHaveLength(1);
    expect(reloaded.getSchemaTables('bigquery')[0].rowCount).toBe(15000);
  });

  it('estimates dry-run preview cost (with TABLESAMPLE fallback) and loads BigQuery rows into local SQLite-Wasm', async () => {
    const halfTibBytes = String(0.5 * 1024 ** 4);
    // First dry-run fails because of TABLESAMPLE on a view/partitioned table -> automatically retries without TABLESAMPLE
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { message: 'TABLESAMPLE is not supported on views' } }), { status: 400 }),
    );
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ totalBytesProcessed: halfTibBytes }), { status: 200 }),
    );

    const estRes = await fetch(
      `http://127.0.0.1:${port}/api/data/bq/preview?project_id=analytics-prod-123&dataset_id=mart_revenue&table_id=subscriptions`,
    );
    expect(estRes.status).toBe(200);
    const est = await estRes.json();
    expect(est.query).toBe('SELECT * FROM `analytics-prod-123.mart_revenue.subscriptions` LIMIT 100');
    expect(est.estimated_cost_usd).toBeCloseTo(BQ_COST_PER_TB * 0.5, 4);

    // Execute preview run -> load into local SQLite-Wasm
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          schema: {
            fields: [
              { name: 'account_id', type: 'STRING' },
              { name: 'region', type: 'STRING' },
              { name: 'arr_usd', type: 'FLOAT64' },
              { name: 'is_enterprise', type: 'BOOL' },
            ],
          },
          rows: [
            { f: [{ v: 'ACC-1' }, { v: 'EMEA' }, { v: '120000.5' }, { v: 'true' }] },
            { f: [{ v: 'ACC-2' }, { v: 'EMEA' }, { v: '79999.5' }, { v: 'false' }] },
            { f: [{ v: 'ACC-3' }, { v: 'North America' }, { v: '250000' }, { v: 'true' }] },
          ],
          totalRows: '15000',
        }),
        { status: 200 },
      ),
    );

    const previewRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/preview/run`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({
        project_id: 'analytics-prod-123',
        dataset_id: 'mart_revenue',
        table_id: 'subscriptions',
        limit: 100,
        sample: false,
      }),
    });
    expect(previewRes.status).toBe(200);
    const preview = await previewRes.json();
    expect(preview.truncated).toBe(true);
    expect(preview.rows).toEqual([
      ['ACC-1', 'EMEA', 120000.5, true],
      ['ACC-2', 'EMEA', 79999.5, false],
      ['ACC-3', 'North America', 250000, true],
    ]);

    const imported = await importRowsIntoLocalTable({
      tableName: 'mart_revenue_subscriptions',
      columns: preview.columns,
      rows: preview.rows,
      dataset: 'analytics-prod-123.mart_revenue',
      columnTypes: {
        account_id: 'STRING',
        region: 'STRING',
        arr_usd: 'FLOAT64',
        is_enterprise: 'BOOL',
      },
    });
    expect(imported.name).toBe('mart_revenue_subscriptions');
    expect(imported.rowCount).toBe(3);

    const localSchema = await inspectDataSchema({ source: 'local', table: 'mart_revenue_subscriptions' });
    expect(localSchema.tables).toHaveLength(1);

    const localQuery = await executeSqlQuery(
      'SELECT region, SUM(arr_usd) AS regional_arr FROM mart_revenue_subscriptions GROUP BY region ORDER BY regional_arr DESC',
    );
    expect(localQuery.ok).toBe(true);
    expect(localQuery.rows).toEqual([
      ['North America', 250000],
      ['EMEA', 200000],
    ]);
  });

  it('supports Secret Manager RS256 service-account keys and ADC quota_project_id headers', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

    const mockFetch = vi.fn<typeof fetch>();
    // 1. Secret Manager access returns base64 SA key JSON
    const saJson = JSON.stringify({
      type: 'service_account',
      client_email: 'bq-sync@sec-project.iam.gserviceaccount.com',
      private_key: pem,
      token_uri: 'https://oauth2.googleapis.com/token',
    });
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ payload: { data: Buffer.from(saJson, 'utf8').toString('base64') } }),
        { status: 200 },
      ),
    );
    // 2. OAuth2 JWT-bearer exchange returns minted SA access token
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ya29.minted-sa-token', expires_in: 3600 }), { status: 200 }),
    );

    const smCreds = await resolveGoogleCredentials({
      projectId: 'sec-project',
      secretName: 'bq-reader-key',
      env: { BIGQUERY_ACCESS_TOKEN: 'ya29.bootstrap-token' },
      fetch: mockFetch,
    });
    expect(smCreds.accessToken).toBe('ya29.minted-sa-token');

    // Test local authorized_user ADC fallback sets x-goog-user-project when quota_project_id is absent
    const adcFile = join(tempDir, 'adc.json');
    writeFileSync(
      adcFile,
      JSON.stringify({
        type: 'authorized_user',
        client_id: 'cid.apps.googleusercontent.com',
        client_secret: 'csecret',
        refresh_token: '1//mock-refresh',
      }),
      'utf8',
    );
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ access_token: 'ya29.adc-refreshed', expires_in: 3600 }), { status: 200 }),
    );

    const adcCreds = await resolveGoogleCredentials({
      projectId: 'billing-target-proj',
      env: { GOOGLE_APPLICATION_CREDENTIALS: adcFile },
      fetch: mockFetch,
    });
    expect(adcCreds.accessToken).toBe('ya29.adc-refreshed');
    expect(adcCreds.quotaProject).toBe('billing-target-proj');
    const hdrs = buildGcpAuthHeaders(adcCreds);
    expect(hdrs['x-goog-user-project']).toBe('billing-target-proj');
  });

  it('registers an ad-hoc synced project as an active source so its tables are queryable and removable', async () => {
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          datasets: [{ datasetReference: { datasetId: 'ops', projectId: 'adhoc-proj-789' }, location: 'US' }],
        }),
        { status: 200 },
      ),
    );
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ location: 'US', description: 'Ops dataset' }), { status: 200 }),
    );
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ tables: [{ tableReference: { tableId: 'incidents' }, type: 'TABLE' }] }),
        { status: 200 },
      ),
    );
    upstream.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          type: 'TABLE',
          numRows: '12',
          schema: { fields: [{ name: 'incident_id', type: 'STRING' }] },
        }),
        { status: 200 },
      ),
    );

    const syncRes = await fetch(`http://127.0.0.1:${port}/api/data/bq/sync`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ project_id: 'adhoc-proj-789' }),
    });
    expect(syncRes.status).toBe(200);

    // Preview on the synced project succeeds instead of failing isQueryableProject
    upstream.mockResolvedValueOnce(
      new Response(JSON.stringify({ totalBytesProcessed: '1024' }), { status: 200 }),
    );
    const estRes = await fetch(
      `http://127.0.0.1:${port}/api/data/bq/preview?project_id=adhoc-proj-789&dataset_id=ops&table_id=incidents`,
    );
    expect(estRes.status).toBe(200);

    // And the project appears in /api/data/bq/sources so it can be removed cleanly
    const srcs = (await (await fetch(`http://127.0.0.1:${port}/api/data/bq/sources`)).json()) as { id: string; project_id: string }[];
    const adhocSrc = srcs.find((s) => s.project_id === 'adhoc-proj-789');
    expect(adhocSrc).toBeDefined();
    const del = await fetch(`http://127.0.0.1:${port}/api/data/bq/sources/${adhocSrc!.id}?purge=1`, {
      method: 'DELETE',
      headers: { Origin: `http://127.0.0.1:${port}` },
    });
    expect(del.status).toBe(200);
  });
});
