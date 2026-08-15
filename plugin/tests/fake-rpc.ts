import type { CodexRpc } from "../src/codex/codex-client.js";
import type { RequestId, RpcNotification, RpcRequest } from "../src/codex/protocol.js";

export class FakeRpc implements CodexRpc {
  readonly requests: Array<{ method: string; params?: unknown }> = [];
  readonly notifications: Array<{ method: string; params?: unknown }> = [];
  readonly responses: Array<
    | { id: RequestId; result: unknown }
    | { id: RequestId; error: { code: number; message: string; data?: unknown } }
  > = [];
  private notificationHandler: ((notification: RpcNotification) => void) | null = null;
  private serverRequestHandler: ((request: RpcRequest) => void | Promise<void>) | null = null;
  private readonly results = new Map<string, unknown>([
    ["initialize", { platformOs: "windows", platformFamily: "windows", userAgent: "codex", codexHome: "C:/Codex" }],
    ["thread/start", { thread: { id: "thread-1" } }],
    ["thread/resume", { thread: { id: "thread-1" } }],
    ["turn/start", { turn: { id: "turn-1" } }],
    ["turn/interrupt", {}]
  ]);
  private readonly requestHooks = new Map<string, () => void | Promise<void>>();

  withResult(method: string, result: unknown): this {
    this.results.set(method, result);
    return this;
  }

  onRequest(method: string, hook: () => void | Promise<void>): this {
    this.requestHooks.set(method, hook);
    return this;
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.requests.push({ method, ...(params === undefined ? {} : { params }) });
    await this.requestHooks.get(method)?.();
    return this.results.get(method) as T;
  }

  notify(method: string, params?: unknown): void {
    this.notifications.push({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RequestId, result: unknown): void {
    this.responses.push({ id, result });
  }

  respondError(id: RequestId, code: number, message: string, data?: unknown): void {
    this.responses.push({ id, error: { code, message, ...(data === undefined ? {} : { data }) } });
  }

  onNotification(handler: (notification: RpcNotification) => void): () => void {
    this.notificationHandler = handler;
    return () => {
      if (this.notificationHandler === handler) {
        this.notificationHandler = null;
      }
    };
  }

  onServerRequest(handler: (request: RpcRequest) => void | Promise<void>): () => void {
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
      }
    };
  }

  emitNotification(notification: RpcNotification): void {
    this.notificationHandler?.(notification);
  }

  async emitServerRequest(request: RpcRequest): Promise<void> {
    if (this.serverRequestHandler === null) {
      throw new Error("未注册服务器请求处理器");
    }
    await this.serverRequestHandler(request);
  }

  close(): void {}
}
