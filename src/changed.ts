import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Issue } from './types.js';
import {
  buildIndex,
  isAsmdefFile,
  isAsmrefFile,
  isLockFile,
  isManifestFile,
  readText,
  scanAsmdefs,
} from './project.js';
import { validateAsmdef, validateAsmref } from './asmdef.js';
import { validateManifest } from './manifest.js';
import { checkMeta } from './meta.js';
import {
  buildGuidIndex,
  validateSchemaVersion,
  validateGraphicsSettings,
  validateProjectVersion,
  validateSettingsProject,
  validateTagManager,
} from './settings.js';
import { validateAddressables } from './addressables.js';
import { validateLocalization } from './localization.js';
import { validatePrefabs } from './prefabs.js';
import { validateShaderGraphFile } from './shadergraph.js';
import { validateInputActionsFile } from './inputactions.js';
import { validateAnimatorFile } from './animator.js';
import type { ScanOptions } from './scan.js';

function dedupe(issues: Issue[]): Issue[] {
  const seen = new Set<string>();
  const result: Issue[] = [];
  for (const issue of issues) {
    const key = `${issue.file}\u0000${issue.start}\u0000${issue.end}\u0000${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(issue);
  }
  return result;
}

export function validateFiles(root: string, files: string[], options: ScanOptions = {}): Issue[] {
  const absoluteRoot = path.resolve(root);
  const targets = [
    ...new Set(
      files.map((file) => {
        if (path.isAbsolute(file)) return path.resolve(file);
        const fromCwd = path.resolve(file);
        return existsSync(fromCwd) ? fromCwd : path.resolve(root, file);
      })
    ),
  ].filter((file) => file.startsWith(absoluteRoot + path.sep));
  if (targets.length === 0) return [];

  const issues: Issue[] = [];
  let guidIndex: Map<string, string> | undefined;
  const guids = (): Map<string, string> => (guidIndex ??= buildGuidIndex(root));
  let asmdefs: ReturnType<typeof scanAsmdefs> | undefined;
  let asmdefIndex: ReturnType<typeof buildIndex> | undefined;
  const asmdefData = () => {
    asmdefs ??= scanAsmdefs(root);
    asmdefIndex ??= buildIndex(asmdefs);
    return { asmdefs, asmdefIndex };
  };
  let metaIssues: Issue[] | undefined;

  for (const file of targets) {
    const text = (): string => readText(file);
    if (isAsmdefFile(file)) {
      const data = asmdefData();
      issues.push(...validateAsmdef(file, text(), data.asmdefIndex, data.asmdefs).issues);
      continue;
    }
    if (isAsmrefFile(file)) {
      issues.push(...validateAsmref(file, text(), asmdefData().asmdefIndex));
      continue;
    }
    if (isManifestFile(file) || isLockFile(file)) {
      issues.push(...validateManifest(file, text(), root));
      continue;
    }
    if (file.endsWith('.meta')) {
      metaIssues ??= checkMeta(root);
      const asset = file.slice(0, -'.meta'.length);
      issues.push(...metaIssues.filter((issue) => issue.file === file || issue.file === asset));
      continue;
    }
    if (path.basename(file) === 'ProjectVersion.txt') {
      issues.push(...validateProjectVersion(file, text()), ...validateSchemaVersion(root));
      continue;
    }
    if (path.basename(file) === 'TagManager.asset' && path.basename(path.dirname(file)) === 'ProjectSettings') {
      issues.push(...validateTagManager(file, text()));
      continue;
    }
    if (path.basename(file) === 'GraphicsSettings.asset' && path.basename(path.dirname(file)) === 'ProjectSettings') {
      issues.push(...validateGraphicsSettings(file, text(), guids()));
      continue;
    }
    if (path.basename(path.dirname(file)) === 'ProjectSettings' && file.endsWith('.asset')) {
      issues.push(...validateSettingsProject(root, guids()).filter((issue) => issue.file === file));
      continue;
    }
    if (file.includes(`${path.sep}AddressableAssetsData${path.sep}`) && file.endsWith('.asset')) {
      issues.push(...validateAddressables(root, guids()).filter((issue) => issue.file === file));
      continue;
    }
    if (file.includes(`${path.sep}LocalizationSettings${path.sep}`) || file.endsWith(' Shared Data.asset')) {
      const name = path.basename(file);
      issues.push(
        ...validateLocalization(root, guids()).filter((issue) => issue.file === file || issue.message.includes(name))
      );
      continue;
    }
    if (file.endsWith('.prefab') || file.endsWith('.unity')) {
      issues.push(...validatePrefabs(root, guids(), { ...options, files: [file] }));
      continue;
    }
    if (file.endsWith('.shadergraph')) {
      issues.push(...validateShaderGraphFile(file, text(), guids()));
      continue;
    }
    if (file.endsWith('.inputactions')) {
      issues.push(...validateInputActionsFile(file, text()));
      continue;
    }
    if (file.endsWith('.controller')) {
      issues.push(...validateAnimatorFile(file, text(), guids()));
    }
  }
  return dedupe(issues);
}
