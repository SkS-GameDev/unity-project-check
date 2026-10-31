import path from 'node:path';
import type { Row } from './report.js';

function level(severity: string): 'error' | 'warning' | 'note' {
  if (severity === 'error') return 'error';
  if (severity === 'warning') return 'warning';
  return 'note';
}

export function toSarif(root: string, rows: Row[]): string {
  const rules = new Map<string, string>();
  for (const row of rows) {
    if (row.code && !rules.has(row.code)) rules.set(row.code, row.message.split('\n')[0]);
  }
  const results = rows.map((row) => ({
    ruleId: row.code ?? 'unity-project',
    level: level(row.severity),
    message: { text: row.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: {
            uri: encodeURI(path.relative(root, row.file).split(path.sep).join('/')),
          },
          region: { startLine: row.line, startColumn: row.column },
        },
      },
    ],
  }));
  return JSON.stringify(
    {
      $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
      version: '2.1.0',
      runs: [
        {
          tool: {
            driver: {
              name: 'unity-project-check',
              rules: [...rules.entries()].map(([id, description]) => ({
                id,
                shortDescription: { text: description },
              })),
            },
          },
          results,
        },
      ],
    },
    null,
    2
  );
}
