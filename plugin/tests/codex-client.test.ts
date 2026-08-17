import { describe, expect, it, vi } from "vitest";

import { CodexClient, type ApprovalChoice } from "../src/codex/codex-client.js";
import type { ApprovalDetail, ApprovalPrompt } from "../src/domain.js";
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

  it("以全盘只读且写入按需审批的权限档案启动线程", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();

    expect(rpc.requests).toContainEqual(expect.objectContaining({
      method: "thread/start",
      params: expect.objectContaining({
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault"],
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissions: "obsidian-vault",
        config: {
          web_search: "disabled",
          permissions: {
            "obsidian-vault": {
              filesystem: { ":root": "read" },
              network: { enabled: false }
            }
          }
        }
      })
    }));
    expect(rpc.requests.find((request) => request.method === "thread/start")?.params)
      .not.toHaveProperty("sandbox");
  });

  it("把额外工作区和白名单用于线程与每次回合", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault", null, {
      workspaceRoots: ["D:\\Vault", "D:\\Repo"],
      writablePaths: ["D:\\Repo\\Assets", "D:\\Repo\\ProjectSettings"]
    });
    await client.initialize();
    await client.startThread();

    expect(rpc.requests.find((request) => request.method === "thread/start")?.params)
      .toMatchObject({
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault", "D:\\Repo"],
        config: {
          web_search: "disabled",
          permissions: {
            "obsidian-vault": {
              filesystem: {
                ":root": "read",
                "D:\\Repo\\Assets": "write",
                "D:\\Repo\\ProjectSettings": "write"
              },
              network: { enabled: false }
            }
          }
        }
      });

    const turn = client.startTurn("检查两个目录");
    await vi.waitFor(() => expect(rpc.requests).toContainEqual({
      method: "turn/start",
      params: {
        threadId: "thread-1",
        input: [{ type: "text", text: "检查两个目录", text_elements: [] }],
        cwd: "D:\\Vault",
        runtimeWorkspaceRoots: ["D:\\Vault", "D:\\Repo"]
      }
    }));
    rpc.emitNotification({
      method: "turn/completed",
      params: { threadId: "thread-1", turn: { id: "turn-1", status: "completed", error: null } }
    });
    await expect(turn).resolves.toEqual({ turnId: "turn-1", status: "completed" });
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
        approvalPolicy: "on-request",
        approvalsReviewer: "user",
        permissions: "obsidian-vault",
        config: {
          web_search: "disabled",
          permissions: {
            "obsidian-vault": {
              filesystem: { ":root": "read" },
              network: { enabled: false }
            }
          }
        }
      })
    });
    expect(rpc.requests.find((request) => request.method === "thread/resume")?.params)
      .not.toHaveProperty("sandbox");
  });

  it("恢复线程时重新应用额外工作区和白名单", async () => {
    const rpc = new FakeRpc().withResult("thread/resume", { thread: { id: "thread-old" } });
    const client = new CodexClient(rpc, "D:\\Vault", null, {
      workspaceRoots: ["D:\\Repo"],
      writablePaths: ["D:\\Repo\\Assets"]
    });
    await client.initialize();
    await client.resumeThread("thread-old");

    expect(rpc.requests.find((request) => request.method === "thread/resume")?.params)
      .toMatchObject({
        threadId: "thread-old",
        runtimeWorkspaceRoots: ["D:\\Vault", "D:\\Repo"],
        config: {
          permissions: {
            "obsidian-vault": {
              filesystem: {
                ":root": "read",
                "D:\\Repo\\Assets": "write"
              }
            }
          }
        }
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

  it("用同 itemId 的 patchUpdated 填充文件审批概述", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    let captured: ApprovalPrompt | null = null;
    client.onApproval(async (prompt) => {
      captured = prompt;
      return "allowOnce";
    });
    rpc.emitNotification({
      method: "item/fileChange/patchUpdated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-file",
        changes: [{
          path: "created.txt",
          kind: { type: "add" },
          diff: "--- /dev/null\n+++ b/created.txt\n+created\n"
        }]
      }
    });

    await rpc.emitServerRequest({
      id: 11,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-file" }
    });

    expect(captured).toMatchObject({
      detail: "新增 D:\\Vault\\created.txt（+1 / -0）"
    });
    expect((captured as ApprovalPrompt | null)?.diff).toContain("+created");
  });

  it("审批先到时用后续 patchUpdated 更新已打开弹窗", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    let finishApproval!: (choice: ApprovalChoice) => void;
    const updates: ApprovalDetail[] = [];
    client.onApproval((prompt) => {
      expect(prompt.detail).toBe("正在获取变更概述");
      prompt.subscribeDetail?.((detail) => updates.push(detail));
      return new Promise((resolve) => {
        finishApproval = resolve;
      });
    });

    const approval = rpc.emitServerRequest({
      id: 12,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-late" }
    });
    await vi.waitFor(() => expect(finishApproval).toBeTypeOf("function"));
    rpc.emitNotification({
      method: "item/fileChange/patchUpdated",
      params: {
        threadId: "thread-1",
        turnId: "turn-1",
        itemId: "item-late",
        changes: [{
          path: "late.txt",
          kind: { type: "update", move_path: null },
          diff: "--- a/late.txt\n+++ b/late.txt\n-old\n+new\n"
        }]
      }
    });
    expect(updates.at(-1)?.detail).toBe("修改 D:\\Vault\\late.txt（+1 / -1）");
    finishApproval("allowOnce");
    await approval;
  });

  it("订阅建立前到达的 patchUpdated 会从缓存立即重放", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    const updates: ApprovalDetail[] = [];
    client.onApproval(async (prompt) => {
      rpc.emitNotification({
        method: "item/fileChange/patchUpdated",
        params: {
          threadId: "thread-1",
          turnId: "turn-1",
          itemId: "item-race",
          changes: [{
            path: "race.txt",
            kind: { type: "add" },
            diff: "+race\n"
          }]
        }
      });
      prompt.subscribeDetail?.((detail) => updates.push(detail));
      return "allowOnce";
    });

    await rpc.emitServerRequest({
      id: 13,
      method: "item/fileChange/requestApproval",
      params: { threadId: "thread-1", turnId: "turn-1", itemId: "item-race" }
    });

    expect(updates.at(-1)?.detail).toBe("新增 D:\\Vault\\race.txt（+1 / -0）");
  });

  it("拒绝审批后中断当前回合以避免重复申请", async () => {
    const rpc = new FakeRpc();
    const client = new CodexClient(rpc, "D:\\Vault");
    await client.initialize();
    await client.startThread();
    const turn = client.startTurn("写入测试");
    await vi.waitFor(() => expect(rpc.requests.some((request) => request.method === "turn/start")).toBe(true));
    client.onApproval(async () => "deny");

    await rpc.emitServerRequest({
      id: 10,
      method: "item/fileChange/requestApproval",
      params: { changes: ["permission-test.txt"], reason: "write" }
    });

    expect(rpc.responses).toContainEqual({ id: 10, result: { decision: "decline" } });
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
