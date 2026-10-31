import { DiagnosticSeverity } from 'vscode-languageserver-types';

export interface Issue {
  file: string;
  start: number;
  end: number;
  severity: DiagnosticSeverity;
  message: string;
  code?: string;
}

export function addIssue(
  issues: Issue[],
  file: string,
  start: number,
  end: number,
  message: string,
  severity: DiagnosticSeverity = DiagnosticSeverity.Error,
  code?: string
): void {
  issues.push({ file, start, end: Math.max(end, start + 1), severity, message, code });
}
