import type { VaultFiles } from "../src/platform/vault-files.js";

export class MemoryVault implements VaultFiles {
  private readonly files = new Map<string, string>();
  private readonly directories = new Set<string>();

  constructor(initialFiles: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(initialFiles)) {
      this.files.set(path, content);
    }
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.directories.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.directories.add(path);
  }

  async read(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`文件不存在: ${path}`);
    }
    return content;
  }

  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async listMarkdown(directory: string): Promise<string[]> {
    const prefix = `${directory}/`;
    return [...this.files.keys()].filter((path) => path.startsWith(prefix) && path.endsWith(".md"));
  }
}
