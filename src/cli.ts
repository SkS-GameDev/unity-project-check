import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findProjectRoot } from './project.js';
import { validateProject } from './asmdef.js';
import { validateManifestProject } from './manifest.js';
import { checkMeta } from './meta.js';
import { buildGuidIndex, validateSettingsProject } from './settings.js';
import { validateAddressables } from './addressables.js';
import { validateLocalization } from './localization.js';
import { validatePrefabs } from './prefabs.js';
import { validateShaderGraphs } from './shadergraph.js';
import { validateInputActions } from './inputactions.js';
import { validateAnimators } from './animator.js';
import { validateFiles } from './changed.js';
import { fingerprint, readBaseline, writeBaseline } from './baseline.js';
import { toSarif } from './sarif.js';
import { parseArgs, USAGE, type Options } from './args.js';
import { countRows, printRows, toRow, type Row } from './report.js';

function collect(root: string, options: Options): Row[] {
  if (options.files.length > 0) {
    return validateFiles(root, options.files, { maxFileSize: options.maxFileSize }).map(toRow);
  }
  const rows: Row[] = [];
  if (options.asmdef) rows.push(...validateProject(root).map(toRow));
  if (options.manifest) rows.push(...validateManifestProject(root).map(toRow));
  const needsGuids =
    options.settings || options.addressables || options.localization || options.prefabs || options.shadergraph || options.animator;
  const guidIndex = needsGuids ? buildGuidIndex(root) : undefined;
  if (options.settings) rows.push(...validateSettingsProject(root, guidIndex).map(toRow));
  if (options.addressables) rows.push(...validateAddressables(root, guidIndex ?? buildGuidIndex(root)).map(toRow));
  if (options.localization) rows.push(...validateLocalization(root, guidIndex).map(toRow));
  if (options.prefabs) {
    rows.push(...validatePrefabs(root, guidIndex ?? buildGuidIndex(root), { maxFileSize: options.maxFileSize }).map(toRow));
  }
  if (options.shadergraph) rows.push(...validateShaderGraphs(root, { maxFileSize: options.maxFileSize }, guidIndex).map(toRow));
  if (options.inputactions) rows.push(...validateInputActions(root, { maxFileSize: options.maxFileSize }).map(toRow));
  if (options.animator) {
    rows.push(...validateAnimators(root, guidIndex ?? buildGuidIndex(root), { maxFileSize: options.maxFileSize }).map(toRow));
  }
  if (options.meta) rows.push(...checkMeta(root).map(toRow));
  return rows;
}

export async function run(args: string[]): Promise<number> {
  const parsed = parseArgs(args);
  if (parsed.help) {
    console.log(USAGE);
    return 0;
  }
  if (parsed.error) {
    console.error(parsed.error);
    console.log(USAGE);
    return 2;
  }
  const options = parsed.options!;
  const root = findProjectRoot(options.project);
  if (!root) {
    console.error(`Not a Unity project (no Assets directory): ${options.project}`);
    return 2;
  }

  let rows = collect(root, options);

  if (options.writeBaseline) {
    writeBaseline(options.writeBaseline, root, rows);
    console.log(`Wrote ${rows.length} issue(s) to ${options.writeBaseline}`);
    return 0;
  }

  let baselined = 0;
  if (options.baseline) {
    const known = readBaseline(options.baseline);
    rows = rows.filter((row) => {
      const key = fingerprint(path.relative(root, row.file), row.code, row.message);
      if (!known.has(key)) return true;
      baselined++;
      return false;
    });
  }

  if (options.sarif) {
    console.log(toSarif(root, rows));
  } else if (options.json) {
    const { errors, warnings } = countRows(rows);
    console.log(JSON.stringify({ root, errors, warnings, baselined, issues: rows }, null, 2));
  } else {
    printRows(root, rows, baselined);
  }

  return countRows(rows).errors > 0 ? 1 : 0;
}

const direct = process.argv[1] !== undefined && pathToFileURL(process.argv[1]).href === import.meta.url;
if (direct) {
  run(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error) => {
      console.error(error);
      process.exit(2);
    });
}
