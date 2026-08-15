# Vault 约束

- 默认使用中文回答。
- `Codex Chats/` 仅本地保存，不纳入版本控制。
- 由 Obsidian 插件启动的运行时 Codex 会话：只允许修改此 Vault 内的文件，不得自行运行 `git add`、`git commit` 或 `git push`。
- 实施计划中的开发 Agent 可在用户明确授权后运行 `git add` 和 `git commit`；不得运行 `git push`。
- 本机任意路径的文件读取默认允许；写入、修改、删除和访问网络必须由插件审批弹窗确认。Codex 应直接发起工具调用，不在对话中重复询问；用户拒绝后不得改用其他方式重试。
