/**
 * A project as one JSON file, to back it up or move it to another browser:
 * its name, brief, sources, workspace and data tables (base64). Opening a
 * file creates a new project; a studio pages file (Export → Studio file)
 * opens as a project too.
 */
import type { SavedWorkspace } from '../engine/workspace';
import { pagesFromJson } from '../ui/export';
import { cleanBrief, cleanName, defaultSources, type NewProject, type NewTable, type ProjectMeta, type StoredTable } from './projectStore';
import { parseSavedWorkspace, workspaceFromScenes } from './workspaceData';

export const PROJECT_FILE_KIND = 'voice-whiteboard-project';
export const PROJECT_FILE_VERSION = 1;

interface ProjectFile {
  kind: typeof PROJECT_FILE_KIND;
  version: number;
  exportedAt: string;
  project: { name: string; brief: string; sources: ProjectMeta['sources'] };
  workspace: SavedWorkspace | null;
  tables: (Omit<NewTable, 'bytes'> & { bytes: string })[];
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export function projectToFile(meta: ProjectMeta, workspace: SavedWorkspace | null, tables: StoredTable[]): string {
  const file: ProjectFile = {
    kind: PROJECT_FILE_KIND,
    version: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    project: { name: meta.name, brief: meta.brief, sources: meta.sources },
    workspace,
    tables: tables.map(({ projectId: _drop, bytes, ...t }) => ({ ...t, bytes: bytesToBase64(bytes) })),
  };
  return JSON.stringify(file);
}

function parseTables(raw: unknown): NewTable[] {
  return (Array.isArray(raw) ? raw : []).flatMap((t: any) => {
    if (t == null || typeof t.tableName !== 'string' || t.tableName === '' || typeof t.bytes !== 'string') return [];
    try {
      return [{
        tableName: t.tableName,
        kind: t.kind === 'rows' ? 'rows' : 'file',
        fileName: typeof t.fileName === 'string' ? t.fileName : t.tableName,
        bytes: base64ToBytes(t.bytes),
        loadedAt: typeof t.loadedAt === 'number' ? t.loadedAt : Date.now(),
        ...(typeof t.description === 'string' ? { description: t.description } : {}),
      } satisfies NewTable];
    } catch {
      return [];
    }
  });
}

/** The project in a project file or a studio pages file, or null if the text is neither. */
export function projectFromFile(text: string, fileName = 'Imported project'): NewProject | null {
  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (data?.kind === PROJECT_FILE_KIND) {
    const p = data.project ?? {};
    return {
      name: cleanName(p.name),
      brief: cleanBrief(p.brief),
      sources: defaultSources(p.sources),
      workspace: parseSavedWorkspace(data.workspace),
      tables: parseTables(data.tables),
    };
  }
  const scenes = pagesFromJson(text);
  if (scenes == null || scenes.length === 0) return null;
  const base = fileName.replace(/\.[a-z0-9.]+$/i, '');
  return {
    name: cleanName(scenes[0].title || base),
    workspace: workspaceFromScenes(scenes),
  };
}

/** A file name for the project file: its name, safe on every system. */
export function projectFileName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'project';
  return `${slug}.project.json`;
}
