import { win32 } from "node:path";

import type {
  FileChangePatchUpdated,
  FileUpdateChange,
  PatchChangeKind,
} from "./protocol.js";

export interface FileChangeDetail {
  summary: string;
  diff: string | null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function parseKind(value: unknown): PatchChangeKind | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  const kind = value as { type?: unknown; move_path?: unknown };
  if (kind.type === "add" || kind.type === "delete") return { type: kind.type };
  if (kind.type === "update" && (kind.move_path === null || isString(kind.move_path))) {
    return { type: "update", move_path: kind.move_path };
  }
  return null;
}

function parseChange(value: unknown): FileUpdateChange | null {
  if (typeof value !== "object" || value === null) return null;
  const change = value as { path?: unknown; kind?: unknown; diff?: unknown };
  const kind = parseKind(change.kind);
  if (!isString(change.path) || !kind || !isString(change.diff)) return null;
  return { path: change.path, kind, diff: change.diff };
}

export function parseFileChangePatchUpdated(value: unknown): FileChangePatchUpdated | null {
  if (typeof value !== "object" || value === null) return null;
  const patch = value as { threadId?: unknown; turnId?: unknown; itemId?: unknown; changes?: unknown };
  if (!isString(patch.threadId) || !isString(patch.turnId) || !isString(patch.itemId) || !Array.isArray(patch.changes)) {
    return null;
  }
  const changes = patch.changes.map(parseChange);
  if (changes.some((change): change is null => change === null)) return null;
  return { threadId: patch.threadId, turnId: patch.turnId, itemId: patch.itemId, changes: changes as FileUpdateChange[] };
}

function absolutePath(value: string, cwd: string): string {
  return win32.normalize(win32.isAbsolute(value) ? value : win32.resolve(cwd, value));
}

function lineCount(diff: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of diff.split(/\r?\n/)) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}

function operation(change: FileUpdateChange, cwd: string): { label: string; path: string } {
  const path = absolutePath(change.path, cwd);
  if (change.kind.type === "add") return { label: "新增", path };
  if (change.kind.type === "delete") return { label: "删除", path };
  if (change.kind.move_path !== null) return { label: "移动", path: `${path} -> ${absolutePath(change.kind.move_path, cwd)}` };
  return { label: "修改", path };
}

export function summarizeFileChanges(changes: FileUpdateChange[], cwd: string): FileChangeDetail {
  if (changes.length === 0) return { summary: "暂无详细差异", diff: null };
  const entries = changes.map((change) => {
    const detail = operation(change, cwd);
    return { ...detail, count: lineCount(change.diff), diff: change.diff };
  });
  const summary = entries.map(({ label, path, count }) => `${label} ${path}（+${count.added} / -${count.removed}）`).join("\n");
  const details = entries.filter((entry) => entry.diff.length > 0).map(({ label, path, diff }) => `### ${label} ${path}\n\n${diff}`);
  return { summary, diff: details.length > 0 ? details.join("\n\n") : null };
}
