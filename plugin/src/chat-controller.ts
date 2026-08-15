import { randomUUID } from "node:crypto";

import type { ChatEntry, ChatSession, ResultNote } from "./domain.js";
import type { ContextService } from "./services/context-service.js";

export interface ActiveNote {
  path: string;
  title: string;
}

export interface TranscriptStorePort {
  create(title: string, relatedNote: string): Promise<ChatSession>;
  save(session: ChatSession): Promise<void>;
}

export interface ResultStorePort {
  create(input: Omit<ResultNote, "path" | "createdAt">): Promise<ResultNote>;
}

export interface CodexClientPort {
  startThread(): Promise<{ id: string }>;
  resumeThread(threadId: string): Promise<{ id: string }>;
  startTurn(text: string): Promise<{ status: "completed" | "interrupted" }>;
  interrupt(): Promise<void>;
  onMessageDelta(handler: (delta: string) => void): () => void;
}

export interface GitServicePort {
  commit(paths: string[], message: string): Promise<void>;
}

export interface ChatControllerDependencies {
  transcripts: TranscriptStorePort;
  results: ResultStorePort;
  context: ContextService;
  codex: CodexClientPort;
  git: GitServicePort;
  readNote: (path: string) => Promise<string>;
  now?: () => string;
}

export class ChatController {
  private readonly now: () => string;
  private sessionState: ChatSession | null = null;
  private activeNote: ActiveNote | null = null;
  private activeAssistant: ChatEntry | null = null;
  private running = false;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQueue: Promise<void> = Promise.resolve();
  private backgroundSaveError: Error | null = null;
  private readonly removeDeltaHandler: () => void;

  constructor(private readonly dependencies: ChatControllerDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.removeDeltaHandler = dependencies.codex.onMessageDelta((delta) => {
      if (this.running && this.activeAssistant !== null) {
        this.activeAssistant.content += delta;
        this.scheduleSave();
      }
    });
  }

  get session(): ChatSession | null {
    return this.sessionState;
  }

  get isRunning(): boolean {
    return this.running;
  }

  async startChat(activeNote: ActiveNote): Promise<ChatSession> {
    this.ensureIdle();
    this.dependencies.context.reset();
    this.activeNote = activeNote;
    const session = await this.dependencies.transcripts.create(activeNote.title, activeNote.path);
    this.sessionState = session;
    try {
      const thread = await this.dependencies.codex.startThread();
      session.codexThreadId = thread.id;
      await this.persist();
      return session;
    } catch (error) {
      await this.recordFailure(asError(error));
      throw error;
    }
  }

  async resumeChat(session: ChatSession): Promise<ChatSession> {
    this.ensureIdle();
    this.dependencies.context.reset();
    this.sessionState = session;
    this.activeNote = { path: session.relatedNote, title: session.title };
    try {
      const thread = session.codexThreadId === null
        ? await this.dependencies.codex.startThread()
        : await this.dependencies.codex.resumeThread(session.codexThreadId);
      session.codexThreadId = thread.id;
      await this.persist();
      return session;
    } catch (error) {
      await this.recordFailure(asError(error));
      throw error;
    }
  }

  async send(text: string): Promise<void> {
    const session = this.requireSession();
    if (this.running) {
      throw new Error("已有正在运行的对话回合");
    }
    if (text.trim().length === 0) {
      throw new Error("消息不能为空");
    }
    this.running = true;
    this.backgroundSaveError = null;
    const userEntry = this.newEntry("user", text);
    session.entries.push(userEntry);
    try {
      await this.persist();
      const noteContent = await this.dependencies.readNote(session.relatedNote);
      const prompt = this.dependencies.context.compose(session.relatedNote, noteContent, text);
      const assistant = this.newEntry("assistant", "");
      session.entries.push(assistant);
      this.activeAssistant = assistant;
      await this.dependencies.codex.startTurn(prompt);
      session.status = "active";
      await this.flushStreamSave();
    } catch (error) {
      this.dependencies.context.reset();
      await this.flushStreamSave(false);
      await this.recordFailure(asError(error));
      throw error;
    } finally {
      this.activeAssistant = null;
      this.running = false;
    }
  }

  async stop(): Promise<void> {
    if (this.running) {
      await this.dependencies.codex.interrupt();
    }
  }

  async saveResult(entryId: string, editedTitle: string, editedContent: string): Promise<ResultNote> {
    const session = this.requireSession();
    const entry = session.entries.find((candidate) => candidate.id === entryId && candidate.role === "assistant");
    if (entry === undefined) {
      throw new Error("未找到可保存的 Codex 回复");
    }
    return this.dependencies.results.create({
      title: editedTitle,
      sourceChat: session.transcriptPath,
      relatedNote: session.relatedNote,
      content: editedContent
    });
  }

  async commitResults(paths: string[], message: string): Promise<void> {
    await this.dependencies.git.commit(paths, message);
  }

  destroy(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    this.removeDeltaHandler();
  }

  private scheduleSave(): void {
    if (this.saveTimer !== null) {
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persist().catch((error) => {
        this.backgroundSaveError = asError(error);
      });
    }, 250);
  }

  private async flushStreamSave(throwBackgroundError = true): Promise<void> {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.persist();
    if (throwBackgroundError && this.backgroundSaveError !== null) {
      throw this.backgroundSaveError;
    }
  }

  private persist(): Promise<void> {
    const session = this.requireSession();
    const operation = this.saveQueue
      .catch((error) => {
        this.backgroundSaveError = asError(error);
      })
      .then(() => this.dependencies.transcripts.save(session));
    this.saveQueue = operation;
    return operation;
  }

  private async recordFailure(error: Error): Promise<void> {
    const session = this.requireSession();
    session.status = "failed";
    session.entries.push(this.newEntry("system", error.message));
    await this.persist();
  }

  private newEntry(role: ChatEntry["role"], content: string): ChatEntry {
    return {
      id: randomUUID(),
      role,
      content,
      createdAt: this.now()
    };
  }

  private ensureIdle(): void {
    if (this.running) {
      throw new Error("当前回合尚未结束");
    }
  }

  private requireSession(): ChatSession {
    if (this.sessionState === null || this.activeNote === null) {
      throw new Error("尚未开始 Codex 会话");
    }
    return this.sessionState;
  }
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
