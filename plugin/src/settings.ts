import { join } from "node:path";

import { App, Plugin, PluginSettingTab, Setting } from "obsidian";

export interface CodexPluginSettings {
  codexPath: string;
  gitPath: string;
}

export const DEFAULT_SETTINGS: CodexPluginSettings = {
  codexPath: join(process.env.APPDATA ?? "%APPDATA%", "npm", "codex.cmd"),
  gitPath: "git"
};

export interface SettingsController {
  settings: CodexPluginSettings;
  updateSettings(settings: CodexPluginSettings): Promise<void>;
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
      .setName("健康状态")
      .addButton((button) => {
        button.setButtonText("重新检查").onClick(() => this.controller.recheckHealth());
      });
  }
}
