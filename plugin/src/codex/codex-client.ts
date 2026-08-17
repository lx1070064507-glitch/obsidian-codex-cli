import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ApprovalDetail, ApprovalPrompt } from "../domain.js";
import {
  buildWindowsSandboxEnvironment,
  resolveWindowsExecutable
} from "../platform/process-runner.js";
import type { ResolvedWorkspaceAccess } from "../services/workspace-policy.js";
import {
  parseFileChangePatchUpdated,
  summarizeFileChanges
} from "./file-change-detail.js";
import { JsonRpcTransport } from "./json-rpc.js";
import type {
  AgentMessageDelta,
  FileUpdateChange,
  InitializeParams,
  InitializeResult,
  RequestId,
  RpcNotification,
  RpcRequest,
  ThreadResult,
  TurnCompleted,
  TurnResult
} from "./protocol.js";

export interface CodexRpc {
  request<T = unknown>(method: string, params?: unknown): Promise<T>;
  notify(method: string, params?: unknown): void;
  respond(id: RequestId, result: unknown): void;
  respondError(id: RequestId, code: number, message: string, data?: unknown): void;
  onNotification(handler: (notification: RpcNotification) => void): () => void;
  onServerRequest(handler: (request: RpcRequest) => void | Promise<void>): () => void;
  close(): void;
}

export type ApprovalChoice = "allowOnce" | "deny";
export interface TurnOutcome {
  turnId: string;
  status: "completed" | "interrupted";
}

type ApprovalHandler = (prompt: ApprovalPrompt) => Promise<ApprovalChoice>;
type MessageDeltaHandler = (delta: string, event: AgentMessageDelta) => void;

interface PendingTurn {
  threadId: string;
  turnId: string;
  resolve: (outcome: TurnOutcome) => void;
  reject: (error: Error) => void;
}

interface StartingTurn {
  threadId: string;
  notifications: RpcNotification[];
  ready: Promise<void>;
  reject: (error: Error) => void;
}

const INITIALIZE_PARAMS: InitializeParams = {
  clientInfo: {
    name: "obsidian-codex-cli",
    title: "Obsidian Codex CLI",
    version: "0.1.0"
  },
  capabilities: {
    experimentalApi: true,
    requestAttestation: false
  }
};

const EMPTY_WORKSPACE_ACCESS: ResolvedWorkspaceAccess = {
  workspaceRoots: [],
  writablePaths: []
};

export class CodexClient {
  private initialized = false;
  private initializeResult: InitializeResult | null = null;
  private threadId: string | null = null;
  private startingTurn: StartingTurn | null = null;
  private pendingTurn: PendingTurn | null = null;
  private approvalHandler: ApprovalHandler = async () => "deny";
  private readonly deltaHandlers = new Set<MessageDeltaHandler>();
  private readonly fileChanges = new Map<
    string,
    { turnId: string; changes: FileUpdateChange[] }
  >();
  private readonly fileDetailHandlers = new Map<
    string,
    Set<(detail: ApprovalDetail) => void>
  >();
  private readonly removeNotificationHandler: () => void;
  private readonly removeServerRequestHandler: () => void;

  constructor(
    private readonly rpc: CodexRpc,
    private readonly vaultRoot: string,
    private readonly childProcess: ChildProcessWithoutNullStreams | null = null,
    private readonly workspaceAccess: ResolvedWorkspaceAccess = EMPTY_WORKSPACE_ACCESS
  ) {
    this.removeNotificationHandler = rpc.onNotification((notification) => {
      this.handleNotification(notification);
    });
    this.removeServerRequestHandler = rpc.onServerRequest((request) => this.handleServerRequest(request));
  }

  static fromExecutable(
    codexPath: string,
    vaultRoot: string,
    workspaceAccess: ResolvedWorkspaceAccess = EMPTY_WORKSPACE_ACCESS
  ): CodexClient {
    const executable = resolveWindowsExecutable(codexPath, vaultRoot);
    const child = spawn(executable, ["app-server", "--listen", "stdio://"], {
      cwd: vaultRoot,
      env: buildWindowsSandboxEnvironment(process.env),
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return CodexClient.fromChildProcess(child, vaultRoot, workspaceAccess);
  }

  static fromChildProcess(
    child: ChildProcessWithoutNullStreams,
    vaultRoot: string,
    workspaceAccess: ResolvedWorkspaceAccess = EMPTY_WORKSPACE_ACCESS
  ): CodexClient {
    child.stderr.resume();
    const rpc = new JsonRpcTransport(child.stdout, child.stdin);
    child.once("error", () => rpc.close());
    return new CodexClient(rpc, vaultRoot, child, workspaceAccess);
  }

  async initialize(): Promise<InitializeResult> {
    if (this.initialized && this.initializeResult !== null) {
      return this.initializeResult;
    }
    const result = await this.rpc.request<InitializeResult>("initialize", INITIALIZE_PARAMS);
    if (result.platformOs !== "windows") {
      throw new Error("Codex app-server 仅支持 Windows");
    }
    this.rpc.notify("initialized");
    this.initialized = true;
    this.initializeResult = result;
    return result;
  }

  async startThread(): Promise<{ id: string }> {
    this.ensureInitialized();
    const result = await this.rpc.request<ThreadResult>("thread/start", this.threadConfiguration());
    this.threadId = result.thread.id;
    return result.thread;
  }

  async resumeThread(threadId: string): Promise<{ id: string }> {
    this.ensureInitialized();
    const result = await this.rpc.request<ThreadResult>("thread/resume", {
      threadId,
      ...this.threadConfiguration()
    });
    this.threadId = result.thread.id;
    return result.thread;
  }

  startTurn(text: string): Promise<TurnOutcome> {
    const threadId = this.requireThread();
    if (this.startingTurn !== null || this.pendingTurn !== null) {
      throw new Error("已有正在运行的 Codex 回合");
    }
    return new Promise<TurnOutcome>((resolve, reject) => {
      const starting: StartingTurn = {
        threadId,
        notifications: [],
        ready: Promise.resolve(),
        reject
      };
      this.startingTurn = starting;
      starting.ready = this.rpc
        .request<TurnResult>("turn/start", {
          threadId,
          input: [{ type: "text", text, text_elements: [] }],
          cwd: this.vaultRoot,
          runtimeWorkspaceRoots: this.runtimeWorkspaceRoots()
        })
        .then((result) => {
          if (this.startingTurn !== starting) {
            return;
          }
          this.pendingTurn = {
            threadId,
            turnId: result.turn.id,
            resolve,
            reject
          };
          this.startingTurn = null;
          for (const notification of starting.notifications) {
            this.handleNotification(notification);
          }
        })
        .catch((error) => {
          if (this.startingTurn === starting) {
            this.startingTurn = null;
          }
          reject(asError(error));
        });
    });
  }

  async interrupt(): Promise<void> {
    if (this.startingTurn !== null) {
      await this.startingTurn.ready;
    }
    if (this.pendingTurn === null) {
      return;
    }
    await this.rpc.request("turn/interrupt", {
      threadId: this.pendingTurn.threadId,
      turnId: this.pendingTurn.turnId
    });
  }

  onMessageDelta(handler: MessageDeltaHandler): () => void {
    this.deltaHandlers.add(handler);
    return () => this.deltaHandlers.delete(handler);
  }

  onApproval(handler: ApprovalHandler): () => void {
    this.approvalHandler = handler;
    return () => {
      if (this.approvalHandler === handler) {
        this.approvalHandler = async () => "deny";
      }
    };
  }

  close(): void {
    this.removeNotificationHandler();
    this.removeServerRequestHandler();
    this.rpc.close();
    if (this.startingTurn !== null) {
      this.startingTurn.reject(new Error("Codex 客户端已关闭"));
      this.startingTurn = null;
    }
    if (this.pendingTurn !== null) {
      this.pendingTurn.reject(new Error("Codex 客户端已关闭"));
      this.pendingTurn = null;
    }
    this.fileChanges.clear();
    this.fileDetailHandlers.clear();
    if (this.childProcess !== null && !this.childProcess.killed) {
      this.childProcess.kill();
    }
  }

  private threadConfiguration(): Record<string, unknown> {
    return {
      cwd: this.vaultRoot,
      runtimeWorkspaceRoots: this.runtimeWorkspaceRoots(),
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      permissions: "obsidian-vault",
      config: {
        web_search: "disabled",
        permissions: {
          "obsidian-vault": {
            filesystem: this.filesystemPermissions(),
            network: { enabled: false }
          }
        }
      }
    };
  }

  private runtimeWorkspaceRoots(): string[] {
    const roots = [this.vaultRoot, ...this.workspaceAccess.workspaceRoots];
    return roots.filter((path, index) =>
      roots.findIndex((candidate) => candidate.toLowerCase() === path.toLowerCase()) === index
    );
  }

  private filesystemPermissions(): Record<string, "read" | "write"> {
    return Object.fromEntries([
      [":root", "read"] as const,
      ...this.workspaceAccess.writablePaths.map((path) => [path, "write"] as const)
    ]);
  }

  private handleNotification(notification: RpcNotification): void {
    if (this.startingTurn !== null && belongsToThread(notification, this.startingTurn.threadId)) {
      this.startingTurn.notifications.push(notification);
      return;
    }
    if (notification.method === "item/fileChange/patchUpdated") {
      const event = parseFileChangePatchUpdated(notification.params);
      if (event !== null) {
        this.fileChanges.set(event.itemId, {
          turnId: event.turnId,
          changes: event.changes
        });
        const detail = toApprovalDetail(event.changes, this.vaultRoot);
        for (const handler of this.fileDetailHandlers.get(event.itemId) ?? []) {
          handler(detail);
        }
      }
      return;
    }
    if (notification.method === "item/agentMessage/delta" && isAgentMessageDelta(notification.params)) {
      if (
        this.pendingTurn !== null &&
        notification.params.threadId === this.pendingTurn.threadId &&
        notification.params.turnId === this.pendingTurn.turnId
      ) {
        for (const handler of this.deltaHandlers) {
          handler(notification.params.delta, notification.params);
        }
      }
      return;
    }
    if (notification.method === "turn/completed" && isTurnCompleted(notification.params)) {
      this.completeTurn(notification.params);
    }
  }

  private completeTurn(event: TurnCompleted): void {
    const pending = this.pendingTurn;
    if (
      pending === null ||
      event.threadId !== pending.threadId ||
      event.turn.id !== pending.turnId
    ) {
      return;
    }
    for (const [itemId, entry] of this.fileChanges) {
      if (entry.turnId === event.turn.id) {
        this.fileChanges.delete(itemId);
        this.fileDetailHandlers.delete(itemId);
      }
    }
    this.pendingTurn = null;
    if (event.turn.status === "completed" || event.turn.status === "interrupted") {
      pending.resolve({ turnId: event.turn.id, status: event.turn.status });
      return;
    }
    pending.reject(new Error(event.turn.error?.message ?? `Codex 回合状态异常: ${event.turn.status}`));
  }

  private async handleServerRequest(request: RpcRequest): Promise<void> {
    if (
      request.method !== "item/commandExecution/requestApproval" &&
      request.method !== "item/fileChange/requestApproval"
    ) {
      this.rpc.respondError(request.id, -32601, "Method not found");
      return;
    }
    const params = isRecord(request.params) ? request.params : {};
    const itemId = request.method === "item/fileChange/requestApproval" &&
      typeof params.itemId === "string"
      ? params.itemId
      : null;
    const prompt = this.toApprovalPrompt(request);
    try {
      const choice = await this.approvalHandler(prompt);
      this.rpc.respond(request.id, { decision: choice === "allowOnce" ? "accept" : "decline" });
      if (choice === "deny") {
        await this.interrupt();
      }
    } finally {
      if (itemId !== null) {
        this.fileChanges.delete(itemId);
        this.fileDetailHandlers.delete(itemId);
      }
    }
  }

  private toApprovalPrompt(request: RpcRequest): ApprovalPrompt {
    const params = isRecord(request.params) ? request.params : {};
    const reason = typeof params.reason === "string" ? params.reason : null;
    if (request.method === "item/commandExecution/requestApproval") {
      return {
        requestId: request.id,
        kind: "command",
        title: "运行外部命令",
        detail: formatDetail(params.command),
        diff: null,
        reason
      };
    }
    const itemId = typeof params.itemId === "string" ? params.itemId : null;
    const cached = itemId === null ? undefined : this.fileChanges.get(itemId);
    const initial = cached === undefined
      ? { detail: "正在获取变更概述", diff: null }
      : toApprovalDetail(cached.changes, this.vaultRoot);
    return {
      requestId: request.id,
      kind: "fileChange",
      title: "修改文件",
      ...initial,
      reason,
      ...(itemId === null ? {} : {
        subscribeDetail: (handler: (detail: ApprovalDetail) => void) =>
          this.subscribeFileDetail(itemId, handler)
      })
    };
  }

  private subscribeFileDetail(
    itemId: string,
    handler: (detail: ApprovalDetail) => void
  ): () => void {
    const handlers = this.fileDetailHandlers.get(itemId) ?? new Set();
    handlers.add(handler);
    this.fileDetailHandlers.set(itemId, handlers);
    const cached = this.fileChanges.get(itemId);
    if (cached !== undefined) {
      handler(toApprovalDetail(cached.changes, this.vaultRoot));
    }
    return () => {
      handlers.delete(handler);
      if (handlers.size === 0) {
        this.fileDetailHandlers.delete(itemId);
      }
    };
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error("Codex 客户端尚未初始化");
    }
  }

  private requireThread(): string {
    this.ensureInitialized();
    if (this.threadId === null) {
      throw new Error("Codex 线程尚未启动");
    }
    return this.threadId;
  }
}

function toApprovalDetail(changes: FileUpdateChange[], cwd: string): ApprovalDetail {
  const detail = summarizeFileChanges(changes, cwd);
  return { detail: detail.summary, diff: detail.diff };
}

function formatDetail(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return value === undefined ? "" : JSON.stringify(value, null, 2);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAgentMessageDelta(value: unknown): value is AgentMessageDelta {
  return (
    isRecord(value) &&
    typeof value.threadId === "string" &&
    typeof value.turnId === "string" &&
    typeof value.itemId === "string" &&
    typeof value.delta === "string"
  );
}

function isTurnCompleted(value: unknown): value is TurnCompleted {
  if (!isRecord(value) || typeof value.threadId !== "string" || !isRecord(value.turn)) {
    return false;
  }
  return (
    typeof value.turn.id === "string" &&
    typeof value.turn.status === "string" &&
    (value.turn.error === null || isRecord(value.turn.error))
  );
}

function belongsToThread(notification: RpcNotification, threadId: string): boolean {
  if (notification.method === "item/agentMessage/delta" && isAgentMessageDelta(notification.params)) {
    return notification.params.threadId === threadId;
  }
  if (notification.method === "turn/completed" && isTurnCompleted(notification.params)) {
    return notification.params.threadId === threadId;
  }
  return false;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
