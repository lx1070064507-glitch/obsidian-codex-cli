import { expect, it } from "vitest";

import { ContextService } from "../src/services/context-service.js";

it("首轮发送当前笔记，未变化时不重复发送", () => {
  const context = new ContextService();
  expect(context.compose("项目.md", "# 项目", "第一问")).toContain("# 项目");
  expect(context.compose("项目.md", "# 项目", "第二问")).toBe("第二问");
  expect(context.compose("项目.md", "# 项目\n更新", "第三问")).toContain("更新");
});

it("笔记路径变化时重新发送上下文", () => {
  const context = new ContextService();
  context.compose("A.md", "相同内容", "第一问");
  expect(context.compose("B.md", "相同内容", "第二问")).toContain("B.md");
});
