import { describe, expect, it } from "vitest";

import { assertResultPath, sanitizeFileStem } from "../src/services/path-policy.js";

describe("path policy", () => {
  it("只接受 Codex Results 下的 Markdown", () => {
    expect(assertResultPath("Codex Results/方案.md")).toBe("Codex Results/方案.md");
    expect(() => assertResultPath("Codex Chats/会话.md")).toThrow("成果目录");
    expect(() => assertResultPath("../方案.md")).toThrow("非法路径");
  });

  it("净化 Windows 文件名", () => {
    expect(sanitizeFileStem('AUX: 方案?')).toBe("AUX- 方案-");
    expect(sanitizeFileStem("AUX")).toBe("AUX-");
    expect(sanitizeFileStem("方案. ")).toBe("方案");
  });
});
