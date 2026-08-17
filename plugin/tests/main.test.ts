import { beforeEach, describe, expect, it, vi } from "vitest";
import type { App, PluginManifest } from "obsidian";

vi.mock("obsidian", () => {
  class EmptyHostClass {}

  class Plugin {
    app: unknown;
    manifest = { id: "obsidian-codex-cli", dir: ".obsidian/plugins/obsidian-codex-cli" };

    async saveData(_data: unknown): Promise<void> {}
  }

  return {
    App: EmptyHostClass,
    FileSystemAdapter: EmptyHostClass,
    FileView: EmptyHostClass,
    ItemView: EmptyHostClass,
    Modal: EmptyHostClass,
    Notice: EmptyHostClass,
    Plugin,
    PluginSettingTab: EmptyHostClass,
    Setting: EmptyHostClass,
    TFile: EmptyHostClass,
    TextComponent: EmptyHostClass,
    Vault: EmptyHostClass,
    normalizePath: (path: string) => path,
    setIcon: () => {}
  };
});

import ObsidianCodexCliPlugin from "../src/main.js";
import type { ChatSession } from "../src/domain.js";
import type { CodexPluginSettings } from "../src/plugin-settings.js";

describe("ObsidianCodexCliPlugin", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("保存设置后下一条消息恢复当前会话", async () => {
    const plugin = new ObsidianCodexCliPlugin({} as App, {} as PluginManifest);
    const session = makeSession();
    const oldController = {
      session,
      isRunning: false,
      destroy: vi.fn()
    };
    const resumedController = {
      session: null as ChatSession | null,
      resumeChat: vi.fn(async (candidate: ChatSession) => {
        resumedController.session = candidate;
        return candidate;
      }),
      send: vi.fn(async () => {}),
      destroy: vi.fn()
    };
    const internals = plugin as unknown as {
      controller: typeof oldController | typeof resumedController | null;
      codex: { close(): void } | null;
      ensureRuntime(): Promise<typeof resumedController>;
      refreshViews(): Promise<void>;
    };
    internals.controller = oldController;
    internals.codex = { close: vi.fn() };
    internals.ensureRuntime = vi.fn(async () => {
      internals.controller = resumedController;
      return resumedController;
    });
    internals.refreshViews = vi.fn(async () => {});
    plugin.resolveWorkspaceAccess = vi.fn(async (settings) => ({
      workspaceRoots: settings.workspaceRoots,
      writablePaths: settings.writablePaths
    }));
    plugin.saveData = vi.fn(async () => {});
    plugin.startNewChat = vi.fn(async () => {
      const replacement = makeSession({ id: "new-session", codexThreadId: "new-thread" });
      resumedController.session = replacement;
      internals.controller = resumedController;
      return replacement;
    });

    await plugin.updateSettings(makeSettings());
    expect(plugin.currentSession).toBe(session);

    await plugin.send("继续讨论");

    expect(plugin.startNewChat).not.toHaveBeenCalled();
    expect(resumedController.resumeChat).toHaveBeenCalledWith(session);
    expect(resumedController.send).toHaveBeenCalledWith("继续讨论");
  });
});

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "项目",
    relatedNote: "项目.md",
    transcriptPath: "Codex Chats/2026-08-17-项目.md",
    codexThreadId: "thread-1",
    entries: [],
    status: "active",
    createdAt: "2026-08-17T10:00:00.000Z",
    updatedAt: "2026-08-17T10:00:00.000Z",
    ...overrides
  };
}

function makeSettings(): CodexPluginSettings {
  return {
    codexPath: "codex.cmd",
    gitPath: "git",
    workspaceRoots: [],
    writablePaths: []
  };
}
