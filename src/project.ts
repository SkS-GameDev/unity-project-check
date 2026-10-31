import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface AsmdefInfo {
  path: string;
  uri: string;
  name: string;
  guid?: string;
  references: string[];
}

export function findProjectRoot(start: string): string | undefined {
  let directory = start;
  try {
    if (existsSync(directory) && !readdirSync(directory).includes('Assets')) {
      directory = path.dirname(directory);
    }
  } catch {
    directory = path.dirname(directory);
  }
  for (;;) {
    if (existsSync(path.join(directory, 'Assets'))) return directory;
    const parent = path.dirname(directory);
    if (parent === directory) return undefined;
    directory = parent;
  }
}

export function isAsmdefFile(file: string): boolean {
  return file.endsWith('.asmdef');
}

export function isAsmrefFile(file: string): boolean {
  return file.endsWith('.asmref');
}

export function isManifestFile(file: string): boolean {
  return path.basename(file) === 'manifest.json' && path.basename(path.dirname(file)) === 'Packages';
}

export function isLockFile(file: string): boolean {
  return path.basename(file) === 'packages-lock.json' && path.basename(path.dirname(file)) === 'Packages';
}

export function readText(file: string): string {
  return readFileSync(file, 'utf8').replace(/^\uFEFF/, '');
}

export function isIgnoredPath(full: string, base: string): boolean {
  const parts = path.relative(base, full).split(path.sep);
  return parts.some(
    (part, index) => part.startsWith('.') || part.endsWith('~') || (index < parts.length - 1 && part.endsWith('.bundle'))
  );
}

export function readMetaGuid(metaPath: string): string | undefined {
  try {
    return /^guid: ([0-9a-f]{32})\r?$/m.exec(readText(metaPath).slice(0, 300))?.[1];
  } catch {
    return undefined;
  }
}

function walkFiles(base: string, extension: string): string[] {
  if (!existsSync(base)) return [];
  let entries;
  try {
    entries = readdirSync(base, { recursive: true, withFileTypes: true });
  } catch {
    return [];
  }
  const result: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(extension)) continue;
    const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
    if (!parent) continue;
    const full = path.join(parent, entry.name);
    if (isIgnoredPath(full, base)) continue;
    result.push(full);
  }
  return result;
}

export function findAsmdefFiles(root: string): string[] {
  return [
    ...walkFiles(path.join(root, 'Assets'), '.asmdef'),
    ...walkFiles(path.join(root, 'Packages'), '.asmdef'),
  ];
}

let scanCache: { root: string; at: number; asmdefs: AsmdefInfo[] } | undefined;
const SCAN_TTL_MS = 30000;

export function invalidateScan(): void {
  scanCache = undefined;
}

export function scanAsmdefs(root: string): AsmdefInfo[] {
  if (scanCache && scanCache.root === root && Date.now() - scanCache.at < SCAN_TTL_MS) {
    return scanCache.asmdefs;
  }
  const files = [...findAsmdefFiles(root), ...walkFiles(path.join(root, 'Library', 'PackageCache'), '.asmdef')];
  const result: AsmdefInfo[] = [];
  for (const file of files) {
    try {
      const json = JSON.parse(readText(file)) as { name?: unknown; references?: unknown };
      if (typeof json.name !== 'string' || json.name.length === 0) continue;
      const references = Array.isArray(json.references)
        ? json.references.filter((item): item is string => typeof item === 'string')
        : [];
      result.push({
        path: file,
        uri: pathToFileURL(file).toString(),
        name: json.name,
        guid: readMetaGuid(`${file}.meta`),
        references,
      });
    } catch {
      // Invalid asmdefs are diagnosed when opened; they cannot participate in the index.
    }
  }
  scanCache = { root, at: Date.now(), asmdefs: result };
  return result;
}

export interface AsmdefIndex {
  byName: Map<string, AsmdefInfo[]>;
  byGuid: Map<string, AsmdefInfo>;
}

export function buildIndex(asmdefs: AsmdefInfo[]): AsmdefIndex {
  const byName = new Map<string, AsmdefInfo[]>();
  const byGuid = new Map<string, AsmdefInfo>();
  for (const asmdef of asmdefs) {
    const list = byName.get(asmdef.name);
    if (list) list.push(asmdef);
    else byName.set(asmdef.name, [asmdef]);
    if (asmdef.guid) byGuid.set(asmdef.guid.toLowerCase(), asmdef);
  }
  return { byName, byGuid };
}

export function resolveReference(reference: string, index: AsmdefIndex): AsmdefInfo | undefined {
  if (reference.startsWith('GUID:')) {
    return index.byGuid.get(reference.slice(5).toLowerCase());
  }
  return index.byName.get(reference)?.[0];
}
