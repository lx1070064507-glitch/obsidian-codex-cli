import { describe, expect, it, vi } from "vitest";

import type { ChatSession, ResultNote } from "../src/domain.js";
import {
  ChatController,
  type ChatControllerDependencies,
  type CodexClientPort,
  type ResultStorePort,
  type TranscriptStorePort
} from "../src/chat-controller.js";
import { ContextService } from "../src/services/context-service.js";

describe("ChatController", () => {
  it("用户消息保存成功后才调用 Codex", async () => {
    const order: string[] = [];
    const transcripts = new FakeTranscriptStore(() => order.push("save"));
    const codex = new FakeCodexClient(() => order.push("send"));
    const controller = createController({ transcripts, codex });
    await controller.startChat({ path: "项目.md", title: "项目" });
    order.length = 0;

    await controller.send("问题");

    expect(order.slice(0, 2)).toEqual(["save", "send"]);
  });

  it("流式回复每 250ms 节流保存并在完成后立即保存", async () => {
    vi.useFakeTimers();
    const transcripts = new FakeTranscriptStore();
    const codex = new FakeCodexClient(undefined, true);
    const controller = createController({ transcripts, codex });
    await controller.startChat({ path: "项目.md", title: "项目" });
    const initialSaves = transcripts.saveCount;
    const sending = controller.send("问题");
    await vi.waitFor(() => expect(codex.startedTurns).toHaveLength(1));
    const savesAfterUser = transcripts.saveCount;

    codex.emitDelta("答");
    codex.emitDelta("案");
    await vi.advanceTimersByTimeAsync(249);
    expect(transcripts.saveCount).toBe(savesAfterUser);
    await vi.advanceTimersByTimeAsync(1);
    expect(transcripts.saveCount).toBe(savesAfterUser + 1);

    codex.complete("completed");
    await sending;
    expect(transcripts.saveCount).toBe(savesAfterUser + 2);
    expect(controller.session?.entries.at(-1)?.content).toBe("答案");
    expect(transcripts.saveCount).toBeGreaterThan(initialSaves);
    vi.useRealTimers();
  });

  it("恢复线程并可停止当前回合", async () => {
    const transcripts = new FakeTranscriptStore();
    const codex = new FakeCodexClient(undefined, true);
    const controller = createController({ transcripts, codex });
    const session = makeSession({ codexThreadId: "thread-old" });
    await controller.resumeChat(session);
    const sending = controller.send("继续");
    await vi.waitFor(() => expect(codex.startedTurns).toHaveLength(1));

    await controller.stop();
    codex.complete("interrupted");
    await sending;

    expect(codex.resumedThreads).toEqual(["thread-old"]);
    expect(codex.interruptCount).toBe(1);
  });

  it("保存指定回复为成果并提交选择的成果", async () => {
    const transcripts = new FakeTranscriptStore();
    const codex = new FakeCodexClient();
    const results = new FakeResultStore();
    const commits: Array<[string[], string]> = [];
    const controller = createController({
      transcripts,
      codex,
      results,
      git: { commit: async (paths, message) => { commits.push([paths, message]); } }
    });
    await controller.startChat({ path: "项目.md", title: "项目" });
    await controller.send("问题");
    const reply = controller.session?.entries.find((entry) => entry.role === "assistant");
    expect(reply).toBeDefined();

    const result = await controller.saveResult(reply!.id, "最终方案", "编辑后的成果");
    await controller.commitResults([result.path], "docs: save result");

    expect(results.inputs[0]).toMatchObject({
      title: "最终方案",
      relatedNote: "项目.md",
      content: "编辑后的成果"
    });
    expect(commits).toEqual([[[result.path], "docs: save result"]]);
  });

  it("错误写入 system 条目并把会话标记为 failed", async () => {
    const transcripts = new FakeTranscriptStore();
    const codex = new FakeCodexClient();
    codex.failure = new Error("模型失败");
    const controller = createController({ transcripts, codex });
    await controller.startChat({ path: "项目.md", title: "项目" });

    await expect(controller.send("失败测试")).rejects.toThrow("模型失败");

    expect(controller.session?.status).toBe("failed");
    expect(controller.session?.entries.at(-1)).toMatchObject({ role: "system", content: "模型失败" });
    expect(transcripts.snapshots.at(-1)?.status).toBe("failed");
  });

  it("发送失败后重试会重新附带当前笔记上下文", async () => {
    const codex = new FakeCodexClient();
    codex.failure = new Error("临时失败");
    const controller = createController({ codex });
    await controller.startChat({ path: "项目.md", title: "项目" });
    await expect(controller.send("第一问")).rejects.toThrow("临时失败");
    codex.failure = null;

    await controller.send("重试");

    expect(codex.startedTurns[0]).toContain("# 项目");
    expect(codex.startedTurns[1]).toContain("# 项目");
  });
});

function createController(overrides: Partial<ChatControllerDependencies> = {}): ChatController {
  return new ChatController({
    transcripts: new FakeTranscriptStore(),
    results: new FakeResultStore(),
    context: new ContextService(),
    codex: new FakeCodexClient(),
    git: { commit: async () => {} },
    readNote: async () => "# 项目",
    now: () => "2026-08-15T10:00:00.000Z",
    ...overrides
  });
}

class FakeTranscriptStore implements TranscriptStorePort {
  saveCount = 0;
  readonly snapshots: ChatSession[] = [];

  constructor(private readonly onSave?: () => void) {}

  async create(title: string, relatedNote: string): Promise<ChatSession> {
    return makeSession({ title, relatedNote });
  }

  async save(session: ChatSession): Promise<void> {
    this.saveCount += 1;
    this.onSave?.();
    this.snapshots.push(structuredClone(session));
  }
}

class FakeResultStore implements ResultStorePort {
  readonly inputs: Array<Omit<ResultNote, "path" | "createdAt">> = [];

  async create(input: Omit<ResultNote, "path" | "createdAt">): Promise<ResultNote> {
    this.inputs.push(input);
    return {
      ...input,
      path: "Codex Results/2026-08-15-最终方案.md",
      createdAt: "2026-08-15T10:00:00.000Z"
    };
  }
}

class FakeCodexClient implements CodexClientPort {
  readonly startedTurns: string[] = [];
  readonly resumedThreads: string[] = [];
  interruptCount = 0;
  failure: Error | null = null;
  private deltaHandler: ((delta: string) => void) | null = null;
  private pending: { resolve: (value: { status: "completed" | "interrupted" }) => void; reject: (error: Error) => void } | null = null;

  constructor(
    private readonly onStartTurn?: () => void,
    private readonly deferred = false
  ) {}

  async startThread(): Promise<{ id: string }> {
    return { id: "thread-1" };
  }

  async resumeThread(threadId: string): Promise<{ id: string }> {
    this.resumedThreads.push(threadId);
    return { id: threadId };
  }

  startTurn(text: string): Promise<{ status: "completed" | "interrupted" }> {
    this.startedTurns.push(text);
    this.onStartTurn?.();
    if (this.failure !== null) {
      return Promise.reject(this.failure);
    }
    if (!this.deferred) {
      this.deltaHandler?.("回复");
      return Promise.resolve({ status: "completed" });
    }
    return new Promise((resolve, reject) => {
      this.pending = { resolve, reject };
    });
  }

  async interrupt(): Promise<void> {
    this.interruptCount += 1;
  }

  onMessageDelta(handler: (delta: string) => void): () => void {
    this.deltaHandler = handler;
    return () => {
      if (this.deltaHandler === handler) {
        this.deltaHandler = null;
      }
    };
  }

  emitDelta(delta: string): void {
    this.deltaHandler?.(delta);
  }

  complete(status: "completed" | "interrupted"): void {
    this.pending?.resolve({ status });
    this.pending = null;
  }
}

function makeSession(overrides: Partial<ChatSession> = {}): ChatSession {
  return {
    id: "session-1",
    title: "项目",
    relatedNote: "项目.md",
    transcriptPath: "Codex Chats/2026-08-15-项目.md",
    codexThreadId: null,
    entries: [],
    status: "active",
    createdAt: "2026-08-15T10:00:00.000Z",
    updatedAt: "2026-08-15T10:00:00.000Z",
    ...overrides
  };
}
