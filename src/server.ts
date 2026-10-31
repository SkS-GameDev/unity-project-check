import lsp from 'vscode-languageserver/node.js';
import { fileURLToPath } from 'node:url';
import { TextDocument } from 'vscode-languageserver-textdocument';
import type { Hover, Position } from 'vscode-languageserver-types';
import { MarkupKind } from 'vscode-languageserver-types';
import { findProjectRoot, buildIndex, invalidateScan, isAsmdefFile, isAsmrefFile, isLockFile, isManifestFile, scanAsmdefs } from './project.js';
import { asmdefInfoAt, referenceAt, validateAsmdef, validateAsmref } from './asmdef.js';
import { validateManifest } from './manifest.js';

const { createConnection, LocationLink, Range, TextDocuments, TextDocumentSyncKind } = lsp;
const connection = createConnection(process.stdin, process.stdout);
const documents = new TextDocuments(TextDocument);

connection.onInitialize(() => ({
  capabilities: {
    textDocumentSync: TextDocumentSyncKind.Full,
    definitionProvider: true,
    hoverProvider: true,
  },
}));

function documentFile(uri: string): string {
  return fileURLToPath(uri);
}

function issuesFor(document: TextDocument): ReturnType<typeof validateManifest> {
  const file = documentFile(document.uri);
  const root = findProjectRoot(file);
  if (!root) return [];
  const text = document.getText();
  try {
    if (isAsmdefFile(file) || isAsmrefFile(file)) {
      const asmdefs = scanAsmdefs(root);
      const index = buildIndex(asmdefs);
      return isAsmdefFile(file) ? validateAsmdef(file, text, index, asmdefs).issues : validateAsmref(file, text, index);
    }
    if (isManifestFile(file) || isLockFile(file)) {
      return validateManifest(file, text, root);
    }
  } catch {
    return [];
  }
  return [];
}

function publish(document: TextDocument): void {
  const text = document.getText();
  const file = documentFile(document.uri);
  if (isAsmdefFile(file) || isAsmrefFile(file)) invalidateScan();
  const diagnostics = issuesFor(document).map((issue) => {
    const start = document.positionAt(Math.min(issue.start, text.length));
    const end = document.positionAt(Math.min(Math.max(issue.end, issue.start + 1), text.length));
    return {
      range: Range.create(start, end),
      severity: issue.severity,
      message: issue.message,
      code: issue.code,
      source: 'unity-project',
    };
  });
  connection.sendDiagnostics({ uri: document.uri, diagnostics });
}

documents.onDidOpen(({ document }) => publish(document));
documents.onDidChangeContent(({ document }) => publish(document));
documents.onDidClose(({ document }) => connection.sendDiagnostics({ uri: document.uri, diagnostics: [] }));

connection.onDefinition(({ textDocument, position }) => {
  const file = documentFile(textDocument.uri);
  const root = findProjectRoot(file);
  if (!root) return null;
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  try {
    const asmdefs = scanAsmdefs(root);
    const index = buildIndex(asmdefs);
    const target = referenceAt(file, document.getText(), document.offsetAt(position), index);
    if (!target) return null;
    const zero = Range.create(0, 0, 0, 0);
    return [LocationLink.create(target.uri, zero, zero)];
  } catch {
    return null;
  }
});

connection.onHover(({ textDocument, position }): Hover | null => {
  const file = documentFile(textDocument.uri);
  const root = findProjectRoot(file);
  if (!root) return null;
  const document = documents.get(textDocument.uri);
  if (!document) return null;
  try {
    const text = document.getText();
    const asmdefs = scanAsmdefs(root);
    const index = buildIndex(asmdefs);
    const target = referenceAt(file, text, document.offsetAt(position), index);
    const info = target ?? asmdefInfoAt(file, text, index);
    if (!info) return null;
    const lines = [`**Assembly** \`${info.name}\``];
    if (info.guid) lines.push(`GUID: \`${info.guid}\``);
    lines.push(`Path: \`${info.path}\``);
    return { contents: { kind: MarkupKind.Markdown, value: lines.join('\n\n') } };
  } catch {
    return null;
  }
});

connection.onDidChangeWatchedFiles(() => invalidateScan());
documents.onDidSave(({ document }) => {
  const file = documentFile(document.uri);
  if (isAsmdefFile(file) || isAsmrefFile(file)) invalidateScan();
});

documents.listen(connection);
connection.listen();

export type { Position };
