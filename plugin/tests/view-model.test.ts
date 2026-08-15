import { describe, expect, it } from "vitest";

import {
  deriveControls,
  filterResultCandidates,
  handleComposerShortcut,
  periodicRefreshScope
} from "../src/ui/view-model.js";

describe("view model", () => {
  it("运行中禁用发送并启用停止", () => {
    expect(deriveControls({ healthReady: true, hasActiveNote: true, hasInput: true, running: true })).toEqual({
      canSend: false,
      canStop: true,
      canSaveResult: false
    });
  });

  it("健康且存在当前笔记时允许发送", () => {
    expect(deriveControls({ healthReady: true, hasActiveNote: true, hasInput: true, running: false })).toEqual({
      canSend: true,
      canStop: false,
      canSaveResult: true
    });
  });

  it("输入为空时禁用发送", () => {
    expect(deriveControls({
      healthReady: true,
      hasActiveNote: true,
      hasInput: false,
      running: false
    }).canSend).toBe(false);
  });

  it("仅在回合运行期间请求会话范围的周期刷新", () => {
    expect(periodicRefreshScope(false)).toBeNull();
    expect(periodicRefreshScope(true)).toBe("conversation");
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

  it("submits Ctrl+Enter when Electron reports the physical Enter key", () => {
    const input = new EventTarget();
    let sent = 0;
    let prevented = false;
    let stopped = false;

    const handled = handleComposerShortcut({
      ctrlKey: true,
      key: "Process",
      code: "Enter",
      isComposing: false,
      target: input,
      preventDefault: () => { prevented = true; },
      stopPropagation: () => { stopped = true; }
    }, input, () => { sent += 1; });

    expect(handled).toBe(true);
    expect(sent).toBe(1);
    expect(prevented).toBe(true);
    expect(stopped).toBe(true);
  });

  it("ignores Ctrl+Enter outside the composer", () => {
    const input = new EventTarget();
    let sent = 0;

    const handled = handleComposerShortcut({
      ctrlKey: true,
      key: "Enter",
      code: "Enter",
      isComposing: false,
      target: new EventTarget(),
      preventDefault: () => undefined,
      stopPropagation: () => undefined
    }, input, () => { sent += 1; });

    expect(handled).toBe(false);
    expect(sent).toBe(0);
  });

  it("does not submit while an IME composition is active", () => {
    const input = new EventTarget();
    let sent = 0;

    const handled = handleComposerShortcut({
      ctrlKey: true,
      key: "Process",
      code: "Enter",
      isComposing: true,
      target: input,
      preventDefault: () => undefined,
      stopPropagation: () => undefined
    }, input, () => { sent += 1; });

    expect(handled).toBe(false);
    expect(sent).toBe(0);
  });

  it("submits Ctrl+NumpadEnter when Electron reports the physical key", () => {
    const input = new EventTarget();
    let sent = 0;

    const handled = handleComposerShortcut({
      ctrlKey: true,
      key: "Process",
      code: "NumpadEnter",
      isComposing: false,
      target: input,
      preventDefault: () => undefined,
      stopPropagation: () => undefined
    }, input, () => { sent += 1; });

    expect(handled).toBe(true);
    expect(sent).toBe(1);
  });
});
