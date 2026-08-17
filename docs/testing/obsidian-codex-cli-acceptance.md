# Obsidian Codex CLI 验收记录

日期：2026-08-16
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
- [x] 新建和恢复 Codex 线程均使用 `on-request` 和 `obsidian-vault` 权限档案，并继续设置 `approvalsReviewer: "user"` 和禁用网页搜索。
- [x] 权限档案对本机根目录只读，关闭命令网络，且线程参数不包含旧 `sandbox` 字段。
- [x] 工作区和白名单设置默认均为空，旧设置可无损迁移。
- [x] 新建、恢复和每次回合均使用当前 Vault 与所有额外工作区。
- [x] 权限档案仅对白名单真实路径授予 `write`。
- [x] 外部 Vault 启动器测试覆盖新 Vault、配置保留、幂等执行、错误清单、异常目标和目录联接。
- [x] 工作区管理不再包含 Vault 初始化或插件安装职责。

## 本机 Codex 验收

- [x] 检测到 `codex.cmd`。
- [x] 版本精确为 `codex-cli 0.147.0`。
- [x] 登录状态检查通过。
- [x] 直接解析官方 Windows 原生 `codex.exe`，全程使用 `shell: false`。
- [x] 启动 `app-server --listen stdio://`，只完成 `initialize` 和 `initialized` 后关闭。
- [x] 握手返回 `platformOs: "windows"`。
- [x] 真实 `app-server` 接受自定义 `obsidian-vault` 权限档案，并返回该档案为当前线程的 `activePermissionProfile`。
- [x] 握手测试未发送 `turn/start`；显式启用的真实只读测试创建全新线程，并确认读取 `C:\Windows\win.ini` 时没有审批请求。

## Obsidian 桌面手工验收

当前状态：最终权限配置复验中。Vault 外只读无弹窗、Vault 内写入弹窗和拒绝后文件未创建已经通过；Vault 外写入、网络访问和“允许一次”仍待手工验收。

安装 Obsidian Windows 桌面版并打开 `D:\My_DateBase\Obsidian_CodexCli` 作为 Vault 后，逐项执行：

- [x] 插件可以启用，右侧栏可以打开且无可见错误。
- [x] 打开一个 Markdown 笔记后可以新建会话。
- [x] 完整对话写入 `Codex Chats/`，并且 Git 保持忽略。
- [ ] 重启 Obsidian 后可以恢复最近会话。
- [x] 命令读取 Vault 内外本机文件时不显示审批弹窗。
- [x] 尝试写入、修改或删除 Vault 内文件时显示审批弹窗。
- [ ] 尝试写入、修改或删除 Vault 外文件时显示审批弹窗。
- [ ] 尝试访问网络时显示审批弹窗。
- [x] 选择“拒绝”后操作不执行；插件中止当前回合，下一条消息仍可继续会话。
- [ ] 打开不同的 `Codex Chats/` 笔记时自动加载对应会话上下文。
- [ ] 选择“允许一次”后，同类非可信操作再次执行时仍需审批。
- [ ] 审批弹窗只有“允许一次”和“拒绝”，关闭弹窗等同拒绝。
- [ ] Codex 完成回复可以预览并保存为 `Codex Results/` 成果。
- [ ] 当前笔记只追加成果链接，不复制成果正文。
- [ ] 侧边栏成果列表可以打开已保存成果。
- [ ] 提交弹窗只列出 `Codex Results/` 下的候选文件。
- [ ] 选择单个成果后，diff 与提交文件列表只包含该成果。
- [ ] 提交完成后，临时会话、个人笔记和其他改动均未暂存。
- [ ] 两个不同目录可在同一会话中读取和检索。
- [ ] 白名单内创建、修改、重命名和删除不显示审批弹窗。
- [ ] 工作区内非白名单写入显示审批弹窗。
- [ ] 工作区外写入显示审批弹窗。
- [ ] 移除白名单后，同一路径写入恢复审批弹窗。
- [ ] 白名单文件、目录及目录子项显示绿色，移除白名单后恢复默认颜色。
- [ ] Excel 和常见表格文件显示在文件树中，双击后使用系统默认 Excel/WPS 打开。
- [ ] 文件修改审批显示完整路径、操作类型、增删行数，并可展开查看 diff。
- [ ] 双击桌面“Open Codex Vault”后显示文件夹选择器。
- [ ] 选择没有 `.obsidian` 的项目目录后，自动初始化并使用 Obsidian 打开。
- [ ] 外部启动器更新已有 Vault 时保留 `data.json`、其他插件和插件设置。
- [ ] 重复打开已正确初始化的 Vault 时，不重复启用或重写相同运行文件。
- [ ] “管理工作区”只保存额外目录，不显示或执行 Vault 初始化。

## 已知验收限制

- Codex `app-server` 属于实验性协议，插件只接受 CLI `0.147.0`。
- 仅使用 `untrusted` 无法满足 Windows 上的 Vault 外只读要求；失败复现为通过 PowerShell 读取 `C:\Windows\win.ini` 时仍显示审批弹窗。
- `sandbox_permissions` 在 CLI `0.147.0` 严格配置检查下属于未知字段，放入 `thread/start.config` 会被静默忽略，不能用于实现该权限边界。
- `untrusted` 会按命令信誉拦截 PowerShell，只靠全盘只读权限档案无法消除该类只读审批；最终改用 `on-request`。
- 第一版只支持 Windows 桌面版；独立 Vault 通过外部启动器初始化和打开。
- ChatGPT 客户端不会自动显示这些本地会话；完整会话与成果以 Vault 文档为准。
