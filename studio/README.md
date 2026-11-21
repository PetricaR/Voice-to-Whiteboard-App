# Voice Whiteboard — Live Dashboards, Motion & Diagrams (`studio/`)

Application workspace for **Voice Whiteboard Studio**, combining four synchronized surfaces per page tab—**Dashboard** (live SQLite-Wasm + enterprise SQL connectors), **Motion** (60fps deterministic programmatic animation + WebCodecs `.mp4` export), **Diagram** (incremental ELK/ReactFlow architecture & flowchart whiteboard), and **Docs** (arc42/C4 Markdown book)—all driven conversationally via the **Gemini Live API**.

## Commands

```bash
./studio.sh          # install deps if needed, load GEMINI_API_KEY from .env by default, start http://127.0.0.1:5173
./studio.sh key      # optional fallback: save/replace Gemini API key in macOS Keychain (service: voice-whiteboard-studio)
./studio.sh test     # run Vitest unit, data, dashboard, motion, workspace & security suites
./studio.sh build    # run tsc --noEmit && vite build
./studio.sh e2e      # run headless Chrome smoke + mock Gemini Live WebSocket E2E suites
./studio.sh check    # verify real Gemini API key -> single-use ephemeral token -> Live session
./studio.sh eval     # run multi-turn Gemini Live evaluation scenarios (eval/scenarios.ts)
```

## Architecture Overview

- `src/data/`
  - `sqlGuard.ts`: Enforces read-only single-statement `SELECT`/`WITH` SQL, blocks DDL/DML/PRAGMA/ATTACH, binds `:param` filters safely, and caps `LIMIT`.
  - `sampleDatasets.ts`: 10 sample tables (`monthly_revenue`, `enterprise_accounts`, `daily_orders`, `conversion_funnel`, `service_spend`, `deals_pipeline`, `stock_ohlc`, `project_roadmap`, `org_directory`, `global_flows`).
  - `sqlEngine.ts`: In-browser/Node `sql.js` (SQLite-Wasm) engine + `.csv`/`.tsv`/`.json`/`.jsonl`/`.parquet` (`hyparquet`) table importer + `/api/data/*` remote connector client.
- `src/engine/`
  - `dashboard.ts`: Pure TypeScript `DashboardSpec` model, incremental `applyDashboardEdit` ops, fuzzy widget ref resolution, metric formatting, and HTML / SQL / Vega-Lite / Grafana JSON exporters.
  - `board.ts`: The Board of a page (`scene.board`, a second `DashboardSpec`): work in progress while exploring. Charts land there with the question they answer (`askedAs`) and what they showed (`insight`); `promoteWidgets` copies chosen charts to the page's dashboard with the filters their SQL uses, as one undo step. The Board never auto-refreshes and is left out of exports and motion.
  - `chartInsights.ts`: The chart review the voice agent gets back from `create_dashboard`, `edit_dashboard` and `refresh_dashboard`: every widget query is run and checked against its chart kind (`issues` to fix, `advice` with the exact patch, `facts` for the spoken insight), plus 12-column layout notes.
  - `motion.ts` & `timeline.ts`: Deterministic `MotionSpec` model, cross-surface `generateMotionFromPage` storyboard synthesizer, spring/smooth/snappy/linear timeline evaluator (`evaluateMotionAt`), and 60fps Canvas2D renderer (`renderMotionFrame`).
  - `ops.ts`, `placement.ts`, `layout.ts`, `book.ts`, `store.ts`, `workspace.ts`: Atomic Undo/Redo store and multi-page, multi-surface workspace (`'dashboard' | 'motion' | 'diagram' | 'doc'`).
- `src/projects/`
  - `projectStore.ts`: Projects saved in this browser (IndexedDB database `studio`): each project's metadata, workspace (pages + diagram history) and data tables, behind a `ProjectStore` interface so another backend can be added later.
  - `boot.ts`: Which project a tab opens (`?project=<id>`; without it the project list), and the first start that turns an earlier version's localStorage workspace into "My first project".
  - `projectLock.ts`: One tab per project (Web Locks API): the tab that opens a project holds its lock; another tab can ask for it over a BroadcastChannel (the owner saves, stops and lets go) or takes it after 3 s if the owner does not answer.
  - `../data/projectScope.ts`: The data sources a project may use (its uploads always; the sample tables and attached remote sources by choice). The SQL engine leaves out what the project does not have and refuses queries on unattached sources; uploaded files and warehouse rows are saved with the project and restored when it opens. Every agent tool result starts with a `project:` line.
  - `projectFile.ts`, `workspaceData.ts`: One-file project export/import (tables as base64; a studio pages file also imports) and saved-workspace parsing.
- `src/motion-export/mp4Exporter.ts`: Deterministic offline frame-by-frame WebCodecs `VideoEncoder` + `mp4-muxer` `.mp4` encoder with `MediaRecorder` `.webm` fallback.
- `src/agent/`
  - `tools.ts`, `dispatcher.ts`, `prompt.ts`, `session.ts`: `NON_BLOCKING` Gemini Live tool declarations and stateful tool dispatcher returning the live workspace summary on every turn.
- `src/ui/`
  - `dashboard/`: `DashboardView.tsx`, `ChartRenderer.tsx` (48 chart and table types), `ChartGalleryModal.tsx` (Add chart), `ChartControlsPanel.tsx` (type, axes, style, overlays), `QueryInspectorDrawer.tsx` (top-layer `<dialog popover="manual">` SQL lineage inspector), `DataSourceModal.tsx`.
  - `motion/`: `MotionView.tsx` (60fps stage, click hit-box layer selection, timeline scrubber, inline property editor, captions & Web Speech narration), `ExportMp4Dialog.tsx`.
  - `canvas/`, `DocView.tsx`, `VoiceDock.tsx` (with `/` slash commands), `PageTabs.tsx`, `TopBar.tsx`, `SidePanel.tsx`.
- `server/`
  - `index.ts`, `liveToken.ts`, `apiKey.ts`, `auth.ts`, `dataConnectors.ts`, `googleDocsMcp.ts`, `sqlGuard.ts`: Zero-key-leakage ephemeral token server, read-only SQL connector proxy, and official Google Developer Knowledge MCP client (`/api/docs/*` → `https://developerknowledge.googleapis.com/mcp`).
