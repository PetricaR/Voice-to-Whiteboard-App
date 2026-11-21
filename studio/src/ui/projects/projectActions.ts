import { projectFileName, projectToFile } from '../../projects/projectFile';
import type { ProjectMeta, ProjectStore } from '../../projects/projectStore';
import { download } from '../export';

const RELATIVE = typeof Intl !== 'undefined' && 'RelativeTimeFormat' in Intl
  ? new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  : null;

/** "5 minutes ago", "yesterday", … */
export function timeAgo(ts: number, now = Date.now()): string {
  const seconds = Math.round((ts - now) / 1000);
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60], ['minute', 60], ['hour', 24], ['day', 7], ['week', 4.35], ['month', 12], ['year', Infinity],
  ];
  let value = seconds;
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) {
      if (unit === 'second') return 'just now';
      return RELATIVE ? RELATIVE.format(Math.round(value), unit) : `${Math.abs(Math.round(value))} ${unit}s ago`;
    }
    value /= size;
  }
  return '';
}

export function projectSummary(p: ProjectMeta): string {
  const pages = p.pageCount === 0 ? 'Empty' : `${p.pageCount} ${p.pageCount === 1 ? 'page' : 'pages'}`;
  return `${pages} · edited ${timeAgo(p.updatedAt)}`;
}

/** Downloads the project (workspace and tables) as one file. */
export async function exportProject(store: ProjectStore, project: ProjectMeta): Promise<void> {
  const [workspace, tables] = await Promise.all([store.loadWorkspace(project.id), store.listTables(project.id)]);
  download(projectFileName(project.name), projectToFile(project, workspace, tables), 'application/json');
}

/** Asks the browser not to clear the projects when it runs short of space. */
export function requestPersistentStorage(): void {
  try {
    void navigator.storage?.persist?.().catch(() => undefined);
  } catch {
    // not supported
  }
}
