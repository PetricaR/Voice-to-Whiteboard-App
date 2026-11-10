# Voice Whiteboard Studio — Live SQL Dashboards, Programmatic Motion & Diagrams

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **voice-first Live Data Dashboard, Programmatic Motion & Architecture Studio** powered by the **Gemini Live API** (`gemini-3.8-live` / `gemini-2.5-flash-native-audio`): speak or type natural-language requests to query live SQL datasets into interactive dashboards, animate data-grounded 60fps motion explainers, map cloud architectures, and write structured documentation.

Every request is a **deterministic, incremental edit** of your active workspace—never a destructive full redraw or black-box video hallucination.

---

## Key Capabilities

1. **Live SQL Dashboards with Transparent Lineage (`Dashboard` surface)**
   - **Zero-config in-browser SQLite-Wasm (`sql.js`)** preloaded with 4 multi-table enterprise datasets (`monthly_revenue`, `enterprise_accounts`, `daily_orders`, `conversion_funnel`, `service_spend`, `deals_pipeline`).
   - **Instant file upload** (`.csv`, `.tsv`, `.json`, `.jsonl`, `.parquet` via `hyparquet`) directly into live queryable SQL tables.
   - **Read-only server connectors** (`/api/data/*`) for BigQuery, ClickHouse HTTP, PostgreSQL HTTP, and REST/CSV endpoints—enforced by a strict single-statement `SELECT`/`WITH` SQL guard.
   - **12 responsive Bento-grid visualizations** (`kpi`, `area`, `line`, `bar`, `stacked_bar`, `horizontal_bar`, `donut`, `pie`, `scatter`, `funnel`, `heatmap`, and accessible sortable `table`) with `:param` filter bars and live auto-refresh intervals.
   - **Query & Lineage Inspector Drawer**: click any KPI figure, chart bar/slice, or `SQL` badge to inspect the exact SQL query, execution latency, refresh timestamp, raw result rows, edit SQL live, or click **Ask Gemini Live** for an instant spoken explanation.
   - **BI & Report Handoffs**: export standalone interactive `.html` reports, annotated `.sql` query bundles, Vega-Lite `.vg.json` specs, and 24-column Grafana `.grafana.json` models.

2. **Programmatic Motion Studio (`Motion` surface)**
   - **Deterministic code-driven animation engine** (`60fps` Canvas2D stage + millisecond timeline scrubber) across `16:9`, `9:16`, and `1:1` aspect ratios.
   - **1-click Cross-Surface Storyboard Synthesis**: turn any Live SQL Dashboard, Architecture Diagram, or Documentation book into an animated multi-scene explainer grounded in verified SQL numbers (`create_motion` with `from_current_page: true` or the **Animate Explainer** button).
   - **Editable Layers & Physics**: `badge`, `kinetic_text`, `metric_counter` (interpolating real queried numbers), `motion_chart`, `flow_diagram`, and `callout_card` with `spring`, `smooth`, `snappy`, and `linear` easings, click-on-canvas hit-box selection, kinetic captions, and optional Web Speech voiceover.
   - **Client-side `.mp4` Video Export**: deterministic frame-by-frame WebCodecs `VideoEncoder` + `mp4-muxer` H.264 `.mp4` rendering (with `MediaRecorder` `.webm` fallback).

3. **Architecture Whiteboard & Book Documentation (`Diagram` & `Docs` surfaces)**
   - Incremental graph editing (`create_diagram`, `edit_diagram`, `tidy_layout`) with neighbor-aware node placement, official Google Cloud SVG icons, 101 Gen AI technical blueprints, and draw.io (`.drawio`) / PNG / SVG export.
   - Companion arc42 / C4 / ADR **Documentation** book per page (`write_text`, `write_table`) with Markdown (`.md`) export.

---

## Quick Start

Requires **Node.js 20.19+** and a [Gemini API key](https://aistudio.google.com/apikey) in `.env` (`GEMINI_API_KEY=...` in `studio/.env` or the repository root `.env`—loaded automatically by default; local SQLite-Wasm dashboards, CSV/Parquet uploads, and programmatic motion studio also work offline without a key).

```bash
cd studio
./studio.sh          # installs dependencies, loads GEMINI_API_KEY from .env by default, opens http://127.0.0.1:5173
./studio.sh key      # optional fallback: saves or replaces a key in macOS Keychain / .env.local
./studio.sh check    # verifies key → ephemeral token → Live session against the real Gemini API
./studio.sh test     # runs all Vitest unit, SQL guard, dashboard, motion & security tests
./studio.sh e2e      # runs headless Chrome Playwright E2E tests (UI smoke + mock Gemini Live WebSocket pipeline)
./studio.sh eval     # runs multi-turn stability & accuracy evals against the real Gemini Live model
```

> **Security by design:** Your Gemini API key stays on the studio server and **never reaches the browser**. The browser connects to Gemini Live using single-use, `fieldMask`-locked [ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) minted by [`studio/server/liveToken.ts`](studio/server/liveToken.ts), and every SQL query passes through [`studio/src/data/sqlGuard.ts`](studio/src/data/sqlGuard.ts) to guarantee read-only `SELECT`/`WITH` execution.

---

## What You Can Ask For

Press **Space** (or click **Talk**) to speak, or press **`/`** to type (including slash commands `/dashboard`, `/motion`, `/sql`, `/explain`, `/diagram`, `/doc`):

| Say or Type | Gemini Live Tool Call |
| --- | --- |
| *"Build an executive SaaS revenue & retention dashboard with a region filter"* | `inspect_schema` → `create_dashboard` (validates every SQL query against SQLite-Wasm before rendering) |
| *"Add a horizontal bar chart of top 5 enterprise accounts by ARR"* | `edit_dashboard` (adds the widget without disturbing existing cards or filters) |
| *"Where did the June MRR number come from?"* | `inspect_widget` (opens the top-layer SQL Lineage Inspector Drawer and explains the query) |
| *"Turn this dashboard into a 9:16 vertical animated explainer video"* | `create_motion` (`from_current_page: true`, `aspect_ratio: "9:16"`, grounded in live SQL results) |
| *"Make the opening scene 4 seconds and change the headline to Q4 Momentum"* | `edit_motion` (updates only that scene/layer while keeping all other timings intact) |
| *"Play from the start"* / *"Export as MP4"* | `control_motion` (`restart` / `export_mp4`) |
| *"Draw our real-time BigQuery & Vertex AI architecture in a new tab"* | `create_diagram` (`new_page: true`) |
| *"Document this architecture"* | `write_text` + `write_table` (numbered chapters & tables in the **Docs** surface) |

---

## Optional Server Data Connectors

In addition to zero-config local SQLite-Wasm and drag-and-drop CSV/TSV/JSON/Parquet files, you can enable read-only server connectors via environment variables when starting `./studio.sh`:

| Connector | Environment Variables |
| --- | --- |
| **BigQuery** | `BIGQUERY_PROJECT_ID` (uses Application Default Credentials or `BIGQUERY_ACCESS_TOKEN`) |
| **ClickHouse HTTP** | `CLICKHOUSE_HTTP_URL`, optional `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE` |
| **PostgreSQL HTTP Proxy** | `POSTGRES_HTTP_URL`, optional `POSTGRES_HTTP_TOKEN` |
| **REST JSON Feed** | `REST_DATA_SOURCES` (JSON map of `{ "id": "https://..." }`) |
