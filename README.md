# unity-project-check

Проверки структуры Unity-проекта: CLI `unity-project-check` и LSP-сервер
`unity-project-lsp` для `.asmdef`/`.asmref`. Unity Editor не требуется.

## Установка

```sh
npm install
npm run compile
npm link
```

Появятся две глобальные команды: `unity-project-lsp` и `unity-project-check`.

## OpenCode

```jsonc
"lsp": {
  "unity-project": {
    "command": ["unity-project-lsp"],
    "extensions": [".asmdef", ".asmref"]
  }
}
```

`.asset`, `.prefab`, `.unity` и `.meta` остаются за `unity-yaml-lsp`.

## CLI

```sh
unity-project-check --project /path/to/unity-project
unity-project-check --json --project . > report.json
unity-project-check --sarif --project . > report.sarif
unity-project-check --project . --files Assets/Game/Game.asmdef
unity-project-check --project . --write-baseline .unity-check-baseline.json
unity-project-check --project . --baseline .unity-check-baseline.json
```

Флаги: `--asmdef`, `--manifest`, `--meta`, `--settings`, `--addressables`,
`--localization`, `--prefabs`, `--shadergraph`, `--inputactions`, `--animator`,
`--json`, `--sarif`, `--baseline <file>`, `--write-baseline <file>`,
`--files <path...>`, `--max-file-size <size>`, `--project <path>`.
Без флагов запускается всё, кроме `--prefabs`. Код возврата 1 при наличии ошибок.

`--files` проверяет только перечисленные файлы, сохраняя контекст проекта
(индекс asmdef, индекс GUID). `--baseline` скрывает проблемы, записанные
`--write-baseline`, поэтому CI падает только на новых. `--max-file-size`
принимает `20mb`, `500kb` или байты.

### Проверки

| Область | Что проверяется |
| --- | --- |
| asmdef / asmref | синтаксис JSON (BOM допускается), обязательное имя, типы полей, дубли имён, неразрешённые ссылки (предупреждение — Unity их игнорирует), ссылка на себя, циклы ссылок, цель `.asmref` |
| Packages | типы `manifest.json`, semver/local/git-версии, локальные пути, наличие `packages-lock.json` и расхождение версий |
| .meta | отсутствующий meta, осиротевший meta, дубли GUID |
| ProjectSettings | формат `ProjectVersion.txt` и рассинхрон версии схемы, сцены сборки (наличие и дубли), дубли тегов/слоёв/sorting layers, 32 слоя, GUID render pipeline, PlayerSettings (имена, версия, input handler, scripting backend), QualitySettings (имена и текущий индекс), InputManager (дубли и мёртвые оси), длина матрицы коллизий физики |
| Addressables | группы и default group, дубли имён групп, GUID схем групп, дубли меток, GUID записей (Assets, Packages, PackageCache), дубли и конфликты адресов, незарегистрированные метки, профили (имена, записи, родители, значения) |
| Localization | дубли и пустые ключи, дубли id, расхождение collection GUID, ссылка `m_SharedData`, дубли id в таблицах, осиротевшие записи, отсутствующие переводы, отсутствующие локализованные ассеты, паритет плейсхолдеров между локалями |
| Prefabs (opt-in) | циклы вложенных префабов, отсутствующие source-префабы, `m_Script: {fileID: 0}`, несуществующие GUID скриптов |
| ShaderGraph | последовательность JSON-документов, уникальные object id, ссылки графа, ссылки узлов/слотов рёбер, дубли reference name свойств, отсутствующие subgraph GUID |
| Input System | JSON, дубли карт/действий, ссылки binding на действия, мёртвые binding, дубли id, дубли control scheme, неизвестные группы, синтаксис control path, осиротевшие composite-части |
| Animator | ссылки fileID внутри файла, default state и state machine слоёв, дочерние state machine, переходы, циклы state machine, GUID motion, дубли параметров, условия на несуществующие параметры |

### Ограничения

- `--prefabs` включается вручную: в импортированных ассетах часто есть отсутствующие
  скрипты, поэтому отчёт шумный на больших сторонних библиотеках.
- Prefab/scene больше 20 MB пропускаются, чтобы не росла память (размер меняется
  флагом `--max-file-size`).
- Проверки Addressables/Localization рассчитаны на стандартную раскладку пакетов Unity.
- CLI не зависит от Unity Editor и не видит editor-only состояние (настройки импорта,
  platform overrides, результаты сборки).

## Разработка

```sh
npm test                     # компиляция + node:test
npm run bench -- <project>   # полный прогон с бюджетом UNITY_CHECK_BUDGET_MS (30 с)
npm run audit                # секреты и корпоративные строки
```

`ci/unity-check.gitlab-ci.yml` — готовый шаблон GitLab job (SARIF-артефакт, baseline,
проверка бенчмарка).

## Особенности Unity YAML

- UTF-8 BOM в `.asmdef`/`.meta`/JSON;
- многострочные single-quoted скаляры Unity (закрывающая кавычка в начале строки или
  в конце строки) сворачиваются в пробелы до парсинга, смещения сохраняются;
- `Samples~`, скрытые папки и содержимое `*.bundle` игнорируются, как в Unity.

## Откат

Удалить глобальные ссылки (`npm unlink -g unity-project-lsp`) и запись
`lsp.unity-project` в конфиге OpenCode. В Unity-проект ничего не записывается.
