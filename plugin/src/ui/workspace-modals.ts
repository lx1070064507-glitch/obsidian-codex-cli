import { App, Modal, Notice, Setting, TextComponent } from "obsidian";

import type { CodexPluginSettings } from "../plugin-settings.js";
import type { ResolvedWorkspaceAccess } from "../services/workspace-policy.js";

export interface WorkspaceModalOptions {
  settings: CodexPluginSettings;
  validate(settings: CodexPluginSettings): Promise<ResolvedWorkspaceAccess>;
  save(settings: CodexPluginSettings): Promise<void>;
}

abstract class PathManagerModal extends Modal {
  private draft: CodexPluginSettings;
  private listEl: HTMLElement | null = null;

  protected abstract readonly mode: "workspace" | "writable";
  protected abstract readonly modalTitle: string;
  protected abstract readonly inputLabel: string;

  constructor(app: App, protected readonly options: WorkspaceModalOptions) {
    super(app);
    this.draft = copySettings(options.settings);
  }

  onOpen(): void {
    this.titleEl.setText(this.modalTitle);
    this.contentEl.addClass("codex-modal", "codex-path-modal");
    this.renderIntro();
    this.renderInput();
    this.listEl = this.contentEl.createDiv({ cls: "codex-path-list" });
    this.renderList();
    this.renderActions();
  }

  onClose(): void {
    this.contentEl.empty();
  }

  protected renderIntro(): void {}

  private renderInput(): void {
    let input: TextComponent | null = null;
    new Setting(this.contentEl)
      .setName(this.inputLabel)
      .addText((text) => {
        input = text;
        text.setPlaceholder("D:\\Project");
      })
      .addButton((button) => button.setButtonText("添加").setCta().onClick(() => {
        const value = input?.getValue().trim() ?? "";
        if (value.length === 0) {
          new Notice("请输入绝对路径");
          return;
        }
        void this.add(value).then(() => input?.setValue("")).catch(showError);
      }));
  }

  private renderList(): void {
    if (this.listEl === null) {
      return;
    }
    this.listEl.empty();
    const paths = this.currentPaths();
    if (paths.length === 0) {
      this.listEl.createDiv({ cls: "codex-path-empty", text: "尚未添加路径" });
      return;
    }
    for (const path of paths) {
      const row = this.listEl.createDiv({ cls: "codex-path-row" });
      row.createDiv({ cls: "codex-path-value", text: path });
      const actions = row.createDiv({ cls: "codex-path-row-actions" });
      const remove = actions.createEl("button", { text: "移除" });
      remove.addEventListener("click", () => void this.remove(path).catch(showError));
    }
  }

  private renderActions(): void {
    const actions = this.contentEl.createDiv({ cls: "codex-modal-actions" });
    actions.createEl("button", { text: "取消" }).addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存" });
    save.addEventListener("click", () => {
      save.disabled = true;
      void this.options.save(copySettings(this.draft))
        .then(() => this.close())
        .catch((error) => {
          save.disabled = false;
          showError(error);
        });
    });
  }

  private async add(path: string): Promise<void> {
    const next = copySettings(this.draft);
    this.pathsFor(next).push(path);
    await this.applyValidated(next);
  }

  private async remove(path: string): Promise<void> {
    const next = copySettings(this.draft);
    const paths = this.pathsFor(next);
    paths.splice(paths.indexOf(path), 1);
    await this.applyValidated(next);
  }

  private async applyValidated(next: CodexPluginSettings): Promise<void> {
    const resolved = await this.options.validate(next);
    this.applyResolved(next, resolved);
  }

  private applyResolved(
    next: CodexPluginSettings,
    resolved: ResolvedWorkspaceAccess
  ): void {
    this.draft = {
      ...next,
      workspaceRoots: resolved.workspaceRoots,
      writablePaths: resolved.writablePaths
    };
    this.renderList();
  }

  private currentPaths(): string[] {
    return this.pathsFor(this.draft);
  }

  private pathsFor(settings: CodexPluginSettings): string[] {
    return this.mode === "workspace" ? settings.workspaceRoots : settings.writablePaths;
  }
}

export class WorkspaceRootsModal extends PathManagerModal {
  protected readonly mode = "workspace" as const;
  protected readonly modalTitle = "管理工作区";
  protected readonly inputLabel = "工作区目录";
}

export class WritablePathsModal extends PathManagerModal {
  protected readonly mode = "writable" as const;
  protected readonly modalTitle = "管理写入白名单";
  protected readonly inputLabel = "白名单文件或目录";

  protected override renderIntro(): void {
    this.contentEl.createDiv({
      cls: "codex-permission-warning",
      text: "白名单内允许创建、修改、重命名和删除，执行时不会显示审批弹窗。"
    });
  }
}

function copySettings(settings: CodexPluginSettings): CodexPluginSettings {
  return {
    ...settings,
    workspaceRoots: [...settings.workspaceRoots],
    writablePaths: [...settings.writablePaths]
  };
}

function showError(error: unknown): void {
  new Notice(error instanceof Error ? error.message : String(error));
}
