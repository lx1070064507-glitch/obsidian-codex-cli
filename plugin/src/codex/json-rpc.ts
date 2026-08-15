import { createInterface, type Interface } from "node:readline";
import type { Readable, Writable } from "node:stream";

import type {
  RequestId,
  RpcNotification,
  RpcRequest,
  RpcResponse
} from "./protocol.js";

type NotificationHandler = (notification: RpcNotification) => void;
type ServerRequestHandler = (request: RpcRequest) => void | Promise<void>;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class JsonRpcTransport {
  private readonly lines: Interface;
  private readonly pending = new Map<RequestId, PendingRequest>();
  private readonly notificationHandlers = new Set<NotificationHandler>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private nextId = 1;
  private closed = false;

  constructor(
    private readonly input: Readable,
    private readonly output: Writable
  ) {
    this.lines = createInterface({ input, crlfDelay: Number.POSITIVE_INFINITY });
    this.lines.on("line", (line) => this.handleLine(line));
    this.lines.once("close", () => this.failPending(new Error("Codex JSON-RPC 连接已关闭")));
    this.input.once("error", (error) => this.failPending(error));
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex JSON-RPC 连接已关闭"));
    }
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject
      });
      try {
        this.write({ id, method, ...(params === undefined ? {} : { params }) }, (error) => {
          if (error !== null && error !== undefined) {
            this.pending.delete(id);
            reject(error);
          }
        });
      } catch (error) {
        this.pending.delete(id);
        reject(asError(error));
      }
    });
  }

  notify(method: string, params?: unknown): void {
    this.ensureOpen();
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: RequestId, result: unknown): void {
    this.ensureOpen();
    this.write({ id, result });
  }

  respondError(id: RequestId, code: number, message: string, data?: unknown): void {
    this.ensureOpen();
    this.write({
      id,
      error: { code, message, ...(data === undefined ? {} : { data }) }
    });
  }

  onNotification(handler: NotificationHandler): () => void {
    this.notificationHandlers.add(handler);
    return () => this.notificationHandlers.delete(handler);
  }

  onServerRequest(handler: ServerRequestHandler): () => void {
    this.serverRequestHandler = handler;
    return () => {
      if (this.serverRequestHandler === handler) {
        this.serverRequestHandler = null;
      }
    };
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.lines.close();
    this.failPending(new Error("Codex JSON-RPC 连接已关闭"));
  }

  private handleLine(line: string): void {
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(message)) {
      return;
    }
    if (typeof message.method === "string") {
      const params = "params" in message ? message.params : undefined;
      if (isRequestId(message.id)) {
        this.handleServerRequest({ id: message.id, method: message.method, params });
      } else {
        const notification = { method: message.method, params };
        for (const handler of this.notificationHandlers) {
          handler(notification);
        }
      }
      return;
    }
    if (isRequestId(message.id)) {
      this.handleResponse(message as unknown as RpcResponse);
    }
  }

  private handleResponse(response: RpcResponse): void {
    const pending = this.pending.get(response.id);
    if (pending === undefined) {
      return;
    }
    this.pending.delete(response.id);
    if (response.error !== undefined) {
      pending.reject(new Error(response.error.message));
      return;
    }
    pending.resolve(response.result);
  }

  private handleServerRequest(request: RpcRequest): void {
    if (this.serverRequestHandler === null) {
      this.respondError(request.id, -32601, "Method not found");
      return;
    }
    Promise.resolve(this.serverRequestHandler(request)).catch((error) => {
      this.respondError(request.id, -32603, asError(error).message);
    });
  }

  private write(
    message: RpcRequest | RpcNotification | RpcResponse,
    callback?: (error: Error | null | undefined) => void
  ): void {
    this.output.write(`${JSON.stringify(message)}\n`, "utf8", callback);
  }

  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Codex JSON-RPC 连接已关闭");
    }
  }

  private failPending(error: Error): void {
    this.closed = true;
    for (const request of this.pending.values()) {
      request.reject(error);
    }
    this.pending.clear();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRequestId(value: unknown): value is RequestId {
  return typeof value === "string" || typeof value === "number";
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
