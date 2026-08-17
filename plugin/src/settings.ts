import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

import type { CodexPluginSettings } from "./plugin-settings.js";
import type { ResolvedWorkspaceAccess } from "./services/workspace-policy.js";
import {
  WorkspaceRootsModal,
  WritablePathsModal,
  type WorkspaceModalOptions
} from "./ui/workspace-modals.js";

export type { CodexPluginSettings } from "./plugin-settings.js";

export interface SettingsController {
  settings: CodexPluginSettings;
  updateSettings(settings: CodexPluginSettings): Promise<void>;
  resolveWorkspaceAccess(settings: CodexPluginSettings): Promise<ResolvedWorkspaceAccess>;
  recheckHealth(): Promise<void>;
}

export class CodexSettingTab extends PluginSettingTab {
  constructor(
    app: App,
    private readonly controller: Plugin & SettingsController
  ) {
    super(app, controller);
  }

  display(): void {
    this.containerEl.empty();
    new Setting(this.containerEl)
      .setName("Codex 路径")
      .addText((text) => {
        text.setValue(this.controller.settings.codexPath).onChange((codexPath) => {
          void this.controller.updateSettings({ ...this.controller.settings, codexPath });
        });
      });
    new Setting(this.containerEl)
      .setName("Git 路径")
      .addText((text) => {
        text.setValue(this.controller.settings.gitPath).onChange((gitPath) => {
          void this.controller.updateSettings({ ...this.controller.settings, gitPath });
        });
      });
    new Setting(this.containerEl)
      .setName("工作区")
      .setDesc(`${this.controller.settings.workspaceRoots.length} 个额外工作区`)
      .addButton((button) => button.setButtonText("管理工作区").onClick(() => {
        new WorkspaceRootsModal(this.app, modalOptions(this.controller, () => this.display())).open();
      }));
    new Setting(this.containerEl)
      .setName("写入白名单")
      .setDesc(`${this.controller.settings.writablePaths.length} 个默认可写路径`)
      .addButton((button) => button.setButtonText("管理白名单").onClick(() => {
        new WritablePathsModal(this.app, modalOptions(this.controller, () => this.display())).open();
      }));
    new Setting(this.containerEl)
      .setName("健康状态")
      .addButton((button) => {
        button.setButtonText("重新检查").onClick(() => this.controller.recheckHealth());
      });
  }
}

function modalOptions(
  controller: SettingsController,
  afterSave: () => void
): WorkspaceModalOptions {
  return {
    settings: controller.settings,
    validate: (settings) => controller.resolveWorkspaceAccess(settings),
    save: async (settings) => {
      await controller.updateSettings(settings);
      afterSave();
    }
  };
}
