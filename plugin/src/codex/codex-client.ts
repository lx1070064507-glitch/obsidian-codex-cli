import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";

import type { ApprovalPrompt } from "../domain.js";
import { JsonRpcTransport } from "./json-rpc.js";
import type {
  AgentMessageDelta,
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

export class CodexClient {
  private initialized = false;
  private threadId: string | null = null;
  private startingTurn: StartingTurn | null = null;
  private pendingTurn: PendingTurn | null = null;
  private approvalHandler: ApprovalHandler = async () => "deny";
  private readonly deltaHandlers = new Set<MessageDeltaHandler>();
  private readonly removeNotificationHandler: () => void;
  private readonly removeServerRequestHandler: () => void;

  constructor(
    private readonly rpc: CodexRpc,
    private readonly vaultRoot: string,
    private readonly childProcess: ChildProcessWithoutNullStreams | null = null
  ) {
    this.removeNotificationHandler = rpc.onNotification((notification) => {
      this.handleNotification(notification);
    });
    this.removeServerRequestHandler = rpc.onServerRequest((request) => this.handleServerRequest(request));
  }

  static fromExecutable(codexPath: string, vaultRoot: string): CodexClient {
    const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
      cwd: vaultRoot,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return CodexClient.fromChildProcess(child, vaultRoot);
  }

  static fromChildProcess(child: ChildProcessWithoutNullStreams, vaultRoot: string): CodexClient {
    child.stderr.resume();
    const rpc = new JsonRpcTransport(child.stdout, child.stdin);
    return new CodexClient(rpc, vaultRoot, child);
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }
    const result = await this.rpc.request<InitializeResult>("initialize", INITIALIZE_PARAMS);
    if (result.platformOs !== "windows") {
      throw new Error("Codex app-server 仅支持 Windows");
    }
    this.rpc.notify("initialized");
    this.initialized = true;
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
          runtimeWorkspaceRoots: [this.vaultRoot]
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
    if (this.childProcess !== null && !this.childProcess.killed) {
      this.childProcess.kill();
    }
  }

  private threadConfiguration(): Record<string, unknown> {
    return {
      cwd: this.vaultRoot,
      runtimeWorkspaceRoots: [this.vaultRoot],
      approvalPolicy: "on-request",
      approvalsReviewer: "user",
      sandbox: "workspace-write",
      config: { web_search: "disabled" }
    };
  }

  private handleNotification(notification: RpcNotification): void {
    if (this.startingTurn !== null && belongsToThread(notification, this.startingTurn.threadId)) {
      this.startingTurn.notifications.push(notification);
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
    const prompt = toApprovalPrompt(request);
    const choice = await this.approvalHandler(prompt);
    this.rpc.respond(request.id, { decision: choice === "allowOnce" ? "accept" : "decline" });
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

function toApprovalPrompt(request: RpcRequest): ApprovalPrompt {
  const params = isRecord(request.params) ? request.params : {};
  const reason = typeof params.reason === "string" ? params.reason : null;
  if (request.method === "item/commandExecution/requestApproval") {
    return {
      requestId: request.id,
      kind: "command",
      title: "运行外部命令",
      detail: formatDetail(params.command),
      reason
    };
  }
  return {
    requestId: request.id,
    kind: "fileChange",
    title: "修改文件",
    detail: formatDetail(params.changes),
    reason
  };
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
