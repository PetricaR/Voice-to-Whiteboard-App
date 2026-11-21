# Plan: Projects and Board

Status: Phases 1–2 done · 2026-11-21

## Goal

1. **Projects.** All work belongs to a project: pages (dashboard, motion, diagram, docs), the Board, the diagram history and the data sources. Several browser tabs can be open at once, each on its own project.
2. **Board.** Each page gets a place to explore and collect insights before they reach the dashboard. Charts and tables you like are promoted from the Board to the page's Dashboard.

## Decisions

| Question | Decision |
|---|---|
| What "open the app several times" means | Several tabs in the **same browser**. No sync between devices or people. |
| Where projects are stored | **IndexedDB**, one record per project. localStorage stays for global settings only. |
| Data sources | **Each project has its own.** Uploads, BigQuery and server connectors are attached to one project. No other project sees them. |
| Same project open in two tabs | **One tab owns it** (Web Locks API). The other tab can take it over with a clean handoff. Edits are never merged between tabs. |
| Switching project in a tab | **Full navigation** to `?project=<id>`. The in-memory SQL database, caches and the voice session start fresh. |
| Sample tables | Turned on or off **per project** (`includeSamples`). On for the migrated first project, off by default for new ones. |
| Board to Dashboard | **Copy and mark as promoted.** The Board keeps the history of where each chart came from. |

## What changes and why (current state)

- All work is saved under one localStorage key, `studio.workspace` ([App.tsx:40](../studio/src/ui/App.tsx#L40)). The save is debounced by 400 ms ([App.tsx:264](../studio/src/ui/App.tsx#L264)), and no tab listens for saves made by another tab. **With two tabs open, the last tab to save overwrites the other's work without warning.** This bug exists today.
- Uploaded tables live only in memory (`customTables` in [sqlEngine.ts:196](../studio/src/data/sqlEngine.ts#L196)). They are lost on reload, and the widgets built on them break.
- Sample tables are always loaded into the local database ([sqlEngine.ts:251](../studio/src/data/sqlEngine.ts#L251)).
- The server keeps BigQuery source registrations in one file shared by every page and tab ([bigqueryCatalog.ts:596](../studio/server/bigqueryCatalog.ts#L596)).
- The system prompt is a fixed constant ([session.ts:130](../studio/src/agent/session.ts#L130)). The agent has no idea which project it is working in.
- Browser storage is about 5 MB in total, which several projects will exceed.

## Design

### Storage (IndexedDB database `studio`, version 1)

| Store | Key | Value |
|---|---|---|
| `projects` | `id` | `{ id, name, brief, createdAt, updatedAt, lastOpenedAt, sources: ProjectSources }` |
| `workspaces` | `projectId` | `{ version: 2, active, pages, library }` (today's `SavedWorkspace` shape, unchanged) |
| `tables` | `[projectId, tableName]` | `{ projectId, tableName, kind: 'file' \| 'rows', fileName, bytes: Uint8Array, loadedAt, description? }` |

```ts
interface ProjectSources {
  includeSamples: boolean;
  /** Remote source ids attached to this project: 'bigquery:<gcp-project>', 'postgres', 'clickhouse', 'rest:<name>'. */
  remote: string[];
  /** Used when a widget or query names no source. */
  defaultSource: string; // 'local' unless the user picks another
}
```

- New module **`src/engine/projectStore.ts`** implements `listProjects`, `getProject`, `createProject`, `updateProject`, `deleteProject`, `loadWorkspace`, `saveWorkspace`, `putTable`, `deleteTable` and `listTables`, as a small promise wrapper over IndexedDB with no new runtime dependency. Everything else uses only this interface, so a Firestore implementation can be added later without touching the callers.
- Call `navigator.storage.persist()` when the first project is created, so the browser does not evict the data. The Home screen shows usage from `navigator.storage.estimate()`.
- `deleteProject` removes the project's records from all three stores in one transaction.

### Boot sequence ([main.tsx](../studio/src/main.tsx) / [App.tsx](../studio/src/ui/App.tsx))

1. Read `?project=` from the URL.
2. **No parameter:** show **Home** (the project list). Nothing else loads, and no lock is taken. *Exception (as built):* on the very first start, when there are no projects yet, the tab opens "My first project" directly (made from the earlier version's work, if any), so a new user lands in the studio rather than an empty list.
3. **With a parameter:** acquire the project's tab lock (see the next section), then:
   1. `getProject(id)`. If it is missing, go to Home and show "Project not found".
   2. `setProjectScope(project.sources)`, so the data layer knows the allowed sources before the database is built.
   3. `restoreProjectTables(id)`: replay every stored table through the existing import paths.
   4. `new Workspace(await loadWorkspace(id))`, then render the studio.
   5. `updateProject(id, { lastOpenedAt })`. Set `document.title` to `<project name> · Studio`.

`App` receives `project` and `workspace` as props instead of building them in `useMemo(() => new Workspace(savedWorkspace()))`.

### One tab per project (new module `src/ui/projectLock.ts`)

- **Lock name:** `studio:project:<id>`. Acquire it with `navigator.locks.request(name, { ifAvailable: true }, cb)`. The callback returns a promise that never resolves, so the tab holds the lock until it closes. The browser releases it automatically when a tab closes or crashes.
- **Lock not available:** show the **"Open in another tab"** screen with two actions: *Use it here* and *Back to projects*.
- **Handoff (Use it here):**
  1. The new tab posts `{ type: 'handoff-request' }` on `BroadcastChannel('studio:project:<id>')`.
  2. The owner tab flushes its pending save, stops the voice session and releases the lock. It then shows a **"This project moved to another tab"** overlay with only one action, *Use it here*, so nobody can edit there and nothing is saved.
  3. The new tab waits for the lock with `AbortSignal.timeout(3000)`. If the owner does not answer (a frozen tab), it retries with `{ steal: true }`.
  4. Only after it holds the lock does the new tab read the workspace from IndexedDB, so it always sees the owner's final save.
- **Home** calls `navigator.locks.query()` to label projects that are already open in a tab. Delete is disabled for those projects.

### Saving

- Replace the localStorage save effect in [App.tsx:240-270](../studio/src/ui/App.tsx#L240-L270) with `saveWorkspace(projectId, workspace.serialize())`, keeping the 400 ms debounce. Also update `projects.updatedAt`.
- Flush immediately on `visibilitychange` → hidden, on a handoff request and before navigating to another project.
- Keep the existing toast for a failed save ("storage is full → Export") and point it at IndexedDB errors (`QuotaExceededError`).
- Global settings stay in localStorage, because they are shared by all projects: `studio.ui`, the settings key and the dock minimized flag.

### Per-project data sources

New module **`src/data/projectScope.ts`**. It holds the current `ProjectSources` and is the single place that decides whether a source is allowed.

| Place | Change |
|---|---|
| Local database build ([sqlEngine.ts:251](../studio/src/data/sqlEngine.ts#L251)) | Load `SAMPLE_TABLES` only when `includeSamples` is on, so SQL cannot reach samples in a project that has none. |
| `importDataFile` ([sqlEngine.ts:383](../studio/src/data/sqlEngine.ts#L383)) and `importRowsIntoLocalTable` ([sqlEngine.ts:508](../studio/src/data/sqlEngine.ts#L508)) | After a successful import, call `putTable(projectId, …)` with the original bytes (files) or the rows as JSON (warehouse loads). Accept a `loadedAt` override so a restore keeps the original order. |
| `restoreProjectTables(projectId)` (new, in `sqlEngine.ts`) | Replays the stored tables at boot. If one fails, show a toast naming the table and keep loading the rest. |
| Removing an uploaded table | Calls `deleteTable` as well. |
| `listAllDataSources` ([sqlEngine.ts:620](../studio/src/data/sqlEngine.ts#L620)) | Returns `local` plus only the remote sources in `sources.remote`. |
| `inspectDataSchema`, `executeSqlQuery` | Reject a source the project has not attached, with the message: *"Source `X` is not part of project `Y`. Attach it in Data sources."* Dashboards, the Board and the agent all go through these functions, so this one check covers them all. |
| [DataSourceModal.tsx](../studio/src/ui/dashboard/DataSourceModal.tsx) / BigQuery panel | "Add source" registers it on the server if needed, then **attaches** it to the project. "Remove" **detaches** it. A separate *Manage connections* area deletes a server registration, and only when no project uses it (check every project in IndexedDB). |
| `sync_bigquery` ([dispatcher.ts:458](../studio/src/agent/dispatcher.ts#L458)) | A synced `project_id` is attached to the current project. `syncAll` syncs only the sources this project has attached. |

> Project scoping keeps the work focused on the project. **It is not a security boundary.** The server still trusts the signed-in user exactly as it does today.

To verify while building: whether the bare `bigquery` id means the server's default GCP project. If it does, treat it as an alias of `bigquery:<default>` when checking attachments.

### Agent

- **`buildSystemInstruction(project)`** in [prompt.ts](../studio/src/agent/prompt.ts) adds a `# Project` section to `SYSTEM_INSTRUCTION`: the name, the brief and the attached sources. It also adds the rule: *"Work only with this project's sources and topic. If the user asks for data outside it, say so and offer to attach the source."* [session.ts:130](../studio/src/agent/session.ts#L130) passes the result instead of the constant. The project never changes within a tab, so the instruction is set once per session.
- `list_data_sources` already goes through `listAllDataSources`, so it lists only the project's sources once that function filters them.
- `stateOf(ctx)` prefixes the page list with the project name, so every tool result says which project it belongs to.
- When a project has no sources yet, the agent's first useful step is to ask for data. Add this to the prompt, because otherwise the agent reaches for sample tables that the project does not have.

### UI

- **Home** (new `src/ui/HomeView.tsx`): recent projects as cards with name, brief, last opened and an "open in another tab" label. Actions: **New**, **Rename**, **Duplicate** (copies the workspace and tables), **Delete** (an in-app confirm dialog, never `window.confirm`), **Export** (JSON with base64 tables) and **Import**.
- **New project dialog:** name, brief and an *Include sample data* checkbox.
- **[TopBar.tsx](../studio/src/ui/TopBar.tsx):** the project name opens a switcher (recent projects, *All projects…*, *New project…*). Picking a project navigates the tab; opening it in a new tab is also offered.
- **Data sources modal** title: "Data sources · <project name>".

### Migration (runs once)

On boot, if IndexedDB has no projects and localStorage has `studio.workspace` (or the older `studio.scene`), create **"My first project"** (`includeSamples: true`) from it, together with `studio.library`. Leave the localStorage keys in place for one release as a backup, with a `studio.migrated = 1` marker, then remove them. Uploaded tables cannot be migrated, because they were never saved. Show a one-time note to re-upload them.

### Board (inside each project and page)

As reviewed earlier:

- **Model:** `scene.board?: DashboardSpec`, beside `scene.dashboard`, so `applyDashboardEdit`, `chartReview`, `ChartRenderer` and undo/redo all work on it. Optional per-widget fields: `askedAs` (the question), `insight` (a snapshot of the `facts` text), `promotedAt`.
- **Agent:** add `target: 'board' | 'dashboard'` to `create_dashboard`, `edit_dashboard` and `refresh_dashboard`, plus a new op `promote_widgets: string[]` (it accepts `@selected`).
  - Routing rule: questions and exploration ("why…", "show me…") go to the Board. "Build / update the dashboard" goes to the Dashboard.
- **Promotion:** copy the widget, give it a new id if needed (reuse the `copy_of` logic), and bring over the filters its SQL uses. If a filter is missing on the Dashboard, add it; if that is not possible, inline its current value. Insert the widget after the last promoted one, then run `reviewDashboardLayout`. The whole promotion is **one undo step**.
- **Cost:** the Board never auto-refreshes. Results are frozen with the time they ran and re-run only on request. Save insight facts, not result rows.
- **Excluded:** exports (HTML, Grafana, Vega-Lite, SQL), `create_motion from_current_page` and the docs ignore the Board.
- **UI:** a new `PageView` `'board'`. Cards are ordered by time, with the question as each card's heading and its insight line. Each card has **Pin to dashboard** next to its SQL button, and several cards can be selected and promoted at once.

## Phases

Each phase ships on its own, and `./studio.sh test`, `build` and `e2e` stay green after each one.

### Phase 1: Projects and storage (about 3–4 days)

- `projectStore.ts`, migration, the new boot sequence, Home, the TopBar switcher, saving to IndexedDB, and Duplicate / Delete / Export / Import.
- **Tests:**
  - New dev dependency `fake-indexeddb`: store CRUD, migration from both legacy keys, workspace round-trip, and delete removing every record of the project.
  - E2E: create two projects, edit each, reload, and check that each still has its own pages.

### Phase 2: One tab per project (about 1–2 days)

- `projectLock.ts`, the "Open in another tab" screen, the handoff and the "moved to another tab" overlay, and the Home labels.
- **Tests:**
  - E2E with two Playwright pages in one browser context:
    - **Different projects:** edits stay independent.
    - **Same project:** the second tab is blocked.
    - **Handoff:** the second tab sees the first tab's last edit.
    - **The first tab** shows the overlay and no longer saves.
  - Unit: the flush happens before the lock is released.

### Phase 3: Per-project data sources and agent scope (about 3 days)

- `projectScope.ts`, saving and restoring tables, the samples toggle, the source checks in `sqlEngine.ts`, attach/detach in the Data sources modal, `sync_bigquery` attaching to the project, `buildSystemInstruction` and the project name in `stateOf`.
- **Tests:**
  - **Unit:**
    - An upload survives a reload.
    - Project A's upload is not visible in project B.
    - A query on an unattached source fails with the guidance message.
    - Samples are absent when `includeSamples` is off.
  - **Eval scenario:** in a project without samples, "build a revenue dashboard" makes the agent ask for data instead of using sample tables.

### Phase 4: Board (about 4–5 days)

- The model, the `target` parameter and `promote_widgets`, the Board view, pin and multi-promote, frozen results, and the routing rule in the prompt.
- **Tests:**
  - **Unit:**
    - Promotion renames clashing ids.
    - Promotion carries filters or inlines their values.
    - A promotion is undone in one step.
  - **Eval scenarios:** routing between Board and Dashboard, and "pin that one".

## Out of scope

- Sync between devices or users, sharing projects and Firestore storage. The `projectStore` interface leaves room for these later.
- Separating server-side BigQuery registrations per user (they are still shared per server).
- Merging edits made at the same time in two tabs.

## Risks

- **IndexedDB is asynchronous.** A save still pending when a tab is closed abruptly can lose up to the last 400 ms of edits. Flushing on `visibilitychange` covers normal closes and tab switches.
- **Large uploads.** Replaying a large CSV or Parquet file at every boot slows the project opening. If that becomes noticeable, store a `db.export()` snapshot of the user tables instead.
- **Agent routing (Board or Dashboard)** is the feature most likely to misbehave. Add the eval scenarios before tuning the prompt.
