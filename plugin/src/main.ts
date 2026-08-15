import {
  FileSystemAdapter,
  Notice,
  Plugin,
  TFile,
  type WorkspaceLeaf
} from "obsidian";

import { ChatController, type ActiveNote } from "./chat-controller.js";
import { CodexClient } from "./codex/codex-client.js";
import type { ChatSession, HealthStatus, ResultNote } from "./domain.js";
import { NodeProcessRunner } from "./platform/process-runner.js";
import { ObsidianVaultFiles } from "./platform/vault-files.js";
import { ContextService } from "./services/context-service.js";
import { GitService, type GitCandidate } from "./services/git-service.js";
import { HealthCheck } from "./services/health-check.js";
import { ResultStore } from "./services/result-store.js";
import { TranscriptStore } from "./services/transcript-store.js";
import {
  CodexSettingTab,
  DEFAULT_SETTINGS,
  type CodexPluginSettings,
  type SettingsController
} from "./settings.js";
import { ApprovalModal } from "./ui/modals.js";
import { CHAT_VIEW_TYPE, ChatView } from "./ui/chat-view.js";

export default class ObsidianCodexCliPlugin extends Plugin implements SettingsController {
  settings: CodexPluginSettings = { ...DEFAULT_SETTINGS };
  healthStatus: HealthStatus | null = null;

  private vaultRoot = "";
  private vaultFiles: ObsidianVaultFiles | null = null;
  private transcripts: TranscriptStore | null = null;
  private results: ResultStore | null = null;
  private gitService: GitService | null = null;
  private codex: CodexClient | null = null;
  private controller: ChatController | null = null;
  private baselineCaptured = false;

  get currentSession(): ChatSession | null {
    return this.controller?.session ?? null;
  }

  get isRunning(): boolean {
    return this.controller?.isRunning ?? false;
  }

  async onload(): Promise<void> {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData() as Partial<CodexPluginSettings> | null) };
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Codex CLI 插件仅支持 Windows 桌面文件系统 Vault");
    }
    this.vaultRoot = adapter.getBasePath();
    this.vaultFiles = new ObsidianVaultFiles(this.app.vault);
    this.transcripts = new TranscriptStore(this.vaultFiles);
    this.results = new ResultStore(this.vaultFiles);

    this.registerView(CHAT_VIEW_TYPE, (leaf) => new ChatView(leaf, this));
    this.registerEvent(this.app.workspace.on("file-open", (file) => {
      if (file instanceof TFile && file.extension === "md" && file.path.startsWith("Codex Chats/")) {
        void this.resumeChatFile(file.path).catch((error) => new Notice(errorMessage(error)));
      }
    }));
    this.addRibbonIcon("message-square-code", "打开 Codex CLI", () => void this.activateView());
    this.addCommand({
      id: "open-codex-cli-chat",
      name: "打开 Codex CLI 面板",
      callback: () => void this.activateView()
    });
    this.addSettingTab(new CodexSettingTab(this.app, this));
    await this.recheckHealth();
  }

  onunload(): void {
    if (this.controller?.isRunning === true) {
      void this.controller.stop();
    }
    this.controller?.destroy();
    this.controller = null;
    this.codex?.close();
    this.codex = null;
  }

  async updateSettings(settings: CodexPluginSettings): Promise<void> {
    this.settings = settings;
    await this.saveData(settings);
    this.shutdownRuntime();
    this.gitService = null;
    this.baselineCaptured = false;
    this.healthStatus = null;
    await this.refreshViews();
  }

  async recheckHealth(): Promise<void> {
    const runner = new NodeProcessRunner();
    this.healthStatus = await new HealthCheck(runner).run({
      vaultRoot: this.vaultRoot,
      codexPath: this.settings.codexPath,
      gitPath: this.settings.gitPath
    });
    if (this.healthStatus.readyToCommit && this.vaultFiles !== null) {
      if (this.gitService === null) {
        this.gitService = new GitService(
          this.vaultRoot,
          this.settings.gitPath,
          runner,
          (path) => this.requireVaultFiles().read(path)
        );
        try {
          await this.gitService.captureBaseline();
          this.baselineCaptured = true;
        } catch (error) {
          this.gitService = null;
          this.baselineCaptured = false;
          this.healthStatus.readyToCommit = false;
          this.healthStatus.errors.push(errorMessage(error));
        }
      }
    } else {
      this.gitService = null;
      this.baselineCaptured = false;
    }
    await this.refreshViews();
  }

  async startNewChat(): Promise<ChatSession> {
    const controller = await this.ensureRuntime();
    const note = this.activeMarkdownNote();
    const session = await controller.startChat(note);
    await this.refreshViews();
    return session;
  }

  async resumeLatestChat(): Promise<ChatSession> {
    const controller = await this.ensureRuntime();
    const transcripts = this.requireTranscripts();
    const paths = await transcripts.list();
    const sessions = await Promise.all(paths.map((path) => transcripts.load(path)));
    const latest = sessions.sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1);
    if (latest === undefined) {
      throw new Error("没有可恢复的本地会话");
    }
    const session = await controller.resumeChat(latest);
    await this.refreshViews();
    return session;
  }

  private async resumeChatFile(path: string): Promise<void> {
    const controller = await this.ensureRuntime();
    await controller.resumeChatPath(path);
    await this.refreshViews();
  }

  async send(text: string): Promise<void> {
    if (this.controller === null || this.controller.session === null) {
      await this.startNewChat();
    }
    await this.controller!.send(text);
    await this.refreshViews();
  }

  async stop(): Promise<void> {
    await this.controller?.stop();
    await this.refreshViews();
  }

  async saveResult(entryId: string, title: string, content: string): Promise<ResultNote> {
    if (this.controller === null) {
      throw new Error("尚未开始 Codex 会话");
    }
    const outcome = await this.controller.saveResult(entryId, title, content);
    if (outcome.linkError === null) {
      new Notice("成果已保存");
    } else {
      new Notice(`成果已保存至 ${outcome.result.path}，但关联笔记链接写入失败：${outcome.linkError}`);
    }
    return outcome.result;
  }

  async listResults(): Promise<string[]> {
    return this.results?.list() ?? [];
  }

  async openVaultFile(path: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) {
      throw new Error(`成果文件不存在: ${path}`);
    }
    await this.app.workspace.getLeaf(false).openFile(file);
  }

  async listCommitCandidates(): Promise<GitCandidate[]> {
    if (this.healthStatus?.readyToCommit !== true || this.gitService === null) {
      throw new Error("Git 或仓库尚未就绪");
    }
    return this.gitService.listCandidates();
  }

  async previewCommit(paths: string[]): Promise<string> {
    if (this.gitService === null) {
      throw new Error("Git 尚未就绪");
    }
    return this.gitService.preview(paths);
  }

  async commitResults(paths: string[], message: string): Promise<void> {
    if (this.gitService === null) {
      throw new Error("Git 尚未就绪");
    }
    await this.gitService.commit(paths, message);
  }

  private async ensureRuntime(): Promise<ChatController> {
    if (this.healthStatus?.readyToChat !== true) {
      throw new Error(this.healthStatus?.errors.join("；") || "Codex 尚未就绪");
    }
    if (this.controller !== null) {
      return this.controller;
    }
    const codex = CodexClient.fromExecutable(this.settings.codexPath, this.vaultRoot);
    this.codex = codex;
    try {
      await codex.initialize();
    } catch (error) {
      codex.close();
      this.codex = null;
      throw error;
    }
    codex.onApproval((prompt) => new Promise((resolve) => {
      new ApprovalModal(this.app, prompt, resolve).open();
    }));
    this.controller = new ChatController({
      transcripts: this.requireTranscripts(),
      results: this.requireResults(),
      context: new ContextService(),
      codex,
      git: {
        commit: (paths, message) => this.commitResults(paths, message)
      },
      readNote: (path) => this.requireVaultFiles().read(path)
    });
    return this.controller;
  }

  private shutdownRuntime(): void {
    this.controller?.destroy();
    this.controller = null;
    this.codex?.close();
    this.codex = null;
  }

  private activeMarkdownNote(): ActiveNote {
    const file = this.app.workspace.getActiveFile();
    if (file === null || file.extension !== "md") {
      throw new Error("请先打开一个 Markdown 笔记");
    }
    return { path: file.path, title: file.basename };
  }

  private async activateView(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(CHAT_VIEW_TYPE)[0] ?? null;
    if (leaf === null) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (leaf === null) {
        throw new Error("无法打开 Codex 侧边栏");
      }
      await leaf.setViewState({ type: CHAT_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  private async refreshViews(): Promise<void> {
    await Promise.all(
      this.app.workspace
        .getLeavesOfType(CHAT_VIEW_TYPE)
        .map((leaf) => leaf.view instanceof ChatView ? leaf.view.refresh() : Promise.resolve())
    );
  }

  private requireVaultFiles(): ObsidianVaultFiles {
    if (this.vaultFiles === null) {
      throw new Error("Vault 文件适配器尚未初始化");
    }
    return this.vaultFiles;
  }

  private requireTranscripts(): TranscriptStore {
    if (this.transcripts === null) {
      throw new Error("会话存储尚未初始化");
    }
    return this.transcripts;
  }

  private requireResults(): ResultStore {
    if (this.results === null) {
      throw new Error("成果存储尚未初始化");
    }
    return this.results;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
