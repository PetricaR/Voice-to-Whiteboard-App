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
  - `sampleDatasets.ts`: 6 multi-table sample datasets (`monthly_revenue`, `enterprise_accounts`, `daily_orders`, `conversion_funnel`, `service_spend`, `deals_pipeline`).
  - `sqlEngine.ts`: In-browser/Node `sql.js` (SQLite-Wasm) engine + `.csv`/`.tsv`/`.json`/`.jsonl`/`.parquet` (`hyparquet`) table importer + `/api/data/*` remote connector client.
- `src/engine/`
  - `dashboard.ts`: Pure TypeScript `DashboardSpec` model, incremental `applyDashboardEdit` ops, fuzzy widget ref resolution, metric formatting, and HTML / SQL / Vega-Lite / Grafana JSON exporters.
  - `motion.ts` & `timeline.ts`: Deterministic `MotionSpec` model, cross-surface `generateMotionFromPage` storyboard synthesizer, spring/smooth/snappy/linear timeline evaluator (`evaluateMotionAt`), and 60fps Canvas2D renderer (`renderMotionFrame`).
  - `ops.ts`, `placement.ts`, `layout.ts`, `book.ts`, `store.ts`, `workspace.ts`: Atomic Undo/Redo store and multi-page, multi-surface workspace (`'dashboard' | 'motion' | 'diagram' | 'doc'`).
- `src/motion-export/mp4Exporter.ts`: Deterministic offline frame-by-frame WebCodecs `VideoEncoder` + `mp4-muxer` `.mp4` encoder with `MediaRecorder` `.webm` fallback.
- `src/agent/`
  - `tools.ts`, `dispatcher.ts`, `prompt.ts`, `session.ts`: `NON_BLOCKING` Gemini Live tool declarations and stateful tool dispatcher returning the live workspace summary on every turn.
- `src/ui/`
  - `dashboard/`: `DashboardView.tsx`, `ChartRenderer.tsx` (48 chart and table types), `ChartGalleryModal.tsx` (Add chart), `ChartControlsPanel.tsx` (type, axes, style, overlays), `QueryInspectorDrawer.tsx` (top-layer `<dialog popover="manual">` SQL lineage inspector), `DataSourceModal.tsx`.
  - `motion/`: `MotionView.tsx` (60fps stage, click hit-box layer selection, timeline scrubber, inline property editor, captions & Web Speech narration), `ExportMp4Dialog.tsx`.
  - `canvas/`, `DocView.tsx`, `VoiceDock.tsx` (with `/` slash commands), `PageTabs.tsx`, `TopBar.tsx`, `SidePanel.tsx`.
- `server/`
  - `index.ts`, `liveToken.ts`, `apiKey.ts`, `auth.ts`, `dataConnectors.ts`, `sqlGuard.ts`: Zero-key-leakage ephemeral token server and read-only SQL connector proxy.
