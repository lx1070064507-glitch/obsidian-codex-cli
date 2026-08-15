# Obsidian Codex CLI 验收记录

日期：2026-08-15  
平台：Windows 桌面版  
插件版本：0.1.0

## 自动化验收

- [x] TypeScript 类型检查通过。
- [x] 单元测试通过。
- [x] 假 app-server 通过真实 stdio 子进程完成初始化、线程、流式回复和单次审批。
- [x] 临时 Git 仓库验证 `Codex Chats/` 和个人笔记被忽略。
- [x] 临时 Git 仓库验证两个成果逐文件显示为候选。
- [x] 临时 Git 仓库验证只提交用户选择的成果，另一个成果保持未提交。
- [x] 生产构建生成 `main.js`、`manifest.json` 和 `styles.css`。
- [x] 新建和恢复 Codex 线程均使用 `untrusted`，并继续设置 `approvalsReviewer: "user"`、`workspace-write` 和禁用网页搜索。

## 本机 Codex 验收

- [x] 检测到 `codex.cmd`。
- [x] 版本精确为 `codex-cli 0.147.0`。
- [x] 登录状态检查通过。
- [x] 直接解析官方 Windows 原生 `codex.exe`，全程使用 `shell: false`。
- [x] 启动 `app-server --listen stdio://`，只完成 `initialize` 和 `initialized` 后关闭。
- [x] 握手返回 `platformOs: "windows"`。
- [x] 握手期间未发送 `thread/start` 或 `turn/start`，未产生模型回合。

## Obsidian 桌面手工验收

当前状态：待执行。本机未检测到 Obsidian 安装记录、命令或常见安装路径；Computer Use 应用枚举同时被本机目录权限拒绝。未安装软件，也未绕过权限。

安装 Obsidian Windows 桌面版并打开 `D:\My_DateBase\Obsidian_CodexCli` 作为 Vault 后，逐项执行：

- [ ] 插件可以启用，右侧栏可以打开且无 Console 错误。
- [ ] 打开一个 Markdown 笔记后可以新建会话。
- [ ] 完整对话写入 `Codex Chats/`，并且 Git 保持忽略。
- [ ] 重启 Obsidian 后可以恢复最近会话。
- [ ] 常见可信命令读取 Vault 外本机文件时不显示审批弹窗。
- [ ] 尝试写入、修改或删除 Vault 外文件时显示审批弹窗。
- [ ] 尝试访问网络时显示审批弹窗。
- [ ] 选择“拒绝”后操作不执行，并且当前会话可以继续。
- [ ] 选择“允许一次”后，同类非可信操作再次执行时仍需审批。
- [ ] 审批弹窗只有“允许一次”和“拒绝”，关闭弹窗等同拒绝。
- [ ] Codex 完成回复可以预览并保存为 `Codex Results/` 成果。
- [ ] 当前笔记只追加成果链接，不复制成果正文。
- [ ] 侧边栏成果列表可以打开已保存成果。
- [ ] 提交弹窗只列出 `Codex Results/` 下的候选文件。
- [ ] 选择单个成果后，diff 与提交文件列表只包含该成果。
- [ ] 提交完成后，临时会话、个人笔记和其他改动均未暂存。

## 已知验收限制

- Codex `app-server` 属于实验性协议，插件只接受 CLI `0.147.0`。
- 第一版只支持 Windows 桌面版和单个本地 Vault。
- ChatGPT 客户端不会自动显示这些本地会话；完整会话与成果以 Vault 文档为准。
