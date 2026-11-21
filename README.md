# Voice Whiteboard Studio — Live SQL Dashboards, Presentation Decks & Diagrams

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A **voice-first Live Data Dashboard, Presentation Deck & Architecture Studio** powered by the **Gemini Live API** (`gemini-3.8-live` / `gemini-2.5-flash-native-audio`): speak or type natural-language requests to query live SQL datasets into interactive dashboards, turn them into board-ready slide decks, map cloud architectures, and write structured documentation.

Every request is a **deterministic, incremental edit** of your active workspace—never a destructive full redraw or black-box video hallucination.

---

## Key Capabilities

1. **Live SQL Dashboards with Transparent Lineage (`Dashboard` surface)**
   - **Zero-config in-browser SQLite-Wasm (`sql.js`)** preloaded with 10 enterprise sample tables (`monthly_revenue`, `enterprise_accounts`, `daily_orders`, `conversion_funnel`, `service_spend`, `deals_pipeline`, `stock_ohlc`, `project_roadmap`, `org_directory`, `global_flows`).
   - **Instant file upload** (`.csv`, `.tsv`, `.json`, `.jsonl`, `.parquet` via `hyparquet`) directly into live queryable SQL tables.
   - **BigQuery Data Catalog & Read-Only Connectors** (`/api/data/*`): discover accessible GCP projects, sync dataset/table schemas, run dry-run byte & cost estimates before previewing, enforce `maximumBytesBilled` caps, materialize tables into local SQLite-Wasm, or map dataset schemas & foreign-key relationships straight onto the Whiteboard—alongside ClickHouse HTTP, PostgreSQL HTTP, and REST JSON feeds guarded by a dialect-aware read-only SQL tokenizer.
   - **48 responsive Bento-grid chart & table types** (KPIs, line/area/streamgraph/candlestick trends, bar/grouped/stacked/marimekko/waterfall/bullet/gauge comparisons, histogram/density/box/violin distributions, scatter/bubble/heatmap/parallel coordinates, treemap/sunburst/sankey/chord/network/org hierarchies, choropleth/bubble/flow/connection maps, trellis small multiples, and accessible sortable tables) with `:param` filter bars, reference lines/bands, annotations, and live auto-refresh intervals.
   - **Closed-Loop Chart Review for Gemini (`chartInsights.ts`)**: every `create_dashboard`, `edit_dashboard`, and `refresh_dashboard` call executes the widget SQL, validates result shape & ordering against the chart type, returns ready-to-apply `update_widgets` patches and 12-column layout checks, and extracts verified statistical facts so spoken insights never hallucinate numbers.
   - **Query & Lineage Inspector Drawer**: click any KPI figure, chart mark, or `SQL` badge to inspect the exact SQL query, execution latency, refresh timestamp, raw result rows, edit SQL live, or click **Ask Gemini Live** for an instant spoken explanation.
   - **BI & Report Handoffs**: export standalone interactive `.html` reports, annotated `.sql` query bundles, Vega-Lite `.vg.json` specs, and 24-column Grafana `.grafana.json` models.

2. **Presentation Decks (`Deck` surface)**
   - **One click (or one sentence) from page to deck**: `create_deck` with `from_current_page: true` (or **Make a deck** on the dashboard) builds a pyramid-structured presentation — title, executive summary, headline metrics, one slide per chart whose title states the finding (*"North America leads MRR at $291.4K, 43% of the total"*), tables, the architecture flow, documentation highlights, and a closing slide — every figure from its live SQL result, with speaker notes on every slide.
   - **Nine professional layouts** (`title`, `section`, `kpis`, `chart`, `points`, `flow`, `table`, `statement`, `closing`), six themes, numbered-circle motif, text sized to fit; edit any field in the slide inspector or by voice (`edit_deck`: *"make slide 3 a bar chart"*, *"add a slide about risks after slide 4"*). Chart slides bound to dashboard widgets refresh with **Sync data** without touching your words.
   - **Present** full screen (arrows, Space, `N` for notes; *"next slide"* by voice) and **export**: an editable **PowerPoint `.pptx`** (pptxgenjs: one layout per slide type, title placeholders, sections, native charts and tables, speaker notes) or **Open in Google Slides** (the same file uploaded to the user's Drive and converted, with Google's `drive.file` scope; needs `GOOGLE_CLIENT_ID` and the Drive API enabled on that OAuth client's project).
   - Pages saved with a Motion explainer by an earlier version open as decks.

3. **Architecture Whiteboard & Official Google-Grounded Book Documentation (`Diagram` & `Docs` surfaces)**
   - Incremental graph editing (`create_diagram`, `edit_diagram`, `tidy_layout`) with neighbor-aware node placement, official Google Cloud SVG icons, 101 Gen AI technical blueprints, and draw.io (`.drawio`) / PNG / SVG export.
   - Publication-grade **Docs** reference guide (`write_text`, `write_table`) with inline full & subsystem-focused vector architecture embeds (`{{diagram}}`), Low-Level Design → Implementation Guidelines code blocks, typed callouts, ADRs, clickable official citations, standalone HTML (`.html`) and Mermaid-enabled Markdown (`.md`) exports.
   - **Official Google Developer Knowledge MCP (`https://developerknowledge.googleapis.com/mcp`)**: server-side Streamable HTTP MCP client (`studio/server/googleDocsMcp.ts`) exposing `search_google_docs`, `get_google_docs`, and `answer_google_docs` so Gemini Live grounds every Google Cloud, Gemini/Vertex AI, Firebase, ADK, Genkit, Apigee, Android, Chrome, Flutter, and Go chapter strictly in the latest official Google documentation.

---

## Quick Start

Requires **Node.js 20.19+** and a [Gemini API key](https://aistudio.google.com/apikey) in `.env` (`GEMINI_API_KEY=...` in `studio/.env` or the repository root `.env`—loaded automatically by default; local SQLite-Wasm dashboards, CSV/Parquet uploads, and slide decks also work offline without a key).

```bash
cd studio
./studio.sh          # installs dependencies, loads GEMINI_API_KEY from .env by default, opens http://127.0.0.1:5173
./studio.sh key      # optional fallback: saves or replaces a key in macOS Keychain / .env.local
./studio.sh check    # verifies key → ephemeral token → Live session against the real Gemini API
./studio.sh test     # runs all Vitest unit, SQL guard, dashboard, deck & security tests
./studio.sh e2e      # runs headless Chrome Playwright E2E tests (UI smoke + mock Gemini Live WebSocket pipeline)
./studio.sh eval     # runs multi-turn stability & accuracy evals against the real Gemini Live model
```

> **Security by design:** Your Gemini API key stays on the studio server and **never reaches the browser**. The browser connects to Gemini Live using single-use, `fieldMask`-locked [ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) minted by [`studio/server/liveToken.ts`](studio/server/liveToken.ts), and every SQL query passes through [`studio/src/data/sqlGuard.ts`](studio/src/data/sqlGuard.ts) to guarantee read-only `SELECT`/`WITH` execution.

---

## What You Can Ask For

Press **Space** (or click **Talk**) to speak, or press **`/`** to type (including slash commands `/dashboard`, `/deck`, `/sql`, `/explain`, `/diagram`, `/doc`):

| Say or Type | Gemini Live Tool Call |
| --- | --- |
| *"Build an executive SaaS revenue & retention dashboard with a region filter"* | `inspect_schema` → `create_dashboard` (validates every SQL query against SQLite-Wasm before rendering) |
| *"Add a horizontal bar chart of top 5 enterprise accounts by ARR"* | `edit_dashboard` (adds the widget without disturbing existing cards or filters) |
| *"Where did the June MRR number come from?"* | `inspect_widget` (opens the top-layer SQL Lineage Inspector Drawer and explains the query) |
| *"Turn this dashboard into a presentation for the board"* | `create_deck` (`from_current_page: true`: slides with finding-first titles, grounded in live SQL results) |
| *"Make slide 3 a bar chart and use the forest theme"* | `edit_deck` (changes only that slide and the theme) |
| *"Present it"* / *"Next slide"* / *"Download as PowerPoint"* / *"Put it in Google Slides"* | `control_deck` (`present` / `next` / `export_pptx` / `export_google_slides`) |
| *"Draw our real-time BigQuery & Vertex AI architecture in a new tab"* | `create_diagram` (`new_page: true`) |
| *"Document this architecture"* | `search_google_docs` + `get_google_docs` → `write_text` + `write_table` (official Google-grounded LLD & implementation guide in **Docs**) |

---

## Official Google Documentation Grounding (Developer Knowledge MCP)

Architecture documentation is grounded live against Google’s official [Developer Knowledge MCP Server](https://developers.google.com/knowledge/mcp) (`https://developerknowledge.googleapis.com/mcp`, tools `search_documents`, `get_documents`, `answer_query`) strictly on the server (`/api/docs/*`)—credentials never reach the browser.

1. Enable the Developer Knowledge API on your Google Cloud project:
   ```bash
   gcloud services enable developerknowledge.googleapis.com --project=<PROJECT_ID>
   ```
2. Authenticate using **either** method:
   - **Option A — API Key (in `studio/.env`):** create an API key in that GCP project restricted to the Developer Knowledge API and add:
     ```dotenv
     DEVELOPERKNOWLEDGE_API_KEY=<YOUR_GCP_API_KEY>
     ```
   - **Option B — Google Cloud ADC / `gcloud` (zero key management, works automatically on Cloud Run):**
     ```bash
     gcloud auth application-default login --project=<PROJECT_ID>
     ```
     Optionally set `DEVELOPERKNOWLEDGE_PROJECT_ID=<PROJECT_ID>` (or `GOOGLE_CLOUD_PROJECT`) in `studio/.env`.
3. Open **Settings → Official Google Documentation (MCP)** in the studio UI and click **Test live MCP connection** to verify.

---

## Optional Server Data Connectors

In addition to zero-config local SQLite-Wasm and drag-and-drop CSV/TSV/JSON/Parquet files, you can enable read-only server connectors via environment variables when starting `./studio.sh`:

| Connector | Environment Variables |
| --- | --- |
| **BigQuery** | `BIGQUERY_PROJECT_ID` (default project), optional `STUDIO_BIGQUERY_PROJECTS` (more projects, comma-separated), `BIGQUERY_MAX_BYTES_BILLED` (bytes one query may scan, default 1 GiB). Uses Application Default Credentials or `BIGQUERY_ACCESS_TOKEN`. |
| **ClickHouse HTTP** | `CLICKHOUSE_READONLY_URL` (endpoint of a read-only user) |
| **PostgreSQL HTTP Proxy** | `POSTGRES_HTTP_QUERY_URL`, optional `POSTGRES_HTTP_TOKEN` |
| **REST JSON Feed** | `STUDIO_REST_SOURCES` (JSON map of `{ "id": "https://..." }`) |

Give every connector credentials that can only read. The studio checks each query with a read-only SQL guard that
reads SQL the way the target database does, but the guard is a guardrail: the database role is the access control.

On a deployment with sign-in, only the owners (`STUDIO_OWNER_EMAILS`) can register or sync BigQuery projects;
everyone else queries the sources the owners set up. Set `STUDIO_ALLOWED_EMAILS` to limit who can sign in at all.
