import { ItemView, Notice, setIcon, type WorkspaceLeaf } from "obsidian";

import type { ChatEntry } from "../domain.js";
import type ObsidianCodexCliPlugin from "../main.js";
import { CommitResultsModal, SaveResultModal } from "./modals.js";
import { deriveControls } from "./view-model.js";

export const CHAT_VIEW_TYPE = "obsidian-codex-cli-chat";

export class ChatView extends ItemView {
  private statusEl: HTMLElement | null = null;
  private messagesEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private inputEl: HTMLTextAreaElement | null = null;
  private sendButton: HTMLButtonElement | null = null;
  private stopButton: HTMLButtonElement | null = null;
  private refreshing = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: ObsidianCodexCliPlugin
  ) {
    super(leaf);
  }

  getViewType(): string {
    return CHAT_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Codex CLI";
  }

  getIcon(): string {
    return "message-square-code";
  }

  async onOpen(): Promise<void> {
    this.buildView();
    this.registerInterval(window.setInterval(() => void this.refresh(), 200));
    await this.refresh();
  }

  async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  async refresh(): Promise<void> {
    if (this.refreshing || this.messagesEl === null || this.resultsEl === null) {
      return;
    }
    this.refreshing = true;
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const controls = deriveControls({
        healthReady: this.plugin.healthStatus?.readyToChat === true,
        hasActiveNote: activeFile?.extension === "md",
        running: this.plugin.isRunning
      });
      if (this.statusEl !== null) {
        const health = this.plugin.healthStatus;
        this.statusEl.setText(
          health === null
            ? "正在检查"
            : health.errors.length === 0
              ? "Codex 0.147.0 就绪"
              : health.errors.join("；")
        );
        this.statusEl.toggleClass("is-ready", health?.readyToChat === true);
      }
      if (this.sendButton !== null) {
        this.sendButton.disabled = !controls.canSend || this.inputEl?.value.trim().length === 0;
      }
      if (this.stopButton !== null) {
        this.stopButton.disabled = !controls.canStop;
      }
      this.renderMessages(controls.canSaveResult);
      await this.renderResults();
    } finally {
      this.refreshing = false;
    }
  }

  private buildView(): void {
    this.contentEl.empty();
    this.contentEl.addClass("obsidian-codex-cli");
    const toolbar = this.contentEl.createDiv({ cls: "codex-toolbar" });
    this.addToolButton(toolbar, "plus", "新会话", () => this.run(() => this.plugin.startNewChat()));
    this.addToolButton(toolbar, "history", "恢复最近会话", () => this.run(() => this.plugin.resumeLatestChat()));
    this.stopButton = this.addToolButton(toolbar, "square", "停止", () => this.run(() => this.plugin.stop()));
    this.addToolButton(toolbar, "refresh-cw", "刷新健康状态", () => this.run(() => this.plugin.recheckHealth()));
    this.addToolButton(toolbar, "git-commit-horizontal", "提交成果", () => this.openCommitModal());

    this.statusEl = this.contentEl.createDiv({ cls: "codex-status", text: "正在检查" });
    this.messagesEl = this.contentEl.createDiv({ cls: "codex-messages" });

    const composer = this.contentEl.createDiv({ cls: "codex-composer" });
    this.inputEl = composer.createEl("textarea", { cls: "codex-input" });
    this.inputEl.rows = 3;
    this.inputEl.addEventListener("input", () => void this.refresh());
    this.inputEl.addEventListener("keydown", (event) => {
      if (event.ctrlKey && event.key === "Enter") {
        event.preventDefault();
        void this.send();
      }
    });
    this.sendButton = composer.createEl("button", { cls: "codex-send-button" });
    setIcon(this.sendButton, "send");
    this.sendButton.title = "发送";
    this.sendButton.setAttribute("aria-label", "发送");
    this.sendButton.addEventListener("click", () => void this.send());

    const resultHeader = this.contentEl.createDiv({ cls: "codex-section-header" });
    resultHeader.createSpan({ text: "成果" });
    this.resultsEl = this.contentEl.createDiv({ cls: "codex-results" });
  }

  private addToolButton(
    parent: HTMLElement,
    icon: string,
    title: string,
    action: () => void
  ): HTMLButtonElement {
    const button = parent.createEl("button", { cls: "codex-tool-button" });
    setIcon(button, icon);
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", action);
    return button;
  }

  private renderMessages(canSaveResult: boolean): void {
    if (this.messagesEl === null) {
      return;
    }
    this.messagesEl.empty();
    for (const entry of this.plugin.currentSession?.entries ?? []) {
      const item = this.messagesEl.createDiv({ cls: `codex-message is-${entry.role}` });
      item.createDiv({ cls: "codex-message-role", text: roleLabel(entry.role) });
      item.createDiv({ cls: "codex-message-content", text: entry.content });
      if (entry.role === "assistant" && entry.content.length > 0) {
        const save = item.createEl("button", { cls: "codex-save-result", text: "保存为成果" });
        save.disabled = !canSaveResult;
        save.addEventListener("click", () => this.openSaveModal(entry));
      }
    }
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private async renderResults(): Promise<void> {
    if (this.resultsEl === null) {
      return;
    }
    const paths = await this.plugin.listResults();
    this.resultsEl.empty();
    for (const path of paths) {
      const button = this.resultsEl.createEl("button", { cls: "codex-result-link", text: path });
      button.addEventListener("click", () => void this.plugin.openVaultFile(path));
    }
  }

  private async send(): Promise<void> {
    const input = this.inputEl;
    if (input === null || input.value.trim().length === 0 || this.plugin.isRunning) {
      return;
    }
    const text = input.value;
    input.value = "";
    await this.run(() => this.plugin.send(text));
  }

  private openSaveModal(entry: ChatEntry): void {
    new SaveResultModal(
      this.app,
      { title: "Codex 成果", content: entry.content },
      async (value) => {
        await this.plugin.saveResult(entry.id, value.title, value.content);
        await this.refresh();
      }
    ).open();
  }

  private async openCommitModal(): Promise<void> {
    try {
      const candidates = await this.plugin.listCommitCandidates();
      new CommitResultsModal(
        this.app,
        candidates,
        (paths) => this.plugin.previewCommit(paths),
        async (paths, message) => {
          await this.plugin.commitResults(paths, message);
          new Notice("成果已提交");
          await this.refresh();
        }
      ).open();
    } catch (error) {
      new Notice(errorMessage(error));
    }
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    try {
      await action();
    } catch (error) {
      new Notice(errorMessage(error));
    } finally {
      await this.refresh();
    }
  }
}

function roleLabel(role: ChatEntry["role"]): string {
  return role === "user" ? "用户" : role === "assistant" ? "Codex" : "系统";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
