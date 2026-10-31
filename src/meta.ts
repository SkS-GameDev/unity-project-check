import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { isIgnoredPath, readText } from './project.js';

interface MetaInfo {
  path: string;
  guid?: string;
  content: string;
}

function hidden(name: string): boolean {
  return (
    name.startsWith('.') ||
    name.startsWith('~') ||
    name === 'Thumbs.db' ||
    name === 'cvs' ||
    name.endsWith('.tmp')
  );
}

export function checkMeta(root: string): Issue[] {
  const assetsDir = path.join(root, 'Assets');
  const issues: Issue[] = [];
  const report = (file: string, message: string, severity: DiagnosticSeverity): void => {
    issues.push({ file, start: 0, end: 1, severity, message });
  };
  if (!existsSync(assetsDir)) return issues;

  const assets = new Map<string, boolean>();
  const metas = new Map<string, MetaInfo>();
  let entries;
  try {
    entries = readdirSync(assetsDir, { recursive: true, withFileTypes: true });
  } catch {
    return issues;
  }

  for (const entry of entries) {
    if (hidden(entry.name)) continue;
    const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
    if (!parent) continue;
    const full = path.join(parent, entry.name);
    if (isIgnoredPath(full, assetsDir)) continue;
    if (entry.isFile() && entry.name.endsWith('.meta')) {
      let content = '';
      try {
        content = readText(full).slice(0, 1000);
      } catch {
        // Unreadable meta is reported by its own missing guid.
      }
      const guid = /^guid: ([0-9a-f]{32})$/m.exec(content)?.[1];
      metas.set(full, { path: full, guid, content });
      continue;
    }
    assets.set(full, entry.isDirectory());
  }

  const byGuid = new Map<string, MetaInfo[]>();
  for (const meta of metas.values()) {
    if (!meta.guid) {
      report(meta.path, 'Meta file has no valid guid', DiagnosticSeverity.Error);
      continue;
    }
    const list = byGuid.get(meta.guid);
    if (list) list.push(meta);
    else byGuid.set(meta.guid, [meta]);
  }
  for (const [guid, list] of byGuid) {
    if (list.length < 2) continue;
    for (const meta of list) {
      report(meta.path, `Duplicate guid ${guid} (${list.length} meta files)`, DiagnosticSeverity.Error);
    }
  }

  for (const [asset] of assets) {
    const metaPath = `${asset}.meta`;
    if (!metas.has(metaPath) && !existsSync(metaPath)) {
      report(asset, 'Asset or folder has no .meta file', DiagnosticSeverity.Warning);
    }
  }

  for (const meta of metas.values()) {
    const asset = meta.path.slice(0, -'.meta'.length);
    if (!assets.has(asset) && !existsSync(asset)) {
      report(meta.path, 'Orphan .meta file: asset does not exist', DiagnosticSeverity.Warning);
    }
  }

  return issues;
}
