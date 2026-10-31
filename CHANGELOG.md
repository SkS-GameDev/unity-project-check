# Changelog

## 0.2.0

- CLI: `--baseline`, `--write-baseline`, `--sarif`, `--files`, `--max-file-size`.
- Prefab issues are aggregated per file and code.
- ProjectSettings: PlayerSettings, QualitySettings, InputManager, physics collision
  matrix, UnityYaml schema version drift.
- Addressables: duplicate group names, group schema GUIDs, profiles.
- Localization: collection GUID drift, localized asset GUIDs, placeholder parity.
- Input System: binding groups, control path syntax, composite parts.
- Animator: duplicate parameters, conditions referencing missing parameters.
- ShaderGraph: missing subgraph GUIDs.
- LSP: invalidate the asmdef index on watched-file changes and saves.
- Tests: 48 cases; benchmark script and GitLab CI template.

## 0.1.0

- Initial asmdef, manifest, meta, settings, Addressables, Localization, prefab,
  ShaderGraph, input actions and animator checks.
