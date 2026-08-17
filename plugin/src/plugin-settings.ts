import { join } from "node:path";

export interface CodexPluginSettings {
  codexPath: string;
  gitPath: string;
  workspaceRoots: string[];
  writablePaths: string[];
}

export function normalizePluginSettings(value: unknown): CodexPluginSettings {
  const input = isRecord(value) ? value : {};
  return {
    codexPath: typeof input.codexPath === "string"
      ? input.codexPath
      : join(process.env.APPDATA ?? "%APPDATA%", "npm", "codex.cmd"),
    gitPath: typeof input.gitPath === "string" ? input.gitPath : "git",
    workspaceRoots: stringArray(input.workspaceRoots),
    writablePaths: stringArray(input.writablePaths)
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
