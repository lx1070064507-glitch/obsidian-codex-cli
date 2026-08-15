import { describe, expect, it } from "vitest";

import { deriveControls, filterResultCandidates } from "../src/ui/view-model.js";

describe("view model", () => {
  it("运行中禁用发送并启用停止", () => {
    expect(deriveControls({ healthReady: true, hasActiveNote: true, running: true })).toEqual({
      canSend: false,
      canStop: true,
      canSaveResult: false
    });
  });

  it("健康且存在当前笔记时允许发送", () => {
    expect(deriveControls({ healthReady: true, hasActiveNote: true, running: false })).toEqual({
      canSend: true,
      canStop: false,
      canSaveResult: true
    });
  });

  it("提交列表只保留成果目录", () => {
    expect(filterResultCandidates([
      "Codex Results/A.md",
      "Codex Chats/B.md",
      "项目.md",
      "Codex Results/nested/C.md",
      "Codex Results/not-markdown.txt"
    ])).toEqual(["Codex Results/A.md"]);
  });
});
