import { realpath, stat } from "node:fs/promises";
import { win32 } from "node:path";

export interface PathInfo {
  realPath: string;
  kind: "file" | "directory" | "other";
}

export interface PathInspector {
  inspect(path: string): Promise<PathInfo>;
}

export interface ResolvedWorkspaceAccess {
  workspaceRoots: string[];
  writablePaths: string[];
}

export class NodePathInspector implements PathInspector {
  async inspect(path: string): Promise<PathInfo> {
    try {
      const resolved = await realpath(path);
      const status = await stat(resolved);
      const kind = status.isDirectory() ? "directory" : status.isFile() ? "file" : "other";
      return { realPath: normalizeWindowsPath(resolved), kind };
    } catch {
      throw new Error(`路径不存在或无法访问: ${path}`);
    }
  }
}

export class WorkspacePolicy {
  constructor(private readonly inspector: PathInspector = new NodePathInspector()) {}

  async resolve(workspaceRoots: string[], writablePaths: string[]): Promise<ResolvedWorkspaceAccess> {
    const roots = await this.resolveMany(workspaceRoots, "workspace");
    const writable = await this.resolveMany(writablePaths, "writable");

    for (const path of writable) {
      if (!roots.some((root) => isWithinWindowsPath(root, path))) {
        throw new Error(`白名单路径不属于任何工作区: ${path}`);
      }
    }

    return { workspaceRoots: roots, writablePaths: writable };
  }

  private async resolveMany(paths: string[], role: "workspace" | "writable"): Promise<string[]> {
    const resolved: string[] = [];
    const seen = new Set<string>();

    for (const input of paths) {
      const path = input.trim();
      if (!win32.isAbsolute(path)) {
        throw new Error(`路径必须是绝对路径: ${input}`);
      }

      const info = await this.inspector.inspect(path);
      if (role === "workspace" && info.kind !== "directory") {
        throw new Error(`工作区必须是目录: ${input}`);
      }
      if (role === "writable" && info.kind !== "file" && info.kind !== "directory") {
        throw new Error(`白名单必须是文件或目录: ${input}`);
      }

      const normalized = normalizeWindowsPath(info.realPath);
      const key = normalized.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        resolved.push(normalized);
      }
    }

    return resolved;
  }
}

export function normalizeWindowsPath(path: string): string {
  const normalized = win32.normalize(path.trim());
  const root = win32.parse(normalized).root;
  return normalized === root ? normalized : normalized.replace(/[\\/]+$/, "");
}

export function isWithinWindowsPath(root: string, candidate: string): boolean {
  const normalizedRoot = normalizeWindowsPath(root).toLowerCase();
  const normalizedCandidate = normalizeWindowsPath(candidate).toLowerCase();
  const relative = win32.relative(normalizedRoot, normalizedCandidate);

  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${win32.sep}`) &&
    !win32.isAbsolute(relative)
  );
}
