import {
  FileSystemAdapter,
  FileView,
  Notice,
  type TFile,
  type WorkspaceLeaf
} from "obsidian";

import { openWithDefaultApp } from "../services/spreadsheet-files.js";

export const SPREADSHEET_VIEW_TYPE = "obsidian-codex-cli-spreadsheet";

export class SpreadsheetExternalView extends FileView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }

  getViewType(): string {
    return SPREADSHEET_VIEW_TYPE;
  }

  getDisplayText(): string {
    return this.file?.name ?? "表格文件";
  }

  getIcon(): string {
    return "sheet";
  }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass("codex-spreadsheet-view");
    const status = this.contentEl.createDiv({ text: "正在使用系统默认应用打开..." });
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      const message = "只有桌面文件系统 Vault 可以打开表格文件";
      status.setText(message);
      new Notice(message);
      return;
    }
    try {
      await openWithDefaultApp(adapter.getFullPath(file.path));
      status.setText("已使用系统默认应用打开");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      status.setText(message);
      new Notice(message);
    }
  }
}
