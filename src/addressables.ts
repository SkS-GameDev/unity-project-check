import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { isMap, isSeq } from 'yaml';
import { DiagnosticSeverity } from 'vscode-languageserver-types';
import type { Issue } from './types.js';
import { readMetaGuid, readText } from './project.js';
import { collectYamlErrors, mapGuid, parseUnityYaml, rawScalar, spanOf, stringValue, stringsOf } from './unity-yaml.js';
import { addIssue } from './types.js';

const EMPTY_GUID = '00000000000000000000000000000000';

function settingsFile(root: string): string {
  return path.join(root, 'Assets', 'AddressableAssetsData', 'AddressableAssetSettings.asset');
}

function groupFiles(root: string): string[] {
  const dir = path.join(root, 'Assets', 'AddressableAssetsData', 'AssetGroups');
  if (!existsSync(dir)) return [];
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.asset'))
      .map((entry) => path.join(dir, entry.name));
  } catch {
    return [];
  }
}

interface Group {
  file: string;
  name: string;
  guid?: string;
  settingsGuid?: string;
  schemas: string[];
  entries: { guid: string; address: string; labels: string[]; span?: { start: number; end: number } }[];
}

function readGroup(file: string): Group | undefined {
  const text = readText(file);
  const doc = parseUnityYaml(text);
  const root = doc.get('MonoBehaviour');
  if (!isMap(root)) return undefined;
  const entries = root.get('m_SerializeEntries');
  const result: Group = {
    file,
    name: stringValue(root.get('m_GroupName', true)) ?? path.basename(file, '.asset'),
    schemas: [],
    entries: [],
  };
  const groupGuid = rawScalar(text, root.get('m_GUID', true));
  if (groupGuid) result.guid = groupGuid.toLowerCase();
  const settingsGuid = mapGuid(root.get('m_Settings', true), text);
  if (settingsGuid) result.settingsGuid = settingsGuid;
  const schemaSet = root.get('m_SchemaSet');
  if (isMap(schemaSet)) {
    const schemas = schemaSet.get('m_Schemas');
    if (isSeq(schemas)) {
      for (const schema of schemas.items) {
        const guid = mapGuid(schema, text);
        if (guid) result.schemas.push(guid);
      }
    }
  }
  if (isSeq(entries)) {
    for (const item of entries.items) {
      if (!isMap(item)) continue;
      result.entries.push({
        guid: (rawScalar(text, item.get('m_GUID', true)) ?? '').toLowerCase(),
        address: stringValue(item.get('m_Address', true)) ?? '',
        labels: stringsOf(item.get('m_SerializedLabels')).map((label) => label.value).filter(Boolean),
        span: spanOf(item),
      });
    }
  }
  return result;
}

export function validateAddressables(root: string, guidIndex: Map<string, string>): Issue[] {
  const file = settingsFile(root);
  if (!existsSync(file)) return [];
  const issues: Issue[] = [];
  const text = readText(file);
  const doc = parseUnityYaml(text);
  collectYamlErrors(issues, file, doc, 'addressables-yaml');
  const settings = doc.get('MonoBehaviour');
  if (!isMap(settings)) return issues;

  const labelNames = stringsOf(settings.getIn(['m_LabelTable', 'm_LabelNames'])).map((label) => label.value);
  const labels = new Set(labelNames);
  const seenLabels = new Set<string>();
  for (const name of labelNames) {
    if (name.length > 0 && seenLabels.has(name)) {
      addIssue(issues, file, 0, 1, `Addressables label "${name}" is duplicated`, DiagnosticSeverity.Warning, 'addressables-label-duplicate');
    }
    seenLabels.add(name);
  }

  const groups = groupFiles(root).map(readGroup).filter((group): group is Group => group !== undefined);
  const settingsGuid = readMetaGuid(`${file}.meta`)?.toLowerCase();
  const groupNames = new Map<string, string>();
  for (const group of groups) {
    if (groupNames.has(group.name)) {
      addIssue(issues, group.file, 0, 1, `Group name "${group.name}" is also used by ${path.basename(groupNames.get(group.name)!)}`, DiagnosticSeverity.Warning, 'addressables-group-duplicate');
    }
    groupNames.set(group.name, group.file);
    if (group.settingsGuid && settingsGuid && group.settingsGuid !== settingsGuid) {
      addIssue(issues, group.file, 0, 1, `Group m_Settings GUID ${group.settingsGuid} does not match AddressableAssetSettings`, DiagnosticSeverity.Warning, 'addressables-group-settings');
    }
    for (const guid of group.schemas) {
      if (!guidIndex.has(guid)) {
        addIssue(issues, group.file, 0, 1, `Group schema GUID ${guid} was not found`, DiagnosticSeverity.Warning, 'addressables-schema-missing');
      }
    }
  }

  const profileSettings = settings.get('m_ProfileSettings');
  if (isMap(profileSettings)) {
    const entryIds = new Set<string>();
    const entryNames = new Set<string>();
    const entryNameNodes = profileSettings.get('m_ProfileEntryNames');
    if (isSeq(entryNameNodes)) {
      for (const entry of entryNameNodes.items) {
        if (!isMap(entry)) continue;
        const id = rawScalar(text, entry.get('m_Id', true));
        const name = stringValue(entry.get('m_Name', true));
        if (id) entryIds.add(id);
        if (name) {
          if (entryNames.has(name)) {
            addIssue(issues, file, 0, 1, `Profile entry "${name}" is duplicated`, DiagnosticSeverity.Warning, 'addressables-profile-entry-duplicate');
          }
          entryNames.add(name);
        }
      }
    }
    const profilesNode = profileSettings.get('m_Profiles');
    const profileIds = new Set<string>();
    const profileNames = new Set<string>();
    if (isSeq(profilesNode)) {
      for (const profile of profilesNode.items) {
        if (!isMap(profile)) continue;
        const id = rawScalar(text, profile.get('m_Id', true));
        const name = stringValue(profile.get('m_ProfileName', true));
        if (id) {
          if (profileIds.has(id)) addIssue(issues, file, 0, 1, `Profile id ${id} is duplicated`, DiagnosticSeverity.Warning, 'addressables-profile-duplicate');
          profileIds.add(id);
        }
        if (name) {
          if (profileNames.has(name)) addIssue(issues, file, 0, 1, `Profile name "${name}" is duplicated`, DiagnosticSeverity.Warning, 'addressables-profile-duplicate');
          profileNames.add(name);
        }
        const values = profile.get('m_Values');
        if (isSeq(values)) {
          for (const value of values.items) {
            if (!isMap(value)) continue;
            const valueId = rawScalar(text, value.get('m_Id', true));
            if (valueId && entryIds.size > 0 && !entryIds.has(valueId)) {
              addIssue(issues, file, 0, 1, `Profile value ${valueId} has no entry name`, DiagnosticSeverity.Warning, 'addressables-profile-value');
            }
          }
        }
      }
    }
    for (const profile of profilesNode && isSeq(profilesNode) ? profilesNode.items : []) {
      if (!isMap(profile)) continue;
      const parent = rawScalar(text, profile.get('m_InheritedParent', true));
      if (parent && !profileIds.has(parent)) {
        addIssue(issues, file, 0, 1, `Profile inherits from missing profile ${parent}`, DiagnosticSeverity.Warning, 'addressables-profile-parent');
      }
    }
  }
  const knownGroups = new Set(groups.map((group) => group.guid).filter((guid): guid is string => guid !== undefined));
  const defaultGroup = stringValue(settings.get('m_DefaultGroup', true))?.toLowerCase();
  if (defaultGroup && defaultGroup !== EMPTY_GUID && !knownGroups.has(defaultGroup)) {
    addIssue(issues, file, 0, 1, `Default group ${defaultGroup} does not match any group asset`, DiagnosticSeverity.Warning, 'addressables-default-group');
  }

  const groupAssets = settings.get('m_GroupAssets');
  if (isSeq(groupAssets)) {
    for (const item of groupAssets.items) {
      const guid = mapGuid(item, text);
      if (!guid || guid === EMPTY_GUID) continue;
      if (!guidIndex.has(guid)) {
        const span = spanOf(item);
        addIssue(issues, file, span?.start ?? 0, span?.end ?? 1, `Addressables group asset GUID ${guid} was not found`, DiagnosticSeverity.Warning, 'addressables-group-missing');
      }
    }
  }

  const addresses = new Map<string, { group: string; file: string }>();
  for (const group of groups) {
    const seenGuids = new Set<string>();
    const seenAddresses = new Set<string>();
    for (const entry of group.entries) {
      const start = entry.span?.start ?? 0;
      const end = entry.span?.end ?? 1;
      if (entry.guid && entry.guid !== EMPTY_GUID) {
        if (seenGuids.has(entry.guid)) {
          addIssue(issues, group.file, start, end, `Entry ${entry.guid} is listed twice in group "${group.name}"`, DiagnosticSeverity.Warning, 'addressables-entry-duplicate');
        }
        seenGuids.add(entry.guid);
        if (!guidIndex.has(entry.guid)) {
          addIssue(issues, group.file, start, end, `Entry asset GUID ${entry.guid} was not found in Assets or Packages`, DiagnosticSeverity.Warning, 'addressables-entry-missing');
        }
      }
      if (entry.address.length === 0) {
        addIssue(issues, group.file, start, end, 'Entry has an empty address', DiagnosticSeverity.Warning, 'addressables-address-empty');
      } else if (seenAddresses.has(entry.address)) {
        addIssue(issues, group.file, start, end, `Address "${entry.address}" is duplicated in group "${group.name}"`, DiagnosticSeverity.Error, 'addressables-address-duplicate');
      } else {
        const existing = addresses.get(entry.address);
        if (existing && existing.group !== group.name) {
          addIssue(
            issues,
            group.file,
            start,
            end,
            `Address "${entry.address}" is also used by group "${existing.group}"`,
            DiagnosticSeverity.Warning,
            'addressables-address-conflict'
          );
        }
        addresses.set(entry.address, { group: group.name, file: group.file });
      }
      seenAddresses.add(entry.address);
      for (const label of entry.labels) {
        if (!labels.has(label)) {
          addIssue(issues, group.file, start, end, `Label "${label}" is not registered in AddressableAssetSettings`, DiagnosticSeverity.Warning, 'addressables-label-missing');
        }
      }
    }
  }
  return issues;
}
