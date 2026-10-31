import { DEFAULT_MAX_FILE_SIZE } from './scan.js';

export interface Options {
  project: string;
  json: boolean;
  sarif: boolean;
  baseline?: string;
  writeBaseline?: string;
  maxFileSize: number;
  files: string[];
  asmdef: boolean;
  manifest: boolean;
  meta: boolean;
  settings: boolean;
  addressables: boolean;
  localization: boolean;
  prefabs: boolean;
  shadergraph: boolean;
  inputactions: boolean;
  animator: boolean;
}

export interface ParseResult {
  options?: Options;
  help?: boolean;
  error?: string;
}

export function parseSize(value: string | undefined): number {
  if (!value) return DEFAULT_MAX_FILE_SIZE;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)?$/i.exec(value.trim());
  if (!match) return DEFAULT_MAX_FILE_SIZE;
  const amount = Number(match[1]);
  const unit = (match[2] ?? 'b').toLowerCase();
  const multiplier = unit === 'gb' ? 1024 ** 3 : unit === 'mb' ? 1024 ** 2 : unit === 'kb' ? 1024 : 1;
  return Math.max(1, Math.round(amount * multiplier));
}

export function parseArgs(args: string[]): ParseResult {
  const options: Options = {
    project: process.cwd(),
    json: false,
    sarif: false,
    maxFileSize: DEFAULT_MAX_FILE_SIZE,
    files: [],
    asmdef: false,
    manifest: false,
    meta: false,
    settings: false,
    addressables: false,
    localization: false,
    prefabs: false,
    shadergraph: false,
    inputactions: false,
    animator: false,
  };
  let anySelected = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--project' || arg === '-p') {
      options.project = args[++i] ?? options.project;
      continue;
    }
    if (arg === '--json') {
      options.json = true;
      continue;
    }
    if (arg === '--sarif') {
      options.sarif = true;
      continue;
    }
    if (arg === '--baseline') {
      options.baseline = args[++i];
      continue;
    }
    if (arg === '--write-baseline') {
      options.writeBaseline = args[++i];
      continue;
    }
    if (arg === '--max-file-size') {
      options.maxFileSize = parseSize(args[++i]);
      continue;
    }
    if (arg === '--files') {
      while (i + 1 < args.length && !args[i + 1].startsWith('--')) options.files.push(args[++i]);
      continue;
    }
    const section = SECTION_FLAGS[arg];
    if (section) {
      options[section] = true;
      anySelected = true;
      continue;
    }
    return { error: `Unknown argument: ${arg}` };
  }

  if (!anySelected && options.files.length === 0) {
    options.asmdef = true;
    options.manifest = true;
    options.meta = true;
    options.settings = true;
    options.addressables = true;
    options.localization = true;
    options.shadergraph = true;
    options.inputactions = true;
    options.animator = true;
  }
  return { options };
}

type Section = 'asmdef' | 'manifest' | 'meta' | 'settings' | 'addressables' | 'localization' | 'prefabs' | 'shadergraph' | 'inputactions' | 'animator';

const SECTION_FLAGS: Record<string, Section | undefined> = {
  '--asmdef': 'asmdef',
  '--manifest': 'manifest',
  '--meta': 'meta',
  '--settings': 'settings',
  '--addressables': 'addressables',
  '--localization': 'localization',
  '--prefabs': 'prefabs',
  '--shadergraph': 'shadergraph',
  '--inputactions': 'inputactions',
  '--animator': 'animator',
};

export const USAGE = `Usage: unity-project-check [--project <path>] [--json|--sarif] [--baseline <file>|--write-baseline <file>]
       [--files <path...>] [--max-file-size <size>]
       [--asmdef] [--manifest] [--meta] [--settings] [--addressables] [--localization]
       [--prefabs] [--shadergraph] [--inputactions] [--animator]

Checks Unity project structure:
  --project <path>          project root or any path inside it (default: cwd)
  --json                    machine-readable output
  --sarif                   SARIF 2.1.0 output
  --baseline <file>         ignore issues already recorded in the baseline file
  --write-baseline <file>   write current issues to the baseline file and exit 0
  --files <path...>         validate only the given files (until the next option)
  --max-file-size <size>    skip larger prefabs/scenes/graphs (e.g. 20mb, 52428800)
  --asmdef                  only asmdef/asmref checks
  --manifest                only Packages/manifest.json and packages-lock.json
  --meta                    only .meta integrity checks
  --settings                only ProjectSettings checks
  --addressables            only Addressables groups, entries, labels
  --localization            only Localization tables and keys
  --prefabs                 only prefab cycles and missing scripts (opt-in: noisy on imported assets)
  --shadergraph             only ShaderGraph JSON structure and references
  --inputactions            only Input System .inputactions files
  --animator                only AnimatorController references and state machine cycles`;
