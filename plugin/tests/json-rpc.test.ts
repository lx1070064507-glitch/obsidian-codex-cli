import { PassThrough } from "node:stream";

import { describe, expect, it, vi } from "vitest";

import { JsonRpcTransport } from "../src/codex/json-rpc.js";

describe("JsonRpcTransport", () => {
  it("关联响应并转发服务器请求", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rpc = new JsonRpcTransport(input, output);
    const request = rpc.request("initialize", {
      clientInfo: {
        name: "obsidian-codex-cli",
        title: "Obsidian Codex CLI",
        version: "0.1.0"
      },
      capabilities: { experimentalApi: true, requestAttestation: false }
    });
    const sent = JSON.parse(await readLine(output)) as { id: number };
    input.write(`${JSON.stringify({
      id: sent.id,
      result: {
        userAgent: "codex",
        codexHome: "C:/Codex",
        platformFamily: "windows",
        platformOs: "windows"
      }
    })}\n`);
    await expect(request).resolves.toMatchObject({ platformOs: "windows" });

    const approval = vi.fn();
    rpc.onServerRequest(approval);
    input.write(`${JSON.stringify({
      id: 9,
      method: "item/commandExecution/requestApproval",
      params: { command: "curl example.com" }
    })}\n`);
    await vi.waitFor(() => expect(approval).toHaveBeenCalled());
    rpc.close();
  });

  it("转发通知并拒绝 RPC 错误响应", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rpc = new JsonRpcTransport(input, output);
    const notification = vi.fn();
    rpc.onNotification(notification);
    input.write(`${JSON.stringify({ method: "item/agentMessage/delta", params: { delta: "a" } })}\n`);
    await vi.waitFor(() => expect(notification).toHaveBeenCalledWith(
      expect.objectContaining({ method: "item/agentMessage/delta" })
    ));

    const request = rpc.request("thread/start", {});
    const sent = JSON.parse(await readLine(output)) as { id: number };
    input.write(`${JSON.stringify({ id: sent.id, error: { code: -32000, message: "failed" } })}\n`);
    await expect(request).rejects.toThrow("failed");
    rpc.close();
  });

  it("输入流关闭时拒绝所有未完成请求", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rpc = new JsonRpcTransport(input, output);
    const request = rpc.request("thread/start", {});
    await readLine(output);

    input.end();

    await expect(request).rejects.toThrow("连接已关闭");
  });

  it("没有处理器时对未知服务器请求返回 method not found", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const rpc = new JsonRpcTransport(input, output);
    input.write(`${JSON.stringify({ id: 5, method: "unknown/request", params: {} })}\n`);

    const response = JSON.parse(await readLine(output)) as {
      id: number;
      error: { code: number };
    };

    expect(response).toEqual({ id: 5, error: { code: -32601, message: "Method not found" } });
    rpc.close();
  });
});

function readLine(stream: PassThrough): Promise<string> {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (chunk: Buffer): void => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (newline >= 0) {
        stream.off("data", onData);
        resolve(buffer.slice(0, newline));
      }
    };
    stream.on("data", onData);
  });
}
