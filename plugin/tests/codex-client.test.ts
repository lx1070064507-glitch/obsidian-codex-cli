import { describe, expect, it, vi } from "vitest";

import { CodexClient } from "../src/codex/codex-client.js";
import { FakeRpc } from "./fake-rpc.js";

describe("CodexClient", () => {
  it("按顺序初始化并只接受 Windows", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    expect(rpc.requests[0]).toMatchObject({ method: "initialize" });
    expect(rpc.notifications[0]).toEqual({ method: "initialized" });

    const linux = new CodexClient(
      new FakeRpc().withResult("initialize", { platformOs: "linux" }),
      "D:\\Vault"
    );
    await expect(linux.initialize()).rejects.toThrow("Windows");
  });

  it("以 Vault 沙箱启动线程并禁用网页搜索", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();

    expect(rpc.requests).toContainEqual(expect.objectContaining({
      method: "thread/start",
      params: expect.objectContaining({
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault"],
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: "workspace-write",
        config: { web_search: "disabled" }
      })
    }));
  });

  it("恢复线程时重新覆盖 Vault 与审批配置", async () => {
    const rpc = new FakeRpc().withResult("thread/resume", { thread: { id: "thread-old" } });
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.resumeThread("thread-old");

    expect(rpc.requests).toContainEqual({
      method: "thread/resume",
      params: expect.objectContaining({
        threadId: "thread-old",
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault"],
        approvalPolicy: "untrusted",
        approvalsReviewer: "user",
        sandbox: "workspace-write"
      })
    });
  });

  it("发送回合、转发流式消息并解析完成", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();
    const deltas: string[] = [];
    client.onMessageDelta((delta) => deltas.push(delta));

    const turn = client.startTurn("分析方案");
    await vi.waitFor(() => expect(rpc.requests).toContainEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "分析方案", text_elements: [] }],
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault"]
      }
    }));
    rpc.emitNotification({
      method: "item/agentMessage/delta",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "结果" }
    });
    rpc.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } }
    });

    await expect(turn).resolves.toEqual({ turnId: "turn-1", status: "completed" });
    expect(deltas).toEqual(["结果"]);
  });

  it("不丢失 turn/start 响应前紧接到达的回合事件", async () => {
    const rpc = new FakeRpc().onRequest("turn/start", () => {
      rpc.emitNotification({
        method: "item/agentMessage/delta",
        params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-1", delta: "快速回复" }
      });
      rpc.emitNotification({
        method: "turn/completed",
        params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } }
      });
    });
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();
    const deltas: string[] = [];
    client.onMessageDelta((delta) => deltas.push(delta));

    await expect(client.startTurn("快速测试")).resolves.toEqual({
      turnId: "turn-1",
      status: "completed"
    });
    expect(deltas).toEqual(["快速回复"]);
  }, 500);

  it("主动中断当前回合并解析中断状态", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();
    const turn = client.startTurn("停止测试");
    await vi.waitFor(() => expect(rpc.requests.some((request) => request.method === "turn/start")).toBe(true));

    await client.interrupt();
    expect(rpc.requests).toContainEqual({
      method: "turn/interrupt",
      params: { threadId: "thread-1", turnId: "turn-1" }
    });
    rpc.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "interrupted", error: null } }
    });
    await expect(turn).resolves.toEqual({ turnId: "turn-1", status: "interrupted" });
  });

  it("把失败回合作为错误返回", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();
    const turn = client.startTurn("失败测试");
    await vi.waitFor(() => expect(rpc.requests.some((request) => request.method === "turn/start")).toBe(true));
    rpc.emitNotification({
      method: "turn/completed",
      params: {
        threadId: "thread-1",
        turn: { id: "turn-1", status: "failed", error: { message: "模型失败" } }
      }
    });
    await expect(turn).rejects.toThrow("模型失败");
  });

  it("只发送允许一次或拒绝", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    client.onApproval(async () => "allowOnce");
    await rpc.emitServerRequest({
      id: 7,
      method: "item/commandExecution/requestApproval",
      params: { command: "curl example.com", reason: "network" }
    });
    expect(rpc.responses).toContainEqual({ id: 7, result: { decision: "accept" } });

    client.onApproval(async () => "deny");
    await rpc.emitServerRequest({
      id: 8,
      method: "item/fileChange/requestApproval",
      params: { changes: ["../outside.txt"], reason: "outside Vault" }
    });
    expect(rpc.responses).toContainEqual({ id: 8, result: { decision: "decline" } });
  });

  it("未知服务器请求返回 method not found", async () => {
    const rpc = new FakeRpc();
    new CodexClient(rpc, "D:\\Vault");
    await rpc.emitServerRequest({ id: 9, method: "unknown/request", params: {} });
    expect(rpc.responses).toContainEqual({
      id: 9,
      error: { code: -32601, message: "Method not found" }
    });
  });
});
