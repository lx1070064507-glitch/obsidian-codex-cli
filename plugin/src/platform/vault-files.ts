import { normalizePath, TFile, Vault } from "obsidian";

export interface VaultFiles {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  listMarkdown(directory: string): Promise<string[]>;
}

export class ObsidianVaultFiles implements VaultFiles {
  constructor(private readonly vault: Vault) {}

  async exists(path: string): Promise<boolean> {
    return this.vault.getAbstractFileByPath(normalizePath(path)) !== null;
  }

  async mkdir(path: string): Promise<void> {
    const normalized = normalizePath(path);
    if (this.vault.getAbstractFileByPath(normalized) === null) {
      await this.vault.createFolder(normalized);
    }
  }

  async read(path: string): Promise<string> {
    const file = this.vault.getAbstractFileByPath(normalizePath(path));
    if (!(file instanceof TFile)) {
      throw new Error(`文件不存在: ${path}`);
    }
    return this.vault.read(file);
  }

  async write(path: string, content: string): Promise<void> {
    const normalized = normalizePath(path);
    const file = this.vault.getAbstractFileByPath(normalized);
    if (file instanceof TFile) {
      await this.vault.modify(file, content);
      return;
    }
    if (file !== null) {
      throw new Error(`路径不是文件: ${path}`);
    }
    await this.vault.create(normalized, content);
  }

  async listMarkdown(directory: string): Promise<string[]> {
    const prefix = `${normalizePath(directory)}/`;
    return this.vault
      .getMarkdownFiles()
      .map((file) => file.path)
      .filter((path) => path.startsWith(prefix))
      .sort();
  }
}
