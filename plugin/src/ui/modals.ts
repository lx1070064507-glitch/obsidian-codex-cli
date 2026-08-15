import { App, Modal, Setting } from "obsidian";

import type { ApprovalPrompt } from "../domain.js";
import type { ApprovalChoice } from "../codex/codex-client.js";
import type { GitCandidate } from "../services/git-service.js";

export class ApprovalModal extends Modal {
  private settled = false;

  constructor(
    app: App,
    private readonly prompt: ApprovalPrompt,
    private readonly resolveChoice: (choice: ApprovalChoice) => void
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText(this.prompt.title);
    this.contentEl.addClass("codex-modal");
    this.contentEl.createEl("div", { cls: "codex-modal-detail", text: this.prompt.detail || "无详细信息" });
    if (this.prompt.reason !== null) {
      this.contentEl.createEl("div", { cls: "codex-modal-reason", text: this.prompt.reason });
    }
    const actions = this.contentEl.createDiv({ cls: "codex-modal-actions" });
    const allow = actions.createEl("button", { cls: "mod-cta", text: "允许一次" });
    allow.addEventListener("click", () => this.settle("allowOnce"));
    const deny = actions.createEl("button", { text: "拒绝" });
    deny.addEventListener("click", () => this.settle("deny"));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.settled) {
      this.settled = true;
      this.resolveChoice("deny");
    }
  }

  private settle(choice: ApprovalChoice): void {
    if (this.settled) {
      return;
    }
    this.settled = true;
    this.resolveChoice(choice);
    this.close();
  }
}

export interface SaveResultValue {
  title: string;
  content: string;
}

export class SaveResultModal extends Modal {
  private title = "";
  private content = "";

  constructor(
    app: App,
    initial: SaveResultValue,
    private readonly onSave: (value: SaveResultValue) => Promise<void>
  ) {
    super(app);
    this.title = initial.title;
    this.content = initial.content;
  }

  onOpen(): void {
    this.titleEl.setText("保存为成果");
    this.contentEl.addClass("codex-modal");
    new Setting(this.contentEl).setName("标题").addText((input) => {
      input.setValue(this.title).onChange((value) => {
        this.title = value;
      });
    });
    const body = this.contentEl.createEl("textarea", { cls: "codex-result-editor" });
    body.value = this.content;
    body.addEventListener("input", () => {
      this.content = body.value;
    });
    const actions = this.contentEl.createDiv({ cls: "codex-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const save = actions.createEl("button", { cls: "mod-cta", text: "保存成果" });
    save.addEventListener("click", () => {
      save.disabled = true;
      void this.onSave({ title: this.title, content: this.content })
        .then(() => this.close())
        .catch(() => {
          save.disabled = false;
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class CommitResultsModal extends Modal {
  private readonly selected = new Set<string>();
  private message = "docs: save Codex results";
  private previewEl: HTMLElement | null = null;

  constructor(
    app: App,
    private readonly candidates: GitCandidate[],
    private readonly preview: (paths: string[]) => Promise<string>,
    private readonly commit: (paths: string[], message: string) => Promise<void>
  ) {
    super(app);
  }

  onOpen(): void {
    this.titleEl.setText("提交成果");
    this.contentEl.addClass("codex-modal", "codex-commit-modal");
    const list = this.contentEl.createDiv({ cls: "codex-commit-list" });
    for (const candidate of this.candidates) {
      const label = list.createEl("label", { cls: "codex-commit-candidate" });
      const checkbox = label.createEl("input", { type: "checkbox" });
      label.createSpan({ text: candidate.path });
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) {
          this.selected.add(candidate.path);
        } else {
          this.selected.delete(candidate.path);
        }
        void this.refreshPreview();
      });
    }
    new Setting(this.contentEl).setName("提交说明").addText((input) => {
      input.setValue(this.message).onChange((value) => {
        this.message = value;
      });
    });
    this.previewEl = this.contentEl.createEl("pre", { cls: "codex-diff-preview", text: "选择成果以预览差异" });
    const actions = this.contentEl.createDiv({ cls: "codex-modal-actions" });
    const cancel = actions.createEl("button", { text: "取消" });
    cancel.addEventListener("click", () => this.close());
    const confirm = actions.createEl("button", { cls: "mod-cta", text: "创建提交" });
    confirm.addEventListener("click", () => {
      confirm.disabled = true;
      void this.commit([...this.selected], this.message)
        .then(() => this.close())
        .catch(() => {
          confirm.disabled = false;
        });
    });
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private async refreshPreview(): Promise<void> {
    if (this.previewEl === null) {
      return;
    }
    const paths = [...this.selected];
    this.previewEl.setText(paths.length === 0 ? "选择成果以预览差异" : await this.preview(paths));
  }
}
