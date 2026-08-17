import { win32 } from "node:path";

import type { PathInfo } from "./workspace-policy.js";

export interface WritableHighlightRule {
  path: string;
  kind: "file" | "directory";
}

export function toVaultHighlightRule(
  vaultRoot: string,
  info: PathInfo
): WritableHighlightRule | null {
  if (info.kind !== "file" && info.kind !== "directory") {
    return null;
  }
  const relative = win32.relative(vaultRoot, info.realPath);
  if (
    relative === ".." ||
    relative.startsWith(`..${win32.sep}`) ||
    win32.isAbsolute(relative)
  ) {
    return null;
  }
  return {
    path: normalizeVaultPath(relative),
    kind: info.kind
  };
}

export function isWritableVaultPath(
  candidate: string,
  rules: WritableHighlightRule[]
): boolean {
  const path = normalizeVaultPath(candidate).toLowerCase();
  return rules.some((rule) => {
    const root = normalizeVaultPath(rule.path).toLowerCase();
    if (path === root) {
      return true;
    }
    return rule.kind === "directory" && (root === "" || path.startsWith(`${root}/`));
  });
}

function normalizeVaultPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}
