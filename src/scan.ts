import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { isIgnoredPath } from './project.js';

export const DEFAULT_MAX_FILE_SIZE = 20 * 1024 * 1024;

export interface ScanOptions {
  maxFileSize?: number;
  files?: string[];
}

export function collectFiles(root: string, extensions: string[], options: ScanOptions = {}): string[] {
  const maxFileSize = options.maxFileSize ?? DEFAULT_MAX_FILE_SIZE;
  const matches = (file: string): boolean => extensions.some((extension) => file.toLowerCase().endsWith(extension));
  if (options.files) {
    return [...new Set(options.files.filter((file) => matches(file)))].sort();
  }
  const result: string[] = [];
  for (const base of [path.join(root, 'Assets'), path.join(root, 'Packages')]) {
    if (!existsSync(base)) continue;
    let entries;
    try {
      entries = readdirSync(base, { recursive: true, withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isFile() || !matches(entry.name)) continue;
      const parent = (entry as unknown as { parentPath?: string }).parentPath ?? (entry as unknown as { path?: string }).path;
      if (!parent) continue;
      const file = path.join(parent, entry.name);
      if (isIgnoredPath(file, base)) continue;
      try {
        if (statSync(file).size > maxFileSize) continue;
      } catch {
        continue;
      }
      result.push(file);
    }
  }
  return result.sort();
}
