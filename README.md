# unity-project-check

[Русская версия](README.ru.md)

Unity project structure checks: the `unity-project-check` CLI and the
`unity-project-lsp` LSP server for `.asmdef`/`.asmref`. No Unity Editor required.

## Installation

```sh
npm install
npm run compile
npm link
```

This creates two global commands: `unity-project-lsp` and `unity-project-check`.

## OpenCode

```jsonc
"lsp": {
  "unity-project": {
    "command": ["unity-project-lsp"],
    "extensions": [".asmdef", ".asmref"]
  }
}
```

`.asset`, `.prefab`, `.unity` and `.meta` are left to `unity-yaml-lsp`.

## CLI

```sh
unity-project-check --project /path/to/unity-project
unity-project-check --json --project . > report.json
unity-project-check --sarif --project . > report.sarif
unity-project-check --project . --files Assets/Game/Game.asmdef
unity-project-check --project . --write-baseline .unity-check-baseline.json
unity-project-check --project . --baseline .unity-check-baseline.json
```

Flags: `--asmdef`, `--manifest`, `--meta`, `--settings`, `--addressables`,
`--localization`, `--prefabs`, `--shadergraph`, `--inputactions`, `--animator`,
`--json`, `--sarif`, `--baseline <file>`, `--write-baseline <file>`,
`--files <path...>`, `--max-file-size <size>`, `--project <path>`.
Without flags everything runs except `--prefabs`. Exit code is 1 when errors are found.

`--files` checks only the listed files while keeping the project context
(asmdef index, GUID index). `--baseline` hides the issues recorded by
`--write-baseline`, so CI fails only on new ones. `--max-file-size`
accepts `20mb`, `500kb` or bytes.

### Checks

| Area | What is checked |
| --- | --- |
| asmdef / asmref | JSON syntax (BOM allowed), required name, field types, duplicate names, unresolved references (warning — Unity ignores them), self-reference, reference cycles, `.asmref` target |
| Packages | `manifest.json` types, semver/local/git versions, local paths, presence of `packages-lock.json` and version mismatch |
| .meta | missing meta, orphaned meta, duplicate GUIDs |
| ProjectSettings | `ProjectVersion.txt` format and schema version mismatch, build scenes (presence and duplicates), duplicate tags/layers/sorting layers, 32 layers, render pipeline GUID, PlayerSettings (names, version, input handler, scripting backend), QualitySettings (names and current index), InputManager (duplicates and dead axes), physics collision matrix length |
| Addressables | groups and default group, duplicate group names, group schema GUIDs, duplicate labels, entry GUIDs (Assets, Packages, PackageCache), duplicate and conflicting addresses, unregistered labels, profiles (names, entries, parents, values) |
| Localization | duplicate and empty keys, duplicate ids, collection GUID mismatch, `m_SharedData` reference, duplicate ids in tables, orphaned entries, missing translations, missing localized assets, placeholder parity between locales |
| Prefabs (opt-in) | cycles in nested prefabs, missing source prefabs, `m_Script: {fileID: 0}`, non-existent script GUIDs |
| ShaderGraph | sequence of JSON documents, unique object ids, graph references, node/edge slot references, duplicate property reference names, missing subgraph GUIDs |
| Input System | JSON, duplicate maps/actions, binding references to actions, dead bindings, duplicate ids, duplicate control schemes, unknown groups, control path syntax, orphaned composite parts |
| Animator | fileID references within the file, default state and state machines of layers, child state machines, transitions, state machine cycles, motion GUIDs, duplicate parameters, conditions on non-existent parameters |

### Limitations

- `--prefabs` is enabled manually: imported assets often contain missing
  scripts, so the report is noisy on large third-party libraries.
- Prefabs/scenes larger than 20 MB are skipped to keep memory from growing (the size
  is changed with the `--max-file-size` flag).
- The Addressables/Localization checks assume the standard Unity package layout.
- The CLI does not depend on the Unity Editor and does not see editor-only state
  (import settings, platform overrides, build results).

## Development

```sh
npm test                     # компиляция + node:test
npm run bench -- <project>   # полный прогон с бюджетом UNITY_CHECK_BUDGET_MS (30 с)
npm run audit                # секреты и корпоративные строки
```

`ci/unity-check.gitlab-ci.yml` is a ready-made GitLab job template (SARIF artifact,
baseline, benchmark check).

## Unity YAML specifics

- UTF-8 BOM in `.asmdef`/`.meta`/JSON;
- Unity multi-line single-quoted scalars (closing quote at the start of a line or
  at the end of a line) are folded into spaces before parsing, offsets are preserved;
- `Samples~`, hidden folders and `*.bundle` contents are ignored, as in Unity.

## Rollback

Remove the global links (`npm unlink -g unity-project-lsp`) and the
`lsp.unity-project` entry in the OpenCode config. Nothing is written to the Unity project.
