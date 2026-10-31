import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function project(files: Record<string, string>): string {
  const root = mkdtempSync(path.join(tmpdir(), 'unity-project-'));
  mkdirSync(path.join(root, 'Assets'), { recursive: true });
  mkdirSync(path.join(root, 'Packages'), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    const file = path.join(root, name);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
  return root;
}
